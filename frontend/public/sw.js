/* SoroTask offline-first service worker (#1240).
 *
 * A hand-rolled Workbox-style service worker that makes the dashboard usable
 * under intermittent connectivity:
 *  - navigations: network-first with a timeout, falling back to the cached
 *    shell and finally to /offline,
 *  - static assets: stale-while-revalidate, with immutable /_next/ builds
 *    treated as cache-first,
 *  - read-only task/API queries: network-first with a cache fallback,
 *  - Background Sync: replays queued writes when connectivity returns, even
 *    if the tab that queued them has since been closed.
 *
 * Kept dependency-free (plain ES2020) so it works in every modern browser and
 * needs no build step.
 */

const CACHE_VERSION = 'sorotask-v4';
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const DATA_CACHE = `${CACHE_VERSION}-data`;

const OFFLINE_URL = '/offline.html';

/** Must match SYNC_TAG in src/lib/offline/backgroundSync.ts. */
const SYNC_TAG = 'sorotask-offline-sync';
const REQUEST_SYNC_TAG = 'sorotask-offline-requests';
const REQUEST_DB_NAME = 'sorotask-background-sync';
const REQUEST_DB_VERSION = 1;
const REQUEST_STORE_NAME = 'requests';

/** How long a navigation may hang before we serve the cached shell. */
const NAVIGATION_TIMEOUT_MS = 3000;

// Core app-shell requests pre-cached at install time.
const CORE_ASSETS = [
  OFFLINE_URL,
  '/offline.css',
  '/manifest.json',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
];

const STATIC_EXT = /\.(?:js|css|json|png|jpe?g|gif|svg|webp|woff2?|ttf|otf)$/;

/**
 * Pre-cache the shell without letting one 404 abort the whole install.
 *
 * `cache.addAll` is atomic — a single missing asset rejects the promise and
 * leaves the worker uninstalled, which is exactly how the icons/ directory
 * being absent used to break the PWA. Each asset is added individually so a
 * broken entry degrades to "not cached offline" instead of "no PWA at all".
 */
async function precacheShell(cache) {
  await Promise.all(
    CORE_ASSETS.map((asset) =>
      cache.add(new Request(asset, { cache: 'reload' })).catch(() => {
        // Intentionally ignored: reported by the runtime cache on first use.
      })
    )
  );
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then(precacheShell)
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
      // Make sure this worker controls the page it was just installed for;
      // without it the first load after a deploy is still uncontrolled and a
      // second reload is needed before offline mode works.
      .then(() => self.clients.claim())
  );
});

// Mutating traffic must never be intercepted or replayed from cache; only GET
// traffic is eligible.
function isEligible(request) {
  if (request.method !== 'GET') return false;
  const url = new URL(request.url);
  return url.origin === self.location.origin;
}

// Read-only task/query API calls: network-first, fall back to a cached copy.
function isDataRequest(url) {
  return url.pathname.startsWith('/api/') && !STATIC_EXT.test(url.pathname);
}

// Next.js build output is content-hashed, so it can never go stale.
function isImmutable(url) {
  return url.pathname.startsWith('/_next/static/');
}

