const CACHE_NAME = 'rancho-fh-cache-v8';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  './css/styles.css?v=8',
  './js/validations.js?v=8',
  './js/almacen.js?v=8',
  './js/sync.js?v=8',
  './js/db.js?v=8',
  './js/exports.js?v=8',
  './js/app.js?v=8'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS_TO_CACHE)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // La API nunca se guarda en caché: sus datos dependen de la sesión y deben ser actuales.
  // Sin señal, la app usa su copia en IndexedDB.
  if (url.origin === self.location.origin && url.pathname.startsWith('/api')) return;

  // Network-first: intenta la red; sin señal (en el corral) usa la copia guardada
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.status === 200 && url.origin === self.location.origin) {
          const copia = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copia));
        }
        return res;
      })
      .catch(() => caches.match(req))
  );
});
