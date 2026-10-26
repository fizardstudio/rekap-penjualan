// Skenario konflik backup: 2 komputer, 1 akun Google (server tiruan)
const { chromium } = require('playwright');
const S = process.env.SCR;
const mock = () => fetch('http://127.0.0.1:9900/__state').then(r => r.json());
const files = async () => (await mock()).files.filter(f => f.name.endsWith('.zip')).map(f => `${f.name} [pc=${(f.props || {}).pc} rev=${(f.props || {}).rev} trx=${(f.props || {}).trx}]`);
(async () => {
  const br = await chromium.launch();
  const errs = [];
  const buka = async (port) => { const c = await br.newContext({ viewport: { width: 1300, height: 850 } }); const p = await c.newPage(); p.on('pageerror', e => errs.push(port + ' ' + e.message)); return p; };
  const chip = async p => { await p.evaluate(() => gdRefresh()); await p.waitForTimeout(300); return (await p.textContent('#gdChip')).replace(/\s+/g, ' ').trim(); };
  const login = async (p, port) => { await p.goto(`http://localhost:${port}/`); await p.fill('input[name=username]', 'admin'); await p.fill('input[name=password]', 'rahasia1'); await p.click('button.pri'); await p.waitForSelector('.dash'); };
  const hubungkan = async (p, port) => {
    await p.goto(`http://localhost:${port}/#/pengaturan`); await p.waitForSelector('#gdCid');
    await p.fill('#gdCid', '123-abc.apps.googleusercontent.com'); await p.fill('#gdSec', 'GOCSPX-test'); await p.click('#gdSaveCfg'); await p.waitForTimeout(500);
    await p.click('#gdLogin'); await p.waitForURL(new RegExp(`localhost:${port}/#/pengaturan`), { timeout: 15000 }); await p.waitForTimeout(2000);
  };
  const ubah = async (p, port, id, st) => { await p.goto(`http://localhost:${port}/#/trx/${id}`); await p.waitForSelector('#bSave'); await p.selectOption('[data-k=status]', st); await p.click('#bSave'); await p.waitForTimeout(800); };
  const backupNow = async p => p.evaluate(() => fetch('/api/gdrive/backup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).then(r => r.json()));

  // ---- Komputer A (data lama 188 transaksi)
  const A = await buka(8071); await login(A, 8071); await hubungkan(A, 8071);
  console.log('A1 hubungkan        :', await chip(A)); console.log('   drive:', await files());

  // ---- Komputer B: instal baru, data kosong
  await fetch('http://localhost:8072/api/setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ namaUsaha: 'B', nama: 'Petugas B', username: 'admin', password: 'rahasiaB', dataLama: false }) });
  const B = await buka(8072);
  await B.goto('http://localhost:8072/'); await B.fill('input[name=username]', 'admin'); await B.fill('input[name=password]', 'rahasiaB'); await B.click('button.pri'); await B.waitForSelector('.dash');
  await hubungkan(B, 8072);
  console.log('B1 komputer baru    :', await chip(B));
  await B.waitForSelector('.modal table.konf', { timeout: 5000 }).catch(() => null);
  console.log('   dialog otomatis  :', !!(await B.$('.modal table.konf')), '|', ((await B.textContent('.modal .mh')) || '').trim());
  await B.screenshot({ path: S + '/31-konflik-awal.png' });
  console.log('   drive (B tidak upload):', await files());
  // B pilih Pulihkan
  await B.click('.modal .mf button.pri'); await B.waitForSelector('.modal .mf button.danger'); await B.click('.modal .mf button.danger');
  await B.waitForSelector('text=Data dipulihkan', { timeout: 15000 }); console.log('B2 pulihkan         :', (await B.textContent('.modal .mb')).replace(/\s+/g, ' ').trim());
  await B.click('.modal .mf button.pri'); await B.waitForSelector('input[name=username]');
  await B.fill('input[name=username]', 'admin'); await B.fill('input[name=password]', 'rahasia1'); await B.click('button.pri'); await B.waitForSelector('.dash');
  console.log('   B transaksi      :', await B.evaluate(() => S.data.transaksi.length), '| chip:', await chip(B));
  await ubah(B, 8072, 185, 'lunas'); console.log('B3 B ubah + backup  :', JSON.stringify((await backupNow(B)).konflik || 'ok')); console.log('   drive:', await files());

  // ---- A ubah data sendiri (tidak tahu perubahan B) -> harus ditahan
  await ubah(A, 8071, 186, 'dikirim'); const ra = await backupNow(A);
  console.log('A2 A ubah + backup  :', ra.error || 'tidak ditahan!', '|', await chip(A));
  await A.goto('http://localhost:8071/#/transaksi'); await A.waitForTimeout(500); await A.click('#gdChip [data-gdkonf]'); await A.waitForSelector('.modal table.konf');
  await A.screenshot({ path: S + '/32-konflik-lebih-baru.png' });
  // A pilih Lanjutkan -> file B tidak boleh tertimpa
  { const bt = await A.$$('.modal .mf button'); console.log('   tombol:', await Promise.all(bt.map(b => b.textContent()))); await bt[1].click(); await A.waitForTimeout(1500); }
  console.log('A3 lanjutkan        :', await chip(A)); console.log('   drive:', await files());

  // ---- riwayat & pulihkan versi tertentu di A
  await A.goto('http://localhost:8071/#/pengaturan'); await A.waitForSelector('#gdHist'); await A.click('#gdHist'); await A.waitForSelector('.modal [data-pul]');
  console.log('A4 riwayat          :', (await A.$$('.modal [data-pul]')).length, 'backup'); await A.screenshot({ path: S + '/33-riwayat.png' });
  console.log('ERRORS', JSON.stringify(errs)); await br.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
