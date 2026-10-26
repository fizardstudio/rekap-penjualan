package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

type Settings struct {
	NamaUsaha string  `json:"namaUsaha"`
	PPN       float64 `json:"ppn"`
	PPh22     float64 `json:"pph22"`
	PPh23     float64 `json:"pph23"`
	Dibuat    string  `json:"dibuat"`
}

type CV struct {
	Kode     string `json:"kode"`
	Nama     string `json:"nama"`
	NPWP     string `json:"npwp"`
	Alamat   string `json:"alamat"`
	Direktur string `json:"direktur"`
	FormatSJ string `json:"formatSJ"`
}

type Satker struct {
	ID         int      `json:"id"`
	Nama       string   `json:"nama"`
	Singkat    string   `json:"singkat"`
	Grup       string   `json:"grup"`
	KodeKantah string   `json:"kodeKantah"`
	KodeSatker string   `json:"kodeSatker"`        // kode satker Kemenkeu / Digipay (6 digit awal No. Invoice)
	KodeBPN    string   `json:"kodeBPN,omitempty"` // kode satker BPN, format 55-32.06-00
	Wapu       bool     `json:"wapu"`
	Alias      []string `json:"alias,omitempty"`
}

type Barang struct {
	ID     int      `json:"id"`
	Kode   string   `json:"kode"`
	Nama   string   `json:"nama"`
	Merk   string   `json:"merk"`
	Satuan string   `json:"satuan"`
	Harga  float64  `json:"harga"`
	Jenis  string   `json:"jenis"` // B = barang (PPh 22), J = jasa (PPh 23)
	Alias  []string `json:"alias,omitempty"`
}

type Item struct {
	BarangID int     `json:"barangId"`
	Nama     string  `json:"nama"`
	Qty      float64 `json:"qty"`
	Satuan   string  `json:"satuan"`
	Harga    float64 `json:"harga"`
	Jenis    string  `json:"jenis"`
}

type Transaksi struct {
	ID          int      `json:"id"`
	CV          string   `json:"cv"`
	Kanal       string   `json:"kanal"`
	SatkerID    int      `json:"satkerId"`
	Tanggal     string   `json:"tanggal"`
	NoTrx       string   `json:"noTrx"`
	NoDok       string   `json:"noDok,omitempty"`
	KodeAkun    string   `json:"kodeAkun,omitempty"`
	NoSJ        string   `json:"noSJ,omitempty"`
	PPK         string   `json:"ppk,omitempty"`
	Pemesan     string   `json:"pemesan,omitempty"`
	MetodeBayar string   `json:"metodeBayar,omitempty"`
	RUP         string   `json:"rup,omitempty"`
	SumberDana  string   `json:"sumberDana,omitempty"`
	NamaPaket   string   `json:"namaPaket,omitempty"`
	NoQuotation string   `json:"noQuotation,omitempty"`
	TglSP       string   `json:"tglSP,omitempty"`
	TglBAST     string   `json:"tglBAST,omitempty"`
	TglKirim    string   `json:"tglKirim,omitempty"`
	TglBayar    string   `json:"tglBayar,omitempty"`
	NoBayar     string   `json:"noBayar,omitempty"`
	TipeBayar   string   `json:"tipeBayar,omitempty"`
	Status      string   `json:"status"`
	InclPPN     bool     `json:"inclPPN"`
	NoPPN       bool     `json:"noPPN,omitempty"`   // PPN tidak dikenakan
	NoPPh22     bool     `json:"noPPh22,omitempty"` // PPh 22 tidak dipotong
	NoPPh23     bool     `json:"noPPh23,omitempty"` // PPh 23 tidak dipotong
	Wapu        *bool    `json:"wapu,omitempty"`
	PlatformFee float64  `json:"platformFee,omitempty"`
	Items       []Item   `json:"items"`
	Lampiran    []string `json:"lampiran,omitempty"`
	Catatan     string   `json:"catatan,omitempty"`
	Dibuat      string   `json:"dibuat,omitempty"`
	DibuatOleh  string   `json:"dibuatOleh,omitempty"`
	Diubah      string   `json:"diubah,omitempty"`
	DiubahOleh  string   `json:"diubahOleh,omitempty"`
}

type User struct {
	ID       int    `json:"id"`
	Nama     string `json:"nama"`
	Username string `json:"username"`
	Role     string `json:"role"`
	Aktif    bool   `json:"aktif"`
	Salt     string `json:"salt"`
	Hash     string `json:"hash"`
}

type Data struct {
	Settings  Settings    `json:"settings"`
	CV        []CV        `json:"cv"`
	Satker    []Satker    `json:"satker"`
	Barang    []Barang    `json:"barang"`
	Transaksi []Transaksi `json:"transaksi"`
	Terhapus  []Transaksi `json:"terhapus"`
	Users     []User      `json:"users"`
	Meta      DataMeta    `json:"meta"`
}

// DataMeta: penanda versi data, dipakai untuk mencegah backup lama menimpa backup yang lebih baru.
type DataMeta struct {
	ID     string `json:"id"`     // ID "garis keturunan" data (dibuat sekali saat setup, ikut bila folder data disalin)
	Rev    int64  `json:"rev"`    // bertambah setiap kali data disimpan
	Diubah string `json:"diubah"` // waktu simpan terakhir (RFC3339)
	PC     string `json:"pc"`     // nama komputer yang terakhir menyimpan
}

type Store struct {
	mu   sync.Mutex
	dir  string
	path string
	d    Data
	ok   bool // sudah setup
}

