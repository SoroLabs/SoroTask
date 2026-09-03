/* SoroTask offline-first service worker (#811).
 *
 * A hand-rolled Workbox-style service worker that makes the dashboard usable
 * under intermittent connectivity:
 *  - stale-while-revalidate for same-origin app static assets (JS/CSS/images),
 *  - cache-first for fonts/icons,
 *  - network-first with cache fallback for read-only task/API queries,
 *  - navigation requests fall back to the offline page when unreachable.
 *
 * Kept dependency-free (plain ES2020) so it works in every modern browser and
 * needs no build step.
 */

const CACHE_VERSION = 'sorotask-v1';
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const DATA_CACHE = `${CACHE_VERSION}-data`;

const OFFLINE_URL = '/offline';

// Core app-shell requests pre-cached at install time.
const CORE_ASSETS = [
  '/',
  OFFLINE_URL,
  '/manifest.json',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
];

const STATIC_EXT = /\.(?:js|css|json|png|jpe?g|gif|svg|webp|woff2?|ttf|otf)$/;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key !== STATIC_CACHE && key !== DATA_CACHE).map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

// Network requests that mutate state should htever be intercepted; only GET
// traffic is eligible for caching.
function isEligible(request) {
  if (request.method !== 'GET') return false;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return false;
  return true;
}

// Read-only task/query API calls: network-first, fall back to a cached copy.
function isDataRequest(url) {
  return url.pathname.includes('/api/') && !STATIC_EXT.test(url.pathname);
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (!isEligible(request)) return;

  const url = new URL(request.url);

  // App shell navigations: network-first, fall back to the offline page.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(STATIC_CACHE).then((cache) => cache.put(url.href, copy));
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          if (cached) return cached;
          const offline = await caches.match(OFFLINE_URL);
          // FOUC guard: still respond with something even if the offline page
          // isn't cached yet.
          return offline || new Response('Offline', { status: 200, headers: { 'Content-Type': 'text/html' } });
        })
    );
    return;
  }

  // Network-first for read-only API/task data.
  if (isDataRequest(url) || url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(DATA_CACHE).then((cache) => cache.put(url.href, copy));
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          return cached || Response.error();
        })
    );
    return;
  }

  // Static assets and fonts: stale-while-revalidate.
  event.respondWith(
    caches.match(request).then((cached) => {
      const refresh = fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(STATIC_CACHE).then((cache) => cache.put(url.href, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || refresh;
    })
  );
});