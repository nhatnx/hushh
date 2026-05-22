/* =========================================================
   Hushh AI — Service Worker (Next.js)
   Navigation: network-first (auto-update on deploy)
   Next.js chunks: cache-first (immutable content hashes)
   TF.js CDN: cache-first (versioned URL, immutable)
   Other same-origin: stale-while-revalidate
   ========================================================= */

const CACHE_NAME = 'hushh-v3';

const STATIC_ASSETS = [
  '/',
  '/manifest.json',
  '/favicon.ico',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

const TFJS_ORIGIN = 'https://cdn.jsdelivr.net';
const NEXT_STATIC_PREFIX = '/_next/static/';

globalThis.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS).catch(() => {}))
  );
  globalThis.skipWaiting();
});

globalThis.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    const old = keys.filter(k => k !== CACHE_NAME);
    await Promise.all(old.map(k => caches.delete(k)));
    await globalThis.clients.claim();
    // If this is an update (old caches existed), tell all open tabs to reload
    if (old.length > 0) {
      const clients = await globalThis.clients.matchAll({ type: 'window' });
      clients.forEach(c => c.postMessage({ type: 'SW_UPDATED' }));
    }
  })());
});

globalThis.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  if (event.request.method !== 'GET') return;
  if (url.protocol === 'chrome-extension:') return;

  // TF.js CDN: cache-first (large file, versioned URL — never changes)
  if (url.origin === TFJS_ORIGIN) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(response => {
          if (response.ok) {
            caches.open(CACHE_NAME).then(c => c.put(event.request, response.clone()));
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
            caches.open(CACHE_NAME).then(c => c.put(event.request, response.clone()));
          }
          return response;
        });
      })
    );
    return;
  }

  // Navigation (HTML pages): network-first so deploys are reflected immediately
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response.ok) {
            caches.open(CACHE_NAME).then(c => c.put(event.request, response.clone()));
          }
          return response;
        })
        .catch(() =>
          caches.match(event.request).then(r => r ?? caches.match('/'))
        )
    );
    return;
  }

  // All other same-origin assets: stale-while-revalidate
  if (url.origin === globalThis.location.origin) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async cache => {
        const cached = await cache.match(event.request);
        const fresh = fetch(event.request).then(response => {
          if (response.ok) cache.put(event.request, response.clone());
          return response;
        });
        return cached ?? fresh;
      })
    );
  }
});

globalThis.addEventListener('message', event => {
  if (!event.source) return;
  if (new URL(event.source.url).origin !== globalThis.location.origin) return;
  if (event.data === 'SKIP_WAITING') globalThis.skipWaiting();
});
