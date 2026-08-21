/* Defect Log — capture, score, keep.

   The prototype this grew out of kept everything in localStorage, photographs
   included. A 1080p JPEG is a few hundred kilobytes before base64 puts another
   third on top, and localStorage gives you about five megabytes in total: the
   third or fourth defect of the morning throws, the write is quietly dropped,
   and the log looks right until the phone is next locked. Entries live in
   IndexedDB here, with the photograph held as a Blob rather than a string, so
   the store is measured in hundreds of megabytes and a failed write is an
   error you are told about rather than one you find out about later. */

var $ = function (id) { return document.getElementById(id); };

/* Printed in the footer. Without it there is no way to tell from the phone
   whether a fix has actually arrived or a stale copy is being served, which is
   a question that otherwise costs a round trip to answer. Bump it on release. */
var BUILD = '2026-08-21 · 9';

var STALE_MS = 30000;   // a fix older than this is called out, not trusted quietly
var POOR_ACC = 25;      // metres; wider than this and you cannot find the defect again
var MAX_EDGE = 1600;    // longest side of a saved photograph

/* Detection runs on the phone.

   The obvious way — post the photograph to the hosted inference API — is a
   dead end from a page: the service answers, and the browser will not let a web
   page read what it said. That is not a bug to work around; that API is not
   meant to be called from a page at all. This SDK is the way that is, and it
   works differently: the model is downloaded once and run here, so the only
   thing crossing the network is the weights, and after that a capture is
   checked with no signal at all.

   Running here also rules out segmentation — the SDK carries detection
   architectures only — so the defect arrives as a box rather than an outline,
   and the share of the frame is measured from that. A box is generous around
   an irregular hole, which makes the size band read slightly high. */
var RF_MODEL = 'cv-helmet-combined-dataset-rf4bc';
var RF_VERSION = 1;
var RF_KEY = 'rf_pxctFcweYjTPKQwCJgjKpHcWSpz1';
var RF_CONF = 0.40;     // below this the model is guessing

/* Survey mode: the camera runs and the model watches it, and anything it finds
   is written down without being asked. Three numbers govern how that behaves.

   The same hole stays in shot for many frames and, from a moving vehicle, for
   many metres, so without a memory a single pothole becomes fifty entries. A
   find is ignored if one was already logged within NEAR_M of it; with no fix to
   compare, the fallback is time alone, which is cruder and is why a survey
   without GPS says so. SURVEY_CONF is higher than the deliberate-capture
   threshold because nobody is looking at these before they land. */
var SURVEY_MS = 1200;    // between looks; faster mainly costs battery
var SURVEY_CONF = 0.65;  // unattended entries should be surer than watched ones
var NEAR_M = 20;         // a find this close to one already logged is the same defect
var QUIET_MS = 45000;    // with no fix, this long before the same view counts again
var TEX_MIN = 1.18;      // below this the dark patch is grained like the road around it
var ASPECT_MAX = 4.5;    // a band far longer than it is wide is a shadow, not a hole

var S = { imp: 0, prob: 0, foot: false, by: null,
          shot: null, shotFix: null, prevUrl: null, gps: null, det: null, items: [] };
var stream = null, watchId = null, ageTimer = null, urls = [], lbUrl = null;

/* ---------- store ---------- */
/* IndexedDB, with the whole thing degrading to memory if the browser won't
   give us one (private windows, storage switched off). The difference from the
   prototype is that the degradation is announced. */
var DB_NAME = 'deflog', STORE = 'defects', WRONG = 'wrong', db = null, dbBroken = false;

function openDb() {
  return new Promise(function (resolve, reject) {
    if (!self.indexedDB) return reject(new Error('no IndexedDB'));
    var req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = function () {
      var d = req.result;
      if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE, { keyPath: 'id' });
      /* Corrections live beside the log rather than in it. A thing you have said
         is not a defect must never read as a defect, and deleting it outright
         throws away the only examples a retrain could learn this from. */
      if (!d.objectStoreNames.contains(WRONG)) d.createObjectStore(WRONG, { keyPath: 'id' });
    };
    req.onsuccess = function () { resolve(req.result); };
    req.onerror = function () { reject(req.error); };
  });
}

function tx(mode, fn, store) {
  return new Promise(function (resolve, reject) {
    if (!db) return reject(new Error('no store'));
    var t = db.transaction(store || STORE, mode), out = fn(t.objectStore(store || STORE));
    t.oncomplete = function () { resolve(out && out.result); };
    t.onerror = function () { reject(t.error); };
    t.onabort = function () { reject(t.error); };
  });
}

function putEntry(e) { return tx('readwrite', function (s) { return s.put(e); }); }
function delEntry(id) { return tx('readwrite', function (s) { return s.delete(id); }); }
function clearEntries() { return tx('readwrite', function (s) { return s.clear(); }); }
function putWrong(e) { return tx('readwrite', function (s) { return s.put(e); }, WRONG); }
function allWrong() {
  return tx('readonly', function (s) { return s.getAll(); }, WRONG)
    .then(function (r) { return r || []; }, function () { return []; });
}

function allEntries() {
  return tx('readonly', function (s) { return s.getAll(); }).then(function (rows) {
    return (rows || []).sort(function (a, b) { return b.id - a.id; });   // newest first
  });
}

/* Anything the prototype left in localStorage is brought across once, then the
   old key is dropped. Photographs come over as data URLs and go in as Blobs. */
function migrateLegacy() {
  var raw;
  try { raw = localStorage.getItem('deflog'); } catch (e) { return Promise.resolve(); }
  if (!raw) return Promise.resolve();
  var old;
  try { old = JSON.parse(raw); } catch (e) { old = null; }
  if (!Array.isArray(old) || !old.length) {
    try { localStorage.removeItem('deflog'); } catch (e) {}
    return Promise.resolve();
  }
  return Promise.all(old.map(function (it) {
    var img = it.img;
    var asBlob = (typeof img === 'string' && img.indexOf('data:') === 0)
      ? fetch(img).then(function (r) { return r.blob(); }).catch(function () { return null; })
      : Promise.resolve(null);
    return asBlob.then(function (b) {
      var e = {};
      for (var k in it) if (k !== 'img') e[k] = it[k];
      e.img = b;
      if (e.fixAge === undefined) e.fixAge = null;
      return putEntry(e);
    });
  })).then(function () {
    try { localStorage.removeItem('deflog'); } catch (e) {}
  }).catch(function () { /* leave the old key alone if any of it failed */ });
}

