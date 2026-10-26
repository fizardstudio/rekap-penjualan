package main

import (
	"crypto/pbkdf2"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

//go:embed seed.json
var seedJSON []byte

const cookieName = "rekap_sesi"

type session struct {
	userID int
	exp    time.Time
}

type App struct {
	st       *Store
	gd       *gDrive
	sessMu   sync.Mutex
	sessions map[string]session
	fails    map[string][]time.Time
}

func newApp(st *Store) *App {
	return &App{st: st, gd: newGDrive(st), sessions: map[string]session{}, fails: map[string][]time.Time{}}
}

func hashPw(pw, saltHex string) string {
	salt, _ := hex.DecodeString(saltHex)
	k, _ := pbkdf2.Key(sha256.New, pw, salt, 120000, 32)
	return hex.EncodeToString(k)
}

func randHex(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func fail(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}

func readJSON(r *http.Request, v any) error {
	dec := json.NewDecoder(io.LimitReader(r.Body, 50<<20))
	return dec.Decode(v)
}

func now() string { return time.Now().Format("2006-01-02 15:04") }

// currentUser mengembalikan salinan user dari sesi (nil bila belum login).
func (a *App) currentUser(r *http.Request) *User {
	c, err := r.Cookie(cookieName)
	if err != nil {
		return nil
	}
	a.sessMu.Lock()
	s, ok := a.sessions[c.Value]
	if ok && time.Now().After(s.exp) {
		delete(a.sessions, c.Value)
		ok = false
	}
	if ok {
		s.exp = time.Now().Add(12 * time.Hour)
		a.sessions[c.Value] = s
	}
	a.sessMu.Unlock()
	if !ok {
		return nil
	}
	a.st.mu.Lock()
	defer a.st.mu.Unlock()
	for _, u := range a.st.d.Users {
		if u.ID == s.userID && u.Aktif {
			uu := u
			return &uu
		}
	}
	return nil
}

type handler func(w http.ResponseWriter, r *http.Request, u *User)

func (a *App) auth(admin bool, h handler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		u := a.currentUser(r)
		if u == nil {
			fail(w, 401, "Silakan masuk dulu.")
			return
		}
		if admin && u.Role != "admin" {
			fail(w, 403, "Hanya admin yang boleh melakukan ini.")
			return
		}
		if r.Method == http.MethodPost && !sameOrigin(r) {
			fail(w, 403, "Permintaan ditolak.")
			return
		}
		h(w, r, u)
	}
}

func sameOrigin(r *http.Request) bool {
	o := r.Header.Get("Origin")
	if o == "" {
		return true
	}
	return strings.TrimPrefix(strings.TrimPrefix(o, "http://"), "https://") == r.Host
}

func (a *App) routes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/status", a.status)
	mux.HandleFunc("POST /api/setup", a.setup)
	mux.HandleFunc("POST /api/login", a.login)
	mux.HandleFunc("POST /api/logout", a.logout)
	mux.HandleFunc("GET /api/state", a.auth(false, a.state))
	mux.HandleFunc("POST /api/transaksi", a.auth(false, a.saveTransaksi))
	mux.HandleFunc("POST /api/transaksi/hapus", a.auth(true, a.hapusTransaksi))
	mux.HandleFunc("POST /api/transaksi/pulihkan", a.auth(true, a.pulihkanTransaksi))
	mux.HandleFunc("POST /api/satker", a.auth(false, a.saveSatker))
	mux.HandleFunc("POST /api/satker/hapus", a.auth(true, a.hapusSatker))
	mux.HandleFunc("POST /api/barang", a.auth(false, a.saveBarang))
	mux.HandleFunc("POST /api/barang/hapus", a.auth(true, a.hapusBarang))
	mux.HandleFunc("POST /api/barang/impor", a.auth(true, a.imporBarang))
	mux.HandleFunc("POST /api/settings", a.auth(true, a.saveSettings))
	mux.HandleFunc("POST /api/cv", a.auth(true, a.saveCV))
	mux.HandleFunc("POST /api/user", a.auth(true, a.saveUser))
	mux.HandleFunc("POST /api/password", a.auth(false, a.gantiPassword))
	mux.HandleFunc("GET /api/backup", a.auth(true, a.downloadBackup))
	mux.HandleFunc("POST /api/restore", a.auth(true, a.restore))
	mux.HandleFunc("POST /api/lampiran", a.auth(false, a.uploadLampiran))
	mux.HandleFunc("POST /api/lampiran/hapus", a.auth(false, a.hapusLampiran))
	mux.HandleFunc("GET /lampiran/{name}", a.auth(false, a.lihatLampiran))
	mux.HandleFunc("POST /api/xlsx", a.auth(false, a.exportXLSX))
	mux.HandleFunc("GET /api/gdrive/status", a.auth(false, a.gdStatus))
	mux.HandleFunc("POST /api/gdrive/backup", a.auth(false, a.gdBackup))
	mux.HandleFunc("POST /api/gdrive/config", a.auth(true, a.gdConfig))
	mux.HandleFunc("POST /api/gdrive/disconnect", a.auth(true, a.gdDisconnect))
	mux.HandleFunc("GET /api/gdrive/login", a.auth(true, a.gdLogin))
	mux.HandleFunc("GET /oauth/google", a.gdCallback)
	mux.HandleFunc("POST /api/gdrive/lanjut", a.auth(true, a.gdLanjut))
	mux.HandleFunc("GET /api/gdrive/daftar", a.auth(true, a.gdDaftar))
	mux.HandleFunc("POST /api/gdrive/pulihkan", a.auth(true, a.gdPulihkan))
}

