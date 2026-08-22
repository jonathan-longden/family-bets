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
  level: stored.level !== false,
  autoListen: stored.autoListen !== false,
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
  // none of these are tracks
  if (source === 'radio' || source === 'podcasts' || source === 'youtube') return [];
  const playable = t => t && !t.unplayable;
  const pl = source.startsWith('pl:') ? playlistById(source.slice(3)) : null;
  if (!pl) return lib.filter(playable);
  return pl.tracks.map(byId).filter(playable);
}

/* ───────────────────────── loudness levelling ─────────────────────────

   A CD rip, a Bandcamp download and something mastered in 2003 all play at
   wildly different volumes, so you spend the evening on the volume button.
   Each track is measured once, in the background, and a gain is stored with
   it; playback multiplies the fade envelope by that gain.

   The measurement follows ITU-R BS.1770: K-weighting filters in front of the
   meter, then mean square over 400 ms blocks with the absolute (-70 LUFS) and
   relative (-10 dB) gates, so quiet passages don't drag a track's reading
   down. Audio is decoded at a low sample rate to keep a phone's memory sane,
   which costs a little accuracy at the top end and nothing that matters here. */

const TARGET_LUFS = -16;      // quiet enough that most tracks come down, not up
const MAX_BOOST = 2;          // +6 dB, past which a quiet track just sounds hissy
const ANALYSIS_RATE = 16000;
const SECONDS_PER_REV = 1.8;   // a platter at 33⅓ rpm
let levelling = false;

function offlineCtx(channels, length, rate) {
  const OC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!OC) return null;
  try { return new OC(channels, length, rate); } catch { return null; }
}

async function measureLoudness(blob) {
  // Safari has been picky about offline context rates; 44.1k is the safe retry
  const dec = offlineCtx(1, 1, ANALYSIS_RATE) || offlineCtx(1, 1, 44100);
  if (!dec) return null;
  const buf = await dec.decodeAudioData(await blob.arrayBuffer());

  // sample peak, taken before any filtering, to cap how far we boost
  let peak = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const data = buf.getChannelData(c);
    for (let i = 0; i < data.length; i += 7) {
      const a = Math.abs(data[i]);
      if (a > peak) peak = a;
    }
  }

  const ctx = offlineCtx(1, buf.length, buf.sampleRate);
  if (!ctx) return null;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass'; hp.frequency.value = 38; hp.Q.value = 0.5;
  const shelf = ctx.createBiquadFilter();
  shelf.type = 'highshelf'; shelf.frequency.value = 1500; shelf.gain.value = 4;
  src.connect(hp).connect(shelf).connect(ctx.destination);
  src.start();
  const x = (await ctx.startRendering()).getChannelData(0);

  const rate = buf.sampleRate;
  const block = Math.round(rate * 0.4), step = Math.round(rate * 0.1);
  const zs = [];
  for (let start = 0; start + block <= x.length; start += step) {
    let sum = 0;
    for (let i = start; i < start + block; i++) sum += x[i] * x[i];
    zs.push(sum / block);
  }
  if (!zs.length) return null;

  const loud = z => -0.691 + 10 * Math.log10(z || 1e-12);
  const mean = list => list.reduce((a, b) => a + b, 0) / list.length;

  const overAbsolute = zs.filter(z => loud(z) > -70);
  if (!overAbsolute.length) return null;
  const gate = loud(mean(overAbsolute)) - 10;
  const kept = overAbsolute.filter(z => loud(z) > gate);

  return { lufs: loud(mean(kept.length ? kept : overAbsolute)), peak };
}

function gainFrom({ lufs, peak }) {
  let g = Math.pow(10, (TARGET_LUFS - lufs) / 20);
  if (peak > 0) g = Math.min(g, 0.98 / peak);       // never push it into clipping
  return clamp(g, 0.05, MAX_BOOST);
}

function levelStatus(text) {
  const el = $('#levelStatus');
  if (!el) return;
  el.hidden = !text;
  el.textContent = text || '';
}

/* Works through anything unmeasured, one at a time, out of the way of
   playback. Tracks play at their own volume until their turn comes. */
async function levelPending() {
  if (levelling) return;
  const pending = () => lib.filter(t => t.gain === undefined && !t.unplayable);
  if (!pending().length) return;

  levelling = true;
  let done = 0;
  try {
    for (let list = pending(); list.length; list = pending()) {
      const track = list[0];
      levelStatus(`Levelling volumes — ${++done} of ${done + list.length - 1}`);
      try {
        const blob = await store.getAudio(track.id);
        const m = blob && await measureLoudness(blob);
        if (m) {
          track.gain = gainFrom(m);
          track.lufs = Math.round(m.lufs * 10) / 10;
          track.peak = Math.round(m.peak * 1000) / 1000;
        } else {
          track.gain = 1;
        }
      } catch {
        track.gain = 1;        // couldn't decode it here; leave the volume alone
      }
      await store.putTrack(track).catch(() => {});
      for (const d of decks) {
        if (d.id === track.id) { d.trackGain = track.gain; if (!fading) setLevel(d, 1); }
      }
      await new Promise(r => setTimeout(r, 30));      // let playback breathe
    }
  } finally {
    levelling = false;
    levelStatus('');
  }
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

  // With only a couple of tracks about, a pass can hand back the one that's
  // playing right now — which the Up Next deck would sit there displaying.
  if (current && queue.length > 1 && queue[0] === current.id) {
    [queue[0], queue[1]] = [queue[1], queue[0]];
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
  return { el, gain: null, analyser: null, url: null, id: null,
    trackGain: 1, channel: 1, env: 1, angle: 0 };
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
  renderDecks();
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
      d.analyser = ctx.createAnalyser();
      d.analyser.fftSize = 256;
      src.connect(d.gain).connect(ctx.destination);
      d.gain.connect(d.analyser);          // a tap for the meters, going nowhere else
    }
    routed = true;
    document.body.classList.add('metered');
    startPlatters();
  } catch {
    routed = false;                      // fall back to element volume
  }
}

/* `value` is the crossfade envelope, 0 to 1. The track's own levelling gain
   multiplies it, so the two never fight each other. Through Web Audio a gain
   above 1 is fine; an <audio> element's volume caps at 1, so on that fallback
   path quiet tracks can only be left alone, not lifted. */
function setLevel(d, value, seconds = 0) {
  d.env = value;                                   // remembered so the channel
                                                   // fader can re-apply it
  const wanted = value * d.channel * (settings.level ? (d.trackGain || 1) : 1);
  const v = routed && d.gain ? clamp(wanted, 0, MAX_BOOST) : clamp(wanted, 0, 1);
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
  d.trackGain = track.gain || 1;
  d.el.src = d.url;
  d.el.load();
}

/* ───────────────────────── playback ───────────────────────── */

let playing = false;

