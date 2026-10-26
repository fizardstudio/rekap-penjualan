/* Backup Google Drive: indikator di bar atas (semua halaman), tombol Backup sekarang, dan bagian Pengaturan. */
"use strict";

S.gd = null;
let gdTimer = null;

const GICON = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="#4285f4" d="M15.3 3H8.7l6.6 11.4h6.6z"/><path fill="#0f9d58" d="M8.7 3 2.1 14.4l3.3 5.7L12 8.7z"/><path fill="#f4b400" d="m5.4 20.1h13.2l3.3-5.7H8.7z"/></svg>`;

function waktuRelatif(iso) {
  if (!iso) return "";
  const d = new Date(iso), s = (Date.now() - d) / 1000;
  const jam = d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
  if (s < 60) return "baru saja";
  if (s < 3600) return Math.round(s / 60) + " menit lalu";
  const hariIni = new Date().toDateString() === d.toDateString();
  if (hariIni) return "hari ini " + jam;
  const kemarin = new Date(Date.now() - 864e5).toDateString() === d.toDateString();
  if (kemarin) return "kemarin " + jam;
  return d.toLocaleDateString("id-ID", { day: "2-digit", month: "short" }) + " " + jam;
}

async function gdRefresh() {
  try { S.gd = await api("/api/gdrive/status"); } catch (e) { return; }
  gdChip();
  const box = $("#gdBox"); if (box) gdPengaturan(box);
}

function gdMulai() {
  clearInterval(gdTimer);
  gdRefresh();
  gdTimer = setInterval(() => { if (S.user && !document.hidden) gdRefresh(); }, (S.gd && S.gd.running) ? 4000 : 20000);
}

async function gdBackupSekarang(btn) {
  if (btn) { btn.disabled = true; btn.textContent = "Mengirim…"; }
  if (S.gd) { S.gd.running = true; gdChip(); }
  try { S.gd = await api("/api/gdrive/backup", {}); toast("Backup terkirim ke Google Drive ✓"); }
  catch (e) { toast("Backup gagal: " + e.message, true); }
  await gdRefresh();
}

// ---------------------------------------------------------------- chip di bar atas
function gdChip() {
  const el = $("#gdChip"); if (!el) return;
  const g = S.gd, admin = S.data && S.data.me.role === "admin";
  if (!g) { el.innerHTML = ""; return; }
  let cls, ikon, teks, sub = "", tombol = "";
  if (!g.terhubung) {
    cls = g.siap ? "warn" : "off"; ikon = GICON;
    teks = "Google Drive belum terhubung";
    sub = admin ? `<a href="#/pengaturan" class="gd-link">${g.siap ? "Hubungkan" : "Atur"}</a>` : "backup online belum aktif";
  } else if (g.konflik) {
    const k = g.konflik;
    cls = "err konf"; ikon = "⇅";
    teks = k.awal ? "Ditemukan backup di Google Drive" : k.alasan === "data-lain" ? "Backup Drive dari komputer lain" : "Data di Google Drive lebih baru";
    sub = `${esc(k.pc || "komputer lain")} · ${waktuRelatif(k.diubah)} · ${k.trx} transaksi — backup ditahan`;
    tombol = admin ? `<button class="sm pri" data-gdkonf>Tinjau</button>` : "";
  } else if (g.running) {
    cls = "run"; ikon = `<span class="spin"></span>`; teks = "Mengirim backup…"; sub = esc(g.email || "");
  } else if (g.lastError) {
    const dicabut = /Hubungkan ulang/.test(g.lastError);
    const izin = /belum dicentang/.test(g.lastError);
    cls = "err"; ikon = "⚠"; teks = izin ? "Izin Google Drive belum dicentang" : dicabut ? "Akses Google Drive terputus" : "Backup gagal";
    sub = izin ? "hubungkan ulang & centang izin Drive" : dicabut ? "login Google kedaluwarsa / dicabut" : esc(g.lastError.length > 48 ? g.lastError.slice(0, 48) + "…" : g.lastError) + " · dicoba lagi otomatis";
    tombol = dicabut ? (admin ? `<a class="btn sm" href="#/pengaturan">Hubungkan ulang</a>` : "") : `<button class="sm" data-gdbak>Coba lagi</button>`;
  } else if (g.pending) {
    cls = "warn"; ikon = GICON; teks = "Ada perubahan belum di-backup";
    sub = (g.lastOK ? "terakhir " + waktuRelatif(g.lastOK) + " · " : "") + esc(g.email || "");
    tombol = `<button class="sm" data-gdbak>↻ Backup sekarang</button>`;
  } else {
    cls = "ok"; ikon = GICON; teks = g.lastOK ? "Ter-backup " + waktuRelatif(g.lastOK) : "Terhubung";
    sub = esc(g.email || "");
    tombol = `<button class="sm ghost" data-gdbak title="Kirim backup sekarang">↻ Backup sekarang</button>`;
  }
  el.className = "gdchip " + cls;
  el.innerHTML = `<span class="gd-i">${ikon}</span><span class="gd-t"><b>${teks}</b><small>${sub}</small></span>${tombol}`;
  el.title = g.terhubung ? `Google Drive: ${g.email || ""}\nFolder: ${g.folder}\nBackup terakhir: ${g.lastOK ? new Date(g.lastOK).toLocaleString("id-ID") : "-"}${g.lastError ? "\nError: " + g.lastError : ""}` : "Backup ke Google Drive belum aktif";
  const b = $("[data-gdbak]", el); if (b) b.onclick = () => gdBackupSekarang(b);
  const kb = $("[data-gdkonf]", el); if (kb) kb.onclick = () => gdKonflik();
  // admin: tampilkan otomatis sekali per kejadian
  if (g.konflik && admin) {
    const key = g.konflik.fileId + ":" + g.konflik.rev;
    if (S._konfShown !== key && !$(".modal-bg")) { S._konfShown = key; setTimeout(gdKonflik, 300); }
  }
}

function tglJam(iso) { return iso ? new Date(iso).toLocaleString("id-ID", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "–"; }

function gdKonflik() {
  const g = S.gd; if (!g || !g.konflik) return;
  const k = g.konflik, l = g.lokal || {};
  const ket = k.awal
    ? `Di Google Drive akun <b>${esc(g.email || "")}</b> sudah ada backup. Kalau ini <b>komputer baru</b> atau aplikasi baru dipasang ulang, pilih <b>Pulihkan dari Google Drive</b> supaya data di komputer ini sama dengan backup terakhir.`
    : k.alasan === "data-lain"
      ? `Backup terakhir di Drive berasal dari <b>data / komputer lain</b> (${esc(k.pc || "-")}). Kemungkinan ada dua komputer yang memakai akun Google yang sama dengan data berbeda.`
      : `Backup di Drive <b>lebih baru</b> daripada data di komputer ini. Kemungkinan data di komputer ini adalah salinan lama (mis. dari flashdisk).`;
  const baris = (lbl, a, b, beda) => `<tr><th>${lbl}</th><td>${a}</td><td class="${beda ? "lebih" : ""}">${b}</td></tr>`;
  const m = modal(k.awal ? "Ditemukan backup di Google Drive" : "Backup otomatis ditahan", `
    <div class="alert warn" style="margin-top:0">${ket} Backup otomatis <b>dihentikan sementara</b> supaya tidak ada data yang tertimpa.</div>
    <table class="konf"><thead><tr><th></th><th>💻 Komputer ini</th><th>☁ Google Drive (terbaru)</th></tr></thead><tbody>
      ${baris("Komputer", esc(l.pc || "-"), esc(k.pc || "-"))}
      ${baris("Terakhir diubah", tglJam(l.diubah), tglJam(k.diubah), (k.diubah || "") > (l.diubah || ""))}
      ${baris("Jumlah transaksi", fmtN(l.trx || 0), fmtN(k.trx || 0), (k.trx || 0) > (l.trx || 0))}
      ${baris("Kode data", `<span class="mute small">${esc(l.id || "-")} · rev ${l.rev || 0}</span>`, `<span class="mute small">${esc(k.id || "-")} · rev ${k.rev || 0}</span>`)}
    </tbody></table>
    <div class="konf-pilih">
      <div><b>Pulihkan dari Google Drive</b><div class="small mute">Data komputer ini diganti dengan backup di Drive (data lama tetap disimpan di folder data\\backups). Semua pengguna perlu masuk lagi.</div></div>
      <div><b>Lanjutkan backup komputer ini</b><div class="small mute">Data komputer ini tetap dikirim sebagai backup tersendiri. Backup dari ${esc(k.pc || "komputer lain")} di Drive <b>tidak dihapus</b>.</div></div>
    </div>`, {
    wide: true, buttons: [
      { label: "Nanti" },
      { label: "Lanjutkan backup komputer ini", onClick: async btn => { btn.disabled = true; try { S.gd = await api("/api/gdrive/lanjut", {}); toast("Backup komputer ini dilanjutkan ✓"); gdRefresh(); } catch (e) { toast(e.message, true); btn.disabled = false; return false; } } },
      { label: "Pulihkan dari Google Drive", cls: "pri", onClick: () => { gdPulihkan(k.fileId, k); } },
    ] });
  return m;
}

async function gdPulihkan(fileId, info) {
  const teks = info ? `backup dari <b>${esc(info.pc || "-")}</b> (${tglJam(info.diubah)}, ${fmtN(+info.trx || 0)} transaksi)` : "backup ini";
  if (!(await confirmBox(`Pulihkan ${teks} ke komputer ini?<br><br>Data di komputer ini sekarang diganti. Salinannya tetap disimpan di folder <code>data\\backups</code>. Setelah itu semua pengguna masuk lagi dengan akun dari backup.`, "Pulihkan"))) return;
  const t = document.createElement("div"); t.textContent = "Mengunduh & memulihkan backup…"; $("#toast").appendChild(t);
  try {
    const r = await api("/api/gdrive/pulihkan", { fileId });
    t.remove();
    alertPulih(r);
  } catch (e) { t.remove(); toast("Gagal memulihkan: " + e.message, true); }
}

function alertPulih(r) {
  modal("Data dipulihkan ✓", `<p>Berhasil memulihkan <b>${fmtN(r.transaksi)} transaksi</b>${r.lampiran ? ` dan <b>${r.lampiran} lampiran</b>` : ""} dari Google Drive.</p><p class="small mute">Silakan masuk lagi. Akun & kata sandi mengikuti data dari backup.</p>`,
    { buttons: [{ label: "Masuk lagi", cls: "pri", onClick: () => { S.data = null; S.user = null; S._gdStarted = false; location.hash = "#/dashboard"; boot(); } }], onClose: () => { S.data = null; S.user = null; S._gdStarted = false; boot(); } });
}

async function gdRiwayat() {
  const m = modal("Riwayat backup di Google Drive", `<p class="mute">Memuat daftar…</p>`, { wide: true, buttons: [{ label: "Tutup" }] });
  try {
    const r = await api("/api/gdrive/daftar");
    const l = (S.gd && S.gd.lokal) || {};
    $(".mb", m.el).innerHTML = r.files.length ? `<div class="tw"><table><thead><tr><th>Tanggal data</th><th>Komputer</th><th class="num">Transaksi</th><th class="num">Ukuran</th><th>Asal</th><th></th></tr></thead><tbody>
      ${r.files.map(f => `<tr><td class="nowrap">${tglJam(f.diubah)}</td><td>${esc(f.pc || "-")}</td><td class="num">${f.trx ? fmtN(+f.trx) : "–"}</td><td class="num">${fmtN(f.size / 1024, 0)} KB</td>
        <td>${f.dataId ? (f.milikIni ? '<span class="b ok">data komputer ini</span>' : '<span class="b warn">data lain</span>') : '<span class="b k">versi lama</span>'}</td>
        <td><button class="sm" data-pul="${esc(f.id)}">Pulihkan</button></td></tr>`).join("")}
      </tbody></table></div><p class="small mute">Data komputer ini: ${fmtN(l.trx || 0)} transaksi, terakhir diubah ${tglJam(l.diubah)}.</p>`
      : `<p class="mute">Belum ada backup di Drive.</p>`;
    $$("[data-pul]", m.el).forEach(b => b.onclick = () => { const f = r.files.find(x => x.id === b.dataset.pul); m.close(); gdPulihkan(f.id, f); });
  } catch (e) { $(".mb", m.el).innerHTML = `<div class="alert err">${esc(e.message)}</div>`; }
}

// ---------------------------------------------------------------- bagian Pengaturan
function gdPengaturan(el) {
  const g = S.gd, admin = S.data.me.role === "admin";
  if (!g) { el.innerHTML = ""; return; }
  const lokal = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  const status = !g.terhubung
    ? `<div class="gd-st off">${GICON}<div><b>Belum terhubung</b><div class="small mute">${g.siap ? "Klik \"Hubungkan Google Drive\" lalu login dengan akun Google yang akan menyimpan backup." : "Isi Client ID & Client Secret dulu (langkah 1)."}</div></div></div>`
    : `<div class="gd-st ${g.lastError ? "err" : "ok"}">${GICON}<div><b>Terhubung: ${esc(g.email || "akun Google")}</b>
        <div class="small">Backup terakhir: <b>${g.lastOK ? new Date(g.lastOK).toLocaleString("id-ID") : "belum ada"}</b>${g.lastFile ? ` · ${esc(g.lastFile)} (${fmtN(g.lastSize / 1024, 0)} KB)` : ""}</div>
        <div class="small mute">Folder di Google Drive: <b>${esc(g.folder)}</b>${g.pending ? ' · <span class="b warn">ada perubahan belum di-backup</span>' : ""}</div>
        ${g.lastError ? `<div class="small" style="color:var(--red);margin-top:4px">⚠ ${esc(g.lastError)}</div>` : ""}</div></div>`;
  el.innerHTML = `<div class="card"><div class="row" style="justify-content:space-between"><h2 style="margin:0">Backup Google Drive</h2>
      <div class="row">${g.terhubung && admin ? `<button id="gdHist">Riwayat &amp; pulihkan</button>` : ""}${g.terhubung && !g.konflik ? `<button class="pri" id="gdNow" ${g.running ? "disabled" : ""}>${g.running ? "Mengirim…" : "↻ Backup sekarang"}</button>` : ""}</div></div>
    <p class="small mute" style="margin:6px 0 12px">Backup dikirim <b>otomatis</b> beberapa menit setelah ada perubahan data (dan dicoba ulang bila internet putus). Satu file zip per hari (data + lampiran), 30 hari terakhir disimpan. Aplikasi hanya bisa mengakses file yang dibuatnya sendiri di Drive. Login Google tidak ikut di dalam file backup.</p>
    ${status}
    ${g.konflik ? `<div class="alert err" style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap"><span><b>Backup ditahan.</b> ${g.konflik.awal ? "Ditemukan backup di Drive" : g.konflik.alasan === "data-lain" ? "Backup terakhir di Drive berasal dari komputer lain" : "Data di Drive lebih baru"} (${esc(g.konflik.pc || "-")}, ${tglJam(g.konflik.diubah)}, ${g.konflik.trx} transaksi).</span>${admin ? `<button class="pri sm" id="gdKonfBtn">Tinjau</button>` : ""}</div>` : ""}
    ${admin ? `
    <div class="gd-steps">
      <div class="gd-step"><div class="gd-n">1</div><div style="flex:1"><b>Identitas aplikasi (Client ID)</b> <span class="small mute">— sekali saja, dibuat di Google Cloud Console. <a href="#" id="gdHelp">Lihat panduan</a></span>
        <div class="grid g2" style="margin-top:8px">
          <label class="f"><span>Client ID</span><input id="gdCid" value="${esc(g.clientId || "")}" placeholder="xxxx.apps.googleusercontent.com"></label>
          <label class="f"><span>Client Secret ${g.siap ? '<span class="mute">(tersimpan — kosongkan bila tidak diganti)</span>' : ""}</span><input id="gdSec" type="password" placeholder="${g.siap ? "••••••••" : "GOCSPX-…"}"></label>
        </div>
        <div class="row"><button id="gdSaveCfg">Simpan</button><label class="btn sm ghost">atau pilih file JSON yang diunduh dari Google…<input type="file" id="gdJson" accept=".json" hidden></label></div></div></div>
      <div class="gd-step"><div class="gd-n">2</div><div style="flex:1"><b>Hubungkan akun Google</b> <span class="small mute">— akun yang Drive-nya dipakai menyimpan backup (mis. akun Kang Irwan).</span>
        <div class="row" style="margin-top:8px">
          ${lokal ? `<button class="pri" id="gdLogin" ${g.siap ? "" : "disabled"}>${GICON} ${g.terhubung ? "Ganti akun Google" : "Hubungkan Google Drive"}</button>` : `<span class="b warn">Buka aplikasi di komputer server (http://localhost:${location.port}) untuk menghubungkan akun Google.</span>`}
          ${g.terhubung ? `<button class="danger" id="gdOff">Putuskan</button>` : ""}
        </div></div></div>
    </div>` : `<p class="small mute">Hanya admin yang bisa menghubungkan / memutus Google Drive.</p>`}
  </div>`;
  const now = $("#gdNow", el); if (now) now.onclick = () => gdBackupSekarang(now);
  const hist = $("#gdHist", el); if (hist) hist.onclick = gdRiwayat;
  const kb = $("#gdKonfBtn", el); if (kb) kb.onclick = gdKonflik;
  if (!admin) return;
  $("#gdHelp", el).onclick = e => { e.preventDefault(); gdPanduan(); };
  $("#gdSaveCfg", el).onclick = async () => {
    try { S.gd = await api("/api/gdrive/config", { clientId: $("#gdCid", el).value, clientSecret: $("#gdSec", el).value }); toast("Client ID tersimpan"); gdRefresh(); }
    catch (e) { toast(e.message, true); }
  };
  $("#gdJson", el).onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const j = JSON.parse(await f.text()), c = j.installed || j.web || j;
      if (!c.client_id || !c.client_secret) throw new Error("File bukan kredensial OAuth Google (client_secret_….json).");
      if (j.web) toast("Perhatian: ini kredensial tipe Web. Sebaiknya buat tipe \"Desktop app\".", true);
      $("#gdCid", el).value = c.client_id; $("#gdSec", el).value = c.client_secret;
      S.gd = await api("/api/gdrive/config", { clientId: c.client_id, clientSecret: c.client_secret }); toast("Client ID & Secret terbaca dari file"); gdRefresh();
    } catch (er) { toast(er.message, true); }
    e.target.value = "";
  };
  const lg = $("#gdLogin", el); if (lg) lg.onclick = () => { location.href = "/api/gdrive/login"; };
  const off = $("#gdOff", el); if (off) off.onclick = async () => {
    if (!(await confirmBox("Putuskan Google Drive? Backup otomatis berhenti. File backup yang sudah ada di Drive tidak dihapus.", "Putuskan"))) return;
    S.gd = await api("/api/gdrive/disconnect", {}); toast("Google Drive diputus"); gdRefresh();
  };
}