func (a *App) status(w http.ResponseWriter, r *http.Request) {
	a.st.mu.Lock()
	ok := a.st.ok
	nama := a.st.d.Settings.NamaUsaha
	a.st.mu.Unlock()
	u := a.currentUser(r)
	res := map[string]any{"setup": ok, "namaUsaha": nama, "alamat": lanAddrs(port)}
	if u != nil {
		res["user"] = map[string]any{"id": u.ID, "nama": u.Nama, "username": u.Username, "role": u.Role}
	}
	writeJSON(w, 200, res)
}

func (a *App) startSession(w http.ResponseWriter, userID int) {
	tok := randHex(24)
	a.sessMu.Lock()
	a.sessions[tok] = session{userID: userID, exp: time.Now().Add(12 * time.Hour)}
	a.sessMu.Unlock()
	http.SetCookie(w, &http.Cookie{Name: cookieName, Value: tok, Path: "/", HttpOnly: true, SameSite: http.SameSiteLaxMode})
}

func (a *App) setup(w http.ResponseWriter, r *http.Request) {
	var in struct {
		NamaUsaha string `json:"namaUsaha"`
		Nama      string `json:"nama"`
		Username  string `json:"username"`
		Password  string `json:"password"`
		DataLama  bool   `json:"dataLama"`
	}
	if err := readJSON(r, &in); err != nil {
		fail(w, 400, "Data tidak valid.")
		return
	}
	in.Username = strings.ToLower(strings.TrimSpace(in.Username))
	if in.Nama == "" || in.Username == "" || len(in.Password) < 6 {
		fail(w, 400, "Nama, username, dan kata sandi (minimal 6 karakter) wajib diisi.")
		return
	}
	a.st.mu.Lock()
	defer a.st.mu.Unlock()
	if a.st.ok {
		fail(w, 400, "Aplikasi sudah disiapkan.")
		return
	}
	var seed struct {
		Barang    []Barang    `json:"barang"`
		Satker    []Satker    `json:"satker"`
		Transaksi []Transaksi `json:"transaksi"`
	}
	_ = json.Unmarshal(seedJSON, &seed)
	a.st.d.Barang = seed.Barang
	a.st.d.Satker = seed.Satker
	if in.DataLama {
		for i := range seed.Transaksi {
			seed.Transaksi[i].Dibuat = now()
			seed.Transaksi[i].DibuatOleh = "migrasi"
		}
		a.st.d.Transaksi = seed.Transaksi
	}
	a.st.d.Settings.NamaUsaha = strings.TrimSpace(in.NamaUsaha)
	if a.st.d.Settings.NamaUsaha == "" {
		a.st.d.Settings.NamaUsaha = "Rekap Penjualan Instansi"
	}
	a.st.d.Settings.Dibuat = time.Now().Format("2006-01-02")
	salt := randHex(16)
	a.st.d.Users = []User{{ID: 1, Nama: strings.TrimSpace(in.Nama), Username: in.Username, Role: "admin", Aktif: true,
		Salt: salt, Hash: hashPw(in.Password, salt)}}
	a.st.rapikan()
	if err := a.st.save(); err != nil {
		fail(w, 500, "Gagal menyimpan: "+err.Error())
		return
	}
	a.st.ok = true
	a.startSession(w, 1)
	writeJSON(w, 200, map[string]bool{"ok": true})
}

