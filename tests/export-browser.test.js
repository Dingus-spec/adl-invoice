const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer-core');

const ROOT = path.resolve(__dirname, '..');
const ART = '/opt/cursor/artifacts';
const PORT = 8766;
const BASE = `http://127.0.0.1:${PORT}/`;
fs.mkdirSync(ART, { recursive: true });

function startServer() {
  return new Promise((resolve, reject) => {
    const child = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
    const timer = setTimeout(() => resolve(child), 400);
    child.on('error', e => { clearTimeout(timer); reject(e); });
  });
}
async function setLabeled(page, label, value, nth = 0) {
  const res = await page.evaluate((label, value, nth) => {
    const labs = [...document.querySelectorAll('label')].filter(l => l.textContent.trim().startsWith(label));
    const lab = labs[nth];
    if (!lab) return 'missing ' + label + ' #' + nth;
    const el = lab.nextElementSibling;
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return 'ok';
  }, label, value, nth);
  if (res !== 'ok') throw new Error(res);
}
async function clickText(page, text) {
  const ok = await page.evaluate(text => {
    const el = [...document.querySelectorAll('button,a,.inv')].find(b => b.textContent.trim().includes(text));
    if (!el) return false;
    el.click();
    return true;
  }, text);
  if (!ok) throw new Error('no control: ' + text);
}
async function hasExactButton(page, text) {
  return page.evaluate(text => [...document.querySelectorAll('button')].some(b => b.textContent.trim() === text), text);
}
function png() {
  const zlib = require('zlib');
  const w = 16, h = 16;
  const rows = [];
  for (let y = 0; y < h; y++) {
    const row = Buffer.alloc(1 + w * 3); row[0] = 0;
    for (let x = 0; x < w; x++) { row[1 + x * 3] = 40; row[2 + x * 3] = 90; row[3 + x * 3] = 140; }
    rows.push(row);
  }
  const ck = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), ck('IHDR', ihdr), ck('IDAT', zlib.deflateSync(Buffer.concat(rows))), ck('IEND', Buffer.alloc(0))]);
}

