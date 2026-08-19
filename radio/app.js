/* Tunage — your own music playing without stopping and without a signal:
   one pool of everything, plus any playlists you build out of it.
   Music files live in IndexedDB on the device, track details live alongside
   them, and the app shell is cached by the service worker. No build step,
   no bundler, no server. */

/* ───────────────────────── helpers ───────────────────────── */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));

// The storage keys keep the old name on purpose: renaming them would orphan
// every track and playlist already saved on someone's device.
const SETTINGS_KEY = 'nonstop.settings';
const FADE_SECONDS = 6;          // longest crossfade
const FADE_MIN_TRACK = 14;       // shorter than this and a straight cut sounds better
const RECENT_MEMORY = 0.4;       // fraction of a pool kept out of the reshuffle

const PLAYLISTS_KEY = 'playlists';
const RESUME_KEY = 'nonstop.resume';   // localStorage: writes finish even on unload
const RESUME_EVERY = 5000;
const TUNAGE_COLOUR = '#F2C230';

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function mmss(sec) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return m + ':' + String(s).padStart(2, '0');
}

function mb(bytes) {
  if (!bytes) return '0 MB';
  if (bytes < 1024 * 1024) return Math.max(1, Math.round(bytes / 1024)) + ' KB';
  const m = bytes / (1024 * 1024);
  return (m >= 100 ? Math.round(m) : m.toFixed(1)) + ' MB';
}

function hueOf(id) {
  let h = 0;
  for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

let toastTimer = null;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
}

/* ───────────────────────── storage (IndexedDB) ───────────────────────── */

const DB_NAME = 'nonstop';                      // see the note by SETTINGS_KEY
let dbPromise = null;

function db() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains('tracks')) d.createObjectStore('tracks', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('audio')) d.createObjectStore('audio', { keyPath: 'id' });
      // v2: somewhere to keep the folder handle between visits
      if (!d.objectStoreNames.contains('prefs')) d.createObjectStore('prefs');
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
  allTracks: () => tx('tracks', 'readonly', s => s.getAll()),
  putTrack: t => tx('tracks', 'readwrite', s => s.put(t)),
  delTrack: id => tx('tracks', 'readwrite', s => s.delete(id)),
  putAudio: (id, blob) => tx('audio', 'readwrite', s => s.put({ id, blob })),
  getAudio: id => tx('audio', 'readonly', s => s.get(id)).then(r => r && r.blob),
  delAudio: id => tx('audio', 'readwrite', s => s.delete(id)),
  getPref: key => tx('prefs', 'readonly', s => s.get(key)),
  setPref: (key, value) => tx('prefs', 'readwrite', s => s.put(value, key)),
  delPref: key => tx('prefs', 'readwrite', s => s.delete(key)),
};

/* ───────────────────────── reading the file's own tags ─────────────────────────
   Enough of ID3v2 to pull title and artist out of an MP3. Anything else (or an
   untagged file) falls back to the filename. */

function decodeText(bytes, encoding) {
  try {
    if (encoding === 1 || encoding === 2) {
      const be = encoding === 2 || (bytes[0] === 0xFE && bytes[1] === 0xFF);
      const body = (bytes[0] === 0xFF || bytes[0] === 0xFE) ? bytes.subarray(2) : bytes;
      return new TextDecoder(be ? 'utf-16be' : 'utf-16le').decode(body);
    }
    if (encoding === 3) return new TextDecoder('utf-8').decode(bytes);
    return new TextDecoder('iso-8859-1').decode(bytes);
  } catch {
    return '';
  }
}

/* An iTunes-style library is full of .m4a files, which carry their tags in MP4
   boxes rather than ID3 frames. Without this, every purchased track would show
   up under its filename instead of its title and artist. */
async function readMp4Tags(file) {
  const NAMES = { '\xA9nam': 'title', '\xA9ART': 'artist', '\xA9alb': 'album', aART: 'artist' };
  const str = (view, at, n) => {
    let s = '';
    for (let i = 0; i < n; i++) s += String.fromCharCode(view.getUint8(at + i));
    return s;
  };

  try {
    // walk the top-level boxes to find "moov" without reading the whole file
    const headSize = 16;
    let offset = 0, moov = null;
    for (let guard = 0; guard < 24 && !moov; guard++) {
      const head = await file.slice(offset, offset + headSize).arrayBuffer();
      if (head.byteLength < 8) break;
      const hv = new DataView(head);
      let size = hv.getUint32(0);
      const type = str(hv, 4, 4);
      if (size === 1) size = Number(hv.getBigUint64(8));           // 64-bit box
      if (size < 8) break;
      if (type === 'moov') moov = { at: offset, size: Math.min(size, 8 << 20) };
      offset += size;
    }
    if (!moov) return {};

    const buf = await file.slice(moov.at, moov.at + moov.size).arrayBuffer();
    const v = new DataView(buf);
    const out = {};

    // depth-first walk for udta > meta > ilst, then read the ilst entries
    const walk = (start, end, path) => {
      let p = start;
      while (p + 8 <= end) {
        let size = v.getUint32(p);
        const type = str(v, p + 4, 4);
        if (size === 1 || size < 8 || p + size > end) return;
        let inner = p + 8;
        if (type === 'meta') inner += 4;                            // version + flags
        if (['moov', 'udta', 'meta', 'ilst'].includes(type)) {
          walk(inner, p + size, path.concat(type));
        } else if (path[path.length - 1] === 'ilst') {
          const field = NAMES[type];
          if (field && !out[field]) {
            // each entry holds a "data" box: 8 header + 4 flags + 4 reserved
            const dataAt = p + 8;
            if (str(v, dataAt + 4, 4) === 'data') {
              const payload = new Uint8Array(buf, dataAt + 16, Math.max(0, v.getUint32(dataAt) - 16));
              const text = new TextDecoder('utf-8').decode(payload).replace(/\0+$/g, '').trim();
              if (text) out[field] = text;
            }
          }
        }
        p += size;
      }
    };
    walk(0, buf.byteLength, []);
    return out;
  } catch {
    return {};
  }
}