/* Ids are the timestamp, which is also the sort order. Two saves inside the
   same millisecond would otherwise write to the same key and the first would
   be gone, so the clock is nudged forward rather than allowed to repeat. */
function nextId() {
  var now = Date.now(), top = S.items.length ? S.items[0].id : 0;
  return now > top ? now : top + 1;
}

/* ---------- risk matrix ---------- */
var IMP = ['No impact', 'Minimal', 'Moderate', 'High', 'Severe'];
var PRB = ['Remote', 'Unlikely', 'Possible', 'Likely', 'Probable'];

function band(n) { // colours mirror the laminated card
  if (n >= 16) return 'g1'; if (n >= 9) return 'g2'; if (n >= 6) return 'g3'; return 'g4';
}

function buildMatrix() {
  var g = $('mx'), h = '';
  h += '<div class="lbl"></div>';
  for (var p = 1; p <= 5; p++) h += '<div class="lbl">' + p + '<br>' + PRB[p - 1] + '</div>';
  for (var i = 1; i <= 5; i++) {
    h += '<div class="lbl rowlbl">' + i + '<br>' + IMP[i - 1] + '</div>';
    for (var p2 = 1; p2 <= 5; p2++) {
      var v = i * p2;
      h += '<button type="button" class="cell ' + band(v) + '" data-i="' + i + '" data-p="' + p2 + '" ' +
           'aria-pressed="false" aria-label="Impact ' + i + ', probability ' + p2 + ', score ' + v + '">' + v + '</button>';
    }
  }
  g.innerHTML = h;
  g.addEventListener('click', function (e) {
    var b = e.target.closest('.cell'); if (!b) return;
    S.imp = +b.dataset.i; S.prob = +b.dataset.p; S.by = 'person';
    [].forEach.call(g.querySelectorAll('.cell'), function (c) {
      c.setAttribute('aria-pressed', c === b ? 'true' : 'false');
    });
    verdict();
  });
}

function clearMatrix() {
  [].forEach.call($('mx').querySelectorAll('.cell'), function (c) {
    c.setAttribute('aria-pressed', 'false');
  });
}

function selectCell(i, p) {
  var b = $('mx').querySelector('.cell[data-i="' + i + '"][data-p="' + p + '"]');
  if (!b) return;
  [].forEach.call($('mx').querySelectorAll('.cell'), function (c) {
    c.setAttribute('aria-pressed', c === b ? 'true' : 'false');
  });
  S.imp = i; S.prob = p;
}

function category(n) {
  if (n >= 25) return { k: 'Emergency', r: '2 hours', c: 'c-em', key: 'kem' };
  if (n >= 16) return { k: 'Category 1', r: '1 working day', c: 'c-1', key: 'k1' };
  if (n >= 9)  return { k: 'Category 2', r: '28 calendar days', c: 'c-2', key: 'k2' };
  if (n >= 6)  return { k: 'Category 3', r: '90 calendar days', c: 'c-3', key: 'k3' };
  return { k: 'Below threshold', r: 'No response category', c: '', key: 'k0' };
}

function verdict() {
  var n = S.imp * S.prob, v = $('verd');
  v.className = 'verdict';
  if (!n) {
    $('vScore').textContent = '—';
    $('vCat').textContent = 'Not scored';
    $('vResp').textContent = 'Select impact and probability';
  } else {
    var c = category(n);
    $('vScore').textContent = n; $('vCat').textContent = c.k; $('vResp').textContent = c.r;
    if (c.c) v.classList.add(c.c);
  }
  var by = $('vBy');
  by.hidden = !n || !S.by;
  if (n && S.by) {
    by.textContent = S.by === 'app' ? 'Proposed by the app — tap any cell to overrule'
                                    : 'Your score';
  }
}

/* ---------- segmented controls ---------- */
function seg(a, b, fn) {
  a.addEventListener('click', function () {
    a.setAttribute('aria-pressed', 'true'); b.setAttribute('aria-pressed', 'false'); fn(true);
  });
  b.addEventListener('click', function () {
    b.setAttribute('aria-pressed', 'true'); a.setAttribute('aria-pressed', 'false'); fn(false);
  });
}
/* Changing the surface changes what the same hole means, so the proposal is
   recomputed rather than left showing a score for the other surface. */
seg($('segCar'), $('segFoot'), function (isCar) { S.foot = !isCar; propose(); });

/* ---------- camera ---------- */
$('bStart').addEventListener('click', function () { openCamera(true); });

async function openCamera(byTap) {
  if (stream) return;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    if (byTap) note('This browser will not give a page camera access.', true);
    return;
  }
  var ideal = { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false };
  try {
    try {
      stream = await navigator.mediaDevices.getUserMedia(ideal);
    } catch (inner) {
      // some phones refuse the resolution rather than the camera; ask for less
      if (inner && (inner.name === 'OverconstrainedError' || inner.name === 'NotFoundError')) {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      } else { throw inner; }
    }
    $('vid').srcObject = stream; $('badge').textContent = 'Live';
    $('bStart').hidden = true; $('capRow').hidden = false; $('rec').hidden = false;
    $('camNote').hidden = true;
    $('bSurvey').hidden = false;
    startGps();
  } catch (e) {
    /* Opening without being asked is allowed to fail quietly: some browsers
       only hand over a camera off a tap, and the button is still sitting
       there. A refusal of a tap is worth saying out loud. */
    if (byTap) {
      note('Camera did not open: ' + e.name + '. If this is not an https address, that is why.', true);
    }
  }
}
$('bStop').addEventListener('click', stopAll);

