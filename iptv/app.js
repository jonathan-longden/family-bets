/* Tuner — a private player for an IPTV playlist you already have.
   It ships with no channels: you load your own M3U, it's parsed and kept in
   IndexedDB on the device, and nothing is ever sent anywhere. HLS plays
   natively on Safari and through hls.js everywhere else. No build step. */

/* ───────────────────────── helpers ───────────────────────── */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));

const SETTINGS_KEY = 'tuner.settings';
const HLS_CDN = 'https://cdn.jsdelivr.net/npm/hls.js@1/dist/hls.min.js';
const RENDER_STEP = 60;        // rows added per scroll-in, playlists run to thousands
const OPEN_TIMEOUT = 14000;    // how long a channel gets before it's called dead
const EPG_MAX_AGE = 6 * 3600e3;
const RECENT_MAX = 30;

const norm = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

function plural(n, one, many) {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

function ago(ts) {
  if (!ts) return 'never';
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 90) return 'just now';
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  if (s < 172800) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
}

function hhmm(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function httpish(u) {
  return typeof u === 'string' && /^https?:\/\//i.test(u);
}

let toastTimer = null;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2800);
}

/* ───────────────────────── settings ───────────────────────── */

const defaults = {
  activeId: null,
  favs: [],           // normalised channel names
  recents: [],        // normalised channel names, newest first
  lastKey: null,
  epgUrl: '',
  volume: 1,
  muted: false,
  resume: true,
  autoplay: true,
};

let settings = load();

function load() {
  try {
    return Object.assign({}, defaults, JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'));
  } catch {
    return { ...defaults };
  }
}

function save() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch {}
}

/* ───────────────────────── storage (IndexedDB) ─────────────────────────
   Playlist metadata is small, but the channel arrays are not — a full
   provider list is tens of thousands of entries, well past what localStorage
   will hold. Each playlist's channels are stored as one record. */

const DB_NAME = 'tuner';
let dbPromise = null;

function db() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains('playlists')) d.createObjectStore('playlists', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('channels')) d.createObjectStore('channels');
      if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(store, mode, fn) {
  return db().then(d => new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => resolve(req && req.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

const store = {
  allPlaylists: () => tx('playlists', 'readonly', s => s.getAll()),
  putPlaylist: p => tx('playlists', 'readwrite', s => s.put(p)),
  delPlaylist: id => tx('playlists', 'readwrite', s => s.delete(id)),
  getChannels: id => tx('channels', 'readonly', s => s.get(id)),
  putChannels: (id, list) => tx('channels', 'readwrite', s => s.put(list, id)),
  delChannels: id => tx('channels', 'readwrite', s => s.delete(id)),
  getMeta: k => tx('meta', 'readonly', s => s.get(k)),
  putMeta: (k, v) => tx('meta', 'readwrite', s => s.put(v, k)),
  delMeta: k => tx('meta', 'readwrite', s => s.delete(k)),
};

/* ───────────────────────── M3U parsing ─────────────────────────
   Providers are loose with the format, so this is deliberately forgiving:
   attributes in any order, #EXTGRP as an alternative to group-title, player
   directives (#EXTVLCOPT, #KODIPROP) skipped, and a bare list of URLs with no
   #EXTINF lines at all still produces channels. */

function attrs(s) {
  const out = {};
  const re = /([\w-]+)\s*=\s*"([^"]*)"/g;
  let m;
  while ((m = re.exec(s))) out[m[1].toLowerCase()] = m[2];
  return out;
}

/* The display name is whatever follows the first comma that isn't inside a
   quoted attribute — group titles like "Sports, UK" would break a naive split
   on the last comma. */
function splitExtinf(line) {
  let quoted = false;
  for (let i = 8; i < line.length; i++) {
    const c = line[i];
    if (c === '"') quoted = !quoted;
    else if (c === ',' && !quoted) return [line.slice(8, i), line.slice(i + 1)];
  }
  return [line.slice(8), ''];
}

function nameFromUrl(url) {
  try {
    const path = new URL(url, location.href).pathname;
    const last = decodeURIComponent(path.split('/').filter(Boolean).pop() || '');
    return last.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[_-]+/g, ' ').trim() || url;
  } catch {
    return url;
  }
}