async function readId3(file) {
  try {
    const head = new Uint8Array(await file.slice(0, 10).arrayBuffer());
    if (head.length < 10 || head[0] !== 0x49 || head[1] !== 0x44 || head[2] !== 0x33) return {};
    const version = head[3];
    const size = (head[6] << 21) | (head[7] << 14) | (head[8] << 7) | head[9];
    const buf = new Uint8Array(await file.slice(10, 10 + Math.min(size, 1 << 20)).arrayBuffer());

    const out = {};
    const want = { TIT2: 'title', TPE1: 'artist', TALB: 'album' };
    let p = 0;
    while (p + 10 <= buf.length) {
      const id = String.fromCharCode(buf[p], buf[p + 1], buf[p + 2], buf[p + 3]);
      if (!/^[A-Z0-9]{4}$/.test(id)) break;                      // padding — done
      const s = buf.subarray(p + 4, p + 8);
      const frameSize = version >= 4
        ? (s[0] << 21) | (s[1] << 14) | (s[2] << 7) | s[3]       // syncsafe in v2.4
        : (s[0] << 24) | (s[1] << 16) | (s[2] << 8) | s[3];
      if (frameSize <= 0 || p + 10 + frameSize > buf.length) break;
      if (want[id]) {
        const body = buf.subarray(p + 11, p + 10 + frameSize);
        const text = decodeText(body, buf[p + 10]).replace(/\0+$/g, '').trim();
        if (text) out[want[id]] = text;
      }
      p += 10 + frameSize;
    }
    return out;
  } catch {
    return {};
  }
}

const MP4_RE = /\.(m4a|m4b|mp4|aac)$/i;
const readTags = file =>
  (MP4_RE.test(file.name) || /mp4|m4a/.test(file.type)) ? readMp4Tags(file) : readId3(file);

function fromFilename(name) {
  const base = name.replace(/\.[a-z0-9]+$/i, '').replace(/_/g, ' ').trim();
  const stripped = base.replace(/^\s*\d{1,3}\s*[-.)]\s*/, '');   // leading track number
  const parts = stripped.split(/\s+-\s+/);
  if (parts.length >= 2) return { artist: parts[0].trim(), title: parts.slice(1).join(' - ').trim() };
  return { title: stripped || name };
}

/* ───────────────────────── app state ───────────────────────── */

/* Only three settings survive: what you're listening to, and the two toggles.
   Anything left over from the genre stations is dropped on read. */
const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
const settings = {
  source: typeof stored.source === 'string' ? stored.source : 'tunage',
  shuffle: stored.shuffle !== false,
  crossfade: stored.crossfade !== false,
};
const saveSettings = () => localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));

let lib = [];              // track metadata, newest last
let queue = [];            // ids waiting to play
let history = [];          // ids already played, most recent last
let current = null;        // the track object on air
let recent = [];           // ids kept out of the next reshuffle
let sleep = { mode: null, until: 0 };
let playlists = [];        // [{ id, name, tracks: [trackId], created }]
let search = '';           // what's typed in the library search box

const byId = id => lib.find(t => t.id === id);

/* ───────────────────────── playlists ─────────────────────────
   A playlist is just an ordered list of track ids. The tracks themselves stay
   in Tunage — deleting a playlist never deletes music. */

const savePlaylists = () => store.setPref(PLAYLISTS_KEY, playlists).catch(() => {});
const playlistById = id => playlists.find(p => p.id === id);
const currentPlaylist = () =>
  settings.source.startsWith('pl:') ? playlistById(settings.source.slice(3)) : null;
const sourceName = () => (currentPlaylist() || { name: 'Everything' }).name;
const sourceColour = () => {
  const pl = currentPlaylist();
  return pl ? `hsl(${hueOf(pl.id)} 70% 62%)` : TUNAGE_COLOUR;
};

function createPlaylist(name) {
  const pl = {
    id: uid(),
    name: (name || '').trim().slice(0, 60) || `Playlist ${playlists.length + 1}`,
    tracks: [],
    created: Date.now(),
  };
  playlists.push(pl);
  savePlaylists();
  return pl;
}

function addToPlaylist(plId, trackId) {
  const pl = playlistById(plId);
  if (!pl || pl.tracks.includes(trackId)) return;
  pl.tracks.push(trackId);
  savePlaylists();
}

function removeFromPlaylist(plId, trackId) {
  const pl = playlistById(plId);
  if (!pl) return;
  pl.tracks = pl.tracks.filter(id => id !== trackId);
  savePlaylists();
}

function deletePlaylist(plId) {
  playlists = playlists.filter(p => p.id !== plId);
  savePlaylists();
  if (settings.source === 'pl:' + plId) {
    settings.source = 'tunage';
    saveSettings();
  }
  rebuildQueue();
}

/* What's on air: everything, or one playlist in its own order. */
function pool(source = settings.source) {
  const playable = t => t && !t.unplayable;
  const pl = source.startsWith('pl:') ? playlistById(source.slice(3)) : null;
  if (!pl) return lib.filter(playable);
  return pl.tracks.map(byId).filter(playable);
}

/* ───────────────────────── the never-ending queue ───────────────────────── */

