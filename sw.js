const CACHE_NAME = 'rancho-fh-cache-v9';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  './css/styles.css?v=9',
  './js/validations.js?v=9',
  './js/almacen.js?v=9',
  './js/sync.js?v=9',
  './js/db.js?v=9',
  './js/exports.js?v=9',
  './js/app.js?v=9'
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
  // Otros dominios (CDN, fuentes) los maneja el navegador directamente.
  if (url.origin !== self.location.origin) return;
  // La API nunca se guarda en caché: sus datos dependen de la sesión y deben ser actuales.
  // Sin señal, la app usa su copia en IndexedDB.
  if (url.pathname.startsWith('/api')) return;

  // Network-first: intenta la red; sin señal (en el corral) usa la copia guardada
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.status === 200 && res.type === 'basic') {
          const copia = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copia));
        }
        return res;
      })
      .catch(() => caches.match(req))
  );
});
