/* ADL Plaster Invoices — simple offline PWA. All data stays on this device. */
(function () {
  const { F, totals, hoursFromTimes } = window.INV;
  const $ = s => document.querySelector(s);
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const addDays = (s, n) => { const [y, m, d] = s.split('-').map(Number); const t = new Date(y, m - 1, d + n); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`; };
  const clone = o => JSON.parse(JSON.stringify(o));

  /* ---------- storage ---------- */
  const DEF_SETTINGS = {
    tradingName: 'ADL Plaster', legalName: 'Adrian David Lamond', address: '5 Chetwynd Street\nRedbank Plains QLD 4301',
    abn: '69 430 067 647', phone: '0452 665 333', email: 'adlplaster@outlook.com', supplierLine: 'Sole trader, GST registered',
    payee: 'Adrian David Lamond — ADL Plaster', bank: '', bsb: '', account: '',
    rate: 65, gstRate: 10, nextNumber: 'INV00083', due: 'On receipt', defStart: '06:30', defFinish: '14:30',
    expenseNote: 'Added at the receipt total. GST is already on the parking tax invoices. No extra GST added.',
    shareText: 'Hi {name}, please find attached tax invoice {number} for {total}. Thanks, Adrian',
    nextQuoteNumber: 'Q00001', quoteMarginPct: 15, quoteDepositPct: 50, quoteCostGst: 'inclusive'
  };
  const DEF_CLIENTS = [
    { id: 'inlink', name: 'Inlink Constructions', attention: 'Mark Hanham', address: '2 Satellite Street\nCoorparoo QLD 4150', abn: '25 144 973 208', phone: '', email: '', pricing: { type: 'hourly', rate: 65 } },
    { id: 'timmers', name: 'Timmers Construction Pty Ltd', attention: '', address: 'Unit 4/11 Forge Close\nSumner QLD 4074', abn: '74 117 282 854', phone: '1300 760 115', email: 'admin@timmersconstruction.com.au', pricing: { type: 'day', half: 450, full: 900 } },
    { id: 'jdarr', name: 'JDARR Projects Pty Ltd', attention: '', address: '', abn: '35 679 516 262', phone: '', email: '', pricing: { type: 'hourly', rate: 95 } }
  ];
  const SEED_VERSION = 2;
  const TASKS = [
    ['Set-out & framing', ['Setting out / marking out', 'Top & bottom track install', 'Steel stud wall framing', 'Timber wall framing', 'Bulkhead framing', 'Suspended ceiling framing (furring channel / top cross rail)', 'Direct-fix ceiling framing', 'Deflection head install', 'Nogging / backing install', 'Door frame install', 'Opening / window reveal framing']],
    ['Ceilings', ['Exposed grid ceiling install', 'Ceiling tile install', 'Ceiling sheeting', 'Bulkhead sheeting', 'Access panel install']],
    ['Sheeting & linings', ['Plasterboard wall sheeting', 'Fire-rated wall sheeting', 'Shaft wall install', 'Acoustic wall / insulation install', 'Wet area sheeting (Villaboard / FC)', 'Curved / feature wall']],
    ['Finishing', ['Corner beads / stopping beads', 'Shadowline / set trim', 'Cornice install', 'Setting – base coat', 'Setting – second coat', 'Setting – top coat', 'Sanding', 'Patching / repairs']],
    ['Fire & compliance', ['Fire stopping / penetration sealing', 'Fire-rated bulkhead / ceiling']],
    ['Site & other', ['Scaffold / EWP setup', 'Materials handling / loading', 'Demolition / strip-out', 'Site clean-up', 'Rework / defects', 'Site induction / toolbox', 'Travel', 'Standby / waiting time']]
  ];
  const ALL_TASKS = TASKS.flatMap(g => g[1]);
  const ls = {
    get(k, d) { try { const v = localStorage.getItem('adl.' + k); return v ? JSON.parse(v) : clone(d); } catch (e) { return clone(d); } },
    set(k, v) { localStorage.setItem('adl.' + k, JSON.stringify(v)); }
  };
  let S = Object.assign(clone(DEF_SETTINGS), ls.get('settings', {}));
  let clients = ls.get('clients', DEF_CLIENTS);
  let invoices = ls.get('invoices', []);
  let quotes = ls.get('quotes', []);
  const saveS = () => { try { ls.set('settings', S); } catch (e) { alert('Could not save: ' + e.message); } }, saveC = () => ls.set('clients', clients), saveI = () => ls.set('invoices', invoices), saveQ = () => ls.set('quotes', quotes);
  if (!localStorage.getItem('adl.clients')) { saveC(); localStorage.setItem('adl.seedVersion', String(SEED_VERSION)); }
  // Migration: add newer default clients (by id) and pricing to old entries, without overwriting user edits.
  (function migrate() {
    if (Number(localStorage.getItem('adl.seedVersion') || 1) >= SEED_VERSION) return;
    const norm = t => String(t || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    DEF_CLIENTS.forEach(dc => {
      const ex = clients.find(c => c.id === dc.id) || clients.find(c => norm(c.name) === norm(dc.name));
      if (!ex) clients.push(clone(dc)); else if (!ex.pricing) ex.pricing = clone(dc.pricing);
    });
    clients.forEach(c => { if (!c.pricing) c.pricing = { type: 'hourly', rate: Number(S.rate) || 65 }; });
    saveC(); localStorage.setItem('adl.seedVersion', String(SEED_VERSION));
  })();
  const pricingFor = c => clone((c && c.pricing) || { type: 'hourly', rate: Number(S.rate) || 65 });
  const pricingLabel = p => p && p.type === 'day' ? `Day rate: half $${p.half || 0}, full $${p.full || 0} ex GST` : `$${(p && p.rate) || 0}/hr ex GST`;

  const idb = new Promise((res, rej) => { const r = indexedDB.open('adl-invoice', 1); r.onupgradeneeded = () => r.result.createObjectStore('files', { keyPath: 'id' }); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const fileOp = (mode, fn) => idb.then(db => new Promise((res, rej) => { const tx = db.transaction('files', mode); const st = tx.objectStore('files'); const r = fn(st); tx.oncomplete = () => res(r && r.result); tx.onerror = () => rej(tx.error); }));
  const putFile = f => fileOp('readwrite', st => st.put(f));
  const getFile = id => fileOp('readonly', st => st.get(id));
  const delFile = id => fileOp('readwrite', st => st.delete(id));
  const allFiles = () => fileOp('readonly', st => st.getAll());
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

  /* ---------- helpers ---------- */
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const k in (attrs || {})) {
      const v = attrs[k]; if (v == null || v === false) continue;
      if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else if (k === 'class') el.className = v; else if (k === 'html') el.innerHTML = v; else if (k === 'value') el.value = v; else el.setAttribute(k, v === true ? '' : v);
    }
    kids.flat().forEach(c => { if (c == null || c === false) return; el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c); });
    return el;
  }
  const toast = m => { const t = $('#toast'); t.textContent = m; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2200); };
  const field = (lab, inp) => h('div', null, h('label', null, lab), inp);
  function bind(obj, key, attrs, after) {
    const tag = attrs && attrs.textarea ? 'textarea' : (attrs && attrs.options ? 'select' : 'input');
    const a = Object.assign({}, attrs); delete a.textarea; const opts = a.options; delete a.options;
    const el = h(tag, a, opts ? opts.map(o => h('option', { value: o[0] }, o[1])) : null);
    el.value = obj[key] == null ? '' : obj[key];
    const upd = () => { obj[key] = (a.type === 'number') ? (el.value === '' ? '' : Number(el.value)) : el.value; after && after(el); };
    el.addEventListener('input', upd); el.addEventListener('change', upd); el.addEventListener('blur', upd);
    return el;
  }
  const incNum = n => { const m = String(n).match(/^(.*?)(\d+)$/); return m ? m[1] + String(Number(m[2]) + 1).padStart(m[2].length, '0') : n + '-1'; };
  const numVal = n => { const m = String(n).match(/(\d+)$/); return m ? Number(m[1]) : -1; };
  const invTotal = inv => totals(inv).total;
  const numberWarning = (list, rec) => {
    if (!rec || !rec.number) return '';
    const clash = list.find(i => i.number === rec.number && i.id !== rec.id);
    return clash ? rec.number + ' is already used. Check existing records before you keep it.' : '';
  };
  const bankMissing = () => !String(S.bank || '').trim() || !String(S.bsb || '').trim() || !String(S.account || '').trim();
  const bankWarn = () => bankMissing() ? h('div', { class: 'card warn' }, h('b', null, '⚠️ Bank details missing'),
    h('div', null, 'Add your bank, BSB and account number in Settings so clients know where to pay. They are printed on every invoice.'),
    h('button', { class: 'btn small', style: 'margin-top:8px', onclick: () => go('settings') }, 'Open Settings')) : null;

  /* ---------- navigation ---------- */
  let cur = null, dirty = false, curQ = null, dirtyQ = false, view = 'list', listMode = 'invoices';
  const views = {};
  function tabFor(v) {
    if (v === 'edit' || v === 'pdf') return cur && cur._saved ? 'list' : 'new';
    if (v === 'quote' || v === 'qpdf') return 'list';
    if (v === 'client') return 'clients';
    return v;
  }
  function go(v, arg, opts) {
    if (!(opts && opts.force)) {
      if (dirty && cur && !cur._saved && v !== 'edit' && v !== 'pdf') { if (!confirm('Discard this unsaved invoice?')) return; }
      if (dirtyQ && curQ && !curQ._saved && v !== 'quote' && v !== 'qpdf') { if (!confirm('Discard this unsaved quote?')) return; }
    }
    if (v !== 'edit' && v !== 'pdf') { cur = null; dirty = false; }
    if (v !== 'quote' && v !== 'qpdf') { curQ = null; dirtyQ = false; }
    view = v; window.scrollTo(0, 0);
    document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tabFor(v)));
    const main = $('#view'); main.innerHTML = ''; $('#toast').classList.remove('show');
    views[v](main, arg);
  }
  function header(t, back) { $('#title').textContent = t; const b = $('#backBtn'); b.classList.toggle('hidden', !back); b.onclick = back || null; }
  $('#tabs').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; const t = b.dataset.tab; if (t === 'new') newInvoice(); else go(t); });

  /* ---------- invoice list ---------- */
  views.list = main => {
    header(listMode === 'quotes' ? 'Quotes' : 'Invoices');
    main.append(h('img', { class: 'logo', src: 'icons/logo.jpg', alt: 'ADL Plaster' }));
    main.append(h('div', { class: 'seg', style: 'margin-bottom:12px' },
      h('button', { type: 'button', class: listMode === 'invoices' ? 'on' : '', onclick: () => { listMode = 'invoices'; go('list'); } }, 'Invoices'),
      h('button', { type: 'button', class: listMode === 'quotes' ? 'on' : '', onclick: () => { listMode = 'quotes'; go('list'); } }, 'Quotes')));
    if (listMode === 'quotes') { renderQuoteList(main); return; }
    const unpaid = invoices.filter(i => i.status !== 'paid');
    main.append(h('div', { class: 'sum' },
      h('div', null, h('span', null, 'Unpaid'), h('b', null, F.money(unpaid.reduce((s, i) => s + invTotal(i), 0))), h('span', null, unpaid.length + ' invoice' + (unpaid.length === 1 ? '' : 's'))),
      h('div', null, h('span', null, 'Next number'), h('b', null, S.nextNumber), h('span', null, clients.length + ' clients'))));
    const bw = bankWarn(); if (bw) main.append(bw);
    main.append(h('button', { class: 'btn red', onclick: newInvoice }, '＋  New invoice'));
    main.append(h('div', { style: 'height:14px' }));
    if (!invoices.length) main.append(h('div', { class: 'empty' }, 'No invoices yet. Tap “New invoice” to make your first one.'));
    [...invoices].sort((a, b) => numVal(b.number) - numVal(a.number) || (b.created || 0) - (a.created || 0)).forEach(inv => {
      main.append(h('div', { class: 'inv', onclick: () => openInvoice(inv.id) },
        h('div', { class: 'm' }, h('div', { class: 'n' }, inv.number, ' ', h('span', { class: 'pill ' + (inv.status === 'paid' ? 'paid' : 'unpaid') }, inv.status === 'paid' ? 'Paid' : 'Unpaid')),
          h('div', { class: 'c' }, (inv.client && inv.client.name || '—') + ' · ' + F.dFull(inv.date)),
          inv.jobSite ? h('div', { class: 'c' }, inv.jobSite) : null),
        h('div', { class: 'a' }, F.money(invTotal(inv)))));
    });
  };
  function renderQuoteList(main) {
    if (!window.QUOTE) { main.append(h('div', { class: 'card warn' }, 'Quote tools did not load. Invoices still work.')); return; }
    const openN = quotes.filter(q => QUOTE.presentation(clone(q)).stage !== 'final').length;
    main.append(h('div', { class: 'sum' },
      h('div', null, h('span', null, 'Provisional'), h('b', null, String(openN)), h('span', null, quotes.length + ' quote' + (quotes.length === 1 ? '' : 's'))),
      h('div', null, h('span', null, 'Next quote'), h('b', null, S.nextQuoteNumber || 'Q00001'), h('span', null, 'Own number'))));
    main.append(h('button', { class: 'btn red', onclick: newQuote }, '＋  New quote'));
    main.append(h('div', { style: 'height:14px' }));
    if (!quotes.length) main.append(h('div', { class: 'empty' }, 'No quotes yet. A quote stays a provisional estimate until you mark it final.'));
    [...quotes].sort((a, b) => numVal(b.number) - numVal(a.number) || (b.created || 0) - (a.created || 0)).forEach(q => {
      const pres = QUOTE.presentation(clone(q));
      const amount = pres.priced.complete ? F.money(pres.priced.total) : 'Incomplete';
      main.append(h('div', { class: 'inv', onclick: () => openQuote(q.id) },
        h('div', { class: 'm' }, h('div', { class: 'n' }, q.number || 'Quote', ' ', h('span', { class: 'pill ' + (pres.stage === 'final' ? 'final' : 'prov') }, pres.stage === 'final' ? 'Final' : 'Provisional')),
          h('div', { class: 'c' }, (q.client && q.client.name || '—') + ' · ' + F.dFull(q.date)),
          q.jobSite ? h('div', { class: 'c' }, q.jobSite) : null),
        h('div', { class: 'a' }, amount)));
    });
  }

  /* ---------- editor ---------- */
  function newInvoice() {
    if (dirty && cur && !cur._saved && !confirm('Discard this unsaved invoice?')) return;
    if (dirtyQ && curQ && !curQ._saved && !confirm('Discard this unsaved quote?')) return;
    listMode = 'invoices';
    curQ = null; dirtyQ = false;
    const c = clients[0] || {};
    cur = { id: uid(), number: S.nextNumber, date: today(), due: S.due, clientId: c.id || '', client: clone(c), jobSite: '', jobLines: '', period: '',
      rate: pricingFor(c).rate || S.rate, pricing: pricingFor(c), gstRate: S.gstRate, days: [], expenses: [], expenseNote: '', flagNote: '', labourNote: '', atts: [], status: 'unpaid', created: Date.now(), _saved: false };
    dirty = false; go('edit', null, { force: true });
  }
  function openInvoice(id) { const inv = invoices.find(i => i.id === id); if (!inv) return; listMode = 'invoices'; cur = clone(inv); if (!cur.pricing) cur.pricing = { type: 'hourly', rate: Number(cur.rate) || 0 }; cur._saved = true; dirty = false; go('edit'); }
  function persist(silent) {
    if (!cur) return;
    if (!cur.number) { alert('Please enter an invoice number.'); return false; }
    const clash = invoices.find(i => i.number === cur.number && i.id !== cur.id);
    if (clash && !confirm(`${cur.number} is already used. Save anyway?`)) return false;
    const first = !cur._saved; cur._saved = true; cur.updated = Date.now();
    const rec = clone(cur); delete rec._saved;
    const i = invoices.findIndex(x => x.id === cur.id); if (i >= 0) invoices[i] = rec; else invoices.push(rec);
    saveI();
    if (first && numVal(cur.number) >= numVal(S.nextNumber)) { S.nextNumber = incNum(cur.number); saveS(); }
    dirty = false; if (!silent) toast('Saved ' + cur.number);
    return true;
  }
  let autoT; const changed = () => { dirty = true; refreshTotals(); if (cur && cur._saved) { clearTimeout(autoT); autoT = setTimeout(() => persist(true), 600); } };
  let totalsEl;
  function refreshTotals() {
    if (!totalsEl || !cur) return; const T = totals(cur);
    const numWarn = document.getElementById('numWarn');
    if (numWarn) { const w = numberWarning(invoices, cur); numWarn.textContent = w; numWarn.style.color = w ? 'var(--amber)' : ''; }
    totalsEl.innerHTML = '';
    const pd = (cur.days || []).reduce((n, d, i) => n + T.lines[i].t * (d.dayType === 'half' ? 0.5 : 1), 0);
    const labLbl = T.P.type === 'day' ? `Labour ${F.hrs(pd)} person-days ex GST` : `Labour ${F.hrs(T.manHours)} ${T.multi ? 'person-hours' : 'hrs'} ex GST`;
    totalsEl.append(...[h('div', { class: 'l' }, h('span', null, labLbl), h('span', null, F.money(T.labour))),
      h('div', { class: 'l' }, h('span', null, `GST ${T.gstPct}%`), h('span', null, F.money(T.gst))),
      T.exp ? h('div', { class: 'l' }, h('span', null, 'Parking (no extra GST)'), h('span', null, F.money(T.exp))) : null,
      h('div', { class: 'l big' }, h('span', null, 'Balance due'), h('span', null, F.money(T.total)))].filter(Boolean));
  }

  views.edit = main => {
    const inv = cur;
    header(inv._saved ? inv.number : 'New invoice', () => go('list'));
    // status
    if (inv._saved) {
      const seg = h('div', { class: 'seg' }, ['unpaid', 'paid'].map(s => h('button', { class: inv.status === s ? 'on' : '', onclick: () => { inv.status = s; inv.paidDate = s === 'paid' ? today() : ''; persist(true); go('edit'); toast(s === 'paid' ? 'Marked paid 🎉' : 'Marked unpaid'); } }, s === 'paid' ? '✓ Paid' : 'Unpaid')));
      main.append(h('div', { class: 'card' }, seg, inv.status === 'paid' && inv.paidDate ? h('div', { class: 'muted', style: 'margin-top:6px;text-align:center' }, 'Paid ' + F.dFull(inv.paidDate)) : null));
    }
    // client & job
    const cSel = h('select', { onchange: e => { if (e.target.value === '__new') { go('client', { returnToEdit: inv }, { force: true }); return; } const c = clients.find(x => x.id === e.target.value); inv.clientId = c.id; inv.client = clone(c); inv.pricing = pricingFor(c); if (inv.pricing.type === 'hourly') inv.rate = inv.pricing.rate; renderPricing(); renderDays(); changed(); toast(c.name.split(' ')[0] + ': ' + pricingLabel(inv.pricing)); } },
      clients.map(c => h('option', { value: c.id }, c.name)), h('option', { value: '__new' }, '＋ Add new client…'));
    cSel.value = inv.clientId;
    main.append(h('div', { class: 'card' }, h('h2', null, 'Client & job'), field('Bill to', cSel),
      field('Job / site', bind(inv, 'jobSite', { placeholder: 'e.g. 12 Smith Street fit-out' }, changed)),
      field('Job details (one per line)', bind(inv, 'jobLines', { textarea: true, placeholder: 'Builder or project name\nScope of work\nSigned day sheet attached' }, changed))));
    // pricing (from client, editable per invoice)
    if (!inv.pricing) inv.pricing = { type: 'hourly', rate: Number(inv.rate) || 0 };
    const pricingBox = h('div');
    function renderPricing() {
      const P = inv.pricing; pricingBox.innerHTML = '';
      const typeSel = bind(P, 'type', { options: [['hourly', 'Hourly rate'], ['day', 'Day rate']] }, () => { if (P.type === 'day') { P.half = P.half || 450; P.full = P.full || 900; } else { P.rate = P.rate || Number(S.rate) || 65; inv.rate = P.rate; } renderPricing(); renderDays(); changed(); });
      pricingBox.append(h('div', { class: 'row' }, field('Pricing (per tradesperson)', typeSel),
        P.type === 'day' ? null : field('$/hr ex GST', bind(P, 'rate', { type: 'number', inputmode: 'decimal', step: '0.01' }, () => { inv.rate = P.rate; changed(); }))),
        P.type === 'day' ? h('div', { class: 'row' }, field('Half day $ ex GST', bind(P, 'half', { type: 'number', inputmode: 'decimal', step: '0.01' }, changed)), field('Full day $ ex GST', bind(P, 'full', { type: 'number', inputmode: 'decimal', step: '0.01' }, changed))) : null);
    }
    // invoice details
    main.append(h('div', { class: 'card' }, h('h2', null, 'Invoice'),
      h('div', { class: 'row' }, field('Number', bind(inv, 'number', { autocapitalize: 'characters' }, changed)), field('Date', bind(inv, 'date', { type: 'date' }, changed))),
      h('div', { class: 'muted', id: 'numWarn' }),
      h('div', { class: 'row' }, field('Due', bind(inv, 'due', {}, changed)), field('Period', bind(inv, 'period', { placeholder: 'auto' }, changed))),
      pricingBox));
    renderPricing();
    // work days
    const daysBox = h('div');
    function renderDays() {
      daysBox.innerHTML = '';
      const isDay = inv.pricing && inv.pricing.type === 'day';
      inv.days.forEach((d, i) => {
        if (!d.trades) d.trades = 1;
        if (isDay && !d.dayType) d.dayType = 'full';
        const hrs = bind(d, 'hours', { type: 'number', inputmode: 'decimal', step: '0.25' }, changed);
        const recalc = () => { const v = hoursFromTimes(d.start, d.finish, d.brk); if (v != null) { d.hours = v; hrs.value = v; } changed(); };
        const trades = field('Tradespeople', bind(d, 'trades', { type: 'number', inputmode: 'numeric', min: '1', step: '1' }, changed));
        const desc = bind(d, 'desc', { textarea: true, rows: '2', placeholder: 'Pick tasks or type', class: 'desc-in' }, changed);
        const hd = h('div', { class: 'hd' }, d.date ? F.dShort(d.date) : 'Day ' + (i + 1));
        daysBox.append(h('div', { class: 'item day-item' },
          hd,
          h('button', { class: 'x', 'aria-label': 'Remove day', onclick: () => { inv.days.splice(i, 1); renderDays(); changed(); } }, '×'),
          field('Date', bind(d, 'date', { type: 'date' }, () => { hd.textContent = d.date ? F.dShort(d.date) : 'Day ' + (i + 1); changed(); })),
          isDay ? h('div', { class: 'row' }, field('Day', bind(d, 'dayType', { options: [['full', 'Full day'], ['half', 'Half day']] }, changed)), trades) : null,
          isDay ? null : h('div', { class: 'row' }, field('Start', bind(d, 'start', { type: 'time' }, recalc)), field('Finish', bind(d, 'finish', { type: 'time' }, recalc))),
          isDay ? null : h('div', { class: 'row three' }, field('Break (min)', bind(d, 'brk', { type: 'number', inputmode: 'numeric', placeholder: '0' }, recalc)), field('Hours', hrs), trades),
          h('div', null, h('label', null, 'Description'), h('div', { class: 'desc-row' }, desc, h('button', { class: 'btn small task-btn', type: 'button', onclick: () => openTasks(d, desc) }, '☰ Tasks'))),
          field('Job', bind(d, 'job', { placeholder: 'e.g. Smith St' }, changed))));
      });
    }
    renderDays();
    main.append(h('div', { class: 'card' }, h('h2', null, 'Work days'), daysBox,
      h('button', { class: 'btn ghost', onclick: () => {
        const last = inv.days[inv.days.length - 1];
        const d = last ? { date: last.date ? addDays(last.date, 1) : today(), start: last.start, finish: last.finish, brk: last.brk || '', hours: last.hours, desc: last.desc, job: last.job, trades: last.trades || 1, dayType: last.dayType || 'full' }
          : { date: today(), start: S.defStart, finish: S.defFinish, brk: '', hours: hoursFromTimes(S.defStart, S.defFinish) || 8, desc: '', job: inv.jobSite || '', trades: 1, dayType: 'full' };
        inv.days.push(d); renderDays(); changed();
      } }, '＋ Add work day')));
    // expenses
    const expBox = h('div');
    const renderExp = () => {
      expBox.innerHTML = '';
      inv.expenses.forEach((e, i) => expBox.append(h('div', { class: 'item' },
        h('div', { class: 'hd' }, 'Parking ' + (i + 1)),
        h('button', { class: 'x', 'aria-label': 'Remove', onclick: () => { inv.expenses.splice(i, 1); renderExp(); changed(); } }, '×'),
        h('div', { class: 'row' }, field('Date', bind(e, 'date', { type: 'date' }, changed)), field('Amount incl GST', bind(e, 'amount', { type: 'number', inputmode: 'decimal', step: '0.01', placeholder: '0.00' }, changed))),
        field('Details', bind(e, 'details', { textarea: true, placeholder: 'Car park name\nAddress\nEntry – exit times' }, changed)),
        field('Receipt ref', bind(e, 'ref', { placeholder: 'e.g. receipt number' }, changed)))));
    };
    renderExp();
    main.append(h('div', { class: 'card' }, h('h2', null, 'Parking'), h('div', { class: 'muted' }, 'Charged at the receipt total — no extra GST added.'), h('div', { style: 'height:8px' }), expBox,
      h('button', { class: 'btn ghost', onclick: () => { const last = inv.expenses[inv.expenses.length - 1]; inv.expenses.push({ date: last && last.date ? addDays(last.date, 1) : (inv.days[0] && inv.days[0].date) || today(), details: last ? last.details.split('\n').slice(0, 2).join('\n') : '', ref: '', amount: last ? last.amount : '' }); renderExp(); changed(); } }, '＋ Add parking'),
      field('Highlighted note (optional)', bind(inv, 'flagNote', { textarea: true, placeholder: 'e.g. No parking receipt for Thursday, so Thursday parking is not charged.' }, changed))));
    // attachments
    const attBox = h('div');
    const renderAtt = () => {
      attBox.innerHTML = '';
      inv.atts.forEach((a, i) => {
        const img = h('img', { class: 'thumb', alt: '' }); getFile(a.id).then(f => { if (f) img.src = f.dataUrl; });
        attBox.append(h('div', { class: 'item clearfix' }, img,
          h('button', { class: 'x', 'aria-label': 'Remove photo', onclick: () => { if (!confirm('Remove this photo?')) return; inv.atts.splice(i, 1); renderAtt(); changed(); } }, '×'),
          h('div', { class: 'hd' }, `Page ${i + 2}`),
          field('Type', bind(a, 'kind', { options: [['daysheet', 'Signed day sheet'], ['receipt', 'Parking receipt'], ['other', 'Other']] }, () => { renderAtt(); changed(); })),
          a.kind === 'receipt' ? field('Receipt date', bind(a, 'date', { type: 'date' }, changed)) : null,
          a.kind === 'other' ? field('Title', bind(a, 'title', { placeholder: 'e.g. Variation sign-off' }, changed)) : null,
          field('Caption (optional)', bind(a, 'caption', { placeholder: 'e.g. Ref ABC123. $14.00 including GST of $1.27.' }, changed)),
          h('div', { class: 'row', style: 'margin-top:8px' },
            i > 0 ? h('button', { class: 'btn small ghost', onclick: () => { [inv.atts[i - 1], inv.atts[i]] = [inv.atts[i], inv.atts[i - 1]]; renderAtt(); changed(); } }, '↑ Move up') : h('span'))));
      });
    };
    renderAtt();
    const fileIn = h('input', { type: 'file', accept: 'image/*', multiple: true, style: 'display:none', onchange: async e => {
      const files = [...e.target.files]; e.target.value = '';
      for (const f of files) {
        try {
          const im = await loadImage(f); const id = uid(); await putFile(Object.assign({ id }, im));
          const usedDates = inv.atts.filter(a => a.kind === 'receipt').map(a => a.date);
          const hasSheet = inv.atts.some(a => a.kind === 'daysheet');
          const exp = inv.expenses.find(x => !usedDates.includes(x.date));
          inv.atts.push({ id, kind: hasSheet ? 'receipt' : 'daysheet', date: hasSheet && exp ? exp.date : '', title: '', caption: '' });
        } catch (err) { alert('Could not read that photo: ' + err.message); }
      }
      renderAtt(); changed();
    } });
    main.append(h('div', { class: 'card' }, h('h2', null, 'Photos (day sheet, receipts)'), h('div', { class: 'muted' }, 'Added as extra pages after the invoice.'), h('div', { style: 'height:8px' }), attBox, fileIn,
      h('button', { class: 'btn ghost', onclick: () => fileIn.click() }, '📷 Add photo')));
    // totals + actions
    totalsEl = h('div'); refreshTotals();
    main.append(h('div', { class: 'card totals' }, totalsEl));
    main.append(h('button', { class: 'btn red', onclick: makePdf }, 'Create PDF & send'));
    main.append(h('button', { class: 'btn navy', onclick: () => { if (persist()) go('edit'); } }, inv._saved ? 'Save' : 'Save invoice'));
    if (inv._saved) {
      main.append(h('div', { class: 'row' },
        h('button', { class: 'btn ghost', onclick: () => duplicate(inv) }, 'Duplicate'),
        h('button', { class: 'btn ghost', style: 'color:#c0302a', onclick: () => { if (!confirm(`Delete ${inv.number}? This can't be undone.`)) return; invoices = invoices.filter(i => i.id !== inv.id); saveI(); inv.atts.forEach(a => delFile(a.id)); dirty = false; cur = null; go('list'); toast('Deleted'); } }, 'Delete')));
    }
    main.append(h('details', { class: 'card', style: 'margin-top:12px' }, h('summary', { class: 'muted' }, 'More options'),
      field('Labour note (blank = automatic)', bind(inv, 'labourNote', { textarea: true, placeholder: INV.labourNote(Object.assign({}, inv, { labourNote: '' }), inv.atts.some(a => a.kind === 'daysheet')) || 'Automatic' }, changed)),
      field('Parking note', bind(inv, 'expenseNote', { textarea: true, placeholder: S.expenseNote }, changed)),
      field('GST %', bind(inv, 'gstRate', { type: 'number', inputmode: 'decimal' }, changed))));
  };
  /* task picker (bottom sheet, multi-select) */
  function openTasks(d, input) {
    const parts = String(d.desc || '').split(',').map(t => t.trim()).filter(Boolean);
    const chosen = new Set(parts.filter(t => ALL_TASKS.includes(t)));
    const other = parts.filter(t => !ALL_TASKS.includes(t)).join(', ');
    const otherIn = h('input', { placeholder: 'Other… type anything', value: other });
    const close = () => sheet.remove();
    const sheet = h('div', { class: 'sheet-bg', onclick: e => { if (e.target === sheet) close(); } },
      h('div', { class: 'sheet' },
        h('div', { class: 'sheet-hd' }, h('button', { class: 'linkbtn', onclick: () => { chosen.clear(); sheet.querySelectorAll('.chip').forEach(c => c.classList.remove('on')); } }, 'Clear'), h('b', null, 'Tasks'),
          h('button', { class: 'linkbtn strong', onclick: () => { const v = [...ALL_TASKS.filter(t => chosen.has(t)), ...otherIn.value.split(',').map(t => t.trim()).filter(Boolean)].join(', '); d.desc = v; input.value = v; close(); changed(); } }, 'Done')),
        h('div', { class: 'sheet-body' },
          TASKS.map(([grp, items]) => h('div', null, h('div', { class: 'grp' }, grp), h('div', { class: 'chips' },
            items.map(t => h('button', { class: 'chip' + (chosen.has(t) ? ' on' : ''), type: 'button', onclick: e => { if (chosen.has(t)) chosen.delete(t); else chosen.add(t); e.currentTarget.classList.toggle('on'); } }, t))))),
          h('div', { class: 'grp' }, 'Other…'), otherIn)));
    document.body.append(sheet);
  }
  function duplicate(src) {
    cur = clone(src); Object.assign(cur, { id: uid(), number: S.nextNumber, date: today(), status: 'unpaid', paidDate: '', atts: [], period: '', created: Date.now(), _saved: false });
    dirty = true; go('edit', null, { force: true }); toast('Copy made — update the days, then save');
  }
  function loadImage(file) {
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(file); const img = new Image();
      img.onload = () => { const max = 1700; let w = img.naturalWidth, hh = img.naturalHeight; const k = Math.min(1, max / Math.max(w, hh)); w = Math.round(w * k); hh = Math.round(hh * k);
        const c = document.createElement('canvas'); c.width = w; c.height = hh; const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, w, hh); x.drawImage(img, 0, 0, w, hh);
        URL.revokeObjectURL(url); res({ dataUrl: c.toDataURL('image/jpeg', 0.82), w, h: hh }); };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('unsupported image')); };
      img.src = url;
    });
  }
  let logoCache;
  function getLogo() {
    if (logoCache) return Promise.resolve(logoCache);
    return fetch('icons/logo.jpg').then(r => r.blob()).then(b => new Promise(res => { const fr = new FileReader(); fr.onload = () => { const i = new Image(); i.onload = () => res(logoCache = { dataUrl: fr.result, w: i.naturalWidth, h: i.naturalHeight }); i.src = fr.result; }; fr.readAsDataURL(b); }));
  }
  async function makePdf() {
    if (!cur.days.length && !cur.expenses.length) { alert('Add at least one work day first.'); return; }
    if (persist(true) === false) return;
    toast(bankMissing() ? 'Heads up: bank details are blank — add them in Settings' : 'Making PDF…');
    const atts = [];
    for (const a of cur.atts) { const f = await getFile(a.id); if (f) atts.push(Object.assign({}, a, f)); }
    const doc = INV.build(cur, S, atts, await getLogo());
    const blob = doc.output('blob');
    const name = `${S.tradingName.replace(/\s+/g, '')}-${cur.number}${cur.client && cur.client.name ? '-' + cur.client.name.split(' ')[0] : ''}.pdf`;
    go('pdf', { blob, name, pages: doc.getNumberOfPages() });
  }
  views.pdf = (main, arg) => {
    const inv = cur; header(inv.number, () => go('edit'));
    const file = new File([arg.blob], arg.name, { type: 'application/pdf' });
    const url = URL.createObjectURL(arg.blob);
    window.__lastPdf = arg.blob; // for testing
    const first = (inv.client && inv.client.attention || '').split(' ')[0] || 'there';
    const msg = (S.shareText || '').replace('{name}', first).replace('{number}', inv.number).replace('{total}', F.money(invTotal(inv))).replace('{client}', inv.client && inv.client.name || '');
    const canShare = navigator.canShare && navigator.canShare({ files: [file] });
    const bw = bankWarn(); if (bw) { bw.querySelector('div').textContent = 'This PDF has blank bank, BSB or account details. Add them in Settings, then create the PDF again.'; main.append(bw); }
    main.append(h('div', { class: 'card', style: 'text-align:center' },
      h('div', { style: 'font-size:46px' }, '📄'), h('div', { style: 'font-weight:700;font-size:18px' }, arg.name),
      h('div', { class: 'muted' }, `${arg.pages} page${arg.pages > 1 ? 's' : ''} · ${(arg.blob.size / 1024 / 1024).toFixed(1)} MB · Balance due ${F.money(invTotal(inv))}`)));
    main.append(h('button', { class: 'btn red', onclick: async () => {
      if (!canShare) { toast('Sharing not supported here — downloading'); dl(); return; }
      try { await navigator.share({ files: [file], title: `Tax invoice ${inv.number}`, text: msg }); } catch (e) { if (e.name !== 'AbortError') { toast('Share failed — downloading'); dl(); } }
    } }, canShare ? '⬆︎ Share (Mail, Outlook, Messages…)' : '⬇︎ Download PDF'));
    const dl = () => { const a = h('a', { href: url, download: arg.name }); document.body.append(a); a.click(); a.remove(); };
    main.append(h('a', { class: 'btn navy', href: url, target: '_blank', rel: 'noopener' }, 'Preview PDF'));
    if (canShare) main.append(h('button', { class: 'btn ghost', onclick: dl }, 'Download instead'));
    main.append(h('div', { class: 'card', style: 'margin-top:12px' }, h('h2', null, 'Message (copied with share)'), h('div', null, msg),
      h('button', { class: 'btn small ghost', style: 'margin-top:8px', onclick: () => navigator.clipboard && navigator.clipboard.writeText(msg).then(() => toast('Copied')) }, 'Copy message')));
    main.append(h('button', { class: 'btn ghost', onclick: () => go('list') }, 'Done'));
  };

  /* ---------- quotes (same layout, own numbers) ---------- */
  function newQuote() {
    if (!window.QUOTE) { alert('Quote tools did not load.'); return; }
    if (dirty && cur && !cur._saved && !confirm('Discard this unsaved invoice?')) return;
    if (dirtyQ && curQ && !curQ._saved && !confirm('Discard this unsaved quote?')) return;
    const c = clients[0] || {};
    curQ = { id: uid(), number: S.nextQuoteNumber || 'Q00001', date: today(), clientId: c.id || '', client: clone(c), jobSite: '', jobLines: '',
      stage: 'provisional', basis: '', marginPct: S.quoteMarginPct == null || S.quoteMarginPct === '' ? 15 : S.quoteMarginPct,
      gstRate: S.gstRate == null || S.gstRate === '' ? 10 : S.gstRate, costGst: S.quoteCostGst || 'inclusive',
      depositPct: S.quoteDepositPct == null || S.quoteDepositPct === '' ? 50 : S.quoteDepositPct,
      framingNearComplete: false, compliance: { contractClass: 'unverified', offSiteMajority: false, privateNote: '' },
      rooms: [], delivery: { include: true, qty: '', cost: '' }, patch: { rate: '' }, atts: [], created: Date.now(), _saved: false };
    QUOTE.normQuote(curQ);
    listMode = 'quotes'; dirtyQ = false; cur = null; dirty = false; go('quote', null, { force: true });
  }
  function openQuote(id) {
    const q = quotes.find(x => x.id === id); if (!q) return;
    listMode = 'quotes'; curQ = clone(q); QUOTE.normQuote(curQ); curQ._saved = true; dirtyQ = false; go('quote');
  }
  function persistQuote(silent) {
    if (!curQ) return false;
    if (!curQ.number) { alert('Please enter a quote number.'); return false; }
    const clash = quotes.find(q => q.number === curQ.number && q.id !== curQ.id);
    if (clash && !confirm(curQ.number + ' is already used on a quote. Save anyway?')) return false;
    if (QUOTE.finalBlockers(curQ, QUOTE.priceQuote(curQ)).length) curQ.stage = 'provisional';
    const first = !curQ._saved; curQ._saved = true; curQ.updated = Date.now();
    const rec = clone(curQ); delete rec._saved;
    const i = quotes.findIndex(x => x.id === curQ.id); if (i >= 0) quotes[i] = rec; else quotes.push(rec);
    saveQ();
    if (first && numVal(curQ.number) >= numVal(S.nextQuoteNumber || 'Q00001')) { S.nextQuoteNumber = incNum(curQ.number); saveS(); }
    dirtyQ = false; if (!silent) toast('Saved ' + curQ.number);
    return true;
  }
  let autoQT, qTotals, qStatus, qInternal, qRooms;
  const changedQuote = () => {
    if (curQ && curQ.stage === 'final' && QUOTE.finalBlockers(curQ, QUOTE.priceQuote(curQ)).length) {
      curQ.stage = 'provisional'; toast('Reverted to provisional — final conditions are not met');
    }
    dirtyQ = true; refreshQuote();
    if (curQ && curQ._saved) { clearTimeout(autoQT); autoQT = setTimeout(() => persistQuote(true), 600); }
  };
  function costLabel(unit) {
    const gst = curQ.costGst === 'exclusive' ? 'ex GST' : 'GST inclusive';
    if (curQ.basis === 'labour-only') return 'Labour cost / ' + unit + ' (' + gst + ') — materials not included';
    if (curQ.basis === 'supply-fix') return 'Supply and fix cost / ' + unit + ' (' + gst + ')';
    return 'Cost / ' + unit + ' (' + gst + ')';
  }
  function refreshQuote() {
    if (!curQ || !qTotals) return;
    const pres = QUOTE.presentation(curQ);
    const p = pres.priced;
    if (qStatus) qStatus.textContent = pres.stage === 'final' ? 'Final quote' : 'Provisional estimate';
    document.querySelectorAll('#qStage button').forEach(b => b.classList.toggle('on', b.dataset.stage === pres.stage));
    const nw = document.getElementById('qNumWarn');
    if (nw) { const w = numberWarning(quotes, curQ); nw.textContent = w; nw.style.color = w ? 'var(--amber)' : ''; }
    qTotals.innerHTML = '';
    const rows = [];
    if (!curQ.basis) rows.push(h('div', { class: 'l' }, h('span', null, 'Choose supply and fix, or labour only')));
    if (p.sellEx != null) {
      rows.push(h('div', { class: 'l' }, h('span', null, 'Cost ex GST (input GST removed)'), h('span', null, moneyOr(p.costEx))));
      rows.push(h('div', { class: 'l' }, h('span', null, 'Sell ex GST  ÷ ' + (1 - Number(curQ.marginPct) / 100).toFixed(2)), h('span', null, moneyOr(p.sellEx))));
      rows.push(h('div', { class: 'l' }, h('span', null, 'GST ' + p.gstPct + '%'), h('span', null, moneyOr(p.gst))));
    }
    rows.push(h('div', { class: 'l big' }, h('span', null, p.complete ? 'Total incl GST' : 'Verified total'), h('span', null, p.complete ? F.money(p.total) : 'Incomplete')));
    qTotals.append(...rows);
    qTotals.append(h('div', { class: 'muted', style: 'color:#d7e2ea;margin-top:6px' }, p.complete ? 'Internal cost and margin are not printed.' : 'Blank quantities and rates are unknown. They are not counted as $0. Cost and margin on this card are not printed.'));
    if (qInternal) {
      qInternal.innerHTML = '';
      QUOTE.internalParagraphs(curQ, p).forEach(t => qInternal.append(h('p', { style: 'margin:0 0 8px' }, t)));
    }
    document.querySelectorAll('[data-line-status]').forEach(el => {
      const parts = el.dataset.lineStatus.split(':');
      const found = parts[0] === 'delivery'
        ? p.lines.find(l => l.key === 'delivery')
        : p.lines.find(l => String(l.roomIndex) === parts[0] && l.key === parts[1]);
      if (!found) return;
      el.textContent = found.status === 'priced' ? F.money(found.sellEx) + ' ex GST' : found.status === 'excluded' ? 'Not in the total' : 'Unknown — not verified';
    });
  }
  function moneyOr(c) { return c == null ? '—' : F.money(c); }
  function renderRooms() {
    if (!qRooms) return; qRooms.innerHTML = '';
    curQ.rooms.forEach((room, ri) => {
      const previousKind = room.kind;
      QUOTE.syncRoomLines(room);
      const linesBox = h('div');
      room.lines.forEach(line => {
        linesBox.append(h('div', { class: 'item' },
          h('div', { class: 'hd', 'data-line-label': ri + ':' + line.key }, line.label),
          line.note ? h('div', { class: 'exnote' }, line.note) : null,
          h('div', { class: 'tag', 'data-line-status': ri + ':' + line.key }, ''),
          line.include ? h('div', { class: 'row' },
            field('Qty (' + line.unit + ')', bind(line, 'qty', { type: 'number', inputmode: 'decimal', step: '0.01', placeholder: 'Unknown' }, changedQuote)),
            field(costLabel(line.unit), bind(line, 'cost', { type: 'number', inputmode: 'decimal', step: '0.01', placeholder: 'Unknown' }, changedQuote)))
            : h('div', { class: 'exnote' }, 'Comparison or conditional line — not in the total unless you select it.')));
      });
      const choice = room.kind === 'bathroom' ? h('div', null, h('div', { class: 'exnote' }, 'One lining only. Fibre cement and 13 mm water-resistant plasterboard are not a double layer.'),
        h('div', { class: 'chips' }, [['fc', 'Fibre cement'], ['wr', '13 mm WR board'], ['exclude', 'Not in this quote']].map(([v, lab]) =>
          h('button', { type: 'button', class: 'chip' + (room.choice === v ? ' on' : ''), onclick: () => { room.choice = v; renderRooms(); changedQuote(); } }, lab)))) : null;
      const balcony = room.kind === 'balcony' ? h('button', { type: 'button', class: 'chip' + (room.suitabilityConfirmed ? ' on' : ''), onclick: () => { room.suitabilityConfirmed = !room.suitabilityConfirmed; renderRooms(); changedQuote(); } }, room.suitabilityConfirmed ? 'Manufacturer suitability confirmed' : 'Manufacturer suitability not confirmed') : null;
      const showRetain = room.zone === 'existing' && room.kind !== 'balcony';
      qRooms.append(h('div', { class: 'item' },
        h('div', { class: 'hd' }, (room.zone === 'extension' ? 'Extension' : 'Existing') + ' · ' + (room.name || 'Area')),
        h('button', { class: 'x', 'aria-label': 'Remove area', onclick: () => { curQ.rooms.splice(ri, 1); renderRooms(); changedQuote(); } }, '×'),
        field('Area name', bind(room, 'name', { placeholder: 'e.g. Bedroom 2' }, () => { QUOTE.syncRoomLines(room); qRooms.querySelectorAll('[data-line-label^="' + ri + ':"]').forEach(el => { const key = el.dataset.lineLabel.split(':')[1]; const ln = room.lines.find(l => l.key === key); if (ln) el.textContent = ln.label; }); changedQuote(); })),
        h('div', { class: 'row' },
          field('Part of', bind(room, 'zone', { options: [['existing', 'Existing house'], ['extension', 'Proposed extension']] }, () => { if (room.zone === 'extension') room.retain = 'new'; renderRooms(); changedQuote(); })),
          field('Area type', bind(room, 'kind', { options: [['standard', 'Standard plasterboard'], ['bathroom', 'Bathroom walls'], ['wet', 'Ensuite / laundry'], ['balcony', 'Balcony ceiling']] }, () => {
            if (room.kind === previousKind) return;
            const typed = room.lines.some(l => (l.qty !== '' && l.qty != null) || (l.cost !== '' && l.cost != null));
            if (typed && !confirm('Change this area type? Quantities that no longer apply will be cleared.')) { room.kind = previousKind; renderRooms(); return; }
            renderRooms(); changedQuote();
          }))),
        showRetain ? field('Existing sheets', bind(room, 'retain', { options: [['unknown', 'Unknown — not verified'], ['keep', 'Keep suitable existing sheets'], ['new', 'New sheets']] }, () => { renderRooms(); changedQuote(); })) : null,
        choice, balcony, linesBox));
    });
    refreshQuote();
  }
  views.quote = main => {
    const q = curQ; QUOTE.normQuote(q);
    if (q.stage === 'final' && QUOTE.finalBlockers(q, QUOTE.priceQuote(q)).length) q.stage = 'provisional';
    header(q._saved ? q.number : 'New quote', () => go('list'));
    qStatus = h('div', { class: 'muted', style: 'text-align:center;margin-top:6px' }, '');
    const stageSeg = h('div', { class: 'seg', id: 'qStage' },
      h('button', { type: 'button', 'data-stage': 'provisional', onclick: () => { q.stage = 'provisional'; changedQuote(); } }, 'Provisional'),
      h('button', { type: 'button', 'data-stage': 'final', onclick: () => {
        const blockers = QUOTE.finalBlockers(q, QUOTE.priceQuote(q));
        if (blockers.length) { alert('Not marked final:\n\n' + blockers.join('\n\n')); q.stage = 'provisional'; }
        else q.stage = 'final';
        changedQuote();
      } }, 'Final'));
    main.append(h('div', { class: 'card' }, stageSeg, qStatus, h('div', { class: 'exnote' }, 'Final waits until framing is near complete, the supply basis is chosen, included lines have quantities and rates, and the deposit check passes. Blank is unknown, not zero.')));
    const cSel = h('select', { onchange: e => {
      if (e.target.value === '__new') { go('client', { returnToQuote: q }, { force: true }); return; }
      const c = clients.find(x => x.id === e.target.value); q.clientId = c.id; q.client = clone(c); changedQuote();
    } }, clients.map(c => h('option', { value: c.id }, c.name)), h('option', { value: '__new' }, '＋ Add new client…'));
    cSel.value = q.clientId || '';
    main.append(h('div', { class: 'card' }, h('h2', null, 'Client & job'), field('Bill to', cSel),
      h('div', { class: 'exnote' }, 'Invoice rates on the client are not copied into the quote.'),
      field('Job / site', bind(q, 'jobSite', { placeholder: 'Address or site' }, changedQuote)),
      field('Job details (one per line)', bind(q, 'jobLines', { textarea: true, placeholder: 'Existing house and proposed extension\nNo quantities seeded' }, changedQuote))));
    const repaintQuote = () => { const host = $('#view'); host.innerHTML = ''; views.quote(host); changedQuote(); };
    const basisSeg = h('div', { class: 'seg' }, [['supply-fix', 'Supply and fix'], ['labour-only', 'Labour only']].map(([v, lab]) =>
      h('button', { type: 'button', class: q.basis === v ? 'on' : '', onclick: () => { if (q.basis === v) return; q.basis = v; repaintQuote(); } }, lab)));
    main.append(h('div', { class: 'card' }, h('h2', null, 'Basis'), basisSeg,
      h('div', { class: 'exnote' }, 'Required. Supply and fix includes labour and materials. Labour only leaves materials out, including delivery.')));
    main.append(h('div', { class: 'card' }, h('h2', null, 'Quote'),
      h('div', { class: 'row' }, field('Number', bind(q, 'number', { autocapitalize: 'characters' }, changedQuote)), field('Date', bind(q, 'date', { type: 'date' }, changedQuote))),
      h('div', { class: 'muted', id: 'qNumWarn' }),
      h('div', { class: 'row' },
        field('True margin %', bind(q, 'marginPct', { type: 'number', inputmode: 'decimal', step: '0.1' }, changedQuote)),
        field('GST %', bind(q, 'gstRate', { type: 'number', inputmode: 'decimal', step: '0.1' }, changedQuote))),
      h('div', { class: 'exnote' }, 'Sell ex GST = cost ex GST ÷ (1 − margin). 15% uses ÷ 0.85. That is not cost × 1.15.'),
      field('Supplier costs', bind(q, 'costGst', { options: [['inclusive', 'GST inclusive — divide by 1.1 first'], ['exclusive', 'Already ex GST']] }, () => { const host = $('#view'); host.innerHTML = ''; views.quote(host); changedQuote(); })),
      field('Deposit requested %', bind(q, 'depositPct', { type: 'number', inputmode: 'decimal', step: '0.1' }, changedQuote)),
      h('button', { type: 'button', class: 'chip' + (q.framingNearComplete ? ' on' : ''), style: 'margin-top:8px', onclick: e => { q.framingNearComplete = !q.framingNearComplete; e.currentTarget.classList.toggle('on', q.framingNearComplete); e.currentTarget.textContent = q.framingNearComplete ? 'Framing is near complete' : 'Framing is not near complete'; changedQuote(); } }, q.framingNearComplete ? 'Framing is near complete' : 'Framing is not near complete')));
    qRooms = h('div');
    main.append(h('div', { class: 'card' }, h('h2', null, 'Takeoff'), h('div', { class: 'exnote' }, 'Compare the existing house with the proposed extension. No measured quantities or supplier rates are stored in the app. Suitable existing sheets stay only when you say so.'),
      qRooms,
      h('div', { class: 'row' },
        h('button', { class: 'btn ghost', onclick: () => { curQ.rooms.push(QUOTE.blankRoom({ id: uid(), zone: 'existing', kind: 'standard' })); renderRooms(); changedQuote(); } }, '＋ Existing'),
        h('button', { class: 'btn ghost', onclick: () => { curQ.rooms.push(QUOTE.blankRoom({ id: uid(), zone: 'extension', kind: 'standard' })); renderRooms(); changedQuote(); } }, '＋ Extension')),
      h('div', { class: 'row' },
        h('button', { class: 'btn ghost', onclick: () => { curQ.rooms.push(QUOTE.blankRoom({ id: uid(), zone: 'extension', kind: 'bathroom', name: 'Bathroom' })); renderRooms(); changedQuote(); } }, '＋ Bathroom walls'),
        h('button', { class: 'btn ghost', onclick: () => { curQ.rooms.push(QUOTE.blankRoom({ id: uid(), zone: 'extension', kind: 'wet', name: 'Ensuite / laundry' })); renderRooms(); changedQuote(); } }, '＋ Wet area')),
      h('button', { class: 'btn ghost', onclick: () => { curQ.rooms.push(QUOTE.blankRoom({ id: uid(), zone: 'extension', kind: 'balcony', name: 'Balcony' })); renderRooms(); changedQuote(); } }, '＋ Balcony ceiling')));
    const delBox = h('div');
    if (q.basis === 'labour-only') delBox.append(h('div', { class: 'exnote' }, 'Delivery is excluded because this quote is labour only.'));
    else delBox.append(h('div', { class: 'row' },
      field('Delivery qty', bind(q.delivery, 'qty', { type: 'number', inputmode: 'decimal', step: '1', placeholder: 'Unknown' }, changedQuote)),
      field(costLabel('each'), bind(q.delivery, 'cost', { type: 'number', inputmode: 'decimal', step: '0.01', placeholder: 'Unknown' }, changedQuote))),
      h('div', { class: 'tag', 'data-line-status': 'delivery' }, ''));
    main.append(h('div', { class: 'card' }, h('h2', null, 'Delivery'), delBox));
    main.append(h('div', { class: 'card' }, h('h2', null, 'Unplanned patching'),
      h('div', { class: 'exnote' }, 'Excluded from the fixed scope. The rate includes labour and material. Work only after written approval. Leave blank if the rate is unknown — blank is not $0.'),
      field('Approved rate $/hr ex GST', bind(q.patch, 'rate', { type: 'number', inputmode: 'decimal', step: '0.01', placeholder: 'Unknown' }, changedQuote))));
    qInternal = h('div');
    const offChip = h('button', { type: 'button', class: 'chip' + (q.compliance.offSiteMajority ? ' on' : ''), onclick: e => { q.compliance.offSiteMajority = !q.compliance.offSiteMajority; e.currentTarget.classList.toggle('on', q.compliance.offSiteMajority); changedQuote(); } }, 'Off-site work is more than half the price');
    main.append(h('div', { class: 'card warn' }, h('b', null, 'Deposit check — internal only'), qInternal,
      field('Contract class', bind(q.compliance, 'contractClass', { options: [['unverified', 'Not verified — final locked'], ['regulated', 'Regulated domestic contract'], ['outside', 'Privately verified as outside these rules']] }, changedQuote)),
      h('div', { style: 'height:8px' }), offChip,
      field('Private note (not printed)', bind(q.compliance, 'privateNote', { textarea: true, placeholder: 'Why this contract is outside the regulated domestic deposit rules. Kept on this phone. Never printed.' }, changedQuote))));
    const attBox = h('div');
    const renderQAtt = () => {
      attBox.innerHTML = '';
      q.atts.forEach((a, i) => {
        const img = h('img', { class: 'thumb', alt: '' }); getFile(a.id).then(f => { if (f) img.src = f.dataUrl; });
        attBox.append(h('div', { class: 'item clearfix' }, img,
          h('button', { class: 'x', 'aria-label': 'Remove photo', onclick: () => { if (!confirm('Remove this photo?')) return; q.atts.splice(i, 1); renderQAtt(); changedQuote(); } }, '×'),
          field('Type', bind(a, 'kind', { options: [['photo', 'Site photo'], ['plan', 'Plan or sketch'], ['other', 'Other']] }, changedQuote)),
          a.kind === 'other' ? field('Title', bind(a, 'title', { placeholder: 'Title' }, changedQuote)) : null,
          field('Caption (optional)', bind(a, 'caption', {}, changedQuote))));
      });
    };
    renderQAtt();
    const qFile = h('input', { type: 'file', accept: 'image/*', multiple: true, style: 'display:none', onchange: async e => {
      const files = [...e.target.files]; e.target.value = '';
      for (const f of files) {
        try { const im = await loadImage(f); const id = uid(); await putFile(Object.assign({ id }, im)); q.atts.push({ id, kind: 'photo', title: '', caption: '' }); }
        catch (err) { alert('Could not read that photo: ' + err.message); }
      }
      renderQAtt(); changedQuote();
    } });
    main.append(h('div', { class: 'card' }, h('h2', null, 'Photos'), h('div', { class: 'exnote' }, 'Added as extra pages. Stored only on this phone.'), attBox, qFile,
      h('button', { class: 'btn ghost', onclick: () => qFile.click() }, '📷 Add photo')));
    qTotals = h('div');
    main.append(h('div', { class: 'card totals' }, qTotals));
    renderRooms();
    main.append(h('button', { class: 'btn red', onclick: makeQuotePdf }, 'Create PDF'));
    main.append(h('button', { class: 'btn navy', onclick: () => { if (persistQuote()) { const host = $('#view'); host.innerHTML = ''; views.quote(host); } } }, q._saved ? 'Save' : 'Save quote'));
    if (q._saved) main.append(h('div', { class: 'row' },
      h('button', { class: 'btn ghost', onclick: () => duplicateQuote(q) }, 'Duplicate'),
      h('button', { class: 'btn ghost', style: 'color:#c0302a', onclick: () => { if (!confirm('Delete ' + q.number + "? This can't be undone.")) return; quotes = quotes.filter(x => x.id !== q.id); saveQ(); q.atts.forEach(a => delFile(a.id)); dirtyQ = false; curQ = null; go('list'); toast('Deleted'); } }, 'Delete')));
  };
  function duplicateQuote(src) {
    curQ = clone(src);
    Object.assign(curQ, { id: uid(), number: S.nextQuoteNumber || 'Q00001', date: today(), stage: 'provisional', framingNearComplete: false, atts: [], created: Date.now(), _saved: false });
    curQ.compliance = { contractClass: 'unverified', offSiteMajority: false, privateNote: '' };
    QUOTE.normQuote(curQ); dirtyQ = true; go('quote', null, { force: true }); toast('Copy made — final and the deposit check were reset');
  }
  async function makeQuotePdf() {
    if (!curQ.basis) { alert('Choose supply and fix, or labour only, before making a PDF.'); return; }
    if (persistQuote(true) === false) return;
    const pres = QUOTE.presentation(curQ);
    toast(pres.stage === 'final' ? 'Making final quote PDF…' : 'Making provisional estimate…');
    const atts = [];
    for (const a of curQ.atts) { const f = await getFile(a.id); if (f) atts.push(Object.assign({}, a, f)); }
    let logo = null; try { logo = await getLogo(); } catch (e) {}
    const doc = QUOTE.build(curQ, S, atts, logo);
    const blob = doc.output('blob');
    const name = `${(S.tradingName || 'ADL').replace(/\s+/g, '')}-${curQ.number}${curQ.client && curQ.client.name ? '-' + curQ.client.name.split(' ')[0] : ''}.pdf`;
    go('qpdf', { blob, name, pages: doc.getNumberOfPages(), stage: pres.stage });
  }
  views.qpdf = (main, arg) => {
    const q = curQ; header(q.number, () => { const host = $('#view'); go('quote'); });
    const file = new File([arg.blob], arg.name, { type: 'application/pdf' });
    const url = URL.createObjectURL(arg.blob);
    window.__lastPdf = arg.blob;
    const canShare = navigator.canShare && navigator.canShare({ files: [file] });
    main.append(h('div', { class: 'card', style: 'text-align:center' },
      h('div', { style: 'font-size:46px' }, '📄'),
      h('div', { style: 'font-weight:700;font-size:18px' }, arg.name),
      h('div', { class: 'muted' }, `${arg.stage === 'final' ? 'Final quote' : 'Provisional estimate'} · ${arg.pages} page${arg.pages > 1 ? 's' : ''} · ${(arg.blob.size / 1024).toFixed(0)} KB`)));
    const dl = () => { const a = h('a', { href: url, download: arg.name }); document.body.append(a); a.click(); a.remove(); };
    main.append(h('button', { class: 'btn red', onclick: async () => {
      if (!canShare) { dl(); return; }
      try { await navigator.share({ files: [file], title: arg.name }); } catch (e) { if (e.name !== 'AbortError') dl(); }
    } }, canShare ? 'Share PDF file' : 'Download PDF'));
    main.append(h('a', { class: 'btn navy', href: url, target: '_blank', rel: 'noopener' }, 'Preview PDF'));
    if (canShare) main.append(h('button', { class: 'btn ghost', onclick: dl }, 'Download instead'));
    main.append(h('div', { class: 'exnote', style: 'text-align:center' }, 'No client message is attached. The internal deposit check is not in the file.'));
    main.append(h('button', { class: 'btn ghost', onclick: () => go('list') }, 'Done'));
  };

  /* ---------- clients ---------- */
  views.clients = main => {
    header('Clients');
    clients.forEach(c => main.append(h('div', { class: 'inv', onclick: () => go('client', { id: c.id }) },
      h('div', { class: 'm' }, h('div', { class: 'n' }, c.name), h('div', { class: 'c' }, [pricingLabel(c.pricing), (c.address || '').split('\n').pop()].filter(Boolean).join(' · '))), h('div', { class: 'muted' }, '›'))));
    main.append(h('button', { class: 'btn', onclick: () => go('client', {}) }, '＋ Add client'));
  };
  views.client = (main, arg) => {
    const ret = arg && arg.returnToEdit ? arg.returnToEdit : null;
    const retQ = arg && arg.returnToQuote ? arg.returnToQuote : null;
    const existing = arg && arg.id ? clients.find(c => c.id === arg.id) : null;
    const c = existing ? clone(existing) : { id: uid(), name: '', attention: '', address: '', abn: '', phone: '', email: '' };
    if (!c.pricing) c.pricing = { type: 'hourly', rate: Number(S.rate) || 65 };
    const pBox = h('div');
    const renderP = () => { const P = c.pricing; pBox.innerHTML = '';
      pBox.append(field('Pricing type', bind(P, 'type', { options: [['hourly', 'Hourly rate'], ['day', 'Day rate']] }, () => { if (P.type === 'day') { P.half = P.half || 450; P.full = P.full || 900; } else P.rate = P.rate || Number(S.rate) || 65; renderP(); })),
        P.type === 'day' ? h('div', { class: 'row' }, field('Half day $', bind(P, 'half', { type: 'number', inputmode: 'decimal', step: '0.01' })), field('Full day $', bind(P, 'full', { type: 'number', inputmode: 'decimal', step: '0.01' })))
          : field('Hourly rate $', bind(P, 'rate', { type: 'number', inputmode: 'decimal', step: '0.01' })),
        h('div', { class: 'muted', style: 'margin-top:6px' }, 'Per tradesperson, ex GST. GST 10% is added on labour.')); };
    renderP();
    const back = () => { if (ret) { cur = ret; dirty = true; go('edit'); } else if (retQ) { curQ = retQ; dirtyQ = true; listMode = 'quotes'; go('quote'); } else go('clients'); };
    header(existing ? 'Edit client' : 'New client', back);
    main.append(h('div', { class: 'card' },
      field('Business name', bind(c, 'name', { placeholder: 'e.g. Inlink Constructions' })),
      field('Attention', bind(c, 'attention', { placeholder: 'Contact person' })),
      field('Address', bind(c, 'address', { textarea: true, placeholder: 'Street\nSuburb QLD 4000' })),
      field('ABN', bind(c, 'abn', { inputmode: 'numeric' })),
      h('div', { class: 'row' }, field('Phone', bind(c, 'phone', { type: 'tel' })), field('Email', bind(c, 'email', { type: 'email' })))),
      h('div', { class: 'card' }, h('h2', null, 'Pricing'), pBox));
    main.append(h('button', { class: 'btn', onclick: () => {
      if (!c.name.trim()) { alert('Enter a business name'); return; }
      const i = clients.findIndex(x => x.id === c.id); if (i >= 0) clients[i] = c; else clients.push(c); saveC(); toast('Client saved');
      if (ret) { ret.clientId = c.id; ret.client = clone(c); ret.pricing = pricingFor(c); cur = ret; dirty = true; go('edit'); }
      else if (retQ) { retQ.clientId = c.id; retQ.client = clone(c); curQ = retQ; dirtyQ = true; listMode = 'quotes'; go('quote'); }
      else go('clients');
    } }, 'Save client'));
    if (existing && !ret && !retQ) main.append(h('button', { class: 'btn ghost', style: 'color:#c0302a', onclick: () => { if (confirm('Delete ' + c.name + '? Existing invoices keep their copy.')) { clients = clients.filter(x => x.id !== c.id); saveC(); go('clients'); } } }, 'Delete client'));
  };

  /* ---------- settings ---------- */
  views.settings = main => {
    header('Settings');
    const s = S; const ch = () => saveS();
    main.append(h('div', { class: 'card' }, h('h2', null, 'Invoicing'),
      h('div', { class: 'row' }, field('Rate $/hr (+GST)', bind(s, 'rate', { type: 'number', inputmode: 'decimal', step: '0.01' }, ch)), field('GST %', bind(s, 'gstRate', { type: 'number', inputmode: 'decimal' }, ch))),
      h('div', { class: 'row' }, field('Next invoice no.', bind(s, 'nextNumber', { autocapitalize: 'characters' }, ch)), field('Due', bind(s, 'due', {}, ch))),
      h('div', { class: 'row' }, field('Usual start', bind(s, 'defStart', { type: 'time' }, ch)), field('Usual finish', bind(s, 'defFinish', { type: 'time' }, ch))),
      field('Parking note', bind(s, 'expenseNote', { textarea: true }, ch)),
      field('Share message ({name} {number} {total})', bind(s, 'shareText', { textarea: true }, ch))));
    main.append(h('div', { class: 'card' }, h('h2', null, 'Quoting'),
      h('div', { class: 'row' }, field('Next quote no.', bind(s, 'nextQuoteNumber', { autocapitalize: 'characters' }, ch)), field('Margin %', bind(s, 'quoteMarginPct', { type: 'number', inputmode: 'decimal', step: '0.1' }, ch))),
      h('div', { class: 'row' }, field('Deposit requested %', bind(s, 'quoteDepositPct', { type: 'number', inputmode: 'decimal', step: '1' }, ch)), field('Supplier costs', bind(s, 'quoteCostGst', { options: [['inclusive', 'GST inclusive'], ['exclusive', 'GST exclusive']] }, ch))),
      h('div', { class: 'muted' }, 'Quote numbers are separate from invoice numbers. Sell = cost ex GST ÷ (1 − margin). 15% is ÷ 0.85, not a 15% markup. Inclusive supplier costs have GST taken off (÷ 1.1) first. The deposit % is only a request. Each quote has its own internal check before it can be final.')));
    main.append(h('div', { class: 'card' }, h('h2', null, 'Business'),
      field('Trading name', bind(s, 'tradingName', {}, ch)), field('Your name', bind(s, 'legalName', {}, ch)),
      field('Address', bind(s, 'address', { textarea: true }, ch)), field('ABN', bind(s, 'abn', {}, ch)),
      h('div', { class: 'row' }, field('Phone', bind(s, 'phone', { type: 'tel' }, ch)), field('Email', bind(s, 'email', { type: 'email' }, ch))),
      field('Supplier line', bind(s, 'supplierLine', {}, ch))));
    main.append(h('div', { class: 'card' }, h('h2', null, 'Bank details'),
      field('Payee', bind(s, 'payee', {}, ch)), field('Bank', bind(s, 'bank', {}, ch)),
      h('div', { class: 'row' }, field('BSB', bind(s, 'bsb', { inputmode: 'numeric' }, ch)), field('Account', bind(s, 'account', { inputmode: 'numeric' }, ch))),
      h('button', { class: 'btn', onclick: () => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); main.querySelectorAll('input,textarea,select').forEach(el => el.dispatchEvent(new Event('change'))); try { saveS(); toast('Settings saved ✓'); } catch (e) { alert('Could not save settings: ' + e.message + '. If you are in Private Browsing, switch it off.'); } } }, 'Save settings')));
    const imp = h('input', { type: 'file', accept: 'application/json,.json', style: 'display:none', onchange: async e => {
      const f = e.target.files[0]; e.target.value = ''; if (!f) return;
      try {
        const data = JSON.parse(await f.text()); if (!data || !data.invoices) throw new Error('Not an ADL backup file');
        const qCount = Array.isArray(data.quotes) ? data.quotes.length : null;
        const qMsg = qCount == null ? ' Quotes already on this phone are kept.' : ` Quotes on this phone (${quotes.length}) are replaced with ${qCount}.`;
        if (!confirm(`Restore backup from ${data.exported || 'file'}? This replaces ${invoices.length} invoice(s) on this phone with ${data.invoices.length}.${qMsg}`)) return;
        S = Object.assign(clone(DEF_SETTINGS), data.settings || {}); clients = data.clients || []; invoices = data.invoices || [];
        if (Array.isArray(data.quotes)) quotes = data.quotes;
        saveS(); saveC(); saveI(); saveQ(); for (const fl of (data.files || [])) await putFile(fl);
        toast('Backup restored'); go('list');
      } catch (err) { alert('Could not restore: ' + err.message); }
    } });
    main.append(h('div', { class: 'card' }, h('h2', null, 'Backup'), h('div', { class: 'muted' }, 'Everything is stored only on this phone. Save a backup to Files or email it to yourself now and then.'),
      h('button', { class: 'btn', onclick: exportBackup }, 'Export backup'), imp, h('button', { class: 'btn ghost', onclick: () => imp.click() }, 'Restore from backup')));
    main.append(h('div', { class: 'muted', style: 'text-align:center;margin-top:16px' }, 'ADL Invoices · works offline · v2'));
  };
  async function exportBackup() {
    const files = await allFiles();
    const used = new Set();
    invoices.forEach(i => (i.atts || []).forEach(a => used.add(a.id)));
    quotes.forEach(q => (q.atts || []).forEach(a => used.add(a.id)));
    const data = { app: 'adl-invoice', version: 2, exported: new Date().toISOString(), settings: S, clients, invoices, quotes, files: files.filter(f => used.has(f.id)) };
    const name = `adl-invoices-backup-${today()}.json`;
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const file = new File([blob], name, { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e.name === 'AbortError') return; } }
    const a = h('a', { href: URL.createObjectURL(blob), download: name }); document.body.append(a); a.click(); a.remove();
  }

  window.addEventListener('beforeunload', e => { if ((dirty && cur && !cur._saved) || (dirtyQ && curQ && !curQ._saved)) { e.preventDefault(); e.returnValue = ''; } });
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
  go('list');
})();
