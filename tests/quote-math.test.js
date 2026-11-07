const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const test = require('node:test');

const sandbox = {};
sandbox.window = sandbox;
sandbox.console = console;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync('pdf.js', 'utf8'), sandbox);
vm.runInContext(fs.readFileSync('quote.js', 'utf8'), sandbox);
const { INV, QUOTE } = sandbox;

function quote(partial) {
  return Object.assign({
    number: 'Q00001', date: '2026-11-06', basis: 'supply-fix', stage: 'provisional',
    marginPct: 15, gstRate: 10, costGst: 'inclusive', depositPct: 50,
    framingNearComplete: false,
    compliance: { contractClass: 'unverified', offSiteMajority: false, privateNote: '' },
    rooms: [], delivery: { include: true, qty: '', cost: '' }, patch: { rate: '' },
    client: { name: 'Example Client' }, jobSite: 'EXAMPLE ONLY — not a real job'
  }, partial);
}

test('invoice regression 25.5h × $65 + GST + $28 parking', () => {
  const T = INV.totals({
    pricing: { type: 'hourly', rate: 65 }, gstRate: 10,
    days: [{ hours: 25.5, trades: 1 }],
    expenses: [{ amount: 28 }]
  });
  assert.strictEqual(T.labour, 165750);
  assert.strictEqual(T.gst, 16575);
  assert.strictEqual(T.exp, 2800);
  assert.strictEqual(T.total, 185125);
  assert.strictEqual(INV.F.money(T.total), '$1,851.25');
});

test('half and full day rates for 2 tradespeople', () => {
  const T = INV.totals({
    pricing: { type: 'day', half: 450, full: 900 }, gstRate: 10,
    days: [{ dayType: 'half', trades: 2, hours: 4 }, { dayType: 'full', trades: 2, hours: 8 }]
  });
  assert.strictEqual(T.lines[0].amt, 90000);
  assert.strictEqual(T.lines[1].amt, 180000);
  assert.strictEqual(T.labour, 270000);
  assert.strictEqual(T.gst, 27000);
  assert.strictEqual(T.total, 297000);
  assert.strictEqual(INV.F.money(T.lines[0].amt), '$900.00');
  assert.strictEqual(INV.F.money(T.lines[1].amt), '$1,800.00');
});

test('true margin, input GST and unknown versus zero', () => {
  const room = QUOTE.blankRoom({ id: 'b', kind: 'bathroom', zone: 'extension', name: 'Bathroom', choice: 'fc' });
  assert.strictEqual(room.lines.filter(l => l.include).length, 1);
  assert.ok(room.lines.some(l => l.key === 'wr' && !l.include));
  room.lines.find(l => l.key === 'fc').qty = 1;
  room.lines.find(l => l.key === 'fc').cost = 110;
  const priced = QUOTE.priceQuote(quote({
    rooms: [room], delivery: { include: true, qty: 1, cost: 0 }, patch: { rate: 80 }
  }));
  const fc = priced.lines.find(l => l.key === 'fc');
  const wr = priced.lines.find(l => l.key === 'wr');
  assert.strictEqual(fc.status, 'priced');
  assert.strictEqual(fc.costEx, 10000);
  assert.strictEqual(fc.sellEx, 11765);
  assert.notStrictEqual(fc.sellEx, 11500);
  assert.strictEqual(wr.status, 'excluded');
  assert.strictEqual(priced.sellEx, 11765);
  assert.strictEqual(priced.gst, 1177);
  assert.strictEqual(priced.total, 12942);
  assert.strictEqual(priced.complete, true);

  const excl = QUOTE.priceQuote(quote({
    costGst: 'exclusive', rooms: [QUOTE.blankRoom({ id: 'b2', kind: 'bathroom', zone: 'extension', choice: 'fc', lines: [] })],
    delivery: { include: true, qty: 1, cost: 0 }
  }));
  const fc2 = excl.lines.find(l => l.key === 'fc');
  fc2.qty = 1; fc2.cost = 100;
  const again = QUOTE.priceQuote(quote({
    costGst: 'exclusive',
    rooms: [Object.assign(QUOTE.blankRoom({ id: 'b3', kind: 'bathroom', zone: 'extension', choice: 'fc' }), {})],
    delivery: { include: true, qty: 1, cost: 0 }
  }));
  again.lines.find(l => l.key === 'fc');
  const roomEx = QUOTE.blankRoom({ id: 'b4', kind: 'bathroom', zone: 'extension', choice: 'fc' });
  roomEx.lines.find(l => l.key === 'fc').qty = 1;
  roomEx.lines.find(l => l.key === 'fc').cost = 100;
  const ex = QUOTE.priceQuote(quote({ costGst: 'exclusive', rooms: [roomEx], delivery: { include: true, qty: 1, cost: 0 } }));
  assert.strictEqual(ex.lines.find(l => l.key === 'fc').sellEx, 11765);

  const zeroMargin = QUOTE.blankRoom({ id: 'z', kind: 'bathroom', zone: 'extension', choice: 'fc' });
  zeroMargin.lines.find(l => l.key === 'fc').qty = 1;
  zeroMargin.lines.find(l => l.key === 'fc').cost = 110;
  const noAdd = QUOTE.priceQuote(quote({ marginPct: 0, rooms: [zeroMargin], delivery: { include: false, qty: '', cost: '' } }));
  assert.strictEqual(noAdd.total, 11000);

  const unknownRoom = QUOTE.blankRoom({ id: 'u', kind: 'bathroom', zone: 'extension', choice: 'fc' });
  unknownRoom.lines.find(l => l.key === 'fc').qty = '';
  unknownRoom.lines.find(l => l.key === 'fc').cost = 110;
  const unknown = QUOTE.priceQuote(quote({ rooms: [unknownRoom], delivery: { include: false } }));
  assert.strictEqual(unknown.lines.find(l => l.key === 'fc').status, 'unknown');
  assert.strictEqual(unknown.total, null);
  assert.strictEqual(unknown.complete, false);

  const zeroRoom = QUOTE.blankRoom({ id: 'o', kind: 'bathroom', zone: 'extension', choice: 'fc' });
  zeroRoom.lines.find(l => l.key === 'fc').qty = 0;
  zeroRoom.lines.find(l => l.key === 'fc').cost = 110;
  const zero = QUOTE.priceQuote(quote({ rooms: [zeroRoom], delivery: { include: false } }));
  assert.strictEqual(zero.lines.find(l => l.key === 'fc').status, 'priced');
  assert.strictEqual(zero.lines.find(l => l.key === 'fc').sellEx, 0);
});