async function playTrack(track, { fade = false } = {}) {
  if (!track) return;
  if (onAir()) stopStation();                    // a record and a station can't both be on
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
    moveFader(seconds);                    // the knob travels with the blend
    fadeTimer = setTimeout(finishFade, seconds * 1000 + 150);
  } else {
    // even without a blend, the next record goes onto the free deck — the
    // decks take turns, which is what makes the two-deck display mean anything
    const incoming = other();
    try {
      await loadInto(incoming, track);
    } catch {
      return dropMissing(track);
    }
    setLevel(incoming, 1);
    const outgoing = deck();
    live = 1 - live;
    releaseDeck(outgoing);
    moveFader(0.45);
    try { await incoming.el.play(); } catch { /* blocked until a tap — the UI still updates */ }
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
  if (onAir()) {
    if (radioEl.paused) {
      $('#onAirState').textContent = 'Connecting…';
      radioEl.play().catch(() => { $('#onAirState').textContent = "Couldn't start"; });
    } else {
      radioEl.pause();
    }
    return;
  }
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
addEventListener('pagehide', () => { saveResume(); saveEpisodePos(); });
addEventListener('visibilitychange', () => { if (document.hidden) saveResume(); });

/* the heartbeat: seek bar, crossfade hand-off, sleep timer */
setInterval(() => {
  if (onAir()) {
    const going = !radioEl.paused;
    if (going !== playing) { playing = going; render(); }

    if (!isLive() && isFinite(radioEl.duration) && radioEl.duration > 0) {
      $('#seek').value = String(Math.round((radioEl.currentTime / radioEl.duration) * 1000));
      $('#tNow').textContent = mmss(radioEl.currentTime);
      $('#tEnd').textContent = mmss(radioEl.duration);
      if (going && Date.now() - resumeSavedAt > RESUME_EVERY) {
        resumeSavedAt = Date.now();
        saveEpisodePos();
      }
    }
    tickSleep();
    return;
  }
  const d = deck().el;
  const dur = d.duration;

  if (current && isFinite(dur) && dur > 0) {
    $('#seek').value = String(Math.round((d.currentTime / dur) * 1000));
    $('#tNow').textContent = mmss(d.currentTime);
    $('#tEnd').textContent = mmss(dur);

    const left = dur - d.currentTime;
    const fade = fadeLengthFor(dur);
    if (settings.crossfade && fade > 0 && !fading && !d.paused && !scratch && left <= fade && left > 0.4
        && queue.length && !sleepEndsHere()) {
      next({ fade: true });
    }

    // belt and braces: if a track somehow finished without handing over, move on
    if (playing && !fading && !scratch && d.paused && left <= 0.25 && queue.length) next();
  }

  if (playing !== !d.paused && !fading) {
    playing = !d.paused;
    saveResume();                              // pausing is worth remembering
    render();
  }
  updateArms();
  if (playing && Date.now() - resumeSavedAt > RESUME_EVERY) {
    resumeSavedAt = Date.now();
    saveResume();
  }
  tickSleep();
}, 250);

for (const d of decks) {
  d.el.addEventListener('ended', () => {
    if (scratch) return;                 // scratched off the end; stay put
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
  if (onAir()) radioEl.pause();
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
/* Ask the browser to promise not to evict this app's storage. Without the
   promise, Android is free to throw the music away when space gets tight,
   and the first you know of it is an empty library. Chrome grants it
   silently to an installed app, so asking on every launch costs nothing and
   covers a library added before the app was installed. */
async function askToPersist() {
  if (askedToPersist || !navigator.storage || !navigator.storage.persist) return;
  askedToPersist = true;
  try { await navigator.storage.persist(); } catch {}
}

async function storageIsPersistent() {
  try {
    if (!navigator.storage || !navigator.storage.persisted) return null;
    return await navigator.storage.persisted();
  } catch {
    return null;
  }
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
  if (added) levelPending();
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
    box.innerHTML = `<p class="hint">This browser can't watch a folder for new music — ` +
      (isPhone()
        ? 'no phone browser can, and none can go looking through your storage either. ' +
          'Choosing the files yourself is the way in, and a whole folder goes in at once.'
        : 'Chrome or Edge on a computer can. "Choose a folder" above imports the lot in one go.') +
      '</p>';
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
  if (!lib.length) { line.textContent = ''; return; }
  const kept = await storageIsPersistent();
  line.textContent =
    `${lib.length} track${lib.length === 1 ? '' : 's'} on this device — ${mb(used)}${quota}.` +
    (kept === false
      ? ' This browser has not promised to keep it, so save a backup and keep your original files.'
      : '');
}


/* ───────────────────────── radio ─────────────────────────

   Live stations, deliberately kept apart from the decks. A stream plays on
   its own element that never joins the Web Audio graph: a cross-origin
   stream routed through it comes out silent unless the station sends CORS
   headers, and most don't. That means no scratching or crossfading a live
   stream, which is right anyway.

   Stations come from Radio Browser, an open community directory — no key,
   no scraping of anyone's app. */

const STATIONS_KEY = 'stations';
const RADIO_API = 'https://de1.api.radio-browser.info/json/stations/search';
const GENRES = ['dance', 'house', 'reggae', 'country', 'rock', 'pop',
  '90s', '80s', 'jazz', 'chillout', 'news', 'sport'];

let stations = [];              // saved ones
let nowStream = null;           // a station or a podcast episode, if either is on
const radioEl = new Audio();
radioEl.preload = 'none';

const onAir = () => !!nowStream;
const isLive = () => !!nowStream && nowStream.kind === 'station';
const saveStations = () => store.setPref(STATIONS_KEY, stations).catch(() => {});
const isSaved = url => stations.some(s => s.url === url);

function radioStatus(text) {
  const el = $('#stationStatus');
  el.hidden = !text;
  el.textContent = text || '';
}

/* Most stations still only offer plain http, which a page served over https
   isn't allowed to load at all — better to say so than to fail silently. */
function playableStations(list) {
  const secure = location.protocol === 'https:';
  const out = [], skipped = [];
  for (const st of list) {
    const url = st.url_resolved || st.url;
    if (!url) continue;
    if (secure && !url.startsWith('https://')) { skipped.push(st); continue; }
    out.push({
      id: st.stationuuid || uid(),
      name: st.name ? st.name.trim() : 'Unnamed station',
      url,
      favicon: st.favicon && st.favicon.startsWith('https://') ? st.favicon : '',
      tags: (st.tags || '').split(',').slice(0, 2).filter(Boolean).join(' · '),
      country: st.country || '',
    });
  }
  return { out, skipped: skipped.length };
}

async function searchStations({ name = '', tag = '' } = {}) {
  radioStatus('Searching…');
  $('#stationResults').innerHTML = '';
  const params = new URLSearchParams({
    limit: '30', hidebroken: 'true', order: 'clickcount', reverse: 'true',
  });
  if (name) params.set('name', name);
  if (tag) params.set('tag', tag);

  let list;
  try {
    const res = await fetch(`${RADIO_API}?${params}`, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    list = await res.json();
  } catch {
    radioStatus("Couldn't reach the station directory — you need a connection for this, " +
      'and you can still add a station by its stream link.');
    return;
  }

  const { out, skipped } = playableStations(Array.isArray(list) ? list : []);
  $('#resultsHead').hidden = !out.length;
  $('#stationResults').innerHTML = out.map(stationTile).join('');
  radioStatus(out.length
    ? `${out.length} station${out.length === 1 ? '' : 's'}` +
      (skipped ? ` · ${skipped} skipped, they only stream over http` : '')
    : 'Nothing found' + (skipped ? ` — ${skipped} matched but only stream over http` : ''));
}

function stationTile(st) {
  const art = st.favicon
    ? `<img src="${esc(st.favicon)}" alt="" loading="lazy"
         onerror="this.remove()" />`
    : esc((st.name || '?').trim()[0].toUpperCase());
  const saved = isSaved(st.url);
  return `
    <button class="tile ${nowStream && nowStream.url === st.url ? 'on' : ''}"
            data-station='${esc(JSON.stringify(st))}'>
      <span class="tile-art" style="background:linear-gradient(150deg,hsl(${hueOf(st.id)} 55% 45%),hsl(${(hueOf(st.id) + 40) % 360} 50% 30%))">
        ${art}
        <span class="tile-save ${saved ? 'on' : ''}" data-save="1" role="button"
              aria-label="${saved ? 'Remove from your stations' : 'Save this station'}">
          <svg class="ic"><use href="#i-heart"/></svg>
        </span>
      </span>
      <b>${esc(st.name)}</b>
      <span>${esc(st.tags || st.country || 'Live radio')}</span>
    </button>`;
}

function renderRadio() {
  $('#radioPanel').hidden = settings.source !== 'radio';
  $('#savedHead').hidden = !stations.length;
  $('#savedStations').innerHTML = stations.map(stationTile).join('');
  if (!$('#genreChips').children.length) {
    $('#genreChips').innerHTML = GENRES
      .map(g => `<button class="chip" data-genre="${g}">${g}</button>`).join('');
  }
}

/* One player for anything that isn't a record: a live station, or a podcast
   episode. An episode can be seeked and remembers where you got to; a station
   can do neither, so the seek bar and skip buttons stand down for one. */
async function playStream(item) {
  stopAll();                                   // the decks stand down
  nowStream = item;
  document.body.classList.add('on-air');
  document.body.classList.toggle('is-live', item.kind === 'station');
  radioEl.src = item.url;

  $('#onAir').hidden = false;
  $('#onAirName').textContent = item.name;
  $('#onAirState').textContent = item.kind === 'station' ? 'Connecting…' : 'Loading…';
  $('#onAirArt').innerHTML = item.art
    ? `<img src="${esc(item.art)}" alt="" onerror="this.remove()" />`
    : esc((item.name || '?').trim()[0].toUpperCase());
  $('#npTitle').textContent = item.name;
  $('#npArtist').textContent = item.sub || '';

  if (item.kind === 'episode') {
    const at = Number(episodePos[item.url]) || 0;
    if (at > 5) {
      radioEl.addEventListener('loadedmetadata', () => {
        if (isFinite(radioEl.duration) && at < radioEl.duration - 5) radioEl.currentTime = at;
      }, { once: true });
    }
  }

  try {
    await radioEl.play();
  } catch {
    $('#onAirState').textContent = "Couldn't start — tap play";
  }
  render();
  if ('mediaSession' in navigator) {
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: item.name,
        artist: item.sub || (item.kind === 'station' ? 'Live radio' : 'Podcast'),
        album: 'Tunage',
        artwork: item.art ? [{ src: item.art }] : [],
      });
    } catch {}
  }
}

const playStation = st => playStream({
  kind: 'station', name: st.name, sub: st.tags || st.country || 'Live radio',
  url: st.url, art: st.favicon,
});

function stopStation() {
  if (nowStream && nowStream.kind === 'episode') saveEpisodePos();
  radioEl.pause();
  radioEl.removeAttribute('src');
  radioEl.load();
  nowStream = null;
  playing = false;
  document.body.classList.remove('on-air', 'is-live');
  $('#onAir').hidden = true;
  render();
}

radioEl.addEventListener('playing', () => {
  $('#onAirState').textContent = isLive() ? 'Live' : 'Playing';
  playing = true;
  render();
});
radioEl.addEventListener('waiting', () => { $('#onAirState').textContent = 'Buffering…'; });
radioEl.addEventListener('pause', () => { if (onAir()) { playing = false; render(); } });
radioEl.addEventListener('error', () => {
  if (!onAir()) return;
  $('#onAirState').textContent = "That stream wouldn't play";
  playing = false;
  render();
});

function saveStation(st) {
  if (isSaved(st.url)) stations = stations.filter(x => x.url !== st.url);
  else stations.push(st);
  saveStations();
  renderRadio();
  $('#stationResults').innerHTML = $('#stationResults').innerHTML;   // refresh hearts
  toast(isSaved(st.url) ? `Saved ${st.name}` : `Removed ${st.name}`);
}

/* ── wiring ── */

$('#stationGo').addEventListener('click', () => searchStations({ name: $('#stationSearch').value.trim() }));
$('#stationSearch').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); searchStations({ name: e.target.value.trim() }); }
});

