/* Take One — a voice studio that finishes the take for you.

   Record (or drop in a file), and the app measures what it's got, decides what
   a good engineer would do about it, does all of it in one pass, and hands
   back something you could release. Every decision it made is on screen and
   every one of them can be overruled.

   No build step, no server, no account: takes live in IndexedDB on the device
   and the heavy arithmetic happens in a worker. Works with the network off. */

import { wavBlob, decodeWav, peaksOf } from './audio/wav.js';
import { TARGETS, TUNE_MODES } from './audio/process.js';
import { detectPitch, hzToMidi, noteLabel, NOTE_NAMES } from './audio/analyse.js';
import { createMonitor } from './audio/monitor.js';

/* ───────────────────────── helpers ───────────────────────── */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
const dbToLin = db => Math.pow(10, db / 20);

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

function when(ts) {
  const d = new Date(ts), now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return sameDay ? 'today ' + time : d.toLocaleDateString([], { day: 'numeric', month: 'short' }) + ' ' + time;
}

let toastTimer = null;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2800);
}

/* ───────────────────────── storage ───────────────────────── */

const DB_NAME = 'takeone';
let dbPromise = null;

function db() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains('takes')) d.createObjectStore('takes', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('audio')) d.createObjectStore('audio', { keyPath: 'id' });
      // v2: backing tracks, kept as the file you added rather than as samples —
      // a four-minute song is eighty megabytes decoded and four on disk
      if (!d.objectStoreNames.contains('backings')) d.createObjectStore('backings', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('backingAudio')) d.createObjectStore('backingAudio', { keyPath: 'id' });
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
  allTakes: () => tx('takes', 'readonly', s => s.getAll()),
  putTake: t => tx('takes', 'readwrite', s => s.put(t)),
  delTake: id => tx('takes', 'readwrite', s => s.delete(id)),
  getAudio: id => tx('audio', 'readonly', s => s.get(id)),
  putAudio: rec => tx('audio', 'readwrite', s => s.put(rec)),
  delAudio: id => tx('audio', 'readwrite', s => s.delete(id)),
  allBackings: () => tx('backings', 'readonly', s => s.getAll()),
  putBacking: b => tx('backings', 'readwrite', s => s.put(b)),
  delBacking: id => tx('backings', 'readwrite', s => s.delete(id)),
  getBackingAudio: id => tx('backingAudio', 'readonly', s => s.get(id)),
  putBackingAudio: rec => tx('backingAudio', 'readwrite', s => s.put(rec)),
  delBackingAudio: id => tx('backingAudio', 'readwrite', s => s.delete(id)),
};

const PREFS_KEY = 'takeone.prefs';
const prefs = Object.assign({
  targetName: 'streaming',
  a4: 440,
  rawProcessing: false,
  autoRun: true,
  deviceId: '',
  backingId: '',
  backingLevel: 0.85,
  tuneMode: 'auto',      // 'auto' until you say otherwise, then it stays said
}, JSON.parse(localStorage.getItem(PREFS_KEY) || '{}'));

const savePrefs = () => localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));

/* ───────────────────────── state ───────────────────────── */

const state = {
  view: 'record',
  takes: [],
  backings: [],
  cur: null,          // the take on screen
  playing: false,
  hearing: 'studio',
  loop: false,
  match: true,
  rendering: false,
  renderToken: 0,
};

/* ───────────────────────── the engine ─────────────────────────
   A module worker where there is one, and the same code inline where there
   isn't — an old browser should be slow, not broken. */

let engine = null;

async function startEngine() {
  const onMessage = msg => handleEngine(msg);
  try {
    const w = new Worker(new URL('./audio/worker.js', import.meta.url), { type: 'module' });
    w.onmessage = e => onMessage(e.data);
    w.onerror = () => toast('The audio engine stopped. Reload the page.');
    engine = { post: (m, t) => w.postMessage(m, t || []) };
  } catch {
    const { createEngine } = await import('./audio/engine.js');
    const handle = createEngine(msg => setTimeout(() => onMessage(msg), 0));
    engine = { post: m => setTimeout(() => handle(m), 0) };
  }
}

function handleEngine(msg) {
  const cur = state.cur;
  if (!cur || msg.id !== cur.meta.id) return;

  if (msg.type === 'ready') {
    cur.report = msg.report;
    cur.rawPeaks = msg.peaks;
    if (!cur.settings) cur.settings = msg.settings;
    cur.autoSettings = msg.settings;
    cur.meta.report = msg.report;
    drawWave();
    showStats();
    buildControls();
    fillBackingPanel();
    paintTuneMode();
    if (cur.wantRender) { cur.wantRender = false; renderTake(); }
    return;
  }

  if (msg.type === 'settings') {
    cur.settings = msg.settings;
    cur.autoSettings = msg.settings;
    cur.manual = new Set();
    buildControls();
    fillBackingPanel();
    paintTuneMode();
    renderTake();
    return;
  }

  if (msg.type === 'progress') {
    if (msg.id !== cur.meta.id) return;
    $('#progress').hidden = false;
    $('#progBar').style.width = Math.round(msg.p * 100) + '%';
    $('#progWhat').textContent = msg.what;
    return;
  }

  if (msg.type === 'done') {
    if (msg.token !== state.renderToken) return;   // a newer render is on its way
    state.rendering = false;
    $('#progress').hidden = true;
    const buf = toBuffer(msg.channels, msg.sampleRate);
    cur.studio = { buffer: buf, channels: msg.channels, sampleRate: msg.sampleRate };
    cur.studioPeaks = msg.peaks;
    cur.contour = msg.contour;
    cur.contourHop = msg.contourHopSeconds;
    cur.notes = msg.notes;
    cur.meta.lufs = msg.lufs;
    cur.meta.truePeakDb = msg.truePeakDb;
    cur.meta.vocalLufs = msg.vocalLufs;
    cur.meta.backingGain = msg.backingGain;
    cur.meta.normaliseGain = msg.normaliseGain;
    cur.meta.notes = msg.notes;
    cur.meta.settings = cur.settings;
    cur.meta.manual = [...(cur.manual || [])];
    cur.meta.hasStudio = true;
    saveStudio(cur);
    showNotes();
    showStats();
    if (!cur.chose) setHearing('studio');
    else if (state.playing && state.hearing === 'studio') restartPlayback();
    drawWave();
    return;
  }

  if (msg.type === 'need-samples') {
    sendToEngine(cur, true);
    return;
  }

  if (msg.type === 'error') {
    state.rendering = false;
    $('#progress').hidden = true;
    toast('That take defeated the engine: ' + msg.message);
  }
}

function sendToEngine(cur, thenRender) {
  cur.wantRender = !!thenRender;
  cur.backingSent = null;
  sendBacking(cur);
  const copy = Float32Array.from(cur.raw.channels[0]);
  engine.post({
    type: 'prepare', id: cur.meta.id, samples: copy, sampleRate: cur.raw.sampleRate,
    a4: prefs.a4, targetName: prefs.targetName, tuneMode: prefs.tuneMode,
  }, [copy.buffer]);
}

function renderTake() {
  const cur = state.cur;
  if (!cur || !cur.settings) return;
  state.rendering = true;
  state.renderToken++;
  $('#progress').hidden = false;
  $('#progBar').style.width = '2%';
  $('#progWhat').textContent = 'thinking';
  engine.post({ type: 'render', id: cur.meta.id, settings: cur.settings, token: state.renderToken });
}

let renderTimer = null;
function renderSoon() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(renderTake, 420);
}

/* ───────────────────────── audio plumbing ───────────────────────── */

let ctx = null, stream = null, micSource = null, recNode = null, analyser = null;
let monitor = null, monitorOn = false, usingFallbackRecorder = false;
let recChunks = [], recSamples = 0, recStart = 0;

function ensureCtx() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function toBuffer(channels, sampleRate) {
  const buf = ctx.createBuffer(channels.length, channels[0].length, sampleRate);
  for (let c = 0; c < channels.length; c++) buf.copyToChannel(channels[c], c);
  return buf;
}

