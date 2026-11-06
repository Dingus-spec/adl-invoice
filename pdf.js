/* ADL Plaster invoice maths + PDF generation (jsPDF, A4, points) */
(function (g) {
  const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const MONL = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const DAY = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const DAYL = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const pd = s => { if (!s) return null; const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const F = {
    dShort: s => { const d = pd(s); return d ? `${DAY[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}` : ''; },
    dDM: s => { const d = pd(s); return d ? `${d.getDate()} ${MON[d.getMonth()]}` : ''; },
    dFull: s => { const d = pd(s); return d ? `${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()}` : ''; },
    dLong: s => { const d = pd(s); return d ? `${DAYL[d.getDay()]} ${d.getDate()} ${MONL[d.getMonth()]} ${d.getFullYear()}` : ''; },
    money: c => { const neg = c < 0; c = Math.abs(Math.round(c)); const s = (Math.floor(c / 100)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ','); return (neg ? '-' : '') + '$' + s + '.' + String(c % 100).padStart(2, '0'); },
    hrs: h => { h = Number(h) || 0; return (Math.round(h * 100) / 100).toFixed(Number.isInteger(h * 2) ? 1 : 2).replace(/(\.\d)0$/, '$1'); },
    t12: t => { if (!t) return ''; let [h, m] = t.split(':').map(Number); h = h % 12 || 12; return `${h}:${String(m).padStart(2, '0')}`; },
    period(days) {
      const ds = days.map(d => d.date).filter(Boolean).sort(); if (!ds.length) return '';
      const a = pd(ds[0]), b = pd(ds[ds.length - 1]);
      if (ds[0] === ds[ds.length - 1]) return F.dFull(ds[0]);
      if (a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth()) return `${a.getDate()}–${b.getDate()} ${MON[b.getMonth()]} ${b.getFullYear()}`;
      if (a.getFullYear() === b.getFullYear()) return `${a.getDate()} ${MON[a.getMonth()]} – ${b.getDate()} ${MON[b.getMonth()]} ${b.getFullYear()}`;
      return `${F.dFull(ds[0])} – ${F.dFull(ds[ds.length - 1])}`;
    }
  };
  function hoursFromTimes(s, f, brk) {
    if (!s || !f) return null; const [a, b] = s.split(':').map(Number), [c, d] = f.split(':').map(Number);
    let m = (c * 60 + d) - (a * 60 + b); if (m < 0) m += 1440; m -= Number(brk) || 0; return Math.max(0, Math.round(m / 60 * 100) / 100);
  }
  function pricingOf(inv) {
    const p = inv.pricing || {};
    if (p.type === 'day') return { type: 'day', half: Number(p.half) || 0, full: Number(p.full) || 0 };
    return { type: 'hourly', rate: Number(p.rate != null && p.rate !== '' ? p.rate : inv.rate) || 0 };
  }
  const tradesOf = d => { const t = Number(d.trades); return t > 0 ? t : 1; };
  function totals(inv) {
    const P = pricingOf(inv);
    const rateC = Math.round((P.rate || 0) * 100), halfC = Math.round((P.half || 0) * 100), fullC = Math.round((P.full || 0) * 100);
    const gstPct = inv.gstRate == null || inv.gstRate === '' ? 10 : Number(inv.gstRate);
    let hours = 0, labour = 0, manHours = 0;
    const lines = (inv.days || []).map(d => {
      const h = Number(d.hours) || 0, t = tradesOf(d);
      let amt, unitC;
      if (P.type === 'day') { unitC = d.dayType === 'half' ? halfC : fullC; amt = unitC * t; }
      else { unitC = rateC; amt = Math.round(h * rateC * t); }
      hours += h; manHours += h * t; labour += amt; return { h, t, amt, unitC };
    });
    const gst = Math.round(labour * gstPct / 100);
    const exp = (inv.expenses || []).reduce((s, e) => s + Math.round((Number(e.amount) || 0) * 100), 0);
    return { P, rateC, halfC, fullC, gstPct, hours: Math.round(hours * 100) / 100, manHours: Math.round(manHours * 100) / 100, labour, gst, exp, total: labour + gst + exp, lines, multi: (inv.days || []).some(d => tradesOf(d) > 1) };
  }
  function labourNote(inv, hasDaySheet) {
    if (inv.labourNote && inv.labourNote.trim()) return inv.labourNote.trim();
    const seen = new Set(), parts = [];
    (inv.days || []).forEach(d => {
      if (d.start && d.finish) { const k = d.start + '-' + d.finish; if (!seen.has(k)) { seen.add(k); parts.push(`${F.t12(d.start)}–${F.t12(d.finish)} is ${F.hrs(d.hours)} hours.`); } }
    });
    if (pricingOf(inv).type === 'day') return hasDaySheet ? 'Days match the signed day sheet.' : '';
    return [(hasDaySheet ? 'Hours match the signed day sheet.' : ''), ...parts].filter(Boolean).join(' ');
  }
  function attTitle(a, inv) {
    if (a.title && a.title.trim()) return a.title.trim();
    if (a.kind === 'daysheet') return `Signed day sheet, ${inv.client && inv.client.name || ''}`.replace(/, $/, '');
    if (a.kind === 'receipt') return `Parking tax invoice${a.date ? ', ' + F.dLong(a.date) : ''}`;
    return 'Supporting document';
  }
  function attLabel(a) {
    if (a.kind === 'daysheet') return 'signed day sheet';
    if (a.kind === 'receipt') return `parking tax invoice${a.date ? ' ' + F.dDM(a.date) : ''}`;
    return (a.title || 'supporting document').trim();
  }

  const C = { navy: [27, 58, 75], blue: [47, 93, 140], light: [244, 247, 248], line: [205, 213, 218], txt: [30, 30, 30], mut: [95, 105, 112], amber: [176, 106, 0], black: [27, 27, 27] };

  /* inv: invoice object; S: settings; atts: [{dataUrl, w, h, ...meta}]; logo: {dataUrl,w,h} */
  function build(inv, S, atts, logo) {
    const { jsPDF } = g.jspdf;
    const doc = new jsPDF({ unit: 'pt', format: 'a4', compress: true });
    const W = 595.28, H = 841.89, L = 45.35, R = W - 45.35, BOTTOM = 808;
    const T = totals(inv);
    const client = inv.client || {};
    const set = (font, size, color) => { doc.setFont('helvetica', font); doc.setFontSize(size); doc.setTextColor(...(color || C.txt)); };
    const fill = (c) => doc.setFillColor(...c), stroke = (c) => doc.setDrawColor(...c);
    const topBar = () => { fill(C.navy); doc.rect(0, 0, W, 17, 'F'); };
    let y;
    const newPage = () => { doc.addPage(); topBar(); y = 45; };
    const need = h => { if (y + h > BOTTOM) newPage(); };
    const split = (t, w) => doc.splitTextToSize(String(t || ''), w);

    topBar();
    // Logo + business address
    if (logo) { const lw = 86, lh = lw * logo.h / logo.w; doc.addImage(logo.dataUrl, 'JPEG', L, 40, lw, lh); }
    set('normal', 9, C.txt);
    const addr = [...String(S.address || '').split('\n'), S.abn ? 'ABN ' + S.abn : '', S.phone, S.email].filter(s => s && s.trim());
    addr.forEach((s, i) => doc.text(s.trim(), R, 49 + i * 11.5, { align: 'right' }));
    // Title row
    set('bold', 16, C.navy); doc.text((S.tradingName || '').toUpperCase(), L, 123);
    doc.text('TAX INVOICE', R, 123, { align: 'right' });
    stroke(C.navy); doc.setLineWidth(1); doc.line(L, 130, R, 130);

    // Info box
    const jobLines = [inv.jobSite, ...String(inv.jobLines || '').split('\n')].filter(s => s && s.trim());
    const billLines = [client.name, client.attention ? 'Attention: ' + client.attention : '', ...String(client.address || '').split('\n'), client.abn ? 'ABN ' + client.abn : ''].filter(s => s && s.trim());
    const meta = [['NUMBER', inv.number], ['DATE', F.dFull(inv.date)], ['DUE', inv.due || 'On receipt'], ['PERIOD', inv.period || F.period(inv.days || [])], ['ABN', S.abn]].filter(r => r[1]);
    set('normal', 9);
    const c1w = 232.77 - 51.35 - 8, c2w = 397.18 - 232.77 - 8;
    const billW = billLines.map((s, i) => split(s, c1w)).flat(), jobW = jobLines.map(s => split(s, c2w)).flat();
    const rows = Math.max(billW.length, jobW.length, meta.length);
    const boxH = 18 + rows * 11.5 + 3;
    fill(C.light); stroke([214, 222, 227]); doc.setLineWidth(0.6); doc.rect(L, 137, R - L, boxH, 'FD');
    set('bold', 9, C.blue); doc.text('BILL TO', 51.35, 151); doc.text('JOB', 232.77, 151);
    const ly = 162.5;
    billW.forEach((s, i) => { set(i === 0 ? 'bold' : 'normal', 9); doc.text(s, 51.35, ly + i * 11.5); });
    jobW.forEach((s, i) => { set(i === 0 ? 'bold' : 'normal', 9); doc.text(s, 232.77, ly + i * 11.5); });
    meta.forEach((r, i) => { const yy = 151 + i * 11.5; set('bold', 9, C.blue); doc.text(r[0], 397.18, yy); set('normal', 9); doc.text(String(r[1]), 397.18 + 44.5, yy); });
    y = 137 + boxH + 15;

    // Generic table
    function table(cols, head, body, totalRow, headColor) {
      const pad = 3.2, lh = 10.5;
      const drawHead = () => {
        fill(headColor); doc.rect(L, y, R - L, 19, 'F'); set('bold', 8, [255, 255, 255]);
        let x = L; cols.forEach((c, i) => { doc.text(head[i], x + pad, y + 12.5); x += c.w; }); y += 19;
      };
      need(19 + 30); drawHead();
      const drawRow = (cells, opt) => {
        set(opt.bold ? 'bold' : 'normal', 8);
        const wrapped = cells.map((t, i) => split(t, cols[i].w - pad * 2));
        const n = Math.max(1, ...wrapped.map(w => w.length));
        const h = Math.max(opt.minH || 0, n * lh + 9);
        if (y + h > BOTTOM) { newPage(); drawHead(); set(opt.bold ? 'bold' : 'normal', 8); }
        if (opt.fill) { fill(opt.fill); doc.rect(L, y, R - L, h, 'F'); }
        let x = L;
        wrapped.forEach((ln, i) => {
          const c = cols[i], bh = ln.length * lh, top = y + (h - bh) / 2 + 7.6;
          ln.forEach((s, k) => doc.text(s, c.align === 'right' ? x + c.w - pad : x + pad, top + k * lh, c.align === 'right' ? { align: 'right' } : undefined));
          x += c.w;
        });
        stroke(C.line); doc.setLineWidth(0.5);
        doc.line(L, y + h, R, y + h); x = L; doc.line(x, y, x, y + h); cols.forEach(c => { x += c.w; doc.line(x, y, x, y + h); });
        y += h;
      };
      body.forEach(r => drawRow(r, { minH: 28 }));
      if (totalRow) drawRow(totalRow, { bold: true, fill: C.light, minH: 19 });
    }
    const heading = (t, note) => {
      need(60);
      set('bold', 11, C.navy); doc.text(t, L, y + 8); y += 15;
      if (note) { set('normal', 7.5, C.mut); split(note, R - L).forEach(s => { doc.text(s, L, y + 7); y += 9.5; }); }
      y += 2;
    };

    // Labour
    const hasSheet = (atts || []).some(a => a.kind === 'daysheet');
    if ((inv.days || []).length) {
      const gstTxt = T.gstPct + '%', descOf = d => [d.desc, d.job].filter(Boolean).join('\n');
      if (T.P.type === 'day') {
        heading(`Labour — day rates per tradesperson + GST (half day ${F.money(T.halfC)}, full day ${F.money(T.fullC)})`, labourNote(inv, hasSheet));
        table([{ w: 62 }, { w: 160 }, { w: 52 }, { w: 44, align: 'right' }, { w: 58, align: 'right' }, { w: 40, align: 'right' }, { w: 89.3, align: 'right' }],
          ['Date', 'Description', 'Day', 'Trades', 'Rate', 'GST', 'Amount'],
          inv.days.map((d, i) => [F.dShort(d.date), descOf(d), d.dayType === 'half' ? 'Half day' : 'Full day', String(T.lines[i].t), F.money(T.lines[i].unitC), gstTxt, F.money(T.lines[i].amt)]),
          ['', `Labour total — ${F.hrs(inv.days.reduce((n, d, i) => n + T.lines[i].t * (d.dayType === 'half' ? 0.5 : 1), 0))} person-days`, '', '', '', '', F.money(T.labour)], C.blue);
      } else {
        const rate = F.money(T.rateC);
        heading(`Labour — ${rate} per hour per tradesperson + GST`, labourNote(inv, hasSheet));
        if (T.multi) {
          table([{ w: 62 }, { w: 160 }, { w: 44, align: 'right' }, { w: 44, align: 'right' }, { w: 58, align: 'right' }, { w: 40, align: 'right' }, { w: 97.3, align: 'right' }],
            ['Date', 'Description', 'Hours', 'Trades', 'Rate', 'GST', 'Amount'],
            inv.days.map((d, i) => [F.dShort(d.date), descOf(d), F.hrs(d.hours), String(T.lines[i].t), rate, gstTxt, F.money(T.lines[i].amt)]),
            ['', `Labour total — ${F.hrs(T.manHours)} person-hours`, '', '', '', '', F.money(T.labour)], C.blue);
        } else {
          table([{ w: 67.7 }, { w: 175 }, { w: 52, align: 'right' }, { w: 62, align: 'right' }, { w: 46, align: 'right' }, { w: 101.9, align: 'right' }],
            ['Date', 'Description', 'Hours', 'Rate', 'GST', 'Amount'],
            inv.days.map((d, i) => [F.dShort(d.date), descOf(d), F.hrs(d.hours), rate, gstTxt, F.money(T.lines[i].amt)]),
            ['', 'Labour total', F.hrs(T.hours), '', '', F.money(T.labour)], C.blue);
        }
      }
      y += 10;
    }
    // Parking / expenses
    if ((inv.expenses || []).length) {
      heading('Parking reimbursement — no extra GST', inv.expenseNote || S.expenseNote);
      table([{ w: 67.7 }, { w: 272.5 }, { w: 73.7 }, { w: 90.7, align: 'right' }], ['Date', 'Details', 'Ref', 'Amount'],
        inv.expenses.map(e => [F.dShort(e.date), e.details, e.ref, F.money(Math.round((Number(e.amount) || 0) * 100))]),
        ['', 'Parking total — no extra GST', '', F.money(T.exp)], C.navy);
      y += 4;
    }
    if (inv.flagNote && inv.flagNote.trim()) {
      set('bold', 7.5, C.amber); split(inv.flagNote.trim(), R - L).forEach(s => { need(10); doc.text(s, L, y + 9); y += 9.5; });
    }
    y += 12;

    // Totals box
    const tRows = [['Labour ex GST', F.money(T.labour)], [`GST on labour only (${T.gstPct}%)`, F.money(T.gst)]];
    if (T.exp) tRows.push(['Parking (no extra GST)', F.money(T.exp)]);
    const tx = 275.2, th = 19.6;
    need(th * (tRows.length + 1) + 10);
    stroke(C.line); doc.setLineWidth(0.5);
    tRows.forEach(r => { doc.rect(tx, y, R - tx, th); set('normal', 8); doc.text(r[0], tx + 6, y + 12.8); doc.text(r[1], R - 6, y + 12.8, { align: 'right' }); y += th; });
    fill(C.black); doc.rect(tx, y, R - tx, th + 1, 'F'); set('bold', 8.5, [255, 255, 255]);
    doc.text('BALANCE DUE', tx + 6, y + 13.2); doc.text(F.money(T.total), R - 6, y + 13.2, { align: 'right' }); y += th + 14;

    // Payment + supplier
    const pay = [`Payee: ${S.payee || ''}`, `ABN: ${S.abn || ''}`, `Bank: ${S.bank || ''}`, `BSB: ${S.bsb || ''}`, `Account: ${S.account || ''}`, `Reference: ${inv.number}`];
    let gstNote = `GST of ${F.money(T.gst)} is on labour only.` + (T.exp ? ` Parking of ${F.money(T.exp)} is a reimbursement of the attached receipts.` : '');
    set('normal', 8);
    const colW = 318.9 - L;
    const gnLines = split(gstNote, colW - 12);
    const sup = [S.legalName, S.supplierLine || 'Sole trader, GST registered', S.tradingName ? 'Trading as ' + S.tradingName : '', ...String(S.address || '').split('\n')].filter(s => s && s.trim());
    const bh = 10 + 12 + Math.max(pay.length, sup.length) * 10.5 + 10 + gnLines.length * 10.5 + 8;
    need(bh + 4);
    fill(C.light); stroke([214, 222, 227]); doc.rect(L, y, colW, bh, 'FD'); doc.rect(L + colW, y, R - L - colW, bh, 'D');
    set('bold', 8.2); doc.text('Payment instructions', L + 6, y + 13); doc.text('Supplier', L + colW + 6, y + 13);
    set('normal', 8);
    pay.forEach((s, i) => doc.text(s, L + 6, y + 24.5 + i * 10.5));
    sup.forEach((s, i) => doc.text(s.trim(), L + colW + 6, y + 24.5 + i * 10.5));
    const gy = y + 24.5 + Math.max(pay.length, sup.length) * 10.5 + 10;
    gnLines.forEach((s, i) => doc.text(s, L + 6, gy + i * 10.5));
    y += bh + 13;

    // Attachment summary line
    if (atts && atts.length) {
      const startPage = doc.getNumberOfPages() + 1;
      const groups = [];
      atts.forEach((a, i) => { const p = startPage + i, lab = attLabel(a); const last = groups[groups.length - 1];
        if (last && last.kind === a.kind && a.kind === 'receipt') { last.items.push({ lab, p, date: a.date }); } else groups.push({ kind: a.kind, items: [{ lab, p, date: a.date }] }); });
      const txt = groups.map(gq => {
        if (gq.kind === 'receipt' && gq.items.length > 1) {
          const ds = gq.items.map(it => it.date ? F.dDM(it.date) : '').filter(Boolean);
          const ps = gq.items.map(it => it.p);
          const and = a => a.length > 1 ? a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1] : a.join('');
          return `Parking tax invoices${ds.length ? ' ' + and(ds) : ''} (pages ${and(ps)})`;
        }
        const it = gq.items[0]; const s = `${it.lab} (page ${it.p})`; return s;
      }).map(s => s.charAt(0).toUpperCase() + s.slice(1)).join('. ');
      set('normal', 7.5, C.mut);
      const lines = split('Attachments: ' + txt.charAt(0).toLowerCase() + txt.slice(1) + '.', R - L);
      lines.forEach(s => { need(2); doc.text(s, L, y); y += 9.5; });
    }

    // Attachment pages
    (atts || []).forEach((a, i) => {
      doc.addPage(); topBar();
      set('bold', 11, C.navy); doc.text(`Attachment ${i + 1} — ${attTitle(a, inv)}`, L, 49);
      let iy = 56;
      if (a.caption && a.caption.trim()) { set('normal', 7.5, C.mut); split(a.caption.trim(), R - L).forEach(s => { doc.text(s, L, iy + 6); iy += 9.5; }); }
      iy += 4;
      const maxW = R - L, maxH = BOTTOM - iy - 6; let w = maxW, h = w * a.h / a.w; if (h > maxH) { h = maxH; w = h * a.w / a.h; }
      try { doc.addImage(a.dataUrl, 'JPEG', L, iy, w, h, undefined, 'FAST'); } catch (e) { set('normal', 9); doc.text('(image could not be added)', L, iy + 12); }
    });

    // Footers
    const n = doc.getNumberOfPages();
    for (let p = 1; p <= n; p++) {
      doc.setPage(p); fill(C.blue); doc.rect(0, H - 22, W, 22, 'F'); set('normal', 7.5, [255, 255, 255]);
      doc.text(`${S.tradingName || ''}  ·  ${inv.number}  ·  ${client.name || ''}`, 38, H - 8.3);
      doc.text(`Page ${p} of ${n}`, W - 38, H - 8.3, { align: 'right' });
    }
    doc.setProperties({ title: `${S.tradingName} ${inv.number} — ${client.name || ''}`, subject: `Tax invoice ${inv.period || F.period(inv.days || [])}${inv.jobSite ? ', ' + inv.jobSite : ''}`, author: S.legalName, creator: 'ADL Invoices' });
    return doc;
  }
  g.INV = { F, totals, hoursFromTimes, build, attTitle, labourNote, pricingOf };
})(window);
