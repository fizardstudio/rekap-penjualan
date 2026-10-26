/* Dashboard — grafik SVG tanpa library (offline). Bergantung pada app.js (S, hitung, rp, rpS, esc, $, $$...). */
"use strict";

// warna entitas tetap (warna mengikuti CV, bukan urutan). Divalidasi: CVD ΔE ≥ 9.2 semua pasangan.
const CV_WARNA = { PKM: "#2a78d6", OSI: "#eb6834", DKS: "#1baf7a" };
const WARNA_LAIN = ["#e87ba4", "#008300", "#6250d6"];
const ABU = "#9aa3af", GRID = "#eceff3", TEKS2 = "#667085";
function warnaCV(k, i) { return CV_WARNA[k] || WARNA_LAIN[i % WARNA_LAIN.length]; }

const NS = "http://www.w3.org/2000/svg";
function sv(tag, at, parent) {
  const e = document.createElementNS(NS, tag);
  for (const k in at) e.setAttribute(k, at[k]);
  if (parent) parent.appendChild(e);
  return e;
}

// angka ringkas untuk sumbu: 0 · 500 jt · 1,5 M
function ringkas(n) {
  const a = Math.abs(n);
  if (a >= 1e9) return fmtN(n / 1e9, a >= 1e10 ? 0 : 1) + " M";
  if (a >= 1e6) return fmtN(n / 1e6, a >= 1e7 ? 0 : 1) + " jt";
  if (a >= 1e3) return fmtN(n / 1e3, 0) + " rb";
  return fmtN(n, 0);
}
function tickBagus(max, n) {
  if (max <= 0) return [0, 1];
  const raw = max / (n || 4), p = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map(m => m * p).find(s => s >= raw);
  const out = []; for (let v = 0; v <= max + step * 0.001; v += step) out.push(v);
  if (out[out.length - 1] < max) out.push(out[out.length - 1] + step);
  return out;
}

// ---------------------------------------------------------------- tooltip
let TT = null;
function tooltip() {
  if (!TT) { TT = document.createElement("div"); TT.className = "tt hidden"; document.body.appendChild(TT); }
  return TT;
}
// rows: [{color, label, value, line:bool}], judul
function tampilTT(ev, judul, rows, foot) {
  const t = tooltip();
  t.textContent = "";
  const h = document.createElement("div"); h.className = "tt-h"; h.textContent = judul; t.appendChild(h);
  rows.forEach(r => {
    const d = document.createElement("div"); d.className = "tt-r";
    const k = document.createElement("i"); k.style.background = r.color; d.appendChild(k);
    const v = document.createElement("b"); v.textContent = r.value; d.appendChild(v);
    const l = document.createElement("span"); l.textContent = r.label; d.appendChild(l);
    t.appendChild(d);
  });
  if (foot) { const f = document.createElement("div"); f.className = "tt-f"; f.textContent = foot; t.appendChild(f); }
  t.classList.remove("hidden");
  const w = t.offsetWidth, hgt = t.offsetHeight;
  let x = ev.clientX + 14, y = ev.clientY + 14;
  if (x + w > innerWidth - 8) x = ev.clientX - w - 14;
  if (y + hgt > innerHeight - 8) y = ev.clientY - hgt - 14;
  t.style.left = Math.max(8, x) + "px"; t.style.top = Math.max(8, y) + "px";
}
function sembunyiTT() { if (TT) TT.classList.add("hidden"); }

