// Rekap Penjualan Instansi — pencatatan & rekap transaksi CV. PKM, CV. OSI, CV. DKS
// dari kanal Digipay, INAPROC (Katalog v6), dan Mbizmarket.
// Satu file .exe: server web lokal + tampilan di browser. Data di folder "data".
package main

import (
	"embed"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

const versi = "1.1.0"

//go:embed web
var webFS embed.FS

var port int

func main() {
	exe, _ := os.Executable()
	defDir := filepath.Join(filepath.Dir(exe), "data")
	dataDir := flag.String("data", defDir, "folder data")
	flag.IntVar(&port, "port", 8070, "port web")
	noOpen := flag.Bool("no-browser", false, "jangan buka browser otomatis")
	flag.Parse()

	fmt.Println("==============================================")
	fmt.Println(" REKAP PENJUALAN INSTANSI  v" + versi)
	fmt.Println(" PKM / OSI / DKS  -  Digipay / INAPROC / Mbizmarket")
	fmt.Println("==============================================")

	addr := fmt.Sprintf(":%d", port)
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		// kemungkinan aplikasi sudah berjalan: cukup buka browser
		fmt.Println("Port", port, "sudah dipakai. Aplikasi mungkin sudah berjalan, membuka browser...")
		openBrowser(fmt.Sprintf("http://localhost:%d", port))
		time.Sleep(3 * time.Second)
		return
	}

	st, err := openStore(*dataDir)
	if err != nil {
		fmt.Println("GAGAL membuka data:", err)
		fmt.Println("Tekan Enter untuk keluar.")
		fmt.Scanln()
		os.Exit(1)
	}
	app := newApp(st)
	go app.gd.loop()
	mux := http.NewServeMux()
	app.routes(mux)
	sub, _ := fs.Sub(webFS, "web")
	files := http.FileServer(http.FS(sub))
	mux.Handle("/", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, ".mjs") {
			w.Header().Set("Content-Type", "text/javascript; charset=utf-8")
		}
		if r.URL.Path == "/" || strings.HasSuffix(r.URL.Path, ".html") {
			w.Header().Set("Cache-Control", "no-cache")
		}
		files.ServeHTTP(w, r)
	}))

	fmt.Println("Data disimpan di:", *dataDir)
	fmt.Printf("Buka di komputer ini : http://localhost:%d\n", port)
	for _, a := range lanAddrs(port) {
		fmt.Println("Buka dari komputer lain (jaringan sama):", a)
	}
	fmt.Println("JANGAN tutup jendela ini selama aplikasi dipakai.")
	if !*noOpen {
		go func() {
			time.Sleep(600 * time.Millisecond)
			openBrowser(fmt.Sprintf("http://localhost:%d", port))
		}()
	}
	srv := &http.Server{Handler: logReq(mux), ReadHeaderTimeout: 15 * time.Second}
	log.Fatal(srv.Serve(ln))
}

func logReq(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "SAMEORIGIN")
		h.ServeHTTP(w, r)
	})
}

func lanAddrs(p int) []string {
	var out []string
	ifs, _ := net.Interfaces()
	for _, i := range ifs {
		if i.Flags&net.FlagUp == 0 || i.Flags&net.FlagLoopback != 0 {
			continue
		}
		addrs, _ := i.Addrs()
		for _, a := range addrs {
			if ipn, ok := a.(*net.IPNet); ok && ipn.IP.To4() != nil && ipn.IP.IsPrivate() {
				out = append(out, fmt.Sprintf("http://%s:%d", ipn.IP.String(), p))
			}
		}
	}
	return out
}

func openBrowser(url string) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	case "darwin":
		cmd = exec.Command("open", url)
	default:
		cmd = exec.Command("xdg-open", url)
	}
	_ = cmd.Start()
}