function shuffled(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* Refills the queue so there is always something after this track. In shuffle
   mode each pass plays the whole pool once, skipping the handful of tracks
   heard most recently so a short playlist doesn't feel like a loop. */
function refill() {
  const p = pool();
  if (!p.length) { queue = []; return; }

  while (queue.length < Math.min(12, Math.max(2, p.length))) {
    let batch;
    if (settings.shuffle) {
      const keepOut = Math.floor(p.length * RECENT_MEMORY);
      const skip = new Set(recent.slice(-keepOut));
      let fresh = p.filter(t => !skip.has(t.id) && t.id !== (current && current.id));
      if (!fresh.length) fresh = p.slice();
      batch = shuffled(fresh).map(t => t.id);
    } else {
      const start = current ? p.findIndex(t => t.id === current.id) + 1 : 0;
      batch = p.slice(start).concat(p.slice(0, start)).map(t => t.id);
    }
    if (!batch.length) break;
    // don't let one pass end with the same track the next one starts with
    const previous = queue.length ? queue[queue.length - 1] : (current && current.id);
    if (batch.length > 1 && batch[0] === previous) [batch[0], batch[1]] = [batch[1], batch[0]];
    queue.push(...batch);
    if (queue.length > 60) queue = queue.slice(0, 60);
  }
}

function rebuildQueue() {
  queue = [];
  refill();
  renderQueue();
}

/* ───────────────────────── audio decks ─────────────────────────
   Two <audio> elements so one can fade up while the other fades out. Routed
   through Web Audio when the browser lets us (iOS ignores .volume on media
   elements), otherwise the volume property is used directly. */

let ctx = null, routed = false;

function makeDeck() {
  const el = new Audio();
  el.preload = 'auto';
  el.crossOrigin = 'anonymous';
  return { el, gain: null, url: null, id: null };
}

const decks = [makeDeck(), makeDeck()];
let live = 0;                            // index of the deck on air
let fading = false;
let fadeTimer = null;

const deck = () => decks[live];
const other = () => decks[1 - live];

/* Tidies up after a crossfade: the deck that faded out is let go and the one
   on air is brought back to full. Safe to call at any point during a fade —
   which matters when a track ends, or the listener skips, mid-blend. */
function finishFade() {
  if (!fading) return;
  clearTimeout(fadeTimer);
  fadeTimer = null;
  releaseDeck(other());
  setLevel(deck(), 1);
  fading = false;
}

const fadeLengthFor = dur =>
  (isFinite(dur) && dur > FADE_MIN_TRACK) ? Math.min(FADE_SECONDS, dur / 4) : 0;

async function ensureAudioGraph() {
  if (routed || ctx === null && !window.AudioContext && !window.webkitAudioContext) return;
  try {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') await ctx.resume();
    if (ctx.state !== 'running' || routed) return;
    for (const d of decks) {
      const src = ctx.createMediaElementSource(d.el);
      d.gain = ctx.createGain();
      src.connect(d.gain).connect(ctx.destination);
    }
    routed = true;
  } catch {
    routed = false;                      // fall back to element volume
  }
}

function setLevel(d, value, seconds = 0) {
  const v = clamp(value, 0, 1);
  if (routed && d.gain) {
    const t = ctx.currentTime;
    d.gain.gain.cancelScheduledValues(t);
    d.gain.gain.setValueAtTime(clamp(d.gain.gain.value, 0.0001, 1), t);
    if (seconds > 0) d.gain.gain.linearRampToValueAtTime(Math.max(v, 0.0001), t + seconds);
    else d.gain.gain.setValueAtTime(Math.max(v, 0.0001), t);
  } else if (seconds > 0) {
    const from = d.el.volume, steps = Math.round(seconds * 20);
    let i = 0;
    clearInterval(d.ramp);
    d.ramp = setInterval(() => {
      i++;
      d.el.volume = clamp(from + (v - from) * (i / steps), 0, 1);
      if (i >= steps) clearInterval(d.ramp);
    }, 50);
  } else {
    clearInterval(d.ramp);
    d.el.volume = v;
  }
}

function releaseDeck(d) {
  clearInterval(d.ramp);
  d.el.pause();
  if (d.url) { URL.revokeObjectURL(d.url); d.url = null; }
  d.el.removeAttribute('src');
  d.el.load();
  d.id = null;
}

async function loadInto(d, track) {
  const blob = await store.getAudio(track.id);
  if (!blob) throw new Error('missing audio');
  if (d.url) URL.revokeObjectURL(d.url);
  d.url = URL.createObjectURL(blob);
  d.id = track.id;
  d.el.src = d.url;
  d.el.load();
}

/* ───────────────────────── playback ───────────────────────── */

let playing = false;

async function playTrack(track, { fade = false } = {}) {
  if (!track) return;
  await ensureAudioGraph();
  finishFade();                          // never start on top of a blend in progress

  const seconds = fade ? fadeLengthFor(deck().el.duration) : 0;

  if (seconds > 0) {
    const incoming = other();
    try {
      await loadInto(incoming, track);
    } catch {
      return dropMissing(track);
    }
    setLevel(incoming, 0);
    fading = true;
    try { await incoming.el.play(); } catch { fading = false; return; }
    live = 1 - live;                     // the incoming deck is the one on air now
    setLevel(incoming, 1, seconds);
    setLevel(other(), 0, seconds);
    fadeTimer = setTimeout(finishFade, seconds * 1000 + 150);
  } else {
    const outgoing = other();
    releaseDeck(outgoing);
    const d = deck();
    try {
      await loadInto(d, track);
    } catch {
      return dropMissing(track);
    }
    setLevel(d, 1);
    try { await d.el.play(); } catch { /* blocked until a tap — the UI still updates */ }
  }

  // the deck can error while we're still starting it, in which case the error
  // handler has already moved on and this track is no longer the one on air
  if (track.unplayable) return;

  if (current) history.push(current.id);
  if (history.length > 60) history.shift();
  current = track;
  recent.push(track.id);
  if (recent.length > 200) recent.shift();
  playing = !deck().el.paused;
  refill();
  render();
  updateMediaSession();
}

/* Two very different failures used to land here together. A file whose audio
   has actually gone is worth removing; a file this browser simply can't decode
   — a FLAC in Safari, say — is still perfectly good music on another device, so
   deleting it would be destroying something the listener still owns. */
function dropMissing(track) {
  toast('That file has gone — removed');
  lib = lib.filter(t => t.id !== track.id);
  playlists.forEach(pl => { pl.tracks = pl.tracks.filter(x => x !== track.id); });
  savePlaylists();
  store.delTrack(track.id).catch(() => {});
  store.delAudio(track.id).catch(() => {});      // don't leave the bytes behind
  rebuildQueue();
  render();
  next();
}

function markUnplayable(track) {
  if (!track.unplayable) {
    track.unplayable = true;
    store.putTrack(track).catch(() => {});
    toast(`This browser can't play ${track.title || track.file}`);
  }
  rebuildQueue();
  render();
  next();
}

function next({ fade = false } = {}) {
  refill();
  const id = queue.shift();
  renderQueue();
  if (!id) {
    if (!pool().length) { stopAll(); toast(emptyMessage()); render(); }
    return;
  }
  const track = byId(id);
  if (!track) return next({ fade });
  playTrack(track, { fade });
}

function prev() {
  const d = deck().el;
  if (current && d.currentTime > 4) { d.currentTime = 0; return; }
  const id = history.pop();
  const track = id && byId(id);
  if (!track) { d.currentTime = 0; return; }
  if (current) queue.unshift(current.id);
  const keep = current;
  current = null;                        // stops playTrack re-adding it to history
  playTrack(track).then(() => { if (keep) renderQueue(); });
}

async function togglePlay() {
  await ensureAudioGraph();
  if (!current) {
    if (!pool().length) return toast(emptyMessage());
    return next();
  }
  const d = deck().el;
  if (d.paused) {
    try { await d.play(); } catch { toast("Your browser wouldn't start playback — tap play again"); }
  } else {
    finishFade();                        // pausing mid-blend shouldn't leave a ghost deck running
    d.pause();
  }
  playing = !d.paused;
  render();
}

function stopAll() {
  clearTimeout(fadeTimer);
  fadeTimer = null;
  fading = false;
  decks.forEach(releaseDeck);
  current = null;
  playing = false;
}

function emptyMessage() {
  if (!lib.length) return 'Add a few tracks first — then this never stops';
  if (!pool().length) return 'This playlist is empty — add tracks from Your music';
  return '';
}

/* ───────────────────────── picking up where you left off ───────────────────────── */

let resumeSavedAt = 0;

function saveResume() {
  if (!current) return;
  const at = deck().el.currentTime || 0;
  try {
    localStorage.setItem(RESUME_KEY, JSON.stringify({ id: current.id, at }));
  } catch { /* private mode, or the quota is full — not worth interrupting playback */ }
}

/* Puts the last track back on the deck, paused at the second you left it.
   It deliberately doesn't start playing: browsers block that without a tap,
   and starting music by itself on launch would be obnoxious anyway. */
async function restoreResume() {
  let saved;
  try { saved = JSON.parse(localStorage.getItem(RESUME_KEY) || 'null'); } catch { return; }
  if (!saved || !saved.id) return;

  const track = byId(saved.id);
  if (!track || track.unplayable) return;

  try {
    await loadInto(deck(), track);
  } catch {
    return;                                   // the audio has gone; leave it alone
  }
  setLevel(deck(), 1);
  current = track;
  queue = queue.filter(id => id !== track.id);

  const at = Number(saved.at) || 0;
  if (at > 1) {
    const d = deck().el;
    const seek = () => {
      if (isFinite(d.duration) && at < d.duration - 1) d.currentTime = at;
    };
    if (d.readyState >= 1) seek();
    else d.addEventListener('loadedmetadata', seek, { once: true });
  }
  render();
  updateMediaSession();
}

// last chance to record the position when the app is closed or backgrounded
addEventListener('pagehide', saveResume);
addEventListener('visibilitychange', () => { if (document.hidden) saveResume(); });

/* the heartbeat: seek bar, crossfade hand-off, sleep timer */
setInterval(() => {
  const d = deck().el;
  const dur = d.duration;

  if (current && isFinite(dur) && dur > 0) {
    $('#seek').value = String(Math.round((d.currentTime / dur) * 1000));
    $('#tNow').textContent = mmss(d.currentTime);
    $('#tEnd').textContent = mmss(dur);

    const left = dur - d.currentTime;
    const fade = fadeLengthFor(dur);
    if (settings.crossfade && fade > 0 && !fading && !d.paused && left <= fade && left > 0.4
        && queue.length && !sleepEndsHere()) {
      next({ fade: true });
    }

    // belt and braces: if a track somehow finished without handing over, move on
    if (playing && !fading && d.paused && left <= 0.25 && queue.length) next();
  }

  if (playing !== !d.paused && !fading) {
    playing = !d.paused;
    saveResume();                              // pausing is worth remembering
    render();
  }
  if (playing && Date.now() - resumeSavedAt > RESUME_EVERY) {
    resumeSavedAt = Date.now();
    saveResume();
  }
  tickSleep();
}, 250);

for (const d of decks) {
  d.el.addEventListener('ended', () => {
    if (d !== deck()) return;            // the outgoing deck running out mid-blend: ignore
    if (sleepEndsHere()) { endSleep(); return; }
    finishFade();                        // it ended before the blend did — take over cleanly
    next();
  });
  d.el.addEventListener('error', () => {
    // the deck knows which track it holds; `current` isn't set yet while a
    // track is still being started, which is exactly when this tends to fire
    if (d !== deck() || !d.id) return;            // ignore a deck being torn down
    const track = byId(d.id);
    if (!track) return;
    const code = d.el.error && d.el.error.code;
    // 3 = can't decode, 4 = format unsupported — the file is fine, this browser isn't
    if (code === 3 || code === 4) markUnplayable(track);
    else next();                                  // network blip: just move on
  });
  d.el.addEventListener('play', () => { if (d === deck()) { playing = true; render(); } });
  d.el.addEventListener('pause', () => { if (d === deck() && !fading) { playing = false; render(); } });
}

/* ───────────────────────── lock screen ───────────────────────── */

const artCache = new Map();

function artworkFor(track) {
  if (artCache.has(track.id)) return artCache.get(track.id);
  const size = 512;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const hue = hueOf(track.id);
  const grad = g.createLinearGradient(0, 0, size, size);
  grad.addColorStop(0, `hsl(${hue} 55% 34%)`);
  grad.addColorStop(1, `hsl(${(hue + 45) % 360} 45% 30%)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  g.fillStyle = 'rgba(255,255,255,.14)';
  for (let r = 90; r < size; r += 26) { g.beginPath(); g.arc(size / 2, size / 2, r, 0, Math.PI * 2); g.stroke(); }
  g.fillStyle = 'rgba(255,255,255,.92)';
  g.font = `700 ${size * 0.34}px -apple-system, Segoe UI, Roboto, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText((track.title || '?').trim()[0].toUpperCase(), size / 2, size / 2);
  const url = c.toDataURL('image/png');
  artCache.set(track.id, url);
  return url;
}

function updateMediaSession() {
  if (!('mediaSession' in navigator) || !current) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: current.title || 'Unknown track',
      artist: current.artist || 'Unknown artist',
      album: currentPlaylist() ? 'Tunage · ' + sourceName() : 'Tunage',
      artwork: [{ src: artworkFor(current), sizes: '512x512', type: 'image/png' }],
    });
  } catch { /* older browsers */ }
}

