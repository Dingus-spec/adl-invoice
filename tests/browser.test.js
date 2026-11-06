const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer-core');

const ROOT = path.resolve(__dirname, '..');
const ART = '/opt/cursor/artifacts';
const PORT = 8765;
const BASE = `http://127.0.0.1:${PORT}/`;
fs.mkdirSync(ART, { recursive: true });

function png(w, h, rgb) {
  const zlib = require('zlib');
  const chunk = (t, d) => Buffer.concat([Buffer.from(Uint32Array.of(d.length).buffer).swap32 ? Buffer.alloc(4) : Buffer.alloc(4), t, d]);
  // simpler manual
  function ck(type, data) {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  }
  const raw = Buffer.concat(Array.from({ length: h }, () => Buffer.concat([Buffer.from([0]), Buffer.from(rgb.repeat ? Buffer.alloc(w * 3) : Buffer.alloc(0))])));
  const rows = [];
  for (let y = 0; y < h; y++) {
    const row = Buffer.alloc(1 + w * 3); row[0] = 0;
    for (let x = 0; x < w; x++) { row[1 + x * 3] = rgb[0]; row[2 + x * 3] = rgb[1]; row[3 + x * 3] = rgb[2]; }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), ck('IHDR', ihdr), ck('IDAT', zlib.deflateSync(Buffer.concat(rows))), ck('IEND', Buffer.alloc(0))]);
}

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
    if (!lab) return 'missing ' + label + ' #' + nth + ' of ' + labs.length;
    const el = lab.nextElementSibling;
    if (!el) return 'no control for ' + label;
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

async function bodyText(page) { return page.evaluate(() => document.body.innerText); }
async function shot(page, name) { await page.screenshot({ path: path.join(ART, name), fullPage: true }); }

async function savePdf(page, filename) {
  const b64 = await page.evaluate(async () => {
    const buf = await window.__lastPdf.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  });
  fs.writeFileSync(path.join(ART, filename), Buffer.from(b64, 'base64'));
}

