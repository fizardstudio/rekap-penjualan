package main

// Backup otomatis ke Google Drive (login Google dari dalam aplikasi, tanpa Google Drive for Desktop).
// - OAuth 2.0 "Desktop app": redirect loopback http://127.0.0.1:<port>/oauth/google + PKCE.
// - Izin hanya drive.file: aplikasi hanya bisa melihat/mengelola file yang dibuatnya sendiri.
// - Token & status disimpan di data/gdrive.json (TIDAK ikut di dalam file backup).
// - Backup = zip harian "Rekap-backup-YYYY-MM-DD.zip" (data.json + lampiran) di folder
//   "Backup Rekap Penjualan"; file hari yang sama ditimpa; disimpan 30 hari terakhir.

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

const (
	gdFolderName = "Backup Rekap Penjualan"
	gdKeep       = 30
	gdScope      = "https://www.googleapis.com/auth/drive.file openid email"
)

// endpoint Google (bisa diganti lewat environment untuk pengujian)
var (
	gAuthURL   = envOr("REKAP_G_AUTH", "https://accounts.google.com/o/oauth2/v2/auth")
	gTokenURL  = envOr("REKAP_G_TOKEN", "https://oauth2.googleapis.com/token")
	gRevokeURL = envOr("REKAP_G_REVOKE", "https://oauth2.googleapis.com/revoke")
	gUserURL   = envOr("REKAP_G_USER", "https://openidconnect.googleapis.com/v1/userinfo")
	gAPI       = envOr("REKAP_G_API", "https://www.googleapis.com/drive/v3")
	gUpload    = envOr("REKAP_G_UPLOAD", "https://www.googleapis.com/upload/drive/v3")
)

func envOr(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}

type gdConfig struct {
	ClientID     string     `json:"clientId"`
	ClientSecret string     `json:"clientSecret"`
	RefreshToken string     `json:"refreshToken,omitempty"`
	Email        string     `json:"email,omitempty"`
	FolderID     string     `json:"folderId,omitempty"`
	Terhubung    string     `json:"terhubung,omitempty"` // waktu dihubungkan
	LastOK       string     `json:"lastOK,omitempty"`    // backup sukses terakhir (RFC3339)
	LastTry      string     `json:"lastTry,omitempty"`
	LastError    string     `json:"lastError,omitempty"`
	LastHash     string     `json:"lastHash,omitempty"` // hash data.json saat backup sukses terakhir
	LastFile     string     `json:"lastFile,omitempty"`
	LastSize     int64      `json:"lastSize,omitempty"`
	Konflik      *gdKonflik `json:"konflik,omitempty"`   // backup ditahan: Drive lebih baru / dari data lain
	Diterima     string     `json:"diterima,omitempty"`  // "id:rev" backup Drive yang sudah disetujui untuk dilewati
	LastUp       string     `json:"lastUp,omitempty"`    // "id:rev:diubah" backup terakhir yang DIKIRIM komputer ini
	InstallID    string     `json:"installId,omitempty"` // kode instalasi (nama file backup per komputer)
	Jeda         string     `json:"jeda,omitempty"`      // cepat | normal | hemat | harian | manual (kosong = cepat)
}

// info backup di Drive yang lebih baru / dari komputer lain
type gdKonflik struct {
	FileID string `json:"fileId"`
	Name   string `json:"name"`
	Kunci  string `json:"kunci"`
	ID     string `json:"id"`
	Rev    int64  `json:"rev"`
	Diubah string `json:"diubah"`
	PC     string `json:"pc"`
	Trx    int    `json:"trx"`
	Alasan string `json:"alasan"` // "lebih-baru" | "data-lain"
	Awal   bool   `json:"awal"`   // terdeteksi saat pertama menghubungkan
}

var errKonflik = errors.New("backup ditahan: data di Google Drive lebih baru / dari komputer lain")

type gDrive struct {
	mu        sync.Mutex
	path      string
	dataDir   string
	cfg       gdConfig
	access    string
	accessExp time.Time
	running   bool
	states    map[string]gdState // state OAuth -> verifier
	hc        *http.Client
	st        *Store
}

type gdState struct {
	verifier string
	redirect string
	exp      time.Time
}

func newGDrive(st *Store) *gDrive {
	g := &gDrive{path: filepath.Join(st.dir, "gdrive.json"), dataDir: st.dir, states: map[string]gdState{},
		hc: &http.Client{Timeout: 3 * time.Minute}, st: st}
	if b, err := os.ReadFile(g.path); err == nil {
		_ = json.Unmarshal(b, &g.cfg)
	}
	if g.cfg.InstallID == "" {
		g.cfg.InstallID = randHex(3)
		g.simpan()
	}
	return g
}

func (g *gDrive) simpan() {
	b, _ := json.MarshalIndent(g.cfg, "", " ")
	tmp := g.path + ".tmp"
	if os.WriteFile(tmp, b, 0o600) == nil {
		_ = os.Rename(tmp, g.path)
	}
}