function parseM3U(text) {
  const lines = String(text).split(/\r?\n/);
  const channels = [];
  let pending = null;
  let group = '';
  let epgUrl = '';

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    if (line.startsWith('#EXTM3U')) {
      const a = attrs(line);
      epgUrl = epgUrl || a['url-tvg'] || a['x-tvg-url'] || a['tvg-url'] || '';
      continue;
    }

    if (line.startsWith('#EXTINF:')) {
      const [head, name] = splitExtinf(line);
      const a = attrs(head);
      pending = {
        name: (name || a['tvg-name'] || '').trim(),
        tvgId: a['tvg-id'] || '',
        logo: httpish(a['tvg-logo']) ? a['tvg-logo'] : '',
        group: (a['group-title'] || '').trim(),
      };
      continue;
    }

    if (line.startsWith('#EXTGRP:')) {
      group = line.slice(8).trim();
      continue;
    }

    if (line.startsWith('#')) continue;   // #EXTVLCOPT, #KODIPROP, comments

    // anything left is a stream URL, and it closes off the entry before it
    const url = line;
    const entry = pending || { name: nameFromUrl(url), tvgId: '', logo: '', group: '' };
    channels.push({
      id: uid(),
      name: entry.name || nameFromUrl(url),
      url,
      tvgId: entry.tvgId,
      logo: entry.logo,
      group: entry.group || group || 'Ungrouped',
    });
    pending = null;
  }

  return { channels, epgUrl };
}

/* ───────────────────────── loading a playlist ───────────────────────── */

function xtreamUrls(host, user, pass) {
  const base = host.replace(/\/+$/, '');
  const q = `username=${encodeURIComponent(user)}&password=${encodeURIComponent(pass)}`;
  return {
    m3u: `${base}/get.php?${q}&type=m3u_plus&output=ts`,
    epg: `${base}/xmltv.php?${q}`,
  };
}

async function fetchText(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`the server answered ${res.status}`);
  return res.text();
}

/* Fetching someone else's server from a web page only works if that server
   allows it, and plenty of providers don't. Say so plainly rather than
   leaving a bare "Failed to fetch". */
function fetchAdvice(err) {
  const msg = String(err && err.message || err);
  if (/failed to fetch|networkerror|load failed/i.test(msg)) {
    return "The browser couldn't load that link. Providers often block web pages from reading their playlist (CORS). Download the .m3u file and add it from the File tab instead.";
  }
  return `Couldn't load that playlist — ${msg}.`;
}

async function importPlaylist({ name, source, text }) {
  const { channels, epgUrl } = parseM3U(text);
  if (!channels.length) throw new Error('no channels found in that playlist');

  const id = source.id || uid();
  const record = {
    id,
    name: name || source.label || 'Playlist',
    source: { type: source.type, url: source.url || '', fileName: source.fileName || '' },
    addedAt: source.addedAt || Date.now(),
    updatedAt: Date.now(),
    count: channels.length,
  };

  await store.putChannels(id, channels);
  await store.putPlaylist(record);

  if (epgUrl && !settings.epgUrl && httpish(epgUrl)) {
    settings.epgUrl = epgUrl;
    save();
    loadEpg().catch(() => {});
  }
  return record;
}

/* ───────────────────────── the TV guide (XMLTV) ───────────────────────── */

let epg = { index: new Map(), url: '', fetchedAt: 0 };

function parseXmltvTime(s) {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?\s*([+-]\d{4})?/.exec(String(s).trim());
  if (!m) return 0;
  const [, y, mo, d, h, mi, sec, off] = m;
  let t = Date.UTC(+y, +mo - 1, +d, +h, +mi, +(sec || 0));
  if (off) {
    const sign = off[0] === '-' ? -1 : 1;
    t -= sign * ((+off.slice(1, 3)) * 3600e3 + (+off.slice(3, 5)) * 60e3);
  }
  return t;
}

async function fetchXmltv(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`the guide server answered ${res.status}`);
  // providers commonly serve the guide gzipped
  if (/\.gz(\?|$)/i.test(url) && res.body && 'DecompressionStream' in window) {
    const stream = res.body.pipeThrough(new DecompressionStream('gzip'));
    return new Response(stream).text();
  }
  return res.text();
}

/* Only the day either side of now is kept — a full XMLTV file can cover a
   fortnight and there's no reason to hold all of it in memory. */
function parseEpg(xml) {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  if (doc.querySelector('parsererror')) throw new Error("that guide file isn't valid XML");

  const from = Date.now() - 3600e3;
  const to = Date.now() + 26 * 3600e3;
  const index = new Map();

  for (const p of doc.getElementsByTagName('programme')) {
    const start = parseXmltvTime(p.getAttribute('start'));
    const stop = parseXmltvTime(p.getAttribute('stop')) || start + 1800e3;
    if (stop < from || start > to) continue;

    const ch = p.getAttribute('channel') || '';
    if (!ch) continue;
    const titleEl = p.getElementsByTagName('title')[0];
    const title = titleEl ? titleEl.textContent.trim() : '';
    if (!title) continue;

    if (!index.has(ch)) index.set(ch, []);
    index.get(ch).push({ start, stop, title });
  }

  for (const list of index.values()) list.sort((a, b) => a.start - b.start);
  return index;
}