// ---------------------------------------------------------------- kolom bertumpuk
// cfg: {cats:[label], series:[{key,label,color,values}], tinggi}
function grafikKolom(el, cfg) {
  el.textContent = "";
  const W = Math.max(300, el.clientWidth), H = cfg.tinggi || 260, m = { l: 54, r: 10, t: 22, b: 26 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const tot = cfg.cats.map((_, i) => cfg.series.reduce((a, s) => a + (s.values[i] || 0), 0));
  const ticks = tickBagus(Math.max(...tot), 4), ymax = ticks[ticks.length - 1];
  const y = v => m.t + ih - (v / ymax) * ih;
  const svg = sv("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": cfg.aria || "grafik kolom" }, el);
  ticks.forEach(v => {
    sv("line", { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), stroke: GRID, "stroke-width": 1 }, svg);
    const t = sv("text", { x: m.l - 8, y: y(v) + 4, "text-anchor": "end", class: "ax" }, svg); t.textContent = ringkas(v);
  });
  const band = iw / cfg.cats.length, bw = Math.min(24, band * 0.62);
  const imax = tot.indexOf(Math.max(...tot));
  cfg.cats.forEach((c, i) => {
    const cx = m.l + band * i + band / 2;
    const g = sv("g", { class: "col", tabindex: 0 }, svg);
    const bg = sv("rect", { x: m.l + band * i + 1, y: m.t, width: band - 2, height: ih, fill: "transparent", rx: 4 }, g);
    let acc = 0;
    const segs = cfg.series.map(s => ({ s, v: s.values[i] || 0 })).filter(x => x.v > 0);
    segs.forEach((x, j) => {
      const y0 = y(acc), y1 = y(acc + x.v); acc += x.v;
      const top = j === segs.length - 1;
      let h = y0 - y1 - (top ? 0 : 2); // celah 2px antar segmen
      if (h < 0.5) h = 0.5;
      const yy = y1 + (top ? 0 : 2);
      if (top && h > 4) {
        const r = 4, x0 = cx - bw / 2;
        sv("path", { d: `M${x0},${y0}V${yy + r}Q${x0},${yy} ${x0 + r},${yy}H${x0 + bw - r}Q${x0 + bw},${yy} ${x0 + bw},${yy + r}V${y0}Z`, fill: x.s.color }, g);
      } else sv("rect", { x: cx - bw / 2, y: yy, width: bw, height: h, fill: x.s.color }, g);
    });
    const lompat = band < 34 ? 2 : 1;
    if (i % lompat === 0) { const tl = sv("text", { x: cx, y: H - 8, "text-anchor": "middle", class: "ax" }, svg); tl.textContent = c; }
    if (i === imax && tot[i] > 0) { const vl = sv("text", { x: cx, y: y(tot[i]) - 6, "text-anchor": "middle", class: "vl" }, svg); vl.textContent = ringkas(tot[i]); }
    const show = ev => {
      bg.setAttribute("fill", "#f2f5f9");
      const rows = cfg.series.map(s => ({ color: s.color, label: s.label, value: "Rp " + rp(s.values[i] || 0) }));
      tampilTT(ev, cfg.tipJudul ? cfg.tipJudul(i) : c, rows, "Total Rp " + rp(tot[i]));
    };
    g.addEventListener("pointermove", show);
    g.addEventListener("focus", () => { const r = bg.getBoundingClientRect(); show({ clientX: r.right, clientY: r.top + 20 }); });
    g.addEventListener("pointerleave", () => { bg.setAttribute("fill", "transparent"); sembunyiTT(); });
    g.addEventListener("blur", () => { bg.setAttribute("fill", "transparent"); sembunyiTT(); });
    if (cfg.onClick) { g.style.cursor = "pointer"; g.addEventListener("click", () => cfg.onClick(i)); }
  });
  sv("line", { x1: m.l, x2: W - m.r, y1: y(0), y2: y(0), stroke: "#cfd5de", "stroke-width": 1 }, svg);
}