func (a *App) login(w http.ResponseWriter, r *http.Request) {
	var in struct{ Username, Password string }
	if err := readJSON(r, &in); err != nil {
		fail(w, 400, "Data tidak valid.")
		return
	}
	ip := strings.Split(r.RemoteAddr, ":")[0]
	a.sessMu.Lock()
	var recent []time.Time
	for _, t := range a.fails[ip] {
		if time.Since(t) < 5*time.Minute {
			recent = append(recent, t)
		}
	}
	a.fails[ip] = recent
	a.sessMu.Unlock()
	if len(recent) >= 8 {
		fail(w, 429, "Terlalu banyak percobaan. Coba lagi 5 menit lagi.")
		return
	}
	uname := strings.ToLower(strings.TrimSpace(in.Username))
	a.st.mu.Lock()
	var found *User
	for _, u := range a.st.d.Users {
		if u.Username == uname && u.Aktif {
			uu := u
			found = &uu
		}
	}
	a.st.mu.Unlock()
	if found == nil || subtle.ConstantTimeCompare([]byte(hashPw(in.Password, found.Salt)), []byte(found.Hash)) != 1 {
		a.sessMu.Lock()
		a.fails[ip] = append(a.fails[ip], time.Now())
		a.sessMu.Unlock()
		fail(w, 401, "Username atau kata sandi salah.")
		return
	}
	a.startSession(w, found.ID)
	writeJSON(w, 200, map[string]bool{"ok": true})
}

func (a *App) logout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(cookieName); err == nil {
		a.sessMu.Lock()
		delete(a.sessions, c.Value)
		a.sessMu.Unlock()
	}
	http.SetCookie(w, &http.Cookie{Name: cookieName, Value: "", Path: "/", MaxAge: -1})
	writeJSON(w, 200, map[string]bool{"ok": true})
}

func (a *App) state(w http.ResponseWriter, r *http.Request, u *User) {
	a.st.mu.Lock()
	defer a.st.mu.Unlock()
	users := make([]map[string]any, 0, len(a.st.d.Users))
	for _, x := range a.st.d.Users {
		users = append(users, map[string]any{"id": x.ID, "nama": x.Nama, "username": x.Username, "role": x.Role, "aktif": x.Aktif})
	}
	writeJSON(w, 200, map[string]any{
		"settings": a.st.d.Settings, "cv": a.st.d.CV, "satker": a.st.d.Satker, "barang": a.st.d.Barang,
		"transaksi": a.st.d.Transaksi, "terhapus": a.st.d.Terhapus, "users": users,
		"me": map[string]any{"id": u.ID, "nama": u.Nama, "username": u.Username, "role": u.Role},
	})
}