async function ensureMic() {
  if (stream && stream.active) return true;
  ensureCtx();
  const tweak = !prefs.rawProcessing;
  const audio = {
    channelCount: 1,
    echoCancellation: !tweak ? true : false,
    noiseSuppression: !tweak ? true : false,
    autoGainControl: !tweak ? true : false,
  };
  if (prefs.deviceId) audio.deviceId = { exact: prefs.deviceId };

  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio });
  } catch (err) {
    if (prefs.deviceId) {                 // that microphone has gone away
      prefs.deviceId = ''; savePrefs();
      try { stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 } }); }
      catch { stream = null; }
    }
    if (!stream) {
      toast(err && err.name === 'NotAllowedError'
        ? 'The browser is holding the microphone back — allow it for this page.'
        : 'No microphone the browser will let us have.');
      return false;
    }
  }

  micSource = ctx.createMediaStreamSource(stream);
  analyser = ctx.createAnalyser();
  analyser.fftSize = 4096;
  analyser.smoothingTimeConstant = 0;
  micSource.connect(analyser);

  try {
    await ctx.audioWorklet.addModule('recorder-processor.js');
    recNode = new AudioWorkletNode(ctx, 'take-recorder', { numberOfOutputs: 0 });
    recNode.port.onmessage = e => {
      if (e.data === 'stopped') finishRecording();
      else if (e.data && e.data.started !== undefined) recStart = e.data.started;
      else { recChunks.push(e.data); recSamples += e.data.length; }
    };
    micSource.connect(recNode);
  } catch {
    /* No worklet: a script processor still captures every sample, it just does
       it on the main thread and complains about it in the console. */
    usingFallbackRecorder = true;
    recNode = ctx.createScriptProcessor(4096, 1, 1);
    recNode.onaudioprocess = e => {
      if (!state.recording) return;
      const d = e.inputBuffer.getChannelData(0);
      recChunks.push(Float32Array.from(d));
      recSamples += d.length;
    };
    micSource.connect(recNode);
    recNode.connect(ctx.destination);      // script processors need a sink
  }

  listDevices();
  return true;
}

async function listDevices() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
  const all = await navigator.mediaDevices.enumerateDevices().catch(() => []);
  const mics = all.filter(d => d.kind === 'audioinput');
  const sel = $('#deviceSel');
  if (!mics.length || !mics[0].label) return;         // labels only arrive once permission is granted
  sel.innerHTML = '<option value="">Default microphone</option>' +
    mics.map(d => `<option value="${esc(d.deviceId)}">${esc(d.label)}</option>`).join('');
  sel.value = prefs.deviceId || '';
}

/* ───────────────────────── recording ───────────────────────── */

async function startRecording() {
  if (!await ensureMic()) return;
  stopBackingPreview();
  recChunks = []; recSamples = 0; recStart = ctx.currentTime;
  await startRecordingBacking();
  state.recording = true;
  $('#recBtn').classList.add('is-live');
  $('#recBtn').setAttribute('aria-label', 'Stop recording');
  $('#recHint').textContent = 'Recording. Everything stays on the device.';
  if (recNode.port) recNode.port.postMessage('start');
  meterLoop();
}

function stopRecording() {
  if (!state.recording) return;
  state.recording = false;
  stopRecordingBacking();
  $('#recBtn').classList.remove('is-live');
  $('#recBtn').setAttribute('aria-label', 'Start recording');
  if (recNode.port) recNode.port.postMessage('stop');
  else finishRecording();
}

function finishRecording() {
  const sr = ctx.sampleRate;
  const samples = new Float32Array(recSamples);
  let off = 0;
  for (const c of recChunks) { samples.set(c, off); off += c.length; }
  recChunks = []; recSamples = 0;

  if (samples.length < sr * 0.4) {
    toast('Too short to be a take.');
    $('#recHint').textContent = 'Record a take and it comes back finished. Nothing leaves the device.';
    return;
  }

  let backing = null;
  if (recBacking) {
    backing = { id: recBacking.id, offset: (recStart - recBacking.startedAt) - inputOutputLatency() };
    recBacking = null;
  }
  newTake(samples, sr, 'Take ' + (state.takes.length + 1), backing);
}

/* The backing while the take is being sung, and — the part that matters — a
   note of exactly when it started, so the two can be put back together
   afterwards. */
let recBackingNode = null, recBacking = null;

async function startRecordingBacking() {
  recBacking = null;
  const id = $('#backingSel').value;
  const buf = await loadBackingBuffer(id);
  if (!buf) return;

  const g = ctx.createGain();
  g.gain.value = prefs.backingLevel;
  recBackingNode = ctx.createBufferSource();
  recBackingNode.buffer = buf;
  recBackingNode.connect(g).connect(ctx.destination);

  const at = ctx.currentTime + 0.12;      // a moment to get the graph going
  recBackingNode.start(at);
  recBacking = { id, startedAt: at };
}

function stopRecordingBacking() {
  if (recBackingNode) { try { recBackingNode.stop(); } catch { /* already stopped */ } recBackingNode = null; }
}

/* Sound scheduled now is heard a moment from now, and sound sung now is
   recorded a moment after that. Both moments have to come off the offset or
   the voice lands late against the music by exactly the round trip. */
function inputOutputLatency() {
  const out = ctx.outputLatency || ctx.baseLatency || 0;
  let inp = 0;
  try {
    const t = stream && stream.getAudioTracks()[0];
    const st = t && t.getSettings && t.getSettings();
    if (st && typeof st.latency === 'number') inp = st.latency;
  } catch { /* not every browser reports it */ }
  return out + inp;
}

/* ───────────────────────── meters and the live tuner ───────────────────────── */

const ring = $('#ring');
const ringCtx = ring.getContext('2d');
let meterTimer = 0, peakHold = 0, peakAt = 0, tuneBuf = null;

function meterLoop() {
  cancelAnimationFrame(meterTimer);
  const tick = () => {
    if (!analyser || (!state.recording && !monitorOn)) { drawRing(0, 0); return; }
    const n = 2048;
    if (!tuneBuf || tuneBuf.length !== n) tuneBuf = new Float32Array(n);
    analyser.getFloatTimeDomainData(tuneBuf);

    let peak = 0, sum = 0;
    for (let i = 0; i < n; i++) { const a = Math.abs(tuneBuf[i]); if (a > peak) peak = a; sum += tuneBuf[i] * tuneBuf[i]; }
    const rmsv = Math.sqrt(sum / n);
    const now = performance.now();
    if (peak >= peakHold || now - peakAt > 1200) { peakHold = peak; peakAt = now; }

    drawRing(rmsv, peakHold);
    if (state.recording) $('#clock').textContent = mmss(ctx.currentTime - recStart);
    updateTuner(tuneBuf, peak);
    meterTimer = requestAnimationFrame(tick);
  };
  meterTimer = requestAnimationFrame(tick);
}

function drawRing(level, peak) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const size = ring.clientWidth || 280;
  if (ring.width !== size * dpr) { ring.width = ring.height = size * dpr; }
  const g = ringCtx, w = ring.width, c = w / 2, r = w / 2 - 8 * dpr;
  g.clearRect(0, 0, w, w);

  const start = Math.PI * 0.75, sweep = Math.PI * 1.5;
  g.lineWidth = 9 * dpr;
  g.lineCap = 'round';
  g.strokeStyle = 'rgba(255,255,255,.07)';
  g.beginPath(); g.arc(c, c, r, start, start + sweep); g.stroke();

  const db = 20 * Math.log10(Math.max(1e-6, level));
  const frac = clamp((db + 54) / 54, 0, 1);
  const hot = peak > 0.98;
  const grad = g.createLinearGradient(0, 0, w, w);
  grad.addColorStop(0, hot ? '#FF4D4D' : '#35D6A4');
  grad.addColorStop(1, hot ? '#FF7A4D' : '#5AA9FF');
  g.strokeStyle = grad;
  g.beginPath(); g.arc(c, c, r, start, start + sweep * frac); g.stroke();

  const pdb = 20 * Math.log10(Math.max(1e-6, peak));
  const pf = clamp((pdb + 54) / 54, 0, 1);
  g.strokeStyle = hot ? '#FF4D4D' : 'rgba(255,255,255,.6)';
  g.lineWidth = 3 * dpr;
  g.beginPath(); g.arc(c, c, r, start + sweep * pf - 0.01, start + sweep * pf + 0.01); g.stroke();

  const clock = $('#clock');
  if (state.recording || monitorOn) {
    clock.parentElement.dataset.level = hot ? 'too loud — back off the microphone' : Math.round(pdb) + ' dB peak';
    clock.parentElement.classList.toggle('is-hot', hot);
  } else {
    clock.parentElement.dataset.level = '';
    clock.parentElement.classList.remove('is-hot');
  }
}