test('bathroom linings stay mutually exclusive and wet areas are 13 mm WR', () => {
  for (const choice of ['', 'fc', 'wr', 'exclude']) {
    const room = QUOTE.blankRoom({ kind: 'bathroom', choice, name: 'Bathroom' });
    const on = room.lines.filter(l => l.include);
    assert.ok(on.length <= 1, choice);
    assert.strictEqual(room.lines.length, 2);
  }
  const wet = QUOTE.blankRoom({ kind: 'wet', zone: 'existing', name: 'Laundry', retain: 'keep' });
  assert.ok(wet.lines.every(l => l.label.includes('13 mm water-resistant plasterboard')));
  assert.ok(wet.lines.every(l => !/fibre cement/i.test(l.label)));
  assert.ok(wet.lines.some(l => /retained/i.test(l.note)));
  const std = QUOTE.blankRoom({ kind: 'standard', zone: 'existing', retain: 'unknown', name: 'Bedroom' });
  assert.ok(std.lines.some(l => l.key === 'cornice'));
  assert.ok(std.lines.some(l => l.key === 'setting'));
  assert.ok(std.lines.some(l => /do not enter zero/i.test(l.note)));
  const balcony = QUOTE.blankRoom({ kind: 'balcony', name: 'Balcony', suitabilityConfirmed: false });
  assert.strictEqual(balcony.lines[0].include, false);
  assert.ok(/exterior exposure/i.test(balcony.lines[0].note));
});

test('labour-only drops delivery and does not price it as zero', () => {
  const room = QUOTE.blankRoom({ kind: 'standard', zone: 'extension', name: 'Rumpus' });
  room.lines.forEach(l => { l.qty = 1; l.cost = 110; });
  const priced = QUOTE.priceQuote(quote({
    basis: 'labour-only', rooms: [room], delivery: { include: true, qty: 5, cost: 500 }
  }));
  const delivery = priced.lines.find(l => l.key === 'delivery');
  assert.strictEqual(delivery.status, 'excluded');
  assert.strictEqual(priced.sellEx, 11765 * 4);
});