(async () => {
  const photo = path.join('/tmp', 'adl-example-photo.png');
  fs.writeFileSync(photo, png(24, 24, [30, 90, 140]));
  const server = await startServer();
  const browser = await puppeteer.launch({
    executablePath: '/usr/local/bin/google-chrome',
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  const page = await browser.newPage();
  const dialogs = [];
  page.on('dialog', async d => { dialogs.push(d.message()); await d.accept(); });
  page.on('pageerror', err => { console.error('PAGEERROR', err); process.exitCode = 1; });
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1');
  try {
    await page.goto(BASE, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => document.querySelector('h1') && document.querySelector('h1').textContent === 'Invoices');
    if (await page.$('input[type=password]')) throw new Error('unexpected password field');
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);

    await clickText(page, 'Clients');
    let text = await bodyText(page);
    if (!text.includes('$65/hr ex GST') || !text.includes('half $450, full $900') || !text.includes('$95/hr ex GST')) {
      throw new Error('client rates missing:\n' + text);
    }
    await clickText(page, 'Inlink');
    text = await bodyText(page);
    if (!text.includes('Hourly rate')) throw new Error('Inlink editor missing');
    await clickText(page, '‹ Back');
    await clickText(page, 'Timmers');
    text = await bodyText(page);
    if (!/Half day/.test(text)) throw new Error('Timmers day rate missing');
    await clickText(page, '‹ Back');
    await clickText(page, 'JDARR');
    await page.waitForFunction(() => [...document.querySelectorAll('input')].some(i => i.value === '95'));

    await clickText(page, 'Invoices');
    await clickText(page, 'New invoice');
    await setLabeled(page, 'Job / site', 'EXAMPLE ONLY — not a real job');
    await clickText(page, 'Add work day');
    await setLabeled(page, 'Hours', '25.5');
    await setLabeled(page, 'Start', '');
    await setLabeled(page, 'Finish', '');
    await clickText(page, 'Tasks');
    await page.waitForSelector('.sheet .chip');
    const taskCount = await page.evaluate(() => document.querySelectorAll('.sheet .chip').length);
    if (taskCount < 40) throw new Error('task chips ' + taskCount);
    await page.evaluate(() => {
      const chips = [...document.querySelectorAll('.sheet .chip')];
      chips[0].click(); chips[1].click();
      document.querySelector('.sheet input').value = 'Custom bead';
      document.querySelector('.sheet input').dispatchEvent(new Event('input', { bubbles: true }));
    });
    await shot(page, 'iphone-tasks.png');
    await clickText(page, 'Done');
    const desc = await page.evaluate(() => [...document.querySelectorAll('textarea')].map(t => t.value).join('\n'));
    if (!desc.includes('Setting out / marking out') || !desc.includes('Custom bead')) throw new Error('tasks not applied: ' + desc);
    await clickText(page, 'Add parking');
    await setLabeled(page, 'Amount incl GST', '28');
    text = await bodyText(page);
    if (!text.includes('$1,657.50') || !text.includes('$165.75') || !text.includes('$28.00') || !text.includes('$1,851.25')) {
      throw new Error('hourly total wrong:\n' + text);
    }
    const fileInput = await page.$('input[type=file]');
    await fileInput.uploadFile(photo);
    await page.waitForFunction(() => document.querySelector('img.thumb'));
    await page.evaluate(() => {
      const sel = [...document.querySelectorAll('select')].find(s => [...s.options].some(o => o.value === 'other'));
      sel.value = 'other';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await setLabeled(page, 'Title', 'Example photo');
    if (await overflow()) throw new Error('invoice editor overflows');
    await shot(page, 'iphone-invoice-editor.png');
    await clickText(page, 'Save invoice');
    await page.waitForFunction(() => document.body.innerText.includes('Saved'));
    await clickText(page, 'Create PDF');
    await page.waitForFunction(() => window.__lastPdf);
    await savePdf(page, 'example-invoice-hourly.pdf');
    await clickText(page, '‹ Back');
    await clickText(page, '‹ Back');
    text = await bodyText(page);
    if (!text.includes('INV00083') || !text.includes('$1,851.25') || !text.includes('INV00084')) throw new Error('list/number:\n' + text);
    await shot(page, 'iphone-invoice-list.png');

    await clickText(page, 'New invoice');
    await page.evaluate(() => {
      const sel = document.querySelector('select');
      const opt = [...sel.options].find(o => /Timmers/.test(o.textContent));
      sel.value = opt.value; sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForFunction(() => document.body.innerText.includes('Half day'));
    await setLabeled(page, 'Job / site', 'EXAMPLE ONLY — day rates');
    await clickText(page, 'Add work day');
    await clickText(page, 'Add work day');
    await page.evaluate(() => {
      const sel = [...document.querySelectorAll('select')].find(s => [...s.options].some(o => o.value === 'half'));
      sel.value = 'half'; sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await setLabeled(page, 'Tradespeople', '2', 0);
    await setLabeled(page, 'Tradespeople', '2', 1);
    text = await bodyText(page);
    if (!text.includes('$2,700.00') || !text.includes('$270.00') || !text.includes('$2,970.00')) throw new Error('day total:\n' + text);
    await shot(page, 'iphone-day-rates.png');
    await clickText(page, 'Save invoice');
    await clickText(page, 'Create PDF');
    await page.waitForFunction(() => window.__lastPdf);
    await savePdf(page, 'example-invoice-day-rates.pdf');
    await clickText(page, '‹ Back');
    const keptNumber = await page.evaluate(() => {
      const n = [...document.querySelectorAll('input')].find(i => i.value && String(i.value).startsWith('INV'));
      const original = n.value;
      n.value = 'INV00083';
      n.dispatchEvent(new Event('input', { bubbles: true }));
      const warn = document.getElementById('numWarn').textContent;
      n.value = original;
      n.dispatchEvent(new Event('input', { bubbles: true }));
      return warn;
    });
    if (!/already used/i.test(keptNumber)) throw new Error('number warning missing: ' + keptNumber);

    await clickText(page, 'Invoices');
    await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'Quotes'); b.click(); });
    await clickText(page, 'New quote');
    await setLabeled(page, 'Job / site', 'EXAMPLE ONLY — not a real project');
    await clickText(page, 'Supply and fix');
    await clickText(page, 'Bathroom walls');
    text = await bodyText(page);
    if (!/not a double layer/i.test(text) || !text.includes('Fibre cement') || !text.includes('13 mm WR')) throw new Error('bathroom lines:\n' + text);
    await clickText(page, 'Fibre cement');
    text = await bodyText(page);
    if (!text.includes('Not in the total')) throw new Error('WR not excluded');
    await setLabeled(page, 'Qty (m2)', '1');
    await setLabeled(page, 'Supply and fix cost', '110');
    await page.waitForFunction(() => document.body.innerText.includes('$117.65'));
    text = await bodyText(page);
    if (!/not counted as \$0|not \$0|Unknown/i.test(text)) throw new Error('unknown not labelled:\n' + text);
    if ((text.match(/\$117\.65/g) || []).length < 1) throw new Error('margin figure missing');
    await page.evaluate(() => document.querySelector('.card.warn').scrollIntoView({ block: 'start' }));
    await page.screenshot({ path: path.join(ART, 'iphone-quote-compliance.png') });
    text = await bodyText(page);
    if (!text.includes('section 33') || !/not a legal certification/i.test(text) || !text.includes('50%')) throw new Error('compliance card:\n' + text.slice(0, 1500));
    if (await overflow()) throw new Error('quote editor overflows');
    await shot(page, 'iphone-quote-editor.png');
    const quotePhoto = await page.$('input[type=file]');
    await quotePhoto.uploadFile(photo);
    await page.waitForFunction(() => document.querySelectorAll('img.thumb').length >= 1);
    dialogs.length = 0;
    await clickText(page, 'Final');
    await page.waitForFunction(() => document.body.innerText.includes('Provisional estimate'));
    if (!dialogs.some(m => /not certified|not verified|Framing/i.test(m))) throw new Error('final alert missing ' + JSON.stringify(dialogs));
    await clickText(page, 'Create PDF');
    await page.waitForFunction(() => window.__lastPdf && document.body.innerText.includes('Provisional'));
    await savePdf(page, 'example-quote-provisional.pdf');

    await clickText(page, 'Invoices');
    text = await bodyText(page);
    if (!text.includes('Q00001') || !text.includes('Q00002')) throw new Error('quote number:\n' + text);
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('adl.settings')));
    if (stored.nextNumber !== 'INV00085') throw new Error('invoice number moved by quoting: ' + stored.nextNumber);
    if (stored.nextQuoteNumber !== 'Q00002') throw new Error('quote number ' + stored.nextQuoteNumber);
    if (stored.bank || stored.bsb || stored.account) throw new Error('bank was filled');

    await clickText(page, 'Settings');
    await setLabeled(page, 'Due', '14 days');
    await setLabeled(page, 'Next quote no.', 'Q00041');
    await clickText(page, 'Save settings');
    await page.waitForFunction(() => document.body.innerText.includes('Settings saved'));
    await page.reload({ waitUntil: 'networkidle0' });
    await clickText(page, 'Settings');
    const due = await page.evaluate(() => {
      const lab = [...document.querySelectorAll('label')].find(l => l.textContent.trim() === 'Due');
      return lab.nextElementSibling.value;
    });
    const qn = await page.evaluate(() => JSON.parse(localStorage.getItem('adl.settings')).nextQuoteNumber);
    const bank = await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem('adl.settings'));
      return [s.bank, s.bsb, s.account, s.due, s.nextNumber];
    });
    if (due !== '14 days' || qn !== 'Q00041' || bank[0] || bank[1] || bank[2]) throw new Error('settings persist ' + JSON.stringify(bank));
    await shot(page, 'iphone-settings.png');

    await page.evaluate(() => {
      document.addEventListener('click', e => {
        const a = e.target.closest && e.target.closest('a[download]');
        if (a) window.__backupHref = a.href;
      }, true);
    });
    await clickText(page, 'Export backup');
    await page.waitForFunction(() => window.__backupHref);
    const backup = JSON.parse(await page.evaluate(async () => (await fetch(window.__backupHref)).text()));
    if (backup.version !== 2 || !backup.quotes.length || !backup.invoices.length) throw new Error('backup shape');
    if (!backup.files.length || !String(backup.files[0].dataUrl).startsWith('data:image')) throw new Error('backup photo missing');
    if (backup.settings.bank) throw new Error('backup has bank');
    fs.writeFileSync('/tmp/adl-backup.json', JSON.stringify(backup));

    await page.evaluate(() => { localStorage.clear(); indexedDB.deleteDatabase('adl-invoice'); });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await clickText(page, 'Settings');
    const restore = await page.$('input[type=file][accept*="json"]');
    await restore.uploadFile('/tmp/adl-backup.json');
    await page.waitForFunction(() => document.querySelector('h1') && document.querySelector('h1').textContent === 'Invoices');
    text = await bodyText(page);
    if (!text.includes('INV00083') || !text.includes('$1,851.25')) throw new Error('restore invoices:\n' + text);
    await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'Quotes'); b.click(); });
    text = await bodyText(page);
    if (!text.includes('Q00001')) throw new Error('restore quotes:\n' + text);
    await clickText(page, 'Q00001');
    await page.waitForFunction(() => document.querySelector('img.thumb') || document.body.innerText.includes('EXAMPLE ONLY'));

    await page.waitForFunction(() => navigator.serviceWorker.ready);
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForFunction(() => navigator.serviceWorker.controller);
    const marker = '\n/* update-marker-8855 */\n';
    const qpath = path.join(ROOT, 'quote.js');
    const original = fs.readFileSync(qpath, 'utf8');
    fs.appendFileSync(qpath, marker);
    try {
      await page.setOfflineMode(false);
      const fetched = await page.evaluate(async () => (await fetch('quote.js', { cache: 'no-store' })).text());
      if (!fetched.includes('update-marker-8855')) throw new Error('quote.js did not update through the service worker');
    } finally { fs.writeFileSync(qpath, original); }
    await page.setOfflineMode(true);
    await page.reload({ waitUntil: 'domcontentloaded' });
    text = await bodyText(page);
    if (!text.includes('Invoices') && !text.includes('Quotes')) throw new Error('offline shell missing:\n' + text);
    const still = await page.evaluate(() => (JSON.parse(localStorage.getItem('adl.invoices') || '[]')).length);
    if (!still) throw new Error('offline lost invoices');
    console.log('BROWSER OK');
  } finally {
    await browser.close();
    server.kill();
  }
})().catch(err => { console.error(err); process.exit(1); });
