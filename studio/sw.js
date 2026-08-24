const CACHE_NAME = 'takeone-cache-v3';
const FILES_TO_CACHE = [
  './', './index.html', './styles.css', './app.js',
  './recorder-processor.js', './live-tuner-processor.js',
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

/* Going to the network is not enough on its own. The reply still carries the
   max-age Pages put on it, so the browser keeps its own copy and answers the
   next load from that — without the network and without this worker, which
   never gets asked and never learns there is a new build. Handing back a copy
   the browser is not allowed to keep is what makes the next load ask again.
   The cache keeps the original, headers and all, for being offline. */
async function unstorable(res) {
  const headers = new Headers(res.headers);
  headers.set('Cache-Control', 'no-store');
  return new Response(await res.blob(), {
    status: res.status, statusText: res.statusText, headers
  });
}

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
      /* cache:'reload' is what makes this network first rather than
         HTTP-cache first. Handing the page's own request back to fetch lets the
         browser answer from its own cache — Pages serves max-age=600 — so a
         deploy could sit unseen for ten minutes behind a worker that believed
         it had just been to the network. */
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

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || !req.url.startsWith(self.location.origin)) return;
  event.respondWith(networkFirst(req));
});