// ---------------------------------------------------------------- garis (crosshair)
// cfg: {cats, series:[{label,color,values (null = belum ada), area:bool, tipis:bool}]}
function grafikGaris(el, cfg) {
  el.textContent = "";
  const W = Math.max(300, el.clientWidth), H = cfg.tinggi || 240, m = { l: 54, r: W < 500 ? 44 : 70, t: 16, b: 26 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const all = cfg.series.flatMap(s => s.values.filter(v => v != null));
  const ticks = tickBagus(Math.max(1, ...all), 4), ymax = ticks[ticks.length - 1];
  const x = i => m.l + (cfg.cats.length === 1 ? iw / 2 : (iw * i) / (cfg.cats.length - 1));
  const y = v => m.t + ih - (v / ymax) * ih;
  const svg = sv("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": cfg.aria || "grafik garis" }, el);
  ticks.forEach(v => {
    sv("line", { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), stroke: GRID, "stroke-width": 1 }, svg);
    const t = sv("text", { x: m.l - 8, y: y(v) + 4, "text-anchor": "end", class: "ax" }, svg); t.textContent = ringkas(v);
  });
  const lompat = iw / cfg.cats.length < 34 ? 2 : 1;
  cfg.cats.forEach((c, i) => { if (i % lompat) return; const t = sv("text", { x: x(i), y: H - 8, "text-anchor": "middle", class: "ax" }, svg); t.textContent = c; });
  const labels = [];
  cfg.series.forEach(s => {
    const pts = s.values.map((v, i) => v == null ? null : [x(i), y(v)]).filter(Boolean);
    if (!pts.length) return;
    if (s.area) sv("path", { d: `M${pts[0][0]},${y(0)}L` + pts.map(p => p.join(",")).join("L") + `L${pts[pts.length - 1][0]},${y(0)}Z`, fill: s.color, opacity: 0.1 }, svg);
    sv("path", { d: "M" + pts.map(p => p.join(",")).join("L"), fill: "none", stroke: s.color, "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round", "stroke-dasharray": s.putus ? "1 0" : "" }, svg);
    const last = pts[pts.length - 1], lv = s.values.filter(v => v != null).pop();
    sv("circle", { cx: last[0], cy: last[1], r: 4, fill: s.color, stroke: "#fff", "stroke-width": 2 }, svg);
    labels.push({ y: last[1], x: last[0], text: ringkas(lv), color: s.color });
  });
  // label ujung: jika bertabrakan, cukup legenda + tooltip
  labels.sort((a, b) => a.y - b.y);
  const tabrak = labels.some((l, i) => i && l.y - labels[i - 1].y < 14);
  if (!tabrak) labels.forEach(l => { const t = sv("text", { x: l.x + 8, y: l.y + 4, class: "vl" }, svg); t.textContent = l.text; });
  // crosshair
  const ch = sv("line", { y1: m.t, y2: m.t + ih, stroke: "#98a2b3", "stroke-width": 1, visibility: "hidden" }, svg);
  const dots = cfg.series.map(s => sv("circle", { r: 4, fill: s.color, stroke: "#fff", "stroke-width": 2, visibility: "hidden" }, svg));
  const hit = sv("rect", { x: m.l - 10, y: m.t, width: iw + 20, height: ih, fill: "transparent" }, svg);
  hit.addEventListener("pointermove", ev => {
    const r = svg.getBoundingClientRect(), px = ev.clientX - r.left;
    const i = Math.max(0, Math.min(cfg.cats.length - 1, Math.round(((px - m.l) / iw) * (cfg.cats.length - 1))));
    ch.setAttribute("x1", x(i)); ch.setAttribute("x2", x(i)); ch.setAttribute("visibility", "visible");
    cfg.series.forEach((s, k) => { const v = s.values[i]; if (v == null) { dots[k].setAttribute("visibility", "hidden"); return; } dots[k].setAttribute("cx", x(i)); dots[k].setAttribute("cy", y(v)); dots[k].setAttribute("visibility", "visible"); });
    tampilTT(ev, cfg.tipJudul ? cfg.tipJudul(i) : cfg.cats[i], cfg.series.filter(s => s.values[i] != null).map(s => ({ color: s.color, label: s.label, value: "Rp " + rp(s.values[i]) })), cfg.tipFoot ? cfg.tipFoot(i) : "");
  });
  hit.addEventListener("pointerleave", () => { ch.setAttribute("visibility", "hidden"); dots.forEach(d => d.setAttribute("visibility", "hidden")); sembunyiTT(); });
}

// ---------------------------------------------------------------- sparkline
function sparkline(vals, w, h) {
  w = w || 140; h = h || 36;
  const max = Math.max(1, ...vals), n = vals.length;
  const pts = vals.map((v, i) => [(w - 6) * i / Math.max(1, n - 1) + 3, h - 4 - (v / max) * (h - 8)]);
  const last = pts[pts.length - 1];
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><path d="M${pts.map(p => p.map(z => z.toFixed(1)).join(",")).join("L")}" fill="none" stroke="#b8c0cc" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${last[0]}" cy="${last[1]}" r="4" fill="#2a78d6" stroke="#fff" stroke-width="2"/></svg>`;
}

