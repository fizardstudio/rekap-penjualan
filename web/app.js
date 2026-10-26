/* Rekap Penjualan Instansi — CV. PKM / CV. OSI / CV. DKS
   Kanal: Digipay, INAPROC (Katalog v6), Mbizmarket, Lainnya. */
"use strict";
const P = window.Parsers;

// ================================================================ util
const $ = (s, el) => (el || document).querySelector(s);
const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtN = (n, d) => (Number(n) || 0).toLocaleString("id-ID", { minimumFractionDigits: d || 0, maximumFractionDigits: d == null ? 2 : d });
const rp = n => fmtN(Math.round(Number(n) || 0), 0);
const rpS = n => { // singkat: 1,2 M / 345 jt
  n = Number(n) || 0; const a = Math.abs(n);
  if (a >= 1e9) return fmtN(n / 1e9, 2) + " M";
  if (a >= 1e6) return fmtN(n / 1e6, 1) + " jt";
  return rp(n);
};
const tgl = s => s ? s.slice(8, 10) + "-" + s.slice(5, 7) + "-" + s.slice(0, 4) : "";
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const clone = o => JSON.parse(JSON.stringify(o));
const BULAN = ["JANUARI", "FEBRUARI", "MARET", "APRIL", "MEI", "JUNI", "JULI", "AGUSTUS", "SEPTEMBER", "OKTOBER", "NOVEMBER", "DESEMBER"];
const BLN3 = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

const KANAL = {
  DIGIPAY: { label: "Digipay", incl: true, no: "No. Invoice", ph: "429740/00/20261023/074531" },
  INAPROC: { label: "INAPROC", incl: false, no: "No. Surat Pesanan / ID Paket", ph: "EP-01M4QP..." },
  MBIZ: { label: "Mbizmarket", incl: false, no: "No. Pesanan (PO)", ph: "PO-190917-260811-1" },
  LAINNYA: { label: "Lainnya / Manual", incl: false, no: "No. Referensi", ph: "TF / via WA / dll" },
};
const STATUS = { proses: "Proses", dikirim: "Dikirim", selesai: "Selesai (BAST)", lunas: "Lunas", batal: "Batal" };

async function api(path, body, opt) {
  opt = opt || {};
  const init = { method: body === undefined ? "GET" : "POST", headers: {} };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) { init.body = JSON.stringify(body); init.headers["Content-Type"] = "application/json"; }
  const res = await fetch(path, init);
  if (opt.blob) { if (!res.ok) throw new Error((await res.json()).error || res.statusText); return res.blob(); }
  let j = {};
  try { j = await res.json(); } catch (e) { /* kosong */ }
  if (res.status === 401 && path !== "/api/login") { S.user = null; render(); throw new Error(j.error || "Sesi habis"); }
  if (!res.ok) throw new Error(j.error || res.statusText);
  return j;
}

function toast(msg, err) {
  const d = document.createElement("div");
  d.textContent = msg; if (err) d.className = "err";
  $("#toast").appendChild(d);
  setTimeout(() => d.remove(), err ? 6000 : 3000);
}

function modal(title, body, opts) {
  opts = opts || {};
  const bg = document.createElement("div");
  bg.className = "modal-bg";
  bg.innerHTML = `<div class="modal ${opts.wide ? "wide" : ""}"><div class="mh"><h2 style="margin:0">${esc(title)}</h2><button class="ghost" data-x>✕</button></div><div class="mb"></div>${opts.foot === false ? "" : `<div class="mf"></div>`}</div>`;
  const mb = $(".mb", bg);
  if (typeof body === "string") mb.innerHTML = body; else mb.appendChild(body);
  const close = () => { bg.remove(); document.removeEventListener("keydown", onKey); opts.onClose && opts.onClose(); };
  const onKey = e => { if (e.key === "Escape") close(); };
  document.addEventListener("keydown", onKey);
  $("[data-x]", bg).onclick = close;
  bg.addEventListener("mousedown", e => { if (e.target === bg) close(); });
  const mf = $(".mf", bg);
  (opts.buttons || [{ label: "Tutup" }]).forEach(b => {
    if (!mf) return;
    const btn = document.createElement("button");
    btn.textContent = b.label; if (b.cls) btn.className = b.cls;
    btn.onclick = async () => { if (b.onClick) { const r = await b.onClick(btn); if (r === false) return; } close(); };
    mf.appendChild(btn);
  });
  document.body.appendChild(bg);
  const f = $("input,select,textarea", mb); if (f && !opts.noFocus) setTimeout(() => f.focus(), 30);
  return { el: bg, body: mb, close };
}

function confirmBox(msg, label) {
  return new Promise(res => {
    modal("Konfirmasi", `<p>${msg}</p>`, { buttons: [{ label: "Batal", onClick: () => res(false) }, { label: label || "Ya", cls: "danger", onClick: () => res(true) }], onClose: () => res(false) });
  });
}

function downloadBlob(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}

async function exportBook(book) {
  try {
    const blob = await api("/api/xlsx", book, { blob: true });
    downloadBlob(blob, book.filename);
    toast("File Excel diunduh: " + book.filename);
  } catch (e) { toast(e.message, true); }
}

// ================================================================ state
const S = { user: null, setup: true, data: null, alamat: [], route: "", filters: {} };

async function loadState() {
  S.data = await api("/api/state");
  buildIndex();
}

function satkerById(id) { return S.idx.satker[id] || { nama: "(satker tidak ditemukan)", singkat: "?", grup: "" }; }
function cvNama(k) { const c = S.data.cv.find(c => c.kode === k); return c ? c.nama : k; }

// ================================================================ hitung pajak
function hitung(t) {
  const st = S.data.settings;
  const ppnR = (st.ppn || 11) / 100, p22 = (st.pph22 || 1.5) / 100, p23 = (st.pph23 || 2) / 100;
  // Pengaturan pajak per transaksi: noPPN / noPPh22 / noPPh23 = true berarti tidak dikenakan.
  const pakaiPPN = !t.noPPN, incl = pakaiPPN && !!t.inclPPN;
  let bruto = 0, dppB = 0, dppJ = 0, adaB = false, adaJ = false;
  for (const it of t.items || []) {
    const sub = (Number(it.qty) || 0) * (Number(it.harga) || 0);
    bruto += sub;
    const d = incl ? sub / (1 + ppnR) : sub;
    if (it.jenis === "J") { dppJ += d; adaJ = true; } else { dppB += d; adaB = true; }
  }
  const dpp = Math.round(dppB + dppJ);
  const ppn = !pakaiPPN ? 0 : incl ? Math.round(bruto) - dpp : Math.round(dpp * ppnR);
  const total = dpp + ppn;
  const pph22 = t.noPPh22 ? 0 : Math.round(dppB * p22), pph23 = t.noPPh23 ? 0 : Math.round(dppJ * p23);
  const fee = Number(t.platformFee) || 0;
  const wapu = pakaiPPN && t.wapu !== false;
  const bersih = total - (wapu ? ppn : 0) - pph22 - pph23 - fee;
  return { bruto, dpp, ppn, total, pph22, pph23, pph: pph22 + pph23, fee, wapu, bersih, pakaiPPN, incl, adaB, adaJ };
}

// ================================================================ pencocokan master
function satkerKey(s) {
  return P.norm(s).replace(/\bKANTOR PERTANAHAN\b|\bBPN\b|\bKANTAH\b|\bKANTOR WILAYAH\b/g, " ")
    .replace(/\bKABUPATEN\b/g, "KAB").replace(/\bII\b/g, "2").replace(/\bI\b/g, "1").replace(/\s+/g, " ").trim();
}

function buildIndex() {
  setTimeout(hitungPemakaian, 0);
  const d = S.data;
  S.idx = { satker: {}, barang: {}, bExact: new Map(), sKey: new Map() };
  for (const s of d.satker) {
    S.idx.satker[s.id] = s;
    [s.nama, s.singkat].concat(s.alias || []).forEach(n => { const k = satkerKey(n); if (k && !S.idx.sKey.has(k)) S.idx.sKey.set(k, s); });
  }
  for (const b of d.barang) {
    S.idx.barang[b.id] = b;
    b._s = P.norm([b.nama, b.kode, b.merk].concat(b.alias || []).join(" "));
    b._n = P.norm(b.nama);
    b._c = b._s.replace(/ /g, "");
    b._w = Array.from(new Set(b._s.split(" ")));
    b._k = kodeKey(b.kode);
    b._kat = new Set((b.alias || []).map(a => kodeKey(P.pecahKatalog(a).katalog)).filter(Boolean));
    b._use = 0;
    b._tok = new Set(P.norm(b.nama).split(" "));
    [b.nama].concat(b.alias || []).forEach(n => {
      const k1 = P.norm(n), k2 = P.norm(P.pecahKatalog(n).dasar);
      if (!S.idx.bExact.has(k1)) S.idx.bExact.set(k1, b);
      if (!S.idx.bExact.has(k2)) S.idx.bExact.set(k2, b);
    });
  }
}

function hitungPemakaian() {
  S.data.barang.forEach(b => b._use = 0);
  S.data.transaksi.forEach(t => t.items.forEach(i => { const b = i.barangId && S.idx.barang[i.barangId]; if (b) b._use++; }));
}

function cocokSatker(nama, kode, noDok) {
  if (kode) { const s = S.data.satker.find(s => s.kodeSatker === kode || s.kodeBPN === kode); if (s) return s; }
  // No. Dok BPN memuat kode wilayah kantah, mis. 33/32.06/IX/2026 atau UP.03.01/1978-32.05/X/2026
  const mk = String(noDok || "").match(/(?:^|[\/\-\s])(\d{2}\.\d{2})(?=[\/\s]|$)/);
  if (mk) { const c = S.data.satker.filter(s => s.grup === "BPN" && s.kodeKantah === mk[1]); if (c.length === 1) return c[0]; }
  if (!nama) return null;
  return S.idx.sKey.get(satkerKey(nama)) || null;
}

// {barang, pasti:bool}
function cocokBarang(nama) {
  const full = P.norm(nama), dasar = P.norm(P.pecahKatalog(nama).dasar);
  const ex = S.idx.bExact.get(full) || S.idx.bExact.get(dasar);
  if (ex) return { barang: ex, pasti: true };
  const tok = new Set(dasar.split(" ").filter(Boolean));
  let best = null, bs = 0;
  for (const b of S.data.barang) {
    let inter = 0; tok.forEach(t => { if (b._tok.has(t)) inter++; });
    const sc = inter / (tok.size + b._tok.size - inter || 1);
    if (sc > bs) { bs = sc; best = b; }
  }
  return bs >= 0.6 ? { barang: best, pasti: false, skor: bs } : null;
}

// Sebutan sehari-hari -> kata di master barang
const SINONIM = {
  PULPEN: ["BALLPOINT", "PEN"], BOLPEN: ["BALLPOINT", "PEN"], BOLPOIN: ["BALLPOINT"], PENA: ["BALLPOINT", "PEN"],
  LAKBAN: ["TAPE", "LAKBAN"], SELOTIP: ["SOLASI", "TAPE"], SOLATIP: ["SOLASI", "TAPE"], ISOLASI: ["SOLASI", "TAPE"],
  FLASHDISK: ["USB", "FLASHDISK", "UFD"], FD: ["USB", "FLASHDISK"], TIPEX: ["TIPE", "CORRECTION"], TIPPEX: ["TIPE", "CORRECTION"],
  STAPLES: ["STAPLER"], STEPLES: ["STAPLER"], HEKTER: ["STAPLER"], STABILO: ["STABILO", "HIGHLIGHTER"],
  TONER: ["TONER", "CATRIDGE", "CARTRIDGE"], KARTRID: ["CATRIDGE", "CARTRIDGE", "TONER"], CATRIDGE: ["CATRIDGE", "CARTRIDGE"],
  CARTRIDGE: ["CARTRIDGE", "CATRIDGE"], BATRE: ["BATERAI", "BATTERY"], BATERE: ["BATERAI"], BATRAI: ["BATERAI"],
  PENGHAPUS: ["PENGHAPUS", "ERASER"], SPIDOL: ["SPIDOL", "MARKER"], GUNTING: ["GUNTING", "SCISSOR"], AMPLOP: ["AMPLOP", "ENVELOPE"],
  MAP: ["MAP", "FOLDER"], STOPMAP: ["MAP"], STOFMAP: ["MAP"], FOLIO: ["FOLIO", "F4"], KWARTO: ["A4"], KUARTO: ["A4"], DOBEL: ["DOUBLE"], DOUBLETAPE: ["DOUBLE"], ORDNER: ["ORDNER", "BINDEX"], KLIP: ["CLIP"], LEM: ["LEM", "GLUE"], HVS: ["HVS"],
};

function lev1(a, b) { // jarak edit <= 1 ?
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, e = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++e > 1) return false;
    if (a.length > b.length) i++; else if (a.length < b.length) j++; else { i++; j++; }
  }
  return e + (a.length - i) + (b.length - j) <= 1;
}

// skor kecocokan satu kata pencarian terhadap barang (0 = tidak cocok)
function skorKata(b, t) {
  const alts = SINONIM[t] ? [t].concat(SINONIM[t]) : [t];
  let best = 0;
  for (const a of alts) {
    if (b._w.includes(a)) best = Math.max(best, a === t ? 3 : 2.5);       // kata utuh
    else if (b._w.some(w => w.startsWith(a))) best = Math.max(best, 2);   // awal kata
    else if (b._s.includes(a)) best = Math.max(best, 1.5);                // di tengah
    else if (a.length >= 4 && b._c.includes(a)) best = Math.max(best, 1.2); // tanpa spasi: STOPMAP = STOP MAP
    else if (a.length >= 4 && !/\d/.test(a) && b._w.some(w => w.length >= 4 && !/\d/.test(w) && lev1(a, w))) best = Math.max(best, 0.8); // salah ketik 1 huruf (tidak untuk angka)
  }
  return best;
}

// mengembalikan {list, total, toks}
// kode dibandingkan tanpa spasi/strip/titik: "t673" = "T-673", "osi604" = "OSI 604"
function kodeKey(s) { return String(s || "").toUpperCase().replace(/[\s\-._\/]/g, ""); }

// Pencarian kode: hanya yang benar-benar cocok, tanpa tebakan.
// 1) kode / no. katalog sama persis  2) bila ada angka: kode yang berawalan teks itu
function cariKode(q) {
  const k = kodeKey(q);
  if (k.length < 2) return null;
  const persis = S.data.barang.filter(b => b._k === k || b._kat.has(k));
  if (persis.length) return { list: persis.sort((a, b) => a.nama.localeCompare(b.nama)), total: persis.length, toks: [], kode: "persis", q: q.trim() };
  if (!/\d/.test(k)) return null;
  const awal = S.data.barang.filter(b => b._k.startsWith(k) || Array.from(b._kat).some(x => x.startsWith(k)));
  if (awal.length) return { list: awal.sort((a, b) => a.kode.localeCompare(b.kode, "id", { numeric: true }) || a.nama.localeCompare(b.nama)), total: awal.length, toks: [], kode: "awal", q: q.trim() };
  return null;
}

function cariBarangX(q) {
  const kd = cariKode(q || "");
  if (kd) return kd;
  const toks = P.norm(q).split(" ").filter(Boolean);
  if (!toks.length) {
    const list = S.data.barang.filter(b => b._use).sort((a, b) => b._use - a._use).slice(0, 15);
    return { list, total: list.length, toks, sering: true };
  }
  const hasil = [];
  for (const b of S.data.barang) {
    let sk = 0, ok = true;
    for (const t of toks) { const x = skorKata(b, t); if (!x) { ok = false; break; } sk += x; }
    if (!ok) continue;
    if (b._n.startsWith(toks[0])) sk += 2;
    sk += Math.min(b._use, 20) * 0.08;
    hasil.push([sk, b]);
  }
  hasil.sort((a, b) => b[0] - a[0] || a[1].nama.localeCompare(b[1].nama));
  return { list: hasil.map(x => x[1]), total: hasil.length, toks };
}

function cariBarang(q, n) { return cariBarangX(q).list.slice(0, n || 12); }

// tandai kata yang dicari (aman HTML)
function tandai(teks, toks) {
  let h = esc(teks);
  const pola = toks.flatMap(t => (SINONIM[t] ? [t].concat(SINONIM[t]) : [t])).filter(t => t.length >= 2)
    .sort((a, b) => b.length - a.length).map(t => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!pola.length) return h;
  return h.replace(new RegExp("(" + pola.join("|") + ")", "gi"), "<mark>$1</mark>");
}

function cariSatker(q) {
  const toks = P.norm(q).split(" ").filter(Boolean);
  return S.data.satker.filter(s => {
    const h = P.norm([s.nama, s.singkat, s.kodeSatker, s.kodeKantah, s.kodeBPN].concat(s.alias || []).join(" "));
    return toks.every(t => h.includes(t));
  }).slice(0, 15);
}