// Caps a promise at `ms`, rejecting with a tagged error so callers can tell a
// timeout apart from a genuine network error.
function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout:${label}`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

async function putInCache(cacheName, request, response) {
  // Opaque and error responses are not worth persisting, and caching a 404
  // would pin a broken response for the whole cache lifetime.
  if (!response || !response.ok || response.type === 'opaque') return;
  const cacheControl = response.headers.get('Cache-Control') || '';
  if (/\b(?:private|no-store)\b/i.test(cacheControl) || response.headers.get('Vary') === '*') return;
  if (cacheName === DATA_CACHE && !/\bpublic\b/i.test(cacheControl)) return;
  const cache = await caches.open(cacheName);
  await cache.put(request, response);
}

async function networkFirstDocument(request) {
  const network = fetch(request).catch(() => null);

  const raced = await withTimeout(network, NAVIGATION_TIMEOUT_MS, 'navigation').catch(() => null);
  if (raced) return raced;

  const cached = await caches.match(request, { cacheName: STATIC_CACHE });
  if (cached) return cached;

  const offline = await caches.match(OFFLINE_URL, { cacheName: STATIC_CACHE });
  // Last resort: still answer 200 with something renderable rather than
  // failing the navigation outright.
  return (
    offline ||
    new Response('<!doctype html><title>Offline</title><h1>You are offline</h1>', {
      status: 200,
      headers: { 'Content-Type': 'text/html' },
    })
  );
}

async function networkFirstData(request) {
  try {
    const response = await fetch(request);
    await putInCache(DATA_CACHE, request, response.clone());
    return response;
  } catch {
    const cached = await caches.match(request, { cacheName: DATA_CACHE });
    // A hard failure with nothing cached: let the caller see the rejection so
    // it can fall back to IndexedDB instead of silently rendering "no tasks".
    return cached || Response.error();
  }
}

async function staleWhileRevalidate(request, url) {
  const cached = await caches.match(request);
  const refresh = fetch(request)
    .then((response) => putInCache(STATIC_CACHE, request, response.clone()).then(() => response))
    .catch(() => cached);
  return cached || refresh;
}

async function cacheFirstImmutable(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  await putInCache(STATIC_CACHE, request, response.clone());
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (!isEligible(request)) return;

  const url = new URL(request.url);

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstDocument(request));
    return;
  }

  if (isDataRequest(url)) {
    event.respondWith(networkFirstData(request));
    return;
  }

  if (isImmutable(url)) {
    event.respondWith(
      cacheFirstImmutable(request).catch(() => caches.match(request).then((c) => c || Response.error())),
    );
    return;
  }

  if (STATIC_EXT.test(url.pathname) || url.pathname.startsWith('/icons/')) {
    event.respondWith(staleWhileRevalidate(request, url));
  }
});

/* -------------------------------------------------------------------------
 * Background Sync
 *
 * The page registers `SYNC_TAG` when it queues a write. The browser then fires
 * this event once connectivity is back — including after a restart — and asks
 * every open client to drain its queue. The worker deliberately does not own
 * the queue: it lives in IndexedDB, which the page already has a typed API for,
 * so there is exactly one implementation of "replay a pending write".
 * ---------------------------------------------------------------------- */

self.addEventListener('sync', (event) => {
  if (event.tag === SYNC_TAG) {
    event.waitUntil(notifyClientsToSync());
  } else if (event.tag === REQUEST_SYNC_TAG) {
    event.waitUntil(flushQueuedRequests());
  }
});

async function notifyClientsToSync() {
  const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const client of clientList) {
    client.postMessage({ type: SYNC_TAG });
  }
}

self.addEventListener('message', (event) => {
  // A controlled page asking for an immediate drain (e.g. the "Retry now"
  // button) — same contract as the sync event.
  if (event.data && event.data.type === 'REPLAY_QUEUE') {
    event.waitUntil(notifyClientsToSync());
    return;
  }
  if (event.data?.type === 'QUEUE_BACKGROUND_REQUEST') {
    const port = event.ports[0];
    event.waitUntil(
      storeQueuedRequest(event.data.request)
        .then(registerRequestSync)
        .then(() => port?.postMessage({ ok: true }))
        .catch((error) => {
          port?.postMessage({
            ok: false,
            error: error instanceof Error ? error.message : 'Failed to queue request.',
          });
        })
    );
    return;
  }
  if (event.data?.type === 'FLUSH_BACKGROUND_REQUESTS') {
    event.waitUntil(flushQueuedRequests());
  }
});

function openRequestDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(REQUEST_DB_NAME, REQUEST_DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(REQUEST_STORE_NAME)) {
        request.result.createObjectStore(REQUEST_STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function storeQueuedRequest(request) {
  const allowedMethods = ['POST', 'PUT', 'PATCH', 'DELETE'];
  if (
    !request ||
    typeof request.id !== 'string' ||
    !request.id.trim() ||
    typeof request.url !== 'string' ||
    !allowedMethods.includes(request.method)
  ) {
    throw new Error('Invalid offline request.');
  }
  const url = new URL(request.url, self.location.origin);
  if (url.origin !== self.location.origin || !url.pathname.startsWith('/api/')) {
    throw new Error('Offline requests must target a same-origin API route.');
  }
  const headers = request.headers ?? {};
  if (
    !headers ||
    typeof headers !== 'object' ||
    Array.isArray(headers) ||
    !Object.entries(headers).every(([key, value]) => key && typeof value === 'string')
  ) {
    throw new Error('Offline request headers must be string values.');
  }
  if (request.body !== undefined && request.body !== null && typeof request.body !== 'string') {
    throw new Error('Offline request body must be a string.');
  }

  const db = await openRequestDatabase();
  try {
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(REQUEST_STORE_NAME, 'readwrite');
      transaction.objectStore(REQUEST_STORE_NAME).put({
        id: request.id,
        url: url.href,
        method: request.method,
        headers,
        body: request.body ?? null,
        createdAt: Date.now(),
      });
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}

async function getQueuedRequests() {
  const db = await openRequestDatabase();
  try {
    const requests = await new Promise((resolve, reject) => {
      const transaction = db.transaction(REQUEST_STORE_NAME, 'readonly');
      const getAll = transaction.objectStore(REQUEST_STORE_NAME).getAll();
      getAll.onsuccess = () => resolve(getAll.result);
      getAll.onerror = () => reject(getAll.error);
    });
    return requests.sort((left, right) => left.createdAt - right.createdAt);
  } finally {
    db.close();
  }
}

async function removeQueuedRequest(id) {
  const db = await openRequestDatabase();
  try {
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(REQUEST_STORE_NAME, 'readwrite');
      transaction.objectStore(REQUEST_STORE_NAME).delete(id);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}

async function flushQueuedRequests() {
  const requests = await getQueuedRequests();
  for (const request of requests) {
    const response = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      credentials: 'same-origin',
    });
    if (!response.ok) {
      if (response.status >= 400 && response.status < 500 && response.status !== 429) {
        await removeQueuedRequest(request.id);
        await notifyRequestClients({
          type: 'BACKGROUND_REQUEST_FAILED',
          id: request.id,
          status: response.status,
        });
        continue;
      }
      throw new Error(`Background request failed with status ${response.status}.`);
    }
    await removeQueuedRequest(request.id);
    await notifyRequestClients({ type: 'BACKGROUND_REQUEST_COMPLETED', id: request.id });
  }
}

async function registerRequestSync() {
  if ('sync' in self.registration) {
    await self.registration.sync.register(REQUEST_SYNC_TAG);
  } else if (self.navigator.onLine) {
    await flushQueuedRequests();
  }
}

async function notifyRequestClients(message) {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const client of clients) client.postMessage(message);
}

self.addEventListener('push', (event) => {
  let value = {};
  try {
    value = event.data ? event.data.json() : {};
  } catch {
    value = { body: event.data ? event.data.text() : '' };
  }
  const payload =
    value && typeof value === 'object' && !Array.isArray(value) ? value : {};

  const title =
    typeof payload.title === 'string' ? payload.title : 'SoroTask alert';
  const body =
    typeof payload.body === 'string'
      ? payload.body
      : 'A critical SoroTask event requires your attention.';
  let notificationUrl = null;
  try {
    if (typeof payload.url === 'string') {
      notificationUrl = new URL(payload.url, self.location.origin);
    }
  } catch {
    notificationUrl = null;
  }
  const url =
    notificationUrl?.origin === self.location.origin
      ? notificationUrl.pathname + notificationUrl.search + notificationUrl.hash
      : '/';

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/icons/icon-192x192.png',
      badge: '/icons/icon-192x192.png',
      data: { url },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(
    typeof event.notification.data?.url === 'string'
      ? event.notification.data.url
      : '/',
    self.location.origin
  );
  const url =
    target.origin === self.location.origin
      ? target.pathname + target.search + target.hash
      : '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((client) => new URL(client.url).origin === self.location.origin);
      if (!existing) return self.clients.openWindow(url);
      return existing.navigate(url).then(() => existing.focus()).catch(() => existing.focus());
    })
  );
});