// ---------------------------------------------------------------- batang horizontal (HTML)
// rows: [{label, sub, value, segs?:[{v,color,label}], onClick}]
function batangH(el, rows, warna, fmt) {
  fmt = fmt || (v => "Rp " + rpS(v));
  el.textContent = "";
  if (!rows.length) { el.innerHTML = `<p class="mute small" style="padding:8px 0">Belum ada data.</p>`; return; }
  const max = Math.max(...rows.map(r => r.value), 1);
  rows.forEach(r => {
    const row = document.createElement("div"); row.className = "hb-row"; row.tabIndex = 0;
    const lab = document.createElement("div"); lab.className = "hb-l";
    const n = document.createElement("div"); n.className = "hb-n"; n.textContent = r.label; lab.appendChild(n);
    if (r.sub) { const s = document.createElement("div"); s.className = "hb-s"; s.textContent = r.sub; lab.appendChild(s); }
    const tr = document.createElement("div"); tr.className = "hb-t";
    const bar = document.createElement("div"); bar.className = "hb-b"; bar.style.width = Math.max(1.5, 100 * r.value / max) + "%";
    if (r.segs) r.segs.filter(sg => sg.v > 0).forEach(sg => { const p = document.createElement("i"); p.style.flex = String(sg.v); p.style.background = sg.color; bar.appendChild(p); });
    else bar.style.background = warna;
    tr.appendChild(bar);
    const v = document.createElement("div"); v.className = "hb-v"; v.textContent = fmt(r.value);
    row.append(lab, tr, v);
    const show = ev => tampilTT(ev, r.label, r.segs ? r.segs.filter(s => s.v > 0).map(s => ({ color: s.color, label: s.label, value: "Rp " + rp(s.v) })) : [{ color: warna, label: r.tipLabel || "Nilai", value: r.tipValue || "Rp " + rp(r.value) }], r.tipFoot || (r.segs ? "Total Rp " + rp(r.value) : ""));
    row.addEventListener("pointermove", show);
    row.addEventListener("pointerleave", sembunyiTT);
    if (r.onClick) { row.style.cursor = "pointer"; row.addEventListener("click", () => { sembunyiTT(); r.onClick(); }); }
    el.appendChild(row);
  });
}

function legenda(series, bentuk) {
  return `<div class="lg">${series.map(s => `<span><i class="${bentuk === "garis" ? "ln" : ""}" style="background:${s.color}"></i>${esc(s.label)}</span>`).join("")}</div>`;
}