// ================================================================ combo box (autocomplete)
function combo(input, source, onPick) {
  const wrap = document.createElement("div");
  wrap.className = "combo";
  input.parentNode.insertBefore(wrap, input); wrap.appendChild(input);
  const dd = document.createElement("div"); dd.className = "dd hidden"; wrap.appendChild(dd);
  let items = [], on = -1;
  const show = () => {
    let r = source(input.value), head = "";
    if (!Array.isArray(r)) { head = r.header || ""; r = r.items; }
    items = r;
    on = items.length ? 0 : -1;
    dd.innerHTML = (head ? `<div class="dd-h">${head}</div>` : "") + items.map((it, i) => `<div data-i="${i}" class="${i === on ? "on" : ""}">${it.html || esc(it.label)}${it.sub ? `<small>${it.subHtml ? it.sub : esc(it.sub)}</small>` : ""}</div>`).join("");
    dd.classList.toggle("hidden", !items.length && !head);
    posisi();
  };
  // dropdown melayang (position:fixed) supaya tidak terpotong tabel yang bisa di-scroll
  const posisi = () => {
    if (dd.classList.contains("hidden")) return;
    const r = input.getBoundingClientRect(), vw = window.innerWidth, vh = window.innerHeight;
    const w = Math.min(Math.max(r.width, 440), vw - 16);
    dd.style.width = w + "px";
    dd.style.left = Math.max(8, Math.min(r.left, vw - w - 8)) + "px";
    const bawah = vh - r.bottom - 8, atas = r.top - 8;
    const keAtas = bawah < 220 && atas > bawah;
    const maxH = Math.min(380, keAtas ? atas : bawah);
    dd.style.maxHeight = maxH + "px";
    if (keAtas) { dd.style.top = ""; dd.style.bottom = (vh - r.top + 2) + "px"; }
    else { dd.style.bottom = ""; dd.style.top = (r.bottom + 2) + "px"; }
  };
  window.addEventListener("scroll", posisi, true);
  window.addEventListener("resize", posisi);
  const pick = i => { if (items[i]) { onPick(items[i]); dd.classList.add("hidden"); } };
  input.addEventListener("input", show);
  // kolom barang: dropdown otomatis hanya saat kosong (baris sudah terisi -> muncul ketika mulai mengetik)
  input.addEventListener("focus", () => { if (input.dataset.openEmpty ? !input.value : input.value) show(); });
  input.addEventListener("blur", () => setTimeout(() => dd.classList.add("hidden"), 180));
  input.addEventListener("keydown", e => {
    if (dd.classList.contains("hidden")) return;
    if (!items.length) { if (e.key === "Enter" || e.key === "Escape" || e.key === "Tab") dd.classList.add("hidden"); return; }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault(); on = (on + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
      $$("[data-i]", dd).forEach((d, i) => d.classList.toggle("on", i === on));
      const el = $$("[data-i]", dd)[on]; el && el.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter") { e.preventDefault(); pick(on); }
    else if (e.key === "Escape") { e.preventDefault(); dd.classList.add("hidden"); }
    else if (e.key === "Tab") dd.classList.add("hidden");
  });
  dd.addEventListener("mousedown", e => { const d = e.target.closest("[data-i]"); if (d) { e.preventDefault(); pick(+d.dataset.i); } });
}

// ================================================================ shell & router
const ICON = {
  dashboard: '<path d="M3 3h8v10H3zM13 3h8v6h-8zM13 11h8v10h-8zM3 15h8v6H3z"/>',
  beranda: '<path d="M3 11l9-7 9 7v9a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1z"/>',
  transaksi: '<path d="M4 4h16v16H4zM8 9h8M8 13h8M8 17h5"/>',
  rekap: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  master: '<path d="M4 6h16M4 12h16M4 18h10"/>',
  pengaturan: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>',
};
const NAV = [["dashboard", "Dashboard"], ["beranda", "Ringkasan tabel"], ["transaksi", "Transaksi"], ["rekap", "Rekap & Laporan"], ["master", "Master Data"], ["pengaturan", "Pengaturan"]];

function shell(inner) {
  const r = S.route.split("/")[0] || "dashboard";
  return `<div class="app">
  <aside class="side" id="side">
    <div class="brand"><b>${esc(S.data.settings.namaUsaha || "Rekap Penjualan")}</b><span>PKM · OSI · DKS — Digipay · INAPROC · Mbizmarket</span></div>
    <nav>${NAV.map(([k, l]) => `<a href="#/${k}" class="${r === k || (k === "transaksi" && r === "trx") ? "on" : ""}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON[k]}</svg>${l}</a>`).join("")}</nav>
    <div class="who">${esc(S.data.me.nama)} <span class="mute">(${S.data.me.role})</span><br><button class="sm" id="btnLogout">Keluar</button></div>
  </aside>
  <main class="main"><div class="appbar noprint"><button class="menu-btn" id="menuBtn">☰ Menu</button><span style="flex:1"></span><div id="gdChip" class="gdchip"></div></div><div id="page">${inner}</div></main></div>`;
}

async function render() {
  const root = $("#root");
  if (!S.setup) return renderSetup(root);
  if (!S.user) return renderLogin(root);
  if (!S.data) { root.innerHTML = `<p style="padding:40px">Memuat data…</p>`; try { await loadState(); } catch (e) { root.innerHTML = `<p style="padding:40px">${esc(e.message)}</p>`; return; } }
  $$(".modal-bg").forEach(m => m.remove()); // pop-up tidak ikut terbawa ke halaman lain
  if (S._keyH) { document.removeEventListener("keydown", S._keyH); S._keyH = null; }
  S.route = (location.hash || "#/dashboard").slice(2);
  if (typeof sembunyiTT === "function") sembunyiTT();
  S.curHash = location.hash;
  const [page, arg] = S.route.split("/");
  const fn = { dashboard: pgDashboard, beranda: pgBeranda, transaksi: pgTransaksi, trx: pgForm, rekap: pgRekap, master: pgMaster, pengaturan: pgPengaturan }[page] || pgDashboard;
  root.innerHTML = shell("");
  if (typeof gdChip === "function") { gdChip(); if (!S._gdStarted) { S._gdStarted = true; gdMulai(); } }
  $("#menuBtn").onclick = e => { e.stopPropagation(); $("#side").classList.toggle("open"); };
  $(".main").addEventListener("click", () => $("#side").classList.remove("open"));
  $("#btnLogout").onclick = async () => { await api("/api/logout", {}); S.user = null; S.data = null; S._gdStarted = false; render(); };
  try { fn($("#page"), arg); } catch (e) { console.error(e); $("#page").innerHTML = `<div class="alert err">Terjadi kesalahan: ${esc(e.message)}</div>`; }
}
window.addEventListener("hashchange", () => {
  if (S.ignoreHash) { S.ignoreHash = false; return; }
  if (S.formDirty && !confirm("Perubahan transaksi belum disimpan. Tinggalkan halaman?")) { S.ignoreHash = true; location.hash = S.curHash || "#/transaksi"; return; }
  S.formDirty = false; render();
});
window.addEventListener("beforeunload", e => { if (S.formDirty) { e.preventDefault(); e.returnValue = ""; } });

function renderLogin(root) {
  root.innerHTML = `<div class="login"><form class="box" id="fLogin">
    <h1>Rekap Penjualan Instansi</h1><p class="mute" style="margin-top:0">${esc(S.namaUsaha || "")}</p>
    <label class="f"><span>Username</span><input name="username" autocomplete="username" required></label>
    <label class="f"><span>Kata sandi</span><input name="password" type="password" autocomplete="current-password" required></label>
    <div id="err"></div><button class="pri" style="width:100%;justify-content:center">Masuk</button></form></div>`;
  $("#fLogin").onsubmit = async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    try { await api("/api/login", { username: f.get("username"), password: f.get("password") }); await boot(); }
    catch (er) { $("#err").innerHTML = `<div class="alert err">${esc(er.message)}</div>`; }
  };
  $("input", root).focus();
}

function renderSetup(root) {
  root.innerHTML = `<div class="login"><form class="box" id="fSetup" style="max-width:460px">
    <h1>Selamat datang</h1><p class="mute" style="margin-top:0">Siapkan aplikasi sekali saja. Akun ini menjadi admin.</p>
    <label class="f"><span>Nama usaha / judul aplikasi</span><input name="namaUsaha" value="Rekap Penjualan PKM · OSI · DKS"></label>
    <label class="f"><span>Nama Anda</span><input name="nama" required></label>
    <div class="grid g2"><label class="f"><span>Username</span><input name="username" value="admin" required></label>
    <label class="f"><span>Kata sandi (min. 6)</span><input name="password" type="password" minlength="6" required></label></div>
    <label class="check"><input type="checkbox" name="dataLama" checked> Muat data lama dari Excel (Rekap Digipay 2025, Belanja BPN 2025 &amp; 2026 — 182 transaksi)</label>
    <p class="small mute">Master barang (588 item dari HARGA ATK INSTANSI Mei 2026) dan 41 satker selalu dimuat.</p>
    <div id="err"></div><button class="pri" style="width:100%;justify-content:center">Mulai</button></form></div>`;
  $("#fSetup").onsubmit = async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      await api("/api/setup", { namaUsaha: f.get("namaUsaha"), nama: f.get("nama"), username: f.get("username"), password: f.get("password"), dataLama: !!f.get("dataLama") });
      await boot();
    } catch (er) { $("#err").innerHTML = `<div class="alert err">${esc(er.message)}</div>`; }
  };
}

async function boot() {
  const st = await api("/api/status");
  S.setup = st.setup; S.user = st.user || null; S.namaUsaha = st.namaUsaha; S.alamat = st.alamat || [];
  S.data = null;
  render();
}

// ================================================================ helper filter
function tahunList() {
  const ys = new Set([String(new Date().getFullYear())]);
  S.data.transaksi.forEach(t => t.tanggal && ys.add(t.tanggal.slice(0, 4)));
  return Array.from(ys).sort().reverse();
}
function optList(obj, sel, all) {
  return (all ? `<option value="">${all}</option>` : "") + Object.entries(obj).map(([k, v]) => `<option value="${esc(k)}" ${k === sel ? "selected" : ""}>${esc(v)}</option>`).join("");
}
const cvOpts = () => Object.fromEntries(S.data.cv.map(c => [c.kode, c.kode]));
const kanalOpts = () => Object.fromEntries(Object.entries(KANAL).map(([k, v]) => [k, v.label]));
const aktif = t => t.status !== "batal";

// ================================================================ BERANDA
function pgBeranda(el) {
  const F = S.filters.beranda = S.filters.beranda || { tahun: tahunList()[0], kanal: "" };
  const list = S.data.transaksi.filter(t => aktif(t) && t.tanggal.startsWith(F.tahun) && (!F.kanal || t.kanal === F.kanal));
  const cvs = S.data.cv.map(c => c.kode);
  const m = {}; cvs.forEach(c => m[c] = Array(12).fill(0));
  let tot = 0, pph = 0, belum = 0, belumN = 0;
  const perKanal = {};
  for (const t of list) {
    const h = hitung(t); const b = +t.tanggal.slice(5, 7) - 1;
    if (m[t.cv]) m[t.cv][b] += h.total;
    tot += h.total; pph += h.pph;
    if (t.status !== "lunas" && t.dibuatOleh !== "migrasi") { belum += h.total; belumN++; }
    perKanal[t.kanal] = perKanal[t.kanal] || {}; perKanal[t.kanal][t.cv] = (perKanal[t.kanal][t.cv] || 0) + h.total;
  }
  const colTot = Array(12).fill(0).map((_, i) => cvs.reduce((a, c) => a + m[c][i], 0));
  const maxM = Math.max(1, ...colTot);
  const tanpaTgl = S.data.transaksi.filter(t => !t.tanggal).length;
  el.innerHTML = `
  <div class="topbar"><div><h1>Ringkasan tabel</h1><div class="mute">Penjualan ke instansi per CV per bulan (nilai termasuk PPN, transaksi batal tidak dihitung)</div></div>
    <div class="filters"><label class="f"><span>Tahun</span><select id="fTahun">${tahunList().map(y => `<option ${y === F.tahun ? "selected" : ""}>${y}</option>`).join("")}</select></label>
    <label class="f"><span>Kanal</span><select id="fKanal">${optList(kanalOpts(), F.kanal, "Semua kanal")}</select></label>
    <button class="pri" onclick="location.hash='#/trx/baru'">+ Transaksi baru</button></div></div>
  ${tanpaTgl ? `<div class="alert warn">${tanpaTgl} transaksi hasil migrasi belum punya tanggal sehingga tidak masuk rekap. <a href="#/transaksi" onclick="S.filters.trx={tahun:'',tanpaTgl:1}">Lengkapi sekarang</a></div>` : ""}
  <div class="kpis">
    <div class="kpi"><div class="l">Total penjualan ${F.tahun}</div><div class="v">Rp ${rpS(tot)}</div><div class="s">${list.length} transaksi</div></div>
    ${cvs.map(c => `<div class="kpi"><div class="l"><span class="b ${c}">${c}</span> ${esc(cvNama(c).replace(/^CV\.\s*/, ""))}</div><div class="v">Rp ${rpS(m[c].reduce((a, b) => a + b, 0))}</div><div class="s">${list.filter(t => t.cv === c).length} transaksi</div></div>`).join("")}
    <div class="kpi"><div class="l">PPh dipotong (22 + 23)</div><div class="v">Rp ${rpS(pph)}</div><div class="s">Belum lunas: ${belumN} trx · Rp ${rpS(belum)}<br><span class="small">(data migrasi tidak dihitung)</span></div></div>
  </div>
  <div class="card tight"><div class="card-h"><h2 style="margin:0">Penjualan per bulan — ${F.tahun}</h2><button class="sm" id="xBeranda">Unduh Excel</button></div>
  <div class="tw"><table class="mx"><thead><tr><th>CV</th>${BLN3.map(b => `<th class="num">${b}</th>`).join("")}<th class="num">Total</th></tr></thead><tbody>
  ${cvs.map(c => `<tr><td><span class="b ${c}">${c}</span></td>${m[c].map(v => `<td class="num ${v ? "" : "z"}">${v ? rp(v) : "–"}</td>`).join("")}<td class="num"><b>${rp(m[c].reduce((a, b) => a + b, 0))}</b></td></tr>`).join("")}
  <tr class="tot"><td>Total</td>${colTot.map(v => `<td class="num">${v ? rp(v) : "–"}</td>`).join("")}<td class="num">${rp(tot)}</td></tr>
  <tr><td class="sub">Grafik</td>${colTot.map(v => `<td style="vertical-align:bottom"><div class="bar" style="width:100%;height:${Math.round(4 + 46 * v / maxM)}px"></div></td>`).join("")}<td></td></tr>
  </tbody></table></div></div>
  <div class="card tight"><div class="card-h"><h2 style="margin:0">Per kanal</h2></div><div class="tw"><table class="mx"><thead><tr><th>Kanal</th>${cvs.map(c => `<th class="num">${c}</th>`).join("")}<th class="num">Total</th></tr></thead><tbody>
  ${Object.keys(KANAL).map(k => { const r = perKanal[k] || {}; const s = cvs.reduce((a, c) => a + (r[c] || 0), 0); return `<tr><td><span class="b ${k}">${KANAL[k].label}</span></td>${cvs.map(c => `<td class="num ${r[c] ? "" : "z"}">${r[c] ? rp(r[c]) : "–"}</td>`).join("")}<td class="num"><b>${s ? rp(s) : "–"}</b></td></tr>`; }).join("")}
  </tbody></table></div></div>
  <div class="card tight"><div class="card-h"><h2 style="margin:0">Transaksi terbaru</h2><a href="#/transaksi">Lihat semua →</a></div>${tabelTrx(S.data.transaksi.slice().sort((a, b) => (b.dibuat || "").localeCompare(a.dibuat || "") || b.id - a.id).slice(0, 8))}</div>`;
  $("#fTahun").onchange = e => { F.tahun = e.target.value; render(); };
  $("#fKanal").onchange = e => { F.kanal = e.target.value; render(); };
  $("#xBeranda").onclick = () => exportBulanan(F.tahun, F.kanal);
  bindTrxRows(el);
}

function tabelTrx(list) {
  if (!list.length) return `<p class="mute" style="padding:16px">Belum ada transaksi.</p>`;
  return `<div class="tw"><table><thead><tr><th>Tanggal</th><th>CV</th><th>Kanal</th><th>Satker / instansi</th><th>No. transaksi</th><th class="num">Item</th><th class="num">Total (inc. PPN)</th><th class="num">PPh</th><th>Status</th></tr></thead><tbody>
  ${list.map(t => { const h = hitung(t); const s = satkerById(t.satkerId); return `<tr class="click" data-id="${t.id}"><td class="nowrap">${t.tanggal ? tgl(t.tanggal) : '<span class="b warn">tanpa tgl</span>'}</td><td><span class="b ${t.cv}">${t.cv}</span></td><td><span class="b ${t.kanal}">${KANAL[t.kanal] ? KANAL[t.kanal].label : t.kanal}</span></td><td>${esc(s.singkat || s.nama)}<div class="sub small mute">${esc(s.nama)}</div></td><td class="small">${esc(t.noTrx || "–")}${t.noSJ ? `<div class="mute">SJ ${esc(t.noSJ)}</div>` : ""}</td><td class="num">${t.items.length}</td><td class="num"><b>${rp(h.total)}</b>${t.noPPN ? '<div><span class="b warn">tanpa PPN</span></div>' : ""}</td><td class="num">${rp(h.pph)}${(t.noPPh22 && h.adaB) || (t.noPPh23 && h.adaJ) ? '<div><span class="b warn">tanpa PPh</span></div>' : ""}</td><td><span class="b ${t.status}">${STATUS[t.status] || t.status}</span></td></tr>`; }).join("")}
  </tbody></table></div>`;
}
function bindTrxRows(el) { $$("tr.click[data-id]", el).forEach(tr => tr.onclick = () => location.hash = "#/trx/" + tr.dataset.id); }

// ================================================================ DAFTAR TRANSAKSI
function filterTrx(F) {
  const q = P.norm(F.q || "");
  return S.data.transaksi.filter(t => {
    if (F.tanpaTgl) return !t.tanggal;
    if (F.tahun && !t.tanggal.startsWith(F.tahun)) return false;
    if (F.bulan && t.tanggal.slice(5, 7) !== F.bulan) return false;
    if (F.cv && t.cv !== F.cv) return false;
    if (F.kanal && t.kanal !== F.kanal) return false;
    if (F.status && t.status !== F.status) return false;
    if (F.satker && t.satkerId !== +F.satker) return false;
    if (q) {
      const s = satkerById(t.satkerId);
      const h = P.norm([t.noTrx, t.noSJ, t.kodeAkun, t.ppk, t.pemesan, s.nama, s.singkat, t.catatan].concat(t.items.map(i => i.nama)).join(" "));
      if (!q.split(" ").every(w => h.includes(w))) return false;
    }
    return true;
  }).sort((a, b) => (b.tanggal || "9").localeCompare(a.tanggal || "9") || b.id - a.id);
}

function pgTransaksi(el) {
  const F = S.filters.trx = S.filters.trx || { tahun: tahunList()[0] };
  const list = filterTrx(F);
  let sum = { total: 0, dpp: 0, ppn: 0, pph: 0, bersih: 0 };
  list.forEach(t => { const h = hitung(t); for (const k in sum) sum[k] += h[k]; });
  const satkerUsed = Array.from(new Set(S.data.transaksi.map(t => t.satkerId))).map(satkerById).filter(s => s.id).sort((a, b) => a.nama.localeCompare(b.nama));
  el.innerHTML = `
  <div class="topbar"><div><h1>Transaksi</h1><div class="mute">${list.length} transaksi · total Rp ${rp(sum.total)} · PPh Rp ${rp(sum.pph)}</div></div>
    <div class="row"><button id="bPdf">Impor PDF INAPROC / Mbizmarket</button><button id="bDigi">Tempel dari Digipay</button><button class="pri" onclick="location.hash='#/trx/baru'">+ Transaksi baru</button></div></div>
  <div class="card"><div class="filters">
    <label class="f"><span>Tahun</span><select id="f_tahun"><option value="">Semua</option>${tahunList().map(y => `<option ${y === F.tahun ? "selected" : ""}>${y}</option>`).join("")}</select></label>
    <label class="f"><span>Bulan</span><select id="f_bulan">${optList(Object.fromEntries(BULAN.map((b, i) => [String(i + 1).padStart(2, "0"), b])), F.bulan, "Semua")}</select></label>
    <label class="f"><span>CV</span><select id="f_cv">${optList(cvOpts(), F.cv, "Semua")}</select></label>
    <label class="f"><span>Kanal</span><select id="f_kanal">${optList(kanalOpts(), F.kanal, "Semua")}</select></label>
    <label class="f"><span>Status</span><select id="f_status">${optList(STATUS, F.status, "Semua")}</select></label>
    <label class="f"><span>Satker</span><select id="f_satker" style="max-width:220px">${optList(Object.fromEntries(satkerUsed.map(s => [String(s.id), s.singkat || s.nama])), F.satker, "Semua")}</select></label>
    <label class="f" style="flex:1;min-width:200px"><span>Cari (no. invoice, barang, PPK, SJ…)</span><input id="f_q" value="${esc(F.q || "")}" placeholder="ketik lalu Enter"></label>
    <button id="fReset" class="ghost">Reset</button><button id="xList">Unduh Excel</button>
  </div>${F.tanpaTgl ? `<div class="alert warn" style="margin:10px 0 0">Menampilkan transaksi tanpa tanggal. Buka satu per satu, isi tanggal, lalu simpan.</div>` : ""}</div>
  <div class="card tight">${tabelTrx(list)}</div>`;
  ["tahun", "bulan", "cv", "kanal", "status", "satker"].forEach(k => $("#f_" + k).onchange = e => { F[k] = e.target.value; F.tanpaTgl = 0; render(); });
  $("#f_q").onkeydown = e => { if (e.key === "Enter") { F.q = e.target.value; render(); } };
  $("#fReset").onclick = () => { S.filters.trx = { tahun: tahunList()[0] }; render(); };
  $("#xList").onclick = () => exportDaftar(list, F);
  $("#bPdf").onclick = dlgImporPdf;
  $("#bDigi").onclick = dlgDigipay;
  bindTrxRows(el);
}

// ================================================================ FORM TRANSAKSI
function trxBaru(base) {
  const k = (base && base.kanal) || "DIGIPAY";
  return Object.assign({ id: 0, cv: "", kanal: k, satkerId: 0, tanggal: today(), noTrx: "", status: "proses", inclPPN: KANAL[k].incl, wapu: true, platformFee: 0, items: [], lampiran: [] }, base || {});
}

function nomorSJ(t) {
  const cv = S.data.cv.find(c => c.kode === t.cv);
  const fmt = (cv && cv.formatSJ) || "S{MM}{YY}-20{NN}";
  const d = t.tanggal || today();
  const pre = fmt.replace("{MM}", d.slice(5, 7)).replace("{YY}", d.slice(2, 4)).replace("{YYYY}", d.slice(0, 4));
  const head = pre.split("{NN}")[0];
  let max = 0;
  S.data.transaksi.forEach(x => {
    if (x.id === t.id || !x.noSJ || x.cv !== t.cv || !x.noSJ.startsWith(head)) return;
    const n = parseInt(x.noSJ.slice(head.length), 10); if (n > max) max = n;
  });
  return pre.replace("{NN}", String(max + 1).padStart(2, "0"));
}

function pgForm(el, arg) {
  let t;
  if (arg === "baru") t = S.draft ? S.draft : trxBaru();
  else { const x = S.data.transaksi.find(x => String(x.id) === arg); if (!x) { el.innerHTML = `<div class="alert err">Transaksi tidak ditemukan.</div>`; return; } t = clone(x); }
  const pending = (S.draft && S.draft._files) || [];
  const info = S.draft && S.draft._info;
  S.draft = null;
  const T = t; T._files = pending;
  if (T.wapu == null) T.wapu = true;
  S.formDirty = arg === "baru" && (T.items.length > 0);

  const kf = () => T.kanal;
  const field = (key, label, attrs) => `<label class="f"><span>${label}</span><input data-k="${key}" value="${esc(T[key] || "")}" ${attrs || ""}></label>`;
  const dfield = (key, label) => `<label class="f"><span>${label}</span><input type="date" data-k="${key}" value="${esc(T[key] || "")}"></label>`;
  const extra = () => {
    const k = kf();
    if (k === "DIGIPAY") return field("kodeAkun", "Kode akun anggaran", 'placeholder="CS.7971.BAH.521811.D"') + field("noDok", "No. Dok") + field("ppk", "Nama PPK") + field("pemesan", "Nama pemesan") + field("metodeBayar", "Metode bayar", 'placeholder="VA"') + dfield("tglKirim", "Tanggal kirim") + dfield("tglBayar", "Tanggal dibayar");
    if (k === "INAPROC") return field("ppk", "PPK / penanggung jawab") + field("rup", "No. RUP") + field("sumberDana", "Sumber dana / MAK") + dfield("tglSP", "Tanggal SP/SPK") + dfield("tglKirim", "Tanggal kirim") + dfield("tglBAST", "Tanggal BAST") + dfield("tglBayar", "Tanggal dibayar") + field("kodeAkun", "Kode akun anggaran");
    if (k === "MBIZ") return field("noQuotation", "No. Quotation") + field("namaPaket", "Nama paket") + field("rup", "No. RUP") + field("sumberDana", "Sumber dana") + `<label class="f"><span>Tipe pembayaran</span><select data-k="tipeBayar">${optList({ "": "–", "CASH BEFORE DELIVERY(CBD)": "CBD (bayar sebelum kirim)", "TERM OF PAYMENT (TOP)": "TOP (tempo)" }, T.tipeBayar || "")}</select></label>` + field("noBayar", "No. pembayaran") + dfield("tglBayar", "Tanggal dibayar") + dfield("tglKirim", "Tanggal kirim") + `<label class="f"><span>Platform fee (Rp)</span><input data-k="platformFee" type="number" min="0" step="1" value="${T.platformFee || 0}"></label>`;
    return field("ppk", "PPK / pemesan") + field("rup", "No. RUP") + field("sumberDana", "Sumber dana / MAK") + dfield("tglSP", "Tanggal SP/SPK") + dfield("tglKirim", "Tanggal kirim") + dfield("tglBAST", "Tanggal BAST") + dfield("tglBayar", "Tanggal dibayar");
  };

  const s0 = T.satkerId ? satkerById(T.satkerId) : null;
  el.innerHTML = `
  <div class="topbar"><div><h1>${T.id ? "Transaksi #" + T.id : "Transaksi baru"}</h1><div class="mute small">${T.id ? `Dibuat ${esc(T.dibuat || "")} oleh ${esc(T.dibuatOleh || "")}${T.diubah ? ` · diubah ${esc(T.diubah)} oleh ${esc(T.diubahOleh)}` : ""}` : "Isi data dari invoice / surat pesanan"}</div></div>
    <div class="row noprint"><a class="btn" href="#/transaksi">← Kembali</a>${T.id ? `<button id="bPrint">Cetak</button><button id="bCopy">Duplikat</button>${S.data.me.role === "admin" ? `<button class="danger" id="bDel">Hapus</button>` : ""}` : ""}<button class="pri" id="bSave">Simpan</button></div></div>
  ${info ? `<div class="alert ${info.cls}">${info.html}</div>` : ""}
  <div class="card"><div class="grid g4">
    <label class="f"><span>CV *</span><select data-k="cv"><option value="">— pilih —</option>${S.data.cv.map(c => `<option value="${c.kode}" ${c.kode === T.cv ? "selected" : ""}>${c.kode} — ${esc(c.nama)}</option>`).join("")}</select></label>
    <label class="f"><span>Kanal *</span><select data-k="kanal">${optList(kanalOpts(), T.kanal)}</select></label>
    <label class="f span2"><span>Satker / instansi *</span><input id="iSatker" value="${esc(s0 ? s0.nama : (T._satkerNama || ""))}" placeholder="ketik nama atau kode satker…" autocomplete="off"><div class="small mute" id="satInfo">${s0 ? satInfo(s0) : (T._satkerNama ? `<span class="b warn">belum ada di master</span> <a href="#" id="addSat">+ Tambahkan "${esc(T._satkerNama)}"</a>` : "")}</div></label>
    <label class="f"><span>Tanggal transaksi * <span class="mute">(masuk rekap bulan ini)</span></span><input type="date" data-k="tanggal" value="${esc(T.tanggal || "")}"></label>
    <label class="f span2"><span id="lblNo">${KANAL[T.kanal].no}</span><input data-k="noTrx" value="${esc(T.noTrx || "")}" placeholder="${KANAL[T.kanal].ph}"></label>
    <label class="f"><span>Status</span><select data-k="status">${optList(STATUS, T.status)}</select></label>
    <label class="f"><span>No. surat jalan</span><div class="row" style="flex-wrap:nowrap"><input data-k="noSJ" value="${esc(T.noSJ || "")}" placeholder="S1026-2058"><button class="sm" id="bSJ" title="Buat nomor otomatis">Auto</button></div></label>
  </div>
  <div class="grid g4" id="extra">${extra()}</div>
  <div class="pajakbox"><div class="ttl">Pajak untuk transaksi ini</div>
    <div class="row" style="gap:6px 22px;align-items:flex-start">
      <div><label class="check"><input type="checkbox" data-k="noPPN" data-neg="1" ${!T.noPPN ? "checked" : ""}> <b>Kenakan PPN ${S.data.settings.ppn}%</b></label>
        <div class="sub-opt"><label class="check"><input type="checkbox" data-k="inclPPN" ${T.inclPPN ? "checked" : ""} ${T.noPPN ? "disabled" : ""}> Harga sudah termasuk PPN</label>
        <label class="check"><input type="checkbox" data-k="wapu" ${T.wapu !== false ? "checked" : ""} ${T.noPPN ? "disabled" : ""}> PPN dipungut instansi (WAPU)</label></div></div>
      <div><label class="check"><input type="checkbox" data-k="noPPh22" data-neg="1" ${!T.noPPh22 ? "checked" : ""}> <b>Potong PPh 22</b> — barang ${fmtN(S.data.settings.pph22)}%</label>
        <label class="check"><input type="checkbox" data-k="noPPh23" data-neg="1" ${!T.noPPh23 ? "checked" : ""}> <b>Potong PPh 23</b> — jasa ${fmtN(S.data.settings.pph23)}%</label></div>
      <div class="small mute" style="max-width:300px">Hilangkan centang bila pajak tersebut tidak berlaku untuk invoice ini (mis. CV non-PKP, instansi tidak memotong PPh, atau pembelian di bawah batas).</div>
    </div></div>
  <label class="f"><span>Catatan</span><textarea data-k="catatan" style="min-height:44px">${esc(T.catatan || "")}</textarea></label>
  </div>
  <div class="card tight"><div class="card-h"><h2 style="margin:0">Barang / jasa <span class="mute small" id="cnt"></span></h2>
    <div class="row noprint"><button class="sm ghost" id="bKeys" title="Daftar shortcut (?)">⌨ Shortcut</button><button class="sm" id="bPaste">Tempel dari Excel / Digipay</button><button class="sm" id="bAdd" title="Ctrl+Enter / F2">+ Tambah baris</button></div></div>
    <div class="tw"><table class="items"><thead><tr><th class="c-no">No</th><th>Nama barang (cari dari master)</th><th class="c-qty num">Qty</th><th class="c-sat">Satuan</th><th class="c-hrg num">Harga satuan</th><th class="c-jen">Jenis</th><th class="c-tot num">Jumlah</th><th class="c-x"></th></tr></thead><tbody id="tbItems"></tbody></table></div>
    <div class="items-foot noprint"><button class="sm" id="bAdd2">+ Tambah baris</button><span class="small mute"><kbd>Enter</kbd> lanjut ke kolom berikutnya · <kbd>Ctrl</kbd>+<kbd>Enter</kbd> baris baru · <kbd>Ctrl</kbd>+<kbd>D</kbd> duplikat · <kbd>Ctrl</kbd>+<kbd>Del</kbd> hapus baris · <kbd>Ctrl</kbd>+<kbd>S</kbd> simpan · <kbd>?</kbd> bantuan</span></div>
    <div class="row" style="padding:12px 16px;justify-content:space-between;align-items:flex-start">
      <div style="flex:1;min-width:260px" class="noprint"><h3>Lampiran <span class="mute small">(screenshot Digipay / PDF pesanan)</span></h3><div id="lamp"></div>
        <div class="row" style="margin-top:8px"><label class="btn sm" style="cursor:pointer">+ Tambah file<input type="file" id="fLamp" accept="image/*,application/pdf" multiple hidden></label><span class="small mute">atau tempel gambar (Ctrl+V) di halaman ini</span></div></div>
      <div class="sumbox" id="sum"></div>
    </div>
  </div>
  <div class="savebar noprint"><div id="saveInfo"></div><div class="row"><a class="btn" href="#/transaksi">Kembali</a><button class="pri" id="bSave2">Simpan <kbd>Ctrl+S</kbd></button></div></div>`;

  // --- binding field header
  $$("[data-k]", el).filter(i => !i.closest("#extra")).forEach(inp => {
    const k = inp.dataset.k;
    const ev = inp.tagName === "SELECT" || inp.type === "checkbox" || inp.type === "date" ? "change" : "input";
    inp.addEventListener(ev, () => {
      S.formDirty = true;
      T[k] = inp.type === "checkbox" ? (inp.dataset.neg ? !inp.checked : inp.checked) : inp.type === "number" ? Number(inp.value) : inp.value;
      if (k === "noPPN") { $("[data-k=inclPPN]").disabled = T.noPPN; $("[data-k=wapu]").disabled = T.noPPN; }
      if (k === "kanal") { T.inclPPN = KANAL[T.kanal].incl; $("[data-k=inclPPN]").checked = T.inclPPN; $("#extra").innerHTML = extra(); bindExtra(); $("#lblNo").textContent = KANAL[T.kanal].no; $("[data-k=noTrx]").placeholder = KANAL[T.kanal].ph; }
      if (k === "noTrx" && T.kanal === "DIGIPAY") autoDigi();
      upd();
    });
  });
  function bindExtra() {
    $$("#extra [data-k]").forEach(inp => {
      const k = inp.dataset.k;
      inp.addEventListener(inp.tagName === "SELECT" || inp.type === "date" ? "change" : "input", () => { S.formDirty = true; T[k] = inp.type === "number" ? Number(inp.value) : inp.value; upd(); });
    });
  }
  function autoDigi() {
    const m = (T.noTrx || "").match(/^(\d{6})\/\d{2}\/(\d{4})(\d{2})(\d{2})\//);
    if (!m) return;
    const s = S.data.satker.find(s => s.kodeSatker === m[1]);
    if (s && !T.satkerId) setSatker(s);
    if (!T.tanggal || T.tanggal === today()) { T.tanggal = `${m[2]}-${m[3]}-${m[4]}`; $("[data-k=tanggal]").value = T.tanggal; }
  }
  function setSatker(s) {
    T.satkerId = s.id; T._satkerNama = "";
    $("#iSatker").value = s.nama; $("#satInfo").innerHTML = satInfo(s);
    if (s.wapu === false) { T.wapu = false; $("[data-k=wapu]").checked = false; }
    upd();
  }
  combo($("#iSatker"), q => cariSatker(q).map(s => ({ label: s.nama, sub: [s.singkat, s.kodeBPN, s.kodeSatker && "Digipay " + s.kodeSatker, s.grup].filter(Boolean).join(" · "), s })), it => { S.formDirty = true; setSatker(it.s); });
  $("#iSatker").addEventListener("input", () => { T.satkerId = 0; T._satkerNama = $("#iSatker").value; $("#satInfo").innerHTML = `<a href="#" id="addSat">+ Tambahkan "${esc(T._satkerNama)}" ke master satker</a>`; bindAddSat(); });
  function bindAddSat() {
    const a = $("#addSat"); if (!a) return;
    a.onclick = e => { e.preventDefault(); dlgSatker({ nama: T._satkerNama.toUpperCase(), grup: /PERTANAHAN|BPN/i.test(T._satkerNama) ? "BPN" : "Lainnya", kodeSatker: T._kodeSatker || "", wapu: true }, s => setSatker(s)); };
  }
  bindAddSat(); bindExtra();
  $("#bSJ").onclick = e => { e.preventDefault(); if (!T.cv) return toast("Pilih CV dulu.", true); T.noSJ = nomorSJ(T); $("[data-k=noSJ]").value = T.noSJ; S.formDirty = true; };

  // --- items
  // ---- tabel barang: selalu ada 1 baris kosong di bawah (seperti Excel), alur Enter, shortcut keyboard
  const kosong = it => !String(it.nama || "").trim() && !it.barangId && !Number(it.harga);
  const isiItems = () => T.items.filter(it => !kosong(it));
  const barisBaru = () => ({ barangId: 0, nama: "", qty: 1, satuan: "", harga: 0, jenis: "B" });
  function pastikanKosong() {
    // buang baris kosong di tengah, sisakan tepat satu di paling bawah
    T.items = T.items.filter((it, i) => !kosong(it) || i === T.items.length - 1);
    if (!T.items.length || !kosong(T.items[T.items.length - 1])) T.items.push(barisBaru());
  }
  function rowHTML(it, i) {
    const b = it.barangId ? S.idx.barang[it.barangId] : null, k = kosong(it);
    let hint = "";
    if (b) hint = `<div class="hint ok">✓ master: ${esc(b.nama)}${b.kode ? " · " + esc(b.kode) : ""} · Rp ${rp(b.harga)}/${esc(b.satuan)}</div>`;
    else if (it._saran) hint = `<div class="hint warn">Mirip: ${esc(it._saran.nama)} <a href="#" data-pakai="${i}">pakai</a></div>`;
    else if (it.nama) hint = `<div class="hint warn">belum terhubung ke master barang</div>`;
    return `<tr data-i="${i}" class="${k ? "kosong" : ""}"><td class="c-no">${k ? "+" : i + 1}</td>
      <td><input class="iNama" data-c="0" value="${esc(it.nama)}" placeholder="${k ? (i ? "ketik barang berikutnya…  (F2)" : "ketik nama / kode barang…") : ""}" autocomplete="off">${hint}</td>
      <td><input class="iQty num" data-c="1" type="number" min="0" step="any" value="${k ? "" : (it.qty || "")}" placeholder="${k ? "" : "0"}"></td>
      <td><input class="iSat" data-c="2" value="${esc(it.satuan || "")}" list="dlSat"></td>
      <td><input class="iHrg num" data-c="3" type="number" min="0" step="any" value="${it.harga || ""}"></td>
      <td><select class="iJen" data-c="4"><option value="B" ${it.jenis !== "J" ? "selected" : ""}>Barang</option><option value="J" ${it.jenis === "J" ? "selected" : ""}>Jasa</option></select></td>
      <td class="num c-tot">${k ? "" : rp((it.qty || 0) * (it.harga || 0))}</td>
      <td>${k ? "" : `<button class="sm ghost danger iDel" tabindex="-1" title="Hapus baris (Ctrl+Delete)">✕</button>`}</td></tr>`;
  }
  const sel = (r, c) => $(`#tbItems tr[data-i="${r}"] [data-c="${c}"]`);
  function fokus(r, c) {
    const e = sel(Math.max(0, Math.min(T.items.length - 1, r)), c);
    if (!e) return;
    e.focus();
    if (e.select && e.tagName === "INPUT") try { e.select(); } catch (x) { /* */ }
  }
  function posisiAktif() {
    const a = document.activeElement, tr = a && a.closest && a.closest("#tbItems tr");
    return tr ? { r: +tr.dataset.i, c: +(a.dataset.c || 0), el: a } : null;
  }
  function cntInfo() {
    const isi = isiItems(), nb = isi.filter(it => !it.barangId).length;
    $("#cnt").innerHTML = `${isi.length} baris` + (nb ? ` · <span class="b warn">${nb} belum terhubung ke master</span>` : isi.length ? ` · <span class="b ok">semua cocok master</span>` : "");
  }
  // baris kosong terakhir mulai diisi -> tambahkan baris kosong baru tanpa menggambar ulang (fokus tidak hilang)
  function tambahKosongBila() {
    const last = T.items[T.items.length - 1];
    if (kosong(last)) return;
    T.items.push(barisBaru());
    const i = T.items.length - 1;
    const tmp = document.createElement("tbody"); tmp.innerHTML = rowHTML(T.items[i], i);
    const tr = tmp.firstElementChild; $("#tbItems").insertBefore(tr, $("#dlSat"));
    const prev = $(`#tbItems tr[data-i="${i - 1}"]`);
    if (prev) { prev.classList.remove("kosong"); $(".c-no", prev).textContent = i; const d = prev.lastElementChild; if (!d.innerHTML.trim()) { d.innerHTML = `<button class="sm ghost danger iDel" tabindex="-1" title="Hapus baris (Ctrl+Delete)">✕</button>`; $(".iDel", d).onclick = () => hapusBaris(i - 1); } }
    ikatBaris(tr);
  }
  function hapusBaris(i) {
    if (i < 0 || i >= T.items.length || kosong(T.items[i])) return;
    T.items.splice(i, 1); S.formDirty = true; drawItems(); upd();
  }
  function duplikatBaris(i) {
    const it = T.items[i]; if (!it || kosong(it)) return;
    const c = clone(it); delete c._saran;
    T.items.splice(i + 1, 0, c); S.formDirty = true; drawItems(); upd(); fokus(i + 1, 0);
    toast("Baris diduplikat — ganti nama barangnya");
  }
  function ikatBaris(tr) {
    const i = +tr.dataset.i, it = T.items[i];
    const bm = it.barangId && S.idx.barang[it.barangId];
    if (bm && it._hMaster == null) { if (bm.harga === Number(it.harga)) it._hMaster = bm.harga; if (bm.satuan === it.satuan) it._sMaster = bm.satuan; }
    const q = $(".iNama", tr);
    q.dataset.openEmpty = "1";
      combo(q, v => {
        const r = cariBarangX(v), max = 150;
        const items = r.list.slice(0, max).map(b => ({ b, label: b.nama, html: tandai(b.nama, r.toks),
          sub: `${b.kode ? (r.kode ? "<mark>" + esc(b.kode) + "</mark>" : esc(b.kode)) + " · " : ""}${b.merk ? esc(b.merk) + " · " : ""}<b>Rp ${rp(b.harga)}</b> / ${esc(b.satuan)}${b.jenis === "J" ? ' · <span class="b warn">JASA</span>' : ""}${b._use ? ` · dipakai ${b._use}×` : ""}`, subHtml: true }));
        const header = r.kode === "persis" ? `Kode "${esc(r.q)}" — ${r.total} barang (cocok persis)`
          : r.kode === "awal" ? `Kode berawalan "${esc(r.q)}" — ${r.total} barang`
          : r.sering ? (items.length ? "Sering dipakai — atau ketik nama / kode / merk" : "")
          : r.total ? `${r.total} barang cocok "${esc(v.trim())}"${r.total > max ? ` — tampil ${max}, ketik lebih spesifik` : ""}`
          : `Tidak ada di master untuk "${esc(v.trim())}". Nama tetap bisa dipakai, atau tambah lewat Master Barang.`;
        return { items, header };
      }, pilih => {
        const b = pilih.b; S.formDirty = true;
        const katalog = it.nama && P.pecahKatalog(it.nama).katalog;
        it.barangId = b.id; it.nama = katalog ? it.nama : b.nama; it.jenis = b.jenis || "B";
        // harga/satuan ikut barang baru, kecuali sudah diubah manual (beda dari harga master sebelumnya)
        if (!it.satuan || it.satuan === it._sMaster) it.satuan = b.satuan;
        if (!it.harga || it.harga === it._hMaster) it.harga = b.harga;
        it._hMaster = b.harga; it._sMaster = b.satuan;
        if (!it.qty) it.qty = 1;
        delete it._saran; drawItems(); upd();
        fokus(i, 1); // langsung ke Qty
      });
    q.addEventListener("input", () => { it.nama = q.value; it.barangId = 0; S.formDirty = true; if (i === T.items.length - 1) tambahKosongBila(); cntInfo(); });
    const qty = $(".iQty", tr), hrg = $(".iHrg", tr);
    qty.addEventListener("input", e => { it.qty = Number(e.target.value); S.formDirty = true; $(".c-tot", tr).textContent = rp(it.qty * (it.harga || 0)); upd(); });
    hrg.addEventListener("input", e => { it.harga = Number(e.target.value); S.formDirty = true; $(".c-tot", tr).textContent = rp((it.qty || 0) * it.harga); if (i === T.items.length - 1) tambahKosongBila(); upd(); });
    $(".iSat", tr).addEventListener("input", e => { it.satuan = e.target.value.toUpperCase(); S.formDirty = true; });
    $(".iJen", tr).addEventListener("change", e => { it.jenis = e.target.value; S.formDirty = true; upd(); });
    // angka terblok saat fokus, supaya bisa langsung diketik ulang; scroll mouse tidak mengubah angka
    [qty, hrg].forEach(x => { x.addEventListener("focus", () => {
      try { x.select(); } catch (er) { /* */ }
      const v = x.value; // klik mouse bisa membatalkan blok saat mouseup: ulangi bila belum diketik
      setTimeout(() => { if (document.activeElement === x && x.value === v) try { x.select(); } catch (er) { /* */ } }, 0);
    }); x.addEventListener("wheel", ev => { if (document.activeElement === x) ev.preventDefault(); }, { passive: false }); });
    const d = $(".iDel", tr); if (d) d.onclick = () => hapusBaris(i);
    const pk = $("[data-pakai]", tr);
    if (pk) pk.onclick = e => { e.preventDefault(); const b = it._saran; it.barangId = b.id; it.jenis = b.jenis || "B"; if (!it.satuan) it.satuan = b.satuan; delete it._saran; S.formDirty = true; drawItems(); upd(); };
    // alur Enter: Barang -> Qty -> Harga -> baris berikutnya
    tr.addEventListener("keydown", e => {
      if (e.defaultPrevented || e.ctrlKey || e.altKey || e.metaKey) return;
      const c = +(e.target.dataset.c ?? -1);
      if (e.key === "Enter") {
        if (c === 0) {
          if (!String(it.nama).trim()) { if (i > 0) toast("Baris kosong dilewati. Ctrl+S untuk simpan."); return; }
          e.preventDefault(); fokus(i, 1);
        } else if (c === 1 || c === 2) { e.preventDefault(); fokus(i, 3); }
        else if (c === 3 || c === 4) { e.preventDefault(); pastikanKosongTanpaGambar(); fokus(i + 1, 0); }
      } else if ((e.key === "ArrowDown" || e.key === "ArrowUp") && (c === 1 || c === 3)) {
        e.preventDefault(); fokus(i + (e.key === "ArrowDown" ? 1 : -1), c); // ↑/↓ di Qty & Harga = pindah baris
      }
    });
  }
  function pastikanKosongTanpaGambar() { if (!kosong(T.items[T.items.length - 1])) tambahKosongBila(); }
  function drawItems() {
    pastikanKosong();
    $("#tbItems").innerHTML = T.items.map(rowHTML).join("") + `<datalist id="dlSat">${["PCS", "BUAH", "RIM", "PAK", "BOX", "LUSIN", "SET", "ROLL", "UNIT", "PAD", "BOTOL", "TUBE", "LEMBAR", "KALI", "PAKET"].map(s => `<option>${s}</option>`).join("")}</datalist>`;
    $$("#tbItems tr").forEach(ikatBaris);
    cntInfo();
  }
  function upd() {
    const h = hitung(T);
    const p = S.data.settings;
    $("#sum").innerHTML = `
      <div class="ln"><span>Jumlah harga (${isiItems().length} baris)</span><span>${rp(h.bruto)}</span></div>
      <div class="ln"><span>DPP</span><span>${rp(h.dpp)}</span></div>
      ${h.pakaiPPN ? `<div class="ln"><span>PPN ${p.ppn}% ${h.incl ? "(sudah di dalam harga)" : ""}</span><span>${rp(h.ppn)}</span></div>` : `<div class="ln"><span>PPN</span><span class="b warn">tidak dikenakan</span></div>`}
      <div class="ln big"><span>TOTAL TRANSAKSI</span><span>Rp ${rp(h.total)}</span></div>
      ${h.pph22 ? `<div class="ln minus"><span>PPh 22 barang ${fmtN(p.pph22)}%</span><span>(${rp(h.pph22)})</span></div>` : T.noPPh22 && h.adaB ? `<div class="ln"><span>PPh 22</span><span class="b warn">tidak dipotong</span></div>` : ""}
      ${h.pph23 ? `<div class="ln minus"><span>PPh 23 jasa ${fmtN(p.pph23)}%</span><span>(${rp(h.pph23)})</span></div>` : T.noPPh23 && h.adaJ ? `<div class="ln"><span>PPh 23</span><span class="b warn">tidak dipotong</span></div>` : ""}
      ${h.wapu ? `<div class="ln minus"><span>PPN dipungut instansi</span><span>(${rp(h.ppn)})</span></div>` : ""}
      ${h.fee ? `<div class="ln minus"><span>Platform fee</span><span>(${rp(h.fee)})</span></div>` : ""}
      <div class="ln net"><span>Diterima bersih</span><span>Rp ${rp(h.bersih)}</span></div>
      ${T._cek ? cekLine(T._cek, h) : ""}`;
    const sb = $("#saveInfo"); if (sb) sb.innerHTML = `<b>Rp ${rp(h.total)}</b> <span class="mute">· ${isiItems().length} barang · bersih Rp ${rp(h.bersih)}</span>`;
  }
  function addRow() { pastikanKosong(); drawItems(); fokus(T.items.length - 1, 0); }
  $("#bAdd").onclick = addRow;
  $("#bAdd2").onclick = addRow;
  $("#bKeys").onclick = bantuanShortcut;
  $("#bPaste").onclick = () => dlgTempelItem(rows => { T.items = isiItems().concat(rows); S.formDirty = true; drawItems(); upd(); });
  drawItems(); upd();

  // ---- shortcut keyboard halaman form
  S._keyH = e => {
    if ($(".modal-bg")) return;
    const k = e.key, pos = posisiAktif();
    const mengetik = /INPUT|TEXTAREA|SELECT/.test((document.activeElement || {}).tagName || "");
    if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === "s") { e.preventDefault(); $("#bSave").click(); return; }
    if ((e.ctrlKey || e.metaKey) && k === "Enter") { e.preventDefault(); addRow(); return; }
    if (k === "F2") { e.preventDefault(); addRow(); return; }
    if (pos && (e.ctrlKey || e.metaKey) && (k === "Delete" || k === "Backspace" && e.shiftKey)) { e.preventDefault(); const r = pos.r, c = pos.c; hapusBaris(r); fokus(r, c); return; }
    if (pos && (e.ctrlKey || e.metaKey) && k.toLowerCase() === "d") { e.preventDefault(); duplikatBaris(pos.r); return; }
    if (pos && e.altKey && (k === "ArrowDown" || k === "ArrowUp")) { e.preventDefault(); fokus(pos.r + (k === "ArrowDown" ? 1 : -1), pos.c); return; }
    if (k === "?" && !mengetik) { e.preventDefault(); bantuanShortcut(); }
  };
  document.addEventListener("keydown", S._keyH);

  // --- lampiran
  function drawLamp() {
    const saved = (T.lampiran || []).map(n => `<div class="th">${/\.pdf$/i.test(n) ? `<a href="/lampiran/${encodeURIComponent(n)}" target="_blank">📄 ${esc(n.split("_").slice(2).join("_"))}</a>` : `<a href="/lampiran/${encodeURIComponent(n)}" target="_blank"><img src="/lampiran/${encodeURIComponent(n)}"></a>`}<button class="sm ghost danger" data-hl="${esc(n)}">✕</button></div>`);
    const pend = T._files.map((f, i) => `<div class="th">${f.type.startsWith("image/") ? `<img src="${URL.createObjectURL(f)}">` : "📄 " + esc(f.name)}<div class="mute">belum disimpan</div><button class="sm ghost danger" data-hp="${i}">✕</button></div>`);
    $("#lamp").innerHTML = saved.length + pend.length ? `<div class="thumbs">${saved.join("")}${pend.join("")}</div>` : `<span class="small mute">Belum ada lampiran.</span>`;
    $$("[data-hp]").forEach(b => b.onclick = () => { T._files.splice(+b.dataset.hp, 1); drawLamp(); });
    $$("[data-hl]").forEach(b => b.onclick = async () => {
      if (!(await confirmBox("Hapus lampiran ini?", "Hapus"))) return;
      await api("/api/lampiran/hapus", { id: T.id, name: b.dataset.hl });
      T.lampiran = T.lampiran.filter(n => n !== b.dataset.hl);
      const x = S.data.transaksi.find(x => x.id === T.id); if (x) x.lampiran = T.lampiran;
      drawLamp();
    });
  }
  $("#fLamp").onchange = e => { Array.from(e.target.files).forEach(f => T._files.push(f)); S.formDirty = true; drawLamp(); e.target.value = ""; };
  el.addEventListener("paste", e => {
    const fs = Array.from(e.clipboardData.files || []).filter(f => f.type.startsWith("image/"));
    if (fs.length) { e.preventDefault(); fs.forEach(f => T._files.push(new File([f], "screenshot-" + Date.now() + ".png", { type: f.type }))); S.formDirty = true; drawLamp(); toast("Gambar ditambahkan sebagai lampiran"); }
  });
  drawLamp();

  // --- simpan
  $("#bSave").onclick = async () => {
    const btn = $("#bSave"); btn.disabled = true;
    try {
      T.items = T.items.filter(it => String(it.nama || "").trim() || it.barangId || Number(it.harga));
      const body = clone(T); Object.keys(body).forEach(k => { if (k.startsWith("_")) delete body[k]; });
      body.items.forEach(it => { delete it._saran; delete it._hMaster; delete it._sMaster; it.qty = Number(it.qty) || 0; it.harga = Number(it.harga) || 0; });
      const r = await api("/api/transaksi", body);
      for (const f of T._files) { const fd = new FormData(); fd.append("id", r.id); fd.append("file", f); await api("/api/lampiran", fd); }
      S.formDirty = false;
      toast("Transaksi tersimpan");
      if (typeof gdRefresh === "function") setTimeout(gdRefresh, 500);
      await loadState();
      location.hash = "#/trx/" + r.id;
      if (String(r.id) === arg) render();
    } catch (e) { toast(e.message, true); btn.disabled = false; drawItems(); }
  };
  $("#bSave2").onclick = () => $("#bSave").click();
  if ($("#bDel")) $("#bDel").onclick = async () => {
    if (!(await confirmBox("Hapus transaksi ini? Transaksi dipindah ke daftar <b>Terhapus</b> di Pengaturan dan masih bisa dipulihkan.", "Hapus"))) return;
    await api("/api/transaksi/hapus", { id: T.id }); S.formDirty = false; await loadState(); toast("Transaksi dihapus"); location.hash = "#/transaksi";
  };
  if ($("#bCopy")) $("#bCopy").onclick = () => {
    const c = clone(T); c.id = 0; c.noTrx = ""; c.noSJ = ""; c.lampiran = []; c.status = "proses"; c.tanggal = today(); delete c.dibuat; delete c.diubah;
    S.draft = c; S.formDirty = false; location.hash = "#/trx/baru"; render();
  };
  if ($("#bPrint")) $("#bPrint").onclick = () => cetakTrx(T);
  setTimeout(() => { const c = $("[data-k=cv]"); if (!T.cv && (document.activeElement === document.body || !document.activeElement)) c.focus(); }, 50);
}

