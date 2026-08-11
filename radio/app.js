/* Nonstop — two stations (reggae + country) that keep playing with no signal.
   Music files live in IndexedDB on the device, track details live alongside
   them, and the app shell is cached by the service worker. No build step,
   no bundler, no server. */

/* ───────────────────────── helpers ───────────────────────── */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));

const SETTINGS_KEY = 'nonstop.settings';
const FADE_SECONDS = 6;          // longest crossfade
const FADE_MIN_TRACK = 14;       // shorter than this and a straight cut sounds better
const RECENT_MEMORY = 0.4;       // fraction of a station kept out of the reshuffle

const STATIONS = {
  reggae: { name: 'Reggae', colour: '#3FA96B' },
  country: { name: 'Country', colour: '#E08A3C' },
  both: { name: 'Reggae & Country', colour: '#F2C230' },
};

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

const DB_NAME = 'nonstop';
let dbPromise = null;

function db() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains('tracks')) d.createObjectStore('tracks', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('audio')) d.createObjectStore('audio', { keyPath: 'id' });
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
};

/* ───────────────────────── working out the station ───────────────────────── */

const REGGAE_WORDS = ['reggae', 'dub', 'dancehall', 'roots', 'ska ', 'rocksteady', 'rock steady',
  'riddim', 'rasta', 'lovers rock', 'nyabinghi', 'dub plate', 'kingston', 'jamaica', 'trench town',
  'toasting', 'skank', 'irie', 'one drop', 'ragga'];
const COUNTRY_WORDS = ['country', 'bluegrass', 'honky', 'honkytonk', 'nashville', 'americana',
  'western', 'outlaw', 'twang', 'hillbilly', 'alt-country', 'appalachian', 'banjo', 'steel guitar',
  'redneck', 'rodeo', 'cowboy', 'texas', 'tennessee', 'grand ole opry'];

function guessStation(...bits) {
  const hay = bits.filter(Boolean).join(' ').toLowerCase();
  const hit = words => words.some(w => hay.includes(w));
  const r = hit(REGGAE_WORDS), c = hit(COUNTRY_WORDS);
  if (r && !c) return 'reggae';
  if (c && !r) return 'country';
  return null;                       // ambiguous or unknown — the listener decides
}

/* ───────────────────────── reading the file's own tags ─────────────────────────
   Enough of ID3v2 to pull title / artist / genre out of an MP3. Anything else
   (or an untagged file) falls back to the filename. */

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

async function readId3(file) {
  try {
    const head = new Uint8Array(await file.slice(0, 10).arrayBuffer());
    if (head.length < 10 || head[0] !== 0x49 || head[1] !== 0x44 || head[2] !== 0x33) return {};
    const version = head[3];
    const size = (head[6] << 21) | (head[7] << 14) | (head[8] << 7) | head[9];
    const buf = new Uint8Array(await file.slice(10, 10 + Math.min(size, 1 << 20)).arrayBuffer());

    const out = {};
    const want = { TIT2: 'title', TPE1: 'artist', TCON: 'genre', TALB: 'album' };
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
    // "(43)Reggae" style genres from the old numeric table
    if (out.genre) out.genre = out.genre.replace(/^\((\d+)\)\s*/, '').trim();
    return out;
  } catch {
    return {};
  }
}

function fromFilename(name) {
  const base = name.replace(/\.[a-z0-9]+$/i, '').replace(/_/g, ' ').trim();
  const stripped = base.replace(/^\s*\d{1,3}\s*[-.)]\s*/, '');   // leading track number
  const parts = stripped.split(/\s+-\s+/);
  if (parts.length >= 2) return { artist: parts[0].trim(), title: parts.slice(1).join(' - ').trim() };
  return { title: stripped || name };
}

/* ───────────────────────── app state ───────────────────────── */

const settings = Object.assign(
  { station: 'both', shuffle: true, crossfade: true, filter: 'all' },
  JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')
);
const saveSettings = () => localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));

let lib = [];              // track metadata, newest last
let queue = [];            // ids waiting to play
let history = [];          // ids already played, most recent last
let current = null;        // the track object on air
let recent = [];           // ids kept out of the next reshuffle
let sleep = { mode: null, until: 0 };

const byId = id => lib.find(t => t.id === id);

