/* Bloody Weather's service worker.

   One job now, and only one: keep the app itself on the phone so it opens
   instantly and still opens with no signal at all. There is no background
   work, no scheduled wake-up and nothing that can send you a notification —
   this app has nothing to nag you about.

   The shell is fetched from the network first and falls back to the cache,
   because cache-first with nothing behind it is how a phone ends up running
   last month's app forever. */

const CACHE_NAME = 'bloody-weather-v3';
const NETWORK_WAIT_MS = 2500;
const FILES_TO_CACHE = [
  './',
  './index.html',
  './styles.css?v=3',
  './brand.js?v=3',
  './weather.js?v=3',
  './voice.js?v=3',
  './app.js?v=3',
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
      /* Anything from the app this one replaced goes too. */
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => {
        /* The app this one replaced asked the browser to wake it up in the
           background. Nothing here listens for that any more, so the standing
           request is cancelled rather than left to fire into an empty room. */
        if (self.registration.periodicSync) {
          return self.registration.periodicSync.unregister('step-out-nudge').catch(() => {});
        }
      })
      .then(() => self.clients.claim())
  );
});

/* The forecast is somebody else's origin and is never cached here: a stale one
   served as if it were current would make the app a liar. The page keeps its
   own copy of the last forecast it saw and labels it as saved. */
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.open(CACHE_NAME).then(cache => {
      /* `cache: 'no-store'` matters: a plain fetch() is answered by the
         browser's own HTTP cache first, and a static host serves these files
         with minutes of freshness on them — so a worker that fetches "from the
         network" can be handed the very copy it is trying to replace. */
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
