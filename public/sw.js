/**
 * HyperMap Service Worker — full offline support
 *
 * Three separate caches with different strategies:
 *
 *  SHELL  — app HTML + hashed JS/CSS (immutable, cache-first forever)
 *  DATA   — our binary data files     (cache-first, pre-cached on install)
 *  TILES  — map tiles + style + fonts (network-first → cache fallback,
 *            evicted when cache exceeds MAX_TILE_ENTRIES)
 */

const VERSION = 'v5';
const SHELL_CACHE = `hypermap-shell-${VERSION}`;
const DATA_CACHE  = `hypermap-data-${VERSION}`;
const TILE_CACHE  = `hypermap-tiles-${VERSION}`;
const ALL_CACHES  = [SHELL_CACHE, DATA_CACHE, TILE_CACHE];

// Max number of tile/style responses to keep (~50 KB avg → ~100 MB at 2000)
const MAX_TILE_ENTRIES = 2000;

// Our own data files — always cache-first
const DATA_URLS = [
  '/data/country_colors.json',
  '/data/countries_picking.geojson',
  '/data/countries_visible.geojson',
  '/data/states.geojson',
  '/data/cities.bin',
  '/data/city_grid.bin',
  '/data/city_names.bin',
  '/data/metadata.json',
  '/data/cc_codes.json',
];

// App shell files to pre-cache (root always; Vite assets are hashed so
// we cache them on first fetch via the fetch handler below)
const SHELL_URLS = ['/'];

// ─── Install ────────────────────────────────────────────────────────────────
self.addEventListener('install', e => {
  e.waitUntil(
    Promise.all([
      caches.open(DATA_CACHE).then(c => c.addAll(DATA_URLS)),
      caches.open(SHELL_CACHE).then(c => c.addAll(SHELL_URLS)),
    ])
  );
  // Take control immediately — don't wait for old SW to die
  self.skipWaiting();
});

// ─── Activate ───────────────────────────────────────────────────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => !ALL_CACHES.includes(k))
          .map(k => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// ─── Fetch ──────────────────────────────────────────────────────────────────
self.addEventListener('fetch', e => {
  const { request } = e;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // 1. Our data files → cache-first (they never change between deploys)
  if (url.origin === self.location.origin && DATA_URLS.includes(url.pathname)) {
    e.respondWith(cacheFirst(DATA_CACHE, request));
    return;
  }

  // 2. Our app shell (HTML + hashed Vite assets) → cache-first
  //    Hashed assets (/assets/*.js, /assets/*.css) are immutable forever.
  if (url.origin === self.location.origin) {
    e.respondWith(cacheFirst(SHELL_CACHE, request));
    return;
  }

  // 3. Map tiles, style JSON, fonts, sprites from external CDNs
  //    → network-first with cache fallback so we always try fresh,
  //      but work offline once visited
  if (isMapResource(url)) {
    e.respondWith(networkFirstWithCache(TILE_CACHE, request, MAX_TILE_ENTRIES));
    return;
  }

  // 4. Everything else — just fetch from network, no caching
});

// ─── Helpers ────────────────────────────────────────────────────────────────

function isMapResource(url) {
  // OpenFreeMap tiles + style
  if (url.hostname.includes('openfreemap.org')) return true;
  // MapTiler, Protomaps, other common tile CDNs
  if (url.hostname.includes('maptiler')) return true;
  if (url.hostname.includes('protomaps')) return true;
  // Glyphs / fonts (typically fonts.openmaptiles.org or similar)
  if (url.pathname.includes('/fonts/')) return true;
  if (url.pathname.includes('/sprites/')) return true;
  if (url.pathname.endsWith('.pbf')) return true;
  if (url.pathname.endsWith('.mvt')) return true;
  return false;
}

/** Cache-first: return cached response if available, else fetch + store */
async function cacheFirst(cacheName, request) {
  const cache    = await caches.open(cacheName);
  const cached   = await cache.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    return new Response('Offline', { status: 503 });
  }
}

/**
 * Network-first: try network, fall back to cache.
 * On successful network response, store in cache.
 * Evict oldest entries when cache exceeds maxEntries.
 */
async function networkFirstWithCache(cacheName, request, maxEntries) {
  const cache = await caches.open(cacheName);

  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response.clone());
      // Async eviction — don't block the response
      trimCache(cache, maxEntries);
    }
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    return new Response('Offline — tile not cached', { status: 503 });
  }
}

/** Remove oldest entries from a cache until it is at or below maxEntries */
async function trimCache(cache, maxEntries) {
  const keys = await cache.keys();
  if (keys.length <= maxEntries) return;
  // Delete oldest (front of list = oldest in insertion order)
  const toDelete = keys.slice(0, keys.length - maxEntries);
  await Promise.all(toDelete.map(k => cache.delete(k)));
}