(async () => {
  const photo = '/tmp/adl-export-photo.png';
  fs.writeFileSync(photo, png());
  const server = await startServer();
  const browser = await puppeteer.launch({ executablePath: '/usr/local/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage();
  page.on('dialog', async d => { await d.accept(); });
  page.on('pageerror', err => { console.error('PAGEERROR', err); process.exitCode = 1; });
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1');
  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelector('h1') && document.querySelector('h1').textContent === 'Invoices');
    await clickText(page, 'Quotes');
    await clickText(page, 'New quote');
    if (await hasExactButton(page, 'Export to invoice')) throw new Error('export visible on a new provisional quote');
    await setLabeled(page, 'Job / site', 'EXAMPLE ONLY — export');
    await setLabeled(page, 'Job details', 'Commercial note for the invoice');
    await clickText(page, 'Supply and fix');
    await clickText(page, 'Bathroom walls');
    await clickText(page, 'Fibre cement');
    await setLabeled(page, 'Qty (m2)', '1');
    await setLabeled(page, 'Supply and fix cost / m2', '110');
    await setLabeled(page, 'Delivery qty', '1');
    await setLabeled(page, 'Supply and fix cost / each', '0');
    await clickText(page, 'Accepted');
    if (await hasExactButton(page, 'Export to invoice')) throw new Error('export visible before the quote is accepted');
    await clickText(page, 'Framing is not near complete');
    await page.evaluate(() => {
      const sel = [...document.querySelectorAll('select')].find(s => [...s.options].some(o => o.value === 'outside'));
      sel.value = 'outside'; sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await setLabeled(page, 'Private note', 'PRIVATE-SENTINEL do not print');
    await clickText(page, 'Final');
    await page.waitForFunction(() => document.body.innerText.includes('Final quote'));
    if (await hasExactButton(page, 'Export to invoice')) throw new Error('export visible on a final quote that is not accepted');
    await clickText(page, 'Accepted');
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Export to invoice'));
    await page.screenshot({ path: path.join(ART, 'iphone-export-accepted.png'), fullPage: false });
    await clickText(page, 'Export to invoice');
    await page.waitForFunction(() => document.querySelector('h1') && document.querySelector('h1').textContent === 'INV00083');
    const text = await page.evaluate(() => document.body.innerText);
    const fields = await page.evaluate(() => [...document.querySelectorAll('input,textarea')].map(el => el.value).join('\n'));
    if (!text.includes('fibre cement') || !text.includes('$117.65') || !text.includes('$129.42')) throw new Error('invoice mapping:\n' + text);
    if (!fields.includes('Commercial note for the invoice') || !fields.includes('EXAMPLE ONLY — export')) throw new Error('commercial notes missing:\n' + fields);
    if (!text.includes('supply and fix')) throw new Error('basis note missing:\n' + text);
    if (/PRIVATE-SENTINEL|section 33|not a legal certification/i.test(text + '\n' + fields)) throw new Error('internal note leaked');
    if (text.includes('per hour per tradesperson')) throw new Error('supply lines were shown as hourly labour');
    await page.screenshot({ path: path.join(ART, 'iphone-exported-invoice.png'), fullPage: true });
    const stored = await page.evaluate(() => ({
      invoices: JSON.parse(localStorage.getItem('adl.invoices')),
      quotes: JSON.parse(localStorage.getItem('adl.quotes')),
      settings: JSON.parse(localStorage.getItem('adl.settings'))
    }));
    if (stored.invoices.length !== 1) throw new Error('invoice count ' + stored.invoices.length);
    if (stored.invoices[0].number !== 'INV00083' || stored.quotes[0].number !== 'Q00001') throw new Error('numbers mixed');
    if (stored.settings.nextNumber !== 'INV00084' || stored.settings.nextQuoteNumber !== 'Q00002') throw new Error('sequences ' + JSON.stringify(stored.settings));
    if (stored.invoices[0].sourceQuoteId !== stored.quotes[0].id) throw new Error('source link missing');
    if (stored.quotes[0].linkedInvoiceId !== stored.invoices[0].id) throw new Error('quote link missing');
    if (stored.settings.bank || stored.settings.bsb || stored.settings.account) throw new Error('bank filled');
    const before = JSON.stringify(stored.quotes[0].rooms);
    await clickText(page, 'From quote');
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Export to invoice'));
    await clickText(page, 'Export to invoice');
    await page.waitForFunction(() => document.querySelector('h1') && document.querySelector('h1').textContent === 'INV00083');
    const afterFirst = await page.evaluate(() => JSON.parse(localStorage.getItem('adl.invoices')).length);
    if (afterFirst !== 1) throw new Error('repeat export created ' + afterFirst);
    const roomsAfter = await page.evaluate(() => JSON.stringify(JSON.parse(localStorage.getItem('adl.quotes'))[0].rooms));
    if (roomsAfter !== before) throw new Error('quote rooms changed on export');
    await clickText(page, 'From quote');
    await clickText(page, 'Create another invoice');
    await page.waitForFunction(() => document.querySelector('h1') && document.querySelector('h1').textContent === 'INV00084');
    const linked = await page.evaluate(() => {
      const qs = JSON.parse(localStorage.getItem('adl.quotes'));
      const inv = JSON.parse(localStorage.getItem('adl.invoices'));
      return { n: inv.length, link: qs[0].linkedInvoiceId, first: inv.find(i => i.number === 'INV00083').id, both: inv.every(i => i.sourceQuoteId === qs[0].id) };
    });
    if (linked.n !== 2 || linked.link !== linked.first || !linked.both) throw new Error('duplicate link ' + JSON.stringify(linked));

    await clickText(page, 'Invoices');
    await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'Invoices' && x.dataset.tab !== 'list'); if (b) b.click(); });
    await clickText(page, 'New invoice');
    await setLabeled(page, 'Job / site', 'EXAMPLE ONLY — labour regression');
    await clickText(page, 'Add work day');
    await setLabeled(page, 'Hours', '25.5');
    await setLabeled(page, 'Start', '');
    await setLabeled(page, 'Finish', '');
    await clickText(page, 'Add parking');
    await setLabeled(page, 'Amount incl GST', '28');
    const labourText = await page.evaluate(() => document.body.innerText);
    if (!labourText.includes('$1,851.25')) throw new Error('labour regression:\n' + labourText);
    const file = await page.$('input[type=file]');
    await file.uploadFile(photo);
    await page.waitForFunction(() => document.querySelector('img.thumb'));
    await clickText(page, 'Create PDF');
    await page.waitForFunction(() => window.__lastPdf);
    const b64 = await page.evaluate(async () => {
      const buf = await window.__lastPdf.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let s = '';
      for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(s);
    });
    fs.writeFileSync(path.join(ART, 'example-invoice-after-export.pdf'), Buffer.from(b64, 'base64'));

    await clickText(page, '‹ Back');
    await clickText(page, 'Invoices');
    await clickText(page, 'INV00083');
    await clickText(page, 'Create PDF');
    await page.waitForFunction(() => window.__lastPdf);
    const q64 = await page.evaluate(async () => {
      const buf = await window.__lastPdf.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let s = '';
      for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(s);
    });
    fs.writeFileSync(path.join(ART, 'example-exported-quote-invoice.pdf'), Buffer.from(q64, 'base64'));

    await clickText(page, 'Settings');
    await page.evaluate(() => {
      document.addEventListener('click', e => {
        const a = e.target.closest && e.target.closest('a[download]');
        if (a) window.__backupHref = a.href;
      }, true);
    });
    await clickText(page, 'Export backup');
    await page.waitForFunction(() => window.__backupHref);
    const backup = JSON.parse(await page.evaluate(async () => (await fetch(window.__backupHref)).text()));
    if (!backup.invoices.some(i => i.sourceQuoteId) || !backup.quotes.some(q => q.linkedInvoiceId)) throw new Error('backup missing links');
    if (!backup.files.length) throw new Error('backup missing photo');
    if (backup.settings.bank) throw new Error('backup bank');
    fs.writeFileSync('/tmp/adl-export-backup.json', JSON.stringify(backup));
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'domcontentloaded' });
    await clickText(page, 'Settings');
    const restore = await page.$('input[type=file][accept*="json"]');
    await restore.uploadFile('/tmp/adl-export-backup.json');
    await page.waitForFunction(() => document.body.innerText.includes('INV00083'));
    const restored = await page.evaluate(() => {
      const inv = JSON.parse(localStorage.getItem('adl.invoices'));
      const qs = JSON.parse(localStorage.getItem('adl.quotes'));
      return inv.some(i => i.sourceQuoteId) && qs.some(q => q.linkedInvoiceId);
    });
    if (!restored) throw new Error('restore dropped links');
    await page.setOfflineMode(true);
    await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
    const offline = await page.evaluate(() => document.body.innerText);
    if (!offline.includes('INV00083') && !offline.includes('Invoices')) throw new Error('offline lost the shell');
    console.log('EXPORT BROWSER OK');
  } finally {
    await browser.close();
    server.kill();
  }
})().catch(err => { console.error(err); process.exit(1); });
