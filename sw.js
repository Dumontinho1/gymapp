/* Bump CACHE every time you deploy a change — changing this file's bytes is what
   makes the browser notice there's an update at all (identical sw.js = no update check). */
const CACHE = 'gymapp-cache-v4';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icon.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
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
   update the cache for next time. */
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.open(CACHE).then((cache) =>
      cache.match(event.request).then((cached) => {
        const network = fetch(event.request)
          .then((res) => { cache.put(event.request, res.clone()); return res; })
          .catch(() => null);
        return cached || network.then((res) => res || caches.match('./index.html'));
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
