/* Parser dokumen pesanan: INAPROC (Surat Pesanan Katalog v6), Mbizmarket (Pesanan PO),
   dan teks tempelan dari Digipay. Dipakai di browser (window.Parsers) dan di Node (uji). */
(function (root) {
  "use strict";

  const BULAN = { jan: 1, feb: 2, mar: 3, apr: 4, mei: 5, may: 5, jun: 6, jul: 7, agu: 8, agt: 8, aug: 8,
    sep: 9, okt: 10, oct: 10, nov: 11, des: 12, dec: 12 };

  // "Rp9.350,00" / "9.350,00" / "194,000" / "6,631,695" / "1.500" -> angka
  function angka(s) {
    if (s == null) return 0;
    let t = String(s).replace(/Rp|\s|\(|\)/gi, "");
    if (!t) return 0;
    const neg = /^-/.test(t);
    t = t.replace(/^-/, "");
    if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) t = t.replace(/,/g, "");                   // 194,000 (gaya Inggris)
    else if (/^\d{1,3}(\.\d{3})*(,\d+)?$/.test(t)) t = t.replace(/\./g, "").replace(",", "."); // 9.350,00 (gaya Indonesia)
    else if (/^\d+,\d{1,2}$/.test(t)) t = t.replace(",", ".");
    const v = parseFloat(t);
    return isNaN(v) ? 0 : (neg ? -v : v);
  }

  function pad(n) { return String(n).padStart(2, "0"); }

  // "13 Okt 2026", "Selasa, 13 Okt 2026, 09:28", "11 Agustus 2026", "23-10-2026", "2026-10-23"
  function tanggal(s) {
    if (!s) return "";
    s = String(s);
    let m = s.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    m = s.match(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
    if (m) return `${m[3]}-${pad(m[2])}-${pad(m[1])}`;
    m = s.match(/(\d{1,2})\s+([A-Za-z]{3,})\.?\s+(\d{4})/);
    if (m) {
      const b = BULAN[m[2].slice(0, 3).toLowerCase()];
      if (b) return `${m[3]}-${pad(b)}-${pad(m[1])}`;
    }
    return "";
  }

  // ---------------------------------------------------------------- baris dari pdf.js
  // pages: [{items:[{str, transform:[a,b,c,d,x,y], width}]}]  ->  [{page, y, segs:[{x, s}]}]
  function linesFromPdf(pages) {
    const out = [];
    pages.forEach((pg, pi) => {
      const its = pg.items
        .filter(i => i.str && i.str.trim())
        .map(i => ({ s: i.str, x: i.transform[4], y: i.transform[5], w: i.width || 0 }));
      its.sort((a, b) => b.y - a.y || a.x - b.x);
      const rows = [];
      for (const it of its) {
        let r = rows.find(r => Math.abs(r.y - it.y) <= 2.5);
        if (!r) { r = { page: pi + 1, y: it.y, raw: [] }; rows.push(r); }
        r.raw.push(it);
      }
      rows.sort((a, b) => b.y - a.y);
      for (const r of rows) {
        r.raw.sort((a, b) => a.x - b.x);
        const segs = [];
        for (const it of r.raw) {
          const last = segs[segs.length - 1];
          if (last && it.x - last.end < 3) { last.s += (it.x - last.end > 0.8 ? " " : "") + it.s; last.end = it.x + it.w; }
          else segs.push({ x: it.x, s: it.s, end: it.x + it.w });
        }
        segs.forEach(sg => { sg.s = sg.s.replace(/\s+/g, " ").trim().replace(/^:\s*/, ""); });
        const clean = segs.filter(sg => sg.s && sg.s !== ":");
        if (clean.length) out.push({ page: r.page, y: r.y, segs: clean, text: clean.map(s => s.s).join("  ") });
      }
    });
    return out;
  }

  function valueAfter(lines, label, opts) {
    opts = opts || {};
    for (let i = 0; i < lines.length; i++) {
      const L = lines[i];
      for (let k = 0; k < L.segs.length; k++) {
        const sg = L.segs[k];
        if (sg.s === label || (opts.prefix && sg.s.startsWith(label))) {
          if (opts.maxX && sg.x > opts.maxX) continue;
          if (opts.minX && sg.x < opts.minX) continue;
          if (opts.prefix && sg.s.length > label.length) {
            const rest = sg.s.slice(label.length).replace(/^\s*:?\s*/, "");
            if (rest) return rest;
          }
          if (L.segs[k + 1]) return L.segs[k + 1].s;
        }
      }
    }
    return "";
  }

  // baris di bawah label pada kolom x yang sama
  function textBelow(lines, label, opts) {
    opts = opts || {};
    for (let i = 0; i < lines.length; i++) {
      const sg = lines[i].segs.find(s => s.s === label && (!opts.maxX || s.x <= opts.maxX) && (!opts.minX || s.x >= opts.minX));
      if (!sg) continue;
      for (let j = i + 1; j < Math.min(lines.length, i + 4); j++) {
        const t = lines[j].segs.find(s => Math.abs(s.x - sg.x) < 4);
        if (t) return t.s;
      }
    }
    return "";
  }

  function cvDariNama(nama) {
    const u = String(nama || "").toUpperCase();
    if (/PELITA|\bPKM\b/.test(u)) return "PKM";
    if (/DAKSA|\bDKS\b/.test(u)) return "DKS";
    if (/ONIX|\bOSI\b/.test(u)) return "OSI";
    return "";
  }

  // ---------------------------------------------------------------- INAPROC
  function parseInaproc(lines) {
    const all = lines.map(l => l.text).join("\n");
    if (!/Surat Pesanan/.test(all) || !/EP-[0-9A-Z]{10,}/.test(all)) return null;
    const r = { kanal: "INAPROC", items: [], peringatan: [] };
    r.noTrx = (valueAfter(lines, "No. Surat Pesanan") || (all.match(/EP-[0-9A-Z]{10,}/) || [""])[0]).replace(/^#/, "");
    r.namaSatker = textBelow(lines, "Pemesan", { maxX: 200 });
    r.penyedia = textBelow(lines, "Penyedia", { minX: 200 });
    r.cv = cvDariNama(r.penyedia);
    r.ppk = valueAfter(lines, "Nama Penanggung Jawab", { maxX: 200 });
    r.tanggal = tanggal(valueAfter(lines, "Tanggal Surat Pesanan"));
    r.tglSP = r.tanggal;
    r.termin = valueAfter(lines, "Pembayaran", { maxX: 100 });
    const tiba = valueAfter(lines, "Permintaan Tiba");
    r.tglKirim = tanggal(tiba);
    r.penerima = valueAfter(lines, "Nama Penerima");
    // item: baris harga "RpX  qty" lalu nama (bisa 2 baris) lalu "qty pcs (..)"
    let jenis = "B";
    const stop = lines.findIndex(l => /^Ringkasan Pembayaran/.test(l.text));
    const end = stop > 0 ? stop : lines.length;
    for (let i = 0; i < end; i++) {
      const L = lines[i];
      const n = L.segs.length;
      const pr = n >= 2 && /^Rp[\d.]+,\d\d$/.test(L.segs[n - 2].s) && /^[\d.]+,\d\d$/.test(L.segs[n - 1].s);
      if (!pr) continue;
      jenis = /^Jasa/i.test(L.segs[0].s) ? "J" : "B";
      const harga = angka(L.segs[n - 2].s), qty = angka(L.segs[n - 1].s);
      let nama = [], satuan = "PCS";
      for (let j = i + 1; j < Math.min(end, i + 6); j++) {
        const t = lines[j].text;
        const mq = t.match(/^[\d.]+,\d\d\s+([A-Za-z]+)\b/);
        if (mq) { satuan = mq[1].toUpperCase(); break; }
        if (/^(Barang|Jasa)\b/.test(t)) continue;
        nama.push(t);
      }
      r.items.push({ nama: nama.join(" ").replace(/\s+/g, " ").trim(), qty, satuan, harga, jenis });
    }
    r.cekTotal = angka(valueAfter(lines, "Total Transaksi"));
    r.cekPPN = angka(valueAfter(lines, "Total PPN"));
    r.cekBayar = angka(valueAfter(lines, "Estimasi Total Pembayaran Termin 1") || valueAfter(lines, "Estimasi Total Pembayaran"));
    return r;
  }

  // ---------------------------------------------------------------- Mbizmarket
  function parseMbiz(lines) {
    const all = lines.map(l => l.text).join("\n");
    if (!/No\. Pesanan/.test(all) || !/PO-\d/.test(all)) return null;
    const r = { kanal: "MBIZ", items: [], peringatan: [] };
    r.namaSatker = lines[0] ? lines[0].segs[0].s : "";
    r.penyedia = textBelow(lines, "Kepada :") || valueAfter(lines, "Kepada :");
    r.cv = cvDariNama(r.penyedia);
    r.noTrx = valueAfter(lines, "No. Pesanan");
    r.noQuotation = valueAfter(lines, "No. Quotation");
    r.noKontrak = valueAfter(lines, "No. Kontrak").replace(/^-$/, "");
    r.status = valueAfter(lines, "Status");
    r.tanggal = tanggal(valueAfter(lines, "Tanggal Pesanan Dibuat"));
    r.tglSP = r.tanggal;
    r.namaPaket = valueAfter(lines, "Nama Paket");
    r.rup = (valueAfter(lines, "Rencana Umum Pengadaan", { prefix: true }).match(/\d{5,}/) || [""])[0];
    r.sumberDana = valueAfter(lines, "Sumber Dana");
    r.pencairan = valueAfter(lines, "Pencairan Dana");
    const pp = valueAfter(lines, "Pemungut Pajak");
    r.wapu = !/non/i.test(pp);
    // urutkan baris global (halaman lalu y menurun) sudah dari linesFromPdf
    let cur = null;
    for (const L of lines) {
      const s0 = L.segs[0];
      if (L.segs.length >= 5 && /^\d+$/.test(s0.s) && s0.x < 40 && /^SKU/.test(L.segs[1].s)) {
        const segs = L.segs.slice(2);
        // nama, qty, harga satuan, total
        const nums = segs.filter(s => /^(Rp )?[\d.]+,\d\d$/.test(s.s));
        const namaSeg = segs.filter(s => !/^(Rp )?[\d.]+,\d\d$/.test(s.s) && !/^PPN$|^PPh/.test(s.s));
        cur = { nama: namaSeg.map(s => s.s).join(" "), qty: angka(nums[0] && nums[0].s), satuan: "PCS",
          harga: angka(nums[1] && nums[1].s), jenis: "B", _total: angka(nums[2] && nums[2].s) };
        if (/PPh 23/.test(L.text)) cur.jenis = "J";
        r.items.push(cur);
        continue;
      }
      if (cur && /PPh 23/.test(L.text)) cur.jenis = "J";
      if (/^Jasa Pengiriman|^Sub Total/.test(L.text)) cur = null;
    }
    r.items.forEach(it => {
      if (it._total && it.qty && Math.abs(it._total - it.qty * it.harga) > 1) r.peringatan.push("Cek item: " + it.nama);
      delete it._total;
    });
    r.platformFee = angka(valueAfter(lines, "Platform Fee"));
    r.ongkir = angka(valueAfter(lines, "Total Biaya Pengiriman"));
    r.cekTotal = angka(valueAfter(lines, "Sub Total"));
    r.cekPPN = angka(valueAfter(lines, "PPN", { minX: 250, maxX: 330 }));
    r.cekBayar = angka(valueAfter(lines, "Total Pembayaran"));
    r.cekBersih = angka(valueAfter(lines, "Total Penghasilan"));
    return r;
  }

  function parsePdfLines(lines) {
    return parseInaproc(lines) || parseMbiz(lines);
  }

  // ---------------------------------------------------------------- Digipay (teks tempel)
  // Mendukung: baris daftar Pengecekan (invoice, instansi, VA, tgl, kode akun, jumlah, total)
  //            dan baris Rincian Produk (no dok, pemesan, produk, stok, jumlah, harga, ongkir, total, status, catatan)
  function parseDigipay(text) {
    const r = { kanal: "DIGIPAY", items: [], peringatan: [] };
    const lines = String(text || "").replace(/\r/g, "").split("\n");
    const inv = /(\d{6}\/\d{2}\/\d{8}\/\d{6})/;
    const joined = lines.join("\n");
    const mi = joined.match(inv);
    if (mi) r.noTrx = mi[1];
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      const c = raw.split("\t").map(s => s.trim());
      if (c.length >= 6 && inv.test(c[0])) {           // baris daftar Pengecekan
        r.noTrx = c[0].match(inv)[1];
        r.namaSatker = c[1];
        r.metodeBayar = c[2];
        r.tanggal = tanggal(c[3]);
        r.kodeAkun = c[4];
        r.cekTotal = angka(c[6] || "");
        continue;
      }
      if (c.length >= 8) {                              // baris rincian produk
        const nums = [3, 4, 5, 6, 7].map(k => c[k]);
        if (nums.every(v => /^[\d.,]+$/.test(v || ""))) {
          r.noDok = r.noDok || c[0];
          r.pemesan = r.pemesan || c[1];
          const it = { nama: c[2], qty: angka(c[4]), satuan: "PCS", harga: angka(c[5]), jenis: "B" };
          const tot = angka(c[7]);
          if (Math.abs(tot - it.qty * it.harga) > 1) r.peringatan.push("Total baris tidak sama: " + it.nama);
          r.items.push(it);
          continue;
        }
      }
      // label: nilai di baris berikut (salinan halaman Rekam Data)
      const lab = raw.trim().toLowerCase();
      const next = (lines[i + 1] || "").trim();
      if (lab === "no. invoice" && inv.test(next)) r.noTrx = next.match(inv)[1];
      if (lab === "tgl. invoice") r.tanggal = tanggal(next) || r.tanggal;
      if (lab === "nama satker") r.namaSatker = next;
      if (lab === "nama ppk") r.ppk = next;
      if (lab === "metode bayar") r.metodeBayar = next;
    }
    if (r.noTrx && !r.tanggal) {
      const m = r.noTrx.match(/\/(\d{4})(\d{2})(\d{2})\//);
      if (m) r.tanggal = `${m[1]}-${m[2]}-${m[3]}`;
    }
    if (r.noTrx) r.kodeSatker = r.noTrx.slice(0, 6);
    return r;
  }

  // "TINTA EPSON T673 BK - OSI 604" -> {dasar:"TINTA EPSON T673 BK", katalog:"OSI 604"}
  function pecahKatalog(nama) {
    const m = String(nama || "").match(/^(.*?)\s*-\s*((?:OSI|KJS|PKM|DKS)\b.*)$/i);
    if (m) return { dasar: m[1].trim(), katalog: m[2].trim() };
    return { dasar: String(nama || "").trim(), katalog: "" };
  }

  function norm(s) {
    return String(s || "").toUpperCase().replace(/\bGRAM\b/g, "GSM").replace(/[^A-Z0-9]+/g, " ")
      .replace(/\s+/g, " ").trim();
  }

  root.Parsers = { angka, tanggal, linesFromPdf, parseInaproc, parseMbiz, parsePdfLines, parseDigipay,
    pecahKatalog, norm, cvDariNama };
})(typeof window !== "undefined" ? window : globalThis);