$('#genreChips').addEventListener('click', e => {
  const chip = e.target.closest('[data-genre]');
  if (!chip) return;
  $$('#genreChips .chip').forEach(c => c.classList.toggle('on', c === chip));
  $('#stationSearch').value = '';
  searchStations({ tag: chip.dataset.genre });
});

function onStationClick(e) {
  const tile = e.target.closest('.tile');
  if (!tile) return;
  let st;
  try { st = JSON.parse(tile.dataset.station); } catch { return; }
  if (e.target.closest('[data-save]')) saveStation(st);
  else playStation(st);
}
$('#stationResults').addEventListener('click', onStationClick);
$('#savedStations').addEventListener('click', onStationClick);

$('#addStationUrl').addEventListener('click', () => {
  $('#stationErr').hidden = true;
  $('#stationName').value = '';
  $('#stationUrl').value = '';
  openSheet('#stationSheet');
});

$('#stationSave').addEventListener('click', () => {
  const name = $('#stationName').value.trim();
  const url = $('#stationUrl').value.trim();
  const err = $('#stationErr');
  if (!url) { err.textContent = 'Paste the stream link first.'; err.hidden = false; return; }
  if (location.protocol === 'https:' && !url.startsWith('https://')) {
    err.textContent = "That link isn't https, so the browser will refuse to play it.";
    err.hidden = false;
    return;
  }
  const st = { id: uid(), name: name || url.replace(/^https?:\/\//, '').split('/')[0],
    url, favicon: '', tags: '', country: '' };
  stations.push(st);
  saveStations();
  closeSheets();
  renderRadio();
  playStation(st);
});


/* ───────────────────────── podcasts ─────────────────────────

   A show is an RSS feed; an episode is an audio file listed in it. Shows are
   found through the iTunes Search directory, which is open and needs no key,
   and the feed itself is read straight from the publisher.

   The catch is CORS: plenty of feeds don't allow another site to read them
   from a browser, and without a server of our own there is nothing to be
   done about it. Those are reported plainly rather than failing quietly —
   the episode audio itself almost always plays, it's reading the list that
   can be refused. */

const PODCASTS_KEY = 'podcasts';
const EPISODES_KEY = 'episodePos';
const PODCAST_API = 'https://itunes.apple.com/search';

let podcasts = [];              // subscribed shows
let episodePos = {};            // how far into each episode you got
let openShow = null;            // the show whose episodes are listed

const savePodcasts = () => store.setPref(PODCASTS_KEY, podcasts).catch(() => {});
const isSubscribed = feed => podcasts.some(p => p.feed === feed);

function saveEpisodePos() {
  if (!nowStream || nowStream.kind !== 'episode') return;
  const at = radioEl.currentTime || 0;
  if (at > 5) episodePos[nowStream.url] = Math.floor(at);
  else delete episodePos[nowStream.url];
  store.setPref(EPISODES_KEY, episodePos).catch(() => {});
}

function podcastStatus(text) {
  const el = $('#podcastStatus');
  el.hidden = !text;
  el.textContent = text || '';
}

async function searchPodcasts(term) {
  if (!term) return;
  podcastStatus('Searching…');
  $('#podcastResults').innerHTML = '';
  $('#episodes').innerHTML = '';
  $('#episodesHead').hidden = true;
  openShow = null;

  const params = new URLSearchParams({ media: 'podcast', limit: '24', term });
  let data;
  try {
    const res = await fetch(`${PODCAST_API}?${params}`);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    data = await res.json();
  } catch {
    podcastStatus("Couldn't reach the podcast directory. You need a connection for " +
      'searching, and you can always add a show by its feed address instead.');
    return;
  }

  const shows = (data.results || [])
    .filter(r => r.feedUrl)
    .map(r => ({
      id: r.collectionId ? String(r.collectionId) : uid(),
      name: r.collectionName || r.trackName || 'Untitled show',
      author: r.artistName || '',
      feed: r.feedUrl,
      art: r.artworkUrl600 || r.artworkUrl100 || '',
    }));

  $('#podcastResults').innerHTML = shows.map(showTile).join('');
  podcastStatus(shows.length ? `${shows.length} show${shows.length === 1 ? '' : 's'}`
    : 'Nothing found');
}

function showTile(show) {
  const art = show.art
    ? `<img src="${esc(show.art)}" alt="" loading="lazy" onerror="this.remove()" />`
    : esc((show.name || '?').trim()[0].toUpperCase());
  const subbed = isSubscribed(show.feed);
  return `
    <button class="tile" data-show='${esc(JSON.stringify(show))}'>
      <span class="tile-art" style="background:linear-gradient(150deg,hsl(${hueOf(show.id)} 50% 42%),hsl(${(hueOf(show.id) + 40) % 360} 45% 28%))">
        ${art}
        <span class="tile-save ${subbed ? 'on' : ''}" data-sub="1" role="button"
              aria-label="${subbed ? 'Unsubscribe' : 'Subscribe'}">
          <svg class="ic"><use href="#i-heart"/></svg>
        </span>
      </span>
      <b>${esc(show.name)}</b>
      <span>${esc(show.author || 'Podcast')}</span>
    </button>`;
}

/* Reads a feed and pulls out what's needed to list and play episodes. */
function parseFeed(xml) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror')) return null;
  const text = (node, tag) => {
    const el = node.getElementsByTagName(tag)[0];
    return el ? el.textContent.trim() : '';
  };
  const channel = doc.querySelector('channel') || doc.documentElement;
  const showArt = (channel.getElementsByTagName('itunes:image')[0] || {}).getAttribute
    ? channel.getElementsByTagName('itunes:image')[0].getAttribute('href')
    : text(channel, 'url');

  const episodes = [...doc.getElementsByTagName('item')].slice(0, 60).map(item => {
    const enclosure = item.getElementsByTagName('enclosure')[0];
    return {
      title: text(item, 'title') || 'Untitled episode',
      url: enclosure ? enclosure.getAttribute('url') : '',
      date: text(item, 'pubDate'),
      duration: text(item, 'itunes:duration'),
    };
  }).filter(ep => ep.url);

  return { title: text(channel, 'title'), art: showArt || '', episodes };
}