if ('mediaSession' in navigator) {
  const set = (action, fn) => { try { navigator.mediaSession.setActionHandler(action, fn); } catch {} };
  set('play', () => togglePlay());
  set('pause', () => togglePlay());
  set('nexttrack', () => next());
  set('previoustrack', () => prev());
  set('stop', () => stopAll());
}

/* ───────────────────────── sleep timer ───────────────────────── */

const sleepEndsHere = () => sleep.mode === 'end';

function setSleep(value) {
  if (value === 'off') sleep = { mode: null, until: 0 };
  else if (value === 'end') sleep = { mode: 'end', until: 0 };
  else sleep = { mode: 'timer', until: Date.now() + Number(value) * 60000 };
  renderSleep();
  toast(value === 'off' ? 'Sleep timer off'
    : value === 'end' ? 'Stopping at the end of this one'
      : `Stopping in ${value} minutes`);
}

function tickSleep() {
  if (sleep.mode === 'timer') {
    if (Date.now() >= sleep.until) endSleep();
    else renderSleep();
  }
}

function endSleep() {
  sleep = { mode: null, until: 0 };
  decks.forEach(d => d.el.pause());
  playing = false;
  renderSleep();
  render();
  toast('Goodnight — timer stopped the music');
}

function renderSleep() {
  const chip = $('#sleepChip');
  if (!sleep.mode) { chip.hidden = true; return; }
  chip.hidden = false;
  chip.textContent = sleep.mode === 'end'
    ? 'Sleep: end of track'
    : 'Sleep: ' + mmss(Math.max(0, (sleep.until - Date.now()) / 1000));
}