async function loadEpg({ force = false } = {}) {
  const url = settings.epgUrl;
  const statusEl = $('#epgStatus');

  if (!httpish(url)) {
    epg = { index: new Map(), url: '', fetchedAt: 0 };
    if (statusEl) statusEl.textContent = 'No guide link set.';
    return;
  }

  if (!force) {
    const cached = await store.getMeta('epg').catch(() => null);
    if (cached && cached.url === url && Date.now() - cached.fetchedAt < EPG_MAX_AGE) {
      epg = { index: new Map(Object.entries(cached.index)), url, fetchedAt: cached.fetchedAt };
      epgLoaded();
      return;
    }
  }

  if (statusEl) statusEl.textContent = 'Loading the guide…';
  try {
    const index = parseEpg(await fetchXmltv(url));
    epg = { index, url, fetchedAt: Date.now() };
    await store.putMeta('epg', {
      url, fetchedAt: epg.fetchedAt, index: Object.fromEntries(index),
    }).catch(() => {});
    epgLoaded();
  } catch (err) {
    if (statusEl) statusEl.textContent = fetchAdvice(err);
  }
}

function epgLoaded() {
  epgByName = null;
  const statusEl = $('#epgStatus');
  if (statusEl) {
    statusEl.textContent = epg.index.size
      ? `Guide loaded for ${plural(epg.index.size, 'channel', 'channels')}, ${ago(epg.fetchedAt)}.`
      : 'That guide had nothing in it for the next day.';
  }
  refreshEpgUi();
}

/* A channel is matched to the guide by tvg-id, falling back to its name —
   plenty of playlists leave tvg-id off entirely. */
let epgByName = null;

function epgFor(ch) {
  if (!epg.index.size) return null;
  let list = ch.tvgId && epg.index.get(ch.tvgId);
  if (!list) {
    if (!epgByName) {
      epgByName = new Map();
      for (const [id, progs] of epg.index) epgByName.set(norm(id), progs);
    }
    list = epgByName.get(norm(ch.name));
  }
  if (!list) return null;

  const now = Date.now();
  const i = list.findIndex(p => p.start <= now && p.stop > now);
  if (i === -1) return null;
  return { now: list[i], next: list[i + 1] || null };
}

/* ───────────────────────── app state ───────────────────────── */

let playlists = [];
let channels = [];        // the active playlist
let byId = new Map();     // channel id → channel, for the rendered rows
let view = [];            // after group + search
let shown = 0;            // how much of `view` is on screen
let group = 'all';
let query = '';
let current = null;
let playToken = 0;
let hls = null;

const video = $('#video');

const isFav = ch => settings.favs.includes(norm(ch.name));

/* ───────────────────────── channel list ───────────────────────── */

