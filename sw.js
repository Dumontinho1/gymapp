/* Bump CACHE every time you deploy a change — changing this file's bytes is what
   makes the browser notice there's an update at all (identical sw.js = no update check). */
const CACHE = 'gymapp-cache-v5';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icon.svg',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png'
];

/* Each asset is cached individually so one missing file (e.g. an icon that
   wasn't uploaded) can't make the whole install fail and block updates. */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => Promise.all(ASSETS.map((a) => cache.add(a).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

/* Stale-while-revalidate: the cached copy answers IMMEDIATELY (so the app opens
   instantly even with zero/flaky signal — no waiting on a network request that
   might hang), while a fresh copy is fetched quietly in the background to
   update the cache for next time. Only complete 200 responses are cached, and
   the background refresh is kept alive with waitUntil so it can finish. */
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  if (new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.open(CACHE).then((cache) =>
      cache.match(event.request).then((cached) => {
        const network = fetch(event.request)
          .then((res) => {
            if (res && res.status === 200) cache.put(event.request, res.clone());
            return res;
          })
          .catch(() => null);
        if (cached) {
          event.waitUntil(network);
          return cached;
        }
        return network.then((res) => res || caches.match('./index.html'));
      })
    )
  );
});

/* Tapping a rest-timer notification brings the app back to the foreground. */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clients) => {
      if (clients.length > 0) return clients[0].focus();
      return self.clients.openWindow('./');
    })
  );
});