func defaultCV() []CV {
	return []CV{
		{Kode: "PKM", Nama: "CV. PELITA KASIH MULIA", FormatSJ: "S{MM}{YY}-20{NN}"},
		{Kode: "OSI", Nama: "CV. ONIX STATIONERY IDEAL", NPWP: "071.675.461.9-422.000", Direktur: "ANTON HERIADI HALIM",
			Alamat: "JL. SENDI KENCANA C-11 KEL. SUKAASIH KEC. BOJONGLOA KALER KOTA BANDUNG 40231", FormatSJ: "S{MM}{YY}-20{NN}"},
		{Kode: "DKS", Nama: "CV. DAKSA KARYA SAHAJA", FormatSJ: "S{MM}{YY}-20{NN}"},
	}
}

func openStore(dir string) (*Store, error) {
	if err := os.MkdirAll(filepath.Join(dir, "backups"), 0o755); err != nil {
		return nil, err
	}
	_ = os.MkdirAll(filepath.Join(dir, "lampiran"), 0o755)
	s := &Store{dir: dir, path: filepath.Join(dir, "data.json")}
	b, err := os.ReadFile(s.path)
	if errors.Is(err, os.ErrNotExist) {
		s.d = Data{Settings: Settings{PPN: 11, PPh22: 1.5, PPh23: 2}, CV: defaultCV()}
		return s, nil
	}
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(b, &s.d); err != nil {
		return nil, fmt.Errorf("data.json rusak: %w (pulihkan dari folder backups)", err)
	}
	s.ok = len(s.d.Users) > 0
	s.rapikan()
	if s.ok && s.d.Meta.ID == "" { // data dari versi lama: beri kode data sekali
		_ = s.save()
	}
	s.backupHarian()
	return s, nil
}

var kodeWilayah = regexp.MustCompile(`^\d{2}\.\d{2}$`)

func namaPC() string {
	if v := os.Getenv("REKAP_PC"); v != "" { // untuk pengujian
		return v
	}
	h, err := os.Hostname()
	if err != nil || h == "" {
		return "komputer"
	}
	return h
}

func (s *Store) rapikan() {
	if s.d.Settings.PPN == 0 {
		s.d.Settings.PPN = 11
	}
	if s.d.Settings.PPh22 == 0 {
		s.d.Settings.PPh22 = 1.5
	}
	if s.d.Settings.PPh23 == 0 {
		s.d.Settings.PPh23 = 2
	}
	if len(s.d.CV) == 0 {
		s.d.CV = defaultCV()
	}
	// kode satker BPN = 55-<kode wilayah Kemendagri>-00, mis. Kab. Tasikmalaya 32.06 -> 55-32.06-00
	for i := range s.d.Satker {
		st := &s.d.Satker[i]
		if st.Grup != "BPN" || st.KodeBPN != "" {
			continue
		}
		kk := strings.TrimSpace(st.KodeKantah)
		if kodeWilayah.MatchString(kk) {
			st.KodeBPN = "55-" + kk + "-00"
		} else if kk == "32.01A" {
			st.KodeBPN = "55-32.01-00"
		}
	}
	// daftar kosong harus [] (bukan null) supaya tampilan tidak error pada instalasi baru tanpa data
	if s.d.Transaksi == nil {
		s.d.Transaksi = []Transaksi{}
	}
	if s.d.Terhapus == nil {
		s.d.Terhapus = []Transaksi{}
	}
	if s.d.Satker == nil {
		s.d.Satker = []Satker{}
	}
	if s.d.Barang == nil {
		s.d.Barang = []Barang{}
	}
	for i := range s.d.Transaksi {
		if s.d.Transaksi[i].Items == nil {
			s.d.Transaksi[i].Items = []Item{}
		}
	}
}

// save harus dipanggil saat mu terkunci.
func (s *Store) save() error {
	if s.d.Meta.ID == "" {
		s.d.Meta.ID = randHex(4)
	}
	s.d.Meta.Rev++
	s.d.Meta.Diubah = time.Now().Format(time.RFC3339)
	s.d.Meta.PC = namaPC()
	b, err := json.MarshalIndent(&s.d, "", " ")
	if err != nil {
		return err
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, b, 0o644); err != nil {
		return err
	}
	if err := os.Rename(tmp, s.path); err != nil {
		return err
	}
	s.backupHarian()
	return nil
}

func (s *Store) backupHarian() {
	b, err := os.ReadFile(s.path)
	if err != nil {
		return
	}
	name := filepath.Join(s.dir, "backups", "data-"+time.Now().Format("2006-01-02")+".json")
	_ = os.WriteFile(name, b, 0o644)
	// simpan 45 backup terakhir
	files, _ := filepath.Glob(filepath.Join(s.dir, "backups", "data-*.json"))
	sort.Strings(files)
	for len(files) > 45 {
		_ = os.Remove(files[0])
		files = files[1:]
	}
}

func (s *Store) backupSebelum(alasan string) {
	b, err := os.ReadFile(s.path)
	if err != nil {
		return
	}
	name := filepath.Join(s.dir, "backups", "sebelum-"+alasan+"-"+time.Now().Format("20060102-150405")+".json")
	_ = os.WriteFile(name, b, 0o644)
}

func nextID[T any](list []T, id func(T) int) int {
	m := 0
	for _, x := range list {
		if v := id(x); v > m {
			m = v
		}
	}
	return m + 1
}

func addAlias(alias []string, nama string, utama string) []string {
	n := strings.TrimSpace(nama)
	if n == "" || strings.EqualFold(n, utama) {
		return alias
	}
	for _, a := range alias {
		if strings.EqualFold(a, n) {
			return alias
		}
	}
	if len(alias) >= 20 {
		alias = alias[1:]
	}
	return append(alias, n)
}