function buildGroups() {
  const counts = new Map();
  for (const ch of channels) counts.set(ch.group, (counts.get(ch.group) || 0) + 1);

  const box = $('#groups');
  box.innerHTML = '';

  const fixed = [
    { key: 'all', label: `All (${channels.length.toLocaleString()})` },
    { key: 'fav', label: `★ Favourites (${channels.filter(isFav).length})` },
  ];
  if (settings.recents.length) fixed.push({ key: 'recent', label: 'Recent' });

  const named = [...counts.keys()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

  for (const g of [...fixed, ...named.map(g => ({ key: 'g:' + g, label: `${g} (${counts.get(g)})` }))]) {
    const b = document.createElement('button');
    b.className = 'chip' + (group === g.key ? ' on' : '');
    b.textContent = g.label;
    b.onclick = () => { group = g.key; buildGroups(); applyFilter(); };
    box.appendChild(b);
  }
}

function applyFilter() {
  const terms = query.split(/\s+/).filter(Boolean);

  let base = channels;
  if (group === 'fav') {
    base = channels.filter(isFav);
  } else if (group === 'recent') {
    const order = new Map(settings.recents.map((k, i) => [k, i]));
    base = channels.filter(ch => order.has(norm(ch.name)))
      .sort((a, b) => order.get(norm(a.name)) - order.get(norm(b.name)));
  } else if (group.startsWith('g:')) {
    const g = group.slice(2);
    base = channels.filter(ch => ch.group === g);
  }

  view = terms.length
    ? base.filter(ch => {
        const hay = (ch.name + ' ' + ch.group).toLowerCase();
        return terms.every(t => hay.includes(t));
      })
    : base;

  shown = 0;
  $('#channels').innerHTML = '';
  renderMore();

  const empty = $('#empty');
  const nothing = view.length === 0;
  empty.hidden = !nothing;
  if (nothing) {
    $('#emptyText').textContent = !channels.length
      ? 'No playlist loaded yet.'
      : group === 'fav' ? 'No favourites yet — tap the star on a channel.'
      : query ? `Nothing matching "${query}".`
      : 'Nothing in this group.';
    $('#emptyAdd').hidden = channels.length > 0;
  }
}

function rowSub(ch) {
  const guide = epgFor(ch);
  if (guide) return { text: guide.now.title, live: true, group: ch.group };
  return { text: ch.group, live: false, group: ch.group };
}

function makeRow(ch) {
  const li = document.createElement('li');
  li.dataset.id = ch.id;
  if (current && current.id === ch.id) li.className = 'on';

  const box = document.createElement('div');
  box.className = 'logo-box';
  if (ch.logo) {
    const img = document.createElement('img');
    img.loading = 'lazy';
    img.decoding = 'async';
    img.alt = '';
    img.src = ch.logo;
    img.onerror = () => { img.remove(); box.textContent = ch.name.slice(0, 2).toUpperCase(); };
    box.appendChild(img);
  } else {
    box.textContent = ch.name.slice(0, 2).toUpperCase();
  }

  const text = document.createElement('div');
  text.className = 'ch-text';
  const name = document.createElement('div');
  name.className = 'ch-name';
  name.textContent = ch.name;
  const sub = document.createElement('div');
  sub.className = 'ch-sub';
  const info = rowSub(ch);
  sub.textContent = info.text;
  if (info.live) sub.classList.add('now');
  text.append(name, sub);

  const star = document.createElement('button');
  star.className = 'icon-btn star small' + (isFav(ch) ? ' on' : '');
  star.setAttribute('aria-label', 'Favourite');
  star.innerHTML = '<svg class="ic"><use href="#i-star"/></svg>';
  star.onclick = e => { e.stopPropagation(); toggleFav(ch); };

  li.append(box, text, star);
  li.onclick = () => playChannel(ch);
  return li;
}

function renderMore() {
  const list = $('#channels');
  const frag = document.createDocumentFragment();
  const end = Math.min(view.length, shown + RENDER_STEP);
  for (let i = shown; i < end; i++) frag.appendChild(makeRow(view[i]));
  list.appendChild(frag);
  shown = end;

  const more = $('#more');
  const left = view.length - shown;
  more.hidden = left <= 0;
  more.textContent = left > 0 ? `${plural(left, 'more channel', 'more channels')}…` : '';
}

const moreObserver = new IntersectionObserver(entries => {
  if (entries.some(e => e.isIntersecting) && shown < view.length) renderMore();
}, { rootMargin: '400px' });

function markCurrentRow() {
  $$('#channels li').forEach(li => {
    li.classList.toggle('on', !!current && li.dataset.id === current.id);
  });
}

function toggleFav(ch) {
  const key = norm(ch.name);
  const i = settings.favs.indexOf(key);
  if (i === -1) settings.favs.push(key); else settings.favs.splice(i, 1);
  save();
  buildGroups();
  if (group === 'fav') applyFilter();
  else $$('#channels li').forEach(li => {
    const row = byId.get(li.dataset.id);
    if (row) li.querySelector('.star').classList.toggle('on', isFav(row));
  });
  if (current && norm(current.name) === key) syncNowbar();
}

/* ───────────────────────── playback ─────────────────────────
   Safari plays HLS by itself; everywhere else needs hls.js, which is fetched
   from a CDN the first time a channel is opened and then left to the browser
   cache. Nothing about it is required to browse the playlist offline. */

let hlsLib = null;

function loadHlsLib() {
  if (hlsLib) return hlsLib;
  hlsLib = new Promise((resolve, reject) => {
    if (window.Hls) return resolve(window.Hls);
    const s = document.createElement('script');
    s.src = HLS_CDN;
    s.onload = () => window.Hls ? resolve(window.Hls) : reject(new Error('hls.js did not load'));
    s.onerror = () => reject(new Error('hls.js could not be downloaded'));
    document.head.appendChild(s);
  }).catch(err => { hlsLib = null; throw err; });
  return hlsLib;
}

const nativeHls = () => !!video.canPlayType('application/vnd.apple.mpegurl');
const looksHls = u => /\.m3u8(\?|#|$)/i.test(u);

/* Xtream live URLs are usually .../user/pass/12345 with no extension, and the
   raw MPEG-TS behind them is not something a browser can play. The same
   server almost always serves an HLS version at the same path + .m3u8, so
   that's worth trying before the bare URL. */
function candidates(url) {
  if (looksHls(url) || /\.(mp4|webm|m4v|mov)(\?|#|$)/i.test(url)) return [url];
  if (/\/\d+$/.test(new URL(url, location.href).pathname)) return [url + '.m3u8', url];
  return [url];
}

function teardown() {
  if (hls) { try { hls.destroy(); } catch {} hls = null; }
  try { video.pause(); } catch {}
  video.removeAttribute('src');
  try { video.load(); } catch {}
}

function screenMsg(text, { spin = false, retry = false } = {}) {
  $('#screenMsgText').textContent = text;
  $('#screenSpin').hidden = !spin;
  $('#retryBtn').hidden = !retry;
  $('#screenMsg').hidden = false;
  $('#screenIdle').hidden = true;
}

const hideMsg = () => { $('#screenMsg').hidden = true; };

function showIdle() {
  $('#screenMsg').hidden = true;
  $('#screenIdle').hidden = false;
}

/* Resolves true once the stream is actually producing pictures. */
function attach(src, token) {
  return new Promise(resolve => {
    let settled = false;
    const finish = ok => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      video.removeEventListener('loadedmetadata', onReady);
      video.removeEventListener('error', onErr);
      resolve(ok);
    };
    const onReady = () => finish(true);
    const onErr = () => finish(false);
    const timer = setTimeout(() => finish(false), OPEN_TIMEOUT);

    video.addEventListener('loadedmetadata', onReady, { once: true });
    video.addEventListener('error', onErr, { once: true });

    const useHls = looksHls(src) && !nativeHls();
    if (!useHls) {
      video.src = src;
      video.load();
      video.play().catch(() => {});
      return;
    }

    loadHlsLib().then(Hls => {
      if (token !== playToken) return finish(false);
      if (!Hls.isSupported()) return finish(false);

      hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        liveDurationInfinity: true,
        backBufferLength: 30,
        manifestLoadingTimeOut: 12000,
        fragLoadingTimeOut: 20000,
      });
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.play().catch(() => {});
        finish(true);
      });
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (!data.fatal) return;
        if (!settled) return finish(false);
        // already playing: a live stream dropping out is worth a couple of goes
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad();
        else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
        else { teardown(); screenMsg('That channel stopped.', { retry: true }); }
      });
      hls.loadSource(src);
      hls.attachMedia(video);
    }).catch(() => finish(false));
  });
}