function stopAll() {
  if (survey.on) endSurvey();
  if (stream) { stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; }
  if (watchId != null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
  if (ageTimer) { clearInterval(ageTimer); ageTimer = null; }
  /* The last fix goes with the camera. Keeping it means the next capture — which
     could be a mile down the road — gets tagged with where you were standing
     when you last stopped. */
  S.gps = null;
  $('badge').textContent = 'Camera off'; $('bStart').hidden = false;
  $('capRow').hidden = true; $('rec').hidden = true; $('gpsBox').hidden = true;
  $('bSurvey').hidden = true;
  primer();
}

/* The panel under the buttons is pre-flight advice — how to get the camera and
   the location open. Once both are open it has nothing left to say and is a
   screenful of text between you and the road, so it goes when the camera comes
   up and returns when the camera stops. Problems reclaim the same space. */
var PRIMER = $('camNote').innerHTML;

function note(msg, isErr) {
  var n = $('camNote');
  n.innerHTML = '<b>' + (isErr ? 'Problem.' : 'Note.') + '</b> ' + msg;
  n.classList.toggle('err', !!isErr);
  n.hidden = false;
}

function primer() {
  var n = $('camNote');
  n.innerHTML = PRIMER; n.classList.remove('err'); n.hidden = false;
}

/* ---------- gps ---------- */
function fixAge() { return S.gps ? Math.round((Date.now() - S.gps.at) / 1000) : null; }

function paintFix() {
  var age = fixAge();
  if (!S.gps) { $('mAge').textContent = '—'; return; }
  $('mAge').textContent = age + ' s';
  $('mAge').className = age > STALE_MS / 1000 ? 'warn' : '';
  var r = $('rec');
  r.className = 'rec' + (age > STALE_MS / 1000 ? ' poor' : (S.gps.acc > POOR_ACC ? ' poor' : ''));
  $('recTxt').textContent = 'GPS ±' + Math.round(S.gps.acc) + 'm';
}

function startGps() {
  if (!navigator.geolocation) { $('recTxt').textContent = 'No GPS'; $('rec').className = 'rec none'; return; }
  $('gpsBox').hidden = false;
  watchId = navigator.geolocation.watchPosition(function (p) {
    S.gps = { lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy, at: Date.now() };
    $('mLat').textContent = S.gps.lat.toFixed(6);
    $('mLon').textContent = S.gps.lon.toFixed(6);
    $('mAcc').textContent = '±' + Math.round(S.gps.acc) + ' m';
    $('mAcc').className = S.gps.acc > POOR_ACC ? 'warn' : '';
    paintFix();
  }, function () {
    $('recTxt').textContent = 'GPS denied'; $('rec').className = 'rec none'; S.gps = null;
    $('gpsBox').hidden = true;
    note('Location was refused, so captures will be saved with no coordinates. ' +
         'Allow it for this site in the browser settings, then stop and start the ' +
         'camera again. Until then, put the road name in the notes.', true);
  }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 });
  ageTimer = setInterval(paintFix, 2000);
}

/* ---------- capture ---------- */
$('bShot').addEventListener('click', function () {
  var v = $('vid'), c = $('shot');
  if (!v.videoWidth) return note('The camera has not produced a frame yet — give it a moment.', true);
  var scale = Math.min(1, MAX_EDGE / Math.max(v.videoWidth, v.videoHeight));
  c.width = Math.round(v.videoWidth * scale);
  c.height = Math.round(v.videoHeight * scale);
  c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
  c.toBlob(function (blob) {
    if (!blob) return note('The photograph could not be encoded on this device.', true);
    S.shot = blob;
    S.shotFix = S.gps ? { lat: S.gps.lat, lon: S.gps.lon, acc: S.gps.acc, age: fixAge() } : null;
    if (S.prevUrl) URL.revokeObjectURL(S.prevUrl);
    S.prevUrl = URL.createObjectURL(blob);
    $('prev').src = S.prevUrl;

    S.imp = 0; S.prob = 0; S.by = null; S.det = null;
    $('fNote').value = ''; $('fType').selectedIndex = 0;
    clearMatrix();
    verdict();
    paintFixNote();
    show('score');
    analyse(blob);
  }, 'image/jpeg', 0.82);
});

/* Say what is about to be written down about the location, while there is
   still time to walk two steps and get a better fix. */
function paintFixNote() {
  var n = $('fixNote'), f = S.shotFix;
  n.hidden = false; n.className = 'fixnote';
  if (!f) {
    n.innerHTML = '<b>No coordinates.</b> There was no fix when this was taken — the entry will ' +
      'be saved without a location. Put the road name in the notes.';
    return;
  }
  var bits = [];
  if (f.acc > POOR_ACC) bits.push('the fix is only good to ±' + Math.round(f.acc) + ' m');
  if (f.age > STALE_MS / 1000) bits.push('it was ' + f.age + ' seconds old when you took the photograph');
  if (!bits.length) n.className = 'fixnote ok';
  n.innerHTML = '<b>Location.</b> ' + f.lat.toFixed(5) + ', ' + f.lon.toFixed(5) +
    ' at ±' + Math.round(f.acc) + ' m' +
    (bits.length ? ' — ' + bits.join(', ') + '. It is saved as it stands, and flagged in the log.'
                 : '. Saved with the entry.');
}

$('bDiscard').addEventListener('click', discard);

function discard() {
  S.shot = null; S.shotFix = null;
  if (S.prevUrl) { URL.revokeObjectURL(S.prevUrl); S.prevUrl = null; }
  $('prev').removeAttribute('src');
  show('cap');
}

