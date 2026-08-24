/* Seoul–Tokyo 2026 · offline service worker
   Strategy: cache-first with background refresh (stale-while-revalidate) for the app shell
   and fonts; network passthrough for live APIs (weather has its own baked-in fallback). */
const CACHE_PREFIX = 'st26-';
const CACHE = 'st26-v8';
const CORE = ['./', 'index.html', 'manifest.json', 'apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith(CACHE_PREFIX) && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  const isShell = url.origin === location.origin;
  const isFont = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (!isShell && !isFont) return; // live APIs (weather etc.) go straight to network

  // The itinerary changes right up to departure. Prefer the newest document
  // online, but keep the last good copy available on a plane or with bad data.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req, { cache: 'no-cache' })
        .then(res => {
          if (!res.ok) throw new Error(`navigation ${res.status}`);
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req, { ignoreSearch: true }).then(cached => cached || caches.match('./index.html')))
    );
    return;
  }

  e.respondWith(
    caches.match(req, { ignoreSearch: isShell }).then(cached => {
      const refresh = fetch(req)
        .then(res => {
          if (res && (res.ok || res.type === 'opaque')) {
            const copy = res.clone();
            caches.open(CACHE).then(c => c.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || refresh;
    })
  );
});