async function playChannel(ch) {
  const token = ++playToken;
  current = ch;
  teardown();
  markCurrentRow();
  syncNowbar();
  screenMsg(`Tuning in to ${ch.name}…`, { spin: true });

  rememberRecent(ch);
  settings.lastKey = norm(ch.name);
  save();

  if (!httpish(ch.url)) {
    screenMsg("That channel's address isn't something a browser can open (only http and https streams work here).");
    return;
  }

  for (const src of candidates(ch.url)) {
    const ok = await attach(src, token);
    if (token !== playToken) return;         // something else was picked meanwhile
    if (ok) {
      hideMsg();
      updateMediaSession(ch);
      // a channel restored on launch has no tap behind it, and browsers
      // won't start audible video without one
      if (video.paused) video.play().catch(() => toast('Tap play to start'));
      return;
    }
    teardown();
  }

  if (token !== playToken) return;
  screenMsg(
    navigator.onLine
      ? `${ch.name} didn't come through. The stream may be down, or your provider may not allow playback in a browser.`
      : "You're offline — channels need a connection.",
    { retry: true }
  );
}

function rememberRecent(ch) {
  const key = norm(ch.name);
  settings.recents = [key, ...settings.recents.filter(k => k !== key)].slice(0, RECENT_MAX);
  save();
  buildGroups();
}

function syncNowbar() {
  const star = $('#npStar');
  if (!current) {
    $('#npTitle').textContent = 'Nothing playing';
    $('#npSub').textContent = channels.length ? 'Pick a channel below' : 'Load your playlist to see your channels';
    $('#npProg').hidden = true;
    star.hidden = true;
    return;
  }

  $('#npTitle').textContent = current.name;
  star.hidden = false;
  star.classList.toggle('on', isFav(current));

  const guide = epgFor(current);
  if (guide) {
    const { now, next } = guide;
    const pct = clamp((Date.now() - now.start) / Math.max(1, now.stop - now.start), 0, 1);
    $('#npSub').textContent =
      `${hhmm(now.start)} ${now.title}` + (next ? ` · next ${next.title}` : '');
    $('#npProg').hidden = false;
    $('#npProgFill').style.width = (pct * 100).toFixed(1) + '%';
  } else {
    $('#npSub').textContent = current.group;
    $('#npProg').hidden = true;
  }
}

function refreshEpgUi() {
  syncNowbar();
  for (const li of $$('#channels li')) {
    const ch = byId.get(li.dataset.id);
    if (!ch) continue;
    const info = rowSub(ch);
    const sub = li.querySelector('.ch-sub');
    sub.textContent = info.text;
    sub.classList.toggle('now', info.live);
  }
}