$('bSave').addEventListener('click', function () {
  if (!S.imp || !S.prob) { alert('Score it on the matrix first.'); return; }
  var n = S.imp * S.prob, c = category(n), f = S.shotFix;
  var e = {
    id: nextId(), t: new Date().toISOString(), img: S.shot,
    imp: S.imp, prob: S.prob, score: n, cat: c.k, resp: c.r, key: c.key,
    surface: S.foot ? 'Footway/cycleway' : 'Carriageway',
    scoredBy: S.by === 'app' ? 'app proposal, accepted' : 'inspector',
    detConf: S.det ? S.det.conf : null,
    detShare: S.det ? S.det.share : null,
    detCount: S.det ? S.det.count : null,
    type: $('fType').value, note: $('fNote').value.trim(),
    lat: f ? f.lat : null, lon: f ? f.lon : null,
    acc: f ? Math.round(f.acc) : null, fixAge: f ? f.age : null
  };
  var saved = dbBroken ? Promise.resolve() : putEntry(e);
  saved.then(function () {
    S.items.unshift(e);
    S.shot = null; S.shotFix = null;
    if (S.prevUrl) { URL.revokeObjectURL(S.prevUrl); S.prevUrl = null; }
    render(); show('log');
  }).catch(function (err) {
    alert('That entry could not be written to this device\'s storage (' +
          (err && err.name ? err.name : 'unknown') + '). It has not been saved. ' +
          'Export what is already in the log before carrying on.');
  });
});

/* ---------- what the photograph can and cannot say ----------

   The model finds the defect and outlines it. What it cannot do is tell you how
   big the thing actually is: a small hole photographed from close up fills the
   frame exactly like a large one photographed from further back, and one
   photograph has no scale in it. So the share of the frame is only a proxy, and
   it is only worth anything under the assumption the app states on screen —
   that you are standing over the defect with the phone pointed down, which is
   how these photographs get taken.

   Nothing here estimates depth. Nothing here knows the speed limit, the traffic
   or the footfall, and those are half of what probability means. The score is
   therefore a proposal with its reasoning shown, and one tap overrules it. */

var BANDS = [
  { max: 0.02, word: 'barely registers', imp: 1, prb: 1 },
  { max: 0.06, word: 'small',            imp: 2, prb: 2 },
  { max: 0.15, word: 'moderate',         imp: 3, prb: 3 },
  { max: 0.30, word: 'large',            imp: 4, prb: 4 },
  { max: 1.01, word: 'very large',       imp: 5, prb: 4 }
];

function bandFor(share) {
  for (var i = 0; i < BANDS.length; i++) if (share < BANDS[i].max) return BANDS[i];
  return BANDS[BANDS.length - 1];
}

function proposal(det) {
  var b = bandFor(det.share), imp = b.imp, prb = b.prb, why = [];
  why.push(det.count > 1 ? det.count + ' defects found' : 'one defect found');
  why.push(b.word + ' — ' + Math.round(det.share * 100) + '% of the frame');
  if (S.foot && imp > 1) {
    imp = Math.min(5, imp + 1); prb = Math.min(4, prb + 1);
    why.push('on a footway, where it is a trip rather than a jolt and everyone walks the width');
  } else {
    why.push('on a carriageway');
  }
  if (det.count >= 3) {
    prb = Math.min(5, prb + 1);
    why.push('a cluster is harder to steer around');
  }
  return { imp: imp, prb: prb, why: why };
}

/* Recomputed whenever the surface changes, because the same hole on a footway
   is a different score from the same hole on a carriageway. */
function propose() {
  if (S.det) paintProposal();
}

function paintProposal() {
  var d = S.det, p = proposal(d), n = p.imp * p.prb, c = category(n);
  selectCell(p.imp, p.prb);
  S.by = 'app';
  verdict();
  scanSay('<b>' + Math.round(d.conf * 100) + '% sure that is a pothole.</b> ' +
          p.why.join(', ') + '. Proposed ' + p.imp + ' × ' + p.prb + ' = ' + n +
          ', ' + c.k + '.<br><span class="caveat">A photograph has no scale in it: this ' +
          'assumes you are standing over the defect with the phone pointed down, and it is ' +
          'measured from a box drawn round the hole, which is generous. It says nothing about ' +
          'depth, traffic or footfall. Check the cell before saving.</span>', 'hit');
}

function scanSay(html, cls) {
  var n = $('scan'); n.hidden = false; n.className = 'scan' + (cls ? ' ' + cls : '');
  n.innerHTML = html;
}

/* The engine and the model are loaded once and kept. Loading is the slow part
   — weights over mobile data — so it is done on the first capture rather than
   on page load, and every capture after that is local and quick. */
var engine = null, worker = null, loading = null;

function loadModel() {
  if (loading) return loading;
  loading = import('./vendor/inference.es.js').then(function (m) {
    engine = new m.InferenceEngine();
    return engine.startWorker(RF_MODEL, RF_VERSION, RF_KEY).then(function (id) {
      worker = id;
      return m;
    });
  }).catch(function (e) {
    loading = null;   // a failure must not poison every later capture
    throw e;
  });
  return loading;
}

