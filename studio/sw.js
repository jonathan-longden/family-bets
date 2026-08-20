const CACHE_NAME = 'takeone-cache-v1';
const FILES_TO_CACHE = [
  './', './index.html', './styles.css', './app.js', './recorder-processor.js',
  './audio/dsp.js', './audio/analyse.js', './audio/process.js', './audio/wav.js',
  './audio/engine.js', './audio/worker.js', './audio/monitor.js',
  './manifest.json', './icon-192.png', './icon-512.png',
];
const NET_TIMEOUT = 4000;

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

   Cache first looks right for an app that has to work offline and is a trap:
   once the shell is in the cache it is served forever, so a device that
   visited early never sees another version of the app again. Going to the
   network first means a deploy lands on the next load; the cache is what
   makes it work with no signal, not what decides which version you get.

   Takes never come through here at all — they live in IndexedDB. */
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
  if (req.method !== 'GET' || !req.url.startsWith(self.location.origin)) return;
  event.respondWith(networkFirst(req));
});