function gdPanduan() {
  const port = location.port || "8070";
  modal("Panduan membuat Client ID Google (sekali saja)", `<ol class="gd-guide">
    <li>Buka <b>console.cloud.google.com</b>, login dengan akun Google (pembuat aplikasi). Klik pilihan project di atas → <b>New Project</b> → nama <i>Rekap Penjualan</i> → <b>Create</b>, lalu pastikan project itu terpilih.</li>
    <li>Menu ☰ → <b>APIs &amp; Services</b> → <b>Library</b> → cari <b>Google Drive API</b> → <b>Enable</b>.</li>
    <li>Menu ☰ → <b>Google Auth Platform</b> (dulu "OAuth consent screen") → <b>Get started</b>: App name <i>Rekap Penjualan</i>, pilih support email → Audience: <b>External</b> → isi contact email → centang setuju → <b>Create</b>.</li>
    <li>Bagian <b>Data access</b> → <b>Add or remove scopes</b> → centang <code>.../auth/drive.file</code> ("See, edit, create, and delete only the specific Google Drive files you use with this app") → <b>Update</b> → <b>Save</b>.</li>
    <li>Bagian <b>Audience</b> → <b>Publish app</b> → Confirm, sampai status <b>In production</b>. <span class="mute">(Kalau tetap "Testing", login Google kedaluwarsa tiap 7 hari.)</span></li>
    <li>Bagian <b>Clients</b> → <b>Create client</b> → Application type: <b>Desktop app</b> → nama bebas → <b>Create</b>. Salin <b>Client ID</b> dan <b>Client secret</b>, atau klik <b>Download JSON</b>.</li>
    <li>Di aplikasi ini: tempel Client ID &amp; Secret (atau pilih file JSON-nya) → <b>Simpan</b> → <b>Hubungkan Google Drive</b> (dari komputer server, alamat <code>http://localhost:${port}</code>) → pilih akun → <b>Izinkan</b>.</li>
  </ol>
  <p class="small mute">Bila Google menampilkan peringatan "Google hasn't verified this app", klik <b>Advanced</b> → <b>Go to Rekap Penjualan</b>. Izin drive.file tergolong aman: aplikasi hanya bisa mengelola file backup buatannya sendiri.</p>`, { wide: true, buttons: [{ label: "Tutup", cls: "pri" }], noFocus: true });
}
