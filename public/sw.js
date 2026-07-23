/* =========================================================
   Hushh AI — Service Worker (Next.js)
   Navigation: network-first (auto-update on deploy)
   Next.js chunks: cache-first (immutable content hashes)
   TF.js CDN: cache-first (versioned URL, immutable)
   Other same-origin: stale-while-revalidate
   Updates: new SW waits until the user accepts the in-app
   update banner (SKIP_WAITING message), then SW_UPDATED
   reloads every open tab.
   ========================================================= */

// Version comes from the registration URL (/sw.js?v=<build id> — see HushhApp.tsx).
// public/ files are served verbatim by the static export, so process.env is NOT
// substituted here; the query param is the only way to inject the build id.
const VERSION = new URLSearchParams(globalThis.location.search).get('v') || 'v6';
const CACHE_NAME = `hushh-${VERSION}`;

const STATIC_ASSETS = [
  '/',
  '/manifest.json',
  '/favicon.ico',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  // Model topology descriptor — tiny, always available offline
  '/models/hushh-base.json',
];

const TFJS_ORIGIN = 'https://cdn.jsdelivr.net';
const NEXT_STATIC_PREFIX = '/_next/static/';

globalThis.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS).catch(() => { }))
  );
  // No skipWaiting() here — the new SW stays in "waiting" until the user
  // accepts the update banner, which posts SKIP_WAITING (handler below).
});

globalThis.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    // Keep hushh-models-v1 (community model weights, managed by page code)
    const old = keys.filter(k => k !== CACHE_NAME && k !== 'hushh-models-v1');
    await Promise.all(old.map(k => caches.delete(k)));
    await globalThis.clients.claim();
    // If this is an update (old caches existed), tell all open tabs to reload
    if (old.length > 0) {
      const clients = await globalThis.clients.matchAll({ type: 'window' });
      clients.forEach(c => c.postMessage({ type: 'SW_UPDATED' }));
    }
  })());
});

/* Cache-first: serve from cache, otherwise fetch and cache. For immutable URLs. */
function cacheFirst(request) {
  return caches.match(request).then(cached => {
    if (cached) return cached;
    return fetch(request).then(response => {
      if (response.ok) {
        // Clone before returning — the body starts streaming to the page
        // immediately, and a deferred clone() would find it already used
        const copy = response.clone();
        caches.open(CACHE_NAME).then(c => c.put(request, copy)).catch(() => { });
      }
      return response;
    });
  });
}

globalThis.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  if (event.request.method !== 'GET') return;
  if (url.protocol === 'chrome-extension:') return;

  // TF.js CDN and Next.js hashed chunks: cache-first (versioned/content-addressed, immutable)
  if (url.origin === TFJS_ORIGIN || url.pathname.startsWith(NEXT_STATIC_PREFIX)) {
    event.respondWith(cacheFirst(event.request));
    return;
  }

  // Navigation (HTML pages): network-first so deploys are reflected immediately
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then(c => c.put(event.request, copy)).catch(() => { });
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
  if (event.origin !== globalThis.location.origin) {
    return;
  }
  if (!event.source) {
    return;
  }
  if (new URL(event.source.url).origin !== globalThis.location.origin) {
    return;
  }
  if (event.data === 'SKIP_WAITING') {
    globalThis.skipWaiting();
  }
});