let tunerSkip = 0;
function updateTuner(buf, peak) {
  if (tunerSkip++ % 3) return;                 // pitch four or five times a second is plenty
  const note = $('#tunerNote'), cents = $('#tunerCents'), needle = $('#tunerNeedle');
  if (peak < 0.008) {
    note.textContent = '—';
    cents.textContent = state.recording ? 'listening' : 'quiet';
    needle.style.left = '50%';
    needle.classList.remove('is-good');
    return;
  }
  const p = detectPitch(buf, ctx.sampleRate, { minHz: 65, maxHz: 1000 });
  if (!p.hz || p.conf < 0.6) {
    note.textContent = '·';
    cents.textContent = 'no clear note';
    needle.classList.remove('is-good');
    return;
  }
  const midi = hzToMidi(p.hz, prefs.a4);
  const off = (midi - Math.round(midi)) * 100;
  note.textContent = noteLabel(midi);
  cents.textContent = (off >= 0 ? '+' : '') + off.toFixed(0) + ' cents · ' + p.hz.toFixed(1) + ' Hz';
  needle.style.left = clamp(50 + off / 50 * 50, 2, 98) + '%';
  needle.classList.toggle('is-good', Math.abs(off) < 10);
}

async function toggleMonitor() {
  if (monitorOn) {
    monitor.dispose(); monitor = null; monitorOn = false;
    $('#monBtn').classList.remove('is-on');
    $('#recHint').textContent = 'Record a take and it comes back finished. Nothing leaves the device.';
    if (!state.recording) cancelAnimationFrame(meterTimer);
    return;
  }
  if (!await ensureMic()) return;
  const base = state.cur && state.cur.settings ? state.cur.settings : defaultMonitorSettings();
  monitor = createMonitor(ctx, base);
  micSource.connect(monitor.input);
  monitor.output.connect(ctx.destination);
  monitorOn = true;
  $('#monBtn').classList.add('is-on');
  $('#recHint').innerHTML = '<b>Headphones only.</b> Through speakers the microphone hears itself and the room wins.';
  $('#recHint').className = 'hint warn';
  meterLoop();
}

function defaultMonitorSettings() {
  return {
    eq: { hp: 90, mud: -2, box: -1, presence: 3, air: 2.5 },
    presence: 55, warmth: 15, deEss: 45, compression: 45,
    saturation: 15, space: 10, spaceSize: 30,
  };
}

/* ───────────────────────── backing tracks ─────────────────────────

   A backing is kept as the file you added, not as samples: four minutes of
   music is eighty megabytes decoded and four on disk. It's decoded when it's
   needed and the decoded copy is kept for as long as the app is open.

   Everything downstream works in take time — sample zero of the take — so the
   one number that matters is where in the backing the take began. Recording
   along to something works that out on the spot, including the latency of the
   headphones and the microphone; a backing added to an old take starts at
   zero and gets lined up by hand. */

const backingBuffers = new Map();

async function loadBackings() {
  state.backings = (await store.allBackings()).sort((a, b) => b.addedAt - a.addedAt);
  fillBackingSelects();
}

function fillBackingSelects() {
  const options = '<option value="">None — just my voice</option>' +
    state.backings.map(b => `<option value="${esc(b.id)}">${esc(b.name)} · ${mmss(b.duration)}</option>`).join('');
  const rec = $('#backingSel');
  rec.innerHTML = options;
  rec.value = state.backings.some(b => b.id === prefs.backingId) ? prefs.backingId : '';
  prefs.backingId = rec.value;
  $('#backingPlayBtn').disabled = !rec.value;
  updateRecHint();

  const take = $('#takeBackingSel');
  const cur = state.cur;
  take.innerHTML = options;
  take.value = cur && cur.meta.backingId && state.backings.some(b => b.id === cur.meta.backingId)
    ? cur.meta.backingId : '';
}

/* Singing to a backing through speakers puts the backing in the take, where
   it can never be got out again — so the moment one is chosen, say so. */
function updateRecHint() {
  if (state.recording) return;
  const hint = $('#recHint');
  if ($('#backingSel').value) {
    hint.textContent = 'Wear headphones: through speakers the backing ends up in the take with you.';
    hint.className = 'hint warn';
  } else if (!monitorOn) {
    hint.textContent = 'Record a take and it comes back finished. Nothing leaves the device.';
    hint.className = 'hint';
  }
}

async function addBackingFile(file) {
  ensureCtx();
  toast('Reading ' + file.name + '…');
  const buf = await file.arrayBuffer();
  const decoded = await ctx.decodeAudioData(buf.slice(0)).catch(() => null);
  if (!decoded) { toast("That file isn't audio this browser can read."); return null; }

  const meta = {
    id: uid(),
    name: file.name.replace(/\.[^.]+$/, ''),
    addedAt: Date.now(),
    duration: decoded.duration,
    sampleRate: decoded.sampleRate,
    channels: decoded.numberOfChannels,
    bytes: file.size,
    type: file.type || 'audio/*',
  };
  await store.putBackingAudio({ id: meta.id, blob: file });
  await store.putBacking(meta);
  backingBuffers.set(meta.id, decoded);
  state.backings.unshift(meta);
  prefs.backingId = meta.id;
  savePrefs();
  fillBackingSelects();
  updateStorageNote();
  toast('Added ' + meta.name + '.');
  return meta;
}

async function loadBackingBuffer(id) {
  if (!id) return null;
  if (backingBuffers.has(id)) return backingBuffers.get(id);
  const rec = await store.getBackingAudio(id);
  if (!rec) return null;
  ensureCtx();
  const buf = await ctx.decodeAudioData(await rec.blob.arrayBuffer()).catch(() => null);
  if (buf) backingBuffers.set(id, buf);
  return buf;
}

async function deleteBacking(id) {
  await store.delBacking(id);
  await store.delBackingAudio(id);
  backingBuffers.delete(id);
  state.backings = state.backings.filter(b => b.id !== id);
  if (prefs.backingId === id) { prefs.backingId = ''; savePrefs(); }
  for (const t of state.takes) {
    if (t.backingId === id) { t.backingId = null; store.putTake(t); }
  }
  if (state.cur && state.cur.meta.backingId === id) {
    state.cur.meta.backingId = null;
    state.cur.backingBuffer = null;
    fillBackingPanel();
  }
  fillBackingSelects();
  drawBackingList();
  updateStorageNote();
}

/* Where in the backing the take starts, hand nudge included. */
function backingOffsetOf(cur) {
  return (cur.meta.backingOffset || 0) + (cur.meta.backingNudge || 0) / 1000;
}

/* The backing, cut to the take's own timeline: same length, same sample rate,
   sample zero against sample zero, silence wherever the backing doesn't
   reach. Everything downstream can then just add the two together. */
function alignedBacking(buffer, offsetSeconds, length, sr) {
  const chans = [];
  const step = buffer.sampleRate / sr;
  const start = offsetSeconds * buffer.sampleRate;
  for (let c = 0; c < Math.min(2, buffer.numberOfChannels); c++) {
    const src = buffer.getChannelData(c);
    const out = new Float32Array(length);
    for (let i = 0; i < length; i++) {
      const pos = start + i * step;
      const j = Math.floor(pos);
      if (j < 0 || j + 1 >= src.length) continue;
      const f = pos - j;
      out[i] = src[j] * (1 - f) + src[j + 1] * f;
    }
    chans.push(out);
  }
  if (chans.length === 1) chans.push(Float32Array.from(chans[0]));
  return chans;
}

function sendBacking(cur) {
  if (!cur) return;
  const buf = cur.backingBuffer;
  const key = buf ? cur.meta.backingId + '@' + backingOffsetOf(cur).toFixed(4) + '/' + cur.meta.duration : 'none';
  if (cur.backingSent === key) return;
  cur.backingSent = key;

  if (!buf) { engine.post({ type: 'backing', id: cur.meta.id, channels: null }); return; }
  const chans = alignedBacking(buf, backingOffsetOf(cur), cur.raw.channels[0].length, cur.raw.sampleRate);
  engine.post({ type: 'backing', id: cur.meta.id, channels: chans }, chans.map(c => c.buffer));
}