func hashFile(p string) string {
	b, err := os.ReadFile(p)
	if err != nil {
		return ""
	}
	h := sha256.Sum256(b)
	return hex.EncodeToString(h[:])
}

// ------------------------------------------------------------------ status untuk tampilan
func (g *gDrive) status() map[string]any {
	g.mu.Lock()
	defer g.mu.Unlock()
	cur := hashFile(filepath.Join(g.dataDir, "data.json"))
	return map[string]any{
		"siap":      g.cfg.ClientID != "" && g.cfg.ClientSecret != "",
		"terhubung": g.cfg.RefreshToken != "",
		"email":     g.cfg.Email,
		"lastOK":    g.cfg.LastOK,
		"lastTry":   g.cfg.LastTry,
		"lastError": g.cfg.LastError,
		"lastFile":  g.cfg.LastFile,
		"lastSize":  g.cfg.LastSize,
		"pending":   g.cfg.RefreshToken != "" && cur != "" && cur != g.cfg.LastHash,
		"running":   g.running,
		"clientId":  g.cfg.ClientID,
		"folder":    gdFolderName,
		"konflik":   g.cfg.Konflik,
		"jeda":      g.cfg.Jeda,
		"lokal":     g.lokalInfo(),
	}
}

type infoData struct {
	Meta      DataMeta `json:"meta"`
	Transaksi []struct {
		ID int `json:"id"`
	} `json:"transaksi"`
}

func (g *gDrive) lokalInfo() map[string]any {
	g.st.mu.Lock()
	m, n := g.st.d.Meta, len(g.st.d.Transaksi)
	g.st.mu.Unlock()
	return map[string]any{"id": m.ID, "rev": m.Rev, "diubah": m.Diubah, "pc": m.PC, "trx": n}
}

// ------------------------------------------------------------------ OAuth
func b64url(b []byte) string { return base64.RawURLEncoding.EncodeToString(b) }

func isLoopback(r *http.Request) bool {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

func (a *App) gdLogin(w http.ResponseWriter, r *http.Request, u *User) {
	g := a.gd
	if !isLoopback(r) {
		halamanInfo(w, "Hubungkan Google Drive dari komputer server",
			"Login Google harus dilakukan di komputer yang menjalankan RekapPenjualan.exe (yang ada jendela hitamnya), lewat alamat http://localhost:"+fmt.Sprint(port)+".")
		return
	}
	g.mu.Lock()
	if g.cfg.ClientID == "" || g.cfg.ClientSecret == "" {
		g.mu.Unlock()
		halamanInfo(w, "Client ID belum diisi", "Isi Client ID dan Client Secret di menu Pengaturan → Backup Google Drive terlebih dulu.")
		return
	}
	verifier := randHex(32)
	state := randHex(16)
	redirect := fmt.Sprintf("http://127.0.0.1:%d/oauth/google", port)
	g.states[state] = gdState{verifier: verifier, redirect: redirect, exp: time.Now().Add(15 * time.Minute)}
	cid := g.cfg.ClientID
	g.mu.Unlock()
	ch := sha256.Sum256([]byte(verifier))
	q := url.Values{
		"client_id": {cid}, "redirect_uri": {redirect}, "response_type": {"code"}, "scope": {gdScope},
		"state": {state}, "code_challenge": {b64url(ch[:])}, "code_challenge_method": {"S256"},
		"access_type": {"offline"}, "prompt": {"consent select_account"},
	}
	http.Redirect(w, r, gAuthURL+"?"+q.Encode(), http.StatusFound)
}

func (a *App) gdCallback(w http.ResponseWriter, r *http.Request) {
	g := a.gd
	back := fmt.Sprintf("http://localhost:%d/#/pengaturan", port)
	if e := r.URL.Query().Get("error"); e != "" {
		halamanInfo(w, "Google Drive tidak jadi dihubungkan", "Izin tidak diberikan ("+e+"). <a href=\""+back+"\">Kembali ke aplikasi</a>")
		return
	}
	state, code := r.URL.Query().Get("state"), r.URL.Query().Get("code")
	g.mu.Lock()
	s, ok := g.states[state]
	delete(g.states, state)
	cid, sec := g.cfg.ClientID, g.cfg.ClientSecret
	g.mu.Unlock()
	if !ok || time.Now().After(s.exp) || code == "" {
		halamanInfo(w, "Sesi login kedaluwarsa", "Silakan klik \"Hubungkan Google Drive\" sekali lagi. <a href=\""+back+"\">Kembali ke aplikasi</a>")
		return
	}
	var tok struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
		ExpiresIn    int    `json:"expires_in"`
		Scope        string `json:"scope"`
		Error        string `json:"error"`
		ErrorDesc    string `json:"error_description"`
	}
	err := g.postForm(gTokenURL, url.Values{"client_id": {cid}, "client_secret": {sec}, "code": {code},
		"code_verifier": {s.verifier}, "grant_type": {"authorization_code"}, "redirect_uri": {s.redirect}}, &tok)
	if err != nil || tok.RefreshToken == "" {
		msg := tok.ErrorDesc
		if msg == "" && err != nil {
			msg = err.Error()
		}
		if msg == "" {
			msg = "Google tidak mengirim refresh token. Putuskan akses aplikasi di myaccount.google.com/permissions lalu coba lagi."
		}
		halamanInfo(w, "Gagal menghubungkan Google Drive", esc(msg)+" <br><a href=\""+back+"\">Kembali ke aplikasi</a>")
		return
	}
	// Google menampilkan kotak centang per izin: pastikan izin Drive benar-benar diberikan
	if tok.Scope != "" && !strings.Contains(tok.Scope, "auth/drive.file") {
		go func() { _, _ = g.hc.PostForm(gRevokeURL, url.Values{"token": {tok.RefreshToken}}) }()
		halamanInfo(w, "Izin Google Drive belum dicentang",
			"Di halaman izin Google, kotak <b>\"See, edit, create, and delete only the specific Google Drive files you use with this app\"</b> harus <b>dicentang</b> (atau klik <b>Select all</b>). Tanpa izin itu aplikasi tidak bisa menyimpan backup.<br><br>Silakan kembali ke aplikasi lalu klik <b>Hubungkan Google Drive</b> sekali lagi dan centang izin tersebut.")
		return
	}
	email := ""
	var ui struct {
		Email string `json:"email"`
	}
	if req, _ := http.NewRequest("GET", gUserURL, nil); req != nil {
		req.Header.Set("Authorization", "Bearer "+tok.AccessToken)
		if res, err := g.hc.Do(req); err == nil {
			_ = json.NewDecoder(res.Body).Decode(&ui)
			res.Body.Close()
			email = ui.Email
		}
	}
	g.mu.Lock()
	g.cfg.RefreshToken, g.cfg.Email, g.cfg.FolderID = tok.RefreshToken, email, ""
	g.cfg.Terhubung, g.cfg.LastError, g.cfg.LastHash = time.Now().Format(time.RFC3339), "", ""
	g.cfg.Konflik, g.cfg.Diterima = nil, ""
	g.access, g.accessExp = tok.AccessToken, time.Now().Add(time.Duration(tok.ExpiresIn-60)*time.Second)
	g.simpan()
	g.mu.Unlock()
	go g.backup("pertama")
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	fmt.Fprintf(w, `<!doctype html><meta charset="utf-8"><title>Terhubung</title><body style="font:15px system-ui;padding:40px;text-align:center"><h2 style="color:#067647">✓ Google Drive terhubung</h2><p>%s</p><p>Backup pertama sedang dikirim. Kembali ke aplikasi…</p><script>setTimeout(()=>location.href=%q,1500)</script>`, esc(email), back)
}