test('deposit gate blocks an uncertified 50% final on regulated work', () => {
  function ready(extra) {
    const room = QUOTE.blankRoom({ kind: 'bathroom', zone: 'extension', choice: 'fc', name: 'Bathroom' });
    room.lines.find(l => l.key === 'fc').qty = 1;
    room.lines.find(l => l.key === 'fc').cost = 110;
    return quote(Object.assign({
      framingNearComplete: true, basis: 'supply-fix', stage: 'final',
      rooms: [room], delivery: { include: true, qty: 1, cost: 0 }
    }, extra));
  }
  const regulated = ready({ depositPct: 50, compliance: { contractClass: 'regulated', offSiteMajority: false, privateNote: '' } });
  const blocked = QUOTE.finalBlockers(regulated);
  assert.ok(blocked.length > 0);
  assert.strictEqual(QUOTE.presentation(regulated).stage, 'provisional');
  assert.ok(/not certified/i.test(blocked.join(' ')));

  const level2Room = QUOTE.blankRoom({ kind: 'standard', zone: 'extension', name: 'House' });
  level2Room.lines.forEach(l => { l.qty = 1; l.cost = 0; });
  level2Room.lines[0].cost = 20000;
  level2Room.lines[0].qty = 1;
  const big = quote({
    framingNearComplete: true, basis: 'supply-fix', stage: 'final', marginPct: 0, costGst: 'exclusive',
    depositPct: 10, rooms: [level2Room], delivery: { include: true, qty: 1, cost: 0 },
    compliance: { contractClass: 'regulated', offSiteMajority: false, privateNote: '' }
  });
  const bigP = QUOTE.priceQuote(big);
  assert.ok(bigP.total >= 2000000);
  assert.strictEqual(QUOTE.depositDecision(big, bigP).ok, false);

  big.depositPct = 5;
  assert.strictEqual(QUOTE.depositDecision(big, QUOTE.priceQuote(big)).ok, true);
  big.compliance.offSiteMajority = true;
  big.depositPct = 20;
  assert.strictEqual(QUOTE.depositDecision(big, QUOTE.priceQuote(big)).ok, true);
  big.depositPct = 21;
  assert.strictEqual(QUOTE.depositDecision(big, QUOTE.priceQuote(big)).ok, false);

  const small = ready({ depositPct: 20, marginPct: 0, compliance: { contractClass: 'regulated', offSiteMajority: false, privateNote: '' } });
  assert.strictEqual(QUOTE.depositDecision(small, QUOTE.priceQuote(small)).ok, true);
  small.depositPct = 50;
  assert.strictEqual(QUOTE.depositDecision(small, QUOTE.priceQuote(small)).ok, false);

  const unverified = ready({ depositPct: 5 });
  assert.strictEqual(QUOTE.depositDecision(unverified, QUOTE.priceQuote(unverified)).ok, false);

  const outside = ready({
    depositPct: 50,
    compliance: { contractClass: 'outside', offSiteMajority: false, privateNote: 'PRIVATE-SENTINEL subcontract, not a regulated domestic contract' }
  });
  assert.strictEqual(QUOTE.depositDecision(outside, QUOTE.priceQuote(outside)).ok, true);
  assert.strictEqual(QUOTE.finalBlockers(outside).length, 0);
  const model = QUOTE.clientModel(outside);
  assert.strictEqual(model.stage, 'final');
  const plain = QUOTE.clientPlain(model);
  assert.ok(!plain.includes('PRIVATE-SENTINEL'));
  assert.ok(!/QBCC|Schedule 1B|margin|nonpayment|non-payment|registered/i.test(plain));
  assert.ok(plain.includes('Deposit requested: 50%'));
  assert.ok(!/not a final quote/i.test(plain));

  const internal = QUOTE.internalParagraphs(regulated).join('\n');
  assert.ok(internal.includes('section 33'));
  assert.ok(internal.includes('$20,000'));
  assert.ok(/not a legal certification/i.test(internal));
  assert.ok(internal.includes('PRIVATE') === false);
});

test('provisional client text keeps unknowns and the excluded lining out of the money', () => {
  const room = QUOTE.blankRoom({ kind: 'bathroom', zone: 'existing', name: 'Bathroom', choice: '' });
  const model = QUOTE.clientModel(quote({ rooms: [room], basis: 'supply-fix' }));
  assert.strictEqual(model.stage, 'provisional');
  assert.ok(/not treated as zero/i.test(model.banner));
  assert.ok(/subject to the contract/i.test(model.depositText));
  const plain = QUOTE.clientPlain(model);
  assert.ok(/not a double layer|not a second layer|Neither is included/i.test(plain));
  assert.ok(/Unplanned patching/i.test(plain));
  assert.ok(!/QBCC|Schedule|margin|registered/i.test(plain));
});

