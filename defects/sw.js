const CACHE_NAME = 'defect-log-v1';
const FILES_TO_CACHE = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
];
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
  if (!req.url.startsWith(self.location.origin)) return;
  event.respondWith(networkFirst(req));
});