func validCV(d *Data, k string) bool {
	for _, c := range d.CV {
		if c.Kode == k {
			return true
		}
	}
	return false
}

func (a *App) saveTransaksi(w http.ResponseWriter, r *http.Request, u *User) {
	var t Transaksi
	if err := readJSON(r, &t); err != nil {
		fail(w, 400, "Data tidak valid: "+err.Error())
		return
	}
	t.NoTrx = strings.TrimSpace(t.NoTrx)
	a.st.mu.Lock()
	defer a.st.mu.Unlock()
	d := &a.st.d
	if !validCV(d, t.CV) {
		fail(w, 400, "Pilih CV.")
		return
	}
	if t.SatkerID == 0 {
		fail(w, 400, "Pilih satker / instansi.")
		return
	}
	if t.Tanggal == "" {
		fail(w, 400, "Tanggal transaksi wajib diisi (dipakai untuk rekap bulanan).")
		return
	}
	if len(t.Items) == 0 {
		fail(w, 400, "Isi minimal satu barang.")
		return
	}
	for i := range t.Items {
		it := &t.Items[i]
		it.Nama = strings.TrimSpace(it.Nama)
		if it.Jenis != "J" {
			it.Jenis = "B"
		}
		if it.Nama == "" || it.Qty <= 0 {
			fail(w, 400, fmt.Sprintf("Barang baris %d: nama dan jumlah wajib diisi.", i+1))
			return
		}
	}
	// nomor transaksi tidak boleh dobel untuk kanal yang sama
	if t.NoTrx != "" {
		for _, x := range d.Transaksi {
			if x.ID != t.ID && x.Kanal == t.Kanal && strings.EqualFold(x.NoTrx, t.NoTrx) {
				fail(w, 409, "Nomor "+t.NoTrx+" sudah tercatat (transaksi tanggal "+x.Tanggal+"). Buka transaksi itu untuk mengubahnya.")
				return
			}
		}
	}
	if t.ID == 0 {
		t.ID = nextID(append(d.Transaksi, d.Terhapus...), func(x Transaksi) int { return x.ID })
		t.Dibuat, t.DibuatOleh = now(), u.Nama
		d.Transaksi = append(d.Transaksi, t)
	} else {
		idx := -1
		for i, x := range d.Transaksi {
			if x.ID == t.ID {
				idx = i
			}
		}
		if idx < 0 {
			fail(w, 404, "Transaksi tidak ditemukan.")
			return
		}
		old := d.Transaksi[idx]
		t.Dibuat, t.DibuatOleh, t.Lampiran = old.Dibuat, old.DibuatOleh, old.Lampiran
		t.Diubah, t.DiubahOleh = now(), u.Nama
		d.Transaksi[idx] = t
	}
	// pelajari nama katalog -> master barang (alias) agar impor berikutnya langsung cocok
	for _, it := range t.Items {
		if it.BarangID == 0 {
			continue
		}
		for i := range d.Barang {
			if d.Barang[i].ID == it.BarangID {
				d.Barang[i].Alias = addAlias(d.Barang[i].Alias, it.Nama, d.Barang[i].Nama)
			}
		}
	}
	if err := a.st.save(); err != nil {
		fail(w, 500, "Gagal menyimpan: "+err.Error())
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true, "id": t.ID})
}

func (a *App) hapusTransaksi(w http.ResponseWriter, r *http.Request, u *User) {
	var in struct{ ID int }
	_ = readJSON(r, &in)
	a.st.mu.Lock()
	defer a.st.mu.Unlock()
	d := &a.st.d
	for i, x := range d.Transaksi {
		if x.ID == in.ID {
			x.Diubah, x.DiubahOleh = now(), u.Nama+" (hapus)"
			d.Terhapus = append(d.Terhapus, x)
			d.Transaksi = append(d.Transaksi[:i], d.Transaksi[i+1:]...)
			_ = a.st.save()
			writeJSON(w, 200, map[string]bool{"ok": true})
			return
		}
	}
	fail(w, 404, "Transaksi tidak ditemukan.")
}

