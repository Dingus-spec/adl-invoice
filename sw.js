const CACHE = 'adl-invoice-v9';
const ASSETS = ['./', './index.html', './styles.css', './app.js', './pdf.js', './quote.js', './manifest.json',
  './vendor/jspdf.umd.min.js', './icons/logo.jpg', './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png'];
// App shell files: network-first (pick up updates fast), cache fallback when offline.
const NETWORK_FIRST = /\/(index\.html|app\.js|pdf\.js|quote\.js|styles\.css|manifest\.json)?$/;
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  const put = resp => { if (resp.ok) { const copy = resp.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); } return resp; };
  if (e.request.mode === 'navigate' || NETWORK_FIRST.test(url.pathname)) {
    e.respondWith(fetch(e.request, { cache: 'no-cache' }).then(put).catch(() =>
      caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('./index.html'))));
    return;
  }
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(r => r || fetch(e.request).then(put).catch(() => caches.match('./index.html'))));
});
