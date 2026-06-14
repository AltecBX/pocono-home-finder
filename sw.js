/* Lakehouse Search service worker.
 * Goal: installability + offline fallback WITHOUT serving stale listings.
 * - Navigations (the HTML): network-first, fall back to last cached copy only when offline.
 * - Same-origin static assets (icons, manifest): stale-while-revalidate.
 * - Everything cross-origin (CDNs, map tiles, weather, listing photos): straight to network, no caching.
 * Bump CACHE_VERSION to force old caches out.
 */
const CACHE_VERSION = 'lakehouse-v1';
const SHELL_URL = './';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;

  // HTML navigations — always try the network first so listings stay fresh.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put(SHELL_URL, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(SHELL_URL).then((c) => c || caches.match(req)))
    );
    return;
  }

  // Cross-origin (CDNs, tiles, photos, APIs) — let the network handle it untouched.
  if (!sameOrigin) return;

  // Same-origin static assets — serve cached fast, refresh in the background.
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE_VERSION).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