test('service worker caches quote.js and checks the network first', () => {
  const sw = fs.readFileSync('sw.js', 'utf8');
  assert.ok(sw.includes("const CACHE = 'adl-invoice-v9'"));
  assert.ok(sw.includes('./quote.js'));
  const re = /\/(index\.html|app\.js|pdf\.js|quote\.js|styles\.css|manifest\.json)?$/;
  assert.ok(re.test('/adl-invoice/quote.js'));
  assert.ok(re.test('/quote.js'));
  assert.ok(!re.test('/adl-invoice/vendor/jspdf.umd.min.js'));
});

function sumsImport(over) {
  const quote = Object.assign({
    importKey: 'example-sums-1', number: 'Q-EXAMPLE-1', date: '2026-11-07', pricingMode: 'sums', stage: 'provisional', basis: '',
    framingNearComplete: false, jobSite: 'Example Street', jobLines: 'Draft package only.',
    client: { name: '', attention: '', address: '', abn: '', phone: '', email: '' },
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
  }, over || {});
  if (over && over.alternatives) quote.alternatives = over.alternatives;
  return { documentType: 'adl-quote-import', schemaVersion: 1, quote };
}
test('sums-only alternatives stay unadded and selling totals are not remargined', () => {
  const parsed = QUOTE.readQuoteImport(sumsImport());
  assert.strictEqual(parsed.ok, true, (parsed.errors || []).join('; '));
  const q = parsed.quote;
  assert.strictEqual(q.marginPct, 0);
  assert.strictEqual(QUOTE.sumsFigures(q).selectedCount, 0);
  assert.strictEqual(QUOTE.priceQuote(q).total, null);
  assert.strictEqual(QUOTE.presentation(q).stage, 'provisional');
  const plain = QUOTE.sumsPlain(QUOTE.sumsClientModel(q));
  assert.ok(plain.includes('No option is selected'));
  assert.ok(plain.includes('$1,100.00'));
  assert.ok(plain.includes('$2,200.00'));
  assert.ok(!/qty|unit rate|hours|material list/i.test(plain));
  assert.ok(!plain.includes('PRIVATE-SENTINEL'));
  q.alternatives[0].selected = true;
  const f = QUOTE.sumsFigures(q);
  assert.strictEqual(f.sellEx, 100000);
  assert.strictEqual(f.gst, 10000);
  assert.strictEqual(f.total, 110000);
  const stages = QUOTE.stageAmounts(f.total, q.paymentSchedule);
  assert.strictEqual(stages.reduce((s, x) => s + x.cents, 0), f.total);
  assert.strictEqual(stages.map(s => s.percent).join(','), '30,30,30,10');
  const awkward = QUOTE.stageAmounts(1001, q.paymentSchedule);
  assert.strictEqual(awkward.reduce((s, x) => s + x.cents, 0), 1001);
  q.marginPct = 15;
  QUOTE.normQuote(q);
  assert.strictEqual(QUOTE.sumsFigures(q).total, 110000);
  assert.ok(QUOTE.readQuoteImport({ invoices: [], quotes: [] }).ok === false);
  assert.ok(QUOTE.readQuoteImport(sumsImport({ alternatives: [{ key: 'a', label: 'Bad', sellEx: 10, gst: 1, sellInc: 12, selected: false }] })).ok === false);
  assert.ok(QUOTE.readQuoteImport(sumsImport({ alternatives: [
    { key: 'a', label: 'A', sellEx: 1000, gst: 100, sellInc: 1100, selected: true },
    { key: 'b', label: 'B', sellEx: 2000, gst: 200, sellInc: 2200, selected: true }
  ] })).ok === false);
  const nasty = sumsImport(); nasty.quote.jobSite = '<script>';
  assert.strictEqual(QUOTE.readQuoteImport(nasty).ok, false);
  const inf = sumsImport(); inf.quote.alternatives[0].sellEx = Infinity;
  assert.strictEqual(QUOTE.readQuoteImport(inf).ok, false);
});

test('public defaults stay free of bank numbers and seeded invoices', () => {
  const app = fs.readFileSync('app.js', 'utf8');
  assert.ok(app.includes("bank: '', bsb: '', account: ''"));
  assert.ok(app.includes('nextNumber: \'INV00083\''));
  assert.ok(app.includes('nextQuoteNumber: \'Q00001\''));
  assert.ok(app.includes("rate: 65"));
  assert.ok(app.includes('half: 450, full: 900'));
  assert.ok(app.includes('rate: 95'));
  assert.ok(!/password|sign in|sign-in/i.test(fs.readFileSync('index.html', 'utf8')));
  assert.ok(app.includes("let quotes = ls.get('quotes', [])"));
  assert.ok(!app.includes('INV00082'));
});
