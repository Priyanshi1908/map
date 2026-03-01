/**
 * HyperMap Service Worker
 * Caches data files for instant repeat visits.
 */

const CACHE_NAME  = 'hypermap-v1';
const DATA_ASSETS = [
  '/data/country_colors.json',
  '/data/countries_picking.geojson',
  '/data/countries_visible.geojson',
  '/data/cities.bin',
  '/data/city_grid.bin',
  '/data/city_names.bin',
  '/data/metadata.json',
  '/data/cc_codes.json',
];

// Install: pre-cache data assets
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(DATA_ASSETS))
  );
  self.skipWaiting();
});

// Activate: clean up old caches
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: cache-first for data assets, network-first for everything else
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Cache-first: our binary data files
  if (DATA_ASSETS.some(a => url.pathname === a)) {
    e.respondWith(
      caches.match(e.request).then(cached => cached || fetch(e.request))
    );
    return;
  }

  // Network-first: map tiles, style, everything else
  // (don't cache tiles — they change and are managed by MapLibre)
});
