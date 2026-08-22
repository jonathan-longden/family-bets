const CACHE_NAME = 'tunage-cache-v34';
const FILES_TO_CACHE = [
  './', './index.html', './styles.css', './app.js',
  './manifest.json', './icon-192.png', './icon-512.png',
];
const NET_TIMEOUT = 4000;

/* No skipWaiting here on purpose. A new worker installs and then waits, and
   the page decides when it takes over — which is never in the middle of a
   track. The page asks by sending 'skip'. */
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(FILES_TO_CACHE)));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* Network first, cache second.

   Cache first looks right for an offline app and is a trap: once the shell is
   in the cache it is served forever, so a device that visited early never sees
   another version of the app again. Going to the network first means a deploy
   lands on the next load; the cache is what makes it work with no signal, not
   what decides which version you get.

   The network gets a few seconds before the cached copy is used instead, so a
   weak signal doesn't leave someone staring at a blank screen. The music never
   comes through here at all — it lives in IndexedDB. */
async function networkFirst(req) {
  const cache = await caches.open(CACHE_NAME);

  try {
    const res = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('slow network')), NET_TIMEOUT);
      fetch(req).then(r => { clearTimeout(timer); resolve(r); },
        e => { clearTimeout(timer); reject(e); });
    });
    if (res && res.ok) cache.put(req, res.clone()).catch(() => {});
    return res;
  } catch {
    const hit = await cache.match(req);
    if (hit) return hit;
    if (req.mode === 'navigate') {
      const shell = await cache.match('./index.html');
      if (shell) return shell;
    }
    throw new Error('offline and not cached');
  }
}

/* So the page can say which version it is running, from one source of truth. */
self.addEventListener('message', event => {
  const data = event.data || {};
  if (data.type === 'skip') return self.skipWaiting();
  if (data.type === 'version' && event.ports && event.ports[0]) {
    event.ports[0].postMessage(CACHE_NAME);
  }
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || !req.url.startsWith(self.location.origin)) return;
  event.respondWith(networkFirst(req));
});
