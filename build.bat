@echo off
rem Build ulang RekapPenjualan.exe (butuh Go 1.24+ terpasang: https://go.dev/dl/)
cd /d "%~dp0"
go build -trimpath -ldflags "-s -w" -o dist\RekapPenjualan\RekapPenjualan.exe .
if errorlevel 1 (echo GAGAL & pause & exit /b 1)
copy /y dist\BACA-DULU.txt dist\RekapPenjualan\ >nul
echo Selesai: dist\RekapPenjualan\RekapPenjualan.exe
pause