func esc(s string) string {
	r := strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", `"`, "&quot;")
	return r.Replace(s)
}

func halamanInfo(w http.ResponseWriter, judul, isi string) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	fmt.Fprintf(w, `<!doctype html><meta charset="utf-8"><title>%s</title><body style="font:15px system-ui;padding:40px;max-width:640px;margin:auto"><h2>%s</h2><p>%s</p><p><a href="http://localhost:%d/#/pengaturan">Kembali ke aplikasi</a></p>`, esc(judul), esc(judul), isi, port)
}

func (g *gDrive) postForm(u string, v url.Values, out any) error {
	res, err := g.hc.PostForm(u, v)
	if err != nil {
		return errInternet(err)
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(res.Body)
	_ = json.Unmarshal(b, out)
	if res.StatusCode >= 300 {
		return fmt.Errorf("HTTP %d: %s", res.StatusCode, strings.TrimSpace(string(b)))
	}
	return nil
}

func errInternet(err error) error {
	return fmt.Errorf("tidak bisa terhubung ke Google (cek internet): %v", err)
}

var errDicabut = errors.New("akses Google dicabut atau kedaluwarsa — klik \"Hubungkan ulang\"")
var errIzin = errors.New("izin Google Drive belum dicentang saat login — klik \"Hubungkan ulang\" lalu centang kotak izin Google Drive")

// token akses (diperbarui otomatis dari refresh token). Dipanggil tanpa g.mu terkunci.
func (g *gDrive) token() (string, error) {
	g.mu.Lock()
	if g.access != "" && time.Now().Before(g.accessExp) {
		t := g.access
		g.mu.Unlock()
		return t, nil
	}
	cid, sec, rt := g.cfg.ClientID, g.cfg.ClientSecret, g.cfg.RefreshToken
	g.mu.Unlock()
	if rt == "" {
		return "", errors.New("Google Drive belum terhubung")
	}
	var tok struct {
		AccessToken string `json:"access_token"`
		ExpiresIn   int    `json:"expires_in"`
		Error       string `json:"error"`
	}
	err := g.postForm(gTokenURL, url.Values{"client_id": {cid}, "client_secret": {sec}, "refresh_token": {rt}, "grant_type": {"refresh_token"}}, &tok)
	if tok.Error == "invalid_grant" || tok.Error == "unauthorized_client" {
		return "", errDicabut
	}
	if err != nil {
		return "", err
	}
	g.mu.Lock()
	g.access, g.accessExp = tok.AccessToken, time.Now().Add(time.Duration(tok.ExpiresIn-60)*time.Second)
	g.mu.Unlock()
	return tok.AccessToken, nil
}

// panggilan API Drive (JSON)
func (g *gDrive) api(method, u string, body any, out any) error {
	t, err := g.token()
	if err != nil {
		return err
	}
	var rd io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rd = bytes.NewReader(b)
	}
	req, _ := http.NewRequest(method, u, rd)
	req.Header.Set("Authorization", "Bearer "+t)
	if body != nil {
		req.Header.Set("Content-Type", "application/json; charset=UTF-8")
	}
	res, err := g.hc.Do(req)
	if err != nil {
		return errInternet(err)
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(res.Body)
	if res.StatusCode == 401 {
		g.mu.Lock()
		g.access = ""
		g.mu.Unlock()
		return errDicabut
	}
	if res.StatusCode == 403 && strings.Contains(strings.ToLower(string(b)), "insufficient") {
		return errIzin
	}
	if res.StatusCode >= 300 {
		return fmt.Errorf("Google Drive HTTP %d: %s", res.StatusCode, ringkasErr(b))
	}
	if out != nil && len(b) > 0 {
		return json.Unmarshal(b, out)
	}
	return nil
}

func ringkasErr(b []byte) string {
	var e struct {
		Error struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if json.Unmarshal(b, &e) == nil && e.Error.Message != "" {
		return e.Error.Message
	}
	s := strings.TrimSpace(string(b))
	if len(s) > 200 {
		s = s[:200]
	}
	return s
}

type gFile struct {
	ID            string            `json:"id"`
	Name          string            `json:"name"`
	CreatedTime   string            `json:"createdTime"`
	ModifiedTime  string            `json:"modifiedTime"`
	Size          string            `json:"size"`
	AppProperties map[string]string `json:"appProperties"`
}

// waktu data di dalam backup (dari appProperties; file lama tanpa penanda memakai modifiedTime)
func (f gFile) waktu() string {
	if v := f.AppProperties["diubah"]; v != "" {
		return v
	}
	return f.ModifiedTime
}

// kunci unik isi backup: data + instalasi + revisi + waktu
func (f gFile) kunci() string {
	p := f.AppProperties
	return p["id"] + ":" + p["inst"] + ":" + p["rev"] + ":" + p["diubah"]
}

func (f gFile) rev() int64 {
	var r int64
	fmt.Sscan(f.AppProperties["rev"], &r)
	return r
}

func (g *gDrive) cari(q string) ([]gFile, error) {
	var out struct {
		Files []gFile `json:"files"`
	}
	u := gAPI + "/files?" + url.Values{"q": {q}, "fields": {"files(id,name,createdTime,modifiedTime,size,appProperties)"}, "pageSize": {"200"}, "spaces": {"drive"}}.Encode()
	err := g.api("GET", u, nil, &out)
	return out.Files, err
}

func qEsc(s string) string { return strings.ReplaceAll(strings.ReplaceAll(s, `\`, `\\`), `'`, `\'`) }

func (g *gDrive) folder() (string, error) {
	g.mu.Lock()
	id := g.cfg.FolderID
	g.mu.Unlock()
	if id != "" {
		// pastikan masih ada (bisa saja dihapus pengguna)
		var f struct {
			ID      string `json:"id"`
			Trashed bool   `json:"trashed"`
		}
		if err := g.api("GET", gAPI+"/files/"+id+"?fields=id,trashed", nil, &f); err == nil && !f.Trashed {
			return id, nil
		} else if err == errDicabut {
			return "", err
		}
	}
	fs, err := g.cari("name='" + qEsc(gdFolderName) + "' and mimeType='application/vnd.google-apps.folder' and trashed=false")
	if err != nil {
		return "", err
	}
	if len(fs) > 0 {
		id = fs[0].ID
	} else {
		var f gFile
		if err := g.api("POST", gAPI+"/files?fields=id", map[string]any{"name": gdFolderName, "mimeType": "application/vnd.google-apps.folder"}, &f); err != nil {
			return "", err
		}
		id = f.ID
	}
	g.mu.Lock()
	g.cfg.FolderID = id
	g.simpan()
	g.mu.Unlock()
	return id, nil
}

// upload resumable: buat baru (fileID == "") atau timpa isi file yang ada
func (g *gDrive) upload(fileID, name, parent string, data []byte, props map[string]string) error {
	t, err := g.token()
	if err != nil {
		return err
	}
	var meta map[string]any
	method, u := "POST", gUpload+"/files?uploadType=resumable&fields=id"
	if fileID == "" {
		meta = map[string]any{"name": name, "parents": []string{parent}, "mimeType": "application/zip", "appProperties": props}
	} else {
		method, u = "PATCH", gUpload+"/files/"+fileID+"?uploadType=resumable&fields=id"
		meta = map[string]any{"appProperties": props}
	}
	mb, _ := json.Marshal(meta)
	req, _ := http.NewRequest(method, u, bytes.NewReader(mb))
	req.Header.Set("Authorization", "Bearer "+t)
	req.Header.Set("Content-Type", "application/json; charset=UTF-8")
	req.Header.Set("X-Upload-Content-Type", "application/zip")
	req.Header.Set("X-Upload-Content-Length", fmt.Sprint(len(data)))
	res, err := g.hc.Do(req)
	if err != nil {
		return errInternet(err)
	}
	b, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if res.StatusCode == 401 {
		return errDicabut
	}
	if res.StatusCode == 403 && strings.Contains(strings.ToLower(string(b)), "insufficient") {
		return errIzin
	}
	loc := res.Header.Get("Location")
	if res.StatusCode >= 300 || loc == "" {
		return fmt.Errorf("gagal memulai upload (HTTP %d): %s", res.StatusCode, ringkasErr(b))
	}
	req2, _ := http.NewRequest("PUT", loc, bytes.NewReader(data))
	req2.Header.Set("Content-Type", "application/zip")
	req2.ContentLength = int64(len(data))
	res2, err := g.hc.Do(req2)
	if err != nil {
		return errInternet(err)
	}
	b2, _ := io.ReadAll(res2.Body)
	res2.Body.Close()
	if res2.StatusCode >= 300 {
		return fmt.Errorf("upload gagal (HTTP %d): %s", res2.StatusCode, ringkasErr(b2))
	}
	return nil
}

// isi zip: data.json + lampiran (kecuali yang terhapus)
func (g *gDrive) buatZip() ([]byte, string, infoData, error) {
	var info infoData
	g.st.mu.Lock()
	data, err := os.ReadFile(filepath.Join(g.dataDir, "data.json"))
	g.st.mu.Unlock()
	if err != nil {
		return nil, "", info, err
	}
	_ = json.Unmarshal(data, &info)
	h := sha256.Sum256(data)
	var buf bytes.Buffer
	z := zip.NewWriter(&buf)
	f, _ := z.Create("data.json")
	_, _ = f.Write(data)
	lamp, _ := os.ReadDir(filepath.Join(g.dataDir, "lampiran"))
	for _, e := range lamp {
		if e.IsDir() {
			continue
		}
		b, err := os.ReadFile(filepath.Join(g.dataDir, "lampiran", e.Name()))
		if err != nil {
			continue
		}
		hdr := &zip.FileHeader{Name: "lampiran/" + e.Name(), Method: zip.Store} // gambar/PDF sudah terkompresi
		if w, err := z.CreateHeader(hdr); err == nil {
			_, _ = w.Write(b)
		}
	}
	readme, _ := z.Create("BACA.txt")
	fmt.Fprintf(readme, "Backup Rekap Penjualan Instansi, dibuat %s.\r\nUntuk memulihkan: ekstrak, lalu di aplikasi buka Pengaturan > Pulihkan dari file backup > pilih data.json.\r\nLampiran: salin folder 'lampiran' ke folder data aplikasi.\r\n", time.Now().Format("02-01-2006 15:04"))
	if err := z.Close(); err != nil {
		return nil, "", info, err
	}
	return buf.Bytes(), hex.EncodeToString(h[:]), info, nil
}

// backup menjalankan satu kali backup. alasan: "manual", "otomatis", "pertama".
func (g *gDrive) backup(alasan string) error { return g.backupX(alasan, false) }

// backupX: paksa = lewati pengecekan konflik (setelah pengguna memilih "lanjutkan").
func (g *gDrive) backupX(alasan string, paksa bool) error {
	g.mu.Lock()
	if g.running {
		g.mu.Unlock()
		return errors.New("backup sedang berjalan")
	}
	if g.cfg.RefreshToken == "" {
		g.mu.Unlock()
		return errors.New("Google Drive belum terhubung")
	}
	g.running = true
	g.cfg.LastTry = time.Now().Format(time.RFC3339)
	g.mu.Unlock()
	err := g.backupInti(alasan, paksa)
	g.mu.Lock()
	g.running = false
	if err == errKonflik {
		fmt.Println("Backup Google Drive DITAHAN: data di Drive lebih baru / dari komputer lain")
	} else if err != nil {
		g.cfg.LastError = err.Error()
		fmt.Println("Backup Google Drive GAGAL:", err)
	}
	g.simpan()
	g.mu.Unlock()
	return err
}

func (g *gDrive) backupInti(alasan string, paksa bool) error {
	parent, err := g.folder()
	if err != nil {
		return err
	}
	data, hash, info, err := g.buatZip()
	if err != nil {
		return err
	}
	lok := info.Meta
	all, err := g.cari("'" + parent + "' in parents and name contains 'Rekap-backup-' and trashed=false")
	if err != nil {
		return err
	}
	// cek: jangan menimpa backup yang lebih baru / milik data lain tanpa persetujuan
	var terbaru *gFile
	for i := range all {
		if all[i].AppProperties["id"] == "" {
			continue // file versi lama tanpa penanda: tidak bisa dibandingkan
		}
		if terbaru == nil || all[i].waktu() > terbaru.waktu() {
			terbaru = &all[i]
		}
	}
	if terbaru != nil && !paksa {
		rid, rrev := terbaru.AppProperties["id"], terbaru.rev()
		g.mu.Lock()
		diterima := g.cfg.Diterima == terbaru.kunci()
		milikSendiri := g.cfg.LastUp == terbaru.kunci()
		g.mu.Unlock()
		// aman bila: backup terbaru di Drive adalah kiriman komputer ini sendiri, atau
		// versi lebih lama dari data yang sama (revisi lebih kecil). Selain itu: tahan.
		alasanK := ""
		switch {
		case milikSendiri:
		case rid != lok.ID:
			alasanK = "data-lain"
		case rrev >= lok.Rev:
			alasanK = "lebih-baru"
		}
		if alasanK != "" && !diterima {
			var trx int
			fmt.Sscan(terbaru.AppProperties["trx"], &trx)
			k := &gdKonflik{FileID: terbaru.ID, Name: terbaru.Name, Kunci: terbaru.kunci(), ID: rid, Rev: rrev, Diubah: terbaru.waktu(),
				PC: terbaru.AppProperties["pc"], Trx: trx, Alasan: alasanK, Awal: alasan == "pertama"}
			g.mu.Lock()
			g.cfg.Konflik = k
			g.mu.Unlock()
			return errKonflik
		}
	}
	g.mu.Lock()
	inst := g.cfg.InstallID
	g.mu.Unlock()
	name := "Rekap-backup-" + time.Now().Format("2006-01-02") + "-" + lok.ID + "-" + inst + ".zip"
	id := ""
	for _, f := range all {
		if f.Name == name {
			id = f.ID
		}
	}
	props := map[string]string{"id": lok.ID, "inst": inst, "rev": fmt.Sprint(lok.Rev), "diubah": lok.Diubah, "pc": lok.PC, "trx": fmt.Sprint(len(info.Transaksi))}
	if err := g.upload(id, name, parent, data, props); err != nil {
		return err
	}
	g.mu.Lock()
	g.cfg.LastOK, g.cfg.LastError, g.cfg.LastHash = time.Now().Format(time.RFC3339), "", hash
	g.cfg.LastFile, g.cfg.LastSize, g.cfg.Konflik = name, int64(len(data)), nil
	g.cfg.LastUp = props["id"] + ":" + props["inst"] + ":" + props["rev"] + ":" + props["diubah"]
	g.mu.Unlock()
	fmt.Printf("Backup Google Drive OK: %s (%d KB)\n", name, len(data)/1024)
	// bersihkan: simpan gdKeep file terbaru per data (file data/komputer lain tidak diganggu)
	if id == "" {
		all = append(all, gFile{Name: name, AppProperties: props})
	}
	grup := map[string][]gFile{}
	for _, f := range all {
		k := f.AppProperties["id"] + "/" + f.AppProperties["inst"]
		if f.AppProperties["id"] == "" {
			k = "lama"
		}
		grup[k] = append(grup[k], f)
	}
	for _, fs := range grup {
		if len(fs) <= gdKeep {
			continue
		}
		sort.Slice(fs, func(i, j int) bool { return fs[i].Name > fs[j].Name })
		for _, f := range fs[gdKeep:] {
			if f.ID != "" {
				_ = g.api("DELETE", gAPI+"/files/"+f.ID, nil, nil)
			}
		}
	}
	return nil
}

// Pilihan jeda backup otomatis (diatur admin di Pengaturan).
// tenang = data harus diam selama ini dulu; antara = jarak minimal antar kiriman.
var gdJedaPilihan = map[string][2]time.Duration{
	"cepat":  {20 * time.Second, time.Minute},
	"normal": {2 * time.Minute, 3 * time.Minute},
	"hemat":  {5 * time.Minute, 30 * time.Minute},
	"harian": {5 * time.Minute, 23 * time.Hour},
}

func gdJedaValid(j string) bool { _, ok := gdJedaPilihan[j]; return ok || j == "manual" }

// loop backup otomatis sesuai pilihan jeda; bila gagal (internet putus) dicoba lagi tiap 10 menit.
func (g *gDrive) loop() {
	fast := os.Getenv("REKAP_G_FAST") != "" // hanya untuk pengujian
	if fast {
		time.Sleep(time.Second)
	} else {
		time.Sleep(20 * time.Second)
	}
	for {
		g.mu.Lock()
		on := g.cfg.RefreshToken != "" && g.cfg.Konflik == nil
		jedaPilih := g.cfg.Jeda
		lastTry, _ := time.Parse(time.RFC3339, g.cfg.LastTry)
		lastErr, lastHash := g.cfg.LastError, g.cfg.LastHash
		g.mu.Unlock()
		if jedaPilih == "" {
			jedaPilih = "cepat"
		}
		v, otomatis := gdJedaPilihan[jedaPilih]
		if on && otomatis {
			tenangMin, antara := v[0], v[1]
			if lastErr != "" {
				antara = 10 * time.Minute
			}
			if fast {
				tenangMin, antara = 2*time.Second, 3*time.Second
			}
			p := filepath.Join(g.dataDir, "data.json")
			fi, err := os.Stat(p)
			tenang := err == nil && time.Since(fi.ModTime()) > tenangMin
			// coba lagi otomatis setelah gagal (kecuali akses dicabut: perlu hubungkan ulang)
			ulang := lastErr != "" && !strings.Contains(lastErr, "Hubungkan ulang")
			if tenang && time.Since(lastTry) > antara && (ulang || hashFile(p) != lastHash) {
				_ = g.backup("otomatis")
			}
		}
		time.Sleep(5 * time.Second)
	}
}

// ------------------------------------------------------------------ endpoint
func (a *App) gdStatus(w http.ResponseWriter, r *http.Request, u *User) {
	writeJSON(w, 200, a.gd.status())
}

func (a *App) gdBackup(w http.ResponseWriter, r *http.Request, u *User) {
	if err := a.gd.backup("manual"); err != nil {
		fail(w, 400, err.Error())
		return
	}
	writeJSON(w, 200, a.gd.status())
}

func (a *App) gdConfig(w http.ResponseWriter, r *http.Request, u *User) {
	var in struct {
		ClientID     string `json:"clientId"`
		ClientSecret string `json:"clientSecret"`
	}
	if err := readJSON(r, &in); err != nil {
		fail(w, 400, "Data tidak valid.")
		return
	}
	in.ClientID, in.ClientSecret = strings.TrimSpace(in.ClientID), strings.TrimSpace(in.ClientSecret)
	if !strings.HasSuffix(in.ClientID, ".apps.googleusercontent.com") {
		fail(w, 400, "Client ID tidak valid — biasanya berakhiran .apps.googleusercontent.com")
		return
	}
	g := a.gd
	g.mu.Lock()
	if in.ClientSecret == "" { // kosong = tetap pakai secret lama
		in.ClientSecret = g.cfg.ClientSecret
	}
	if in.ClientSecret == "" {
		g.mu.Unlock()
		fail(w, 400, "Client Secret wajib diisi.")
		return
	}
	if g.cfg.ClientID != in.ClientID { // ganti aplikasi = harus hubungkan ulang
		g.cfg.RefreshToken, g.cfg.Email, g.cfg.FolderID, g.access = "", "", "", ""
	}
	g.cfg.ClientID, g.cfg.ClientSecret = in.ClientID, in.ClientSecret
	g.simpan()
	g.mu.Unlock()
	writeJSON(w, 200, g.status())
}

func (a *App) gdDisconnect(w http.ResponseWriter, r *http.Request, u *User) {
	g := a.gd
	g.mu.Lock()
	rt := g.cfg.RefreshToken
	g.cfg.RefreshToken, g.cfg.Email, g.cfg.FolderID, g.access, g.cfg.LastError = "", "", "", "", ""
	g.cfg.Konflik, g.cfg.Diterima = nil, ""
	g.simpan()
	g.mu.Unlock()
	if rt != "" {
		go func() { _, _ = g.hc.PostForm(gRevokeURL, url.Values{"token": {rt}}) }()
	}
	writeJSON(w, 200, g.status())
}

func (a *App) gdJeda(w http.ResponseWriter, r *http.Request, u *User) {
	var in struct {
		Jeda string `json:"jeda"`
	}
	if err := readJSON(r, &in); err != nil || !gdJedaValid(in.Jeda) {
		fail(w, 400, "Pilihan jeda tidak dikenal.")
		return
	}
	g := a.gd
	g.mu.Lock()
	g.cfg.Jeda = in.Jeda
	g.simpan()
	g.mu.Unlock()
	writeJSON(w, 200, g.status())
}

// lanjutkan backup data komputer ini walau di Drive ada backup yang lebih baru / dari komputer lain
// (file milik komputer lain TIDAK dihapus — nama file backup memuat ID data masing-masing)
func (a *App) gdLanjut(w http.ResponseWriter, r *http.Request, u *User) {
	g := a.gd
	g.mu.Lock()
	if k := g.cfg.Konflik; k != nil {
		g.cfg.Diterima = k.Kunci
	}
	g.cfg.Konflik = nil
	g.simpan()
	g.mu.Unlock()
	if err := g.backupX("manual", true); err != nil {
		fail(w, 400, err.Error())
		return
	}
	writeJSON(w, 200, g.status())
}

// daftar backup di folder Drive
func (a *App) gdDaftar(w http.ResponseWriter, r *http.Request, u *User) {
	g := a.gd
	parent, err := g.folder()
	if err != nil {
		fail(w, 400, err.Error())
		return
	}
	all, err := g.cari("'" + parent + "' in parents and name contains 'Rekap-backup-' and trashed=false")
	if err != nil {
		fail(w, 400, err.Error())
		return
	}
	sort.Slice(all, func(i, j int) bool { return all[i].waktu() > all[j].waktu() })
	g.st.mu.Lock()
	lokID := g.st.d.Meta.ID
	g.st.mu.Unlock()
	out := []map[string]any{}
	for _, f := range all {
		var size int64
		fmt.Sscan(f.Size, &size)
		out = append(out, map[string]any{"id": f.ID, "name": f.Name, "size": size, "diubah": f.waktu(), "pc": f.AppProperties["pc"],
			"trx": f.AppProperties["trx"], "rev": f.rev(), "dataId": f.AppProperties["id"], "milikIni": f.AppProperties["id"] == lokID})
	}
	writeJSON(w, 200, map[string]any{"files": out})
}

// pulihkan data (dan lampiran) dari salah satu backup di Drive
func (a *App) gdPulihkan(w http.ResponseWriter, r *http.Request, u *User) {
	var in struct {
		FileID string `json:"fileId"`
	}
	if err := readJSON(r, &in); err != nil || in.FileID == "" {
		fail(w, 400, "Pilih file backup.")
		return
	}
	g := a.gd
	t, err := g.token()
	if err != nil {
		fail(w, 400, err.Error())
		return
	}
	req, _ := http.NewRequest("GET", gAPI+"/files/"+url.PathEscape(in.FileID)+"?alt=media", nil)
	req.Header.Set("Authorization", "Bearer "+t)
	res, err := g.hc.Do(req)
	if err != nil {
		fail(w, 400, errInternet(err).Error())
		return
	}
	body, _ := io.ReadAll(io.LimitReader(res.Body, 2<<30))
	res.Body.Close()
	if res.StatusCode >= 300 {
		fail(w, 400, fmt.Sprintf("Gagal mengunduh backup (HTTP %d): %s", res.StatusCode, ringkasErr(body)))
		return
	}
	zr, err := zip.NewReader(bytes.NewReader(body), int64(len(body)))
	if err != nil {
		fail(w, 400, "File backup rusak (bukan zip).")
		return
	}
	var d Data
	var lamp []*zip.File
	ok := false
	for _, f := range zr.File {
		switch {
		case f.Name == "data.json":
			rc, err := f.Open()
			if err == nil {
				err = json.NewDecoder(rc).Decode(&d)
				rc.Close()
			}
			ok = err == nil && len(d.Users) > 0
		case strings.HasPrefix(f.Name, "lampiran/") && !f.FileInfo().IsDir():
			lamp = append(lamp, f)
		}
	}
	if !ok {
		fail(w, 400, "Isi backup tidak valid (data.json tidak ditemukan / rusak).")
		return
	}
	// lampiran: tulis yang belum ada
	nl := 0
	for _, f := range lamp {
		name := filepath.Base(f.Name)
		dst := filepath.Join(a.st.dir, "lampiran", name)
		if _, err := os.Stat(dst); err == nil {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			continue
		}
		if out, err := os.Create(dst); err == nil {
			_, _ = io.Copy(out, rc)
			out.Close()
			nl++
		}
		rc.Close()
	}
	asalKunci := "" // backup yang dipulihkan dianggap "sudah dikenal" komputer ini
	diterima := ""
	if parent, err := g.folder(); err == nil {
		if all, err := g.cari("'" + parent + "' in parents and name contains 'Rekap-backup-' and trashed=false"); err == nil {
			var tb *gFile
			for i := range all {
				if all[i].ID == in.FileID {
					asalKunci = all[i].kunci()
				}
				if all[i].AppProperties["id"] != "" && (tb == nil || all[i].waktu() > tb.waktu()) {
					tb = &all[i]
				}
			}
			if tb != nil {
				diterima = tb.kunci()
			}
		}
	}
	a.st.mu.Lock()
	a.st.backupSebelum("pulihkan-drive")
	a.st.d = d
	a.st.rapikan()
	err = a.st.save()
	a.st.mu.Unlock()
	if err != nil {
		fail(w, 500, err.Error())
		return
	}
	g.mu.Lock()
	g.cfg.Konflik, g.cfg.Diterima, g.cfg.LastError = nil, diterima, ""
	g.cfg.LastUp = asalKunci
	g.simpan()
	g.mu.Unlock()
	// akun pengguna ikut dipulihkan: semua harus masuk ulang
	a.sessMu.Lock()
	a.sessions = map[string]session{}
	a.sessMu.Unlock()
	writeJSON(w, 200, map[string]any{"ok": true, "transaksi": len(d.Transaksi), "lampiran": nl})
}