/* ───────────────────────── importing ───────────────────────── */

const AUDIO_RE = /\.(mp3|m4a|aac|ogg|oga|opus|wav|flac|weba|webm|mp4)$/i;
const isAudio = f => (f.type && f.type.startsWith('audio/')) || AUDIO_RE.test(f.name);

let askedToPersist = false;
async function askToPersist() {
  if (askedToPersist || !navigator.storage || !navigator.storage.persist) return;
  askedToPersist = true;
  try { await navigator.storage.persist(); } catch {}
}

function importStatus(html) {
  const box = $('#importStatus');
  if (!html) { box.hidden = true; box.innerHTML = ''; return; }
  box.hidden = false;
  box.innerHTML = html;
}

/* Accepts plain files or {file, path} pairs, so a folder scan can say where
   each one came from, which keeps the track's own details tidy. */
async function addFiles(fileList, { quiet = false } = {}) {
  const files = [...fileList]
    .map(x => (x && x.file) ? x : { file: x, path: (x && x.webkitRelativePath) || '' })
    .filter(x => x.file && isAudio(x.file));
  if (!files.length) {
    if (!quiet) toast('No audio files in that lot');
    return { added: 0, skipped: 0, failed: 0 };
  }
  await askToPersist();

  let added = 0, skipped = 0, failed = 0;
  for (let i = 0; i < files.length; i++) {
    const { file: f, path } = files[i];
    if (!quiet) {
      importStatus(`Saving <b>${esc(f.name)}</b> — ${i + 1} of ${files.length}` +
        `<div class="bar"><i style="width:${Math.round((i / files.length) * 100)}%"></i></div>`);
      await new Promise(r => setTimeout(r, 0));       // let the bar paint
    }

    if (lib.some(t => t.file === f.name && t.size === f.size)) { skipped++; continue; }
    try {
      const track = await buildTrack(f, path);
      await store.putAudio(track.id, f);
      await store.putTrack(track);
      lib.push(track);
      added++;
    } catch (err) {
      failed++;
      if (err && /quota/i.test(err.name + ' ' + err.message)) {
        importStatus(`<b>Out of space on this device.</b> ${added} saved before it filled up — ` +
          `delete a few tracks and try the rest.`);
        break;
      }
    }
  }

  if (!quiet) {
    const bits = [`${added} added`];
    if (skipped) bits.push(`${skipped} already here`);
    if (failed) bits.push(`${failed} wouldn't save`);
    if (added) importStatus(`<b>${bits.join(' · ')}</b> — ready to play.`);
    else if (!failed) importStatus(`<b>${bits.join(' · ')}</b>`);
  }

  rebuildQueue();
  render();
  refreshStorage();
  if (added && !current && pool().length) next();     // first import: start it off
  return { added, skipped, failed };
}

async function buildTrack(file, relativePath = '') {
  const tags = await readTags(file);
  const guessFromName = fromFilename(file.name);
  const path = relativePath || file.webkitRelativePath || '';
  return {
    id: uid(),
    title: tags.title || guessFromName.title || file.name,
    artist: tags.artist || guessFromName.artist || '',
    file: file.name,
    size: file.size,
    type: file.type || '',
    added: Date.now(),
  };
}

/* ───────────────────────── the watched folder ─────────────────────────
   Where the browser allows it, you point Tunage at your music folder once
   and it re-reads that folder on every launch, picking up anything new.
   Files are still copied into the app's own storage, so playback keeps
   working when the folder isn't reachable — an external drive, say. */

const FOLDER_KEY = 'musicFolder';
const canWatchFolder = () => typeof window.showDirectoryPicker === 'function';
let folderHandle = null;
let scanning = false;

async function walkFolder(dir, prefix = '', out = [], depth = 0) {
  if (depth > 6) return out;                            // deep enough for any library
  for await (const entry of dir.values()) {
    const path = prefix ? prefix + '/' + entry.name : entry.name;
    if (entry.kind === 'directory') await walkFolder(entry, path, out, depth + 1);
    else if (AUDIO_RE.test(entry.name)) out.push({ handle: entry, path });
  }
  return out;
}

async function scanFolder({ quiet = false } = {}) {
  if (!folderHandle || scanning) return;
  scanning = true;
  renderFolder();
  try {
    if (!quiet) importStatus('Reading your music folder…');
    const found = await walkFolder(folderHandle);

    // only open the files that aren't already saved — a big library shouldn't
    // be re-read from disk every launch
    const known = new Set(lib.map(t => t.file + '\u0000' + t.size));
    const fresh = [];
    for (const { handle, path } of found) {
      let file;
      try { file = await handle.getFile(); } catch { continue; }
      if (known.has(file.name + '\u0000' + file.size)) continue;
      fresh.push({ file, path });
    }

    if (!fresh.length) {
      if (!quiet) importStatus(`<b>Nothing new</b> — all ${found.length} track${found.length === 1 ? '' : 's'} in that folder are already here.`);
      return;
    }
    const res = await addFiles(fresh, { quiet });
    if (quiet && res.added) toast(`Picked up ${res.added} new track${res.added === 1 ? '' : 's'} from your folder`);
  } catch (err) {
    if (!quiet) importStatus(`<b>Couldn't read that folder.</b> ${esc(err && err.message || '')}`);
  } finally {
    scanning = false;
    renderFolder();
  }
}

async function linkFolder() {
  if (!canWatchFolder()) return;
  let handle;
  try {
    handle = await window.showDirectoryPicker({ id: 'nonstop-music', mode: 'read' });
  } catch {
    return;                                             // the picker was dismissed
  }
  folderHandle = handle;
  try { await store.setPref(FOLDER_KEY, handle); } catch { /* not storable — this session only */ }
  renderFolder();
  scanFolder();
}

async function unlinkFolder() {
  folderHandle = null;
  await store.delPref(FOLDER_KEY).catch(() => {});
  renderFolder();
  toast('Folder unlinked — the music already saved stays put');
}

/* Re-attaches last visit's folder. Chrome remembers the grant for installed
   apps; otherwise it needs one tap to re-allow, which can't be done for you. */
async function restoreFolder() {
  if (!canWatchFolder()) return renderFolder();
  let handle;
  try { handle = await store.getPref(FOLDER_KEY); } catch { return renderFolder(); }
  if (!handle) return renderFolder();
  folderHandle = handle;
  renderFolder();
  try {
    const state = await handle.queryPermission({ mode: 'read' });
    if (state === 'granted') scanFolder({ quiet: true });
    else renderFolder(state);
  } catch {
    renderFolder();
  }
}