function pool(station = settings.station) {
  if (station === 'both') return lib.filter(t => t.station === 'reggae' || t.station === 'country');
  return lib.filter(t => t.station === station);
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
   mode each pass plays the whole station once, skipping the handful of tracks
   heard most recently so a small library doesn't feel like a loop. */
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

function dropMissing(track) {
  toast('That file went missing — skipping it');
  lib = lib.filter(t => t.id !== track.id);
  store.delTrack(track.id).catch(() => {});
  rebuildQueue();
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
  if (!pool().length) {
    const unsorted = lib.filter(t => !t.station).length;
    if (unsorted) return 'Give those tracks a station and the music starts';
    return 'Nothing on this station yet';
  }
  return '';
}

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

  if (playing !== !d.paused && !fading) { playing = !d.paused; render(); }
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
    if (d === deck() && current) dropMissing(current);
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
  grad.addColorStop(1, track.station === 'country' ? '#B4632A' : '#2A7A4E');
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
      album: 'Nonstop · ' + (STATIONS[settings.station] || STATIONS.both).name,
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

async function addFiles(fileList) {
  const files = [...fileList].filter(isAudio);
  if (!files.length) { toast('No audio files in that lot'); return; }
  await askToPersist();

  let added = 0, skipped = 0, failed = 0, unsorted = 0;
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    importStatus(`Saving <b>${esc(f.name)}</b> — ${i + 1} of ${files.length}` +
      `<div class="bar"><i style="width:${Math.round((i / files.length) * 100)}%"></i></div>`);
    await new Promise(r => setTimeout(r, 0));         // let the bar paint

    if (lib.some(t => t.file === f.name && t.size === f.size)) { skipped++; continue; }
    try {
      const track = await buildTrack(f);
      await store.putAudio(track.id, f);
      await store.putTrack(track);
      lib.push(track);
      added++;
      if (!track.station) unsorted++;
    } catch (err) {
      failed++;
      if (err && /quota/i.test(err.name + ' ' + err.message)) {
        importStatus(`<b>Out of space on this device.</b> ${added} saved before it filled up — ` +
          `delete a few tracks and try the rest.`);
        break;
      }
    }
  }

  const bits = [`${added} added`];
  if (skipped) bits.push(`${skipped} already here`);
  if (failed) bits.push(`${failed} wouldn't save`);
  if (added) importStatus(`<b>${bits.join(' · ')}</b>` +
    (unsorted ? ` — ${unsorted} ${unsorted === 1 ? 'needs' : 'need'} a station picking below.` : ' — ready to play.'));
  else if (!failed) importStatus(`<b>${bits.join(' · ')}</b>`);

  rebuildQueue();
  render();
  refreshStorage();
  if (added && !current && pool().length) next();     // first import: start the station
}

async function buildTrack(file) {
  const tags = await readId3(file);
  const guessFromName = fromFilename(file.name);
  const path = file.webkitRelativePath || '';
  return {
    id: uid(),
    title: tags.title || guessFromName.title || file.name,
    artist: tags.artist || guessFromName.artist || '',
    station: guessStation(tags.genre, tags.album, tags.artist, tags.title, path, file.name),
    file: file.name,
    size: file.size,
    type: file.type || '',
    added: Date.now(),
  };
}

async function addFromUrl(url, station) {
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
  if (station) track.station = station;
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
  await Promise.all([store.delTrack(id), store.delAudio(id)]).catch(() => {});
  if (current && current.id === id) { stopAll(); rebuildQueue(); next(); }
  else { rebuildQueue(); render(); }
  refreshStorage();
  toast(`Removed “${t.title}”`);
}

function setStation(id, station) {
  const t = byId(id);
  if (!t) return;
  t.station = t.station === station ? null : station;
  store.putTrack(t).catch(() => {});
  rebuildQueue();
  render();
  if (!current && pool().length) next();
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
  $$('.station').forEach(b => b.classList.toggle('on', b.dataset.station === settings.station));
  document.documentElement.style.setProperty('--accent',
    (STATIONS[settings.station] || STATIONS.both).colour);

  $('#playBtn').innerHTML = `<svg class="ic"><use href="#i-${playing ? 'pause' : 'play'}"/></svg>`;
  $('#playBtn').setAttribute('aria-label', playing ? 'Pause' : 'Play');
  $('#shuffleBtn').classList.toggle('on', settings.shuffle);
  $('#fadeBtn').classList.toggle('on', settings.crossfade);

  const art = $('#art');
  art.classList.toggle('spinning', playing);
  if (current) {
    const hue = hueOf(current.id);
    art.innerHTML = `<div class="label" style="background:linear-gradient(140deg,hsl(${hue} 60% 55%),${
      current.station === 'country' ? '#E08A3C' : '#3FA96B'})">${
      esc((current.title || '?').trim()[0].toUpperCase())}</div>`;
    $('#npTitle').textContent = current.title || current.file;
    $('#npArtist').textContent = [current.artist, (STATIONS[current.station] || {}).name]
      .filter(Boolean).join(' · ') || 'Unknown artist';
  } else {
    art.innerHTML = '<svg class="ic art-disc"><use href="#i-disc"/></svg>';
    $('#npTitle').textContent = lib.length ? 'Ready when you are' : 'Nothing playing yet';
    $('#npArtist').textContent = lib.length
      ? (emptyMessage() || 'Press play for nonstop ' + (STATIONS[settings.station] || STATIONS.both).name.toLowerCase())
      : 'Add some music to start the station';
    $('#seek').value = '0';
    $('#tNow').textContent = $('#tEnd').textContent = '0:00';
  }

  renderQueue();
  renderSort();
  renderLibrary();
}