function updateMediaSession(ch) {
  if (!('mediaSession' in navigator)) return;
  const guide = epgFor(ch);
  navigator.mediaSession.metadata = new MediaMetadata({
    title: ch.name,
    artist: guide ? guide.now.title : ch.group,
    album: 'Tuner',
    artwork: ch.logo ? [{ src: ch.logo, sizes: '512x512' }] : [{ src: 'icon-512.png', sizes: '512x512', type: 'image/png' }],
  });
  navigator.mediaSession.setActionHandler('play', () => video.play().catch(() => {}));
  navigator.mediaSession.setActionHandler('pause', () => video.pause());
  navigator.mediaSession.setActionHandler('previoustrack', () => step(-1));
  navigator.mediaSession.setActionHandler('nexttrack', () => step(1));
}

/* Up and down move through what's on screen, not the whole playlist — if
   you're looking at Sport, next channel means the next sports channel. */
function step(dir) {
  if (!view.length) return;
  const i = current ? view.findIndex(c => c.id === current.id) : -1;
  const nextIndex = i === -1 ? 0 : (i + dir + view.length) % view.length;
  const ch = view[nextIndex];
  while (nextIndex >= shown && shown < view.length) renderMore();
  playChannel(ch);
  const row = $(`#channels li[data-id="${ch.id}"]`);
  if (row) row.scrollIntoView({ block: 'nearest' });
}

/* ───────────────────────── playlist sheet ───────────────────────── */

function renderPlaylists() {
  const ul = $('#playlists');
  ul.innerHTML = '';

  if (!playlists.length) {
    const li = document.createElement('li');
    li.style.cursor = 'default';
    li.innerHTML = '<div class="pl-text"><div class="pl-sub">Nothing added yet — use the tabs below.</div></div>';
    ul.appendChild(li);
    return;
  }

  for (const p of playlists) {
    const li = document.createElement('li');
    if (p.id === settings.activeId) li.className = 'on';

    const text = document.createElement('div');
    text.className = 'pl-text';
    const name = document.createElement('div');
    name.className = 'pl-name';
    name.textContent = p.name;
    const sub = document.createElement('div');
    sub.className = 'pl-sub';
    sub.textContent = `${plural(p.count, 'channel', 'channels')} · updated ${ago(p.updatedAt)}`;
    text.append(name, sub);
    li.appendChild(text);

    if (p.source.type === 'url') {
      const refresh = document.createElement('button');
      refresh.className = 'btn ghost small';
      refresh.textContent = 'Refresh';
      refresh.onclick = async e => {
        e.stopPropagation();
        refresh.disabled = true;
        refresh.textContent = '…';
        try {
          const text = await fetchText(p.source.url);
          await importPlaylist({
            name: p.name,
            source: { ...p.source, id: p.id, addedAt: p.addedAt },
            text,
          });
          await reloadPlaylists();
          if (p.id === settings.activeId) await activate(p.id);
          renderPlaylists();
          toast('Playlist refreshed');
        } catch (err) {
          refresh.disabled = false;
          refresh.textContent = 'Refresh';
          toast(fetchAdvice(err).slice(0, 90));
        }
      };
      li.appendChild(refresh);
    }

    const del = document.createElement('button');
    del.className = 'icon-btn small';
    del.setAttribute('aria-label', 'Remove playlist');
    del.innerHTML = '<svg class="ic"><use href="#i-close"/></svg>';
    del.onclick = async e => {
      e.stopPropagation();
      if (!confirm(`Remove "${p.name}" from this device?`)) return;
      await store.delPlaylist(p.id);
      await store.delChannels(p.id);
      await reloadPlaylists();
      if (settings.activeId === p.id) {
        settings.activeId = playlists[0] ? playlists[0].id : null;
        save();
        await activate(settings.activeId);
      }
      renderPlaylists();
    };
    li.appendChild(del);

    li.onclick = async () => {
      await activate(p.id);
      renderPlaylists();
      closeSheets();
    };
    ul.appendChild(li);
  }
}

async function reloadPlaylists() {
  playlists = (await store.allPlaylists()).sort((a, b) => a.addedAt - b.addedAt);
}

async function activate(id) {
  settings.activeId = id || null;
  save();

  const p = playlists.find(x => x.id === id);
  channels = id ? (await store.getChannels(id)) || [] : [];
  byId = new Map(channels.map(c => [c.id, c]));
  $('#playlistName').textContent = p ? p.name : 'No playlist';

  group = 'all';
  query = '';
  $('#search').value = '';
  $('#clearSearch').hidden = true;
  current = null;
  teardown();
  showIdle();
  buildGroups();
  applyFilter();
  syncNowbar();

  if (settings.resume && settings.lastKey) {
    const last = channels.find(c => norm(c.name) === settings.lastKey);
    if (last) {
      current = last;
      markCurrentRow();
      syncNowbar();
      if (settings.autoplay) playChannel(last);
    }
  }
}

/* ───────────────────────── sheets ───────────────────────── */

function openSheet(id) {
  closeSheets();
  $(id).hidden = false;
}

