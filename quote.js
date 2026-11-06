/* ADL Plaster quoting. Same stationery as invoices. No project quantities are seeded.
   Sell uses a true margin: sell ex GST = cost ex GST / (1 - margin). 15% is / 0.85, not x 1.15.
   GST-inclusive costs are divided by 1.1 before that margin. Blank qty or cost is unknown, not zero. */
(function (g) {
  const LAW = {
    reviewed: '6 November 2026',
    act: 'Queensland Building and Construction Commission Act 1991 (Qld), Schedule 1B',
    actAsAt: '1 February 2026',
    depositSection: 'section 33',
    progressSection: 'section 34',
    reg: 'Queensland Building and Construction Commission Regulation 2018, section 45',
    regulatedAmount: 3300,
    level2Amount: 20000,
    qbccPage: 'https://www.qbcc.qld.gov.au/home-owner-hub/build-renovate/contracts-payments/deposits-progress-payments',
    qbccReviewed: '27 June 2025'
  };

  const money = c => g.INV.F.money(c);
  const pctText = n => String(Math.round(Number(n) * 1000) / 1000);

  function blankRoom(partial) {
    const room = Object.assign({
      id: '', zone: 'existing', kind: 'standard', name: '', retain: 'unknown',
      choice: '', suitabilityConfirmed: false, lines: []
    }, partial || {});
    if (room.zone === 'extension' && (!partial || partial.retain == null)) room.retain = 'new';
    return syncRoomLines(room);
  }

  function zoneName(zone) { return zone === 'extension' ? 'Proposed extension' : 'Existing house'; }
  function roomTitle(room) { return zoneName(room.zone) + ' — ' + ((room.name || '').trim() || 'Area'); }

  function retainNote(room) {
    if (room.zone !== 'existing') return '';
    if (room.retain === 'keep') return 'Suitable existing sheets are retained and are not measured as new supply.';
    if (room.retain === 'new') return 'Existing sheets in this area are not being retained.';
    return 'Whether suitable existing sheets can be retained is unknown. Leave the quantity blank until it is measured. Do not enter zero for unknown.';
  }

  function specOf(room) {
    const title = roomTitle(room);
    const keep = retainNote(room);
    if (room.kind === 'bathroom') {
      return [
        { key: 'fc', choice: 'fc', unit: 'm2', role: 'alternative', label: title + ' — fibre cement wall lining', note: 'Alternative to 13 mm water-resistant plasterboard. Not a second layer.' },
        { key: 'wr', choice: 'wr', unit: 'm2', role: 'alternative', label: title + ' — 13 mm water-resistant plasterboard wall lining', note: 'Alternative to fibre cement. Not a second layer.' }
      ];
    }
    if (room.kind === 'wet') {
      return [
        { key: 'walls', unit: 'm2', role: 'scope', label: title + ' — 13 mm water-resistant plasterboard walls', note: keep || 'Ensuite, laundry and other wet areas: 13 mm water-resistant plasterboard. Not fibre cement.' },
        { key: 'ceiling', unit: 'm2', role: 'scope', label: title + ' — 13 mm water-resistant plasterboard ceiling', note: keep || 'Wet-area ceiling in 13 mm water-resistant plasterboard.' }
      ];
    }
    if (room.kind === 'balcony') {
      return [
        { key: 'ceiling', unit: 'm2', role: 'conditional', label: title + ' — balcony ceiling lining', note: 'Included only when the manufacturer confirms the board is suitable for exterior exposure. Otherwise it stays out of the fixed scope. An unknown quantity is not zero.' }
      ];
    }
    return [
      { key: 'walls', unit: 'm2', role: 'scope', label: title + ' — standard plasterboard walls', note: keep },
      { key: 'ceiling', unit: 'm2', role: 'scope', label: title + ' — standard plasterboard ceiling', note: keep },
      { key: 'cornice', unit: 'lm', role: 'scope', label: title + ' — cornice', note: '' },
      { key: 'setting', unit: 'm2', role: 'scope', label: title + ' — setting', note: 'Setting to the sheets in this quote. Unplanned patching is not included.' }
    ];
  }

  function includedByRole(room, spec) {
    if (spec.role === 'alternative') return room.choice === spec.choice;
    if (spec.role === 'conditional') return !!room.suitabilityConfirmed;
    return true;
  }

  function syncRoomLines(room) {
    const spec = specOf(room);
    const prev = new Map((room.lines || []).map(l => [l.key, l]));
    room.lines = spec.map(s => {
      const line = prev.get(s.key) || { key: s.key, qty: '', cost: '' };
      line.key = s.key;
      line.label = s.label;
      line.unit = s.unit;
      line.role = s.role;
      line.note = s.note;
      line.include = includedByRole(room, s);
      if (line.qty == null) line.qty = '';
      if (line.cost == null) line.cost = '';
      return line;
    });
    return room;
  }

  function normQuote(q) {
    if (!q.compliance) q.compliance = { contractClass: 'unverified', offSiteMajority: false, privateNote: '' };
    if (!q.compliance.contractClass) q.compliance.contractClass = 'unverified';
    if (q.compliance.privateNote == null) q.compliance.privateNote = '';
    if (!q.delivery) q.delivery = { include: true, qty: '', cost: '' };
    if (!q.patch) q.patch = { rate: '' };
    if (!q.rooms) q.rooms = [];
    if (q.marginPct == null || q.marginPct === '') q.marginPct = 15;
    if (q.depositPct == null || q.depositPct === '') q.depositPct = 50;
    if (!q.costGst) q.costGst = 'inclusive';
    if (q.gstRate == null || q.gstRate === '') q.gstRate = 10;
    if (!q.basis) q.basis = '';
    if (q.stage !== 'final') q.stage = 'provisional';
    if (q.status !== 'accepted') q.status = '';
    q.rooms.forEach(syncRoomLines);
    return q;
  }

  function numOrNull(v) {
    if (v === '' || v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  function unitExCents(costDollars, basis) {
    const cents = Math.round(Number(costDollars) * 100);
    if (basis === 'inclusive') return Math.round(cents * 10 / 11);
    return cents;
  }

  function priceOne(line, marginPct, basis) {
    if (!line.include) return { status: 'excluded', costEx: null, sellEx: null };
    const qty = numOrNull(line.qty);
    const cost = numOrNull(line.cost);
    if (qty == null || cost == null) return { status: 'unknown', costEx: null, sellEx: null };
    if (qty < 0 || cost < 0) return { status: 'unknown', costEx: null, sellEx: null };
    if (!Number.isFinite(marginPct) || marginPct < 0 || marginPct >= 100) return { status: 'bad-margin', costEx: null, sellEx: null };
    const costEx = Math.round(unitExCents(cost, basis) * qty);
    const sellEx = Math.round(costEx / (1 - marginPct / 100));
    return { status: 'priced', costEx, sellEx };
  }

  function priceQuote(quote) {
    normQuote(quote);
    const marginPct = Number(quote.marginPct);
    const gstPct = Number(quote.gstRate);
    const basis = quote.costGst === 'exclusive' ? 'exclusive' : 'inclusive';
    const marginOk = Number.isFinite(marginPct) && marginPct >= 0 && marginPct < 100;
    const gstOk = Number.isFinite(gstPct) && gstPct >= 0 && gstPct <= 100;
    const raw = [];
    quote.rooms.forEach((room, ri) => {
      room.lines.forEach(line => { line.roomIndex = ri; raw.push(line); });
    });
    const delivery = quote.delivery;
    const deliveryIncluded = quote.basis === 'labour-only' ? false : delivery.include !== false;
    raw.push({
      key: 'delivery',
      label: 'Delivery',
      unit: 'each',
      role: quote.basis === 'labour-only' ? 'excluded-basis' : 'scope',
      note: quote.basis === 'labour-only' ? 'Materials delivery is not included in a labour-only quote.' : 'Delivery for the quoted scope.',
      qty: delivery.qty,
      cost: delivery.cost,
      include: deliveryIncluded
    });

    let costEx = 0, sellEx = 0, unknown = 0, included = 0;
    const lines = raw.map(line => {
      const r = priceOne(line, marginPct, basis);
      if (r.status === 'excluded') return Object.assign({}, line, r);
      included += 1;
      if (r.status === 'priced') { costEx += r.costEx; sellEx += r.sellEx; }
      else unknown += 1;
      return Object.assign({}, line, r);
    });
    const pricedCount = lines.filter(l => l.status === 'priced').length;
    const complete = marginOk && gstOk && included > 0 && unknown === 0 && pricedCount > 0;
    const gst = complete ? Math.round(sellEx * gstPct / 100) : null;
    const total = complete ? sellEx + gst : null;
    const partial = pricedCount > 0 && marginOk && gstOk;
    return {
      lines, costEx: partial ? costEx : null, sellEx: partial ? sellEx : null,
      gst: partial ? Math.round(sellEx * gstPct / 100) : null,
      partialTotal: partial ? sellEx + Math.round(sellEx * gstPct / 100) : null,
      total, complete, unknown, included, pricedCount, marginPct, gstPct, marginOk, gstOk, basis,
      verified: complete
    };
  }

  function bandOf(totalCents) {
    if (totalCents == null) return 'unknown';
    const dollars = totalCents / 100;
    if (dollars <= LAW.regulatedAmount) return 'small';
    if (dollars < LAW.level2Amount) return 'level1';
    return 'level2';
  }

  function capFor(band, offSite) {
    if (band === 'small') return { cap: 20, source: 'QBCC deposits page figure for works at or under $3,300. Not Schedule 1B section 33.' };
    if (band === 'level1' && offSite) return { cap: 20, source: 'Schedule 1B section 33(1)(c) off-site exception, as recorded. Not certified by this app.' };
    if (band === 'level2' && offSite) return { cap: 20, source: 'Schedule 1B section 33(1)(c) off-site exception, as recorded. Not certified by this app.' };
    if (band === 'level1') return { cap: 10, source: 'Schedule 1B section 33(1)(a) level 1, as recorded.' };
    if (band === 'level2') return { cap: 5, source: 'Schedule 1B section 33(1)(b) level 2, as recorded.' };
    return { cap: null, source: '' };
  }

  function depositDecision(quote, priced) {
    normQuote(quote);
    const cls = quote.compliance.contractClass;
    const req = Number(quote.depositPct);
    const finite = Number.isFinite(req) && req >= 0;
    const base = {
      ok: false,
      cap: null,
      band: 'unknown',
      result: 'Deposit applicability is not verified. The request stays provisional. This app does not certify it.'
    };
    if (!finite) return Object.assign(base, { result: 'Deposit percent is not a usable number. Final stays locked.' });
    if (cls === 'outside') {
      const note = String(quote.compliance.privateNote || '').trim();
      if (!note) return Object.assign(base, { result: 'Private verification note is empty. Final stays locked. This app does not certify the deposit.' });
      return {
        ok: true, cap: null, band: 'outside',
        result: 'You recorded a private basis for treating this contract as outside the regulated domestic deposit rules. That note stays on this phone and is not printed. This app has not certified the deposit.'
      };
    }
    if (cls !== 'regulated') return base;
    if (req > 20) {
      return Object.assign(base, {
        band: 'regulated',
        result: 'Requested ' + pctText(req) + '% is above 5%, 10% and 20%. Every recorded figure is 20% or less. Final stays locked while this quote is classed as regulated domestic work. 50% is not certified.'
      });
    }
    const band = bandOf(priced && priced.complete ? priced.total : null);
    if (band === 'unknown') {
      if (req <= 5) {
        return { ok: true, cap: 5, band, result: 'Requested ' + pctText(req) + '% is within 5%, 10% and 20%, so the price band is not needed for the deposit figure. This is not a certification. The price itself still has to be complete before a final quote.' };
      }
      return Object.assign(base, { band, result: 'The price is not complete, so level 1 (10%) and level 2 (5%) cannot be told apart. Final stays locked. This is not a certification.' });
    }
    const off = !!quote.compliance.offSiteMajority && (band === 'level1' || band === 'level2');
    const cap = capFor(band, off);
    if (req > cap.cap) {
      return Object.assign(base, { cap: cap.cap, band, result: 'Requested ' + pctText(req) + '% is above the recorded cap of ' + cap.cap + '% (' + cap.source + '). Lower the request to mark final. This app will not certify ' + pctText(req) + '%.' });
    }
    let extra = '';
    if (band === 'small') extra = ' This total is at or under $3,300, so it is not a level 1 or level 2 contract. The 20% figure here is the QBCC page, not section 33.';
    if (quote.compliance.offSiteMajority && band === 'small') extra += ' The section 33 off-site exception is for level 1 and level 2 contracts, so the tick does not raise this cap.';
    if (off) extra += ' The off-site tick is your statement, not a certification.';
    return { ok: true, cap: cap.cap, band, result: 'Requested ' + pctText(req) + '% is within the recorded cap of ' + cap.cap + '% (' + cap.source + ').' + extra + ' This app has not certified the deposit or the contract.' };
  }

  function internalParagraphs(quote, priced) {
    const d = depositDecision(quote, priced || priceQuote(quote));
    const req = pctText(quote.depositPct);
    const lines = [
      'Internal only. This card is not printed on the quote and it is not a legal certification.',
      'Requested deposit: ' + req + '% before commencement. That request is provisional until the contract class below is filled in.',
      LAW.act + ' ' + LAW.depositSection + ' (consolidation current as at ' + LAW.actAsAt + '): before work starts at the site, a deposit under a regulated contract must not be more than 10% on a level 1 contract, 5% on a level 2 contract, or 20% where off-site work is more than half the contract price.',
      'Level 1 is above the $' + LAW.regulatedAmount.toLocaleString('en-AU') + ' regulated amount and below the level 2 amount. ' + LAW.reg + ' sets the level 2 amount at $' + LAW.level2Amount.toLocaleString('en-AU') + '. QBCC’s deposits page (reviewed ' + LAW.qbccReviewed + ') also states 20% for works valued at $' + LAW.regulatedAmount.toLocaleString('en-AU') + ' or less. Those contracts are not level 1 or level 2, so that 20% figure is not section 33. Checked for this app on ' + LAW.reviewed + '. Confirm the official text again yourself.',
      'A request above 20% is above every one of those figures. This app will not mark a final quote at that request while the quote is classed as regulated domestic work, and it never certifies 50% as legal.',
      LAW.act + ' ' + LAW.progressSection + ' is separate: a claim that is not the permitted deposit has to match on-site progress. That is not printed on the client quote.',
      'This app does not decide whether this job is a regulated domestic building contract. You verify the contract and whether the rules apply before a final client-ready quote.',
      d.result
    ];
    if (priced && priced.complete && quote.compliance.contractClass === 'regulated' && d.cap != null) {
      lines.push('Recorded cap on this total: ' + d.cap + '%. Requested dollars are not printed as a legal maximum.');
    }
    return lines;
  }

  function bathroomBlockers(quote) {
    const out = [];
    (quote.rooms || []).forEach(room => {
      if (room.kind === 'bathroom' && !['fc', 'wr', 'exclude'].includes(room.choice)) {
        out.push((room.name || 'Bathroom') + ': choose fibre cement or 13 mm water-resistant plasterboard, or exclude the walls. They are alternatives, not two layers.');
      }
    });
    return out;
  }

  function finalBlockers(quote, priced) {
    const p = priced || priceQuote(quote);
    const reasons = [];
    if (!quote.framingNearComplete) reasons.push('Framing is not marked near complete. A final quote waits until framing is near complete.');
    if (quote.basis !== 'supply-fix' && quote.basis !== 'labour-only') reasons.push('Choose supply and fix, or labour only.');
    if (!p.marginOk) reasons.push('Margin must be 0 or more and under 100. Sell uses cost ex GST divided by (1 − margin).');
    if (!p.complete) reasons.push('Every included quantity and rate must be filled in. Blank means unknown, not zero.');
    bathroomBlockers(quote).forEach(r => reasons.push(r));
    const dep = depositDecision(quote, p);
    if (!dep.ok) reasons.push(dep.result);
    return reasons;
  }

  function presentation(quote) {
    const priced = priceQuote(quote);
    const blockers = finalBlockers(quote, priced);
    const stage = quote.stage === 'final' && blockers.length === 0 ? 'final' : 'provisional';
    return { priced, blockers, stage };
  }

  function basisText(quote) {
    if (quote.basis === 'supply-fix') return 'This quote is supply and fix (labour and materials).';
    if (quote.basis === 'labour-only') return 'This quote is labour only. Materials are not included.';
    return 'Supply and fix, or labour only, has not been chosen. This is not a quote for either.';
  }

  function patchText(quote) {
    const rate = numOrNull(quote.patch && quote.patch.rate);
    const head = 'Unplanned patching is not part of the fixed scope. It is done only after written approval before the work starts. The approved rate includes labour and material.';
    if (rate == null) return head + ' No hourly rate is recorded. An unknown rate is not $0.';
    return head + ' Recorded rate: ' + money(Math.round(rate * 100)) + ' per hour ex GST, including labour and material. GST is extra.';
  }

  function omissionLines(quote, priced) {
    const out = [];
    priced.lines.forEach(l => {
      if (l.status !== 'excluded') return;
      if (l.key === 'delivery' && quote.basis === 'labour-only') {
        out.push({ label: 'Delivery', reason: 'Not included in a labour-only quote.' });
        return;
      }
      if (l.role === 'alternative') out.push({ label: l.label, reason: 'Not included. ' + (l.note || 'Alternative only.') });
      else if (l.role === 'conditional') out.push({ label: l.label, reason: 'Not in the fixed scope. Manufacturer exterior-exposure suitability is not confirmed.' });
      else if (!l.include) out.push({ label: l.label, reason: 'Not included.' });
    });
    (quote.rooms || []).forEach(room => {
      if (room.kind === 'bathroom' && room.choice === 'exclude') {
        out.push({ label: roomTitle(room) + ' — wall lining', reason: 'Excluded from this quote. Fibre cement and 13 mm water-resistant plasterboard were not both included.' });
      }
      if (room.kind === 'bathroom' && !['fc', 'wr', 'exclude'].includes(room.choice)) {
        out.push({ label: roomTitle(room) + ' — wall lining', reason: 'Not selected. Fibre cement and 13 mm water-resistant plasterboard are alternatives only. Neither is included, and they are not a double layer.' });
      }
    });
    return out;
  }

  function qtyText(line) {
    if (line.status === 'unknown' || line.status === 'bad-margin') return 'Unknown';
    const n = Number(line.qty);
    if (!Number.isFinite(n)) return 'Unknown';
    return String(Math.round(n * 1000) / 1000);
  }

  function amountText(line) {
    if (line.status === 'priced') return money(line.sellEx);
    return 'Not verified';
  }

  function clientModel(quote) {
    const pres = presentation(quote);
    const p = pres.priced;
    const stage = pres.stage;
    const included = p.lines.filter(l => l.status === 'priced' || l.status === 'unknown' || l.status === 'bad-margin');
    let totalsText;
    if (p.complete && stage === 'final') {
      totalsText = 'Sell ex GST ' + money(p.sellEx) + '. GST ' + pctText(p.gstPct) + '% ' + money(p.gst) + '. Total including GST ' + money(p.total) + '.';
    } else if (p.complete) {
      totalsText = 'Priced lines ex GST ' + money(p.sellEx) + '. GST ' + pctText(p.gstPct) + '% ' + money(p.gst) + '. Total including GST ' + money(p.total) + '. Provisional estimate, not a final quote.';
    } else if (p.sellEx != null) {
      totalsText = 'Priced lines so far, ex GST ' + money(p.sellEx) + ', GST ' + money(p.gst) + ', including GST ' + money(p.partialTotal) + '. This is not a verified total. Unknown quantities and rates are omitted. They are not $0.';
    } else {
      totalsText = 'No verified total. Unknown quantities and rates are omitted. They are not $0.';
    }
    const dep = 'Deposit requested: ' + pctText(quote.depositPct) + '% of the total including GST, before commencement.';
    const depositText = stage === 'final'
      ? dep
      : dep + ' Provisional term, subject to the contract. This is not a final quote.';
    return {
      stage,
      title: stage === 'final' ? 'QUOTE' : 'PROVISIONAL ESTIMATE',
      banner: stage === 'final' ? '' : 'Provisional estimate. Not a final quote. Blank quantities and rates are unknown and are not treated as zero.',
      basisText: basisText(quote),
      framingText: stage === 'final' ? 'The operator has marked framing as near complete.' : '',
      lines: included.map(l => ({ label: l.label, qtyText: qtyText(l), unit: l.unit, amountText: amountText(l), note: l.note || '' })),
      omitted: omissionLines(quote, p),
      patchText: patchText(quote),
      totalsText,
      depositText
    };
  }

  function visibleStatus(quote) {
    const pres = presentation(quote);
    if (quote.status === 'accepted' && pres.stage === 'final') return 'accepted';
    return pres.stage;
  }

  function commercialNotes(quote) {
    const pres = presentation(quote);
    const bits = [basisText(quote)];
    const omitted = omissionLines(quote, pres.priced);
    if (omitted.length) bits.push('Not included in the price: ' + omitted.map(o => o.label + ' — ' + o.reason).join(' '));
    bits.push(patchText(quote));
    if (pres.stage === 'final') bits.push('Deposit requested: ' + pctText(quote.depositPct) + '% of the total including GST, before commencement.');
    return bits.filter(Boolean).join('\n');
  }

  function exportPayload(quote) {
    const pres = presentation(quote);
    if (quote.status !== 'accepted' || pres.stage !== 'final') {
      return { ok: false, reason: 'Only an accepted final quote can be exported. A provisional estimate is not accepted scope.' };
    }
    const items = pres.priced.lines.filter(l => l.status === 'priced').map(l => ({
      label: l.label, qty: Number(l.qty), unit: l.unit || '', sellEx: l.sellEx
    }));
    const sellEx = items.reduce((s, it) => s + it.sellEx, 0);
    const gst = Math.round(sellEx * pres.priced.gstPct / 100);
    if (sellEx !== pres.priced.sellEx || gst !== pres.priced.gst || sellEx + gst !== pres.priced.total) {
      return { ok: false, reason: 'Exported lines do not match the quote sell total.' };
    }
    return {
      ok: true, items, sellEx, gst, total: sellEx + gst, gstRate: pres.priced.gstPct,
      notes: commercialNotes(quote),
      client: quote.client || {}, clientId: quote.clientId || '',
      jobSite: quote.jobSite || '', jobLines: quote.jobLines || '',
      supplyBasis: quote.basis, sourceQuoteId: quote.id, sourceQuoteNumber: quote.number
    };
  }

  function buildInvoiceFromQuote(quote, meta) {
    const payload = exportPayload(quote);
    if (!payload.ok) return payload;
    const m = meta || {};
    const pricing = quote.client && quote.client.pricing
      ? JSON.parse(JSON.stringify(quote.client.pricing))
      : { type: 'hourly', rate: m.rate == null ? 65 : m.rate };
    if (pricing.type !== 'day' && (pricing.rate == null || pricing.rate === '')) pricing.rate = m.rate == null ? 65 : m.rate;
    return {
      ok: true,
      payload,
      invoice: {
        id: m.id || '', number: m.number, date: m.date || '', due: m.due || 'On receipt',
        clientId: payload.clientId, client: JSON.parse(JSON.stringify(payload.client || {})),
        jobSite: payload.jobSite, jobLines: payload.jobLines, period: '',
        rate: pricing.rate == null ? (m.rate == null ? 65 : m.rate) : pricing.rate,
        pricing, gstRate: payload.gstRate, days: [], expenses: [],
        supplyItems: payload.items, supplyBasis: payload.supplyBasis, supplyNote: payload.notes,
        flagNote: '', labourNote: '', expenseNote: '',
        sourceQuoteId: payload.sourceQuoteId, sourceQuoteNumber: payload.sourceQuoteNumber,
        atts: [], status: 'unpaid'
      }
    };
  }

  function clientPlain(model) {
    const parts = [model.title, model.banner, model.basisText, model.framingText, model.totalsText, model.depositText, model.patchText];
    model.lines.forEach(l => parts.push(l.label, l.qtyText, l.amountText, l.note));
    model.omitted.forEach(o => parts.push(o.label, o.reason));
    return parts.filter(Boolean).join('\n');
  }

  const C = { navy: [27, 58, 75], blue: [47, 93, 140], light: [244, 247, 248], line: [205, 213, 218], txt: [30, 30, 30], mut: [95, 105, 112], amber: [176, 106, 0], black: [27, 27, 27] };

  function attTitle(a) {
    if (a.title && String(a.title).trim()) return String(a.title).trim();
    if (a.kind === 'plan') return 'Plan or sketch';
    if (a.kind === 'photo') return 'Site photo';
    return 'Supporting document';
  }

  function build(quote, S, atts, logo) {
    const model = clientModel(quote);
    const { jsPDF } = g.jspdf;
    const doc = new jsPDF({ unit: 'pt', format: 'a4', compress: true });
    const W = 595.28, H = 841.89, L = 45.35, R = W - 45.35, BOTTOM = 808;
    const set = (font, size, color) => { doc.setFont('helvetica', font); doc.setFontSize(size); doc.setTextColor(...(color || C.txt)); };
    const fill = c => doc.setFillColor(...c);
    const topBar = () => { fill(C.navy); doc.rect(0, 0, W, 17, 'F'); };
    let y;
    const newPage = () => { doc.addPage(); topBar(); y = 45; };
    const need = h => { if (y + h > BOTTOM) newPage(); };
    const split = (t, w) => doc.splitTextToSize(String(t || ''), w);
    const para = (text, size, color, gap) => {
      if (!text) return;
      set('normal', size || 9, color || C.txt);
      split(text, R - L).forEach(s => { need(12); doc.text(s, L, y); y += (gap || 12); });
    };

    topBar();
    if (logo) { const lw = 86, lh = lw * logo.h / logo.w; doc.addImage(logo.dataUrl, 'JPEG', L, 40, lw, lh); }
    set('normal', 9, C.txt);
    const addr = [...String(S.address || '').split('\n'), S.abn ? 'ABN ' + S.abn : '', S.phone, S.email].filter(s => s && String(s).trim());
    addr.forEach((s, i) => doc.text(String(s).trim(), R, 49 + i * 11.5, { align: 'right' }));
    set('bold', 16, C.navy);
    doc.text((S.tradingName || '').toUpperCase(), L, 123);
    doc.text(model.title, R, 123, { align: 'right' });
    doc.setDrawColor(...C.navy); doc.setLineWidth(1); doc.line(L, 130, R, 130);
    y = 146;
    if (model.banner) para(model.banner, 9, C.amber, 11);
    para(model.basisText, 9, C.txt, 12);
    if (model.framingText) para(model.framingText, 9, C.txt, 12);
    y += 4;

    const client = quote.client || {};
    const jobLines = [quote.jobSite, ...String(quote.jobLines || '').split('\n')].filter(s => s && String(s).trim());
    const billLines = [client.name, client.attention ? 'Attention: ' + client.attention : '', ...String(client.address || '').split('\n'), client.abn ? 'ABN ' + client.abn : ''].filter(s => s && String(s).trim());
    const meta = [['NUMBER', quote.number], ['DATE', g.INV.F.dFull(quote.date)], ['BASIS', quote.basis === 'labour-only' ? 'Labour only' : quote.basis === 'supply-fix' ? 'Supply and fix' : 'Not chosen']];
    set('normal', 9);
    const boxTop = y;
    const inner = Math.max(billLines.length, jobLines.length, meta.length);
    const boxH = 18 + inner * 11.5 + 8;
    fill(C.light); doc.setDrawColor(214, 222, 227); doc.setLineWidth(0.6); doc.rect(L, boxTop, R - L, boxH, 'FD');
    set('bold', 9, C.blue); doc.text('BILL TO', L + 6, boxTop + 14); doc.text('JOB', L + 190, boxTop + 14);
    billLines.forEach((s, i) => { set(i === 0 ? 'bold' : 'normal', 9, C.txt); doc.text(doc.splitTextToSize(String(s), 170)[0], L + 6, boxTop + 28 + i * 11.5); });
    jobLines.forEach((s, i) => { set(i === 0 ? 'bold' : 'normal', 9, C.txt); doc.text(doc.splitTextToSize(String(s), 160)[0], L + 190, boxTop + 28 + i * 11.5); });
    meta.forEach((r, i) => { set('bold', 9, C.blue); doc.text(r[0], L + 360, boxTop + 14 + i * 11.5); set('normal', 9, C.txt); doc.text(String(r[1]), L + 410, boxTop + 14 + i * 11.5); });
    y = boxTop + boxH + 16;

    const cols = [{ w: 300 }, { w: 70, align: 'right' }, { w: 40 }, { w: R - L - 410, align: 'right' }];
    const head = ['Description', 'Qty', 'Unit', 'Amount ex GST'];
    const drawHead = () => {
      fill(C.blue); doc.rect(L, y, R - L, 18, 'F'); set('bold', 8, [255, 255, 255]);
      let x = L; head.forEach((t, i) => { doc.text(t, cols[i].align === 'right' ? x + cols[i].w - 4 : x + 4, y + 12, cols[i].align === 'right' ? { align: 'right' } : undefined); x += cols[i].w; });
      y += 18;
    };
    if (model.lines.length) {
      need(40); drawHead();
      model.lines.forEach(line => {
        set('normal', 8, C.txt);
        const wrapped = [split(line.label, cols[0].w - 8), split(line.qtyText, cols[1].w - 8), split(line.unit, cols[2].w - 6), split(line.amountText, cols[3].w - 8)];
        const n = Math.max(1, ...wrapped.map(w => w.length));
        const h = n * 11 + 8;
        if (y + h > BOTTOM) { newPage(); drawHead(); set('normal', 8, C.txt); }
        let x = L;
        wrapped.forEach((ln, i) => {
          ln.forEach((s, k) => doc.text(s, cols[i].align === 'right' ? x + cols[i].w - 4 : x + 4, y + 12 + k * 11, cols[i].align === 'right' ? { align: 'right' } : undefined));
          x += cols[i].w;
        });
        doc.setDrawColor(...C.line); doc.setLineWidth(0.4); doc.line(L, y + h, R, y + h);
        y += h;
      });
      y += 10;
    }

    if (model.omitted.length) {
      need(24); set('bold', 10, C.navy); doc.text('Not included', L, y); y += 14;
      model.omitted.forEach(o => para(o.label + ' — ' + o.reason, 8, C.mut, 11));
      y += 6;
    }
    para(model.patchText, 9, C.txt, 12);
    y += 6;
    need(36); set('bold', 10, C.navy); doc.text(model.stage === 'final' ? 'Total' : 'Figures', L, y); y += 14;
    para(model.totalsText, 9, C.txt, 12);
    y += 4;
    para(model.depositText, 9, C.txt, 12);
    y += 8;

    const pay = [['Payee', S.payee || ''], ['Bank', S.bank || ''], ['BSB', S.bsb || ''], ['Account', S.account || ''], ['Reference', quote.number || '']];
    pay.forEach(r => para(r[0] + ': ' + r[1], 8, C.txt, 11));

    (atts || []).forEach((a, i) => {
      doc.addPage(); topBar();
      set('bold', 11, C.navy); doc.text('Attachment ' + (i + 1) + ' — ' + attTitle(a), L, 49);
      let iy = 64;
      if (a.caption && String(a.caption).trim()) { set('normal', 8, C.mut); split(a.caption, R - L).forEach(s => { doc.text(s, L, iy); iy += 11; }); iy += 6; }
      const maxW = R - L, maxH = BOTTOM - iy - 6;
      let w = maxW, h = a.w ? w * a.h / a.w : maxH;
      if (h > maxH) { h = maxH; w = a.w ? h * a.w / a.h : maxW; }
      try { doc.addImage(a.dataUrl, 'JPEG', L, iy, w, h, undefined, 'FAST'); } catch (e) { set('normal', 9); doc.text('(image could not be added)', L, iy + 12); }
    });

    const n = doc.getNumberOfPages();
    for (let p = 1; p <= n; p++) {
      doc.setPage(p); fill(C.blue); doc.rect(0, H - 22, W, 22, 'F'); set('normal', 7.5, [255, 255, 255]);
      doc.text((S.tradingName || '') + '  ·  ' + (quote.number || '') + '  ·  ' + ((quote.client && quote.client.name) || ''), 38, H - 8.3);
      doc.text('Page ' + p + ' of ' + n, W - 38, H - 8.3, { align: 'right' });
    }
    doc.setProperties({ title: (S.tradingName || '') + ' ' + (quote.number || '') + ' — ' + ((quote.client && quote.client.name) || ''), subject: model.title, author: S.legalName || '', creator: 'ADL Invoices' });
    return doc;
  }

  g.QUOTE = {
    LAW, blankRoom, syncRoomLines, normQuote, priceQuote, depositDecision, internalParagraphs,
    finalBlockers, presentation, visibleStatus, commercialNotes, exportPayload, buildInvoiceFromQuote,
    clientModel, clientPlain, build, attTitle
  };
})(window);
