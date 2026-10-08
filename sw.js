/* Bump CACHE every time you deploy a change — changing this file's bytes is what
   makes the browser notice there's an update at all (identical sw.js = no update check). */
const CACHE = 'gymapp-cache-v8';

/* CORE files are required for the app to work: the install is all-or-nothing
   for these. If any of them fails to download (bad gym signal, timeout), the
   install FAILS and the browser keeps running the previous, complete version —
   so a half-downloaded update can never replace a working offline app. */
const CORE = ['./', './index.html', './style.css', './app.js', './boot.js', './manifest.json'];
/* Nice-to-have files: cached when possible, never block the install. */
const OPTIONAL = ['./icon.svg', './icon-192.png', './icon-512.png', './apple-touch-icon.png'];

const INSTALL_TIMEOUT = 25000;  // ms per file while installing
const REVALIDATE_TIMEOUT = 8000; // ms for a background refresh
const FIRST_LOAD_TIMEOUT = 8000; // ms to wait for the network when NOT cached

/* fetch() that gives up after `ms` — on a flaky "one bar" connection a request
   can hang for minutes; we never want the app to wait on that. */
function fetchWithTimeout(request, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return fetch(request, { signal: ctrl.signal }).finally(() => clearTimeout(timer));
}

/* Cache key without the query string, so "index.html?source=pwa" and
   "index.html" are the same entry. */
function keyFor(url) {
  return new Request(url.origin + url.pathname);
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // cache: 'reload' bypasses the browser HTTP cache, so we never store a stale copy
    await Promise.all(CORE.map(async (url) => {
      const res = await fetchWithTimeout(new Request(url, { cache: 'reload' }), INSTALL_TIMEOUT);
      if (!res.ok) throw new Error('precache failed: ' + url + ' (' + res.status + ')');
      await cache.put(url, res);
    }));
    await Promise.all(OPTIONAL.map((url) =>
      fetchWithTimeout(new Request(url, { cache: 'reload' }), INSTALL_TIMEOUT)
        .then((res) => (res.ok ? cache.put(url, res) : null))
        .catch(() => {})
    ));
    await self.skipWaiting();
  })());
});

/* Runs only after a SUCCESSFUL install, so old caches are removed only once the
   new one is known to be complete. */
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter((k) => k.startsWith('gymapp-cache-') && k !== CACHE).map((k) => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

/* Cache-first with background refresh:
   - If we have the file cached, answer IMMEDIATELY from cache (the app opens
     instantly with zero signal or a hanging connection) and refresh quietly.
   - Navigations always fall back to the cached index.html.
   - If it isn't cached, try the network with a timeout; and as a last resort
     return a real (503) response instead of failing the request, which is what
     produces the browser's "no connection" dinosaur page. */
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(handle(event, req, url));
});

async function handle(event, req, url) {
  const isNav = req.mode === 'navigate';
  const cache = await caches.open(CACHE);
  const key = keyFor(url);

  let cached = await cache.match(key, { ignoreSearch: true });
  if (!cached && isNav) cached = (await cache.match('./index.html')) || (await cache.match('./'));
  // current cache incomplete? an older version is still better than nothing
  if (!cached) cached = await caches.match(key, { ignoreSearch: true });
  if (!cached && isNav) cached = await caches.match('./index.html');

  const refresh = fetchWithTimeout(req, cached ? REVALIDATE_TIMEOUT : FIRST_LOAD_TIMEOUT)
    .then((res) => {
      if (res && res.status === 200 && res.type === 'basic') cache.put(key, res.clone());
      return res;
    })
    .catch(() => null);

  if (cached) {
    event.waitUntil(refresh); // keep the worker alive until the background refresh finishes
    return cached;
  }

  const fresh = await refresh;
  if (fresh) return fresh;

  return new Response(
    isNav
      ? '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
        + '<body style="font-family:sans-serif;background:#0b0f16;color:#eef1f8;padding:32px;text-align:center">'
        + '<h2>GymApp</h2><p>Sem conexão e o app ainda não foi salvo neste aparelho.</p>'
        + '<p>Abra uma vez com internet (Wi-Fi) para liberar o uso offline.</p></body>'
      : '',
    { status: 503, headers: { 'Content-Type': isNav ? 'text/html; charset=utf-8' : 'text/plain' } }
  );
}

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