async function attachBacking(cur, id) {
  cur.meta.backingId = id || null;
  cur.backingBuffer = id ? await loadBackingBuffer(id) : null;
  if (!cur.backingBuffer) cur.meta.backingId = null;
  cur.backingSent = null;
  await store.putTake(cur.meta);
  fillBackingPanel();
  sendBacking(cur);
  if (cur.settings) renderSoon();
}

function fillBackingPanel() {
  const cur = state.cur;
  const on = !!(cur && cur.meta.backingId && cur.backingBuffer);
  $('#backingControls').hidden = !on;
  $('#backingOn').disabled = !on;
  if (!cur) return;
  $('#takeBackingSel').value = cur.meta.backingId || '';
  const st = cur.settings;
  if (!st) return;
  $('#backingOn').checked = st.backingOn !== false;
  $('#backingDb').value = st.backingDb || 0;
  $('#backingDbOut').textContent = st.backingDb
    ? (st.backingDb > 0 ? '+' : '') + Number(st.backingDb).toFixed(1) + ' dB'
    : 'automatic';
  $('#duck').value = st.duck == null ? 30 : st.duck;
  $('#duckOut').textContent = (st.duck == null ? 30 : st.duck) + '%';
  const nudge = cur.meta.backingNudge || 0;
  $('#nudge').value = nudge;
  $('#nudgeOut').textContent = (nudge > 0 ? '+' : '') + nudge + ' ms';
}

/* Hearing a backing on its own, on the record screen, before committing to
   singing over it. */
let previewNode = null;
async function toggleBackingPreview() {
  if (previewNode) { stopBackingPreview(); return; }
  const buf = await loadBackingBuffer($('#backingSel').value);
  if (!buf) return;
  ensureCtx();
  const g = ctx.createGain();
  g.gain.value = prefs.backingLevel;
  previewNode = ctx.createBufferSource();
  previewNode.buffer = buf;
  previewNode.connect(g).connect(ctx.destination);
  previewNode.onended = () => stopBackingPreview();
  previewNode.start();
  $('#backingPlayBtn').innerHTML = '<svg class="ic"><use href="#i-pause"/></svg>';
  $('#backingPlayBtn').classList.add('is-on');
}

function stopBackingPreview() {
  if (previewNode) { try { previewNode.onended = null; previewNode.stop(); } catch { /* done already */ } previewNode = null; }
  $('#backingPlayBtn').innerHTML = '<svg class="ic"><use href="#i-play"/></svg>';
  $('#backingPlayBtn').classList.remove('is-on');
}

function drawBackingList() {
  const box = $('#backingList');
  if (!box) return;
  box.innerHTML = state.backings.length
    ? state.backings.map(b => `
      <div class="backing-row">
        <span><b>${esc(b.name)}</b><span>${mmss(b.duration)} · ${mb(b.bytes)}</span></span>
        <button class="icon-btn" data-del-backing="${esc(b.id)}" aria-label="Delete ${esc(b.name)}">
          <svg class="ic"><use href="#i-trash"/></svg></button>
      </div>`).join('')
    : '<p class="note">No backing tracks yet.</p>';
}

/* ───────────────────────── takes ───────────────────────── */

async function loadTakes() {
  state.takes = (await store.allTakes()).sort((a, b) => b.createdAt - a.createdAt);
  drawTakeList();
}

async function newTake(samples, sampleRate, name, backing = null) {
  const meta = {
    id: uid(), name, createdAt: Date.now(),
    duration: samples.length / sampleRate, sampleRate,
    hasStudio: false, settings: null, manual: [],
    backingId: backing ? backing.id : null,
    backingOffset: backing ? backing.offset : 0,
    backingNudge: 0,
  };
  const blob = wavBlob([samples], sampleRate, 24);
  meta.rawBytes = blob.size;
  await store.putAudio({ id: meta.id, raw: blob, studio: null });
  await store.putTake(meta);
  state.takes.unshift(meta);
  drawTakeList();

  state.cur = {
    meta, raw: { channels: [samples], sampleRate, buffer: toBuffer([samples], sampleRate) },
    studio: null, settings: null, manual: new Set(), notes: null,
    backingBuffer: meta.backingId ? await loadBackingBuffer(meta.backingId) : null,
  };
  openTakeView();
  sendToEngine(state.cur, prefs.autoRun);
  $('#recHint').textContent = 'Record a take and it comes back finished. Nothing leaves the device.';
  $('#recHint').className = 'hint';
}

async function openTake(id) {
  const meta = state.takes.find(t => t.id === id);
  if (!meta) return;
  ensureCtx();
  const rec = await store.getAudio(id);
  if (!rec) { toast('The audio for that take has gone.'); return; }

  const raw = decodeWav(await rec.raw.arrayBuffer());
  if (!raw) { toast("That take won't decode."); return; }

  const cur = {
    meta,
    raw: { channels: raw.channels, sampleRate: raw.sampleRate, buffer: toBuffer(raw.channels, raw.sampleRate) },
    studio: null,
    settings: meta.settings || null,
    manual: new Set(meta.manual || []),
    notes: meta.notes || null,
    report: meta.report || null,
    rawPeaks: peaksOf(raw.channels[0], 1200),
    backingBuffer: meta.backingId ? await loadBackingBuffer(meta.backingId) : null,
  };
  if (meta.backingId && !cur.backingBuffer) cur.meta.backingId = null;

  if (rec.studio) {
    const st = decodeWav(await rec.studio.arrayBuffer());
    if (st) {
      cur.studio = { channels: st.channels, sampleRate: st.sampleRate, buffer: toBuffer(st.channels, st.sampleRate) };
      cur.studioPeaks = peaksOf(st.channels[0], 1200);
    }
  }

  state.cur = cur;
  state.hearing = cur.studio ? 'studio' : 'raw';
  openTakeView();
  sendToEngine(cur, !cur.studio);
}

async function saveStudio(cur) {
  const blob = wavBlob(cur.studio.channels, cur.studio.sampleRate, 16);
  cur.meta.studioBytes = blob.size;
  const rec = await store.getAudio(cur.meta.id);
  await store.putAudio({ id: cur.meta.id, raw: rec ? rec.raw : null, studio: blob });
  await store.putTake(cur.meta);
  const i = state.takes.findIndex(t => t.id === cur.meta.id);
  if (i >= 0) state.takes[i] = cur.meta;
  drawTakeList();
  updateStorageNote();
}

async function deleteTake(id) {
  await store.delTake(id);
  await store.delAudio(id);
  state.takes = state.takes.filter(t => t.id !== id);
  if (state.cur && state.cur.meta.id === id) { stopPlayback(); state.cur = null; }
  drawTakeList();
  show('takes');
  toast('Take deleted.');
}

function drawTakeList() {
  const list = $('#takeList');
  $('#takeCount').textContent = state.takes.length ? state.takes.length : '';
  $('#takesEmpty').hidden = state.takes.length > 0;
  list.innerHTML = state.takes.map(t => `
    <button class="take-item" data-id="${esc(t.id)}">
      <canvas class="take-spark" width="128" height="68" data-spark="${esc(t.id)}"></canvas>
      <span class="take-meta">
        <b>${esc(t.name)}</b>
        <span>${mmss(t.duration)} · ${when(t.createdAt)}${t.lufs ? ' · ' + t.lufs.toFixed(1) + ' LUFS' : ''}</span>
      </span>
      <span class="badge ${t.hasStudio ? '' : 'raw'}">${t.hasStudio ? 'finished' : 'raw'}</span>
    </button>`).join('');

  for (const el of $$('[data-spark]', list)) {
    const t = state.takes.find(x => x.id === el.dataset.spark);
    sparkline(el, t);
  }
}

function sparkline(canvas, meta) {
  const g = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  g.clearRect(0, 0, w, h);
  g.strokeStyle = meta.hasStudio ? 'rgba(53,214,164,.8)' : 'rgba(147,162,181,.6)';
  g.lineWidth = 2;
  g.beginPath();
  const bars = 24;
  for (let i = 0; i < bars; i++) {
    /* No stored waveform for the list — a steady shape keyed off the take's
       own id is honest about that and still tells one card from another. */
    let seed = 0;
    for (const ch of meta.id + i) seed = (seed * 31 + ch.charCodeAt(0)) % 997;
    const a = 0.25 + (seed % 100) / 140;
    const x = 3 + i * ((w - 6) / (bars - 1));
    g.moveTo(x, h / 2 - a * h / 2.4);
    g.lineTo(x, h / 2 + a * h / 2.4);
  }
  g.stroke();
}