function bantuanShortcut() {
  const k = (a, b) => `<tr><td class="nowrap">${a}</td><td>${b}</td></tr>`;
  modal("Shortcut keyboard — input barang", `<table class="keys">
    ${k("<kbd>Enter</kbd>", "Lanjut: Barang → Qty → Harga → baris berikutnya. Di dropdown: pilih barang yang disorot.")}
    ${k("<kbd>↑</kbd> <kbd>↓</kbd>", "Di dropdown: pilih barang. Di kolom Qty / Harga: pindah ke baris atas / bawah.")}
    ${k("<kbd>Tab</kbd> / <kbd>Shift</kbd>+<kbd>Tab</kbd>", "Pindah kolom maju / mundur")}
    ${k("<kbd>Ctrl</kbd>+<kbd>Enter</kbd> atau <kbd>F2</kbd>", "Lompat ke baris kosong (barang baru)")}
    ${k("<kbd>Ctrl</kbd>+<kbd>D</kbd>", "Duplikat baris (mis. tinta BK → ganti jadi C/M/Y)")}
    ${k("<kbd>Ctrl</kbd>+<kbd>Delete</kbd>", "Hapus baris yang sedang aktif")}
    ${k("<kbd>Alt</kbd>+<kbd>↑</kbd> / <kbd>Alt</kbd>+<kbd>↓</kbd>", "Pindah baris di kolom yang sama")}
    ${k("<kbd>Ctrl</kbd>+<kbd>S</kbd>", "Simpan transaksi")}
    ${k("<kbd>Esc</kbd>", "Tutup dropdown / jendela")}
    ${k("<kbd>?</kbd>", "Tampilkan bantuan ini")}
  </table><p class="small mute">Baris kosong di paling bawah selalu tersedia dan tidak ikut tersimpan. Angka di Qty/Harga otomatis terblok saat dipilih, jadi bisa langsung diketik ulang.</p>`, { buttons: [{ label: "Tutup", cls: "pri" }], noFocus: true });
}