async function reconnectFolder() {
  if (!folderHandle) return;
  try {
    const state = await folderHandle.requestPermission({ mode: 'read' });
    if (state === 'granted') scanFolder();
    else renderFolder(state);
  } catch { renderFolder(); }
}

function renderFolder(permission = 'granted') {
  const box = $('#folderSync');
  if (!box) return;
  if (!canWatchFolder()) {
    box.innerHTML = `<p class="hint">This browser can't keep a folder linked. ` +
      `On a computer, Chrome or Edge can — everywhere else, "Choose a folder" above imports the lot in one go.</p>`;
    return;
  }
  if (!folderHandle) {
    box.innerHTML = `<button class="btn ghost" data-folder="link">Keep a folder in sync</button>
      <p class="hint">Pick your music folder once. Every time you open Tunage it checks that folder and brings in anything new.</p>`;
    return;
  }
  const name = esc(folderHandle.name || 'your folder');
  if (permission !== 'granted') {
    box.innerHTML = `<p class="hint">Linked to <b>${name}</b>, but this browser needs you to allow it again.</p>
      <button class="btn" data-folder="reconnect">Allow access to ${name}</button>
      <button class="btn ghost" data-folder="unlink">Unlink</button>`;
    return;
  }
  box.innerHTML = `<p class="hint">Watching <b>${name}</b>${scanning ? ' — reading it now…' : ''}</p>
    <div class="add-btns">
      <button class="btn ghost" data-folder="scan" ${scanning ? 'disabled' : ''}>Check for new music</button>
      <button class="btn ghost" data-folder="unlink">Unlink</button>
    </div>`;
}

async function addFromUrl(url) {
  const err = $('#urlErr');
  err.hidden = true;
  let res;
  try {
    res = await fetch(url, { mode: 'cors' });
  } catch {
    err.textContent = "Couldn't reach that link. It needs to be a direct file link, and you need a connection for this bit.";
    err.hidden = false;
    return;
  }
  if (!res.ok) {
    err.textContent = `That link answered with ${res.status}.`;
    err.hidden = false;
    return;
  }
  const blob = await res.blob();
  if (!blob.size) { err.textContent = 'That link had nothing in it.'; err.hidden = false; return; }

  await askToPersist();
  const name = decodeURIComponent(url.split('/').pop().split('?')[0]) || 'track';
  const file = new File([blob], name, { type: blob.type || 'audio/mpeg' });
  const track = await buildTrack(file);
  try {
    await store.putAudio(track.id, file);
    await store.putTrack(track);
  } catch {
    err.textContent = "Couldn't save it — the device may be out of space.";
    err.hidden = false;
    return;
  }
  lib.push(track);
  closeSheets();
  rebuildQueue();
  render();
  refreshStorage();
  toast(`Saved “${track.title}” for offline`);
  if (!current && pool().length) next();
}

async function removeTrack(id) {
  const t = byId(id);
  if (!t) return;
  lib = lib.filter(x => x.id !== id);
  queue = queue.filter(x => x !== id);
  history = history.filter(x => x !== id);
  playlists.forEach(pl => { pl.tracks = pl.tracks.filter(x => x !== id); });
  savePlaylists();
  await Promise.all([store.delTrack(id), store.delAudio(id)]).catch(() => {});
  if (current && current.id === id) { stopAll(); rebuildQueue(); next(); }
  else { rebuildQueue(); render(); }
  refreshStorage();
  toast(`Removed “${t.title}”`);
}

async function refreshStorage() {
  const line = $('#storage');
  const used = lib.reduce((n, t) => n + (t.size || 0), 0);
  let quota = '';
  if (navigator.storage && navigator.storage.estimate) {
    try {
      const est = await navigator.storage.estimate();
      if (est.quota) quota = ` of roughly ${mb(est.quota)} this browser will hand out`;
    } catch {}
  }
  line.textContent = lib.length
    ? `${lib.length} track${lib.length === 1 ? '' : 's'} on this device — ${mb(used)}${quota}.`
    : '';
}

/* ───────────────────────── rendering ───────────────────────── */

function render() {
  document.documentElement.style.setProperty('--accent', sourceColour());

  $('#playBtn').innerHTML = `<svg class="ic"><use href="#i-${playing ? 'pause' : 'play'}"/></svg>`;
  $('#playBtn').setAttribute('aria-label', playing ? 'Pause' : 'Play');
  $('#shuffleBtn').classList.toggle('on', settings.shuffle);
  $('#fadeBtn').classList.toggle('on', settings.crossfade);

  const art = $('#art');
  art.classList.toggle('spinning', playing);
  if (current) {
    const hue = hueOf(current.id);
    art.innerHTML = `<div class="label" style="background:linear-gradient(140deg,hsl(${hue} 60% 55%),hsl(${
      (hue + 45) % 360} 55% 42%))">${esc((current.title || '?').trim()[0].toUpperCase())}</div>`;
    $('#npTitle').textContent = current.title || current.file;
    $('#npArtist').textContent = current.artist || 'Unknown artist';
  } else {
    art.innerHTML = '<svg class="ic art-disc"><use href="#i-disc"/></svg>';
    $('#npTitle').textContent = lib.length ? 'Ready when you are' : 'Nothing playing yet';
    $('#npArtist').textContent = lib.length
      ? (emptyMessage() || (currentPlaylist()
        ? `Press play for nonstop ${sourceName()}`
        : 'Press play and it keeps going'))
      : 'Add some music to get going';
    $('#seek').value = '0';
    $('#tNow').textContent = $('#tEnd').textContent = '0:00';
  }

  renderSources();
  renderQueue();
  renderPlaylist();
  renderLibrary();
}

/* The chip row: Tunage, then a chip per playlist, then a way to make one. */
function renderSources() {
  const chip = (id, name, sub, extra = '') =>
    `<button class="source ${settings.source === id ? 'on' : ''} ${extra}" data-source="${id}">` +
    `<b>${esc(name)}</b><span>${esc(sub)}</span></button>`;
  const count = n => `${n} track${n === 1 ? '' : 's'}`;

  $('#sources').innerHTML =
    chip('tunage', 'Everything', count(lib.length)) +
    playlists.map(pl => chip('pl:' + pl.id, pl.name,
      count(pl.tracks.filter(id => byId(id)).length))).join('') +
    '<button class="source new" data-source="new"><b>+ New</b><span>playlist</span></button>';
}

