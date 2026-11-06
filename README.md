# ADL Plaster

Offline invoicing and quoting for ADL Plaster. It is a static iPhone home-screen app. There is no account and no sign-in. Invoices, quotes, photos, rates and bank details stay in this phone’s browser storage until you export a backup.

The invoice screens and the public client rates come from the public app at <https://github.com/svtgt6rwvn-droid/adl-invoice> (`4d139a99d46b692aaf0b2107cdeaf8fb487c4ed5`). This repository is a separate copy plus quoting. It does not carry that repo’s history, and it does not contain saved invoices or a real job takeoff.

Bank, BSB and account start blank. Fill them in Settings on the phone and press **Save settings**. Quote numbers start at `Q00001` and do not move the invoice number (`INV00083`).

## Add to Home Screen (iPhone Safari)

1. Open this site in Safari (not inside another app’s browser).
2. Tap Share, then **Add to Home Screen**.
3. Open it from the home screen. It runs offline after the first successful load.
4. There is nothing to sign in to. Enter bank details and any job only on the device, then press **Save settings** or **Save** on the document.

## Quotes

Quotes use the same screens as invoices. A new quote is a provisional estimate. Blank quantities and rates are unknown, not zero. Sell price is cost ex GST divided by `(1 − margin)`. The default 15% margin uses `÷ 0.85`, not `× 1.15`. GST-inclusive costs are divided by 1.1 before the margin.

The deposit request defaults to 50% before commencement. That is not certified. A final quote stays locked until framing is marked near complete and the on-screen deposit check is satisfied. The check is internal and is not printed on the client PDF. Nothing in the app is a registered overlay.

## Backup

Settings → **Export backup** writes a JSON file that includes invoices, quotes and their photos. **Restore from backup** loads that file onto this phone only.