function analyse(blob) {
  var mine = blob;   // a second capture while this is in flight must win
  var ready = !!worker;
  if (!ready && !navigator.onLine) {
    return scanSay('<b>No signal, and the model is not downloaded yet.</b> It is fetched once, ' +
                   'on the first check, and kept afterwards — so this works in a lay-by only ' +
                   'after it has run somewhere with a signal. Score it on the matrix yourself.',
                   'idle');
  }
  scanSay(ready ? '<b>Looking at the photograph…</b>'
                : '<b>Downloading the model…</b> This happens once. Later checks need no signal.',
          'idle');

  loadModel().then(function (m) {
    if (S.shot !== mine) return null;
    return createImageBitmap(blob).then(function (bmp) {
      return engine.infer(worker, new m.CVImage(bmp)).then(function (preds) {
        return { preds: preds, w: bmp.width, h: bmp.height, bmp: bmp };
      });
    });
  }).then(function (out) {
    if (!out || S.shot !== mine) return;
    var preds = (out.preds || []).filter(function (p) {
      return (p.confidence == null || p.confidence >= RF_CONF) &&
             /pothole/i.test(p.class || '');
    });
    if (!preds.length) {
      return scanSay('<b>No pothole identified.</b> Either there is not one in the frame or the ' +
                     'model cannot see it. Nothing is proposed — score it yourself.', 'none');
    }
    var best = preds.reduce(function (a, b) {
      return (b.confidence || 0) > (a.confidence || 0) ? b : a;
    });
    var box = best.bbox || best;

    /* The same shadow test the survey uses, except here somebody is looking, so
       it says what it decided and leaves the matrix alone rather than deciding
       for them. */
    var sc = document.createElement('canvas');
    sc.width = out.w; sc.height = out.h;
    var sctx = sc.getContext('2d', { willReadFrequently: true });
    sctx.drawImage(out.bmp, 0, 0);
    var bad = rejectReason(sctx, out.w, out.h,
      { x: box.x, y: box.y, w: box.width, h: box.height });
    if (bad) {
      return scanSay('<b>That looks like a shadow.</b> The model found something, but it is ' +
                     bad + '. Nothing is proposed — if it is a real defect, score it yourself.',
                     'none');
    }
    var share = (box.width * box.height) / (out.w * out.h);
    S.det = { conf: best.confidence == null ? 1 : best.confidence, share: share, count: preds.length };
    paintProposal();
  }).catch(function (e) {
    if (S.shot !== mine) return;
    scanSay('<b>Could not check the photograph.</b> ' + whyLocal(e) +
            ' Nothing is proposed — score it on the matrix yourself.', 'none');
  });
}

/* Three things can fail and they are not the same problem: the library did not
   load from this site, the model would not start, or the run itself broke. */
function whyLocal(e) {
  var msg = e && e.message ? String(e.message).slice(0, 200) : '';
  if (!worker && !engine) {
    return 'The detection library would not load from this site.' + (msg ? ' (' + msg + ')' : '');
  }
  if (!worker) {
    return 'The model would not start — that is the model or the key, not the signal.' +
           (msg ? ' (' + msg + ')' : '');
  }
  return 'The model failed while running.' + (msg ? ' (' + msg + ')' : '');
}


/* ---------- telling a shadow from a hole ----------

   Tree shadows across a carriageway are what this model gets wrong, and it is
   easy to see why: a dark irregular patch on tarmac is the thing it was trained
   to find. Raising the threshold does not help, because the model is as sure
   about the shadow as about the hole.

   What separates them is not darkness, it is texture. A shadow is the road with
   the light turned down — the same chippings, the same grain, scaled. A hole
   breaks the surface: a rim, broken edges, loose material. So the question is
   not "is this dark" but "is this darker AND rougher than what surrounds it".
   Roughness measured against its own brightness survives the dimming, which is
   the whole point — a shadow's matches the road's, a hole's does not.

   This is a filter, not a cure, and it cuts both ways: a hole in deep shade
   looks smooth and can be waved through as a shadow. A deliberate capture is
   therefore told what happened and left free to score it anyway. */

function roughness(data, w, h, x0, y0, x1, y1, skipBox) {
  var n = 0, sum = 0, sumsq = 0;
  x0 = Math.max(0, x0 | 0); y0 = Math.max(0, y0 | 0);
  x1 = Math.min(w, x1 | 0); y1 = Math.min(h, y1 | 0);
  for (var y = y0; y < y1; y += 2) {
    for (var x = x0; x < x1; x += 2) {
      if (skipBox && x >= skipBox[0] && x < skipBox[2] && y >= skipBox[1] && y < skipBox[3]) continue;
      var i = (y * w + x) * 4;
      var l = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      n++; sum += l; sumsq += l * l;
    }
  }
  if (n < 24) return null;
  var mean = sum / n, varr = Math.max(0, sumsq / n - mean * mean);
  return { mean: mean, sd: Math.sqrt(varr) };
}

/* How much rougher the patch is than its surroundings, each measured against
   its own brightness. About 1 means "the same surface, dimmer" — a shadow. */
function textureRatio(ctx, cw, ch, box) {
  var x0 = box.x - box.w / 2, y0 = box.y - box.h / 2;
  var x1 = x0 + box.w, y1 = y0 + box.h;
  var padX = box.w * 0.6, padY = box.h * 0.6, img;
  try { img = ctx.getImageData(0, 0, cw, ch); } catch (e) { return null; }
  /* Sample the middle of the box, not its edge. A detection box never lands
     exactly on the edge of the thing it found, so its border carries a rim of
     the surrounding road — and a rim of bright road inside a dark patch is a
     second population that inflates the spread and makes every shadow look
     broken-up. Insetting throws the boundary away and measures the surface. */
  var insetX = box.w * 0.15, insetY = box.h * 0.15;
  var inside = roughness(img.data, cw, ch, x0 + insetX, y0 + insetY, x1 - insetX, y1 - insetY, null);
  var around = roughness(img.data, cw, ch, x0 - padX, y0 - padY, x1 + padX, y1 + padY,
                         [x0 | 0, y0 | 0, x1 | 0, y1 | 0]);
  if (!inside || !around || inside.mean < 4 || around.mean < 4) return null;
  var cvIn = inside.sd / inside.mean, cvOut = around.sd / around.mean;
  if (!cvOut) return null;
  /* "Darker at all" is not a shadow — two samples of the same tarmac differ by
     a percent or two, and calling that a shadow throws away real defects. A
     shadow is substantially darker. */
  return { ratio: cvIn / cvOut, darker: inside.mean < around.mean * 0.85 };
}

/* A pothole is roughly compact. A shadow thrown across a road by a tree or a
   pole is a band, far longer than it is wide. */
function tooElongated(box) {
  var a = box.w / box.h;
  return a > ASPECT_MAX || a < 1 / ASPECT_MAX;
}

/* null when the find survives, otherwise why it was thrown out. */
function rejectReason(ctx, cw, ch, box) {
  if (tooElongated(box)) return 'a band far longer than it is wide, which is a shadow shape';
  var t = textureRatio(ctx, cw, ch, box);
  if (t && t.darker && t.ratio < TEX_MIN) {
    return 'darker than the road around it but grained exactly like it — a shadow, not a hole';
  }
  return null;
}