function satInfo(s) {
  return [s.singkat && s.singkat !== s.nama ? s.singkat : "", s.kodeBPN ? "kode satker " + s.kodeBPN : "", s.kodeSatker ? "Digipay " + s.kodeSatker : "", s.grup, s.wapu === false ? "NON-WAPU" : ""].filter(Boolean).map(esc).join(" · ");
}

function cekLine(c, h) {
  const out = [];
  if (c.cekTotal) { const d = Math.round(h.dpp - c.cekTotal); out.push(`<div class="ln small"><span>Cek vs dokumen (sub total ${rp(c.cekTotal)})</span><span class="b ${Math.abs(d) <= 1 ? "ok" : "err"}">${Math.abs(d) <= 1 ? "cocok" : "selisih " + rp(d)}</span></div>`); }
  if (c.cekPPN) { const d = Math.round(h.ppn - c.cekPPN); out.push(`<div class="ln small"><span>Cek PPN dokumen (${rp(c.cekPPN)})</span><span class="b ${Math.abs(d) <= 1 ? "ok" : "err"}">${Math.abs(d) <= 1 ? "cocok" : "selisih " + rp(d)}</span></div>`); }
  if (c.cekBersih) { const d = Math.round(h.bersih - c.cekBersih); out.push(`<div class="ln small"><span>Cek penghasilan dokumen (${rp(c.cekBersih)})</span><span class="b ${Math.abs(d) <= 1 ? "ok" : "err"}">${Math.abs(d) <= 1 ? "cocok" : "selisih " + rp(d)}</span></div>`); }
  if (c.cekDigi) { const d = Math.round(h.bruto - c.cekDigi); out.push(`<div class="ln small"><span>Cek total Digipay (${rp(c.cekDigi)})</span><span class="b ${Math.abs(d) <= 1 ? "ok" : "err"}">${Math.abs(d) <= 1 ? "cocok" : "selisih " + rp(d)}</span></div>`); }
  return out.join("");
}