/* ───────────────────────── the take on screen ───────────────────────── */

function openTakeView() {
  const cur = state.cur;
  $('#takeName').value = cur.meta.name;
  $('#takeSub').textContent = mmss(cur.meta.duration) + ' · ' + when(cur.meta.createdAt) +
    ' · ' + Math.round(cur.raw.sampleRate / 100) / 10 + ' kHz';
  $('#totalTime').textContent = mmss(cur.meta.duration);
  $('#playTime').textContent = '0:00';
  $('#shareBtn').hidden = !(navigator.canShare && navigator.share);
  setHearing(cur.studio ? 'studio' : 'raw');
  showNotes();
  showStats();
  buildControls();
  fillBackingPanel();
  paintTuneMode();
  drawWave();
  show('take');
}

function showNotes() {
  const cur = state.cur;
  const box = $('#whatItDid');
  if (!cur || !cur.notes) { box.innerHTML = ''; return; }
  box.innerHTML = cur.notes.map(n => `<div class="card"><b>${esc(n.label)}</b><span>${esc(n.detail)}</span></div>`).join('');
}

function showStats() {
  const cur = state.cur;
  const r = cur && cur.report;
  const box = $('#stats');
  if (!r) { box.innerHTML = ''; return; }
  const bits = [
    ['Voice', r.material === 'melodic' ? 'melodic' : r.material],
    ['Key', r.key && r.key.mode !== 'chromatic' ? r.key.name : '—'],
    ['Off by', r.pitch.medianHz ? Math.round(r.pitch.offCents) + '¢' : '—'],
    ['Room', Math.round(r.snrDb) + ' dB down'],
    ['Was', r.lufs.toFixed(1) + ' LUFS'],
    ['Now', cur.meta.lufs != null ? cur.meta.lufs.toFixed(1) + ' LUFS' : '—'],
  ];
  box.innerHTML = bits.map(([k, v]) => `<div class="stat"><b>${esc(v)}</b><span>${esc(k)}</span></div>`).join('');
}

/* Tuning is the one decision worth putting in front of someone, and it comes
   already made: locked, unless the take is plainly somebody talking. Pick a
   different answer once and every take after this one is treated the same,
   which is the difference between a setting and a chore. */
function paintTuneMode() {
  const cur = state.cur;
  const st = cur && cur.settings;
  const mode = st ? st.tuneMode : 'locked';
  for (const b of $$('#tuneMode button')) b.classList.toggle('is-on', b.dataset.mode === mode);
  const blurb = $('#tuneBlurb');
  if (!st) { blurb.textContent = TUNE_MODES.locked.blurb; return; }
  if (mode === 'custom') { blurb.textContent = 'Your own numbers, from the sliders below.'; return; }
  const spoken = cur.report && cur.report.material === 'spoken';
  blurb.textContent = (TUNE_MODES[mode] || TUNE_MODES.locked).blurb +
    (mode === 'off' && spoken ? ' This one sounds like talking, so it was left alone.' : '');
}

function setTuneMode(mode) {
  const cur = state.cur;
  if (!cur || !cur.settings || !TUNE_MODES[mode]) return;
  const t = TUNE_MODES[mode];
  Object.assign(cur.settings, {
    tuneMode: mode,
    tune: t.strength,
    tuneSpeed: t.speedMs,
    tuneDeadband: t.deadband,
    tuneMaxCents: t.maxCents,
    tuneMinConf: t.minConf,
  });
  cur.manual.add('tune');
  prefs.tuneMode = mode;                 // and every take from here on
  savePrefs();
  paintTuneMode();
  buildControls();
  renderSoon();
}

/* ───────────────────────── waveform ───────────────────────── */

const wave = $('#wave');
const waveCtx = wave.getContext('2d');

function drawWave() {
  const cur = state.cur;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const cssW = wave.clientWidth || 600, cssH = 180;
  if (wave.width !== Math.round(cssW * dpr)) {
    wave.width = Math.round(cssW * dpr);
    wave.height = Math.round(cssH * dpr);
  }
  const g = waveCtx, w = wave.width, h = wave.height;
  g.clearRect(0, 0, w, h);
  if (!cur) return;

  const lane = h * 0.42;                  // pitch above, waveform below
  drawPitchLane(g, w, lane, cur);

  const mid = lane + (h - lane) / 2, half = (h - lane) / 2 - 4 * dpr;
  const shown = state.hearing === 'studio' && cur.studioPeaks ? cur.studioPeaks : cur.rawPeaks;
  const under = state.hearing === 'studio' ? cur.rawPeaks : cur.studioPeaks;

  const bars = shown ? shown.length / 2 : 0;
  if (under && under.length) {
    g.fillStyle = 'rgba(147,162,181,.22)';
    paintPeaks(g, under, w, mid, half);
  }
  if (bars) {
    g.fillStyle = state.hearing === 'studio' ? 'rgba(53,214,164,.9)' : 'rgba(238,243,248,.75)';
    paintPeaks(g, shown, w, mid, half);
  }

  const dur = cur.meta.duration || 1;
  const t = playPosition();
  const x = (t / dur) * w;
  g.strokeStyle = '#FF4D4D';
  g.lineWidth = 2 * dpr;
  g.beginPath(); g.moveTo(x, lane); g.lineTo(x, h); g.stroke();
}

function paintPeaks(g, peaks, w, mid, half) {
  const n = peaks.length / 2;
  for (let i = 0; i < n; i++) {
    const x = i / n * w;
    const lo = peaks[i * 2], hi = peaks[i * 2 + 1];
    const y0 = mid - hi * half, y1 = mid - lo * half;
    g.fillRect(x, y0, Math.max(1, w / n - 0.5), Math.max(1, y1 - y0));
  }
}

function drawPitchLane(g, w, h, cur) {
  const raw = cur.report && cur.report.contour;
  const rawHop = cur.report && cur.report.contourHopSeconds;
  const fixed = cur.contour, fixedHop = cur.contourHop;
  if (!raw || !raw.length) return;

  const all = [];
  for (const arr of [raw, fixed]) {
    if (!arr) continue;
    for (const hz of arr) if (hz) all.push(hzToMidi(hz, prefs.a4));
  }
  if (all.length < 4) return;
  all.sort((a, b) => a - b);
  /* Percentiles, not the extremes: a single octave-slipped frame would
     otherwise flatten the whole line against the top of the lane. */
  let lo = Math.floor(all[Math.floor(all.length * 0.02)]) - 1;
  let hi = Math.ceil(all[Math.floor(all.length * 0.98)]) + 1;
  const span = Math.max(5, hi - lo);
  const y = m => h - (clamp((m - lo) / span, 0, 1)) * (h - 6) - 3;

  g.strokeStyle = 'rgba(255,255,255,.05)';
  g.lineWidth = 1;
  for (let m = Math.ceil(lo); m <= hi; m++) {
    const yy = Math.round(y(m)) + 0.5;
    g.beginPath(); g.moveTo(0, yy); g.lineTo(w, yy); g.stroke();
  }

  const dur = cur.meta.duration || 1;
  const line = (arr, hop, colour, width) => {
    if (!arr || !hop) return;
    g.strokeStyle = colour;
    g.lineWidth = width;
    g.beginPath();
    let pen = false;
    for (let i = 0; i < arr.length; i++) {
      const hz = arr[i];
      if (!hz) { pen = false; continue; }
      const x = (i * hop) / dur * w;
      const yy = y(hzToMidi(hz, prefs.a4));
      if (pen) g.lineTo(x, yy); else { g.moveTo(x, yy); pen = true; }
    }
    g.stroke();
  };

  const dpr = Math.min(2, window.devicePixelRatio || 1);
  line(raw, rawHop, 'rgba(147,162,181,.55)', 1.5 * dpr);
  if (state.hearing === 'studio') line(fixed, fixedHop, 'rgba(53,214,164,.95)', 2 * dpr);
}

/* ───────────────────────── playback ───────────────────────── */

