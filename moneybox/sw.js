/* Cache-first with nothing behind it is how a phone ends up running last
   month's app forever: the files are already in the cache, so the network is
   never asked, so a release lands nowhere. That is what happened to the first
   version of this worker.

   So the shell is fetched from the network first and only falls back to the
   cache — when there is no signal, or when the network has not answered in a
   couple of seconds, which on a phone is the same thing as far as anyone
   waiting is concerned. Every answer that does arrive replaces what is in the
   cache, including one that arrives after the fallback has already been
   served, so the next open is current either way.

   The result: with signal you are always running what was last deployed, and
   with none you are running the last copy that reached the phone. */
/* The stylesheet and the script are asked for by version, which is what lets
   a phone still holding the first, cache-first worker escape it: those URLs
   are not in its cache, so it has to go to the network for them. Bump both
   these and the ones in index.html together on a release. */

const CACHE_NAME = 'ten-a-win-v10';
const NETWORK_WAIT_MS = 2500;
const FILES_TO_CACHE = [
  './',
  './index.html',
  './styles.css?v=10',
  './app.js?v=10',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(FILES_TO_CACHE)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

/* Scores and the bank link are somebody else's origin and are never touched
   here: a stale result would be banked as a new one. */
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.open(CACHE_NAME).then(cache => {
      /* `cache: 'no-store'` is the whole point of this line. A plain fetch()
         is answered by the browser's own HTTP cache first, and GitHub Pages
         serves these files with ten minutes of freshness on them — so a
         worker that fetches "from the network" can be handed the very copy it
         is trying to replace, and a release sits on the server while the
         phone insists it is up to date. This asks the server every time and
         falls back to the cache only when the network really is unavailable. */
      const network = fetch(event.request, { cache: 'no-store' }).then(res => {
        if (res && res.ok) cache.put(event.request, res.clone());
        return res;
      });
      const impatience = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('slow')), NETWORK_WAIT_MS);
      });
      return Promise.race([network, impatience])
        .catch(() => cache.match(event.request).then(cached => cached || network));
    })
  );
});
