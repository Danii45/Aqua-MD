// Aqua MD web app: lets it open without a connection and makes it installable (Chrome, Chrome OS).
// Always tries the network first so updates show up right away; falls back to the last copy when offline.
// Only touches this app's own files: Spotify, weather and lyrics requests go straight to the network.
const CACHE = 'aqua-md-0.4.1';
const SHELL = ["./","index.html","app.js","platform.js","style.css","icon.png","icon-192.png","manifest.webmanifest","fonts/barlow-semi-condensed-latin-400-normal.woff2","fonts/barlow-semi-condensed-latin-500-normal.woff2","fonts/barlow-semi-condensed-latin-600-normal.woff2","fonts/doto-latin-700-normal.woff2","fonts/doto-latin-900-normal.woff2","fonts/michroma-latin-400-normal.woff2"];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('aqua-md-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || !url.pathname.startsWith(new URL('./', self.location).pathname)) return;
  e.respondWith(fetch(req).then(res => {
    if (res.ok && !url.search) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req, { ignoreSearch: true }).then(hit => hit || caches.match('index.html'))));
});