function closeSheets() {
  $$('.overlay').forEach(o => { o.hidden = true; });
}

$$('.overlay').forEach(o => {
  o.addEventListener('click', e => { if (e.target === o) closeSheets(); });
  $$('[data-close]', o).forEach(b => { b.onclick = closeSheets; });
});

let addTab = 'url';
let pickedFile = null;

$$('#addTabs .tab').forEach(t => {
  t.onclick = () => {
    addTab = t.dataset.tab;
    $$('#addTabs .tab').forEach(x => x.classList.toggle('on', x === t));
    $$('.tabpane').forEach(p => { p.hidden = p.dataset.pane !== addTab; });
    $('#addErr').hidden = true;
  };
});

$('#pickFile').onclick = () => $('#fileInput').click();
$('#fileInput').onchange = e => {
  pickedFile = e.target.files[0] || null;
  const label = $('#fileChosen');
  label.hidden = !pickedFile;
  if (pickedFile) label.textContent = `Chosen: ${pickedFile.name}`;
};

$('#addGo').onclick = async () => {
  const err = $('#addErr');
  const btn = $('#addGo');
  err.hidden = true;
  btn.disabled = true;
  btn.textContent = 'Adding…';

  const fail = msg => { err.textContent = msg; err.hidden = false; };

  try {
    let text = '';
    let source = {};
    let fallbackName = 'Playlist';

    if (addTab === 'url' || addTab === 'xtream') {
      let url;
      if (addTab === 'url') {
        url = $('#addUrl').value.trim();
        if (!httpish(url)) throw new Error('Paste a link starting with http:// or https://');
        fallbackName = new URL(url).hostname;
      } else {
        const host = $('#xtHost').value.trim();
        const user = $('#xtUser').value.trim();
        const pass = $('#xtPass').value;
        if (!httpish(host) || !user || !pass) throw new Error('Fill in the server, username and password');
        const built = xtreamUrls(host, user, pass);
        url = built.m3u;
        fallbackName = new URL(host).hostname;
        if (!settings.epgUrl) { settings.epgUrl = built.epg; save(); }
      }
      text = await fetchText(url).catch(e => { throw new Error(fetchAdvice(e)); });
      source = { type: 'url', url };
    } else if (addTab === 'file') {
      if (!pickedFile) throw new Error('Choose an .m3u file first');
      text = await pickedFile.text();
      fallbackName = pickedFile.name.replace(/\.[^.]+$/, '');
      source = { type: 'file', fileName: pickedFile.name };
    } else {
      text = $('#addText').value.trim();
      if (!text) throw new Error('Paste a playlist first');
      fallbackName = 'Pasted playlist';
      source = { type: 'text' };
    }

    const record = await importPlaylist({
      name: $('#addName').value.trim() || fallbackName,
      source,
      text,
    });

    await reloadPlaylists();
    await activate(record.id);
    renderPlaylists();

    $('#addUrl').value = '';
    $('#addText').value = '';
    $('#addName').value = '';
    $('#xtPass').value = '';
    pickedFile = null;
    $('#fileInput').value = '';
    $('#fileChosen').hidden = true;

    closeSheets();
    toast(`${record.name} — ${plural(record.count, 'channel', 'channels')}`);
    if (settings.epgUrl) loadEpg().catch(() => {});
  } catch (e) {
    fail(String(e.message || e));
  } finally {
    btn.disabled = false;
    btn.textContent = 'Add playlist';
  }
};

$('#playlistBtn').onclick = () => { renderPlaylists(); openSheet('#playlistSheet'); };
$('#emptyAdd').onclick = () => { renderPlaylists(); openSheet('#playlistSheet'); };
$('#installHint').onclick = () => openSheet('#installSheet');

$('#settingsBtn').onclick = () => {
  $('#epgUrl').value = settings.epgUrl || '';
  $('#optResume').checked = settings.resume;
  $('#optAutoplay').checked = settings.autoplay;
  $('#epgStatus').textContent = epg.index.size
    ? `Guide loaded for ${plural(epg.index.size, 'channel', 'channels')}, ${ago(epg.fetchedAt)}.`
    : settings.epgUrl ? 'Guide not loaded yet.' : 'No guide link set.';
  openSheet('#settingsSheet');
};

$('#epgSave').onclick = async () => {
  settings.epgUrl = $('#epgUrl').value.trim();
  save();
  epgByName = null;
  await store.delMeta('epg').catch(() => {});
  loadEpg({ force: true });
};

$('#epgRefresh').onclick = () => { epgByName = null; loadEpg({ force: true }); };

$('#optResume').onchange = e => { settings.resume = e.target.checked; save(); };
$('#optAutoplay').onchange = e => { settings.autoplay = e.target.checked; save(); };