async function openPodcast(show) {
  openShow = show;
  $('#episodesHead').hidden = false;
  $('#episodesHead').textContent = show.name;
  $('#episodes').innerHTML = '';
  podcastStatus('Fetching episodes…');

  let xml;
  try {
    const res = await fetch(show.feed);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    xml = await res.text();
  } catch {
    podcastStatus(`Couldn't read ${show.name}'s feed. Plenty of podcast feeds don't let ` +
      'other sites read them from a browser, and without a server of our own there ' +
      'is no way round it.');
    return;
  }

  const feed = parseFeed(xml);
  if (!feed || !feed.episodes.length) {
    podcastStatus(`Nothing playable found in ${show.name}'s feed.`);
    return;
  }
  if (!show.art && feed.art) show.art = feed.art;

  podcastStatus(`${feed.episodes.length} episode${feed.episodes.length === 1 ? '' : 's'}`);
  $('#episodes').innerHTML = feed.episodes.map(ep => {
    const at = Number(episodePos[ep.url]) || 0;
    const when = ep.date ? new Date(ep.date) : null;
    const bits = [
      when && !isNaN(when) ? when.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '',
      ep.duration,
      at > 5 ? `${mmss(at)} in` : '',
    ].filter(Boolean).join(' · ');
    return `
      <li data-episode='${esc(JSON.stringify({ ...ep, show: show.name, art: show.art }))}'>
        <span class="who" data-act="play">
          <b>${esc(ep.title)}</b>
          <span>${esc(bits)}</span>
        </span>
        <button class="mini" data-act="play">Play</button>
      </li>`;
  }).join('');
}

function renderPodcasts() {
  $('#podcastPanel').hidden = settings.source !== 'podcasts';
  $('#subsHead').hidden = !podcasts.length;
  $('#subscriptions').innerHTML = podcasts.map(showTile).join('');
}

function subscribe(show) {
  if (isSubscribed(show.feed)) podcasts = podcasts.filter(p => p.feed !== show.feed);
  else podcasts.push(show);
  savePodcasts();
  renderPodcasts();
  render();
  toast(isSubscribed(show.feed) ? `Subscribed to ${show.name}` : `Unsubscribed from ${show.name}`);
}

/* ── wiring ── */

$('#podcastGo').addEventListener('click', () => searchPodcasts($('#podcastSearch').value.trim()));
$('#podcastSearch').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); searchPodcasts(e.target.value.trim()); }
});

function onShowClick(e) {
  const tile = e.target.closest('.tile');
  if (!tile) return;
  let show;
  try { show = JSON.parse(tile.dataset.show); } catch { return; }
  if (e.target.closest('[data-sub]')) subscribe(show);
  else openPodcast(show);
}
$('#podcastResults').addEventListener('click', onShowClick);
$('#subscriptions').addEventListener('click', onShowClick);

$('#episodes').addEventListener('click', e => {
  const li = e.target.closest('li[data-episode]');
  if (!li || !e.target.closest('[data-act]')) return;
  let ep;
  try { ep = JSON.parse(li.dataset.episode); } catch { return; }
  playStream({
    kind: 'episode', name: ep.title, sub: ep.show || 'Podcast',
    url: ep.url, art: ep.art || '',
  });
});

$('#addFeedUrl').addEventListener('click', () => {
  $('#feedErr').hidden = true;
  $('#feedUrl').value = '';
  openSheet('#feedSheet');
});