func (a *App) pulihkanTransaksi(w http.ResponseWriter, r *http.Request, u *User) {
	var in struct{ ID int }
	_ = readJSON(r, &in)
	a.st.mu.Lock()
	defer a.st.mu.Unlock()
	d := &a.st.d
	for i, x := range d.Terhapus {
		if x.ID == in.ID {
			d.Transaksi = append(d.Transaksi, x)
			d.Terhapus = append(d.Terhapus[:i], d.Terhapus[i+1:]...)
			_ = a.st.save()
			writeJSON(w, 200, map[string]bool{"ok": true})
			return
		}
	}
	fail(w, 404, "Tidak ditemukan.")
}

func (a *App) saveSatker(w http.ResponseWriter, r *http.Request, u *User) {
	var s Satker
	if err := readJSON(r, &s); err != nil || strings.TrimSpace(s.Nama) == "" {
		fail(w, 400, "Nama satker wajib diisi.")
		return
	}
	s.Nama = strings.ToUpper(strings.TrimSpace(s.Nama))
	s.KodeSatker = strings.TrimSpace(s.KodeSatker)
	a.st.mu.Lock()
	defer a.st.mu.Unlock()
	d := &a.st.d
	for _, x := range d.Satker {
		if x.ID != s.ID && s.KodeSatker != "" && x.KodeSatker == s.KodeSatker {
			fail(w, 409, "Kode satker "+s.KodeSatker+" sudah dipakai oleh "+x.Nama+".")
			return
		}
	}
	if s.ID == 0 {
		s.ID = nextID(d.Satker, func(x Satker) int { return x.ID })
		d.Satker = append(d.Satker, s)
	} else {
		for i := range d.Satker {
			if d.Satker[i].ID == s.ID {
				d.Satker[i] = s
			}
		}
	}
	_ = a.st.save()
	writeJSON(w, 200, map[string]any{"ok": true, "id": s.ID})
}

func (a *App) hapusSatker(w http.ResponseWriter, r *http.Request, u *User) {
	var in struct{ ID int }
	_ = readJSON(r, &in)
	a.st.mu.Lock()
	defer a.st.mu.Unlock()
	d := &a.st.d
	for _, t := range d.Transaksi {
		if t.SatkerID == in.ID {
			fail(w, 400, "Satker ini masih dipakai di transaksi, tidak bisa dihapus.")
			return
		}
	}
	for i, x := range d.Satker {
		if x.ID == in.ID {
			d.Satker = append(d.Satker[:i], d.Satker[i+1:]...)
			break
		}
	}
	_ = a.st.save()
	writeJSON(w, 200, map[string]bool{"ok": true})
}

func (a *App) saveBarang(w http.ResponseWriter, r *http.Request, u *User) {
	var b Barang
	if err := readJSON(r, &b); err != nil || strings.TrimSpace(b.Nama) == "" {
		fail(w, 400, "Nama barang wajib diisi.")
		return
	}
	b.Nama = strings.ToUpper(strings.Join(strings.Fields(b.Nama), " "))
	if b.Jenis != "J" {
		b.Jenis = "B"
	}
	a.st.mu.Lock()
	defer a.st.mu.Unlock()
	d := &a.st.d
	if b.ID == 0 {
		b.ID = nextID(d.Barang, func(x Barang) int { return x.ID })
		d.Barang = append(d.Barang, b)
	} else {
		for i := range d.Barang {
			if d.Barang[i].ID == b.ID {
				d.Barang[i] = b
			}
		}
	}
	_ = a.st.save()
	writeJSON(w, 200, map[string]any{"ok": true, "id": b.ID})
}