let srcNode = null, gainNode = null, startedAt = 0, startOffset = 0, frameTimer = 0;
let backingNode = null, backingGain = null;

function currentAudio() {
  const cur = state.cur;
  if (!cur) return null;
  return state.hearing === 'studio' && cur.studio ? cur.studio : cur.raw;
}

/* Comparing a finished take with a raw one is only a fair fight if they're
   the same loudness — otherwise louder wins every time, which is the oldest
   trick in audio and tells you nothing.

   With music in the mix the comparison is between two whole mixes, so the raw
   voice is brought up to where the finished voice sits *inside* that mix (not
   to the mix's own loudness, which the music is half of) and the backing is
   played underneath it at the level the render gave it. */
function matchGains() {
  const cur = state.cur;
  const none = { raw: 1, studio: 1, backing: cur && cur.meta.backingGain ? cur.meta.backingGain : 0 };
  if (!state.match || !cur || !cur.studio || !cur.report || cur.meta.lufs == null) return none;

  const vocal = cur.meta.vocalLufs != null ? cur.meta.vocalLufs : cur.meta.lufs;
  const norm = cur.meta.normaliseGain || 1;
  let raw = norm * dbToLin(vocal - cur.report.lufs), studio = 1;
  let backing = none.backing;

  let peak = 0;
  const ch = cur.raw.channels[0];
  for (let i = 0; i < ch.length; i += 7) { const a = Math.abs(ch[i]); if (a > peak) peak = a; }
  if (raw * peak > 0.99) {
    const s = 0.99 / (raw * peak);
    raw *= s; studio *= s; backing *= s;
  }
  return { raw, studio, backing };
}

/* The finished take already has the music inside it; the raw one needs it
   playing alongside, from the point in the backing that lines up. */
function startBackingPlayback(from, gain) {
  stopBackingPlayback();
  const cur = state.cur;
  if (!cur || !cur.backingBuffer || !gain) return;
  if (!cur.settings || cur.settings.backingOn === false) return;

  const at = backingOffsetOf(cur) + from;
  backingGain = ctx.createGain();
  backingGain.gain.value = gain;
  backingNode = ctx.createBufferSource();
  backingNode.buffer = cur.backingBuffer;
  if (state.loop) {
    backingNode.loop = true;
    backingNode.loopStart = clamp(backingOffsetOf(cur), 0, cur.backingBuffer.duration);
    backingNode.loopEnd = clamp(backingOffsetOf(cur) + cur.meta.duration, 0.01, cur.backingBuffer.duration);
  }
  backingNode.connect(backingGain).connect(ctx.destination);
  if (at >= 0) backingNode.start(0, Math.min(at, cur.backingBuffer.duration - 0.01));
  else backingNode.start(ctx.currentTime - at);        // the backing began after the take did
}

function stopBackingPlayback() {
  if (backingNode) { try { backingNode.stop(); } catch { /* already stopped */ } backingNode = null; }
}

function playPosition() {
  const cur = state.cur;
  if (!cur) return 0;
  if (!state.playing) return startOffset;
  const dur = cur.meta.duration || 1;
  const t = startOffset + (ctx.currentTime - startedAt);
  return state.loop ? t % dur : Math.min(t, dur);
}

function startPlayback(from) {
  const cur = state.cur;
  const audio = currentAudio();
  if (!cur || !audio) return;
  ensureCtx();
  stopSource();
  const g = matchGains();
  gainNode = ctx.createGain();
  gainNode.gain.value = state.hearing === 'studio' ? g.studio : g.raw;
  if (state.hearing === 'raw') startBackingPlayback(clamp(from || 0, 0, cur.meta.duration), g.backing);
  srcNode = ctx.createBufferSource();
  srcNode.buffer = audio.buffer;
  srcNode.loop = state.loop;
  srcNode.connect(gainNode).connect(ctx.destination);
  srcNode.onended = () => { if (state.playing && !state.loop) { state.playing = false; startOffset = 0; paintTransport(); } };
  startOffset = clamp(from || 0, 0, cur.meta.duration - 0.02);
  startedAt = ctx.currentTime;
  srcNode.start(0, startOffset);
  state.playing = true;
  paintTransport();
  frameLoop();
}

function stopSource() {
  if (srcNode) { try { srcNode.onended = null; srcNode.stop(); } catch { /* already stopped */ } srcNode = null; }
  stopBackingPlayback();
}

function stopPlayback() {
  startOffset = playPosition();
  stopSource();
  state.playing = false;
  cancelAnimationFrame(frameTimer);
  paintTransport();
  drawWave();
}

function restartPlayback() {
  const at = playPosition();
  startPlayback(at);
}

function frameLoop() {
  cancelAnimationFrame(frameTimer);
  const tick = () => {
    if (!state.playing) return;
    $('#playTime').textContent = mmss(playPosition());
    drawWave();
    frameTimer = requestAnimationFrame(tick);
  };
  frameTimer = requestAnimationFrame(tick);
}

function paintTransport() {
  const use = state.playing ? '#i-pause' : '#i-play';
  $('#playBtn').innerHTML = `<svg class="ic"><use href="${use}"/></svg>`;
  $('#playBtn').setAttribute('aria-label', state.playing ? 'Pause' : 'Play');
  $('#loopBtn').classList.toggle('is-on', state.loop);
}

function setHearing(which) {
  const cur = state.cur;
  if (which === 'studio' && (!cur || !cur.studio)) which = 'raw';
  state.hearing = which;
  for (const b of $$('#ab button')) b.classList.toggle('is-on', b.dataset.src === which);
  if (state.playing) restartPlayback();
  drawWave();
}

/* ───────────────────────── the sliders ───────────────────────── */

const CONTROLS = [
  { key: 'cleanup', label: 'Clean up', min: 0, max: 100, unit: '%',
    why: 'Subtracts the room, measured from your own quiet moments.' },
  { key: 'gate', label: 'Gaps between words', min: 0, max: 100, unit: '%',
    why: 'How far down the silence goes. Too far and the breaths disappear with it.' },
  { key: 'warmth', label: 'Warmth', min: -100, max: 100, unit: '',
    why: 'Weight underneath at 210 Hz. Negative takes it away and opens the top.' },
  { key: 'presence', label: 'Presence', min: 0, max: 100, unit: '%',
    why: 'The 3 kHz lift that puts the words in front of everything else.' },
  { key: 'deEss', label: 'S sounds', min: 0, max: 100, unit: '%',
    why: 'Holds down the sibilant band, and only when it spits.' },
  { key: 'compression', label: 'Level', min: 0, max: 100, unit: '%',
    why: 'Two compressors: one slow for the shape, one quick for the peaks.' },
  { key: 'saturation', label: 'Drive', min: 0, max: 100, unit: '%',
    why: 'A touch of tape. Adds the harmonics that carry on a small speaker.' },
  { key: 'tune', label: 'Tuning', min: 0, max: 100, unit: '%',
    why: 'How far towards the right note. The rest of the way is left as you sang it.' },
  { key: 'tuneSpeed', label: 'Retune speed', min: 5, max: 200, unit: ' ms',
    why: 'How fast it moves. Slow keeps vibrato and slides; fast is the effect everyone knows.' },
  { key: 'double', label: 'Double', min: 0, max: 100, unit: '%',
    why: 'A second and third voice a few milliseconds behind, left and right.' },
  { key: 'space', label: 'Space', min: 0, max: 100, unit: '%',
    why: 'How much room around the voice.' },
  { key: 'spaceSize', label: 'Size of the room', min: 0, max: 100, unit: '%',
    why: 'Booth, room or hall.' },
];