/* ---------- survey ---------- */
var survey = { on: false, busy: false, timer: null, logged: 0, last: null };

function metresBetween(a, b) {
  var R = 6371000, rad = Math.PI / 180;
  var dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  var la1 = a.lat * rad, la2 = b.lat * rad;
  var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
          Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/* Is this the same defect we just wrote down? Distance settles it when there is
   a fix; without one, only time can, and time alone cannot tell a second
   pothole from the first one still in shot. */
function alreadyLogged() {
  if (!survey.last) return false;
  if (S.gps && survey.last.gps) {
    return metresBetween(S.gps, survey.last.gps) < NEAR_M;
  }
  return (Date.now() - survey.last.at) < QUIET_MS;
}

function hud(state, cls) {
  $('hudState').textContent = state;
  $('hudState').className = 'hud-state' + (cls ? ' ' + cls : '');
}

function toast(msg) {
  var t = $('hudToast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(function () { t.hidden = true; }, 3200);
}

function startSurvey() {
  if (survey.on || !stream) return;
  survey.on = true; survey.logged = 0; survey.last = null;
  document.body.classList.add('surveying');
  $('hud').hidden = false; $('bSurvey').hidden = true;
  $('hudCount').textContent = '0 logged';
  hud(worker ? 'Watching' : 'Downloading the model…');
  if (!S.gps) toast('No GPS fix yet — without one the survey cannot tell a new defect from the last.');
  loadModel().then(function () {
    if (survey.on) { hud('Watching'); tick(); }
  }, function (e) {
    hud('Model unavailable', 'bad');
    toast(whyLocal(e));
  });
}

function endSurvey() {
  survey.on = false; survey.busy = false;
  clearTimeout(survey.timer); survey.timer = null;
  document.body.classList.remove('surveying');
  $('hud').hidden = true;
  $('bSurvey').hidden = !stream;
  exitFull();
  if (survey.logged) toast('');
}

function tick() {
  if (!survey.on) return;
  survey.timer = setTimeout(look, SURVEY_MS);
}

function look() {
  if (!survey.on) return;
  var v = $('vid');
  if (survey.busy || !stream || !v.videoWidth || document.hidden) return tick();
  survey.busy = true;
  createImageBitmap(v).then(function (bmp) {
    return import('./vendor/inference.es.js').then(function (m) {
      return engine.infer(worker, new m.CVImage(bmp)).then(function (preds) {
        return { preds: preds || [], w: bmp.width, h: bmp.height };
      });
    });
  }).then(function (out) {
    var hits = out.preds.filter(function (p) {
      return (p.confidence == null || p.confidence >= SURVEY_CONF) && /pothole/i.test(p.class || '');
    });
    if (!hits.length) return hud('Watching');
    var v = $('vid'), c = $('shot');
    var scale = Math.min(1, MAX_EDGE / Math.max(v.videoWidth, v.videoHeight));
    c.width = Math.round(v.videoWidth * scale); c.height = Math.round(v.videoHeight * scale);
    var ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(v, 0, 0, c.width, c.height);
    var k = c.width / out.w;
    hits = hits.filter(function (p) {
      var b = p.bbox || p;
      return !rejectReason(ctx, c.width, c.height,
        { x: b.x * k, y: b.y * k, w: b.width * k, h: b.height * k });
    });
    if (!hits.length) return hud('Shadow, not a defect');
    if (alreadyLogged()) return hud('Same defect — not logged again');
    return logFind(hits, out, c);
  }).catch(function (e) {
    hud('Look failed', 'bad');
    toast(whyLocal(e));
  }).then(function () {
    survey.busy = false; tick();
  });
}

/* Writes the entry with no one looking, which is exactly why it is marked as
   such: the log has to keep saying which scores a person stood over. */
function logFind(hits, out, c) {
  var best = hits.reduce(function (a, b) { return (b.confidence || 0) > (a.confidence || 0) ? b : a; });
  var box = best.bbox || best;
  var det = { conf: best.confidence == null ? 1 : best.confidence,
              share: (box.width * box.height) / (out.w * out.h), count: hits.length };
  var was = S.det; S.det = det;                 // proposal() reads the current find
  var p = proposal(det), n = p.imp * p.prb, cat = category(n);
  S.det = was;

  return new Promise(function (resolve) {
    c.toBlob(function (blob) {
      if (!blob) { hud('Could not save the frame', 'bad'); return resolve(); }
      var f = S.gps ? { lat: S.gps.lat, lon: S.gps.lon, acc: S.gps.acc, age: fixAge() } : null;
      var e = {
        id: nextId(), t: new Date().toISOString(), img: blob,
        imp: p.imp, prob: p.prb, score: n, cat: cat.k, resp: cat.r, key: cat.key,
        surface: S.foot ? 'Footway/cycleway' : 'Carriageway',
        scoredBy: 'survey, unconfirmed',
        detConf: det.conf, detShare: det.share, detCount: det.count,
        type: 'Pothole', note: '',
        lat: f ? f.lat : null, lon: f ? f.lon : null,
        acc: f ? Math.round(f.acc) : null, fixAge: f ? f.age : null
      };
      (dbBroken ? Promise.resolve() : putEntry(e)).then(function () {
        S.items.unshift(e);
        survey.logged++; survey.last = { at: Date.now(), gps: S.gps ? { lat: S.gps.lat, lon: S.gps.lon } : null };
        $('hudCount').textContent = survey.logged + ' logged';
        render();
        hud('Watching');
        toast('Logged — ' + cat.k + ' (' + Math.round(det.conf * 100) + '% sure). Unconfirmed.');
        resolve();
      }, function () {
        hud('Could not write it down', 'bad');
        toast('This device refused the write. Export what is in the log.');
        resolve();
      });
    }, 'image/jpeg', 0.82);
  });
}

/* ---------- full screen and landscape ---------- */
/* Both need a gesture, so neither can happen on its own — the button is that
   gesture. The viewfinder fills the screen without either, which is most of
   what is wanted; this adds the rest when the browser allows it. */
function goFull() {
  var el = document.documentElement;
  var req = el.requestFullscreen || el.webkitRequestFullscreen;
  if (!req) return toast('This browser will not give a page the whole screen.');
  req.call(el).then(function () {
    if (screen.orientation && screen.orientation.lock) {
      screen.orientation.lock('landscape').catch(function () {});
    }
  }).catch(function () { toast('The browser refused full screen.'); });
}

function exitFull() {
  if (screen.orientation && screen.orientation.unlock) {
    try { screen.orientation.unlock(); } catch (e) {}
  }
  if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(function () {});
}

$('bSurvey').addEventListener('click', startSurvey);
$('bEnd').addEventListener('click', endSurvey);
$('bFull').addEventListener('click', goFull);

/* ---------- log ---------- */
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, function (m) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m];
  });
}