function renderQueue() {
  const ol = $('#queue');
  const items = queue.slice(0, 6).map(byId).filter(Boolean);
  $('#queuePanel').hidden = !items.length;
  ol.innerHTML = items.map((t, i) => `
    <li>
      <span class="n">${i + 1}</span>
      <span class="dot ${t.station || ''}"></span>
      <span class="who"><b>${esc(t.title || t.file)}</b><span>${esc(t.artist || 'Unknown artist')}</span></span>
    </li>`).join('');
}

function trackRow(t, { sorting = false } = {}) {
  return `
    <li data-id="${t.id}">
      <span class="dot ${t.station || ''}"></span>
      <span class="who" data-act="play">
        <b>${esc(t.title || t.file)}</b>
        <span>${esc(t.artist || 'Unknown artist')}${t.size ? ' · ' + mb(t.size) : ''}</span>
      </span>
      <button class="mini reggae ${t.station === 'reggae' ? 'on' : ''}" data-act="reggae">Reggae</button>
      <button class="mini country ${t.station === 'country' ? 'on' : ''}" data-act="country">Country</button>
      ${sorting ? '' : '<button class="mini danger" data-act="del" aria-label="Remove"><svg class="ic"><use href="#i-trash"/></svg></button>'}
    </li>`;
}

function renderSort() {
  const unsorted = lib.filter(t => !t.station);
  $('#sortPanel').hidden = !unsorted.length;
  $('#sortList').innerHTML = unsorted.map(t => trackRow(t, { sorting: true })).join('');
}

function renderLibrary() {
  const filter = settings.filter;
  const list = lib.filter(t => filter === 'all' ? true : t.station === filter)
    .slice().sort((a, b) => (a.artist || '').localeCompare(b.artist || '')
      || (a.title || '').localeCompare(b.title || ''));
  $('#library').innerHTML = list.map(t => trackRow(t)).join('');
  $('#libEmpty').hidden = !!lib.length;
  $('#libCount').textContent = lib.length
    ? `${lib.filter(t => t.station === 'reggae').length} reggae · ${lib.filter(t => t.station === 'country').length} country`
    : '';
  $$('#libFilter .chip').forEach(b => b.classList.toggle('on', b.dataset.filter === filter));
}

/* ───────────────────────── wiring ───────────────────────── */

$('#stations').addEventListener('click', e => {
  const btn = e.target.closest('.station');
  if (!btn) return;
  settings.station = btn.dataset.station;
  saveSettings();
  rebuildQueue();
  render();
  // a station switch means that station's music, right now
  if (!pool().length) { stopAll(); toast(emptyMessage()); render(); return; }
  const stillFits = current && (settings.station === 'both'
    ? current.station : current.station === settings.station);
  if (!stillFits) next({ fade: settings.crossfade && playing });
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

$('#libFilter').addEventListener('click', e => {
  const btn = e.target.closest('.chip');
  if (!btn) return;
  settings.filter = btn.dataset.filter;
  saveSettings();
  renderLibrary();
});

function onTrackListClick(e) {
  const li = e.target.closest('li[data-id]');
  if (!li) return;
  const act = e.target.closest('[data-act]');
  if (!act) return;
  const id = li.dataset.id;
  const what = act.dataset.act;
  if (what === 'del') removeTrack(id);
  else if (what === 'play') {
    const t = byId(id);
    if (!t) return;
    if (!t.station) return toast('Pick a station for this one first');
    queue = queue.filter(x => x !== id);
    playTrack(t, { fade: settings.crossfade && playing });
  } else setStation(id, what);
}
$('#library').addEventListener('click', onTrackListClick);
$('#sortList').addEventListener('click', onTrackListClick);

/* adding music */
$('#pickFiles').addEventListener('click', () => $('#fileInput').click());
$('#pickFolder').addEventListener('click', () => $('#folderInput').click());
$('#fileInput').addEventListener('change', e => { addFiles(e.target.files); e.target.value = ''; });
$('#folderInput').addEventListener('change', e => { addFiles(e.target.files); e.target.value = ''; });

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
  await addFromUrl(url, $('#urlStation').value);
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
  rebuildQueue();
  render();
  renderSleep();
  refreshStorage();
})();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