function buildControls() {
  const cur = state.cur;
  const box = $('#controls');
  if (!cur || !cur.settings) { box.innerHTML = '<p class="note">Listening to the take first.</p>'; return; }
  const st = cur.settings;
  const manual = cur.manual || (cur.manual = new Set());

  const rows = CONTROLS.map(c => `
    <div class="ctl" data-key="${c.key}">
      <div class="ctl-top"><b>${esc(c.label)}</b>
        <span class="ctl-val ${manual.has(c.key) ? 'is-manual' : ''}">${st[c.key]}${c.unit}</span></div>
      <div class="ctl-why">${esc(c.why)}</div>
      <input type="range" min="${c.min}" max="${c.max}" step="1" value="${st[c.key]}" />
    </div>`).join('');

  const keys = NOTE_NAMES.map((n, i) => `<option value="${i}" ${st.keyTonic === i ? 'selected' : ''}>${n}</option>`).join('');
  const scale = `
    <div class="ctl" data-key="key">
      <div class="ctl-top"><b>Notes to snap to</b>
        <span class="ctl-val ${manual.has('key') ? 'is-manual' : ''}">${st.keyMode === 'chromatic' ? 'every note' : NOTE_NAMES[st.keyTonic] + ' ' + st.keyMode}</span></div>
      <div class="ctl-why">Heard as ${cur.report && cur.report.key ? esc(cur.report.key.name) : 'unclear'}. Snapping inside a key is kinder than snapping to everything.</div>
      <div class="ctl-pair">
        <select id="keyTonic">${keys}</select>
        <select id="keyMode">
          <option value="major" ${st.keyMode === 'major' ? 'selected' : ''}>major</option>
          <option value="minor" ${st.keyMode === 'minor' ? 'selected' : ''}>minor</option>
          <option value="chromatic" ${st.keyMode === 'chromatic' ? 'selected' : ''}>every note</option>
        </select>
      </div>
    </div>`;

  const targets = Object.entries(TARGETS)
    .map(([k, v]) => `<option value="${k}" ${st.targetName === k ? 'selected' : ''}>${esc(v.label)}</option>`).join('');
  const target = `
    <div class="ctl" data-key="targetName">
      <div class="ctl-top"><b>Release loudness</b><span class="ctl-val">${esc(TARGETS[st.targetName].label)}</span></div>
      <div class="ctl-why">Where the finished take is levelled to, with a look-ahead limiter under the ceiling.</div>
      <select id="targetSel2">${targets}</select>
    </div>`;

  box.innerHTML = rows + scale + target;

  for (const el of $$('.ctl[data-key] input[type=range]', box)) {
    const key = el.closest('.ctl').dataset.key;
    el.addEventListener('input', () => {
      st[key] = Number(el.value);
      manual.add(key);
      if (key === 'tune' || key === 'tuneSpeed') { st.tuneMode = 'custom'; paintTuneMode(); }
      const spec = CONTROLS.find(c => c.key === key);
      const val = el.closest('.ctl').querySelector('.ctl-val');
      val.textContent = st[key] + spec.unit;
      val.classList.add('is-manual');
      renderSoon();
    });
  }
  $('#keyTonic', box).addEventListener('change', e => {
    st.keyTonic = Number(e.target.value); manual.add('key'); buildControls(); renderSoon();
  });
  $('#keyMode', box).addEventListener('change', e => {
    st.keyMode = e.target.value; manual.add('key'); buildControls(); renderSoon();
  });
  $('#targetSel2', box).addEventListener('change', e => {
    st.targetName = e.target.value;
    st.targetLufs = TARGETS[st.targetName].lufs;
    st.ceilingDb = TARGETS[st.targetName].ceiling;
    manual.add('targetName');
    buildControls();
    renderSoon();
  });
}

/* ───────────────────────── export ───────────────────────── */

function exportName(cur) {
  const safe = cur.meta.name.replace(/[^\w\d -]+/g, '').trim() || 'take';
  const hasBacking = cur.meta.backingId && cur.settings && cur.settings.backingOn !== false;
  const what = state.hearing === 'raw' ? ' (raw)' : hasBacking ? ' (mix)' : ' (studio)';
  return safe + what + '.wav';
}

function exportBlob(cur) {
  const audio = currentAudio();
  return wavBlob(audio.channels, audio.sampleRate, 24);
}

function exportTake() {
  const cur = state.cur;
  if (!cur) return;
  const blob = exportBlob(cur);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = exportName(cur);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  toast('Saved ' + exportName(cur) + ' (' + mb(blob.size) + ')');
}

async function shareTake() {
  const cur = state.cur;
  if (!cur) return;
  const file = new File([exportBlob(cur)], exportName(cur), { type: 'audio/wav' });
  if (!navigator.canShare || !navigator.canShare({ files: [file] })) { exportTake(); return; }
  try { await navigator.share({ files: [file], title: cur.meta.name }); }
  catch { /* the share sheet was dismissed */ }
}

/* ───────────────────────── files in ───────────────────────── */

async function importFile(file) {
  ensureCtx();
  toast('Reading ' + file.name + '…');
  const buf = await file.arrayBuffer();
  let channels = null, sampleRate = ctx.sampleRate;
  const asWav = decodeWav(buf);
  if (asWav && asWav.sampleRate === ctx.sampleRate) {
    channels = asWav.channels; sampleRate = asWav.sampleRate;
  } else {
    const decoded = await ctx.decodeAudioData(buf.slice(0)).catch(() => null);
    if (!decoded) { toast("That file isn't audio this browser can read."); return; }
    channels = [];
    for (let c = 0; c < decoded.numberOfChannels; c++) channels.push(decoded.getChannelData(c));
    sampleRate = decoded.sampleRate;
  }

  // one voice, one channel: fold anything wider down before working on it
  let mono = channels[0];
  if (channels.length > 1) {
    mono = new Float32Array(channels[0].length);
    for (let i = 0; i < mono.length; i++) {
      let s = 0;
      for (const ch of channels) s += ch[i];
      mono[i] = s / channels.length;
    }
  }
  newTake(Float32Array.from(mono), sampleRate, file.name.replace(/\.[^.]+$/, ''));
}

/* ───────────────────────── views ───────────────────────── */

function show(view) {
  state.view = view;
  for (const s of $$('.view')) s.hidden = s.id !== 'view-' + view;
  for (const b of $$('.tab')) b.classList.toggle('is-on', b.dataset.view === view || (view === 'take' && b.dataset.view === 'takes'));
  if (view === 'take') requestAnimationFrame(drawWave);
  if (view === 'setup') updateStorageNote();
  window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
}

/* ───────────────────────── setup ───────────────────────── */

function fillSetup() {
  $('#targetSel').innerHTML = Object.entries(TARGETS)
    .map(([k, v]) => `<option value="${k}" ${prefs.targetName === k ? 'selected' : ''}>${esc(v.label)}</option>`).join('');
  $('#a4').value = prefs.a4;
  $('#a4Out').textContent = prefs.a4 + ' Hz';
  $('#rawProcessing').checked = !!prefs.rawProcessing;
  $('#autoRun').checked = !!prefs.autoRun;
  updateStorageNote();
}

async function updateStorageNote() {
  let used = 0;
  for (const t of state.takes) used += (t.rawBytes || 0) + (t.studioBytes || 0);
  for (const b of state.backings) used += b.bytes || 0;
  drawBackingList();
  let quota = '';
  if (navigator.storage && navigator.storage.estimate) {
    const est = await navigator.storage.estimate().catch(() => null);
    if (est && est.quota) quota = ' of about ' + mb(est.quota) + ' the browser will allow';
  }
  const bits = [];
  if (state.takes.length) bits.push(state.takes.length + ' take' + (state.takes.length === 1 ? '' : 's'));
  if (state.backings.length) bits.push(state.backings.length + ' backing track' + (state.backings.length === 1 ? '' : 's'));
  $('#storageNote').textContent = bits.length
    ? bits.join(' and ') + ', ' + mb(used) + quota + '.'
    : 'Nothing stored yet.';
}

/* ───────────────────────── wiring ───────────────────────── */

$('#recBtn').addEventListener('click', () => {
  if (state.recording) stopRecording(); else startRecording();
});

$('#monBtn').addEventListener('click', toggleMonitor);

$('#deviceSel').addEventListener('change', async e => {
  prefs.deviceId = e.target.value; savePrefs();
  if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
  if (monitorOn) { monitor.dispose(); monitor = null; monitorOn = false; $('#monBtn').classList.remove('is-on'); }
  await ensureMic();
  toast('Listening to ' + (e.target.selectedOptions[0].textContent || 'the default microphone') + '.');
});

for (const b of $$('.tab')) b.addEventListener('click', () => show(b.dataset.view));
$('#backBtn').addEventListener('click', () => show('takes'));
$('#helpBtn').addEventListener('click', () => { show('setup'); $('#about').scrollIntoView({ behavior: 'smooth', block: 'start' }); });

$('#takeList').addEventListener('click', e => {
  const item = e.target.closest('.take-item');
  if (item) openTake(item.dataset.id);
});