func (a *App) hapusBarang(w http.ResponseWriter, r *http.Request, u *User) {
	var in struct{ ID int }
	_ = readJSON(r, &in)
	a.st.mu.Lock()
	defer a.st.mu.Unlock()
	d := &a.st.d
	for i, x := range d.Barang {
		if x.ID == in.ID {
			d.Barang = append(d.Barang[:i], d.Barang[i+1:]...)
			break
		}
	}
	_ = a.st.save()
	writeJSON(w, 200, map[string]bool{"ok": true})
}

// imporBarang: tambah baru + perbarui harga/satuan barang yang namanya sama.
func (a *App) imporBarang(w http.ResponseWriter, r *http.Request, u *User) {
	var in struct {
		Barang []Barang `json:"barang"`
	}
	if err := readJSON(r, &in); err != nil {
		fail(w, 400, "Data tidak valid.")
		return
	}
	a.st.mu.Lock()
	defer a.st.mu.Unlock()
	d := &a.st.d
	a.st.backupSebelum("impor-barang")
	// kunci = kode|nama (nama yang sama bisa punya kode berbeda, mis. mouse M-170 & M-185)
	key := func(kode, nama string) string {
		return strings.ToUpper(strings.Join(strings.Fields(kode), " ")) + "|" + strings.ToUpper(strings.Join(strings.Fields(nama), " "))
	}
	idx := map[string]int{}
	byNama := map[string][]int{}
	for i, b := range d.Barang {
		idx[key(b.Kode, b.Nama)] = i
		byNama[strings.ToUpper(b.Nama)] = append(byNama[strings.ToUpper(b.Nama)], i)
	}
	baru, ubah := 0, 0
	for _, b := range in.Barang {
		b.Nama = strings.ToUpper(strings.Join(strings.Fields(b.Nama), " "))
		if b.Nama == "" {
			continue
		}
		if b.Jenis != "J" {
			b.Jenis = "B"
		}
		i, ok := idx[key(b.Kode, b.Nama)]
		if !ok && len(byNama[b.Nama]) == 1 && strings.TrimSpace(d.Barang[byNama[b.Nama][0]].Kode) == "" {
			i, ok = byNama[b.Nama][0], true
		}
		if ok {
			old := d.Barang[i]
			old.Kode, old.Merk, old.Satuan, old.Harga = b.Kode, b.Merk, b.Satuan, b.Harga
			d.Barang[i] = old
			ubah++
		} else {
			b.ID = nextID(d.Barang, func(x Barang) int { return x.ID })
			d.Barang = append(d.Barang, b)
			idx[key(b.Kode, b.Nama)] = len(d.Barang) - 1
			baru++
		}
	}
	_ = a.st.save()
	writeJSON(w, 200, map[string]any{"ok": true, "baru": baru, "ubah": ubah})
}

func (a *App) saveSettings(w http.ResponseWriter, r *http.Request, u *User) {
	var s Settings
	if err := readJSON(r, &s); err != nil {
		fail(w, 400, "Data tidak valid.")
		return
	}
	a.st.mu.Lock()
	defer a.st.mu.Unlock()
	s.Dibuat = a.st.d.Settings.Dibuat
	if s.PPN <= 0 || s.PPh22 < 0 || s.PPh23 < 0 {
		fail(w, 400, "Tarif pajak tidak valid.")
		return
	}
	a.st.d.Settings = s
	_ = a.st.save()
	writeJSON(w, 200, map[string]bool{"ok": true})
}

func (a *App) saveCV(w http.ResponseWriter, r *http.Request, u *User) {
	var c CV
	if err := readJSON(r, &c); err != nil {
		fail(w, 400, "Data tidak valid.")
		return
	}
	a.st.mu.Lock()
	defer a.st.mu.Unlock()
	for i := range a.st.d.CV {
		if a.st.d.CV[i].Kode == c.Kode {
			a.st.d.CV[i] = c
			_ = a.st.save()
			writeJSON(w, 200, map[string]bool{"ok": true})
			return
		}
	}
	fail(w, 404, "CV tidak ditemukan.")
}