function renderPlaylist() {
  const pl = currentPlaylist();
  $('#playlistPanel').hidden = !pl;
  if (!pl) return;
  const tracks = pl.tracks.map(byId).filter(Boolean);
  $('#plName').textContent = pl.name;
  $('#plCount').textContent = `${tracks.length} track${tracks.length === 1 ? '' : 's'}`;
  $('#plTracks').innerHTML = tracks.map(t => trackRow(t, { inPlaylist: true })).join('');
  $('#plEmpty').hidden = !!tracks.length;
}

function renderQueue() {
  const ol = $('#queue');
  const items = queue.slice(0, 6).map(byId).filter(Boolean);
  $('#queuePanel').hidden = !items.length;
  ol.innerHTML = items.map((t, i) => `
    <li>
      <span class="n">${i + 1}</span>
      <span class="dot" style="background:hsl(${hueOf(t.id)} 60% 55%)"></span>
      <span class="who"><b>${esc(t.title || t.file)}</b><span>${esc(t.artist || 'Unknown artist')}</span></span>
    </li>`).join('');
}

function trackRow(t, { inPlaylist = false } = {}) {
  const actions = inPlaylist
    ? '<button class="mini" data-act="unpl">Remove</button>'
    : '<button class="mini add" data-act="addpl" aria-label="Add to a playlist">+ Playlist</button>' +
      '<button class="mini danger" data-act="del" aria-label="Delete"><svg class="ic"><use href="#i-trash"/></svg></button>';
  const note = t.unplayable ? " · can't play in this browser" : '';
  return `
    <li data-id="${t.id}" class="${t.unplayable ? 'unplayable' : ''}">
      <span class="dot" style="background:hsl(${hueOf(t.id)} 60% 55%)"></span>
      <span class="who" data-act="play">
        <b>${esc(t.title || t.file)}</b>
        <span>${esc(t.artist || 'Unknown artist')}${t.size ? ' · ' + mb(t.size) : ''}${note}</span>
      </span>
      <span class="row-actions">${actions}</span>
    </li>`;
}

function matchesSearch(t) {
  if (!search) return true;
  return [t.title, t.artist, t.file].some(v => (v || '').toLowerCase().includes(search));
}

function renderLibrary() {
  const list = lib.filter(matchesSearch)
    .sort((a, b) => (a.artist || '').localeCompare(b.artist || '')
      || (a.title || '').localeCompare(b.title || ''));
  $('#library').innerHTML = list.map(t => trackRow(t)).join('');
  $('#libEmpty').hidden = !!lib.length;
  $('#libNoMatch').hidden = !(search && lib.length && !list.length);
  $('#libSearch').hidden = lib.length < 2;
  $('#libCount').textContent = !lib.length ? ''
    : search ? `${list.length} of ${lib.length}`
      : `${lib.length} track${lib.length === 1 ? '' : 's'}`;
}

/* ───────────────────────── wiring ───────────────────────── */

$('#sources').addEventListener('click', e => {
  const btn = e.target.closest('.source');
  if (!btn) return;
  if (btn.dataset.source === 'new') return openPlaylistSheet({ mode: 'new' });

  settings.source = btn.dataset.source;
  saveSettings();
  rebuildQueue();
  render();
  // picking a playlist means that playlist's music, right now
  if (!pool().length) { stopAll(); toast(emptyMessage()); render(); return; }
  const stillFits = current && pool().some(t => t.id === current.id);
  if (!stillFits) next({ fade: settings.crossfade && playing });
});

/* ───────────────────────── the playlist sheet ─────────────────────────
   One sheet does three jobs: file a track, make an empty playlist, rename one. */

let sheetMode = 'add', sheetTrack = null, sheetPlaylist = null;

function openPlaylistSheet({ mode = 'add', trackId = null, playlist = null } = {}) {
  sheetMode = mode;
  sheetTrack = trackId;
  sheetPlaylist = playlist;
  const t = trackId && byId(trackId);

  $('#plSheetTitle').textContent =
    mode === 'rename' ? 'Rename playlist' : mode === 'new' ? 'New playlist' : 'Add to playlist';
  $('#plSheetTrack').textContent = t ? `${t.title || t.file} — ${t.artist || 'Unknown artist'}` : '';
  $('#plSheetTrack').hidden = !t;
  $('#plSheetGo').textContent = mode === 'rename' ? 'Save' : 'Create';
  $('#plNameInput').value = mode === 'rename' && playlist ? playlist.name : '';
  $('#plNameInput').placeholder = mode === 'rename' ? 'Playlist name' : 'New playlist name';

  renderSheetList();
  openSheet('#plSheet');
  setTimeout(() => $('#plNameInput').focus(), 60);
}

function renderSheetList() {
  const list = $('#plSheetList');
  const show = sheetMode === 'add' && playlists.length > 0;
  list.hidden = !show;
  if (!show) return;
  list.innerHTML = playlists.map(pl => {
    const has = pl.tracks.includes(sheetTrack);
    return `<li data-pick="${pl.id}">
      <span class="who"><b>${esc(pl.name)}</b>
        <span>${pl.tracks.length} track${pl.tracks.length === 1 ? '' : 's'}</span></span>
      <button class="mini ${has ? 'on' : ''}">${has ? 'Added' : 'Add'}</button>
    </li>`;
  }).join('');
}

$('#plSheetList').addEventListener('click', e => {
  const li = e.target.closest('li[data-pick]');
  if (!li || !sheetTrack) return;
  const pl = playlistById(li.dataset.pick);
  if (!pl) return;
  if (pl.tracks.includes(sheetTrack)) removeFromPlaylist(pl.id, sheetTrack);
  else addToPlaylist(pl.id, sheetTrack);
  renderSheetList();
  rebuildQueue();
  render();
});

function submitPlaylistSheet() {
  const name = $('#plNameInput').value;

  if (sheetMode === 'rename') {
    const clean = name.trim().slice(0, 60);
    if (sheetPlaylist && clean) { sheetPlaylist.name = clean; savePlaylists(); }
    closeSheets();
    render();
    return;
  }

  const pl = createPlaylist(name);
  if (sheetTrack) addToPlaylist(pl.id, sheetTrack);
  else { settings.source = 'pl:' + pl.id; saveSettings(); }
  closeSheets();
  rebuildQueue();
  render();
  toast(sheetTrack ? `Added to ${pl.name}` : `Playlist ${pl.name} created`);
}

$('#plSheetGo').addEventListener('click', submitPlaylistSheet);
$('#plNameInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); submitPlaylistSheet(); }
});