function render() {
  $('cnt').textContent = S.items.length;
  var has = S.items.length > 0;
  $('empty').hidden = has; $('expRow').hidden = !has; $('bClear').hidden = !has;
  $('saveNote').hidden = !has;

  urls.forEach(URL.revokeObjectURL); urls = [];
  $('list').innerHTML = S.items.map(function (it) {
    var loc, flag = '';
    if (it.lat != null) {
      loc = it.lat.toFixed(5) + ', ' + it.lon.toFixed(5) + ' (±' + it.acc + 'm)';
      if (it.acc > POOR_ACC) flag = ' <span class="flag">coarse fix</span>';
      if (it.fixAge != null && it.fixAge > STALE_MS / 1000) {
        flag += ' <span class="flag">fix ' + it.fixAge + 's old</span>';
      }
    } else { loc = 'No GPS fix'; }
    var how = it.scoredBy ? esc(it.scoredBy) : 'inspector';
    if (it.detConf != null) {
      how += ' · model ' + Math.round(it.detConf * 100) + '% sure, ' +
             Math.round(it.detShare * 100) + '% of frame';
    }
    /* Gauged depth is real measured data. The fields that collected it are gone,
       but an entry that already carries one still shows it. */
    var dep = (it.depth != null) ? it.depth + 'mm at deepest point (gauged)' : null;
    var src = '';
    if (it.img) { src = URL.createObjectURL(it.img); urls.push(src); }
    return '<div class="item ' + it.key + '">' +
      (src ? '<button type="button" class="thumb" data-full="' + it.id + '">' +
             '<img src="' + src + '" alt="Defect photograph, tap for full size"></button>' : '') +
      '<div class="body"><div class="top"><span class="cat">' + esc(it.cat) + '</span>' +
      '<span class="sc">' + it.imp + ' × ' + it.prob + ' = ' + it.score + '</span></div>' +
      '<div class="det">' + esc(it.resp) + ' · ' + esc(it.type) + ' · ' + esc(it.surface) + '<br>' +
      (dep ? esc(dep) + '<br>' : '') + how + '<br>' + esc(loc) + flag + '<br>' +
      new Date(it.t).toLocaleString() +
      (it.note ? '<br>' + esc(it.note) : '') + '</div>' +
      '<div class="acts"><button class="del" data-id="' + it.id + '">Remove</button>' +
      '<button class="del wrong" data-id="' + it.id + '">Not a defect</button></div>' +
      '</div></div>';
  }).join('');
  quota();
}

$('list').addEventListener('click', function (e) {
  var full = e.target.closest('.thumb');
  if (full) return openFull(+full.dataset.full);

  var w = e.target.closest('.wrong');
  if (w) {
    var wid = +w.dataset.id;
    var wit = S.items.filter(function (x) { return x.id === wid; })[0];
    if (!wit) return;
    if (!confirm('Mark this as not a defect? It leaves the log and is kept as a ' +
                 'correction, so it can be used to teach the model.')) return;
    S.items = S.items.filter(function (x) { return x.id !== wid; });
    wit.markedWrongAt = new Date().toISOString();
    var done = dbBroken ? Promise.resolve()
      : putWrong(wit).then(function () { return delEntry(wid); });
    return done.then(render, render);
  }

  var b = e.target.closest('.del'); if (!b) return;
  var id = +b.dataset.id;
  var it = S.items.filter(function (x) { return x.id === id; })[0];
  if (!confirm('Remove this ' + (it ? it.cat.toLowerCase() : 'entry') + ' and its photograph? ' +
               'This cannot be undone.')) return;
  S.items = S.items.filter(function (x) { return x.id !== id; });
  (dbBroken ? Promise.resolve() : delEntry(id)).then(render, render);
});

$('bClear').addEventListener('click', function () {
  if (!confirm('Remove all ' + S.items.length + ' entries? This cannot be undone.')) return;
  S.items = [];
  (dbBroken ? Promise.resolve() : clearEntries()).then(render, render);
});

/* ---------- full-size photo ---------- */
function openFull(id) {
  var it = S.items.filter(function (x) { return x.id === id; })[0];
  if (!it || !it.img) return;
  if (lbUrl) URL.revokeObjectURL(lbUrl);
  lbUrl = URL.createObjectURL(it.img);
  $('lbImg').src = lbUrl; $('lb').hidden = false;
}
function closeFull() {
  $('lb').hidden = true; $('lbImg').removeAttribute('src');
  if (lbUrl) { URL.revokeObjectURL(lbUrl); lbUrl = null; }
}
$('lbClose').addEventListener('click', closeFull);
$('lb').addEventListener('click', function (e) { if (e.target === $('lb')) closeFull(); });
document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !$('lb').hidden) closeFull(); });