func (a *App) saveUser(w http.ResponseWriter, r *http.Request, u *User) {
	var in struct {
		ID       int    `json:"id"`
		Nama     string `json:"nama"`
		Username string `json:"username"`
		Role     string `json:"role"`
		Aktif    bool   `json:"aktif"`
		Password string `json:"password"`
	}
	if err := readJSON(r, &in); err != nil {
		fail(w, 400, "Data tidak valid.")
		return
	}
	in.Username = strings.ToLower(strings.TrimSpace(in.Username))
	if in.Role != "admin" {
		in.Role = "petugas"
	}
	a.st.mu.Lock()
	defer a.st.mu.Unlock()
	d := &a.st.d
	for _, x := range d.Users {
		if x.ID != in.ID && x.Username == in.Username {
			fail(w, 409, "Username sudah dipakai.")
			return
		}
	}
	if in.ID == 0 {
		if in.Nama == "" || in.Username == "" || len(in.Password) < 6 {
			fail(w, 400, "Nama, username, dan kata sandi (min. 6 karakter) wajib diisi.")
			return
		}
		salt := randHex(16)
		d.Users = append(d.Users, User{ID: nextID(d.Users, func(x User) int { return x.ID }), Nama: in.Nama,
			Username: in.Username, Role: in.Role, Aktif: true, Salt: salt, Hash: hashPw(in.Password, salt)})
	} else {
		for i := range d.Users {
			x := &d.Users[i]
			if x.ID != in.ID {
				continue
			}
			if x.ID == u.ID && (!in.Aktif || in.Role != "admin") {
				fail(w, 400, "Anda tidak bisa menonaktifkan / menurunkan akun sendiri.")
				return
			}
			x.Nama, x.Username, x.Role, x.Aktif = in.Nama, in.Username, in.Role, in.Aktif
			if in.Password != "" {
				if len(in.Password) < 6 {
					fail(w, 400, "Kata sandi minimal 6 karakter.")
					return
				}
				x.Salt = randHex(16)
				x.Hash = hashPw(in.Password, x.Salt)
			}
		}
	}
	_ = a.st.save()
	writeJSON(w, 200, map[string]bool{"ok": true})
}

func (a *App) gantiPassword(w http.ResponseWriter, r *http.Request, u *User) {
	var in struct{ Lama, Baru string }
	_ = readJSON(r, &in)
	if len(in.Baru) < 6 {
		fail(w, 400, "Kata sandi baru minimal 6 karakter.")
		return
	}
	a.st.mu.Lock()
	defer a.st.mu.Unlock()
	for i := range a.st.d.Users {
		x := &a.st.d.Users[i]
		if x.ID == u.ID {
			if hashPw(in.Lama, x.Salt) != x.Hash {
				fail(w, 400, "Kata sandi lama salah.")
				return
			}
			x.Salt = randHex(16)
			x.Hash = hashPw(in.Baru, x.Salt)
		}
	}
	_ = a.st.save()
	writeJSON(w, 200, map[string]bool{"ok": true})
}