$('#feedSave').addEventListener('click', async () => {
  const url = $('#feedUrl').value.trim();
  const err = $('#feedErr');
  if (!url) { err.textContent = 'Paste the feed address first.'; err.hidden = false; return; }
  if (location.protocol === 'https:' && !url.startsWith('https://')) {
    err.textContent = "That address isn't https, so the browser won't fetch it.";
    err.hidden = false;
    return;
  }
  const show = { id: uid(), name: url.replace(/^https?:\/\//, '').split('/')[0], author: '', feed: url, art: '' };
  podcasts.push(show);
  savePodcasts();
  closeSheets();
  renderPodcasts();
  render();
  openPodcast(show);
});



/* ───────────────────────── YouTube ─────────────────────────

   A launcher, not a player. An embedded player stops the moment you leave the
   page and carries none of your account, so trying to be a YouTube client in
   here was always the worse version of an app already on the phone. This hands
   the address over and gets out of the way.

   intent:// is how a web page reaches Android's Open-with list; everywhere else
   an ordinary link goes to whatever handles YouTube. */

const YT_HOME = 'https://www.youtube.com/';

const isAndroid = () => /Android/i.test(navigator.userAgent || '');

function ytStatus(text) {
  const el = $('#ytStatus');
  if (!el) return;
  el.hidden = !text;
  el.textContent = text || '';
}

function intentUrlFor(httpsUrl) {
  let u;
  try { u = new URL(httpsUrl); } catch { return null; }
  return `intent://${u.host}${u.pathname}${u.search}#Intent;scheme=https;` +
    'action=android.intent.action.VIEW;' +
    `S.browser_fallback_url=${encodeURIComponent(httpsUrl)};end`;
}

function openYouTubeApp() {
  const intent = isAndroid() ? intentUrlFor(YT_HOME) : null;
  const a = document.createElement('a');
  a.href = intent || YT_HOME;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  document.body.appendChild(a);
  a.click();
  a.remove();
  ytStatus('');
}

function renderYouTube() {
  const panel = $('#youtubePanel');
  if (panel) panel.hidden = settings.source !== 'youtube';
}

$('#ytOpenApp').addEventListener('click', openYouTubeApp);

/* ───────────────────────── backup ─────────────────────────

   Playlists, saved stations and subscriptions live in this browser and
   nowhere else, so clearing site data takes the lot. This writes them to a
   file you keep.

   The music itself isn't in there — those are your own files, and a backup
   the size of a record collection would be no use to anyone. What matters is
   that a playlist survives losing them: entries are stored by filename and
   size rather than by internal id, so once the same files are back in the
   library the playlists can be stitched onto them again. Ids alone would
   restore playlists that look right and play nothing. */

const BACKUP_VERSION = 1;

const trackKey = t => `${t.file}\u0000${t.size}`;
const slim = t => ({ file: t.file, size: t.size, title: t.title, artist: t.artist });

function buildBackup() {
  return {
    app: 'tunage',
    version: BACKUP_VERSION,
    exported: new Date().toISOString(),
    settings: {
      shuffle: settings.shuffle, crossfade: settings.crossfade, level: settings.level,
    },
    playlists: playlists.map(pl => ({
      name: pl.name,
      created: pl.created,
      tracks: pl.tracks.map(byId).filter(Boolean).map(slim),
    })),
    stations,
    podcasts,
    episodePos,
    // enough to put loudness measurements back without re-analysing everything
    library: lib.map(t => ({ ...slim(t), gain: t.gain, lufs: t.lufs, peak: t.peak,
      unplayable: t.unplayable || undefined })),
  };
}

function backupStatus(text) {
  const el = $('#backupStatus');
  el.hidden = !text;
  el.textContent = text || '';
}

function exportBackup() {
  const data = JSON.stringify(buildBackup(), null, 2);
  const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `tunage-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  backupStatus(`Saved ${playlists.length} playlist${playlists.length === 1 ? '' : 's'}, ` +
    `${stations.length} station${stations.length === 1 ? '' : 's'} and ` +
    `${podcasts.length} show${podcasts.length === 1 ? '' : 's'}.`);
}

async function importBackup(file) {
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    backupStatus("That file isn't readable as a backup.");
    return;
  }
  if (!data || data.app !== 'tunage' || !Array.isArray(data.playlists)) {
    backupStatus("That doesn't look like a Tunage backup.");
    return;
  }

  const here = new Map(lib.map(t => [trackKey(t), t]));
  let addedPlaylists = 0, matched = 0, missing = 0, addedStations = 0, addedShows = 0,
    measured = 0;

  for (const saved of data.playlists) {
    const ids = [];
    for (const entry of saved.tracks || []) {
      const found = here.get(trackKey(entry));
      if (found) { ids.push(found.id); matched++; } else missing++;
    }
    const existing = playlists.find(pl => pl.name === saved.name);
    if (existing) {
      const fresh = ids.filter(id => !existing.tracks.includes(id));
      existing.tracks.push(...fresh);
    } else {
      playlists.push({ id: uid(), name: saved.name || 'Playlist',
        tracks: ids, created: saved.created || Date.now() });
      addedPlaylists++;
    }
  }

  for (const st of data.stations || []) {
    if (!st || !st.url || stations.some(x => x.url === st.url)) continue;
    stations.push(st);
    addedStations++;
  }
  for (const show of data.podcasts || []) {
    if (!show || !show.feed || podcasts.some(x => x.feed === show.feed)) continue;
    podcasts.push(show);
    addedShows++;
  }

  if (data.episodePos && typeof data.episodePos === 'object') {
    for (const [url, at] of Object.entries(data.episodePos)) {
      episodePos[url] = Math.max(Number(episodePos[url]) || 0, Number(at) || 0);
    }
  }

  // put loudness back on tracks that have been re-imported since
  for (const entry of data.library || []) {
    const found = here.get(trackKey(entry));
    if (found && found.gain === undefined && entry.gain !== undefined) {
      found.gain = entry.gain;
      found.lufs = entry.lufs;
      found.peak = entry.peak;
      await store.putTrack(found).catch(() => {});
      measured++;
    }
  }

  if (data.settings) {
    settings.shuffle = data.settings.shuffle !== false;
    settings.crossfade = data.settings.crossfade !== false;
    settings.level = data.settings.level !== false;
    saveSettings();
  }

  savePlaylists();
  saveStations();
  savePodcasts();
  store.setPref(EPISODES_KEY, episodePos).catch(() => {});
  rebuildQueue();
  render();

  const bits = [];
  if (addedPlaylists) bits.push(`${addedPlaylists} playlist${addedPlaylists === 1 ? '' : 's'}`);
  if (matched) bits.push(`${matched} track${matched === 1 ? '' : 's'} matched`);
  if (addedStations) bits.push(`${addedStations} station${addedStations === 1 ? '' : 's'}`);
  if (addedShows) bits.push(`${addedShows} show${addedShows === 1 ? '' : 's'}`);
  if (measured) bits.push(`${measured} volume reading${measured === 1 ? '' : 's'}`);
  backupStatus((bits.length ? 'Restored ' + bits.join(', ') + '.' : 'Nothing new to restore.') +
    (missing ? ` ${missing} playlist track${missing === 1 ? '' : 's'} not in your library — ` +
      'add those files back and restore again to pick them up.' : ''));
}

$('#exportBackup').addEventListener('click', exportBackup);
$('#importBackupBtn').addEventListener('click', () => $('#backupInput').click());
$('#backupInput').addEventListener('change', e => {
  if (e.target.files[0]) importBackup(e.target.files[0]);
  e.target.value = '';
});


/* ───────────────────────── voice ─────────────────────────

   Two ways in, one brain. The microphone button hands whatever was heard to
   runCommand(); so does a ?say= link, which is how Siri or Google Assistant
   reach the app — they can't talk to a web page, but they can open a URL.

   No browser lets a web app listen for its own name in the background, so
   there is no "Tunage, ..." out of thin air. The word is still stripped off
   the front of anything heard, because people say it and a Shortcut phrase
   tends to carry it in. */

const VOICE_KEYS = ['say', 'play', 'q'];   // ?say=… is the documented one

const wordsOf = s => (s || '').toLowerCase()
  .replace(/[.,!?;:"'`]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

/* Spoken text arrives without punctuation and with the app's name attached
   often as not: "tunage play capital fm", "hey tunage, next". */
function stripWake(text) {
  return wordsOf(text)
    .replace(/^(hey |ok |okay )?(tunage|tuneage|tunedge|tunich|toonage)\b[, ]*/, '')
    .replace(/^(please|can you|could you)\b\s*/, '')
    .trim();
}

const scoreMatch = (hay, needle) => {
  const h = wordsOf(hay);
  if (!h || !needle) return 0;
  if (h === needle) return 3;
  if (h.startsWith(needle)) return 2;
  if (h.includes(needle)) return 1;
  return 0;
};

/* Best track by title, then artist — the spoken words are rarely exact. */
function findTrack(term) {
  let best = null, bestScore = 0;
  for (const t of lib) {
    if (t.unplayable) continue;
    const s = Math.max(scoreMatch(t.title, term), scoreMatch(t.artist, term) - 0.5);
    if (s > bestScore) { best = t; bestScore = s; }
  }
  return bestScore ? best : null;
}

function findPlaylist(term) {
  let best = null, bestScore = 0;
  for (const pl of playlists) {
    const s = scoreMatch(pl.name, term);
    if (s > bestScore) { best = pl; bestScore = s; }
  }
  return bestScore ? best : null;
}

const findSavedStation = term => {
  let best = null, bestScore = 0;
  for (const st of stations) {
    const s = scoreMatch(st.name, term);
    if (s > bestScore) { best = st; bestScore = s; }
  }
  return bestScore ? best : null;
};

const findShow = term => {
  let best = null, bestScore = 0;
  for (const sh of podcasts) {
    const s = scoreMatch(sh.name, term);
    if (s > bestScore) { best = sh; bestScore = s; }
  }
  return bestScore ? best : null;
};

function voiceStatus(text, { heard = null } = {}) {
  const el = $('#voiceSaid');
  if (!el) return;
  el.hidden = !text && !heard;
  el.innerHTML = (heard ? `<b>“${esc(heard)}”</b> — ` : '') + esc(text || '');
}

/* Switch what's playing to a playlist (or everything) and start it. */
function playSource(source) {
  settings.source = source;
  saveSettings();
  rebuildQueue();
  if (onAir()) stopStation();
  if (!pool().length) { stopAll(); render(); return false; }
  next({ fade: false });
  render();
  return true;
}

async function playStationByName(term) {
  const saved = findSavedStation(term);
  if (saved) { playStation(saved); return `Playing ${saved.name}`; }

  settings.source = 'radio';
  saveSettings();
  render();
  await searchStations({ name: term });
  const first = $('#stationResults .tile');
  if (!first) return `Couldn't find a station called “${term}”`;
  let st;
  try { st = JSON.parse(first.dataset.station); } catch { return 'That station came back unreadable'; }
  playStation(st);
  return `Playing ${st.name}`;
}

async function playShowByName(term) {
  const sub = findShow(term);
  if (!sub) return `You're not subscribed to a show called “${term}”`;
  settings.source = 'podcasts';
  saveSettings();
  render();
  await openPodcast(sub);
  const first = $('#episodes .tile');
  if (!first) return `Couldn't read ${sub.name}'s episode list`;
  first.click();
  return `Playing the latest ${sub.name}`;
}

/* The whole grammar. Returns what to show the user; throws nothing. */
async function runCommand(raw) {
  const text = stripWake(raw);
  if (!text) return "Didn't catch that";

  // ── transport: no argument, so match these before anything with a subject
  if (/^(stop|pause|shut up|be quiet)\b/.test(text)) {
    if (onAir()) { stopStation(); return 'Stopped'; }
    if (playing) { togglePlay(); return 'Paused'; }
    return 'Nothing was playing';
  }
  if (/^(next|skip|forward)\b/.test(text)) {
    if (onAir()) return "Can't skip a live stream";
    next({ fade: settings.crossfade && playing });
    return 'Skipped';
  }
  if (/^(previous|back|go back|last one)\b/.test(text)) {
    if (onAir()) return "Can't go back on a live stream";
    prev();
    return 'Went back';
  }
  if (/^(resume|carry on|keep going|unpause|continue)$/.test(text) ||
      /^(play|play it|play music|play something|play anything)$/.test(text)) {
    if (!playing) await togglePlay();
    return playing ? 'Playing' : 'Nothing to play — add some music first';
  }
  if (/^shuffle (on|off)$/.test(text)) {
    settings.shuffle = text.endsWith('on');
    saveSettings(); rebuildQueue(); render();
    return `Shuffle ${settings.shuffle ? 'on' : 'off'}`;
  }
  const nap = text.match(/^(?:sleep|sleep timer|set a sleep timer)(?: for)? (\d+) (minute|minutes|hour|hours)$/);
  if (nap) {
    const mins = Number(nap[1]) * (nap[2].startsWith('hour') ? 60 : 1);
    setSleep(mins);
    return `Sleeping in ${mins} minutes`;
  }

  // ── "play X": work out which X
  const m = text.match(/^(?:play|put on|listen to|start)\s+(.+)$/);
  if (!m) return `Didn't understand “${text}”`;
  let what = m[1].replace(/\s+(please|now)$/, '').trim();

  // an explicit steer wins over any guessing
  let forced = null;
  let s;
  if ((s = what.match(/^(?:the\s+)?(?:radio\s+station|station|radio)\s+(.+)$/))) { forced = 'radio'; what = s[1]; }
  else if ((s = what.match(/^(.+?)\s+on (?:the )?radio$/))) { forced = 'radio'; what = s[1]; }
  else if ((s = what.match(/^(?:the\s+)?(?:podcast|show)\s+(.+)$/))) { forced = 'podcast'; what = s[1]; }
  else if ((s = what.match(/^(.+?)\s+(?:podcast|show)$/))) { forced = 'podcast'; what = s[1]; }
  else if ((s = what.match(/^(?:my|the)\s+(.+?)\s+playlist$/))) { forced = 'playlist'; what = s[1]; }
  else if ((s = what.match(/^(?:the\s+)?playlist\s+(.+)$/))) { forced = 'playlist'; what = s[1]; }
  else if ((s = what.match(/^my\s+(.+)$/))) { forced = 'playlist'; what = s[1]; }
  what = what.trim();
  if (!what) return "Didn't catch what to play";

  if (forced === 'radio') return playStationByName(what);
  if (forced === 'podcast') return playShowByName(what);
  if (forced === 'playlist') {
    const pl = findPlaylist(what);
    if (!pl) return `No playlist called “${what}”`;
    return playSource('pl:' + pl.id) ? `Playing ${pl.name}` : `${pl.name} is empty`;
  }

  // everything / all my music
  if (/^(everything|all my music|all of it|my music|music)$/.test(what)) {
    return playSource('tunage') ? 'Playing everything' : 'There is no music in here yet';
  }

  // no steer given: your own music first — it's offline and it's yours
  const track = findTrack(what);
  if (track) {
    if (onAir()) stopStation();
    if (settings.source === 'radio' || settings.source === 'podcasts') {
      settings.source = 'tunage';
      saveSettings();
      rebuildQueue();
    }
    await playTrack(track);
    render();
    return `Playing ${track.title}`;
  }

  const pl = findPlaylist(what);
  if (pl) return playSource('pl:' + pl.id) ? `Playing ${pl.name}` : `${pl.name} is empty`;

  const saved = findSavedStation(what);
  if (saved) { playStation(saved); return `Playing ${saved.name}`; }

  const show = findShow(what);
  if (show) return playShowByName(what);

  // nothing of yours matches, so it's probably a station out there
  return playStationByName(what);
}

/* ── the microphone ──
   Speech recognition is the browser's, not ours, and both Chrome's and
   Safari's send the audio away to be transcribed — so this is the second
   thing in Tunage that needs a connection. Firefox has none of it. */

const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
const canListen = () => typeof SpeechRec === 'function';

/* 'granted' | 'prompt' | 'denied' | 'unknown'. Chrome answers this; Safari
   throws on a microphone query, which is what 'unknown' covers. */
async function micPermission() {
  try {
    if (!navigator.permissions || !navigator.permissions.query) return 'unknown';
    const st = await navigator.permissions.query({ name: 'microphone' });
    return st.state || 'unknown';
  } catch {
    return 'unknown';
  }
}
let listening = null;

function renderVoice() {
  const auto = $('#autoListen');
  if (auto) {
    auto.hidden = !canListen();
    auto.classList.toggle('on', settings.autoListen);
    auto.setAttribute('aria-pressed', String(!!settings.autoListen));
  }
  const btn = $('#voiceBtn');
  if (!btn) return;
  btn.hidden = !canListen();
  btn.classList.toggle('listening', !!listening);
  btn.setAttribute('aria-label', listening ? 'Stop listening' : 'Speak a command');
  const help = $('#voiceUnsupported');
  if (help) help.hidden = canListen();
  const here = location.origin + location.pathname.replace(/[^/]*$/, '');
  const url = $('#voiceUrl');
  if (url && !url.textContent) url.textContent = here + '?listen=1';
  const sayUrl = $('#voiceSayUrl');
  if (sayUrl && !sayUrl.textContent) sayUrl.textContent = here + '?say=play ';
}

async function handleSpoken(heard) {
  voiceStatus('…', { heard });
  let said;
  try { said = await runCommand(heard); }
  catch { said = 'That went wrong somewhere'; }
  voiceStatus(said, { heard });
  toast(said);
}

function startListening({ automatic = false } = {}) {
  if (!canListen() || listening) return;
  let rec;
  try { rec = new SpeechRec(); } catch { return; }
  rec.lang = navigator.language || 'en-GB';
  rec.interimResults = false;
  rec.maxAlternatives = 1;

  rec.onresult = e => {
    const heard = e.results[0][0].transcript;
    handleSpoken(heard);
  };
  rec.onerror = e => {
    if (e.error === 'not-allowed') {
      voiceStatus(automatic
        ? 'Tap the microphone once to allow it, and Tunage will listen every time it opens'
        : 'The microphone is blocked for this site — allow it in your browser settings');
      renderVoice();
      return;
    }
    // nothing said into an automatic listen is the normal way it ends
    if (e.error === 'no-speech') { voiceStatus(automatic ? '' : "Didn't hear anything"); return; }
    // anything else stays on screen either way: a microphone that quietly
    // fails to open looks identical to one that was never asked to
    voiceStatus(e.error === 'network'
      ? "Speech recognition needs a connection — tap the microphone to try again"
      : `Couldn't start listening (${esc(e.error || 'unknown')}) — tap the microphone`);
  };
  rec.onend = () => { listening = null; renderVoice(); };

  listening = rec;
  renderVoice();
  voiceStatus('Listening…');
  try {
    rec.start();
  } catch {
    listening = null;
    renderVoice();
    voiceStatus('Tap the microphone to speak');
  }
}

function stopListening() {
  if (!listening) return;
  try { listening.stop(); } catch {}
  listening = null;
  renderVoice();
}

/* ── being opened with a request already in hand ──
   Siri and Assistant can't speak to a page, but they can open a link, so a
   Shortcut that dictates a phrase and opens ?say=<phrase> gets the same
   result. The command runs after boot, once the library is actually loaded. */
function pendingCommand() {
  let params;
  try { params = new URL(location.href).searchParams; } catch { return null; }
  for (const key of VOICE_KEYS) {
    const v = params.get(key);
    if (v && v.trim()) return v.trim();
  }
  return null;
}

async function runPendingCommand() {
  let params;
  try { params = new URL(location.href).searchParams; } catch { params = null; }

  // ?open=radio jumps straight to a section without playing anything — that's
  // what the icon's long-press shortcuts use.
  const open = params && params.get('open');
  if (open === 'radio' || open === 'podcasts' || open === 'youtube' || open === 'tunage') {
    settings.source = open;
    saveSettings();
    rebuildQueue();
    render();
    try { window.history.replaceState(null, '', location.pathname); } catch {}
    return;
  }

  /* ?listen=1 opens with the microphone already running. Android's assistant
     can't dictate into a link the way Shortcuts can, so instead of arriving
     with the request in hand the app arrives ready to hear it. Whether it
     may start without being tapped is the browser's call: an installed app
     that already has the microphone usually can, and where it can't the
     error handler says to tap the button rather than failing silently. */
  if (params && (params.get('listen') === '1' || params.get('listen') === 'true')) {
    try { window.history.replaceState(null, '', location.pathname); } catch {}
    if (!canListen()) { voiceStatus('This browser has no speech recognition — type it instead'); return; }
    startListening();
    return;
  }

  /* Nothing was asked for in the link, so fall back to the standing
     preference: open listening unless told not to. Music already playing
     means the resume picked up where it left off, and a microphone would
     only hear that. */
  if (settings.autoListen && canListen() && !pendingCommand() && !playing && !onAir()) {
    /* Try unless the browser has actually said no. An earlier version only
       started on a 'granted' reading, which sounds safer and isn't: Chrome
       doesn't report the speech-recognition grant through the microphone
       permission reliably, so a phone that listens perfectly well when you
       tap the button reads back as 'prompt' forever and never starts on its
       own. A refusal is cheap to handle; never starting is the bug. */
    const perm = await micPermission();
    if (perm === 'denied') {
      voiceStatus('The microphone is blocked for this site — allow it in your browser settings');
    } else {
      startListening({ automatic: true });
    }
  }

  const asked = pendingCommand();
  if (!asked) return;
  // don't leave it in the address bar to fire again on every reload
  try { window.history.replaceState(null, '', location.pathname); } catch {}
  const said = await runCommand(asked);
  voiceStatus(said, { heard: asked });
  toast(said);
}

$('#voiceBtn').addEventListener('click', () => (listening ? stopListening() : startListening()));
$('#autoListen').addEventListener('click', () => {
  settings.autoListen = !settings.autoListen;
  saveSettings();
  renderVoice();
  if (!settings.autoListen && listening) stopListening();
  toast(settings.autoListen
    ? 'Tunage will listen when it opens'
    : 'Tunage will wait for the microphone button');
});
$('#voiceType').addEventListener('submit', e => {
  e.preventDefault();
  const val = $('#voiceText').value.trim();
  if (!val) return;
  $('#voiceText').value = '';
  handleSpoken(val);
});

/* ───────────────────────── rendering ───────────────────────── */

function render() {
  document.documentElement.style.setProperty('--accent', sourceColour());

  $('#playBtn').innerHTML = `<svg class="ic"><use href="#i-${playing ? 'pause' : 'play'}"/></svg>`;
  $('#playBtn').setAttribute('aria-label', playing ? 'Pause' : 'Play');
  $('#shuffleBtn').classList.toggle('on', settings.shuffle);
  $('#fadeBtn').classList.toggle('on', settings.crossfade);
  $('#levelBtn').classList.toggle('on', settings.level);

  if (current) {
    $('#npTitle').textContent = current.title || current.file;
    $('#npArtist').textContent = current.artist || 'Unknown artist';
  } else {
    $('#npTitle').textContent = lib.length ? 'Ready when you are' : 'Nothing playing yet';
    $('#npArtist').textContent = lib.length
      ? (emptyMessage() || (currentPlaylist()
        ? `Press play for nonstop ${sourceName()}`
        : 'Press play and it keeps going'))
      : 'Add some music to get going';
    $('#seek').value = '0';
    $('#tNow').textContent = $('#tEnd').textContent = '0:00';
  }

  renderDecks();
  renderRadio();
  renderPodcasts();
  renderYouTube();
  renderSources();
  renderQueue();
  renderPlaylist();
  renderLibrary();
}

/* ───────────────────────── the decks ─────────────────────────
   Deck A and Deck B mirror the two audio decks underneath: whichever is on
   air holds the record that's playing, the other one has the next track
   cued. A record only animates onto a platter when that platter's track
   actually changes, so ordinary re-renders leave it alone. */

const cuedOnDeck = [null, null];

function paintDeck(i, track, isLive) {
  const deckEl = $(`.deck[data-deck="${i}"]`);
  if (!deckEl) return;
  const platter = $('.platter', deckEl);
  const vinyl = $('.vinyl', deckEl);
  const label = $('.label', deckEl);

  deckEl.classList.toggle('live', isLive);
  $('.deck-tag', deckEl).textContent = isLive ? 'Now playing' : 'Up next';
  if (isLive && playing) startPlatters();

  const id = track ? track.id : null;
  if (cuedOnDeck[i] === id) return;
  cuedOnDeck[i] = id;

  $('.deck-track', deckEl).textContent = track ? (track.title || track.file) : 'Nothing cued';
  if (!track) {
    label.textContent = '';
    label.style.background = '';
    return;
  }

  const hue = hueOf(track.id);
  label.textContent = (track.title || '?').trim()[0].toUpperCase();
  label.style.background =
    `linear-gradient(140deg,hsl(${hue} 60% 55%),hsl(${(hue + 45) % 360} 55% 42%))`;

  // drop the record onto the platter, and tidy the class up after itself so
  // the deck isn't left permanently mid-animation
  platter.classList.remove('flip');
  void platter.offsetWidth;                 // let the animation start again
  platter.classList.add('flip');
  platter.addEventListener('animationend', () => platter.classList.remove('flip'), { once: true });
}

function renderDecks() {
  const nextUp = queue.map(byId).find(Boolean) || null;
  paintDeck(live, current, true);
  paintDeck(1 - live, current ? nextUp : null, false);
  updateArms();
  if (playing) startPlatters();
}

/* The tonearm sits parked until a deck is playing, then tracks steadily
   inwards across the record as the track goes on. */
function updateArms() {
  decks.forEach((d, i) => {
    const arm = document.querySelector(`.deck[data-deck="${i}"] .arm`);
    if (!arm) return;
    let angle = 6;                                     // up on the arm rest
    if (i === live && current) {
      const dur = d.el.duration;
      const through = isFinite(dur) && dur > 0 ? clamp(d.el.currentTime / dur, 0, 1) : 0;
      angle = -4 - through * 30;                       // outer groove in to the spindle
    }
    arm.style.setProperty('--arm', angle.toFixed(2) + 'deg');
  });
}

/* One loop turns the platters and drives the meters. The rotation is done
   here rather than with a CSS animation so a finger on the record can take
   it over and hand it back without the vinyl jumping to some other angle. */
let platterFrame = null;
let lastFrameAt = 0;
const stillMotion = matchMedia('(prefers-reduced-motion: reduce)');

function startPlatters() {
  if (platterFrame) return;
  const bars = [0, 1].map(i => document.querySelector(`.meter[data-meter="${i}"] i`));
  // allocated as the analysers appear: the loop can start turning the platters
  // before the audio graph is routed, and did throw when it caught up
  const buffers = [null, null];
  lastFrameAt = performance.now();

  const frame = now => {
    const dt = Math.min(0.1, (now - lastFrameAt) / 1000);
    lastFrameAt = now;
    let busy = false;

    decks.forEach((d, i) => {
      const spinning = i === live && !d.el.paused && !scratch;
      if (spinning) {
        d.angle = (d.angle + (360 / SECONDS_PER_REV) * d.el.playbackRate * dt) % 360;
        busy = true;
      }
      if (scratch && i === live) busy = true;
      if (!stillMotion.matches) {
        const vinyl = document.querySelector(`.deck[data-deck="${i}"] .vinyl`);
        if (vinyl) vinyl.style.transform = `rotate(${d.angle.toFixed(2)}deg)`;
      }

      if (d.analyser && bars[i]) {
        if (!buffers[i] || buffers[i].length !== d.analyser.fftSize) {
          buffers[i] = new Uint8Array(d.analyser.fftSize);
        }
        d.analyser.getByteTimeDomainData(buffers[i]);
        let sum = 0;
        for (let j = 0; j < buffers[i].length; j++) {
          const v = (buffers[i][j] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / buffers[i].length);
        bars[i].style.height = clamp(Math.pow(rms * 2.2, 0.6) * 100, 0, 100).toFixed(1) + '%';
      }
    });

    if (busy) {
      platterFrame = requestAnimationFrame(frame);
    } else {
      platterFrame = null;
      bars.forEach(b => { if (b) b.style.height = '0%'; });
    }
  };
  platterFrame = requestAnimationFrame(frame);
}

/* ───────────────────────── channel faders ─────────────────────────
   One per deck, and they do what they look like: the level rides on top of
   whatever the crossfade envelope and the track's own levelling are doing,
   so none of the three fights the others. */

function setChannel(i, level) {
  const d = decks[i];
  d.channel = clamp(level, 0, 1);
  setLevel(d, d.env);                              // re-apply at the new level
  const track = document.querySelector(`.chan-fader[data-chan="${i}"]`);
  if (track) {
    track.style.setProperty('--level', d.channel.toFixed(3));
    track.setAttribute('aria-valuenow', Math.round(d.channel * 100));
  }
}

function channelFromPointer(track, y) {
  const r = track.getBoundingClientRect();
  return clamp(1 - (y - r.top) / r.height, 0, 1);   // top of the strip is full
}

let draggingChannel = null;

$('#mixer').addEventListener('pointerdown', e => {
  const track = e.target.closest('.chan-fader');
  if (!track) return;
  draggingChannel = Number(track.dataset.chan);
  setChannel(draggingChannel, channelFromPointer(track, e.clientY));
  try { track.setPointerCapture(e.pointerId); } catch {}
  e.preventDefault();
});

$('#mixer').addEventListener('pointermove', e => {
  if (draggingChannel === null) return;
  const track = document.querySelector(`.chan-fader[data-chan="${draggingChannel}"]`);
  if (track) setChannel(draggingChannel, channelFromPointer(track, e.clientY));
  e.preventDefault();
});

const stopChannelDrag = () => { draggingChannel = null; };
$('#mixer').addEventListener('pointerup', stopChannelDrag);
$('#mixer').addEventListener('pointercancel', stopChannelDrag);
$('#mixer').addEventListener('lostpointercapture', stopChannelDrag);

/* ───────────────────────── scratching ─────────────────────────

   Hold the record on the live deck and it stops running on its own: the
   platter follows your finger and the audio is dragged along with it. Moving
   forward speeds the sound up or slows it down with the pitch bending like a
   real record, since pitch preservation is turned off while you have hold of
   it. Dragging backwards can't play in reverse — no browser will — so the
   audio is seeked back to follow instead, which gives the stutter you'd
   expect. Let go and the platter spins back up to speed. */

let scratch = null;

const angleAt = (el, x, y) => {
  const r = el.getBoundingClientRect();
  return Math.atan2(y - (r.top + r.height / 2), x - (r.left + r.width / 2)) * 180 / Math.PI;
};

function startScratch(e) {
  const vinyl = e.target.closest('.vinyl');
  if (!vinyl) return;
  const deckEl = vinyl.closest('.deck');
  if (!deckEl || Number(deckEl.dataset.deck) !== live) return;    // only the live deck
  const d = deck();
  if (!current || !d.id) return;

  const el = d.el;
  scratch = {
    vinyl,
    last: angleAt(vinyl, e.clientX, e.clientY),
    turned: 0,
    from: el.currentTime,
    wasPlaying: !el.paused,
    at: performance.now(),
  };
  deckEl.classList.add('scratching');
  el.preservesPitch = false;
  el.webkitPreservesPitch = false;
  if (el.paused) el.play().catch(() => {});      // so the scratch is audible
  try { vinyl.setPointerCapture(e.pointerId); } catch {}
  e.preventDefault();
  startPlatters();
}

function moveScratch(e) {
  if (!scratch) return;
  const d = deck(), el = d.el;

  let step = angleAt(scratch.vinyl, e.clientX, e.clientY) - scratch.last;
  if (step > 180) step -= 360; else if (step < -180) step += 360;
  scratch.last += step;
  scratch.turned += step;
  d.angle = (d.angle + step) % 360;

  const now = performance.now();
  const dt = Math.max(0.004, (now - scratch.at) / 1000);
  scratch.at = now;

  // how fast the finger is going, as a multiple of playing speed
  const speed = Math.abs(step / dt) / (360 / SECONDS_PER_REV);
  el.playbackRate = clamp(speed, 0.0625, 4);

  const dur = isFinite(el.duration) ? el.duration : null;
  const target = clamp(scratch.from + (scratch.turned / 360) * SECONDS_PER_REV,
    0, dur ? dur - 0.05 : 1e9);
  if (Math.abs(el.currentTime - target) > 0.06) el.currentTime = target;
  e.preventDefault();
}

function endScratch() {
  if (!scratch) return;
  const el = deck().el;
  const wasPlaying = scratch.wasPlaying;
  document.querySelectorAll('.deck.scratching').forEach(n => n.classList.remove('scratching'));
  scratch = null;

  // the platter catching its speed again
  const from = el.playbackRate;
  const started = performance.now();
  const spinUp = setInterval(() => {
    const k = Math.min(1, (performance.now() - started) / 220);
    el.playbackRate = from + (1 - from) * k;
    if (k >= 1) {
      clearInterval(spinUp);
      el.playbackRate = 1;
      el.preservesPitch = true;
      el.webkitPreservesPitch = true;
      if (!wasPlaying) el.pause();
      saveResume();
    }
  }, 30);
  startPlatters();
}

/* Slides the crossfader to whichever deck is on air, over the length of the
   blend so the knob and the sound arrive together. */
function moveFader(seconds) {
  const f = $('#fader');
  if (!f) return;
  f.style.setProperty('--fader-time', (seconds > 0 ? seconds : 0.45) + 's');
  f.dataset.side = live === 0 ? 'a' : 'b';
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
    chip('radio', 'Radio', stations.length
      ? `${stations.length} saved` : 'live stations') +
    chip('podcasts', 'Podcasts', podcasts.length
      ? `${podcasts.length} subscribed` : 'shows and episodes') +
    chip('youtube', 'YouTube', 'opens your app') +
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
  // these are sections to browse, not something to start playing on its own
  if (settings.source === 'radio' || settings.source === 'podcasts' ||
      settings.source === 'youtube') return;
  if (onAir()) stopStation();
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

const decksEl = $('#decks');
decksEl.addEventListener('pointerdown', startScratch);
decksEl.addEventListener('pointermove', moveScratch);
decksEl.addEventListener('pointerup', endScratch);
decksEl.addEventListener('pointercancel', endScratch);
decksEl.addEventListener('lostpointercapture', endScratch);

$('#libSearch').addEventListener('input', e => {
  search = e.target.value.trim().toLowerCase();
  renderLibrary();
});

$('#playBtn').addEventListener('click', togglePlay);
/* On an episode the skip buttons do what they do in a podcast app: a nudge
   back over something you missed, a jump forward over something you didn't
   want. On a record they still move between tracks. */
$('#nextBtn').addEventListener('click', () => {
  if (onAir()) { radioEl.currentTime = Math.min(radioEl.duration || 0, radioEl.currentTime + 30); return; }
  next({ fade: settings.crossfade && playing });
});
$('#prevBtn').addEventListener('click', () => {
  if (onAir()) { radioEl.currentTime = Math.max(0, radioEl.currentTime - 15); return; }
  prev();
});

$('#shuffleBtn').addEventListener('click', () => {
  settings.shuffle = !settings.shuffle;
  saveSettings();
  rebuildQueue();
  render();
});

$('#levelBtn').addEventListener('click', () => {
  settings.level = !settings.level;
  saveSettings();
  if (!fading) setLevel(deck(), 1);
  render();
  toast(settings.level ? 'Tracks levelled to a steady volume' : 'Tracks play at their own volume');
});

$('#fadeBtn').addEventListener('click', () => {
  settings.crossfade = !settings.crossfade;
  saveSettings();
  render();
  toast(settings.crossfade ? 'Tracks will blend into each other' : 'Straight cuts between tracks');
});

$('#seek').addEventListener('input', e => {
  if (onAir()) {                                 // an episode, seeking itself
    if (!isLive() && isFinite(radioEl.duration)) {
      radioEl.currentTime = (Number(e.target.value) / 1000) * radioEl.duration;
    }
    return;
  }
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
/* A phone cannot pick a folder. webkitdirectory is a desktop thing — the
   property exists on Android, which makes feature detection lie, but the
   picker there hands back nothing. So on a phone the button is taken away
   and Choose files is pointed at the way that actually works: open the
   picker, select the lot, one import.

   Scanning storage without being asked isn't on offer anywhere. No browser
   will let a page read a device's files; it only ever sees what's handed to
   it, which is the whole reason a web app can be trusted with a music
   library in the first place. */
const isPhone = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '');

if (isPhone()) {
  $('#pickFolder').hidden = true;
  $('#dropTitle').textContent = 'Add your music';   // nothing gets dragged on a phone
  $('#dropHint').innerHTML =
    'Tap <b>Choose files</b>, then select everything you want — most file ' +
    'pickers have a <b>Select all</b> in their menu, and a whole folder comes ' +
    'in at once. It is all copied into the app, so it plays offline.';
}

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

  try {
    const savedStations = await store.getPref(STATIONS_KEY);
    stations = Array.isArray(savedStations) ? savedStations : [];
  } catch {
    stations = [];
  }

  try {
    const subs = await store.getPref(PODCASTS_KEY);
    podcasts = Array.isArray(subs) ? subs : [];
    const pos = await store.getPref(EPISODES_KEY);
    episodePos = (pos && typeof pos === 'object') ? pos : {};
  } catch {
    podcasts = [];
    episodePos = {};
  }
  // a playlist deleted on another tab shouldn't leave us pointing at nothing
  if (settings.source.startsWith('pl:') && !currentPlaylist()) settings.source = 'tunage';
  rebuildQueue();
  render();
  renderSleep();
  refreshStorage();
  await restoreResume();
  restoreFolder();
  levelPending();
  renderVoice();
  askToPersist();
  runPendingCommand();
})();

/* An installed app keeps the manifest it was installed with, so a copy added
   to a home screen while this app still asked for portrait can stay locked
   that way long after the manifest changed. Releasing the lock explicitly
   frees those installs without waiting for the browser to regenerate them.
   It throws where it isn't supported, which is fine — nothing depends on it. */
try {
  if (screen.orientation && screen.orientation.unlock) screen.orientation.unlock();
} catch { /* not supported here, or nothing was locked */ }

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
