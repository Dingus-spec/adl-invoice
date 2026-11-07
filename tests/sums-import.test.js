const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer-core');
const ROOT = path.resolve(__dirname, '..');
const ART = '/opt/cursor/artifacts';
const PORT = 8771;
fs.mkdirSync(ART, { recursive: true });
function startServer() {
  return new Promise((resolve, reject) => {
    const child = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
    const timer = setTimeout(() => resolve(child), 300);
    child.on('error', e => { clearTimeout(timer); reject(e); });
  });
}
function exampleImport() {
  return {
    documentType: 'adl-quote-import', schemaVersion: 1,
    quote: {
      importKey: 'example-sums-1', number: 'Q-EXAMPLE-1', date: '2026-11-07', pricingMode: 'sums', stage: 'provisional', basis: '',
      framingNearComplete: false, jobSite: 'Example Street', jobLines: 'Draft package only. Options are not added together.',
      client: { name: 'Example Builder', attention: '', address: 'Hijack Street', abn: '', phone: '0499999999', email: '' },
      alternatives: [
        { key: 'a', label: 'Option A', sellEx: 1000, gst: 100, sellInc: 1100, selected: false },
        { key: 'b', label: 'Option B', sellEx: 2000, gst: 200, sellInc: 2200, selected: false }
      ],
      pricedScope: ['Named new work in the package'], unpriced: ['Balcony not confirmed'], exclusions: ['Painting'],
      paymentSchedule: [
        { key: 'deposit', label: 'Before commencement', percent: 30 },
        { key: 'sheeting', label: 'After sheeting', percent: 30 },
        { key: 'setting', label: 'After setting', percent: 30 },
        { key: 'finish', label: 'After cornice and sanding', percent: 10 }
      ],
      compliance: { contractClass: 'unverified', privateNote: 'PRIVATE-SENTINEL' }
    }
  };
}
async function setLabeled(page, label, value, nth = 0) {
  const res = await page.evaluate((label, value, nth) => {
    const labs = [...document.querySelectorAll('label')].filter(l => l.textContent.trim().startsWith(label));
    const lab = labs[nth]; if (!lab || !lab.nextElementSibling) return 'missing ' + label;
    lab.nextElementSibling.value = value;
    lab.nextElementSibling.dispatchEvent(new Event('input', { bubbles: true }));
    lab.nextElementSibling.dispatchEvent(new Event('change', { bubbles: true }));
    return 'ok';
  }, label, value, nth);
  if (res !== 'ok') throw new Error(res);
}
async function clickText(page, text) {
  const ok = await page.evaluate(text => {
    const el = [...document.querySelectorAll('button,a,.inv')].find(b => b.textContent.includes(text));
    if (!el) return false; el.click(); return true;
  }, text);
  if (!ok) throw new Error('no control: ' + text);
}
(async () => {
  const good = '/tmp/adl-example-sums-import.json';
  const badBackup = '/tmp/adl-bad-backup.json';
  const nasty = '/tmp/adl-nasty-import.json';
  fs.writeFileSync(good, JSON.stringify(exampleImport()));
  fs.writeFileSync(badBackup, JSON.stringify({ app: 'adl-invoice', version: 2, invoices: [], quotes: [] }));
  const evil = exampleImport(); evil.quote.jobSite = '<script>alert(1)</script>'; evil.quote.importKey = 'example-sums-evil';
  fs.writeFileSync(nasty, JSON.stringify(evil));
  const server = await startServer();
  const browser = await puppeteer.launch({ executablePath: '/usr/local/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage();
  const dialogs = [];
  page.on('dialog', async d => { dialogs.push(d.message()); await d.accept(); });
  page.on('pageerror', err => { console.error('PAGEERROR', err); process.exitCode = 1; });
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1');
  try {
    await page.goto('http://127.0.0.1:' + PORT + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelector('h1') && document.querySelector('h1').textContent === 'Invoices');
    await clickText(page, 'Clients');
    await clickText(page, 'Add client');
    await setLabeled(page, 'Business name', 'Example Builder');
    await setLabeled(page, 'Phone', '0400000001');
    await setLabeled(page, 'Address', '1 Kept Street');
    await clickText(page, 'Save client');
    await clickText(page, 'Invoices');
    await clickText(page, 'New invoice');
    await setLabeled(page, 'Job / site', 'EXAMPLE ONLY labour');
    await clickText(page, 'Add work day');
    await setLabeled(page, 'Hours', '25.5');
    await setLabeled(page, 'Start', '');
    await setLabeled(page, 'Finish', '');
    await clickText(page, 'Add parking');
    await setLabeled(page, 'Amount incl GST', '28');
    if (!(await page.evaluate(() => document.body.innerText)).includes('$1,851.25')) throw new Error('labour total missing');
    await clickText(page, 'Save invoice');
    await clickText(page, 'Invoices');
    await clickText(page, 'Quotes');
    await page.screenshot({ path: path.join(ART, 'iphone-add-one-quote.png') });
    const before = await page.evaluate(() => ({
      invoices: localStorage.getItem('adl.invoices'),
      settings: localStorage.getItem('adl.settings'),
      clients: localStorage.getItem('adl.clients')
    }));
    const upload = async file => { const input = await page.$('.add-quote-file'); await input.uploadFile(file); };
    await upload(good);
    await page.waitForFunction(() => document.body.innerText.includes('Q-EXAMPLE-1'));
    const after = await page.evaluate(() => ({
      invoices: JSON.parse(localStorage.getItem('adl.invoices')),
      quotes: JSON.parse(localStorage.getItem('adl.quotes')),
      settings: JSON.parse(localStorage.getItem('adl.settings')),
      clients: JSON.parse(localStorage.getItem('adl.clients'))
    }));
    if (JSON.stringify(after.invoices) !== JSON.stringify(JSON.parse(before.invoices))) throw new Error('invoices changed');
    if (after.settings.nextNumber !== JSON.parse(before.settings).nextNumber) throw new Error('invoice sequence changed');
    if (after.settings.bank) throw new Error('bank filled');
    if (after.quotes.length !== 1 || after.quotes[0].importKey !== 'example-sums-1') throw new Error('quote not added');
    const kept = after.clients.find(c => c.name === 'Example Builder');
    if (kept.phone !== '0400000001' || !kept.address.includes('Kept')) throw new Error('client overwritten ' + JSON.stringify(kept));
    if (!(await page.evaluate(() => document.body.innerText)).includes('No option chosen')) throw new Error('unchosen total shown as money');
    dialogs.length = 0;
    await upload(good);
    for (let i = 0; i < 30 && !dialogs.length; i++) await new Promise(r => setTimeout(r, 50));
    if (!dialogs.some(m => /already imported/i.test(m))) throw new Error('reimport dialog ' + JSON.stringify(dialogs));
    if ((await page.evaluate(() => JSON.parse(localStorage.getItem('adl.quotes')).length)) !== 1) throw new Error('reimport duplicated');
    dialogs.length = 0;
    await upload(badBackup);
    for (let i = 0; i < 30 && !dialogs.length; i++) await new Promise(r => setTimeout(r, 50));
    if (!dialogs.some(m => /full backup/i.test(m))) throw new Error('backup not rejected ' + JSON.stringify(dialogs));
    dialogs.length = 0;
    await upload(nasty);
    for (let i = 0; i < 30 && !dialogs.length; i++) await new Promise(r => setTimeout(r, 50));
    if (!dialogs.some(m => /unsupported text/i.test(m))) throw new Error('html not rejected ' + JSON.stringify(dialogs));
    await clickText(page, 'Q-EXAMPLE-1');
    await clickText(page, 'Option A');
    const chosen = await page.evaluate(() => document.body.innerText);
    if (!chosen.includes('$1,100.00') || !chosen.includes('$330.00') || !chosen.includes('$110.00')) throw new Error('chosen totals:\n' + chosen);
    if (chosen.includes('PRIVATE-SENTINEL')) throw new Error('private note visible');
    await page.screenshot({ path: path.join(ART, 'iphone-sums-option.png'), fullPage: true });
    await clickText(page, 'Create PDF');
    await page.waitForFunction(() => window.__lastPdf);
    const b64 = await page.evaluate(async () => {
      const buf = await window.__lastPdf.arrayBuffer(); const bytes = new Uint8Array(buf); let s = '';
      for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(s);
    });
    const pdfPath = path.join(ART, 'example-sums-only.pdf');
    fs.writeFileSync(pdfPath, Buffer.from(b64, 'base64'));
    await clickText(page, 'Settings');
    await page.evaluate(() => document.addEventListener('click', e => { const a = e.target.closest && e.target.closest('a[download]'); if (a) window.__backupHref = a.href; }, true));
    await clickText(page, 'Export backup');
    await page.waitForFunction(() => window.__backupHref);
    const backup = JSON.parse(await page.evaluate(async () => (await fetch(window.__backupHref)).text()));
    if (!backup.quotes.some(q => q.pricingMode === 'sums' && q.importKey === 'example-sums-1')) throw new Error('backup missed sums quote');
    if (!backup.invoices.some(i => i.number === 'INV00083')) throw new Error('backup missed invoice');
    fs.writeFileSync('/tmp/adl-sums-backup.json', JSON.stringify(backup));
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'domcontentloaded' });
    await clickText(page, 'Settings');
    await (await page.$('input[type=file][accept*="json"]')).uploadFile('/tmp/adl-sums-backup.json');
    await page.waitForFunction(() => document.body.innerText.includes('INV00083') || document.body.innerText.includes('Invoices'));
    const restored = await page.evaluate(() => {
      const q = JSON.parse(localStorage.getItem('adl.quotes') || '[]');
      const i = JSON.parse(localStorage.getItem('adl.invoices') || '[]');
      return q.some(x => x.importKey === 'example-sums-1' && x.alternatives[0].selected) && i.some(x => x.number === 'INV00083');
    });
    if (!restored) throw new Error('roundtrip lost quote or invoice');
    await page.waitForFunction(() => navigator.serviceWorker.ready);
    await page.reload({ waitUntil: 'networkidle0' });
    const marker = '\n/* sums-update-marker */\n';
    const qpath = path.join(ROOT, 'quote.js');
    const original = fs.readFileSync(qpath, 'utf8');
    fs.appendFileSync(qpath, marker);
    try {
      const fetched = await page.evaluate(async () => (await fetch('quote.js', { cache: 'no-store' })).text());
      if (!fetched.includes('sums-update-marker')) throw new Error('service worker did not refresh quote.js');
    } finally { fs.writeFileSync(qpath, original); }
    await page.setOfflineMode(true);
    await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
    const off = await page.evaluate(() => document.body.innerText).catch(() => '');
    if (!off.includes('Invoices') && !off.includes('Quotes')) throw new Error('offline shell missing');
    console.log('SUMS IMPORT OK');
  } finally { await browser.close(); server.kill(); }
})().catch(err => { console.error(err); process.exit(1); });