// ================================================================ HALAMAN DASHBOARD
function pgDashboard(el) {
  const thnNow = String(new Date().getFullYear());
  const F = S.filters.dash = S.filters.dash || { tahun: tahunList().includes(thnNow) ? thnNow : tahunList()[0], cv: "", kanal: "" };
  const thn = +F.tahun, ini = thn === new Date().getFullYear();
  const bulanSampai = ini ? new Date().getMonth() + 1 : 12; // tahun berjalan: bandingkan s.d. bulan ini
  const tglSampai = ini ? today().slice(5) : "12-31";
  const cocok = t => aktif(t) && t.tanggal && (!F.cv || t.cv === F.cv) && (!F.kanal || t.kanal === F.kanal);
  const L = S.data.transaksi.filter(t => cocok(t) && t.tanggal.startsWith(F.tahun));
  const Lp = S.data.transaksi.filter(t => cocok(t) && t.tanggal.startsWith(String(thn - 1)));
  const LpYtd = Lp.filter(t => t.tanggal.slice(5) <= tglSampai);
  const H = new Map(); const h = t => { if (!H.has(t.id)) H.set(t.id, hitung(t)); return H.get(t.id); };
  const sum = (arr, k) => arr.reduce((a, t) => a + h(t)[k], 0);
  const cvs = S.data.cv.map(c => c.kode).filter(c => !F.cv || c === F.cv);

  const total = sum(L, "total"), totalP = sum(LpYtd, "total");
  const delta = totalP ? (total - totalP) / totalP : null;
  const perBulan = cv => Array.from({ length: 12 }, (_, i) => L.filter(t => (!cv || t.cv === cv) && +t.tanggal.slice(5, 7) === i + 1).reduce((a, t) => a + h(t).total, 0));
  const bulanTot = perBulan(null);
  const nTrx = L.length, rata = nTrx ? total / nTrx : 0;
  const pph = sum(L, "pph"), bersih = sum(L, "bersih"), ppn = sum(L, "ppn");
  const tagih = S.data.transaksi.filter(t => aktif(t) && t.status !== "lunas" && t.dibuatOleh !== "migrasi" && (!F.cv || t.cv === F.cv) && (!F.kanal || t.kanal === F.kanal))
    .sort((a, b) => (a.tanggal || "").localeCompare(b.tanggal || ""));
  const nilaiTagih = tagih.reduce((a, t) => a + h(t).total, 0);
  const umur = t => t.tanggal ? Math.max(0, Math.round((new Date(today()) - new Date(t.tanggal)) / 864e5)) : 0;
  const bln = BLN3;
  const deltaHtml = delta == null ? `<span class="dl mute">belum ada data ${thn - 1}</span>`
    : `<span class="dl ${delta >= 0 ? "up" : "down"}">${delta >= 0 ? "▲" : "▼"} ${fmtN(Math.abs(delta) * 100, 1)}%</span> <span class="mute">vs ${ini ? "periode sama " : ""}${thn - 1} (Rp ${rpS(totalP)})</span>`;

  el.innerHTML = `
  <div class="topbar"><div><h1>Dashboard</h1><div class="mute">${ini ? `Tahun berjalan s.d. ${tgl(today())}` : `Tahun ${thn}`} · nilai termasuk PPN · transaksi batal tidak dihitung</div></div>
    <div class="filters">
      <label class="f"><span>Tahun</span><select id="dTahun">${tahunList().map(y => `<option ${y === F.tahun ? "selected" : ""}>${y}</option>`).join("")}</select></label>
      <label class="f"><span>CV</span><select id="dCv">${optList(cvOpts(), F.cv, "Semua CV")}</select></label>
      <label class="f"><span>Kanal</span><select id="dKanal">${optList(kanalOpts(), F.kanal, "Semua kanal")}</select></label>
      <button class="pri" onclick="location.hash='#/trx/baru'">+ Transaksi baru</button>
    </div></div>
  <div class="dash">
    <div class="dcard hero s5">
      <div class="lbl">Total penjualan ${thn}</div>
      <div class="big">Rp ${rpS(total)}</div>
      <div class="sub">${deltaHtml}</div>
      <div class="row" style="justify-content:space-between;align-items:flex-end;margin-top:10px"><div class="small mute">Rp ${rp(total)}<br>${nTrx} transaksi · ${new Set(L.map(t => t.satkerId)).size} satker</div>${sparkline(bulanTot.slice(0, bulanSampai))}</div>
    </div>
    <div class="tiles s7">
      <div class="dcard tile"><div class="lbl">Rata-rata per transaksi</div><div class="val">Rp ${rpS(rata)}</div><div class="sub mute">${nTrx} transaksi</div></div>
      <div class="dcard tile"><div class="lbl">Diterima bersih</div><div class="val">Rp ${rpS(bersih)}</div><div class="sub mute">setelah PPN, PPh &amp; fee</div></div>
      <div class="dcard tile"><div class="lbl">PPh dipotong</div><div class="val">Rp ${rpS(pph)}</div><div class="sub mute">PPN Rp ${rpS(ppn)}</div></div>
      <div class="dcard tile click" id="tTagih"><div class="lbl">Belum lunas</div><div class="val">Rp ${rpS(nilaiTagih)}</div><div class="sub mute">${tagih.length} transaksi${tagih.length ? ` · terlama ${umur(tagih[0])} hari` : ""}</div></div>
    </div>

    <div class="dcard s8"><div class="dh"><div><h2>Penjualan per bulan</h2><div class="mute small">Per CV, ${thn} — arahkan kursor ke kolom untuk rincian, klik untuk lihat transaksinya</div></div><button class="sm ghost" data-tabel="tbBulan">Tabel</button></div>
      ${legenda(cvs.map((c, i) => ({ label: c + " — " + cvNama(c).replace(/^CV\.\s*/, ""), color: warnaCV(c, i) })))}
      <div id="gBulan" class="chart"></div><div id="tbBulan" class="hidden"></div></div>
    <div class="dcard s4"><div class="dh"><div><h2>Porsi per CV</h2><div class="mute small">${thn}</div></div></div><div id="gCv"></div>
      <div class="dh" style="margin-top:18px"><div><h2>Per kanal</h2></div></div><div id="gKanal"></div></div>

    <div class="dcard s6"><div class="dh"><div><h2>Kumulatif ${thn} vs ${thn - 1}</h2><div class="mute small">Akumulasi penjualan dari Januari</div></div></div>
      ${Lp.length ? legenda([{ label: String(thn), color: "#2a78d6" }, { label: String(thn - 1), color: ABU }], "garis") : `<div class="lg"><span class="mute">Belum ada data ${thn - 1} untuk dibandingkan</span></div>`}
      <div id="gKum" class="chart"></div></div>
    <div class="dcard s6"><div class="dh"><div><h2>Perlu ditagih</h2><div class="mute small">Belum berstatus Lunas (data migrasi tidak dihitung) · terlama di atas</div></div><a href="#/transaksi" id="aTagih" class="small">Semua →</a></div>
      <div id="lTagih" class="tagih"></div></div>

    <div class="dcard s6"><div class="dh"><div><h2>10 satker terbesar</h2><div class="mute small">Nilai ${thn}, warna = CV</div></div></div><div id="gSatker"></div></div>
    <div class="dcard s6"><div class="dh"><div><h2>10 barang terlaris</h2><div class="mute small">Berdasarkan nilai ${thn}</div></div></div><div id="gBarang"></div></div>
  </div>`;

  ["Tahun", "Cv", "Kanal"].forEach(k => $("#d" + k).onchange = e => { F[k === "Tahun" ? "tahun" : k.toLowerCase()] = e.target.value; render(); });
  const keTrx = extra => { S.filters.trx = Object.assign({ tahun: F.tahun, cv: F.cv, kanal: F.kanal }, extra); location.hash = "#/transaksi"; };

  // 1. kolom bertumpuk per bulan
  const series = cvs.map((c, i) => ({ key: c, label: c, color: warnaCV(c, i), values: perBulan(c) }));
  const gambar = () => {
    grafikKolom($("#gBulan"), { cats: bln, series, tinggi: innerWidth > 1100 ? 300 : 240, aria: "Penjualan per bulan per CV", tipJudul: i => BULAN[i] + " " + thn, onClick: i => keTrx({ bulan: String(i + 1).padStart(2, "0") }) });
    const kum = (arr, n) => { let a = 0; return arr.map((v, i) => i < n ? (a += v) : null); };
    const prevBulan = Array.from({ length: 12 }, (_, i) => Lp.filter(t => +t.tanggal.slice(5, 7) === i + 1).reduce((a, t) => a + h(t).total, 0));
    const kIni = kum(bulanTot, bulanSampai), kLalu = kum(prevBulan, 12);
    const adaLalu = prevBulan.some(v => v > 0);
    grafikGaris($("#gKum"), { cats: bln, aria: "Kumulatif penjualan", series: (adaLalu ? [{ label: String(thn - 1), color: ABU, values: kLalu }] : []).concat([{ label: String(thn), color: "#2a78d6", values: kIni, area: true }]),
      tipJudul: i => "s.d. " + BULAN[i], tipFoot: i => kIni[i] != null && kLalu[i] ? `Selisih ${kIni[i] >= kLalu[i] ? "+" : "−"}Rp ${rpS(Math.abs(kIni[i] - kLalu[i]))}` : "" });
  };
  gambar();
  $("#tbBulan").innerHTML = `<div class="tw"><table class="mx"><thead><tr><th>CV</th>${bln.map(b => `<th class="num">${b}</th>`).join("")}<th class="num">Total</th></tr></thead><tbody>${series.map(s => `<tr><td><span class="b ${s.key}">${s.key}</span></td>${s.values.map(v => `<td class="num ${v ? "" : "z"}">${v ? rp(v) : "–"}</td>`).join("")}<td class="num"><b>${rp(s.values.reduce((a, b) => a + b, 0))}</b></td></tr>`).join("")}</tbody></table></div>`;
  $$("[data-tabel]", el).forEach(b => b.onclick = () => { const t = $("#" + b.dataset.tabel); t.classList.toggle("hidden"); b.textContent = t.classList.contains("hidden") ? "Tabel" : "Sembunyikan tabel"; });

  // 2. porsi per CV & per kanal
  batangH($("#gCv"), cvs.map((c, i) => { const v = series[i].values.reduce((a, b) => a + b, 0); return { label: c + " · " + cvNama(c).replace(/^CV\.\s*/, ""), sub: `${L.filter(t => t.cv === c).length} transaksi · ${total ? fmtN(100 * v / total, 1) : 0}%`, value: v, segs: [{ v, color: warnaCV(c, i), label: c }], onClick: () => keTrx({ cv: c }) }; }));
  batangH($("#gKanal"), Object.keys(KANAL).map(k => ({ k, v: L.filter(t => t.kanal === k) })).filter(x => x.v.length).sort((a, b) => sum(b.v, "total") - sum(a.v, "total"))
    .map(x => ({ label: KANAL[x.k].label, sub: `${x.v.length} transaksi`, value: sum(x.v, "total"), segs: cvs.map((c, i) => ({ v: x.v.filter(t => t.cv === c).reduce((a, t) => a + h(t).total, 0), color: warnaCV(c, i), label: c })), onClick: () => keTrx({ kanal: x.k }) })));

  // 3. perlu ditagih
  const lt = $("#lTagih");
  lt.innerHTML = tagih.length ? tagih.slice(0, 7).map(t => { const s = satkerById(t.satkerId), u = umur(t); return `<a class="tg" href="#/trx/${t.id}">${cvBadge(t.cv)}<span class="tg-n">${esc(s.singkat || s.nama)}<small>${esc(KANAL[t.kanal].label)} · ${esc(t.noTrx || "–")} · ${tgl(t.tanggal)}</small></span><span class="tg-v">Rp ${rp(h(t).total)}<small class="${u > 30 ? "old" : ""}">${u} hari · ${STATUS[t.status]}</small></span></a>`; }).join("") + (tagih.length > 7 ? `<div class="small mute" style="padding:8px 2px">+${tagih.length - 7} transaksi lagi</div>` : "")
    : `<div class="kosong">✓ Tidak ada tagihan tertunda.</div>`;
  const ft = () => { S.filters.trx = { tahun: "", cv: F.cv, kanal: F.kanal }; };
  $("#aTagih").onclick = ft;
  $("#tTagih").onclick = () => { ft(); location.hash = "#/transaksi"; };

  // 4. top satker (segmen per CV)
  const bySat = new Map();
  L.forEach(t => { const r = bySat.get(t.satkerId) || { tot: 0, n: 0, cv: {} }; const v = h(t).total; r.tot += v; r.n++; r.cv[t.cv] = (r.cv[t.cv] || 0) + v; bySat.set(t.satkerId, r); });
  batangH($("#gSatker"), Array.from(bySat.entries()).sort((a, b) => b[1].tot - a[1].tot).slice(0, 10).map(([id, r]) => {
    const s = satkerById(id);
    return { label: s.singkat || s.nama, sub: `${r.n} transaksi`, value: r.tot, segs: cvs.map((c, i) => ({ v: r.cv[c] || 0, color: warnaCV(c, i), label: c })), onClick: () => keTrx({ satker: String(id) }) };
  }));

  // 5. top barang (gabung per master; yang belum terhubung per nama dasar)
  const byB = new Map();
  L.forEach(t => t.items.forEach(it => {
    const k = it.barangId ? "b" + it.barangId : "n" + P.norm(P.pecahKatalog(it.nama).dasar);
    const r = byB.get(k) || { nama: it.barangId && S.idx.barang[it.barangId] ? S.idx.barang[it.barangId].nama : P.pecahKatalog(it.nama).dasar, v: 0, q: 0, sat: it.satuan, trx: new Set() };
    r.v += it.qty * it.harga; r.q += it.qty; r.trx.add(t.id); byB.set(k, r);
  }));
  batangH($("#gBarang"), Array.from(byB.values()).sort((a, b) => b.v - a.v).slice(0, 10).map(r => ({ label: r.nama, sub: `${fmtN(r.q)} ${r.sat || ""} · ${r.trx.size} transaksi`, value: r.v, tipLabel: "Nilai (harga × qty)", tipFoot: `${fmtN(r.q)} ${r.sat || ""} dalam ${r.trx.size} transaksi` })), "#2a78d6");

  // gambar ulang saat lebar berubah
  clearTimeout(S._rz);
  if (S._dashRz) window.removeEventListener("resize", S._dashRz);
  let lastW = el.clientWidth;
  S._dashRz = () => { clearTimeout(S._rz); S._rz = setTimeout(() => { if (!$("#gBulan") || el.clientWidth === lastW) return; lastW = el.clientWidth; gambar(); }, 150); };
  window.addEventListener("resize", S._dashRz);
}
