/* Step Out's service worker.

   Two jobs, and the second one is the reason the app exists at all.

   The first is the shell: fetch from the network, fall back to the cache, so
   that with signal you are running what was last deployed and with none you
   are running the last copy that reached the phone. Cache-first with nothing
   behind it is how a phone ends up running last month's app forever.

   The second is the nudge. A page with no server behind it cannot be pushed
   to, so the only way this app speaks while it is closed is Periodic
   Background Sync: the browser wakes the worker every so often, and the
   worker asks the same question the open app would — is a window about to
   start — using the same code, loaded here rather than copied. */

importScripts('forecast.js?v=1');

const CACHE_NAME = 'step-out-v1';
const NETWORK_WAIT_MS = 2500;
const FILES_TO_CACHE = [
  './',
  './index.html',
  './styles.css?v=1',
  './forecast.js?v=1',
  './app.js?v=1',
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

/* The forecast itself is somebody else's origin and is never cached here: a
   stale one would send somebody out into rain that stopped being a forecast
   an hour ago. The app keeps its own copy of the last one it saw, which it
   labels as old rather than passing off as current. */
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.open(CACHE_NAME).then(cache => {
      /* `cache: 'no-store'` matters: a plain fetch() is answered by the
         browser's own HTTP cache first, and a static host serves these files
         with minutes of freshness on them — so a worker that fetches "from
         the network" can be handed the very copy it is trying to replace. */
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

/* ---------------------------------------------------------------- the nudge */

const S = self.StepOut;

async function considerNudging() {
  const settings = await S.kv.get('settings');
  if (!settings || !settings.place || !settings.notify) return;

  const log = (await S.kv.get('log')) || S.emptyLog();
  const now = Math.floor(Date.now() / 1000);

  /* Cheap check first: quiet hours and the daily allowance can rule the whole
     thing out without spending a request on somebody's data plan. A rough
     offset is enough for that — the exact one arrives with the forecast, and
     `dueNudge` checks again properly with it. */
  if (settings.snoozeUntil && now < settings.snoozeUntil) return;

  const res = await fetch(S.forecastUrl(settings.place, 2), { cache: 'no-store' });
  if (!res.ok) return;
  const forecast = S.parse(await res.json(), settings.place);

  const due = S.dueNudge(forecast, settings, log, now);
  if (!due) return;

  const streak = S.streak(settings.outings || [], forecast.offset, now);
  const note = S.notificationFor(due.window, forecast, settings, streak, now);

  await self.registration.showNotification(note.title, {
    body: note.body,
    tag: note.tag,
    icon: 'icon-192.png',
    badge: 'icon-192.png',
    renotify: true,
    data: { url: './' }
  });

  await S.kv.set('log', S.rememberSent(log, note.key, now));

  /* If the app happens to be open somewhere, tell it — so it does not decide
     to send the same nudge itself a minute later. */
  const clients = await self.clients.matchAll({ type: 'window' });
  clients.forEach(client => client.postMessage({ type: 'nudged', key: note.key }));
}

self.addEventListener('periodicsync', event => {
  if (event.tag !== 'step-out-nudge') return;
  event.waitUntil(considerNudging().catch(() => {}));
});

/* Some browsers will run a one-off sync but not a periodic one. It is worth
   little on its own — it fires when connectivity returns rather than on a
   schedule — but it costs nothing to answer. */
self.addEventListener('sync', event => {
  if (event.tag !== 'step-out-nudge') return;
  event.waitUntil(considerNudging().catch(() => {}));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clients) {
      if (client.url.indexOf(self.registration.scope) === 0 && 'focus' in client) return client.focus();
    }
    if (self.clients.openWindow) return self.clients.openWindow('./');
  })());
});
