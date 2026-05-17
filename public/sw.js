/* =========================================================
   Hushh AI — Service Worker (Next.js)
   Strategy: Cache-first for Next.js static chunks and CDN
   ========================================================= */

const CACHE_NAME = 'hushh-v2.0';

// Core navigational shell + public static files
const STATIC_ASSETS = [
  '/',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/train-worker.js',
];

const TFJS_ORIGIN = 'https://cdn.jsdelivr.net';
const NEXT_STATIC_PREFIX = '/_next/static/';

globalThis.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async cache => {
      try {
        await cache.addAll(STATIC_ASSETS);
      } catch (err) {
        console.warn('[SW] Some assets failed to cache:', err);
      }
    })
  );
  globalThis.skipWaiting();
});

globalThis.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => {
            console.log('[SW] Deleting old cache:', key);
            return caches.delete(key);
          })
      )
    )
  );
  globalThis.clients.claim();
});

globalThis.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  if (event.request.method !== 'GET') return;
  if (url.protocol === 'chrome-extension:') return;

  // TF.js CDN: cache-first (large files, rarely change)
  if (url.origin === TFJS_ORIGIN) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  // Next.js hashed chunks: cache-first (content-addressed, immutable)
  if (url.pathname.startsWith(NEXT_STATIC_PREFIX)) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  // All other same-origin assets: cache-first with network fallback
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (response.ok && url.origin === globalThis.location.origin) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => {
        if (event.request.mode === 'navigate') {
          return caches.match('/');
        }
      });
    })
  );
});

globalThis.addEventListener('message', event => {
  if (!event.source) return;
  if (new URL(event.source.url).origin !== globalThis.location.origin) return;
  if (event.data === 'SKIP_WAITING') globalThis.skipWaiting();
});