$('#playlistPanel').addEventListener('click', e => {
  const act = e.target.closest('[data-pl]');
  if (!act) return onTrackListClick(e);
  const pl = currentPlaylist();
  if (!pl) return;
  if (act.dataset.pl === 'rename') openPlaylistSheet({ mode: 'rename', playlist: pl });
  else if (act.dataset.pl === 'delete') {
    const name = pl.name;
    deletePlaylist(pl.id);
    render();
    toast(`${name} deleted — the music itself is still in Tunage`);
  }
});

$('#libSearch').addEventListener('input', e => {
  search = e.target.value.trim().toLowerCase();
  renderLibrary();
});

$('#playBtn').addEventListener('click', togglePlay);
$('#nextBtn').addEventListener('click', () => next({ fade: settings.crossfade && playing }));
$('#prevBtn').addEventListener('click', prev);

$('#shuffleBtn').addEventListener('click', () => {
  settings.shuffle = !settings.shuffle;
  saveSettings();
  rebuildQueue();
  render();
});

$('#fadeBtn').addEventListener('click', () => {
  settings.crossfade = !settings.crossfade;
  saveSettings();
  render();
  toast(settings.crossfade ? 'Tracks will blend into each other' : 'Straight cuts between tracks');
});

$('#seek').addEventListener('input', e => {
  const d = deck().el;
  if (!current || !isFinite(d.duration)) return;
  d.currentTime = (Number(e.target.value) / 1000) * d.duration;
});

function onTrackListClick(e) {
  const li = e.target.closest('li[data-id]');
  if (!li) return;
  const act = e.target.closest('[data-act]');
  if (!act) return;
  const id = li.dataset.id;
  const what = act.dataset.act;
  if (what === 'del') removeTrack(id);
  else if (what === 'addpl') openPlaylistSheet({ mode: 'add', trackId: id });
  else if (what === 'unpl') {
    const pl = currentPlaylist();
    if (!pl) return;
    removeFromPlaylist(pl.id, id);
    rebuildQueue();
    render();
  } else if (what === 'play') {
    const t = byId(id);
    if (!t) return;
    if (t.unplayable) return toast("This browser can't play that one");
    queue = queue.filter(x => x !== id);
    playTrack(t, { fade: settings.crossfade && playing });
  }
}
$('#library').addEventListener('click', onTrackListClick);

/* adding music */
$('#pickFiles').addEventListener('click', () => $('#fileInput').click());
$('#pickFolder').addEventListener('click', () => $('#folderInput').click());
$('#fileInput').addEventListener('change', e => { addFiles(e.target.files); e.target.value = ''; });
$('#folderInput').addEventListener('change', e => { addFiles(e.target.files); e.target.value = ''; });

$('#folderSync').addEventListener('click', e => {
  const btn = e.target.closest('[data-folder]');
  if (!btn) return;
  const what = btn.dataset.folder;
  if (what === 'link') linkFolder();
  else if (what === 'scan') scanFolder();
  else if (what === 'unlink') unlinkFolder();
  else if (what === 'reconnect') reconnectFolder();
});

const drop = $('#drop');
['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => {
  e.preventDefault(); drop.classList.add('hot');
}));
['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => {
  e.preventDefault(); drop.classList.remove('hot');
}));
/* Dragging a whole music folder in should work, not just loose files. */
function filesFromDrop(dt) {
  const entries = dt.items
    ? [...dt.items].map(i => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean)
    : [];
  if (!entries.length) return Promise.resolve([...dt.files]);

  const out = [];
  const walk = entry => new Promise(done => {
    if (entry.isFile) return entry.file(f => { out.push(f); done(); }, done);
    if (!entry.isDirectory) return done();
    const reader = entry.createReader();
    const readBatch = () => reader.readEntries(async batch => {
      if (!batch.length) return done();
      for (const e of batch) await walk(e);
      readBatch();
    }, done);
    readBatch();
  });
  return Promise.all(entries.map(walk)).then(() => out);
}

drop.addEventListener('drop', async e => {
  if (!e.dataTransfer) return;
  const files = await filesFromDrop(e.dataTransfer);
  if (files.length) addFiles(files);
});

/* sheets */
function openSheet(sel) { $(sel).hidden = false; }
function closeSheets() { $$('.overlay').forEach(o => { o.hidden = true; }); }
$$('.overlay').forEach(o => o.addEventListener('click', e => {
  if (e.target === o || e.target.closest('[data-close]')) closeSheets();
}));

$('#sleepBtn').addEventListener('click', () => openSheet('#sleepSheet'));
$('#sleepSheet').addEventListener('click', e => {
  const btn = e.target.closest('[data-sleep]');
  if (!btn) return;
  setSleep(btn.dataset.sleep);
  closeSheets();
});

$('#pickUrl').addEventListener('click', () => { $('#urlErr').hidden = true; openSheet('#urlSheet'); });
$('#urlGo').addEventListener('click', async () => {
  const url = $('#urlInput').value.trim();
  if (!url) return;
  const btn = $('#urlGo');
  btn.disabled = true;
  btn.textContent = 'Saving…';
  await addFromUrl(url);
  btn.disabled = false;
  btn.textContent = 'Save';
});

$('#installHint').addEventListener('click', () => openSheet('#installSheet'));

let installPrompt = null;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  installPrompt = e;
  $('#installNow').hidden = false;
});
$('#installNow').addEventListener('click', async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  installPrompt = null;
  $('#installNow').hidden = true;
  closeSheets();
});

document.addEventListener('keydown', e => {
  if (e.target.matches('input, select, textarea')) return;
  if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
  else if (e.code === 'ArrowRight') next({ fade: settings.crossfade && playing });
  else if (e.code === 'ArrowLeft') prev();
  else if (e.key === 'Escape') closeSheets();
});

/* ───────────────────────── boot ───────────────────────── */

(async function boot() {
  try {
    lib = (await store.allTracks()).sort((a, b) => a.added - b.added);
  } catch {
    toast("This browser wouldn't open the music store — try leaving private mode");
  }

  try {
    const saved = await store.getPref(PLAYLISTS_KEY);
    playlists = Array.isArray(saved) ? saved : [];
  } catch {
    playlists = [];
  }
  playlists.forEach(pl => { if (!Array.isArray(pl.tracks)) pl.tracks = []; });
  // a playlist deleted on another tab shouldn't leave us pointing at nothing
  if (settings.source.startsWith('pl:') && !currentPlaylist()) settings.source = 'tunage';
  rebuildQueue();
  render();
  renderSleep();
  refreshStorage();
  await restoreResume();
  restoreFolder();
})();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