$('#wipeBtn').onclick = async () => {
  if (!confirm('Remove every playlist, favourite and saved guide from this device?')) return;
  for (const p of playlists) {
    await store.delPlaylist(p.id);
    await store.delChannels(p.id);
  }
  await store.delMeta('epg').catch(() => {});
  settings = { ...defaults };
  save();
  epg = { index: new Map(), url: '', fetchedAt: 0 };
  epgByName = null;
  await reloadPlaylists();
  await activate(null);
  renderPlaylists();
  closeSheets();
  toast('Everything cleared');
};

/* ───────────────────────── search ───────────────────────── */

let searchTimer = null;
$('#search').addEventListener('input', e => {
  const value = e.target.value;
  $('#clearSearch').hidden = !value;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { query = norm(value); applyFilter(); }, 130);
});

$('#clearSearch').onclick = () => {
  $('#search').value = '';
  $('#clearSearch').hidden = true;
  query = '';
  applyFilter();
};

/* ───────────────────────── player controls ───────────────────────── */

$('#playBtn').onclick = () => {
  if (!current) { toast('Pick a channel first'); return; }
  if (video.paused) video.play().catch(() => {}); else video.pause();
};
$('#prevBtn').onclick = () => step(-1);
$('#nextBtn').onclick = () => step(1);
$('#retryBtn').onclick = () => { if (current) playChannel(current); };
$('#npStar').onclick = () => { if (current) toggleFav(current); };

function setPlayIcon() {
  $('#playBtn').innerHTML = `<svg class="ic"><use href="#i-${video.paused ? 'play' : 'pause'}"/></svg>`;
  $('#playBtn').setAttribute('aria-label', video.paused ? 'Play' : 'Pause');
}
video.addEventListener('play', setPlayIcon);
video.addEventListener('pause', setPlayIcon);
video.addEventListener('playing', hideMsg);
video.addEventListener('waiting', () => { if (current) screenMsg('Buffering…', { spin: true }); });

$('#muteBtn').onclick = () => {
  video.muted = !video.muted;
  settings.muted = video.muted;
  save();
  setVolIcon();
};

function setVolIcon() {
  const off = video.muted || video.volume === 0;
  $('#muteBtn').innerHTML = `<svg class="ic"><use href="#i-${off ? 'mute' : 'vol'}"/></svg>`;
}

$('#volume').addEventListener('input', e => {
  video.volume = clamp(e.target.value / 100, 0, 1);
  video.muted = video.volume === 0;
  settings.volume = video.volume;
  settings.muted = video.muted;
  save();
  setVolIcon();
});

$('#fullBtn').onclick = () => {
  const screen = $('#screen');
  if (document.fullscreenElement) { document.exitFullscreen(); return; }
  if (screen.requestFullscreen) screen.requestFullscreen().catch(() => {});
  else if (video.webkitEnterFullscreen) video.webkitEnterFullscreen();   // iPhone Safari
};

if (document.pictureInPictureEnabled) {
  $('#pipBtn').hidden = false;
  $('#pipBtn').onclick = async () => {
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await video.requestPictureInPicture();
    } catch { toast('Picture in picture is not available here'); }
  };
}

/* ───────────────────────── keyboard ───────────────────────── */

document.addEventListener('keydown', e => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement || {}).tagName || '');

  if (e.key === 'Escape') {
    if ($$('.overlay').some(o => !o.hidden)) { closeSheets(); return; }
    if (typing) document.activeElement.blur();
    return;
  }
  if (typing) return;

  switch (e.key) {
    case ' ': e.preventDefault(); $('#playBtn').click(); break;
    case 'ArrowDown': e.preventDefault(); step(1); break;
    case 'ArrowUp': e.preventDefault(); step(-1); break;
    case 'f': $('#fullBtn').click(); break;
    case 'm': $('#muteBtn').click(); break;
    case '/': e.preventDefault(); $('#search').focus(); break;
  }
});

/* ───────────────────────── install prompt ───────────────────────── */

let installEvent = null;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  installEvent = e;
  $('#installNow').hidden = false;
});
$('#installNow').onclick = async () => {
  if (!installEvent) return;
  installEvent.prompt();
  await installEvent.userChoice;
  installEvent = null;
  $('#installNow').hidden = true;
};

/* ───────────────────────── start ───────────────────────── */

async function start() {
  moreObserver.observe($('#more'));

  video.volume = settings.volume;
  video.muted = settings.muted;
  $('#volume').value = Math.round(settings.volume * 100);
  setVolIcon();
  setPlayIcon();

  await reloadPlaylists();
  const active = playlists.find(p => p.id === settings.activeId) || playlists[0];
  await activate(active ? active.id : null);
  renderPlaylists();

  if (settings.epgUrl) loadEpg().catch(() => {});
  setInterval(refreshEpgUi, 30000);

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

start();