// ================================================================ IMPOR
let pdfjsP = null;
function pdfjs() {
  if (!pdfjsP) pdfjsP = import("/vendor/pdf.min.mjs").then(m => { m.GlobalWorkerOptions.workerSrc = "/vendor/pdf.worker.min.mjs"; return m; });
  return pdfjsP;
}

async function bacaPdf(file) {
  const lib = await pdfjs();
  const doc = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()), disableFontFace: true, verbosity: 0 }).promise;
  const pages = [];
  for (let p = 1; p <= Math.min(doc.numPages, 12); p++) { const pg = await doc.getPage(p); pages.push(await pg.getTextContent()); }
  return P.parsePdfLines(P.linesFromPdf(pages));
}

// hasil parser -> draft transaksi -> buka form
function bukaDraft(r, files) {
  const t = trxBaru({ kanal: r.kanal });
  ["noTrx", "tanggal", "kodeAkun", "noDok", "ppk", "pemesan", "metodeBayar", "rup", "sumberDana", "namaPaket", "noQuotation", "tglSP", "tglKirim", "platformFee"].forEach(k => { if (r[k]) t[k] = r[k]; });
  if (r.cv) t.cv = r.cv;
  if (r.wapu === false) t.wapu = false;
  const s = cocokSatker(r.namaSatker, r.kodeSatker, r.noDok);
  if (s) t.satkerId = s.id; else { t._satkerNama = r.namaSatker || ""; t._kodeSatker = r.kodeSatker || ""; }
  let pasti = 0;
  t.items = r.items.map(it => {
    const m = cocokBarang(it.nama);
    const row = { barangId: 0, nama: it.nama, qty: it.qty, satuan: it.satuan, harga: it.harga, jenis: it.jenis || "B" };
    if (m && m.pasti) { row.barangId = m.barang.id; pasti++; if (m.barang.jenis === "J") row.jenis = "J"; if (row.satuan === "PCS" && m.barang.satuan) row.satuan = m.barang.satuan; }
    else if (m) row._saran = m.barang;
    return row;
  });
  t._cek = { cekTotal: r.kanal !== "DIGIPAY" ? r.cekTotal : 0, cekPPN: r.cekPPN, cekBersih: r.cekBersih, cekDigi: r.kanal === "DIGIPAY" ? r.cekTotal : 0 };
  t._files = files || [];
  const sum = r.items.reduce((a, i) => a + i.qty * i.harga, 0);
  const dup = r.noTrx && S.data.transaksi.find(x => x.kanal === r.kanal && x.noTrx === r.noTrx);
  const msg = [`Terbaca dari ${KANAL[r.kanal].label}: <b>${r.items.length} barang</b>, jumlah Rp ${rp(sum)}. ${pasti} barang langsung cocok dengan master, ${r.items.length - pasti} perlu dicek.`];
  if (!r.cv) msg.push(r.kanal === "DIGIPAY" ? "Pilih CV yang menerima pesanan ini." : `Penyedia di dokumen: <b>${esc(r.penyedia || "-")}</b> — pilih CV secara manual.`);
  if (!s && r.namaSatker) msg.push(`Satker "<b>${esc(r.namaSatker)}</b>" belum ada di master — tambahkan lewat link di bawah kolom satker.`);
  if (dup) msg.push(`<b>Perhatian:</b> nomor ${esc(r.noTrx)} sudah pernah dicatat (<a href="#/trx/${dup.id}">buka transaksi #${dup.id}</a>).`);
  (r.peringatan || []).forEach(p => msg.push(esc(p)));
  t._info = { cls: dup ? "err" : "info", html: msg.join("<br>") };
  S.draft = t;
  S.formDirty = false;
  if (location.hash === "#/trx/baru") render(); else location.hash = "#/trx/baru";
}

function dlgImporPdf() {
  const m = modal("Impor PDF pesanan", `
    <p class="mute" style="margin-top:0">Pilih file <b>Surat Pesanan INAPROC</b> (surat-pesanan-EP-….pdf) atau <b>Pesanan Mbizmarket</b> (PO-…). Barang, harga, PPK, tanggal, dan nomor terbaca otomatis. PDF ikut disimpan sebagai lampiran.</p>
    <div class="drop" id="drop">Seret PDF ke sini atau <b>klik untuk memilih</b><input type="file" id="fPdf" accept="application/pdf" hidden></div>
    <div id="st" style="margin-top:10px"></div>`, { buttons: [{ label: "Batal" }] });
  const go = async f => {
    if (!f) return;
    $("#st", m.el).innerHTML = `<div class="alert info">Membaca ${esc(f.name)}…</div>`;
    try {
      const r = await bacaPdf(f);
      if (!r) throw new Error("Format PDF tidak dikenali. Saat ini yang didukung: Surat Pesanan INAPROC dan Pesanan Mbizmarket.");
      if (!r.items.length) throw new Error("Tidak ada barang yang terbaca dari PDF ini.");
      m.close(); bukaDraft(r, [f]);
    } catch (e) { $("#st", m.el).innerHTML = `<div class="alert err">${esc(e.message)}</div>`; }
  };
  const dz = $("#drop", m.el);
  dz.onclick = () => $("#fPdf", m.el).click();
  $("#fPdf", m.el).onchange = e => go(e.target.files[0]);
  dz.ondragover = e => { e.preventDefault(); dz.classList.add("over"); };
  dz.ondragleave = () => dz.classList.remove("over");
  dz.ondrop = e => { e.preventDefault(); dz.classList.remove("over"); go(e.dataTransfer.files[0]); };
}

function dlgDigipay() {
  const files = [];
  const m = modal("Tempel dari Digipay", `
    <ol class="small" style="margin-top:0;padding-left:18px">
      <li>Di Digipay buka <b>Transaksi › Pengecekan</b>. Blok baris invoice-nya (No. Invoice s/d Total Harga), tekan <b>Ctrl+C</b>, tempel di kotak bawah.</li>
      <li>Klik invoice tersebut. Di <b>Rincian Produk</b>, blok seluruh tabel (dari No. Dok baris pertama sampai catatan baris terakhir), <b>Ctrl+C</b>, tempel juga di kotak yang sama.</li>
      <li>Screenshot boleh ikut ditempel (Ctrl+V gambar) — disimpan sebagai lampiran bukti.</li>
    </ol>
    <textarea id="tx" style="min-height:200px;font-family:monospace;font-size:12px" placeholder="Tempel di sini…"></textarea>
    <div class="thumbs" id="th"></div><div id="pv" class="small" style="margin-top:8px"></div>`,
    { wide: true, buttons: [{ label: "Batal" }, { label: "Lanjut ke form", cls: "pri", onClick: () => {
      const r = P.parseDigipay($("#tx", m.el).value);
      if (!r.items.length && !r.noTrx) { toast("Belum ada data yang terbaca. Pastikan yang ditempel berasal dari tabel Digipay.", true); return false; }
      bukaDraft(r, files);
    } }] });
  const prev = () => {
    const r = P.parseDigipay($("#tx", m.el).value);
    const s = cocokSatker(r.namaSatker, r.kodeSatker, r.noDok);
    const sum = r.items.reduce((a, i) => a + i.qty * i.harga, 0);
    $("#pv", m.el).innerHTML = `No. invoice: <b>${esc(r.noTrx || "–")}</b> · Satker: <b>${esc(s ? s.nama : (r.namaSatker || (r.kodeSatker ? "kode " + r.kodeSatker + " (belum ada di master)" : "–")))}</b> · Kode akun: <b>${esc(r.kodeAkun || "–")}</b> · Tanggal: <b>${esc(tgl(r.tanggal) || "–")}</b><br>
      Barang terbaca: <b>${r.items.length}</b> · jumlah Rp <b>${rp(sum)}</b>${r.cekTotal ? ` · total di daftar Rp ${rp(r.cekTotal)} <span class="b ${Math.abs(sum - r.cekTotal) <= 1 ? "ok" : "warn"}">${Math.abs(sum - r.cekTotal) <= 1 ? "cocok" : r.items.length ? "beda" : "rincian belum ditempel"}</span>` : ""}`;
  };
  $("#tx", m.el).addEventListener("input", prev);
  $("#tx", m.el).addEventListener("paste", e => {
    const fs = Array.from(e.clipboardData.files || []).filter(f => f.type.startsWith("image/"));
    if (fs.length) {
      e.preventDefault();
      fs.forEach(f => { const nf = new File([f], "screenshot-digipay-" + Date.now() + ".png", { type: f.type }); files.push(nf); $("#th", m.el).insertAdjacentHTML("beforeend", `<div class="th"><img src="${URL.createObjectURL(nf)}"></div>`); });
    }
  });
}

// Tempel baris barang dari Excel: nama | qty | satuan | harga  (atau tabel Digipay)
function dlgTempelItem(onOk) {
  const m = modal("Tempel daftar barang", `
    <p class="small mute" style="margin-top:0">Salin dari Excel kolom <b>Nama barang · Qty · Satuan · Harga</b> (urutan ini), atau salin tabel Rincian Produk Digipay. Lalu tempel di sini.</p>
    <textarea id="tx" style="min-height:180px;font-family:monospace;font-size:12px"></textarea><div id="pv" class="small"></div>`,
    { wide: true, buttons: [{ label: "Batal" }, { label: "Tambahkan", cls: "pri", onClick: () => { const rows = parse(); if (!rows.length) { toast("Tidak ada baris terbaca", true); return false; } onOk(rows); } }] });
  const parse = () => {
    const txt = $("#tx", m.el).value;
    const dg = P.parseDigipay(txt);
    let rows = dg.items;
    if (!rows.length) rows = txt.split(/\r?\n/).map(l => l.split("\t")).filter(c => c.length >= 2 && c[0].trim())
      .map(c => ({ nama: c[0].trim(), qty: P.angka(c[1]), satuan: (c[2] || "").trim().toUpperCase(), harga: P.angka(c[3] || 0), jenis: "B" }))
      .filter(r => r.qty > 0);
    return rows.map(it => { const mm = cocokBarang(it.nama); const r = { barangId: 0, nama: it.nama, qty: it.qty, satuan: it.satuan || "", harga: it.harga, jenis: it.jenis }; if (mm && mm.pasti) { r.barangId = mm.barang.id; r.satuan = r.satuan || mm.barang.satuan; r.harga = r.harga || mm.barang.harga; r.jenis = mm.barang.jenis || "B"; } else if (mm) r._saran = mm.barang; return r; });
  };
  $("#tx", m.el).addEventListener("input", () => { const r = parse(); $("#pv", m.el).textContent = `${r.length} baris terbaca, jumlah Rp ${rp(r.reduce((a, i) => a + i.qty * i.harga, 0))}`; });
}

