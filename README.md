# Rekap Penjualan Instansi (2ndappbantex)

Aplikasi web lokal (Go 1.24, hanya standard library) untuk mencatat & merekap transaksi
CV. PKM / CV. OSI / CV. DKS dari Digipay, INAPROC (Katalog v6), dan Mbizmarket.
Satu file `.exe`, tampilan di browser, data di `data/data.json` + backup harian + `data/lampiran/`.

## Struktur
| File | Isi |
|---|---|
| `main.go` | server, flag `-data` `-port` `-no-browser`, buka browser |
| `store.go` | model data, simpan JSON atomik, backup harian |
| `api.go` | login (PBKDF2), sesi, API transaksi/master/pengguna/lampiran/backup |
| `gdrive.go` | backup Google Drive (+ pengaman konflik: Meta id/rev di data.json, appProperties id/inst/rev/diubah di file Drive, file per data+instalasi, tahan upload bila backup terbaru di Drive bukan kiriman sendiri & tidak lebih lama; pulihkan dari Drive): OAuth Desktop (loopback + PKCE, scope drive.file), upload zip harian resumable, auto backup; token di data/gdrive.json. Endpoint bisa diarahkan ke mock lewat env REKAP_G_* (lihat test/mockgoogle.py) |
| `xlsx.go` | penulis `.xlsx` bergaya (rumus + nilai tersimpan) untuk semua ekspor |
| `seed.json` | data awal: 588 barang, 41 satker, 182 transaksi hasil migrasi Excel |
| `web/app.js` | seluruh tampilan + hitung pajak + rekap + spesifikasi ekspor |
| `web/dashboard.js` | halaman Dashboard: grafik SVG buatan sendiri (kolom bertumpuk, garis, batang), tooltip |
| `web/gdrive.js` | indikator Google Drive di bar atas + bagian Pengaturan |
| `web/parsers.js` | parser PDF INAPROC & Mbizmarket (pdf.js) dan teks tempel Digipay |
| `web/vendor/` | pdf.js 4.10.38, SheetJS 0.18.5 (offline) |
| `tools/migrate.py` | migrasi Excel lama → `seed.json` (`python migrate.py <folder Bahan> seed.json`) |
| `tools/verify.py` | cek total migrasi vs nilai tersimpan di Excel |

## Build
`build.bat` (Windows) atau `GOOS=windows GOARCH=amd64 go build -trimpath -ldflags "-s -w" -o RekapPenjualan.exe .`

## Rumus pajak (`hitung()` di app.js)
- Harga barang di transaksi = harga sebelum PPN (exclude): PPN = 11% × DPP. Opsi `inclPPN` (centang manual) bila harga dokumen sudah termasuk PPN: DPP = harga/1,11.
- Harga master barang = harga instansi (termasuk PPN); saat dipilih di transaksi otomatis dipakai harga exclude (harga/1,11).
- PPh 22 = 1,5% × DPP barang, PPh 23 = 2% × DPP jasa (per baris, kolom Jenis).
- Per transaksi: `noPPN`, `noPPh22`, `noPPh23` (true = tidak dikenakan; default semua dikenakan).
- Bersih = total − PPN (bila instansi WAPU) − PPh − platform fee.
Diuji terhadap dokumen asli: INAPROC EP-01M4QP… (PPN 8.057.139, total 81.303.857) dan
Mbizmarket PO-190917-260811-1 (PPh 22 675.674, penghasilan 43.244.230) — cocok sampai rupiah.

## Pembaruan
- v1.1.0: semua nominal "Rp x,00"; kotak pajak (Kenakan PPN / Kenakan PPh); kanal Manual & Hutang; rincian barang & pengiriman bertahap (`kirim` per transaksi, kode baris `k`, endpoint `/api/transaksi/kirim`, nilai terkirim terpisah dari invoice); Excel rincian per CV-kanal; Kantah BPN bisa diklik; barang baru dari transaksi bisa langsung masuk master.
- Perbaikan data otomatis (`perbaikiData`, `settings.versiData`, backup `sebelum-perbaikan-data-*` dibuat dulu): v1 = 8 transaksi migrasi yang di Excel BELANJA BPN 2025 ditandai HUTANG menjadi kanal Hutang (muncul di "Perlu ditagih"); v2 = semua transaksi dihitung harga exclude.
- Jeda backup Google Drive bisa diatur admin (cepat / normal / hemat / harian / manual), field `jeda` di `data/gdrive.json`.
- Logo kanal (`web/img/kanal-*.png`) dan logo CV (`web/img/cv-*.png`) tampil di pilihan dan badge. Logo CV baru: tambah file `cv-KODE.png` (64x64) dan kodenya di `CV_LOGO` (web/app.js).

## Catatan repositori
- Folder `Bahan/` (Excel/PDF asli dari pelanggan) dan `data/` tidak masuk repo. `seed.json` sudah berisi hasil migrasinya.
- Client ID Google Drive tidak ditanam di exe: diisi lewat menu Pengaturan > Backup Google Drive (tersimpan di `data/gdrive.json`).
- Build: `build.bat` (Windows) atau `GOOS=windows GOARCH=amd64 go build -ldflags "-s -w" -o RekapPenjualan.exe .`
- Exe & panduan terbaru disimpan di `E:\APP PROJECT\Project GO\Paket-untuk-Rekap\RekapPenjualan\`.