$('#playBtn').addEventListener('click', () => {
  if (state.playing) stopPlayback();
  else startPlayback(playPosition() >= (state.cur ? state.cur.meta.duration - 0.05 : 0) ? 0 : playPosition());
});

$('#loopBtn').addEventListener('click', () => {
  state.loop = !state.loop;
  if (srcNode) srcNode.loop = state.loop;
  paintTransport();
  // a backing has to be given the new loop points, which means restarting it
  if (state.playing && backingNode) restartPlayback();
});

$('#ab').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.src === 'studio' && state.cur && !state.cur.studio) { toast('Still working on the studio version.'); return; }
  if (state.cur) state.cur.chose = true;      // stop later renders from switching it back
  setHearing(b.dataset.src);
});

$('#tuneMode').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (b) setTuneMode(b.dataset.mode);
});

$('#matchBox').addEventListener('change', e => {
  state.match = e.target.checked;
  if (state.playing) restartPlayback();
});


$('#wave').addEventListener('pointerdown', e => {
  const cur = state.cur;
  if (!cur) return;
  const r = wave.getBoundingClientRect();
  const t = clamp((e.clientX - r.left) / r.width, 0, 1) * cur.meta.duration;
  if (state.playing) startPlayback(t);
  else { startOffset = t; $('#playTime').textContent = mmss(t); drawWave(); }
});

$('#takeName').addEventListener('change', async e => {
  const cur = state.cur;
  if (!cur) return;
  cur.meta.name = e.target.value.trim() || 'Untitled take';
  e.target.value = cur.meta.name;
  await store.putTake(cur.meta);
  drawTakeList();
});

$('#autoBtn').addEventListener('click', () => {
  const cur = state.cur;
  if (!cur) return;
  engine.post({ type: 'auto', id: cur.meta.id, targetName: prefs.targetName, tuneMode: prefs.tuneMode });
});

$('#exportBtn').addEventListener('click', exportTake);
$('#shareBtn').addEventListener('click', shareTake);
$('#deleteBtn').addEventListener('click', () => {
  const cur = state.cur;
  if (!cur) return;
  if (confirm('Delete "' + cur.meta.name + '"? The recording goes with it.')) deleteTake(cur.meta.id);
});

$('#backingSel').addEventListener('change', e => {
  stopBackingPreview();
  prefs.backingId = e.target.value;
  savePrefs();
  $('#backingPlayBtn').disabled = !e.target.value;
  updateRecHint();
});
$('#backingPlayBtn').addEventListener('click', toggleBackingPreview);
$('#backingAddBtn').addEventListener('click', () => $('#backingInput').click());
$('#backingInput').addEventListener('change', async e => {
  if (e.target.files && e.target.files[0]) await addBackingFile(e.target.files[0]);
  e.target.value = '';
});

$('#takeBackingSel').addEventListener('change', async e => {
  if (!state.cur) return;
  if (state.playing) stopPlayback();
  await attachBacking(state.cur, e.target.value);
});

$('#backingOn').addEventListener('change', e => {
  const cur = state.cur;
  if (!cur || !cur.settings) return;
  cur.settings.backingOn = e.target.checked;
  cur.manual.add('backingOn');
  if (state.playing) stopPlayback();
  renderSoon();
});

for (const [id, key, fmt] of [
  ['#backingDb', 'backingDb', v => (v ? (v > 0 ? '+' : '') + Number(v).toFixed(1) + ' dB' : 'automatic')],
  ['#duck', 'duck', v => v + '%'],
]) {
  $(id).addEventListener('input', e => {
    const cur = state.cur;
    if (!cur || !cur.settings) return;
    cur.settings[key] = Number(e.target.value);
    cur.manual.add(key);
    $(id + 'Out').textContent = fmt(Number(e.target.value));
    renderSoon();
  });
}

/* Nudging the alignment changes where the backing sits against the take, so
   the engine needs a freshly cut copy before it renders again. */
$('#nudge').addEventListener('input', e => {
  const cur = state.cur;
  if (!cur) return;
  cur.meta.backingNudge = Number(e.target.value);
  $('#nudgeOut').textContent = (cur.meta.backingNudge > 0 ? '+' : '') + cur.meta.backingNudge + ' ms';
});
$('#nudge').addEventListener('change', () => {
  const cur = state.cur;
  if (!cur) return;
  store.putTake(cur.meta);
  sendBacking(cur);
  if (state.playing && state.hearing === 'raw') restartPlayback();
  renderSoon();
});

$('#backingList').addEventListener('click', e => {
  const btn = e.target.closest('[data-del-backing]');
  if (!btn) return;
  const b = state.backings.find(x => x.id === btn.dataset.delBacking);
  if (b && confirm('Delete the backing track "' + b.name + '"? Takes recorded to it keep their audio.')) {
    deleteBacking(b.id);
  }
});

$('#pickBtn').addEventListener('click', () => $('#fileInput').click());
$('#fileInput').addEventListener('change', e => {
  if (e.target.files && e.target.files[0]) importFile(e.target.files[0]);
  e.target.value = '';
});

const drop = $('#drop');
for (const type of ['dragenter', 'dragover']) {
  document.addEventListener(type, e => { e.preventDefault(); drop.classList.add('is-over'); });
}
document.addEventListener('dragleave', e => { if (e.relatedTarget === null) drop.classList.remove('is-over'); });
document.addEventListener('drop', e => {
  e.preventDefault();
  drop.classList.remove('is-over');
  const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if (f) importFile(f);
});

$('#targetSel').addEventListener('change', e => {
  prefs.targetName = e.target.value; savePrefs();
  toast('New takes will be levelled to ' + TARGETS[prefs.targetName].label + '.');
});
$('#a4').addEventListener('input', e => {
  prefs.a4 = Number(e.target.value); savePrefs();
  $('#a4Out').textContent = prefs.a4 + ' Hz';
});
$('#rawProcessing').addEventListener('change', async e => {
  prefs.rawProcessing = e.target.checked; savePrefs();
  if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; await ensureMic(); }
});
$('#autoRun').addEventListener('change', e => { prefs.autoRun = e.target.checked; savePrefs(); });
$('#clearBtn').addEventListener('click', async () => {
  if (!state.takes.length) return;
  if (!confirm('Delete all ' + state.takes.length + ' takes? There is no undo.')) return;
  for (const t of [...state.takes]) { await store.delTake(t.id); await store.delAudio(t.id); }
  state.takes = []; state.cur = null;
  drawTakeList(); updateStorageNote(); show('takes');
  toast('All takes deleted.');
});

/* Keyboard, for the version of this that runs on a desk. */
document.addEventListener('keydown', e => {
  if (e.target.matches('input, select, textarea')) return;
  if (e.key === ' ' && state.view === 'take') {
    e.preventDefault();
    state.playing ? stopPlayback() : startPlayback(playPosition());
  } else if (e.key.toLowerCase() === 'r' && state.view === 'record') {
    state.recording ? stopRecording() : startRecording();
  } else if (e.key.toLowerCase() === 'a' && state.view === 'take') {
    setHearing(state.hearing === 'studio' ? 'raw' : 'studio');
  } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && state.view === 'take' && state.cur) {
    const to = clamp(playPosition() + (e.key === 'ArrowRight' ? 5 : -5), 0, state.cur.meta.duration - 0.05);
    if (state.playing) startPlayback(to); else { startOffset = to; drawWave(); $('#playTime').textContent = mmss(to); }
  } else if (e.key.toLowerCase() === 's' && (e.metaKey || e.ctrlKey) && state.view === 'take') {
    e.preventDefault(); exportTake();
  }
});

window.addEventListener('resize', () => { if (state.view === 'take') drawWave(); });
navigator.mediaDevices && navigator.mediaDevices.addEventListener &&
  navigator.mediaDevices.addEventListener('devicechange', listDevices);

/* ───────────────────────── go ───────────────────────── */

(async function boot() {
  await startEngine();
  fillSetup();
  await loadTakes();
  await loadBackings();
  updateStorageNote();
  drawRing(0, 0);

  // the home-screen shortcuts in the manifest land here
  const open = new URLSearchParams(location.search).get('open');
  if (open === 'takes' || open === 'setup') show(open);

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* offline is a bonus, not a requirement */ });
  }
})();