// ================================================================ CETAK
function cetakTrx(t) {
  const h = hitung(t), s = satkerById(t.satkerId), cv = S.data.cv.find(c => c.kode === t.cv) || {};
  const w = window.open("", "_blank");
  const rows = t.items.map((it, i) => `<tr><td>${i + 1}</td><td>${esc(it.nama)}</td><td class="n">${fmtN(it.qty)}</td><td>${esc(it.satuan)}</td><td class="n">${rp(it.harga)}</td><td class="n">${rp(it.qty * it.harga)}</td></tr>`).join("");
  const info = [["Kanal", KANAL[t.kanal].label], [KANAL[t.kanal].no, t.noTrx], ["Tanggal", tgl(t.tanggal)], ["No. surat jalan", t.noSJ], ["Kode akun", t.kodeAkun], ["PPK", t.ppk], ["Pemesan", t.pemesan], ["No. RUP", t.rup], ["Sumber dana", t.sumberDana], ["Tgl SP", tgl(t.tglSP)], ["Tgl BAST", tgl(t.tglBAST)], ["Tgl kirim", tgl(t.tglKirim)], ["Status", STATUS[t.status]]].filter(x => x[1]);
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(t.noTrx || "Transaksi " + t.id)}</title><style>
  body{font:12px Arial,sans-serif;margin:24px;color:#111}h1{font-size:16px;margin:0}table{border-collapse:collapse;width:100%;margin-top:10px}td,th{border:1px solid #999;padding:4px 6px}th{background:#eee}.n{text-align:right}.info td{border:none;padding:1px 8px 1px 0}.sum{width:340px;margin-left:auto}.sum td{border:none;padding:2px 4px}.sum tr.b td{font-weight:bold;border-top:1px solid #333}
  </style></head><body><h1>${esc(cv.nama || t.cv)}</h1><div>${esc(cv.alamat || "")}${cv.npwp ? " · NPWP " + esc(cv.npwp) : ""}</div><hr>
  <table class="info"><tr><td><b>Kepada</b></td><td>${esc(s.nama)}</td></tr>${info.map(x => `<tr><td><b>${esc(x[0])}</b></td><td>${esc(x[1])}</td></tr>`).join("")}</table>
  <table><thead><tr><th>No</th><th>Nama barang</th><th>Qty</th><th>Satuan</th><th>Harga</th><th>Jumlah</th></tr></thead><tbody>${rows}</tbody></table>
  <table class="sum"><tr><td>DPP</td><td class="n">${rp(h.dpp)}</td></tr><tr><td>PPN ${h.pakaiPPN ? S.data.settings.ppn + "%" : ""}</td><td class="n">${h.pakaiPPN ? rp(h.ppn) : "tidak dikenakan"}</td></tr><tr class="b"><td>TOTAL</td><td class="n">${rp(h.total)}</td></tr>${h.pph22 ? `<tr><td>PPh 22</td><td class="n">(${rp(h.pph22)})</td></tr>` : ""}${h.pph23 ? `<tr><td>PPh 23</td><td class="n">(${rp(h.pph23)})</td></tr>` : ""}${h.fee ? `<tr><td>Platform fee</td><td class="n">(${rp(h.fee)})</td></tr>` : ""}<tr class="b"><td>Diterima bersih</td><td class="n">${rp(h.bersih)}</td></tr></table>
  ${t.catatan ? `<p><b>Catatan:</b> ${esc(t.catatan)}</p>` : ""}<script>window.onload=()=>window.print()<\/script></body></html>`);
  w.document.close();
}

// ================================================================ REKAP
function pgRekap(el, tab) {
  tab = tab || "bulanan";
  const F = S.filters.rekap = S.filters.rekap || { tahun: tahunList()[0], cv: "", kanal: "", dari: "01", sampai: "12" };
  const tabs = [["bulanan", "Bulanan per CV"], ["satker", "Per satker"], ["bpn", "Kantah BPN (format Belanja BPN)"], ["pajak", "Pajak (PPN · PPh)"]];
  el.innerHTML = `<div class="topbar"><div><h1>Rekap &amp; Laporan</h1><div class="mute">Nilai termasuk PPN · transaksi batal tidak dihitung</div></div></div>
  <div class="tabs">${tabs.map(([k, l]) => `<a href="#/rekap/${k}" class="${k === tab ? "on" : ""}">${l}</a>`).join("")}</div>
  <div class="card"><div class="filters">
    <label class="f"><span>Tahun</span><select id="r_tahun">${tahunList().map(y => `<option ${y === F.tahun ? "selected" : ""}>${y}</option>`).join("")}</select></label>
    <label class="f"><span>Dari bulan</span><select id="r_dari">${BULAN.map((b, i) => { const v = String(i + 1).padStart(2, "0"); return `<option value="${v}" ${v === F.dari ? "selected" : ""}>${b}</option>`; }).join("")}</select></label>
    <label class="f"><span>Sampai</span><select id="r_sampai">${BULAN.map((b, i) => { const v = String(i + 1).padStart(2, "0"); return `<option value="${v}" ${v === F.sampai ? "selected" : ""}>${b}</option>`; }).join("")}</select></label>
    ${tab !== "bulanan" ? `<label class="f"><span>CV</span><select id="r_cv">${optList(cvOpts(), F.cv, "Semua CV")}</select></label>` : ""}
    <label class="f"><span>Kanal</span><select id="r_kanal">${optList(kanalOpts(), F.kanal, "Semua kanal")}</select></label>
    <span style="flex:1"></span><button class="pri" id="rX">Unduh Excel</button>
  </div></div><div id="rBody"></div>`;
  ["tahun", "dari", "sampai", "cv", "kanal"].forEach(k => { const e = $("#r_" + k); if (e) e.onchange = () => { F[k] = e.value; render(); }; });
  const list = S.data.transaksi.filter(t => aktif(t) && t.tanggal.startsWith(F.tahun) && t.tanggal.slice(5, 7) >= F.dari && t.tanggal.slice(5, 7) <= F.sampai && (!F.kanal || t.kanal === F.kanal) && (tab === "bulanan" || !F.cv || t.cv === F.cv));
  ({ bulanan: rkBulanan, satker: rkSatker, bpn: rkBpn, pajak: rkPajak })[tab]($("#rBody"), list, F);
}

function rkBulanan(el, list, F) {
  const cvs = S.data.cv.map(c => c.kode);
  const mb = (cv, i) => list.filter(t => t.cv === cv && +t.tanggal.slice(5, 7) === i + 1);
  const val = (arr, k) => arr.reduce((a, t) => a + hitung(t)[k], 0);
  el.innerHTML = cvs.map(cv => {
    const rows = BULAN.map((b, i) => { const a = mb(cv, i); return { b, n: a.length, dpp: val(a, "dpp"), ppn: val(a, "ppn"), total: val(a, "total"), pph: val(a, "pph"), bersih: val(a, "bersih") }; }).filter((r, i) => i + 1 >= +F.dari && i + 1 <= +F.sampai);
    const t = k => rows.reduce((a, r) => a + r[k], 0);
    return `<div class="card tight"><div class="card-h"><h2 style="margin:0"><span class="b ${cv}">${cv}</span> ${esc(cvNama(cv))}</h2><span class="mute">${t("n")} transaksi · Rp ${rp(t("total"))}</span></div><div class="tw"><table class="mx"><thead><tr><th>Bulan</th><th class="num">Trx</th><th class="num">DPP</th><th class="num">PPN</th><th class="num">Total</th><th class="num">PPh</th><th class="num">Bersih diterima</th></tr></thead><tbody>
    ${rows.map(r => `<tr><td>${r.b}</td><td class="num ${r.n ? "" : "z"}">${r.n || "–"}</td><td class="num ${r.n ? "" : "z"}">${r.n ? rp(r.dpp) : "–"}</td><td class="num ${r.n ? "" : "z"}">${r.n ? rp(r.ppn) : "–"}</td><td class="num ${r.n ? "" : "z"}"><b>${r.n ? rp(r.total) : "–"}</b></td><td class="num ${r.n ? "" : "z"}">${r.n ? rp(r.pph) : "–"}</td><td class="num ${r.n ? "" : "z"}">${r.n ? rp(r.bersih) : "–"}</td></tr>`).join("")}
    <tr class="tot"><td>Total</td><td class="num">${t("n")}</td><td class="num">${rp(t("dpp"))}</td><td class="num">${rp(t("ppn"))}</td><td class="num">${rp(t("total"))}</td><td class="num">${rp(t("pph"))}</td><td class="num">${rp(t("bersih"))}</td></tr></tbody></table></div></div>`;
  }).join("");
  $("#rX").onclick = () => exportBulanan(F.tahun, F.kanal, F);
}

function grupSatker(list) {
  const g = new Map();
  for (const t of list) { if (!g.has(t.satkerId)) g.set(t.satkerId, []); g.get(t.satkerId).push(t); }
  return Array.from(g.entries()).map(([id, arr]) => ({ s: satkerById(id), arr: arr.sort((a, b) => a.tanggal.localeCompare(b.tanggal) || a.id - b.id) }))
    .sort((a, b) => (a.s.grup === "BPN" ? 0 : 1) - (b.s.grup === "BPN" ? 0 : 1) || (a.s.kodeKantah || "zz").localeCompare(b.s.kodeKantah || "zz") || a.s.nama.localeCompare(b.s.nama));
}

function rkSatker(el, list, F) {
  const cvs = S.data.cv.map(c => c.kode);
  const G = grupSatker(list);
  const tot = { n: 0, total: 0, pph: 0 }; const tcv = {};
  el.innerHTML = `<div class="card tight"><div class="tw"><table class="mx"><thead><tr><th>No</th><th>Kode satker</th><th>Nama satker</th><th class="num">Trx</th>${cvs.map(c => `<th class="num">${c}</th>`).join("")}<th class="num">Total</th><th class="num">PPh</th></tr></thead><tbody>
  ${G.map((g, i) => { const by = {}; let s = 0, p = 0; g.arr.forEach(t => { const h = hitung(t); by[t.cv] = (by[t.cv] || 0) + h.total; s += h.total; p += h.pph; }); tot.n += g.arr.length; tot.total += s; tot.pph += p; cvs.forEach(c => tcv[c] = (tcv[c] || 0) + (by[c] || 0));
    return `<tr class="click" data-sat="${g.s.id}"><td>${i + 1}</td><td class="small">${esc(g.s.kodeBPN || g.s.kodeSatker || "")}</td><td>${esc(g.s.nama)}<div class="sub small mute">${esc(g.s.grup || "")}${g.s.kodeKantah ? " · " + esc(g.s.kodeKantah) : ""}</div></td><td class="num">${g.arr.length}</td>${cvs.map(c => `<td class="num ${by[c] ? "" : "z"}">${by[c] ? rp(by[c]) : "–"}</td>`).join("")}<td class="num"><b>${rp(s)}</b></td><td class="num">${rp(p)}</td></tr>`; }).join("") || `<tr><td colspan="9" class="mute">Tidak ada transaksi pada filter ini.</td></tr>`}
  <tr class="tot"><td></td><td></td><td>GRAND TOTAL</td><td class="num">${tot.n}</td>${cvs.map(c => `<td class="num">${rp(tcv[c] || 0)}</td>`).join("")}<td class="num">${rp(tot.total)}</td><td class="num">${rp(tot.pph)}</td></tr></tbody></table></div></div>
  <p class="small mute">Klik satker untuk melihat transaksinya. Excel berisi sheet HOME + satu sheet per satker dengan rincian barang dan Form Isian Data (seperti file DATA REKAP DIGIPAY).</p>`;
  $$("tr[data-sat]", el).forEach(tr => tr.onclick = () => { S.filters.trx = { tahun: F.tahun, satker: tr.dataset.sat, cv: F.cv, kanal: F.kanal }; location.hash = "#/transaksi"; });
  $("#rX").onclick = () => exportPerSatker(list, F, false);
}

function rkBpn(el, list, F) {
  const cvs = S.data.cv.map(c => c.kode);
  const kantah = S.data.satker.filter(s => s.grup === "BPN").sort((a, b) => (a.kodeKantah || "").localeCompare(b.kodeKantah || ""));
  const bpnList = list.filter(t => satkerById(t.satkerId).grup === "BPN");
  const m = {}; cvs.forEach(c => m[c] = Array(12).fill(0));
  bpnList.forEach(t => { if (m[t.cv]) m[t.cv][+t.tanggal.slice(5, 7) - 1] += hitung(t).total; });
  el.innerHTML = `<div class="card tight"><div class="card-h"><h2 style="margin:0">Penjualan BPN Provinsi Jawa Barat — ${F.tahun}</h2></div><div class="tw"><table class="mx"><thead><tr><th>PT/CV</th>${BLN3.map(b => `<th class="num">${b}</th>`).join("")}<th class="num">Total</th></tr></thead><tbody>
  ${cvs.map(c => `<tr><td><span class="b ${c}">${c}</span></td>${m[c].map(v => `<td class="num ${v ? "" : "z"}">${v ? rp(v) : "–"}</td>`).join("")}<td class="num"><b>${rp(m[c].reduce((a, b) => a + b, 0))}</b></td></tr>`).join("")}
  <tr class="tot"><td>Total</td>${m[cvs[0]].map((_, i) => `<td class="num">${rp(cvs.reduce((a, c) => a + m[c][i], 0))}</td>`).join("")}<td class="num">${rp(cvs.reduce((a, c) => a + m[c].reduce((x, y) => x + y, 0), 0))}</td></tr></tbody></table></div></div>
  <div class="card tight"><div class="tw"><table class="mx"><thead><tr><th>No</th><th>Kode</th><th>Nama kantah</th>${cvs.map(c => `<th class="num">${c}</th>`).join("")}<th class="num">Transaksi</th><th class="num">Total</th></tr></thead><tbody>
  ${kantah.map((k, i) => { const a = bpnList.filter(t => t.satkerId === k.id); const by = {}; a.forEach(t => by[t.cv] = (by[t.cv] || 0) + hitung(t).total); const s = Object.values(by).reduce((x, y) => x + y, 0);
    return `<tr><td>${i + 1}</td><td class="nowrap">${esc(k.kodeBPN || k.kodeKantah)}</td><td>${esc(k.singkat || k.nama)}</td>${cvs.map(c => `<td class="num ${by[c] ? "" : "z"}">${by[c] ? rp(by[c]) : "–"}</td>`).join("")}<td class="num ${a.length ? "" : "z"}">${a.length || "–"}</td><td class="num"><b>${s ? rp(s) : "–"}</b></td></tr>`; }).join("")}
  </tbody></table></div></div>
  <p class="small mute">Excel mengikuti format BELANJA BPN: sheet BERANDA + satu sheet per kantah berisi tabel bulan per CV dan blok rincian tiap transaksi (rumus Excel tetap hidup).</p>`;
  $("#rX").onclick = () => exportPerSatker(bpnList, F, true);
}

function rkPajak(el, list, F) {
  const cvs = S.data.cv.map(c => c.kode);
  el.innerHTML = cvs.map(cv => {
    const rows = BULAN.map((b, i) => { const a = list.filter(t => t.cv === cv && +t.tanggal.slice(5, 7) === i + 1); const r = { b, n: a.length, dpp: 0, ppn: 0, ppnW: 0, p22: 0, p23: 0, fee: 0 }; a.forEach(t => { const h = hitung(t); r.dpp += h.dpp; r.ppn += h.ppn; if (h.wapu) r.ppnW += h.ppn; r.p22 += h.pph22; r.p23 += h.pph23; r.fee += h.fee; }); return r; }).filter((r, i) => i + 1 >= +F.dari && i + 1 <= +F.sampai);
    const t = k => rows.reduce((a, r) => a + r[k], 0);
    if (F.cv && F.cv !== cv) return "";
    return `<div class="card tight"><div class="card-h"><h2 style="margin:0"><span class="b ${cv}">${cv}</span> ${esc(cvNama(cv))}</h2></div><div class="tw"><table class="mx"><thead><tr><th>Bulan</th><th class="num">Trx</th><th class="num">DPP</th><th class="num">PPN</th><th class="num">PPN dipungut instansi</th><th class="num">PPh 22 (barang)</th><th class="num">PPh 23 (jasa)</th><th class="num">Platform fee</th></tr></thead><tbody>
    ${rows.map(r => `<tr><td>${r.b}</td>${["n", "dpp", "ppn", "ppnW", "p22", "p23", "fee"].map(k => `<td class="num ${r[k] ? "" : "z"}">${r[k] ? (k === "n" ? r[k] : rp(r[k])) : "–"}</td>`).join("")}</tr>`).join("")}
    <tr class="tot"><td>Total</td>${["n", "dpp", "ppn", "ppnW", "p22", "p23", "fee"].map(k => `<td class="num">${k === "n" ? t(k) : rp(t(k))}</td>`).join("")}</tr></tbody></table></div></div>`;
  }).join("");
  $("#rX").onclick = () => exportPajak(list, F);
}

// ================================================================ EKSPOR EXCEL
const C = (v, s, f) => (f ? { v, s, f } : { v, s });

function exportBulanan(tahun, kanal, F) {
  const cvs = S.data.cv.map(c => c.kode);
  const list = S.data.transaksi.filter(t => aktif(t) && t.tanggal.startsWith(tahun) && (!kanal || t.kanal === kanal));
  const rows = [[C(`PENJUALAN PER CV — TAHUN ${tahun}${kanal ? " — " + KANAL[kanal].label : ""}`, "title")], [C("Nilai termasuk PPN. Dibuat " + new Date().toLocaleString("id-ID"), "sub")], [],
    [C("PT/CV", "hdr")].concat(BULAN.map(b => C(b, "hdr"))).concat([C("TOTAL", "hdr")])];
  cvs.forEach((cv, i) => {
    const r = 5 + i;
    const vals = BULAN.map((_, b) => list.filter(t => t.cv === cv && +t.tanggal.slice(5, 7) === b + 1).reduce((a, t) => a + hitung(t).total, 0));
    rows.push([C(cvNama(cv), "txt")].concat(vals.map(v => C(v, "num"))).concat([C(vals.reduce((a, b) => a + b, 0), "tot", `SUM(B${r}:M${r})`)]));
  });
  const last = 4 + cvs.length;
  rows.push([C("TOTAL", "totl")].concat(Array.from({ length: 13 }, (_, i) => { const col = String.fromCharCode(66 + i); return C(0, "tot", `SUM(${col}5:${col}${last})`); })));
  // detail per bulan per CV dengan DPP/PPN/PPh
  const det = [[C(`RINCIAN BULANAN ${tahun}`, "title")], [], ["CV", "BULAN", "TRANSAKSI", "DPP", "PPN", "TOTAL", "PPh 22", "PPh 23", "PLATFORM FEE", "BERSIH DITERIMA"].map(h => C(h, "hdr"))];
  cvs.forEach(cv => BULAN.forEach((b, i) => {
    const a = list.filter(t => t.cv === cv && +t.tanggal.slice(5, 7) === i + 1); if (!a.length) return;
    const s = k => a.reduce((x, t) => x + hitung(t)[k], 0);
    det.push([C(cv, "txt"), C(b, "txt"), C(a.length, "num"), C(s("dpp"), "num"), C(s("ppn"), "num"), C(s("total"), "num"), C(s("pph22"), "num"), C(s("pph23"), "num"), C(s("fee"), "num"), C(s("bersih"), "num")]);
  }));
  exportBook({ filename: `Rekap Bulanan ${tahun}${kanal ? " " + KANAL[kanal].label : ""}.xlsx`, sheets: [
    { name: "BERANDA", cols: [34].concat(Array(12).fill(14)).concat([16]), rows, freeze: 4 },
    { name: "RINCIAN", cols: [8, 13, 11, 16, 15, 16, 14, 14, 14, 17], rows: det, freeze: 3 }] });
}

function exportDaftar(list, F) {
  const hdr = ["NO", "TANGGAL", "CV", "KANAL", "KODE SATKER", "SATKER", "NO. TRANSAKSI", "NO. SURAT JALAN", "KODE AKUN", "PPK", "STATUS", "DPP", "PPN", "TOTAL", "PPh 22", "PPh 23", "PLATFORM FEE", "BERSIH", "JML BARANG", "CATATAN", "PAJAK"];
  const rows = [[C("DAFTAR TRANSAKSI", "title")], [C(`${list.length} transaksi · dibuat ${new Date().toLocaleString("id-ID")}`, "sub")], hdr.map(h => C(h, "hdr"))];
  list.forEach((t, i) => { const h = hitung(t), s = satkerById(t.satkerId); rows.push([C(i + 1, "date"), C(tgl(t.tanggal), "date"), C(t.cv, "date"), C(KANAL[t.kanal].label, "txt"), C(s.kodeBPN || s.kodeSatker || "", "txt"), C(s.nama, "txt"), C(t.noTrx || "", "txt"), C(t.noSJ || "", "txt"), C(t.kodeAkun || "", "txt"), C(t.ppk || "", "txt"), C(STATUS[t.status], "txt"), C(h.dpp, "num"), C(h.ppn, "num"), C(h.total, "num"), C(h.pph22, "num"), C(h.pph23, "num"), C(h.fee, "num"), C(h.bersih, "num"), C(t.items.length, "num"), C(t.catatan || "", "txt"), C([t.noPPN ? "tanpa PPN" : "", t.noPPh22 ? "tanpa PPh 22" : "", t.noPPh23 ? "tanpa PPh 23" : ""].filter(Boolean).join(", ") || "normal", "txt")]); });
  const n = rows.length;
  rows.push([null, null, null, null, null, C("TOTAL", "totl"), null, null, null, null, null].concat(["L", "M", "N", "O", "P", "Q", "R"].map(c => C(0, "tot", `SUM(${c}4:${c}${n})`))));
  const items = [["TANGGAL", "CV", "KANAL", "SATKER", "NO. TRANSAKSI", "NAMA BARANG", "KODE MASTER", "QTY", "SATUAN", "HARGA", "JUMLAH", "JENIS"].map(h => C(h, "hdr"))];
  list.forEach(t => { const s = satkerById(t.satkerId); t.items.forEach(it => { const b = it.barangId ? S.idx.barang[it.barangId] : null; items.push([C(tgl(t.tanggal), "date"), C(t.cv, "date"), C(KANAL[t.kanal].label, "txt"), C(s.singkat || s.nama, "txt"), C(t.noTrx || "", "txt"), C(it.nama, "txt"), C(b ? b.kode : "", "txt"), C(it.qty, "num"), C(it.satuan, "txt"), C(it.harga, "num"), C(it.qty * it.harga, "num"), C(it.jenis === "J" ? "Jasa" : "Barang", "txt")]); }); });
  exportBook({ filename: "Daftar Transaksi.xlsx", sheets: [
    { name: "TRANSAKSI", cols: [5, 11, 6, 12, 10, 38, 28, 14, 22, 22, 13, 15, 13, 15, 12, 12, 12, 15, 8, 30, 24], rows, freeze: 3 },
    { name: "RINCIAN BARANG", cols: [11, 6, 12, 22, 28, 46, 12, 8, 9, 13, 15, 8], rows: items, freeze: 1 }] });
}

// Blok rincian satu transaksi pada kolom B..G (format Excel lama). Mengembalikan alamat sel total.
function blokTrx(rows, t) {
  const h = hitung(t), ppnP = S.data.settings.ppn, cv = cvNama(t.cv);
  const r0 = rows.length + 1;
  rows.push([null, null, C(cv + " ( " + KANAL[t.kanal].label.toUpperCase() + " )", "bold"), null, null, null, null, null, C("Form Isian Data", "bold")]);
  const form = [["TANGGAL", tgl(t.tanggal)], [KANAL[t.kanal].no.toUpperCase(), t.noTrx], ["KODE AKUN ANGGARAN", t.kodeAkun], ["NO. SURAT JALAN", t.noSJ], ["PPK", t.ppk], ["PEMESAN", t.pemesan], ["NO. DOK", t.noDok], ["NO. RUP", t.rup], ["SUMBER DANA", t.sumberDana], ["TANGGAL SPK/SP", tgl(t.tglSP)], ["TANGGAL BAST", tgl(t.tglBAST)], ["TANGGAL DI KIRIM", tgl(t.tglKirim)], ["TANGGAL BAYAR", tgl(t.tglBayar)], ["STATUS", STATUS[t.status]]]
    .filter((x, i) => i < 4 || x[1]);
  rows.push([null, C("NO", "hdr"), C("NAMA BARANG", "hdr"), C("QTY", "hdr"), C("SATUAN", "hdr"), C("HARGA", "hdr"), C("TOTAL", "hdr")]);
  const first = rows.length + 1;
  t.items.forEach((it, i) => { const r = rows.length + 1; rows.push([null, C(i + 1, "date"), C(it.nama + (it.jenis === "J" ? " (JASA)" : ""), "txt"), C(it.qty, "num"), C(it.satuan, "date"), C(it.harga, Number.isInteger(it.harga) ? "num" : "dec"), C(it.qty * it.harga, "num", `D${r}*F${r}`)]); });
  const last = rows.length;
  const rT = rows.length + 1;
  rows.push([null, null, null, null, null, C(h.incl ? "TOTAL (termasuk PPN)" : "TOTAL / DPP", "totl"), C(h.bruto, "tot", `SUM(G${first}:G${last})`)]);
  let rG;
  if (!h.pakaiPPN) {
    rows.push([null, null, null, null, null, C("PPN", "txt"), C("TIDAK DIKENAKAN", "txt")]);
    rG = rT; rows[rT - 1][5] = C("GRAND TOTAL (tanpa PPN)", "totl");
  } else if (h.incl) {
    rows.push([null, null, null, null, null, C("DPP", "txt"), C(h.dpp, "num", `ROUND(G${rT}/${1 + ppnP / 100},0)`)]);
    rows.push([null, null, null, null, null, C(`PPN ${ppnP}%`, "txt"), C(h.ppn, "num", `G${rT}-G${rT + 1}`)]);
    rG = rT; rows[rT - 1][5] = C("GRAND TOTAL", "totl");
  } else {
    rows.push([null, null, null, null, null, C(`PPN ${ppnP}%`, "txt"), C(h.ppn, "num", `ROUND(G${rT}*${ppnP}%,0)`)]);
    rG = rows.length + 1;
    rows.push([null, null, null, null, null, C("GRAND TOTAL", "totl"), C(h.total, "tot", `G${rT}+G${rT + 1}`)]);
  }
  if (h.pph22) rows.push([null, null, null, null, null, C(`PPh 22 ${fmtN(S.data.settings.pph22)}%`, "txt"), C(h.pph22, "num")]);
  else if (t.noPPh22 && h.adaB) rows.push([null, null, null, null, null, C("PPh 22", "txt"), C("TIDAK DIPOTONG", "txt")]);
  if (h.pph23) rows.push([null, null, null, null, null, C(`PPh 23 ${fmtN(S.data.settings.pph23)}%`, "txt"), C(h.pph23, "num")]);
  else if (t.noPPh23 && h.adaJ) rows.push([null, null, null, null, null, C("PPh 23", "txt"), C("TIDAK DIPOTONG", "txt")]);
  if (h.fee) rows.push([null, null, null, null, null, C("PLATFORM FEE", "txt"), C(h.fee, "num")]);
  rows.push([null, null, null, null, null, C("DITERIMA BERSIH", "txt"), C(h.bersih, "num")]);
  // tempel Form Isian Data di kolom I/J mulai baris header
  form.forEach((f, i) => { const row = rows[r0 + i]; if (!row) return; while (row.length < 10) row.push(null); row[8] = C(f[0], "txt"); row[9] = C(f[1] || "", "txt"); });
  rows.push([]); rows.push([]);
  return { total: `G${rG}`, nilai: h.total, bulan: +t.tanggal.slice(5, 7) };
}

function sheetName(s) { return (s.singkat || s.nama).replace(/[\\/?*[\]:]/g, " ").slice(0, 31); }

function exportPerSatker(list, F, formatBpn) {
  const cvs = S.data.cv.map(c => c.kode);
  const G = grupSatker(list);
  if (!G.length) return toast("Tidak ada transaksi pada filter ini.", true);
  const sheets = [];
  const ringkas = [];
  for (const g of G) {
    const rows = [];
    const sn = sheetName(g.s);
    if (formatBpn) {
      rows.push([]);
      rows.push([C("NAMA KANTAH :", "bold"), null, C(g.s.singkat || g.s.nama, "bold"), null, null, null, null, null, C("CV", "hdr"), C("BULAN", "hdr")]);
      rows.push([C("TOTAL TRANSAKSI :", "bold"), null, C(g.arr.length, "bold"), null, null, null, null, C("TOTAL", "hdr"), C("CV", "hdr")].concat(BULAN.map(b => C(b, "hdr"))));
      rows.push([C("GRAND TOTAL :", "bold"), null, null]);
      cvs.forEach((cv, i) => { const r = 4 + i; rows[r - 1] = rows[r - 1] || []; const row = rows[r - 1]; while (row.length < 21) row.push(null); row[7] = C(0, "tot", `SUM(J${r}:U${r})`); row[8] = C(cv, "txt"); });
      rows[3][2] = C(0, "tot", `SUM(H4:H${3 + cvs.length})`);
      while (rows.length < 9) rows.push([]);
    } else {
      rows.push([null, C(g.s.nama, "title"), null, null, null, C("TOTAL TRANSAKSI", "bold"), C(g.arr.length, "bold")]);
      rows.push([null, C([g.s.kodeBPN && "Kode satker " + g.s.kodeBPN, g.s.kodeSatker && "Digipay " + g.s.kodeSatker].filter(Boolean).join(" · "), "sub"), null, null, null, C("TOTAL INVOICE", "bold"), C(0, "tot")]);
      rows.push([]); rows.push([]);
    }
    const refs = [];
    for (const t of g.arr) refs.push(Object.assign({ cv: t.cv }, blokTrx(rows, t)));
    if (formatBpn) {
      cvs.forEach((cv, i) => {
        const row = rows[3 + i];
        for (let b = 1; b <= 12; b++) {
          const rr = refs.filter(x => x.cv === cv && x.bulan === b);
          if (rr.length) row[8 + b] = C(rr.reduce((a, x) => a + x.nilai, 0), "num", rr.map(x => x.total).join("+"));
        }
      });
    } else {
      rows[1][6] = C(refs.reduce((a, x) => a + x.nilai, 0), "tot", refs.map(x => x.total).join("+"));
    }
    sheets.push({ name: sn, cols: [16, 6, 52, 9, 10, 18, 17, 17, 22, 30].concat(Array(12).fill(15)), rows });
    ringkas.push({ g, sn, nilai: refs.reduce((a, x) => a + x.nilai, 0), byCv: cvs.map(cv => refs.filter(x => x.cv === cv).reduce((a, x) => a + x.nilai, 0)) });
  }
  const judul = formatBpn ? `PENJUALAN BADAN PERTANAHAN NASIONAL PROVINSI JAWA BARAT ${F.tahun}` : `REKAP PER SATKER ${F.tahun}${F.cv ? " — " + cvNama(F.cv) : ""}${F.kanal ? " — " + KANAL[F.kanal].label : ""}`;
  const home = [[C(judul, "title")], [C(`Periode ${BULAN[+F.dari - 1]} – ${BULAN[+F.sampai - 1]} ${F.tahun} · nilai termasuk PPN · dibuat ${new Date().toLocaleString("id-ID")}`, "sub")], []];
  if (formatBpn) {
    home.push([C("PT/CV", "hdr")].concat(BULAN.map(b => C(b, "hdr"))).concat([C("TOTAL", "hdr")]));
    cvs.forEach((cv, i) => {
      const r = home.length + 1;
      home.push([C(cvNama(cv), "txt")].concat(BULAN.map((_, b) => { const col = String.fromCharCode(74 + b); const f = ringkas.map(x => `'${x.sn}'!${col}${4 + i}`).join("+"); const v = list.filter(t => t.cv === cv && +t.tanggal.slice(5, 7) === b + 1).reduce((a, t) => a + hitung(t).total, 0); return C(v, "num", f || null); })).concat([C(0, "tot", `SUM(B${r}:M${r})`)]));
    });
    home.push([]);
  }
  const h0 = home.length + 1;
  home.push([C("NO", "hdr"), C(formatBpn ? "KODE" : "KODE SATKER", "hdr"), C(formatBpn ? "NAMA KANTAH" : "NAMA SATKER", "hdr"), C("TRANSAKSI", "hdr")].concat(cvs.map(c => C(c, "hdr"))).concat([C("TOTAL", "hdr")]));
  ringkas.forEach((x, i) => {
    home.push([C(i + 1, "date"), C(x.g.s.kodeBPN || (formatBpn ? x.g.s.kodeKantah : x.g.s.kodeSatker) || "", "txt"), C(formatBpn ? (x.g.s.singkat || x.g.s.nama) : x.g.s.nama, "txt"), C(x.g.arr.length, "num", formatBpn ? `'${x.sn}'!C3` : `'${x.sn}'!G1`)]
      .concat(x.byCv.map(v => C(v, "num"))).concat([C(x.nilai, "num", formatBpn ? `'${x.sn}'!C4` : `'${x.sn}'!G2`)]));
  });
  const hn = home.length;
  home.push([null, null, C("GRAND TOTAL", "totl"), C(0, "tot", `SUM(D${h0 + 1}:D${hn})`)].concat(cvs.map((_, i) => { const col = String.fromCharCode(69 + i); return C(0, "tot", `SUM(${col}${h0 + 1}:${col}${hn})`); })).concat([C(0, "tot", `SUM(${String.fromCharCode(69 + cvs.length)}${h0 + 1}:${String.fromCharCode(69 + cvs.length)}${hn})`)]));
  sheets.unshift({ name: formatBpn ? "BERANDA" : "HOME", cols: formatBpn ? [34, 14, 38, 14, 14, 14, 14, 14, 14, 14, 14, 14, 14, 16] : [6, 14, 46, 12, 16, 16, 16, 18], rows: home });
  const fn = formatBpn ? `BELANJA BPN ${F.tahun}.xlsx` : `REKAP PER SATKER ${F.tahun}${F.cv ? " " + F.cv : ""}${F.kanal ? " " + KANAL[F.kanal].label : ""}.xlsx`;
  exportBook({ filename: fn, sheets });
}

function exportPajak(list, F) {
  const cvs = S.data.cv.map(c => c.kode).filter(c => !F.cv || c === F.cv);
  const rows = [[C(`REKAP PAJAK ${F.tahun}`, "title")], [C("PPh 22 barang " + fmtN(S.data.settings.pph22) + "% · PPh 23 jasa " + fmtN(S.data.settings.pph23) + "% · PPN " + S.data.settings.ppn + "% (dari DPP)", "sub")], [],
    ["CV", "BULAN", "TRANSAKSI", "DPP", "PPN", "PPN DIPUNGUT INSTANSI", "PPh 22", "PPh 23", "PLATFORM FEE"].map(h => C(h, "hdr"))];
  cvs.forEach(cv => BULAN.forEach((b, i) => {
    if (i + 1 < +F.dari || i + 1 > +F.sampai) return;
    const a = list.filter(t => t.cv === cv && +t.tanggal.slice(5, 7) === i + 1); if (!a.length) return;
    let r = { dpp: 0, ppn: 0, w: 0, p22: 0, p23: 0, fee: 0 }; a.forEach(t => { const h = hitung(t); r.dpp += h.dpp; r.ppn += h.ppn; if (h.wapu) r.w += h.ppn; r.p22 += h.pph22; r.p23 += h.pph23; r.fee += h.fee; });
    rows.push([C(cv, "txt"), C(b, "txt"), C(a.length, "num"), C(r.dpp, "num"), C(r.ppn, "num"), C(r.w, "num"), C(r.p22, "num"), C(r.p23, "num"), C(r.fee, "num")]);
  }));
  const n = rows.length;
  rows.push([C("TOTAL", "totl"), null].concat(["C", "D", "E", "F", "G", "H", "I"].map(c => C(0, "tot", `SUM(${c}5:${c}${n})`))));
  const det = [["TANGGAL", "CV", "KANAL", "SATKER", "NO. TRANSAKSI", "DPP BARANG+JASA", "PPN", "PPh 22", "PPh 23", "WAPU"].map(h => C(h, "hdr"))];
  list.filter(t => cvs.includes(t.cv)).sort((a, b) => a.tanggal.localeCompare(b.tanggal)).forEach(t => { const h = hitung(t); det.push([C(tgl(t.tanggal), "date"), C(t.cv, "date"), C(KANAL[t.kanal].label, "txt"), C(satkerById(t.satkerId).nama, "txt"), C(t.noTrx || "", "txt"), C(h.dpp, "num"), C(h.ppn, "num"), C(h.pph22, "num"), C(h.pph23, "num"), C(h.wapu ? "Ya" : "Tidak", "date")]); });
  exportBook({ filename: `Rekap Pajak ${F.tahun}.xlsx`, sheets: [{ name: "PAJAK", cols: [8, 13, 11, 16, 15, 20, 14, 14, 14], rows, freeze: 4 }, { name: "PER TRANSAKSI", cols: [11, 6, 12, 40, 30, 17, 15, 13, 13, 7], rows: det, freeze: 1 }] });
}

// ================================================================ MASTER
function pgMaster(el, tab) {
  tab = tab || "barang";
  el.innerHTML = `<div class="topbar"><div><h1>Master Data</h1></div></div>
  <div class="tabs">${[["barang", `Barang (${S.data.barang.length})`], ["satker", `Satker / instansi (${S.data.satker.length})`], ["cv", "Profil CV"]].map(([k, l]) => `<a href="#/master/${k}" class="${k === tab ? "on" : ""}">${l}</a>`).join("")}</div><div id="mBody"></div>`;
  ({ barang: msBarang, satker: msSatker, cv: msCV })[tab]($("#mBody"));
}

function msBarang(el) {
  const F = S.filters.barang = S.filters.barang || { q: "", jenis: "" };
  const draw = () => {
    let list = F.q ? cariBarangX(F.q).list : S.data.barang.slice();
    if (F.jenis) list = list.filter(b => (b.jenis || "B") === F.jenis);
    const usage = {}; S.data.transaksi.forEach(t => t.items.forEach(i => { if (i.barangId) usage[i.barangId] = (usage[i.barangId] || 0) + 1; }));
    $("#bt").innerHTML = `<table><thead><tr><th>Kode</th><th>Nama barang</th><th>Merk</th><th>Satuan</th><th class="num">Harga instansi</th><th class="num">Exclude PPN</th><th>Jenis</th><th class="num">Dipakai</th></tr></thead><tbody>
    ${list.slice(0, 400).map(b => `<tr class="click" data-b="${b.id}"><td class="small">${esc(b.kode)}</td><td>${esc(b.nama)}${(b.alias || []).length ? `<div class="small mute">alias: ${esc(b.alias.slice(0, 3).join(" · "))}${b.alias.length > 3 ? " …" : ""}</div>` : ""}</td><td class="small">${esc(b.merk)}</td><td>${esc(b.satuan)}</td><td class="num">${rp(b.harga)}</td><td class="num mute">${rp(b.harga / (1 + S.data.settings.ppn / 100))}</td><td>${b.jenis === "J" ? '<span class="b warn">Jasa</span>' : '<span class="b k">Barang</span>'}</td><td class="num">${usage[b.id] || ""}</td></tr>`).join("")}
    </tbody></table>${list.length > 400 ? `<p class="mute small" style="padding:8px 12px">Menampilkan 400 dari ${list.length}. Persempit pencarian.</p>` : ""}`;
    $$("tr[data-b]", el).forEach(tr => tr.onclick = () => dlgBarang(S.idx.barang[tr.dataset.b]));
  };
  el.innerHTML = `<div class="card"><div class="filters">
    <label class="f" style="flex:1;min-width:240px"><span>Cari barang (nama / kode / merk / nama katalog)</span><input id="bq" value="${esc(F.q)}" placeholder="mis. tinta epson 003"></label>
    <label class="f"><span>Jenis</span><select id="bj">${optList({ B: "Barang (PPh 22)", J: "Jasa (PPh 23)" }, F.jenis, "Semua")}</select></label>
    <button id="bNew" class="pri">+ Barang</button>${S.data.me.role === "admin" ? `<label class="btn">Impor dari Excel<input type="file" id="bImp" accept=".xlsx,.xls" hidden></label>` : ""}<button id="bX">Unduh Excel</button></div>
    <p class="small mute" style="margin:8px 0 0">Alias = nama barang di katalog (mis. "TINTA EPSON T673 BK - OSI 604") yang pernah dihubungkan ke barang ini. Aplikasi mempelajarinya otomatis setiap transaksi disimpan, jadi impor berikutnya langsung cocok.</p></div>
    <div class="card tight"><div class="tw" id="bt" style="max-height:70vh"></div></div>`;
  $("#bq").oninput = e => { F.q = e.target.value; draw(); };
  $("#bj").onchange = e => { F.jenis = e.target.value; draw(); };
  $("#bNew").onclick = () => dlgBarang({ id: 0, kode: "", nama: F.q.toUpperCase(), merk: "", satuan: "PCS", harga: 0, jenis: "B" });
  $("#bX").onclick = () => exportBook({ filename: "Master Barang.xlsx", sheets: [{ name: "BARANG", cols: [6, 14, 50, 16, 11, 15, 15, 8], freeze: 1, rows: [["NO", "KODE ITEM", "NAMA ITEM", "MERK", "SATUAN", "HARGA INSTANSI", "HARGA EXCLUDE", "JENIS"].map(h => C(h, "hdr"))].concat(S.data.barang.map((b, i) => [C(i + 1, "date"), C(b.kode, "txt"), C(b.nama, "txt"), C(b.merk, "txt"), C(b.satuan, "date"), C(b.harga, "num"), C(Math.round(b.harga / (1 + S.data.settings.ppn / 100)), "num", `ROUND(F${i + 2}/${1 + S.data.settings.ppn / 100},0)`), C(b.jenis === "J" ? "JASA" : "BARANG", "date")])) }] });
  const imp = $("#bImp");
  if (imp) imp.onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const wb = XLSX.read(await f.arrayBuffer());
      const ws = wb.Sheets[wb.SheetNames[0]];
      const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true });
      const hi = aoa.findIndex(r => r.some(c => /NAMA/i.test(String(c || ""))));
      if (hi < 0) throw new Error("Kolom NAMA tidak ditemukan.");
      const H = aoa[hi].map(c => String(c || "").toUpperCase().replace(/\s+/g, " "));
      const col = re => H.findIndex(h => re.test(h));
      const ci = { kode: col(/KODE/), nama: col(/NAMA/), merk: col(/MERK/), sat: col(/SATUAN/), harga: col(/HARGA INSTANSI|^HARGA$|HARGA JUAL|HARGA/), jenis: col(/JENIS/) };
      const rows = aoa.slice(hi + 1).filter(r => r[ci.nama]).map(r => ({ kode: ci.kode >= 0 ? String(r[ci.kode] || "").trim() : "", nama: String(r[ci.nama]).trim(), merk: ci.merk >= 0 ? String(r[ci.merk] || "").trim() : "", satuan: ci.sat >= 0 ? String(r[ci.sat] || "").trim().toUpperCase() : "PCS", harga: ci.harga >= 0 ? P.angka(r[ci.harga]) : 0, jenis: ci.jenis >= 0 && /JASA|^J$/i.test(String(r[ci.jenis] || "")) ? "J" : "B" }));
      if (!(await confirmBox(`Terbaca <b>${rows.length}</b> barang dari "${esc(f.name)}". Barang dengan nama sama akan diperbarui kode, merk, satuan, dan harganya; sisanya ditambahkan. Lanjutkan?`, "Impor"))) return;
      const r = await api("/api/barang/impor", { barang: rows });
      toast(`Impor selesai: ${r.baru} baru, ${r.ubah} diperbarui`); await loadState(); render();
    } catch (er) { toast(er.message, true); }
    e.target.value = "";
  };
  draw();
}

function dlgBarang(b) {
  b = clone(b);
  const m = modal(b.id ? "Ubah barang" : "Barang baru", `<div class="grid g2">
    <label class="f span2"><span>Nama barang *</span><input id="bn" value="${esc(b.nama)}"></label>
    <label class="f"><span>Kode item</span><input id="bk" value="${esc(b.kode)}"></label>
    <label class="f"><span>Merk</span><input id="bm" value="${esc(b.merk)}"></label>
    <label class="f"><span>Satuan</span><input id="bs" value="${esc(b.satuan)}"></label>
    <label class="f"><span>Harga instansi (termasuk PPN)</span><input id="bh" type="number" min="0" value="${b.harga || 0}"></label>
    <label class="f span2"><span>Jenis (menentukan PPh)</span><select id="bjn">${optList({ B: "Barang — PPh 22 " + fmtN(S.data.settings.pph22) + "%", J: "Jasa — PPh 23 " + fmtN(S.data.settings.pph23) + "%" }, b.jenis || "B")}</select></label>
    ${(b.alias || []).length ? `<div class="span2 small"><b>Alias / nama katalog:</b><br>${b.alias.map(a => `<span class="b k" style="margin:2px">${esc(a)}</span>`).join(" ")} <a href="#" id="clrAlias">hapus semua alias</a></div>` : ""}
  </div>`, { buttons: [].concat(b.id && S.data.me.role === "admin" ? [{ label: "Hapus", cls: "danger", onClick: async () => { if (!(await confirmBox("Hapus barang ini dari master? Transaksi lama tidak berubah.", "Hapus"))) return false; await api("/api/barang/hapus", { id: b.id }); await loadState(); render(); } }] : []).concat([{ label: "Batal" }, { label: "Simpan", cls: "pri", onClick: async () => {
    try { await api("/api/barang", Object.assign(b, { nama: $("#bn").value, kode: $("#bk").value, merk: $("#bm").value, satuan: $("#bs").value.toUpperCase(), harga: Number($("#bh").value), jenis: $("#bjn").value })); await loadState(); toast("Barang tersimpan"); render(); }
    catch (e) { toast(e.message, true); return false; } } }]) });
  const ca = $("#clrAlias", m.el); if (ca) ca.onclick = e => { e.preventDefault(); b.alias = []; ca.parentNode.remove(); };
}

function msSatker(el) {
  const F = S.filters.sat = S.filters.sat || { q: "" };
  const draw = () => {
    const list = F.q ? cariSatker(F.q).concat([]) : S.data.satker.slice().sort((a, b) => (a.grup === "BPN" ? 0 : 1) - (b.grup === "BPN" ? 0 : 1) || (a.kodeKantah || "zz").localeCompare(b.kodeKantah || "zz") || a.nama.localeCompare(b.nama));
    const use = {}; S.data.transaksi.forEach(t => use[t.satkerId] = (use[t.satkerId] || 0) + 1);
    $("#st").innerHTML = `<table><thead><tr><th>Nama satker</th><th>Singkatan / sheet</th><th>Grup</th><th>Kode satker BPN</th><th>Kode wilayah</th><th>Kode Digipay</th><th>PPN</th><th class="num">Transaksi</th></tr></thead><tbody>
    ${list.map(s => `<tr class="click" data-s="${s.id}"><td>${esc(s.nama)}</td><td>${esc(s.singkat)}</td><td>${esc(s.grup)}</td><td class="nowrap">${s.kodeBPN ? esc(s.kodeBPN) : (s.grup === "BPN" ? '<span class="b warn">belum diisi</span>' : '<span class="mute small">–</span>')}</td><td>${esc(s.kodeKantah)}</td><td>${s.kodeSatker ? esc(s.kodeSatker) : '<span class="mute small">–</span>'}</td><td>${s.wapu === false ? '<span class="b warn">NON-WAPU</span>' : '<span class="b k">WAPU</span>'}</td><td class="num">${use[s.id] || ""}</td></tr>`).join("")}</tbody></table>`;
    $$("tr[data-s]", el).forEach(tr => tr.onclick = () => dlgSatker(S.idx.satker[tr.dataset.s]));
  };
  el.innerHTML = `<div class="card"><div class="filters"><label class="f" style="flex:1"><span>Cari satker</span><input id="sq" value="${esc(F.q)}"></label><button class="pri" id="sNew">+ Satker</button></div>
  <p class="small mute" style="margin:8px 0 0">Kode satker Digipay = 6 digit awal No. Invoice (mis. <b>429740</b>/00/20261023/074531 = BPN Kab. Tasikmalaya). Isi kodenya supaya satker terpilih otomatis saat menempel data Digipay. Grup <b>BPN</b> masuk ke rekap format Belanja BPN.<br>Kode satker BPN = <b>55-</b>kode wilayah Kemendagri<b>-00</b> (32 = Jawa Barat, 32.06 = Kab. Tasikmalaya → 55-32.06-00). Terisi otomatis dari kode wilayah.</p></div>
  <div class="card tight"><div class="tw" id="st"></div></div>`;
  $("#sq").oninput = e => { F.q = e.target.value; draw(); };
  $("#sNew").onclick = () => dlgSatker({ id: 0, nama: "", singkat: "", grup: "Lainnya", kodeKantah: "", kodeSatker: "", wapu: true });
  draw();
}

function dlgSatker(s, onSaved) {
  s = clone(s);
  const md = modal(s.id ? "Ubah satker" : "Satker baru", `<div class="grid g2">
    <label class="f span2"><span>Nama satker lengkap *</span><input id="sn" value="${esc(s.nama)}" placeholder="KANTOR PERTANAHAN KAB. TASIKMALAYA"></label>
    <label class="f"><span>Singkatan (nama sheet di Excel)</span><input id="ss" value="${esc(s.singkat || "")}" placeholder="KAB. TASIKMALAYA"></label>
    <label class="f"><span>Grup</span><select id="sg">${optList({ BPN: "BPN (Kantah / Kanwil)", Lainnya: "Instansi lain" }, s.grup || "Lainnya")}</select></label>
    <label class="f"><span>Kode wilayah (Kemendagri)</span><input id="sk" value="${esc(s.kodeKantah || "")}" placeholder="32.06"></label>
    <label class="f"><span>Kode satker BPN</span><input id="sb" value="${esc(s.kodeBPN || "")}" placeholder="55-32.06-00"></label>
    <label class="f span2"><span>Kode satker Digipay (6 digit)</span><input id="sc" value="${esc(s.kodeSatker || "")}" placeholder="429740"></label>
    <label class="check span2"><input type="checkbox" id="sw" ${s.wapu !== false ? "checked" : ""}> Instansi memungut PPN (WAPU)</label>
    <label class="f span2"><span>Nama lain (pisahkan dengan baris baru) — dipakai untuk mencocokkan nama di PDF / Digipay</span><textarea id="sa">${esc((s.alias || []).join("\n"))}</textarea></label>
  </div>`, { buttons: [].concat(s.id && S.data.me.role === "admin" ? [{ label: "Hapus", cls: "danger", onClick: async () => { try { await api("/api/satker/hapus", { id: s.id }); await loadState(); render(); } catch (e) { toast(e.message, true); return false; } } }] : []).concat([{ label: "Batal" }, { label: "Simpan", cls: "pri", onClick: async () => {
    Object.assign(s, { nama: $("#sn").value, singkat: $("#ss").value.toUpperCase(), grup: $("#sg").value, kodeKantah: $("#sk").value.trim(), kodeBPN: $("#sb").value.trim(), kodeSatker: $("#sc").value.trim(), wapu: $("#sw").checked, alias: $("#sa").value.split("\n").map(x => x.trim()).filter(Boolean) });
    if (!s.singkat) s.singkat = s.nama.replace(/^KANTOR PERTANAHAN\s*/i, "");
    if (!s.kodeBPN && s.grup === "BPN" && /^\d{2}\.\d{2}$/.test(s.kodeKantah)) s.kodeBPN = "55-" + s.kodeKantah + "-00";
    try { const r = await api("/api/satker", s); s.id = r.id; await loadState(); toast("Satker tersimpan"); if (onSaved) onSaved(S.idx.satker[r.id]); else render(); }
    catch (e) { toast(e.message, true); return false; } } }]) });
  // kode satker BPN ikut terisi saat kode wilayah diketik
  const sk = $("#sk", md.el), sb = $("#sb", md.el);
  let auto = sb.value === "" || sb.value === "55-" + sk.value + "-00";
  sb.addEventListener("input", () => { auto = sb.value === ""; });
  sk.addEventListener("input", () => { if (auto && /^\d{2}\.\d{2}$/.test(sk.value.trim())) sb.value = "55-" + sk.value.trim() + "-00"; });
}

function msCV(el) {
  el.innerHTML = S.data.cv.map(c => `<div class="card"><h2><span class="b ${c.kode}">${c.kode}</span> ${esc(c.nama)}</h2><div class="grid g2" data-cv="${c.kode}">
    <label class="f"><span>Nama CV</span><input data-f="nama" value="${esc(c.nama)}"></label>
    <label class="f"><span>NPWP</span><input data-f="npwp" value="${esc(c.npwp || "")}"></label>
    <label class="f"><span>Direktur</span><input data-f="direktur" value="${esc(c.direktur || "")}"></label>
    <label class="f"><span>Format no. surat jalan <span class="mute">({MM} bulan, {YY} tahun, {NN} urut)</span></span><input data-f="formatSJ" value="${esc(c.formatSJ || "")}"></label>
    <label class="f span2"><span>Alamat</span><input data-f="alamat" value="${esc(c.alamat || "")}"></label>
  </div>${S.data.me.role === "admin" ? `<div class="row end"><button class="pri" data-save="${c.kode}">Simpan</button></div>` : ""}</div>`).join("");
  $$("[data-save]", el).forEach(b => b.onclick = async () => {
    const box = $(`[data-cv="${b.dataset.save}"]`, el); const c = clone(S.data.cv.find(x => x.kode === b.dataset.save));
    $$("[data-f]", box).forEach(i => c[i.dataset.f] = i.value);
    try { await api("/api/cv", c); await loadState(); toast("Profil CV tersimpan"); } catch (e) { toast(e.message, true); }
  });
}

// ================================================================ PENGATURAN
function pgPengaturan(el) {
  const st = S.data.settings, admin = S.data.me.role === "admin";
  el.innerHTML = `<div class="topbar"><div><h1>Pengaturan</h1></div></div>
  <div id="gdBox"></div>
  <div class="card"><h2>Alamat aplikasi</h2><p>Di komputer ini: <b>http://localhost:${location.port || 80}</b></p>${S.alamat.length ? `<p>Dari komputer / HP lain di jaringan yang sama:<br>${S.alamat.map(a => `<b>${esc(a)}</b>`).join("<br>")}</p>` : ""}<p class="small mute">Jendela hitam aplikasi harus tetap terbuka. Data tersimpan di folder <code>data</code> di samping RekapPenjualan.exe.</p></div>
  ${admin ? `<div class="card"><h2>Pajak</h2><div class="grid g4">
    <label class="f span2"><span>Judul aplikasi</span><input id="sNama" value="${esc(st.namaUsaha)}"></label>
    <label class="f"><span>PPN (%)</span><input id="sPpn" type="number" step="0.01" value="${st.ppn}"></label><span></span>
    <label class="f"><span>PPh 22 barang (%)</span><input id="sP22" type="number" step="0.01" value="${st.pph22}"></label>
    <label class="f"><span>PPh 23 jasa (%)</span><input id="sP23" type="number" step="0.01" value="${st.pph23}"></label></div>
    <p class="small mute">PPh dihitung dari DPP (harga sebelum PPN). Untuk Digipay, harga sudah termasuk PPN sehingga DPP = harga ÷ ${(1 + st.ppn / 100).toFixed(2)}. Mengubah tarif berlaku ke semua perhitungan, termasuk transaksi lama.</p>
    <div class="row end"><button class="pri" id="sSave">Simpan</button></div></div>` : ""}
  ${admin ? `<div class="card tight"><div class="card-h"><h2 style="margin:0">Pengguna</h2><button class="sm pri" id="uNew">+ Pengguna</button></div><table><thead><tr><th>Nama</th><th>Username</th><th>Peran</th><th>Status</th></tr></thead><tbody>
    ${S.data.users.map(u => `<tr class="click" data-u="${u.id}"><td>${esc(u.nama)}</td><td>${esc(u.username)}</td><td>${u.role === "admin" ? "Admin" : "Petugas"}</td><td>${u.aktif ? '<span class="b ok">aktif</span>' : '<span class="b err">nonaktif</span>'}</td></tr>`).join("")}</tbody></table>
    <p class="small mute" style="padding:0 16px">Petugas bisa mencatat & mengubah transaksi serta menambah master. Hanya admin yang bisa menghapus, mengubah pajak, pengguna, dan backup.</p></div>` : ""}
  <div class="card"><h2>Ganti kata sandi saya</h2><div class="grid g3"><label class="f"><span>Kata sandi lama</span><input id="pwL" type="password"></label><label class="f"><span>Kata sandi baru</span><input id="pwB" type="password"></label><div style="padding-top:20px"><button id="pwS">Ganti</button></div></div></div>
  ${admin ? `<div class="card"><h2>Backup &amp; pulihkan</h2><p class="small mute">Backup otomatis dibuat setiap hari di folder <code>data\\backups</code> (45 hari terakhir). Tetap unduh backup ke flashdisk minimal seminggu sekali.</p>
    <div class="row"><a class="btn pri" href="/api/backup">Unduh backup sekarang</a><label class="btn danger">Pulihkan dari file backup…<input type="file" id="rst" accept=".json" hidden></label></div></div>
    <div class="card tight"><div class="card-h"><h2 style="margin:0">Transaksi terhapus (${S.data.terhapus ? S.data.terhapus.length : 0})</h2></div>
    ${(S.data.terhapus || []).length ? `<table><thead><tr><th>Tanggal</th><th>CV</th><th>Satker</th><th>No.</th><th class="num">Total</th><th>Dihapus</th><th></th></tr></thead><tbody>${S.data.terhapus.map(t => `<tr><td>${tgl(t.tanggal)}</td><td>${t.cv}</td><td>${esc(satkerById(t.satkerId).nama)}</td><td>${esc(t.noTrx)}</td><td class="num">${rp(hitung(t).total)}</td><td class="small">${esc(t.diubah || "")} ${esc(t.diubahOleh || "")}</td><td><button class="sm" data-pul="${t.id}">Pulihkan</button></td></tr>`).join("")}</tbody></table>` : `<p class="mute" style="padding:0 16px 8px">Kosong.</p>`}</div>` : ""}
  <p class="small mute">Rekap Penjualan Instansi v1.0.0</p>`;
  if (admin) {
    $("#sSave").onclick = async () => { try { await api("/api/settings", { namaUsaha: $("#sNama").value, ppn: +$("#sPpn").value, pph22: +$("#sP22").value, pph23: +$("#sP23").value }); await loadState(); toast("Pengaturan tersimpan"); render(); } catch (e) { toast(e.message, true); } };
    $("#uNew").onclick = () => dlgUser({ id: 0, nama: "", username: "", role: "petugas", aktif: true });
    $$("tr[data-u]", el).forEach(tr => tr.onclick = () => dlgUser(S.data.users.find(u => u.id === +tr.dataset.u)));
    $("#rst").onchange = async e => {
      const f = e.target.files[0]; if (!f) return;
      try { const d = JSON.parse(await f.text()); if (!(await confirmBox(`Pulihkan data dari <b>${esc(f.name)}</b>? Data saat ini diganti (salinannya disimpan di folder backups).`, "Pulihkan"))) return; await api("/api/restore", d); toast("Data dipulihkan"); S.data = null; boot(); }
      catch (er) { toast(er.message, true); }
    };
    $$("[data-pul]", el).forEach(b => b.onclick = async () => { await api("/api/transaksi/pulihkan", { id: +b.dataset.pul }); await loadState(); toast("Transaksi dipulihkan"); render(); });
  }
  if (typeof gdPengaturan === "function") { gdPengaturan($("#gdBox")); gdRefresh(); }
  $("#pwS").onclick = async () => { try { await api("/api/password", { lama: $("#pwL").value, baru: $("#pwB").value }); toast("Kata sandi diganti"); $("#pwL").value = $("#pwB").value = ""; } catch (e) { toast(e.message, true); } };
}

function dlgUser(u) {
  modal(u.id ? "Ubah pengguna" : "Pengguna baru", `<div class="grid g2">
    <label class="f"><span>Nama</span><input id="un" value="${esc(u.nama)}"></label><label class="f"><span>Username</span><input id="uu" value="${esc(u.username)}"></label>
    <label class="f"><span>Peran</span><select id="ur">${optList({ petugas: "Petugas", admin: "Admin" }, u.role)}</select></label>
    <label class="f"><span>${u.id ? "Kata sandi baru (kosongkan bila tidak diganti)" : "Kata sandi (min. 6)"}</span><input id="up" type="password"></label>
    ${u.id ? `<label class="check"><input type="checkbox" id="ua" ${u.aktif ? "checked" : ""}> Aktif</label>` : ""}</div>`,
    { buttons: [{ label: "Batal" }, { label: "Simpan", cls: "pri", onClick: async () => { try { await api("/api/user", { id: u.id, nama: $("#un").value, username: $("#uu").value, role: $("#ur").value, password: $("#up").value, aktif: u.id ? $("#ua").checked : true }); await loadState(); toast("Pengguna tersimpan"); render(); } catch (e) { toast(e.message, true); return false; } } }] });
}

boot().catch(e => { $("#root").innerHTML = `<p style="padding:40px">Tidak bisa terhubung ke aplikasi: ${esc(e.message)}</p>`; });