/* ---------- how much room is left ---------- */
function quota() {
  var el = $('quota'); if (!el) return;
  if (dbBroken) {
    el.innerHTML = ' <b>This device would not open a database, so entries are held in memory only ' +
      'and will be gone when the tab closes. Export before you finish.</b>';
    return;
  }
  allWrong().then(function (w) {
    var n = $('wrongCount');
    if (!n) return;
    n.hidden = !w.length;
    n.innerHTML = '<b>' + w.length + ' correction' + (w.length === 1 ? '' : 's') + ' kept.</b> ' +
      'Things you marked as not a defect. They are in the JSON export, which is what a ' +
      'retrain would be fed — the app cannot teach the model on its own.';
  });
  if (!navigator.storage || !navigator.storage.estimate) { el.textContent = ''; return; }
  navigator.storage.estimate().then(function (q) {
    if (!q || !q.quota) { el.textContent = ''; return; }
    var mb = function (n) { return (n / 1048576).toFixed(n < 104857600 ? 1 : 0) + ' MB'; };
    el.textContent = ' Using ' + mb(q.usage || 0) + ' of about ' + mb(q.quota) + ' available.';
  }).catch(function () { el.textContent = ''; });
}

/* ---------- export ---------- */
function dl(name, blob) {
  var u = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = u; a.download = name; a.click();
  setTimeout(function () { URL.revokeObjectURL(u); }, 2000);
}
function q(v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; }
function stamp() { return new Date().toISOString().slice(0, 10); }

$('bCsv').addEventListener('click', function () {
  /* Depth and width are no longer collected, but an export that silently
     dropped them would lose measurements taken before they went. The columns
     appear only while some entry still has one. */
  var old = S.items.some(function (i) { return i.depth != null || i.wide != null; });
  var head = ['timestamp', 'latitude', 'longitude', 'gps_accuracy_m', 'gps_fix_age_s',
    'defect_type', 'surface', 'impact', 'probability', 'risk_factor', 'category', 'response_time',
    'scored_by', 'model_confidence', 'model_share_of_frame', 'model_detections']
    .concat(old ? ['depth_mm_deepest', 'wider_than_tyre'] : []).concat(['notes']);
  var rows = S.items.map(function (i) {
    return [i.t, i.lat, i.lon, i.acc, i.fixAge, i.type, i.surface,
      i.imp, i.prob, i.score, i.cat, i.resp,
      i.scoredBy || 'inspector', i.detConf, i.detShare, i.detCount]
      .concat(old ? [i.depth, i.wide === null || i.wide === undefined ? '' : (i.wide ? 'yes' : 'no')] : [])
      .concat([i.note]).map(q).join(',');
  });
  /* The BOM is what stops Excel turning a road name with an accent in it into
     mojibake when the file is double-clicked. */
  dl('defects-' + stamp() + '.csv',
     new Blob(['﻿' + head.join(',') + '\r\n' + rows.join('\r\n')], { type: 'text/csv' }));
});

$('bJson').addEventListener('click', function () {
  var btn = this; btn.disabled = true;
  Promise.all(S.items.map(function (it) {
    var out = {};
    for (var k in it) if (k !== 'img') out[k] = it[k];
    if (!it.img) { out.img = null; return Promise.resolve(out); }
    return new Promise(function (resolve) {
      var fr = new FileReader();
      fr.onload = function () { out.img = fr.result; resolve(out); };
      fr.onerror = function () { out.img = null; resolve(out); };
      fr.readAsDataURL(it.img);      // photographs travel as data URLs, as before
    });
  })).then(function (rows) {
    return allWrong().then(function (wrong) {
      return Promise.all(wrong.map(function (it) {
        var out = {};
        for (var k in it) if (k !== 'img') out[k] = it[k];
        if (!it.img) { out.img = null; return Promise.resolve(out); }
        return new Promise(function (resolve) {
          var fr = new FileReader();
          fr.onload = function () { out.img = fr.result; resolve(out); };
          fr.onerror = function () { out.img = null; resolve(out); };
          fr.readAsDataURL(it.img);
        });
      })).then(function (wrongRows) {
        dl('defects-' + stamp() + '.json', new Blob([JSON.stringify({
          defects: rows,
          notDefects: wrongRows       // the examples a retrain would need
        }, null, 2)], { type: 'application/json' }));
      });
    });
  }).then(function () { btn.disabled = false; }, function () { btn.disabled = false; });
});

/* ---------- tabs ---------- */
function show(which) {
  $('p-cap').hidden = (which !== 'cap'); $('p-score').hidden = (which !== 'score');
  $('p-log').hidden = (which !== 'log');
  $('t-cap').setAttribute('aria-selected', which === 'cap');
  $('t-log').setAttribute('aria-selected', which === 'log');
  window.scrollTo(0, 0);
}

/* Leaving the scoring step throws the photograph away, so it asks first —
   in the prototype the tab simply took it with it. */
function leaveScore() {
  if (!S.shot) return true;
  if (!confirm('Discard this capture? It has not been saved to the log.')) return false;
  S.shot = null; S.shotFix = null;
  if (S.prevUrl) { URL.revokeObjectURL(S.prevUrl); S.prevUrl = null; }
  return true;
}
$('t-cap').addEventListener('click', function () { if (leaveScore()) show('cap'); });
$('t-log').addEventListener('click', function () { if (leaveScore()) show('log'); });

/* The camera light staying on after the phone goes in a pocket is both a
   battery drain and a thing people reasonably object to. */
/* A page cannot hold the camera once it is not the app on screen — the browser
   suspends it — so a survey ends rather than pretending to still be watching. */
document.addEventListener('visibilitychange', function () {
  if (document.visibilityState === 'hidden' && stream) stopAll();
});
window.addEventListener('pagehide', stopAll);

/* ---------- go ---------- */
$('build').textContent = BUILD;
buildMatrix(); verdict();

openDb().then(function (d) {
  db = d;
  return migrateLegacy().then(allEntries);
}).catch(function () {
  dbBroken = true;
  return [];
}).then(function (rows) {
  S.items = rows || [];
  render();
  var open = new URLSearchParams(location.search).get('open');
  if (open === 'log') show('log');
  else openCamera(false);     // the camera is the point; do not make them ask
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  });
}