func (a *App) downloadBackup(w http.ResponseWriter, r *http.Request, u *User) {
	a.st.mu.Lock()
	b, err := os.ReadFile(a.st.path)
	a.st.mu.Unlock()
	if err != nil {
		fail(w, 500, err.Error())
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Content-Disposition", `attachment; filename="backup-rekap-`+time.Now().Format("2006-01-02")+`.json"`)
	_, _ = w.Write(b)
}

func (a *App) restore(w http.ResponseWriter, r *http.Request, u *User) {
	var d Data
	if err := readJSON(r, &d); err != nil || len(d.Users) == 0 {
		fail(w, 400, "File backup tidak valid.")
		return
	}
	a.st.mu.Lock()
	defer a.st.mu.Unlock()
	a.st.backupSebelum("restore")
	// revisi tidak boleh mundur, supaya backup berikutnya tidak dianggap "lebih lama" dari Drive
	lama := a.st.d.Meta
	if d.Meta.ID == "" {
		d.Meta.ID = lama.ID
	}
	if d.Meta.Rev < lama.Rev {
		d.Meta.Rev = lama.Rev
	}
	a.st.d = d
	a.st.rapikan()
	if err := a.st.save(); err != nil {
		fail(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
}

var safeName = regexp.MustCompile(`[^A-Za-z0-9._-]+`)

func (a *App) uploadLampiran(w http.ResponseWriter, r *http.Request, u *User) {
	r.Body = http.MaxBytesReader(w, r.Body, 20<<20)
	if err := r.ParseMultipartForm(20 << 20); err != nil {
		fail(w, 400, "File terlalu besar (maks 20 MB).")
		return
	}
	var id int
	fmt.Sscan(r.FormValue("id"), &id)
	f, hdr, err := r.FormFile("file")
	if err != nil {
		fail(w, 400, "File tidak ada.")
		return
	}
	defer f.Close()
	ext := strings.ToLower(filepath.Ext(hdr.Filename))
	if !map[string]bool{".png": true, ".jpg": true, ".jpeg": true, ".webp": true, ".pdf": true}[ext] {
		fail(w, 400, "Hanya gambar (png/jpg) atau PDF.")
		return
	}
	base := strings.TrimSuffix(filepath.Base(hdr.Filename), filepath.Ext(hdr.Filename))
	base = safeName.ReplaceAllString(base, "_")
	if len(base) > 40 {
		base = base[:40]
	}
	name := fmt.Sprintf("%d_%s_%s%s", id, time.Now().Format("20060102150405"), base, ext)
	a.st.mu.Lock()
	defer a.st.mu.Unlock()
	idx := -1
	for i, t := range a.st.d.Transaksi {
		if t.ID == id {
			idx = i
		}
	}
	if idx < 0 {
		fail(w, 404, "Simpan transaksi dulu sebelum menambah lampiran.")
		return
	}
	out, err := os.Create(filepath.Join(a.st.dir, "lampiran", name))
	if err != nil {
		fail(w, 500, err.Error())
		return
	}
	if _, err := io.Copy(out, f); err != nil {
		out.Close()
		fail(w, 500, err.Error())
		return
	}
	out.Close()
	a.st.d.Transaksi[idx].Lampiran = append(a.st.d.Transaksi[idx].Lampiran, name)
	_ = a.st.save()
	writeJSON(w, 200, map[string]any{"ok": true, "name": name})
}

func (a *App) hapusLampiran(w http.ResponseWriter, r *http.Request, u *User) {
	var in struct {
		ID   int    `json:"id"`
		Name string `json:"name"`
	}
	_ = readJSON(r, &in)
	a.st.mu.Lock()
	defer a.st.mu.Unlock()
	for i, t := range a.st.d.Transaksi {
		if t.ID != in.ID {
			continue
		}
		var keep []string
		for _, n := range t.Lampiran {
			if n != in.Name {
				keep = append(keep, n)
			}
		}
		a.st.d.Transaksi[i].Lampiran = keep
		// file dipindah ke subfolder terhapus, tidak dibuang
		_ = os.MkdirAll(filepath.Join(a.st.dir, "lampiran", "terhapus"), 0o755)
		_ = os.Rename(filepath.Join(a.st.dir, "lampiran", filepath.Base(in.Name)),
			filepath.Join(a.st.dir, "lampiran", "terhapus", filepath.Base(in.Name)))
	}
	_ = a.st.save()
	writeJSON(w, 200, map[string]bool{"ok": true})
}

func (a *App) lihatLampiran(w http.ResponseWriter, r *http.Request, u *User) {
	name := filepath.Base(r.PathValue("name"))
	http.ServeFile(w, r, filepath.Join(a.st.dir, "lampiran", name))
}
