const CACHE_NAME = 'defect-log-v17';
const FILES_TO_CACHE = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './vendor/leaflet.js', './vendor/leaflet.css',
];
/* Map tiles are somebody else's server and there are a great many of them, so
   they are cached as they are fetched rather than up front — ground you have
   looked at stays available, ground you have not does not. */
const TILE_HOST = 'https://tile.openstreetmap.org';
/* The detection library is six megabytes. Precaching it would make the first
   visit pay for it before the camera even opens, so it is left to be cached the
   first time a capture actually needs it — after which it is there offline. */
const NET_TIMEOUT = 4000;
const FONT_HOSTS = ['https://fonts.googleapis.com', 'https://fonts.gstatic.com'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(FILES_TO_CACHE)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* Network first, cache second.

   Cache first looks right for something that has to work at the roadside and
   is a trap: once the shell is in the cache it is served forever, so a phone
   that visited early never sees another version of the app. Going to the
   network first means a deploy lands on the next load; the cache is what makes
   it work with no signal, not what decides which version you get.

   Defects themselves never come through here — they live in IndexedDB. */
async function networkFirst(req) {
  const cache = await caches.open(CACHE_NAME);
  try {
    /* cache:'reload' is what makes this network first rather than
       HTTP-cache first. Passing the page's own request back to fetch lets the
       browser answer from its own cache — Pages serves max-age=600 — so a
       deploy could sit unseen for ten minutes behind a worker that believed it
       had just been to the network. */
    const res = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('slow network')), NET_TIMEOUT);
      fetch(req.url, { cache: 'reload', credentials: 'same-origin' })
        .then(r => { clearTimeout(timer); resolve(r); },
          e => { clearTimeout(timer); reject(e); });
    });
    if (res && res.ok) cache.put(req, res.clone()).catch(() => {});
    return unstorable(res);
  } catch {
    const hit = await cache.match(req);
    if (hit) return unstorable(hit);
    if (req.mode === 'navigate') {
      const shell = await cache.match('./index.html');
      if (shell) return unstorable(shell);
    }
    throw new Error('offline and not cached');
  }
}

/* Going to the network is not enough on its own. The reply still carries the
   max-age Pages put on it, so the browser keeps its own copy and answers the
   next load from that — without the network and without this worker, which
   never gets asked and never learns there is a new build. Handing back a copy
   the browser is not allowed to keep is what makes the next load ask again.
   The cache above keeps the original, headers and all, for being offline. */
async function unstorable(res) {
  const headers = new Headers(res.headers);
  headers.set('Cache-Control', 'no-store');
  return new Response(await res.blob(), {
    status: res.status, statusText: res.statusText, headers
  });
}

/* The two typefaces are the exception: they never change under a given URL, and
   a condensed face that only arrives when there's signal is exactly the wrong
   way round for a van in a lay-by. Cache first, keep them. */
async function cacheFirst(req) {
  const cache = await caches.open(CACHE_NAME);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone()).catch(() => {});
  return res;
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  if (FONT_HOSTS.some(h => req.url.startsWith(h))) return event.respondWith(cacheFirst(req));
  if (req.url.startsWith(TILE_HOST)) return event.respondWith(cacheFirst(req));
  if (!req.url.startsWith(self.location.origin)) return;
  event.respondWith(networkFirst(req));
});
