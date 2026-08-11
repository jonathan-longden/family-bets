const CACHE_NAME = 'arsenal-bet-cache-v5';
const FILES_TO_CACHE = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png'];
const NET_TIMEOUT = 4000;

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

/* Network first, cache second.

   Answering from the cache first looks right for an app that has to work
   offline, and it quietly freezes the app: once a phone has the page cached
   it never sees another version. The cache is what keeps it working with no
   signal, not what decides which version you get. The network gets a few
   seconds before the cached copy is used instead. */
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

self.addEventListener('fetch', event => {
  const req = event.request;
  // Firebase and anything else off this origin is left well alone
  if (req.method !== 'GET' || !req.url.startsWith(self.location.origin)) return;
  event.respondWith(networkFirst(req));
});
