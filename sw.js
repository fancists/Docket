/* DocKit service worker
   vendor/icons  -> cache-first  (big, never change without a rename)
   app files     -> network-first with cache fallback (so updates show up
                    immediately instead of being pinned to a stale cache)      */
const V = 'dockit-v12';
const SHELL = [
  './', './index.html', './css/app.css',
  './js/core.js', './js/scan.js', './js/wm.js', './js/sign.js', './js/photo.js', './js/idcard.js', './js/redact.js',
  './js/export.js', './js/history.js', './js/persist.js', './js/boot.js',
  './vendor/pdf.min.js', './vendor/pdf.worker.min.js', './vendor/pdf-lib.min.js',
  './vendor/Sarabun-Regular.ttf', './vendor/Sarabun-Bold.ttf',
  './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  const frozen = /\/(vendor|icons)\//.test(url.pathname);
  if (frozen){
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
      const copy = res.clone();
      caches.open(V).then(c => c.put(req, copy));
      return res;
    })));
    return;
  }
  e.respondWith(
    fetch(req).then(res => {
      if (res && res.ok){
        const copy = res.clone();
        caches.open(V).then(c => c.put(req, copy));
      }
      return res;
    }).catch(() => caches.match(req).then(hit => hit || caches.match('./index.html')))
  );
});
