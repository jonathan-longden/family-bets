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
var BUILD = '2026-08-28 · 33';

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
/* Two classes, 17,497 images, yolov8s. The previous model knew only "pothole",
   so an inspection cover came back as a pothole and there was nothing the app
   could do about it but let you correct the entry afterwards. This one tells
   them apart, which is the difference between a log you have to fix and a log
   you have to check. */
/* Two ways to name a model, and they are not equivalent. A project slug and a
   version number ask for "whatever is deployed on that version", and a version
   can carry more than one — so the library can be handed a model whose head it
   is not decoding, which is what returns twenty boxless results with scores of
   1.004. A model id names one model exactly. The library's own documentation
   calls the first legacy and the second the way to do it, so a model id is used
   when there is one and the old call is the fallback. */
/* yolov8, not yolo11, and the reason is the library rather than the model.

   Its decoders are one class per architecture, and YOLOv11 is a subclass of
   YOLOv8 that overrides only the input side: YOLOv8 hands the model
   [1,3,640,640], YOLOv11 hands it [1,640,640,3]. It inherits YOLOv8's output
   handling untouched, and that handling transposes the result assuming the
   channels-first output that goes with a channels-first input. Given a
   channels-last one it reads 6 boxes and 8,396 classes where there are 8,400
   boxes and 2 classes, so the "confidence" it reports is really a pixel
   coordinate — which is why they came back in the hundreds while the boxes
   still looked plausible, and how a living room was logged as a Category 2 on a
   28-day clock.

   The version still carries the yolo11n model, so this has to name the yolov8n
   one exactly rather than ask for whatever is deployed. decode.mjs in the test
   suite holds the library's own arithmetic over both layouts. */
var RF_MODEL_ID = 'jonathan-longden-s-workspace/pothole-fine-tuning-ghl9u-54ssb-1-yolov8n-t3';
var RF_MODEL = 'pothole-fine-tuning-ghl9u-54ssb';   // only the fallback path uses these
var RF_VERSION = 1;

/* What the model's own words mean in the log.

   The important thing about the second class is that it is not a defect. The
   model finds ironwork, not broken ironwork — and a sound cover is simply part
   of the road. Its value here is negative: knowing a dark round thing is a
   cover is what stops it being written down as a hole. A survey that logged
   every manhole it drove over would bury the finds that matter, so ironwork is
   recognised and passed over. Whether a cover is sunken, proud, rocking or
   cracked is a thing a person decides on site, not something a photograph
   carries. */
var CLASS_TYPE = { pothole: 'Pothole', manhole: 'Ironwork' };
function typeFor(cls) { return CLASS_TYPE[String(cls || '').toLowerCase()] || 'Other'; }
function known(cls) { return CLASS_TYPE.hasOwnProperty(String(cls || '').toLowerCase()); }
var RF_KEY = 'rf_pxctFcweYjTPKQwCJgjKpHcWSpz1';
var RF_CONF = 0.40;     // below this the model is guessing
var RF_SIZE = 640;      // what the model was trained on, and what it is given

/* The model was trained on 640 by 640, stretched — so that is what it is handed,
   rather than whatever shape the camera produces. Two reasons, and the first
   would be enough on its own: a model fed the shape it was trained on is a
   model asked a question it understands.

   The second is what a phone-shaped frame did to the boxes coming back. On a
   1920 by 1080 frame, a returned box measured 3145 by 5234 — bigger than the
   picture, and wrong by different factors on each axis, 1.6 across and 4.8
   down. A single wrong scale would be wrong by the same factor both ways; two
   different factors means width and height are being scaled by each other's
   axis, which is invisible while the input is square and ruinous the moment it
   is not. Square input, symmetric scaling, boxes that mean something.

   It also makes everything downstream agree: the boxes, the shadow test and the
   share of the frame are all in this one 640 by 640 space. */
function squareFrame(source, w, h) {
  var c = document.createElement('canvas');
  c.width = RF_SIZE; c.height = RF_SIZE;
  var ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, 0, 0, w, h, 0, 0, RF_SIZE, RF_SIZE);
  return { canvas: c, ctx: ctx };
}

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

var TYPES = ['Pothole', 'Edge deterioration', 'Spalled crack / material loss',
             'Ironwork', 'Street furniture', 'Other'];

var S = { imp: 0, prob: 0, foot: false, by: null,
          prevUrl: null, gps: null, det: null, tag: '', items: [] };
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

/* ---------- statutory category, and who is allowed to assign one ----------

   These words — Emergency, Category 1, two hours, 28 calendar days — are the
   response categories a highway authority works to, and in practice they are
   keyed on the depth and plan dimensions of the defect. This app measures
   neither. It measures how much of a 640-pixel square the thing filled, which
   is a function of how far away the camera was at least as much as of how big
   the hole is.

   So this function still exists, and it is still what the risk matrix reads —
   but it is reachable only from the confirm screen, where a person is looking
   at the photograph and choosing the cell. Nothing the survey writes on its own
   goes anywhere near it. What the survey writes is a priority, below. */
function category(n) {
  if (n >= 25) return { k: 'Emergency', r: '2 hours', c: 'c-em', key: 'kem' };
  if (n >= 16) return { k: 'Category 1', r: '1 working day', c: 'c-1', key: 'k1' };
  if (n >= 9)  return { k: 'Category 2', r: '28 calendar days', c: 'c-2', key: 'k2' };
  if (n >= 6)  return { k: 'Category 3', r: '90 calendar days', c: 'c-3', key: 'k3' };
  return { k: 'Below threshold', r: 'No response category', c: '', key: 'k0' };
}

/* ---------- what the app is allowed to say on its own ----------

   An internal ordering, and nothing more. P1 is "of the things this survey
   found, look at this one first"; P4 is "look at it last". There is no time
   attached to any of them, because attaching one would be inventing a legal
   obligation out of a box on a screen.

   The thresholds are the app's own — they are the same numbers the risk matrix
   is coloured by, reused so that a survey find and a scored find sort the same
   way. They are not taken from any standard and they carry no legal meaning.
   If they are wrong they are wrong about the order of a work list, which is a
   thing you can look at and disagree with, rather than about a duty. */
var PRIORITY = [
  { min: 16, p: 'P1', word: 'Look at first', key: 'p1' },
  { min: 9,  p: 'P2', word: 'Look at soon',  key: 'p2' },
  { min: 6,  p: 'P3', word: 'Look at later', key: 'p3' },
  { min: 0,  p: 'P4', word: 'Lowest',        key: 'p4' }
];

function priorityFor(n) {
  if (typeof n !== 'number' || !isFinite(n) || n <= 0) return null;
  for (var i = 0; i < PRIORITY.length; i++) if (n >= PRIORITY[i].min) return PRIORITY[i];
  return PRIORITY[PRIORITY.length - 1];
}

/* Entries written before priorities existed carry a score and a statutory
   category the survey chose for itself. The score is still a score, so the
   priority is worked out from it here rather than by rewriting the row — and
   the category it came with is dealt with by statutoryOf() below. */
function priorityOf(it) {
  if (!it) return null;
  if (it.priority) {
    for (var i = 0; i < PRIORITY.length; i++) if (PRIORITY[i].p === it.priority) return PRIORITY[i];
  }
  return priorityFor(it.score);
}

/* Returns the statutory category on an entry only if a person put it there.

   This is the guard that makes old data safe. Rows logged by earlier builds
   carry cat and resp filled in by the survey itself, unread by anybody — the
   fields are kept, because deleting them would lose what the app said at the
   time, but they are not a classification and they must not be shown or
   exported as one. A category counts when catBy names who assigned it, or —
   for rows from before that field existed — when the entry was confirmed by
   someone on the confirm screen. */
function statutoryOf(it) {
  if (!it) return null;
  if (it.catBy) {
    return { cat: it.statCat, resp: it.statResp, by: it.catBy, at: it.catAt || null };
  }
  var unconfirmed = /unconfirmed/i.test(it.scoredBy || '');
  if (!unconfirmed && it.confirmedAt && it.cat) {
    return { cat: it.cat, resp: it.resp, by: it.scoredBy || 'inspector', at: it.confirmedAt };
  }
  return null;
}

/* The colour down the side of a log entry and on a map pin: the statutory
   category when there is a real one, the internal priority otherwise. */
function markKey(it) {
  var s = statutoryOf(it);
  if (s && it.key && /^k/.test(it.key)) return it.key;
  var p = priorityOf(it);
  return p ? p.key : 'p4';
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
    /* The verdict panel is the one place in the app that shows a statutory
       category, and it is showing what will be written down if the Confirm
       button is pressed. Until it is, this is a proposal on a screen and not a
       classification, and it says so rather than leaving it to be assumed. */
    by.textContent = S.by === 'app'
      ? 'Proposed by the app — tap any cell to overrule. Nothing is classified until you confirm.'
      : 'Your score — written down as a category when you confirm.';
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
seg($('segCar'), $('segFoot'), function (isCar) { S.foot = !isCar; propose(); paintSurface(); });
seg($('segSurvCar'), $('segSurvFoot'), function (isCar) { S.foot = !isCar; paintSurface(); });

/* The surface was only ever settable on the scoring screen, so a survey — which
   never goes near it — recorded every find as carriageway whatever it was
   walking down. It is one setting shared by both, shown wherever it applies. */
function paintSurface() {
  var foot = S.foot;
  $('hudSurface').textContent = foot ? 'Footway' : 'Carriageway';
  $('segCar').setAttribute('aria-pressed', String(!foot));
  $('segFoot').setAttribute('aria-pressed', String(foot));
  $('segSurvCar').setAttribute('aria-pressed', String(!foot));
  $('segSurvFoot').setAttribute('aria-pressed', String(foot));
}

$('hudSurface').addEventListener('click', function () {
  S.foot = !S.foot; paintSurface();
  toast('Now recording finds as ' + (S.foot ? 'footway' : 'carriageway') + '.');
});

/* ---------- camera ----------

   The app opens looking at the road. There is no start screen to get past,
   because a screen you have to dismiss before you can see anything is a screen
   in the way. Browsers do not all allow a camera without a tap, so when one
   refuses, the gate comes up over the picture with the reason on it and the
   tap it wants — and that same tap is what lets the next attempt succeed. */
$('bStart').addEventListener('click', function () { openCamera(true); });

async function openCamera(byTap) {
  if (stream) return;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    return note('This browser will not give a page camera access.', true);
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
    $('vid').srcObject = stream;
    $('badge').textContent = 'Live';
    $('camGate').hidden = true;
    $('rec').hidden = false;
    $('bRec').disabled = false;
    $('recHint').textContent = 'Tap to record';
    paintSurface();
    paintRec();          // the strip has to hear about the camera too
    paintSpace();
    startGps();
  } catch (e) {
    /* Opening without being asked is allowed to fail quietly: some browsers
       only hand over a camera off a tap, and the gate is sitting there with the
       button on it. A refusal of a tap is worth saying out loud. */
    if (byTap) {
      note('Camera did not open: ' + e.name + '. If this is not an https address, that is why.', true);
    } else {
      primer();
    }
  }
}
$('bStop').addEventListener('click', function () { closeMenu(); stopAll(); });

function stopAll() {
  if (survey.on) endSurvey();
  if (stream) { stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; }
  if (watchId != null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
  if (ageTimer) { clearInterval(ageTimer); ageTimer = null; }
  /* The last fix goes with the camera. Keeping it means the next find — which
     could be a mile down the road — gets tagged with where you were standing
     when you last stopped. */
  S.gps = null;
  $('badge').textContent = 'Camera off';
  $('rec').hidden = true;
  $('bRec').disabled = true;
  $('camGate').hidden = false;
  paintRec();
  primer();
}

/* The card on the gate is pre-flight advice — how to get the camera and the
   location open. It is only ever seen when there is no picture, so it costs
   nothing once there is one. Problems reclaim the same space. */
var PRIMER = $('camNote').innerHTML;

function note(msg, isErr) {
  var n = $('camNote');
  n.innerHTML = '<b>' + (isErr ? 'Problem.' : 'Note.') + '</b> ' + msg;
  n.classList.toggle('err', !!isErr);
  $('camGate').hidden = false;
}

function primer() {
  var n = $('camNote');
  n.innerHTML = PRIMER; n.classList.remove('err');
}
/* ---------- gps ---------- */
function fixAge() { return S.gps ? Math.round((Date.now() - S.gps.at) / 1000) : null; }

function gauge(id, text, q) {
  var g = $(id);
  if (!g) return;
  g.setAttribute('data-q', q);
  var b = g.querySelector('b');
  if (b && text != null) b.textContent = text;
}

function paintFix() {
  var age = fixAge();
  if (!S.gps) { $('mAge').textContent = '—'; return; }
  $('mAge').textContent = age + ' s';
  $('mAge').className = age > STALE_MS / 1000 ? 'warn' : '';
  /* A stale fix is worse than a wide one: a wide fix is honestly vague about
     where you are now, a stale one is confident about where you were. */
  var stale = age > STALE_MS / 1000;
  var q = stale ? 'poor' : (S.gps.acc > POOR_ACC ? 'fair' : 'good');
  gauge('rec', stale ? age + 's old' : '±' + Math.round(S.gps.acc) + ' m', q);
  $('recTxt').textContent = stale ? age + 's old' : '±' + Math.round(S.gps.acc) + ' m';
}

/* How much room is left, in the only unit that means anything here: how many
   more photographs will fit. Roughly 180 kB each at the size they are saved. */
function paintSpace() {
  if (!navigator.storage || !navigator.storage.estimate) return;
  navigator.storage.estimate().then(function (e) {
    if (!e || !e.quota) return;
    var free = Math.max(0, e.quota - (e.usage || 0));
    var shots = Math.round(free / 180000);
    var q = shots < 100 ? 'none' : shots < 500 ? 'poor' : shots < 2000 ? 'fair' : 'good';
    gauge('gSpace', shots >= 1000 ? Math.round(shots / 1000) + 'k finds' : shots + ' finds', q);
  }).catch(function () {});
}

function startGps() {
  if (!navigator.geolocation) { $('recTxt').textContent = 'No GPS'; gauge('rec', 'No GPS', 'none'); return; }
  $('gpsBox').hidden = false;
  watchId = navigator.geolocation.watchPosition(function (p) {
    S.gps = { lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy, at: Date.now() };
    $('mLat').textContent = S.gps.lat.toFixed(6);
    $('mLon').textContent = S.gps.lon.toFixed(6);
    $('mAcc').textContent = '±' + Math.round(S.gps.acc) + ' m';
    $('mAcc').className = S.gps.acc > POOR_ACC ? 'warn' : '';
    paintFix();
  }, function () {
    $('recTxt').textContent = 'GPS denied'; gauge('rec', 'GPS denied', 'none'); S.gps = null;
    $('gpsBox').hidden = true;
    toast('Location was refused, so finds will be logged with no coordinates — they cannot go ' +
          'on the map or into GeoJSON. Allow it for this site, then stop and start the camera.');
  }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 });
  ageTimer = setInterval(paintFix, 2000);
}

/* ---------- confirming a find ----------

   Nothing here takes a photograph any more: the survey does that when it finds
   something, and this is where a person stands over what it wrote down and
   either signs it off or corrects it. That distinction is the whole point of
   the log — an unconfirmed entry is a machine's opinion, and the export marks
   it as one so nothing starts a statutory clock on a guess. */
var confirming = null;

function openConfirm(id) {
  var it = S.items.filter(function (x) { return x.id === id; })[0];
  if (!it) return;
  confirming = it;

  if (S.prevUrl) { URL.revokeObjectURL(S.prevUrl); S.prevUrl = null; }
  var img = $('prev');
  if (it.img) { S.prevUrl = URL.createObjectURL(it.img); img.src = S.prevUrl; img.hidden = false; }
  else { img.removeAttribute('src'); img.hidden = true; }

  S.foot = it.surface === 'Footway/cycleway';
  paintSurface();
  $('fType').value = it.type || 'Other';
  $('fNote').value = it.note || '';

  clearMatrix();
  if (it.imp && it.prob) { selectCell(it.imp, it.prob); S.by = /unconfirmed/i.test(it.scoredBy || '') ? 'app' : 'you'; }
  else { S.imp = 0; S.prob = 0; S.by = null; }
  verdict();

  /* What the model made of it is shown as it was recorded, not recomputed: the
     frame it saw is gone, and re-running the numbers on a stored share would
     dress an old reading up as a fresh one. */
  S.det = (it.detShare != null || it.detConf != null)
    ? { conf: it.detConf, share: it.detShare, count: it.detCount || 1, cls: it.type }
    : null;
  if (S.det) {
    var pr = priorityOf(it);
    scanSay('<b>' + (it.detConf == null || it.detConf < 0 || it.detConf > 1
        ? 'The survey logged this without saying how sure it was.'
        : Math.round(it.detConf * 100) + '% sure when the survey logged it.') + '</b> ' +
      (it.detShare != null ? 'It filled ' + Math.round(it.detShare * 100) + '% of the frame, ' +
        'which is what the ' + it.imp + ' × ' + it.prob + ' = ' + it.score + ' and the ' +
        (pr ? pr.p : 'priority') + ' the survey gave it were worked out from. ' : '') +
      '<span class="caveat">A photograph has no scale in it. The share of the frame assumes the ' +
      'camera was pointed down at the road, and the box drawn round the hole is generous. It says ' +
      'nothing about depth, traffic or footfall — that part is yours. The survey has given this a ' +
      'priority and nothing else; the category and the response time below become part of the ' +
      'record when you confirm, and not before.</span>', 'hit');
  } else {
    scanSay('<b>No model reading was kept for this entry.</b> Score it on the matrix yourself.', 'none');
  }

  paintFixNote();
  show('score');
}

/* Say what is written down about the location, so a coarse or stale fix is
   read before it is signed off rather than discovered in the office. */
function paintFixNote() {
  var n = $('fixNote'), it = confirming;
  n.hidden = false; n.className = 'fixnote';
  if (!it || it.lat == null) {
    n.innerHTML = '<b>No coordinates.</b> There was no fix when this was logged — the entry has ' +
      'no location and will not go on a map or into GeoJSON. Put the road name in the notes.';
    return;
  }
  var bits = [];
  if (it.acc > POOR_ACC) bits.push('the fix is only good to ±' + it.acc + ' m');
  if (it.fixAge != null && it.fixAge > STALE_MS / 1000) {
    bits.push('it was ' + it.fixAge + ' seconds old when the find was logged');
  }
  if (!bits.length) n.className = 'fixnote ok';
  n.innerHTML = '<b>Location.</b> ' + it.lat.toFixed(5) + ', ' + it.lon.toFixed(5) +
    ' at ±' + it.acc + ' m' +
    (bits.length ? ' — ' + bits.join(', ') + '. It stands as it is, and stays flagged in the log.'
                 : '. Kept with the entry.');
}

$('bDiscard').addEventListener('click', function () { confirming = null; show('log'); });

$('bSave').addEventListener('click', function () {
  var it = confirming;
  if (!it) return show('log');
  if (!S.imp || !S.prob) { alert('Score it on the matrix first.'); return; }
  var n = S.imp * S.prob, c = category(n), pri = priorityFor(n);
  it.imp = S.imp; it.prob = S.prob; it.score = n;
  /* This is the one place a statutory category is created, and it is created
     because a person sat with the photograph and chose a cell. It is written
     with their name on it — catBy is what statutoryOf() looks for, and an entry
     without it has no classification however full its other fields are. cat and
     resp are set alongside it so that anything reading the old field names sees
     the same thing rather than a stale one. */
  it.statCat = c.k; it.statResp = c.r;
  it.catBy = S.by === 'app' ? 'app proposal, accepted by a person' : 'inspector';
  it.catAt = new Date().toISOString();
  it.cat = c.k; it.resp = c.r; it.key = c.key;
  if (pri) { it.priority = pri.p; it.priorityWord = pri.word; }
  it.surface = S.foot ? 'Footway/cycleway' : 'Carriageway';
  it.type = $('fType').value;
  it.note = $('fNote').value.trim();
  /* Accepting the proposal unchanged is still a person's decision, and is
     recorded as one — but as an accepted proposal, not as an independent
     judgement, because those are different things. */
  it.scoredBy = S.by === 'app' ? 'app proposal, accepted' : 'inspector';
  it.confirmedAt = it.catAt;

  (dbBroken ? Promise.resolve() : putEntry(it)).then(function () {
    confirming = null;
    render(); show('log');
  }, function (err) {
    alert('That correction could not be written to this device\'s storage (' +
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

/* Returns null for anything that is not a real fraction of the frame.

   This used to end with "return the last band" — the largest one — and every
   comparison against NaN is false, so a share the app had failed to compute
   fell straight through to "very large", scored 5 by 4, gained a point for
   being one of several, and was written into the log as an Emergency needing
   attention in two hours. A whole survey came back that way, including a
   photograph of the inside of a van. Not knowing has to mean not knowing. */
function bandFor(share) {
  if (typeof share !== 'number' || !isFinite(share) || share <= 0 || share > 1) return null;
  for (var i = 0; i < BANDS.length; i++) if (share < BANDS[i].max) return BANDS[i];
  return BANDS[BANDS.length - 1];
}

function proposal(det) {
  var b = bandFor(det && det.share);
  if (!b) return null;                       // no share, no score
  var imp = b.imp, prb = b.prb, why = [];
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
  var d = S.det, p = proposal(d);
  if (!p) {
    return scanSay('<b>Found something, but could not measure it.</b> Without its size on the ' +
                   'frame there is no honest score to propose — score it on the matrix ' +
                   'yourself.', 'none');
  }
  var n = p.imp * p.prb, c = category(n);
  selectCell(p.imp, p.prb);
  S.by = 'app';
  verdict();
  var what = d.cls ? typeFor(d.cls).toLowerCase() : 'a defect';
  var noun = what === 'ironwork' ? 'ironwork' : 'a pothole';
  scanSay('<b>' + (d.conf == null ? 'That looks like ' + noun + '.'
                                  : Math.round(d.conf * 100) + '% sure that is ' + noun + '.') + '</b> ' +
          p.why.join(', ') + '. Proposed ' + p.imp + ' × ' + p.prb + ' = ' + n +
          ', ' + c.k + '.<br><span class="caveat">A photograph has no scale in it: this ' +
          'assumes you are standing over the defect with the phone pointed down, and it is ' +
          'measured from a box drawn round the hole, which is generous. It says nothing about ' +
          'depth, traffic or footfall. Check the cell before saving.</span>', 'hit');
}

/* The model's confidence is shown only when it is one. */
function sureness(conf) {
  return conf == null ? 'How sure it is was not reported. '
                      : Math.round(conf * 100) + '% sure. ';
}

function scanSay(html, cls) {
  var n = $('scan'); n.hidden = false; n.className = 'scan' + (cls ? ' ' + cls : '');
  n.innerHTML = html;
}

/* The engine and the model are loaded once and kept. It is fetched as soon as
   the app opens rather than on the first record tap: it is the slow part, and
   waiting until someone is parked at the top of a road to start a several-
   megabyte download is the wrong moment. Failing is not fatal — the chip says
   so and a later run tries again. */
var engine = null, worker = null, loading = null;

/* Says where the model is up to, since it is now happening before anyone asks
   for it and an invisible download is indistinguishable from a broken one. */
/* It is a gauge now rather than a chip that comes and goes, so "nothing to
   say" is a state it shows rather than an absence. An empty model readout and
   a working one looked identical, which is the wrong way round. */
var MODEL_Q = { ready: 'good', bad: 'none', poor: 'fair' };
function modelChip(text, cls) {
  gauge('gModel', text || 'Ready', MODEL_Q[cls] || (text ? 'idle' : 'good'));
}

function prefetchModel() {
  if (loading || worker) return;
  if (!navigator.onLine) return modelChip('Offline', 'poor');
  modelChip('Loading');
  loadModel().then(function () {
    modelChip('Ready', 'ready');
    runSelfTest().then(function (t) {
      if (t && t.state === 'ran' && (t.allInRange === false || layoutsBothBad(t.diag))) {
        modelChip('Nonsense', 'bad');
        return;
      }
      /* Worth saying once: the picture is going in the other way round from the
         way the library assumes, because that is the only way this graph
         answers. It is working, and it is not working as shipped. */
      if (layoutOverridden(t && t.diag)) return modelChip('Layout fixed', 'ready');
      if (precisionForced(t && t.diag)) return modelChip('Precision forced', 'ready');
      modelChip('Ready', 'ready');
    });
  }, function (e) {
    modelChip('No model', 'bad');
  });
}
window.addEventListener('online', prefetchModel);

function loadModel() {
  if (loading) return loading;
  loading = import('./vendor/inference.es.js').then(function (m) {
    engine = new m.InferenceEngine();
    var start = (RF_MODEL_ID && engine.startWorkerByModelId)
      ? engine.startWorkerByModelId(RF_MODEL_ID, RF_KEY)
      : engine.startWorker(RF_MODEL, RF_VERSION, RF_KEY);
    return start.then(function (id) {
      worker = id;
      return m;
    });
  }).catch(function (e) {
    loading = null;   // a failure must not poison every later capture
    throw e;
  });
  return loading;
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


/* Describes what actually came back, in a line short enough to read off a
   phone. Refusing to act on nonsense keeps the log honest but says nothing
   about why, and guessing the cause costs a deploy and a drive each time. The
   shape the library builds is fixed — class, confidence, bbox — so when the
   numbers inside it are wrong it is the model's output layout that does not
   match what the library expects, and the ranges here are what say which. */
function describeRaw(raw) {
  if (!raw || !raw.length) return 'nothing at all';
  var n = raw.length, first = raw[0] || {};
  var keys = Object.keys(first).join(', ') || 'no keys';
  var box = first.bbox;
  var lo = Infinity, hi = -Infinity, withBox = 0;
  raw.forEach(function (p) {
    var c = +(p && p.confidence);
    if (isFinite(c)) { lo = Math.min(lo, c); hi = Math.max(hi, c); }
    if (p && p.bbox && isFinite(+p.bbox.width)) withBox++;
  });
  var conf = isFinite(lo) ? (lo === hi ? String(round4(lo)) : round4(lo) + ' to ' + round4(hi))
                          : 'none reported';
  return n + ' result' + (n === 1 ? '' : 's') + '; keys [' + keys + ']; confidence ' + conf +
         '; ' + withBox + ' with a measurable box' +
         (box ? '; first box ' + round4(box.width) + '×' + round4(box.height) +
                ' at ' + round4(box.x) + ',' + round4(box.y) : '; first has no box');
}
function round4(v) {
  var n = +v;
  if (!isFinite(n)) return String(v);
  return Math.abs(n) >= 1000 ? Math.round(n) : Math.round(n * 10000) / 10000;
}

/* Kept so the next export carries it, rather than needing another drive. */
/* ---------- asking Roboflow what this model actually is ----------

   Every fix to the decoding so far has been a guess checked against a
   screenshot, because the one fact that settles it — which decoder the library
   picks — is decided inside a worker we cannot see into. It does not have to
   be invisible. The library chooses that decoder from one field in the model
   metadata, and the metadata is a plain GET; so the app fetches the same
   document and says what the library will have made of it.

   The dispatch below is a copy of the library's, read out of its own bundle.
   Copying it is not ideal, but the alternative is guessing, and a copy that
   goes stale says the wrong model type rather than silently scoring a living
   room as a Category 2. Note there is no `yolo11` case without the `v`: a
   model whose type is spelled that way is refused outright, and it is worth
   being able to see that rather than infer it. */
/* Roboflow does not hand back a link to a model file — it hands back the
   model.json itself, topology and weights manifest inline, which is why this
   printed "[object Object]" the first time it was asked for. What is wanted out
   of it is not the topology: it is whether the weights were stored quantised,
   and where the shards actually live. A quantised export whose dequantisation
   does not survive the trip is one of the few things that produces a graph
   which answers every picture the same way. */
function describeWeights(mo) {
  if (!mo) return 'not reported';
  if (typeof mo === 'string') return mo;
  var L = ['inline model.json — keys: ' + Object.keys(mo).join(', ')];
  var wm = mo.weightsManifest;
  if (Array.isArray(wm)) {
    var paths = [], tensors = 0, quant = {}, dtypes = {};
    wm.forEach(function (g) {
      (g.paths || []).forEach(function (p) { paths.push(p); });
      (g.weights || []).forEach(function (w) {
        tensors++;
        dtypes[w.dtype || '?'] = (dtypes[w.dtype || '?'] || 0) + 1;
        if (w.quantization) {
          var k = w.quantization.dtype || 'unknown';
          quant[k] = (quant[k] || 0) + 1;
        }
      });
    });
    var qk = Object.keys(quant);
    L.push('groups     ' + wm.length + ', tensors ' + tensors);
    L.push('dtypes     ' + Object.keys(dtypes).map(function (k) {
      return dtypes[k] + ' × ' + k; }).join(', '));
    L.push('quantised  ' + (qk.length
      ? qk.map(function (k) { return quant[k] + ' as ' + k; }).join(', ')
      : 'no'));
    L.push('shards     ' + paths.length);
    paths.slice(0, 2).forEach(function (p, i) { L.push('path ' + i + '     ' + p); });
  } else {
    L.push('no weightsManifest');
  }
  var mt = mo.modelTopology;
  if (mt && mt.node) L.push('nodes      ' + mt.node.length);
  else if (mt && mt.modelTopology && mt.modelTopology.node) L.push('nodes      ' + mt.modelTopology.node.length);
  else if (mt) L.push('topology   keys: ' + Object.keys(mt).join(', '));
  if (mo.format) L.push('format     ' + mo.format);
  if (mo.generatedBy) L.push('generated  ' + mo.generatedBy);
  if (mo.convertedBy) L.push('converted  ' + mo.convertedBy);
  return L.join('\n           ');
}

function decoderFor(t) {
  t = String(t || '');
  if (!t) return 'unknown — no model type reported';
  if (t.indexOf('yolov8') === 0) return 'YOLOv8';
  if (t.indexOf('yolov5') === 0) return 'YOLOv5';
  if (t.indexOf('rfdetr') === 0) return 'RFDetr';
  if (t.indexOf('yolov11') === 0) return 'YOLOv11';
  if (t.indexOf('yolov26') === 0 || t.indexOf('yolo26') === 0) return 'YOLO26';
  if (t.indexOf('yololite') === 0) return 'YOLOLite';
  return 'none — the library refuses this type';
}

var rfMeta = null, rfMetaAsked = null;

function modelMeta() {
  if (rfMetaAsked) return rfMetaAsked;
  var base = 'https://api.roboflow.com/tfjs';
  var path = RF_MODEL_ID ? base + '/model/' + RF_MODEL_ID
                         : base + '/' + RF_MODEL + '/' + RF_VERSION;
  var url = path + '?publishable_key=' + encodeURIComponent(RF_KEY) +
            '&host=' + encodeURIComponent(location.host);
  rfMetaAsked = fetch(url).then(function (r) {
    if (!r.ok) throw new Error('metadata HTTP ' + r.status);
    return r.json();
  }).then(function (j) {
    var m = (j && j.tfjs) || {};
    rfMeta = { modelType: m.modelType || null,
               decoder: decoderFor(m.modelType),
               classes: m.classes || null,
               size: m.size || null,
               /* Where the weights themselves live. It is in the export and
                  nowhere on screen: it is a signed URL to this account's model,
                  so it belongs in a file the owner chooses to send, not on the
                  glass in a photograph. With it the graph can be pulled apart
                  off the phone, which is the only way left to tell a broken
                  export from a broken input. */
               weights: m.model || null,
               environment: m.environment || null };
    return rfMeta;
  }).catch(function (e) {
    rfMeta = { error: String((e && e.message) || e) };
    return rfMeta;
  });
  return rfMetaAsked;
}

/* The vendored library appends one record describing the tensor it decoded —
   see vendor/PATCHES.md for why and what. It is pulled off here, before
   anything else looks at the results, so no part of the app can mistake it for
   a detection. */
var lastDiag = null;

/* ---------- does the model answer sensibly to anything at all? ----------

   The shape is right, the transpose is right, and the decoder reads it as 8400
   boxes by 2 classes, which is also right. What comes out is still nonsense —
   at anchor nought all six channels collapse to two alternating values. That is
   the tensor, not the reading of it.

   Which leaves two possibilities that look identical from here: the graph is
   broken, or what we hand it is. So the model is run once on a flat grey square
   — no edges, no texture, nothing to find. A working detector answers that with
   low confidences and nothing worth reporting. If a picture of nothing comes
   back with confidences in the millions, the output does not depend on the
   input, and the fault is upstream of this app entirely. */
var selfTest = null;

function runSelfTest() {
  if (selfTest || !worker) return Promise.resolve(null);
  selfTest = { state: 'running' };
  var c = document.createElement('canvas');
  c.width = c.height = RF_SIZE;
  var x = c.getContext('2d');
  x.fillStyle = '#808080';
  x.fillRect(0, 0, RF_SIZE, RF_SIZE);
  return createImageBitmap(c).then(function (bmp) {
    return import('./vendor/inference.es.js').then(function (m) {
      return engine.infer(worker, new m.CVImage(bmp));
    });
  }).then(function (preds) {
    var all = preds || [], diag = null;
    if (all.length && all[all.length - 1] && all[all.length - 1].__diag) {
      diag = all[all.length - 1]; all = all.slice(0, -1);
    }
    var confs = all.map(function (p) { return +p.confidence; }).filter(isFinite);
    selfTest = {
      state: 'ran',
      onFlatGrey: all.length + ' result' + (all.length === 1 ? '' : 's'),
      confidenceRange: confs.length ? [round4(Math.min.apply(null, confs)),
                                       round4(Math.max.apply(null, confs))] : null,
      allInRange: confs.length ? confs.every(function (c) { return c >= 0 && c <= 1; }) : null,
      firstEight: diag ? diag.firstEight : null,
      rawShape: diag ? diag.rawShape : null,
      diag: diag        // carries the layout probe, for the screen below
    };
    return selfTest;
  }).catch(function (e) {
    selfTest = { state: 'failed', error: String((e && e.message) || e) };
    return selfTest;
  });
}

function takeDiag(preds) {
  if (!preds || !preds.length) return preds || [];
  var last = preds[preds.length - 1];
  if (last && last.__diag) { lastDiag = last; preds = preds.slice(0, -1); }
  return preds;
}

/* The one question left. The library feeds a YOLOv8 export channels-first,
   [1,3,640,640]; a tfjs graph converted from PyTorch usually wants
   channels-last, [1,640,640,3]. If the graph quietly accepts the wrong one — no
   error, a tensor of the right shape, numbers that mean nothing — that is
   exactly the failure being seen. So the same picture is put through the graph
   both ways round and the two ranges are set side by side. A range inside 0..1
   on one of them names the fault outright. */
function describeLayouts(d) {
  if (!d || !d.layoutProbe) return '';
  var p = d.layoutProbe;
  var say = function (r) {
    if (!r) return 'not tried';
    if (r.error) return 'refused — ' + r.error;
    return 'min ' + round4(r.min) + ', max ' + round4(r.max) +
           (r.shape ? ' (' + [].concat(r.shape).join('×') + ')' : '');
  };
  var chosen = d.layoutUsed === 'other' ? p.other.layout : p.native.layout;
  return p.native.layout + ' (what the library assumes): ' + say(p.native) + '\n           ' +
         p.other.layout + ' (the other way round): ' + say(p.other) + '\n           ' +
         'using ' + chosen +
         (d.layoutUsed === 'other' ? ' — the library\'s assumption was wrong here' : '');
}

/* True only when the graph answered one way round and not the other, which is
   the case worth saying out loud: the app has corrected for the library. */
function layoutOverridden(d) { return !!(d && d.layoutUsed === 'other'); }

/* What the runtime had to do to get a number that could be a reading of
   anything. The graph itself is known good — it was pulled off the phone and
   run with plain tfjs, where a flat grey square gives a minimum of 0 and a
   maximum of 637.6, which is box coordinates in pixels for a 640 model. So when
   a phone answers the same picture in the millions, the model is not the
   problem and neither is the app: it is what the browser is running it on.
   Half-precision render targets are the usual reason — float16 stops at 65504
   and this head reaches 640 with far larger intermediates. */
function describePrecision(d) {
  if (!d || !d.precision) return '';
  var p = d.precision, L = [];
  (p.tried || []).forEach(function (t) {
    L.push(t.how + ': ' + (t.error ? 'failed — ' + t.error
      : 'min ' + round4(t.min) + ', max ' + round4(t.max) +
        ' on ' + t.backend + (t.ok ? '  ← usable' : '')));
  });
  L.push('running on ' + p.using + (p.ok ? '' : ' — and still not usable'));
  return L.join('\n           ');
}

/* True when the runtime had to be talked down from its own defaults. Worth
   saying: it is working, and it is not working as the library ships. */
function precisionForced(d) {
  return !!(d && d.precision && d.precision.ok && (d.precision.tried || []).length > 1);
}

/* Neither way round produced a number that could be a reading of anything. That
   is a verdict on the graph, and it holds whatever the detections happened to
   look like on one frame — so it is asked separately rather than inferred from
   them. */
function layoutsBothBad(d) {
  if (!d || !d.layoutProbe) return false;
  var bad = function (r) {
    if (!r) return true;
    if (r.error) return true;
    return !(isFinite(r.max) && isFinite(r.min) &&
             Math.abs(r.max) < 1e4 && Math.abs(r.min) < 1e4);
  };
  var p = d.layoutProbe;
  /* One of them refusing outright is the graph being clear about its input, not
     the graph being broken — so that case is not counted here. */
  if ((p.native && p.native.error) || (p.other && p.other.error)) return false;
  return bad(p.native) && bad(p.other);
}

/* Said in the order that answers the question: what shape came back, what the
   library made of it, and what the numbers in it actually look like. */
function describeDiag(d) {
  if (!d) return '';
  var shape = function (s) { return Array.isArray(s) ? s.join('×') : String(s); };
  var raw = Array.isArray(d.rawShape) && Array.isArray(d.rawShape[0])
    ? d.rawShape.map(shape).join(' + ') : shape(d.rawShape);
  return 'Output ' + raw + (d.outputs > 1 ? ' (' + d.outputs + ' outputs)' : '') +
         ', transposed to ' + shape(d.afterTranspose) +
         ', read as ' + d.readAs.boxes + ' boxes × ' + d.readAs.classes + ' classes' +
         '. First eight: ' + (d.firstEight || []).map(round4).join(', ') + '.';
}

var lastRaw = null;
function noteRaw(raw, w, h, vw, vh) {
  lastRaw = { at: new Date().toISOString(), frame: w + '×' + h,
              video: vw ? vw + '×' + vh : null,
              summary: describeRaw(raw),
              first: raw && raw.length ? JSON.parse(JSON.stringify(raw[0])) : null,
              model: rfMeta,
              tensor: lastDiag };
  /* Asked for only when something has already gone wrong, so a working app
     never spends a request on it. It lands in lastRaw for the next export. */
  modelMeta().then(function (m) { if (lastRaw) lastRaw.model = m; });
}

/* ---------- taking the model at less than its word ----------

   What comes back is not always usable, and the app has no business guessing
   when it is not. A run of this produced twenty boxes per frame with scores of
   1.004 and, once, 5323169.5 — a confidence is a number between nought and one,
   so those are not confidences, and a threshold set against them filtered
   nothing. Every field is therefore checked before it is believed, and a find
   that fails is dropped rather than repaired. */
function usableFind(p, w, h) {
  if (!p || !known(p.class)) return null;
  var box = p.bbox;
  if (!box) return null;
  var bw = +box.width, bh = +box.height, bx = +box.x, by = +box.y;
  if (![bw, bh, bx, by].every(isFinite) || bw <= 0 || bh <= 0) return null;
  if (!isFinite(w) || !isFinite(h) || w <= 0 || h <= 0) return null;
  var share = (bw * bh) / (w * h);
  if (!isFinite(share) || share <= 0 || share > 1) return null;
  /* A confidence outside nought to one is not a confidence. The find is still
     usable — the box is sound — but nothing may be claimed about how sure the
     model is, and it cannot be thresholded on. */
  var c = +p.confidence;
  var conf = (isFinite(c) && c >= 0 && c <= 1) ? c : null;
  return { cls: p.class, conf: conf, share: share,
           box: { x: bx, y: by, w: bw, h: bh } };
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
var survey = { on: false, busy: false, timer: null, logged: 0, last: null,
               startedAt: null, clock: null };

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
  var n = $('hudState');
  n.textContent = state;
  n.className = 'state' + (cls ? ' ' + cls : '');
  n.hidden = false;
}

function toast(msg) {
  var t = $('hudToast');
  if (!msg) { t.hidden = true; return; }
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(function () { t.hidden = true; }, 3200);
}

/* ---------- the record button ----------
   One control, two states. Tapping it is also the gesture a browser wants
   before it will hand over the whole screen and lock the orientation, so those
   are asked for here rather than hidden behind a separate button nobody would
   find with a phone on a windscreen mount. */
function paintRec() {
  var on = survey.on;
  gauge('gRec', null, on ? 'live' : (stream ? 'good' : 'idle'));
  var b = $('bRec');
  b.setAttribute('aria-pressed', String(on));
  b.setAttribute('aria-label', on ? 'Stop recording' : 'Start recording');
  $('recHint').textContent = on ? 'Tap to stop' : 'Tap to record';
  $('recTime').classList.toggle('on', on);
  if (!on) { $('recTime').textContent = 'Ready'; $('hudState').hidden = true; }
}

function paintClock() {
  if (!survey.on || !survey.startedAt) return;
  var s = Math.round((Date.now() - survey.startedAt) / 1000);
  $('recTime').textContent =
    String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}

$('bRec').addEventListener('click', function () {
  if (survey.on) return endSurvey();
  goFull();          // this tap is the gesture; spend it before anything can eat it
  startSurvey();
});

function startSurvey() {
  if (survey.on || !stream) return;
  survey.on = true; survey.logged = 0; survey.last = null;
  survey.startedAt = Date.now();
  clearInterval(survey.clock);
  survey.clock = setInterval(paintClock, 1000);
  paintClock(); paintRec(); paintSurface();
  $('hudCount').textContent = '0 logged';
  hud(worker ? 'Watching' : 'Waiting for the model…');
  if (!S.gps) toast('No GPS fix yet — without one the survey cannot tell a new defect from the last.');
  loadModel().then(function () {
    if (survey.on) { hud('Watching'); tick(); }
  }, function (e) {
    /* A download that fails after the survey was stopped must not put a red
       state back on a screen that is no longer recording. */
    if (!survey.on) return;
    hud('Model unavailable', 'bad');
    toast(whyLocal(e));
  });
}

function endSurvey() {
  survey.on = false; survey.busy = false;
  clearTimeout(survey.timer); survey.timer = null;
  clearInterval(survey.clock); survey.clock = null;
  paintRec();
  exitFull();
  toast(survey.logged
    ? survey.logged + ' logged this run — all unconfirmed until you open them.'
    : '');
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
  var vw = v.videoWidth, vh = v.videoHeight;
  var sq = squareFrame(v, vw, vh);
  createImageBitmap(sq.canvas).then(function (input) {
    return import('./vendor/inference.es.js').then(function (m) {
      return engine.infer(worker, new m.CVImage(input)).then(function (preds) {
        return { preds: takeDiag(preds), w: RF_SIZE, h: RF_SIZE, ctx: sq.ctx,
                 vw: vw, vh: vh };
      });
    });
  }).then(function (out) {
    var raw = out.preds || [];
    var hits = raw.map(function (p) { return usableFind(p, out.w, out.h); })
                  .filter(Boolean)
                  .filter(function (f) { return f.conf == null || f.conf >= SURVEY_CONF; });
    if (raw.length && !hits.length) {
      /* Nothing measurable came back. Saying so beats writing down a guess, and
         a survey that quietly logged guesses is what produced a morning of
         two-hour emergencies. */
      noteRaw(raw, out.w, out.h, out.vw, out.vh);
      hud('Model output unusable', 'bad');
      var say = describeRaw(raw) + '. Frame ' + out.w + '×' + out.h +
                (out.vw && (out.vw !== out.w || out.vh !== out.h)
                  ? ', video ' + out.vw + '×' + out.vh : '') + '.';
      toast(say);
      modelMeta().then(function (m) {
        if (!survey.on || !m) return;
        toast(say + ' Roboflow calls it ' + (m.modelType || 'nothing') +
              (m.error ? ' (' + m.error + ')' : ', decoded by ' + m.decoder) + '. ' +
              describeDiag(lastDiag));
      });
      return tick();
    }
    if (!hits.length) return hud('Watching');
    /* Boxes and pixels are both in the 640 square, so no rescaling is needed
       between them — the mismatch that used to live here is gone. */
    hits = hits.filter(function (f) {
      return !rejectReason(out.ctx, RF_SIZE, RF_SIZE, f.box);
    });
    var v = $('vid'), c = $('shot');
    var scale = Math.min(1, MAX_EDGE / Math.max(v.videoWidth, v.videoHeight));
    c.width = Math.round(v.videoWidth * scale); c.height = Math.round(v.videoHeight * scale);
    c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
    if (!hits.length) return hud('Shadow, not a defect');
    var holes = hits.filter(function (f) { return typeFor(f.cls) === 'Pothole'; });
    if (!holes.length) return hud('Ironwork — sound cover, not logged');
    if (alreadyLogged()) return hud('Same defect — not logged again');
    return logFind(holes, out, c);
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
  var best = hits.reduce(function (a, b) { return (b.conf || 0) > (a.conf || 0) ? b : a; });
  var det = { conf: best.conf, share: best.share, count: hits.length,
              cls: best.cls, box: best.box };
  var was = S.det; S.det = det;                 // proposal() reads the current find
  var p = proposal(det);
  S.det = was;
  if (!p) { hud('Found something, could not measure it', 'bad'); return Promise.resolve(); }
  var n = p.imp * p.prb, pri = priorityFor(n) || PRIORITY[PRIORITY.length - 1];

  return new Promise(function (resolve) {
    c.toBlob(function (blob) {
      if (!blob) { hud('Could not save the frame', 'bad'); return resolve(); }
      var f = S.gps ? { lat: S.gps.lat, lon: S.gps.lon, acc: S.gps.acc, age: fixAge() } : null;
      var e = {
        id: nextId(), t: new Date().toISOString(), img: blob,
        imp: p.imp, prob: p.prb, score: n,
        /* No category and no response time. The survey has not measured a
           depth, nobody has looked at the photograph, and a field called
           `resp` holding the words "2 hours" is read by whatever imports this
           as an obligation. What it may say is which of its own finds it
           thinks is worth looking at first. */
        priority: pri.p, priorityWord: pri.word, key: pri.key,
        cat: null, resp: null,
        statCat: null, statResp: null, catBy: null, catAt: null,
        surface: S.foot ? 'Footway/cycleway' : 'Carriageway',
        tag: S.tag || '',
        scoredBy: 'survey, unconfirmed',
        detConf: det.conf, detShare: det.share, detCount: det.count,
        detBox: det.box,          // kept so a wrong entry can be diagnosed later
        type: typeFor(best.cls), note: '',
        lat: f ? f.lat : null, lon: f ? f.lon : null,
        acc: f ? Math.round(f.acc) : null, fixAge: f ? f.age : null
      };
      (dbBroken ? Promise.resolve() : putEntry(e)).then(function () {
        S.items.unshift(e);
        addWords(e);
        survey.logged++; survey.last = { at: Date.now(), gps: S.gps ? { lat: S.gps.lat, lon: S.gps.lon } : null };
        $('hudCount').textContent = survey.logged + ' logged';
        render();
        hud('Watching');
        /* A missing confidence used to just not appear, which reads exactly
           like a confident find. It is the one number that says whether the
           model is being decoded at all, so its absence is now said out loud. */
        toast('Logged ' + typeFor(best.cls).toLowerCase() + ' — ' + pri.p + ', ' +
            pri.word.toLowerCase() +
            (det.conf == null ? ' (sureness out of range — the model is not being read properly)'
                              : ' (' + Math.round(det.conf * 100) + '% sure)') +
            '. Not classified — nobody has looked at it.');
        resolve();
      }, function () {
        hud('Could not write it down', 'bad');
        toast('This device refused the write. Export what is in the log.');
        resolve();
      });
    }, 'image/jpeg', 0.82);
  });
}

/* ---------- full screen and landscape ----------

   This is used on a windscreen mount, landscape, and should be landscape from
   the moment it opens. Browsers do not make that simple, so it is asked for in
   three places rather than one:

     1. The manifest declares `orientation: landscape`. Installed to the home
        screen, that is the one route that genuinely works at startup with no
        tap at all — the launcher opens it rotated. It is the reason to install
        it rather than run it from a browser tab.
     2. On load, the lock is asked for anyway. Standalone Android grants it off
        the manifest; a browser tab refuses, which costs nothing.
     3. The first touch anywhere on the screen counts as the gesture a browser
        wants, so full screen and the lock are taken on it rather than waiting
        for the record button.

   None of it is required for the app to work: the viewfinder fills the
   viewport regardless. So every one of these failing is silent, and the only
   thing said out loud is the nudge to turn the phone. */
function lockLandscape() {
  if (!screen.orientation || !screen.orientation.lock) return Promise.resolve(false);
  try {
    var r = screen.orientation.lock('landscape');
    return (r && r.then) ? r.then(function () { return true; }, function () { return false; })
                         : Promise.resolve(false);
  } catch (e) { return Promise.resolve(false); }
}

/* Spent once. A gesture that has already bought full screen must not keep
   re-firing on every tap in the log. */
var gestureSpent = false;
function firstGesture() {
  if (gestureSpent) return;
  gestureSpent = true;
  goFull();
}
document.addEventListener('pointerdown', firstGesture, { once: true, capture: true });

function goFull() {
  if (document.fullscreenElement) return;
  var el = document.documentElement;
  var req = el.requestFullscreen || el.webkitRequestFullscreen;
  if (!req) return;
  var r = req.call(el);
  if (r && r.then) r.then(lockLandscape, function () {}).catch(function () {});
}

function exitFull() {
  if (screen.orientation && screen.orientation.unlock) {
    try { screen.orientation.unlock(); } catch (e) {}
  }
  if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(function () {});
}

/* ---------- the map ----------

   Leaflet and its tiles are not the same thing. The library is part of the app
   and works with no signal; the tiles are fetched as you pan and are not, so
   ground already looked at stays available through the same cache that serves
   the app, and ground that has not been comes up blank. That is worth saying on
   screen rather than leaving someone to wonder why a map is empty in a lay-by.

   Pins are coloured by category and hollowed when the entry is a survey find
   nobody has confirmed, because a map that shows a guess and a judgement as the
   same mark is worse than no map. */
var map = null, pins = null, mapReady = null;

function loadMap() {
  if (mapReady) return mapReady;
  mapReady = new Promise(function (resolve, reject) {
    var sc = document.createElement('script');
    sc.src = './vendor/leaflet.js';
    sc.onload = resolve;
    sc.onerror = function () { mapReady = null; reject(new Error('leaflet did not load')); };
    document.head.appendChild(sc);
  }).then(function () {
    map = L.map('map', { attributionControl: true });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap contributors'
    }).addTo(map);
    pins = L.layerGroup().addTo(map);
    map.setView([53.0, -1.1], 6);
    return map;
  });
  return mapReady;
}

function located() {
  return S.items.filter(function (i) { return i.lat != null && i.lon != null; });
}

function pinFor(it) {
  var unconfirmed = /unconfirmed/i.test(it.scoredBy || '');
  return L.divIcon({
    className: '',
    html: '<i class="mappin ' + markKey(it) + (unconfirmed ? ' unconf' : '') + '"></i>',
    iconSize: [18, 18], iconAnchor: [9, 9]
  });
}

function drawMap() {
  var rows = located();
  $('mapEmpty').hidden = !!rows.length;
  $('map').style.display = rows.length ? '' : 'none';
  $('bFit').disabled = !rows.length;
  if (!rows.length) return Promise.resolve();
  return loadMap().then(function () {
    map.invalidateSize();
    pins.clearLayers();
    rows.forEach(function (it) {
      var unconfirmed = /unconfirmed/i.test(it.scoredBy || '');
      var where = (it.w3w ? '///' + esc(it.w3w)
                          : it.lat.toFixed(5) + ', ' + it.lon.toFixed(5)) +
                  (it.acc != null ? ' (±' + it.acc + 'm)' : '');
      var st = statutoryOf(it), pr = priorityOf(it);
      var title = st ? esc(st.cat) + ' — ' + esc(st.resp)
                     : (pr ? pr.p + ' — ' + esc(pr.word) : 'Not scored') +
                       ' <em>(app priority, not classified)</em>';
      L.marker([it.lat, it.lon], { icon: pinFor(it) })
        .bindPopup('<b>' + title + '</b><br>' + esc(it.type) + ' · ' + esc(it.surface) +
                   '<br>' + where + '<br>' + new Date(it.t).toLocaleString() +
                   (unconfirmed ? '<br><em>Unconfirmed survey find</em>' : ''))
        .addTo(pins);
    });
    fitMap();
  }).catch(function () {
    $('mapEmpty').hidden = false;
    $('mapEmpty').innerHTML = '<div class="disp">The map would not load</div>' +
      '<p>Its library is part of the app, so this is not about signal.</p>';
    $('map').style.display = 'none';
  });
}

function fitMap() {
  var rows = located();
  if (!map || !rows.length) return;
  var b = L.latLngBounds(rows.map(function (i) { return [i.lat, i.lon]; }));
  map.fitBounds(b, { padding: [40, 40], maxZoom: 17 });
}
$('bFit').addEventListener('click', fitMap);

/* ---------- what3words ----------

   The key below is the one this app ships with. It is a metered, paid service
   and this is a public page, so the key is readable by anyone who opens the
   source — that is not a slip, it is what putting a key in a static site
   means. The protection is at what3words' end: restrict it to this domain in
   their dashboard, and a copy of it is worth nothing anywhere else. The field
   in the log stays, so a different key can be pasted over this one and is kept
   on the device; clearing the field turns the lookups off rather than falling
   back to the built-in one.

   The lookup happens once, when an entry is saved, because a three-word
   address for a fixed point never changes — there is nothing to refresh and no
   reason to spend a call twice on it.

   It needs a signal, which coordinates do not, so it is never allowed to hold
   up or fail a save: the entry is written first and the words are added to it
   afterwards if they arrive. */
/* A tag belongs to the run, not to the defect: a road name, a job number, the
   round you are on. It is typed once and rides along on everything logged until
   it is changed, which is the difference between labelling a survey and
   labelling four hundred entries. */
var TAG_STORE = 'deflog.tag';

function loadTag() {
  try { S.tag = localStorage.getItem(TAG_STORE) || ''; } catch (e) { S.tag = ''; }
  $('pTag').value = S.tag;
}

$('pTag').addEventListener('input', function () {
  S.tag = this.value.trim();
  try { localStorage.setItem(TAG_STORE, S.tag); } catch (e) {}
});

var W3W_KEY_STORE = 'deflog.w3w';
var W3W_DEFAULT = 'GNB4B5O7';

/* ---------- the built-in key, and what can honestly be done about it ----------

   The key above is in a public repository on a public page. Anyone who opens
   the source has it. That is not a mistake that can be corrected in this file:
   a static site has no server to keep a secret on, and any key the page can use
   is a key the page has handed to whoever is reading it. Obfuscating it would
   only make it slower to find, which is not the same thing as protecting it,
   and pretending otherwise is worse than saying so.

   Two things are true and worth separating.

     The real protection is at what3words' end. Their dashboard restricts a key
     to a list of referring domains. Restricted, a copy of this key is worth
     nothing anywhere else, and that — not anything in this file — is what stops
     it being spent by a stranger. It has to be set there. Until it is, this key
     is billable by anybody.

     What this file can do is smaller, and it is this: the built-in key is used
     only on the site it belongs to. A fork, a preview deployment, a copy
     someone runs from their own Pages account — none of them spend this
     account's quota by default, because none of them is on the list below. They
     are not blocked from using what3words; they are asked to paste their own
     key, which is kept on the device and works everywhere.

   When there is a backend, the lookup moves behind it and the key stops being
   in the page at all. That is the fix. This is the mitigation until then. */
var W3W_HOSTS = ['jonathan-longden.github.io'];

function w3wOwnSite() {
  var h = String(location.hostname || '').toLowerCase();
  return W3W_HOSTS.indexOf(h) !== -1;
}

/* Empty string is a decision — someone turned the lookups off — and is honoured
   everywhere. null means nothing has been chosen, and only then does the site
   the app is running on decide whether the built-in key applies. */
function w3wKey() {
  var v = null;
  try { v = localStorage.getItem(W3W_KEY_STORE); } catch (e) { v = null; }
  if (v !== null) return v;
  return w3wOwnSite() ? W3W_DEFAULT : '';
}

function words(lat, lon) {
  var key = w3wKey();
  if (!key || lat == null || lon == null || !navigator.onLine) return Promise.resolve(null);
  var ctl = new AbortController(), timer = setTimeout(function () { ctl.abort(); }, 8000);
  return fetch('https://api.what3words.com/v3/convert-to-3wa?coordinates=' +
               encodeURIComponent(lat + ',' + lon) + '&key=' + encodeURIComponent(key), {
    signal: ctl.signal
  }).then(function (r) {
    clearTimeout(timer);
    return r.ok ? r.json() : null;
  }).then(function (j) {
    return j && j.words ? j.words : null;
  }).catch(function () { clearTimeout(timer); return null; });
}

/* Written to the entry after the fact, so a slow or refused lookup costs the
   log nothing. */
function addWords(entry) {
  if (entry.w3w || entry.lat == null) return;
  words(entry.lat, entry.lon).then(function (w) {
    if (!w) return;
    entry.w3w = w;
    (dbBroken ? Promise.resolve() : putEntry(entry)).then(render, function () {});
  });
}

/* Which key is in use, and why, said on the screen where it can be changed.
   The three states are genuinely different and were previously all described
   by the same sentence. */
function paintW3w() {
  var n = $('w3wState'); if (!n) return;
  var stored = null;
  try { stored = localStorage.getItem(W3W_KEY_STORE); } catch (e) {}
  if (stored) {
    n.innerHTML = '<b>Using the key you pasted.</b> It is kept on this device only and is ' +
      'billed to your own what3words account.';
  } else if (stored === '') {
    n.innerHTML = '<b>Lookups are off.</b> Entries keep their coordinates and get no ' +
      'three-word address. Paste a key to turn them back on.';
  } else if (w3wOwnSite()) {
    n.innerHTML = '<b>Using the built-in key.</b> It belongs to this site and is metered and ' +
      'paid — see below.';
  } else {
    n.innerHTML = '<b>No key, so no lookups.</b> The built-in key is only used on ' +
      W3W_HOSTS.join(', ') + ', so this copy of the app does not spend that account\'s quota. ' +
      'Paste your own key to record three-word addresses here. Coordinates are recorded either way.';
  }
}

$('w3wKey').value = w3wKey();
paintW3w();
$('w3wKey').addEventListener('change', function () {
  /* An emptied field is a decision, not an absence: it is stored as an empty
     string so it stays off, rather than quietly reverting to the built-in key
     on the next load. */
  try { localStorage.setItem(W3W_KEY_STORE, this.value.trim()); } catch (e) {}
  paintW3w();
});

/* ---------- log ---------- */
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, function (m) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m];
  });
}

function render() {
  $('cnt').textContent = S.items.length;
  $('railCount').textContent = S.items.length;
  paintSpace();
  var has = S.items.length > 0;
  $('empty').hidden = has; $('expRow').hidden = !has; $('bClear').hidden = !has;
  var placed = S.items.filter(function (i) { return i.lat != null; }).length;
  var loose = S.items.length - placed;
  var unconf = S.items.filter(function (i) { return /unconfirmed/i.test(i.scoredBy || ''); }).length;
  var hint = $('expHint');
  if (hint) {
    hint.hidden = !has;
    hint.innerHTML =
      'CSV and JSON carry everything; JSON carries the photographs too. ' +
      'GeoJSON carries ' + placed + ' of ' + S.items.length + ' — a defect needs a location ' +
      'to go on a map' + (loose ? ', and ' + loose + ' ' + (loose === 1 ? 'has' : 'have') +
      ' none' : '') + '.' +
      (unconf ? ' <b>' + unconf + ' unconfirmed</b>, marked <code>confirmed: false</code> — ' +
                'filter on it before anything here starts a response clock.' : '') +
      ' Every export carries <code>app_priority</code>, which is this app\'s own ordering. ' +
      '<code>statutory_category</code> is empty except where a person assigned one.';
  }
  $('saveNote').hidden = !has;

  urls.forEach(URL.revokeObjectURL); urls = [];
  $('list').innerHTML = S.items.map(function (it) {
    var loc, flag = '';
    if (it.lat != null) {
      /* The three-word address is what someone reads out on a radio and types
         into a van's satnav; six decimal places of latitude is not. So it
         stands in place of the coordinates once it arrives — the coordinates
         are still what is stored and exported, they are simply not the useful
         thing to show. Accuracy stays either way, because how well the fix is
         known is not a detail. */
      loc = it.w3w ? '///' + esc(it.w3w) : it.lat.toFixed(5) + ', ' + it.lon.toFixed(5);
      if (it.acc != null) loc += ' (±' + it.acc + 'm)';
      if (it.acc > POOR_ACC) flag = ' <span class="flag">coarse fix</span>';
      if (it.fixAge != null && it.fixAge > STALE_MS / 1000) {
        flag += ' <span class="flag">fix ' + it.fixAge + 's old</span>';
      }
    } else { loc = 'No GPS fix'; }
    var unconfirmed = /unconfirmed/i.test(it.scoredBy || '');
    var how = (it.tag ? esc(it.tag) + ' · ' : '') + (it.scoredBy ? esc(it.scoredBy) : 'inspector');
    if (it.amendedAt) how += ' · <span class="amended">amended</span>';
    if (it.detConf != null && it.detConf >= 0 && it.detConf <= 1) {
      how += ' · model ' + Math.round(it.detConf * 100) + '% sure';
      if (it.detShare != null) how += ', ' + Math.round(it.detShare * 100) + '% of frame';
    } else if (it.detShare != null) {
      how += ' · model, ' + Math.round(it.detShare * 100) + '% of frame';
    }
    /* Gauged depth is real measured data. The fields that collected it are gone,
       but an entry that already carries one still shows it. */
    var dep = (it.depth != null) ? it.depth + 'mm at deepest point (gauged)' : null;
    var src = '';
    if (it.img) { src = URL.createObjectURL(it.img); urls.push(src); }

    /* The headline is either a statutory category a person assigned or the
       app's own priority, and the two are never allowed to look alike. A
       category comes with a response time; a priority comes with a line saying
       in as many words that nothing has been classified. Entries logged by
       older builds, which carry a category the survey wrote for itself, fall on
       the priority side — statutoryOf() is what decides, not the field. */
    var st = statutoryOf(it), pr = priorityOf(it);
    var head, sub;
    if (st) {
      head = '<span class="cat">' + esc(st.cat) + '</span>';
      sub = esc(st.resp) + ' · assigned by ' + esc(st.by);
    } else {
      head = '<span class="cat prio">' + esc(pr ? pr.p : '—') + '</span>' +
             '<span class="prionote">app priority</span>';
      sub = (pr ? esc(pr.word) : 'Not scored') + ' · <b>not classified</b> — no response time';
    }

    return '<div class="item ' + markKey(it) + (unconfirmed ? ' unconf' : '') + '">' +
      (src ? '<button type="button" class="thumb" data-full="' + it.id + '">' +
             '<img src="' + src + '" alt="Defect photograph, tap for full size"></button>' : '') +
      '<div class="body"><div class="top">' + head +
      '<span class="sc">' + it.imp + ' × ' + it.prob + ' = ' + it.score + '</span></div>' +
      '<div class="det">' + sub + ' · ' + esc(it.type) + ' · ' + esc(it.surface) + '<br>' +
      (dep ? esc(dep) + '<br>' : '') + how + '<br>' + esc(loc) + flag + '<br>' +
      new Date(it.t).toLocaleString() +
      (it.note ? '<br>' + esc(it.note) : '') + '</div>' +
      '<div class="acts">' +
      (unconfirmed ? '<button class="del go" data-id="' + it.id + '">Confirm</button>' : '') +
      '<button class="del amend-open" data-id="' + it.id + '">Amend</button>' +
      '<button class="del wrong" data-id="' + it.id + '">Not a defect</button>' +
      '<button class="del remove" data-id="' + it.id + '">Remove</button></div>' +
      '<div class="amend" id="am' + it.id + '" hidden>' +
      '<select class="amType">' + TYPES.map(function (t) {
        return '<option' + (t === it.type ? ' selected' : '') + '>' + t + '</option>';
      }).join('') + '</select>' +
      '<select class="amSurface">' +
      ['Carriageway', 'Footway/cycleway'].map(function (v) {
        return '<option' + (v === it.surface ? ' selected' : '') + '>' + v + '</option>';
      }).join('') + '</select>' +
      '<button class="amSave" data-id="' + it.id + '">Save the correction</button>' +
      '</div></div></div>';
  }).join('');
  quota();
}

$('list').addEventListener('click', function (e) {
  var full = e.target.closest('.thumb');
  if (full) return openFull(+full.dataset.full);

  /* A cover called a pothole is a real thing in the wrong words, not a false
     find — deleting it loses a defect, so it can be put right instead. */
  var go = e.target.closest('.del.go');
  if (go) return openConfirm(+go.dataset.id);

  var open = e.target.closest('.amend-open');
  if (open) {
    var panel = $('am' + open.dataset.id);
    if (panel) panel.hidden = !panel.hidden;
    return;
  }

  var sv = e.target.closest('.amSave');
  if (sv) {
    var sid = +sv.dataset.id, box = $('am' + sid);
    var sit = S.items.filter(function (x) { return x.id === sid; })[0];
    if (!sit || !box) return;
    var wasFoot = sit.surface === 'Footway/cycleway';
    sit.type = box.querySelector('.amType').value;
    sit.surface = box.querySelector('.amSurface').value;
    sit.amendedAt = new Date().toISOString();
    /* Moving a find between surfaces changes what it means, so an app-proposed
       score is recomputed rather than left describing the other surface. A
       score a person chose is theirs and is left alone. */
    var nowFoot = sit.surface === 'Footway/cycleway';
    /* Only the app's own priority is recomputed, and only on an entry the app
       is still the sole author of. Once a person has assigned a category,
       changing the surface is a note about the entry — it is not permission for
       the app to reclassify what somebody signed. */
    if (nowFoot !== wasFoot && sit.detShare != null &&
        sit.scoredBy !== 'inspector' && !statutoryOf(sit)) {
      var keep = S.foot; S.foot = nowFoot;
      var p = proposal({ share: sit.detShare, count: sit.detCount || 1, conf: sit.detConf });
      S.foot = keep;
      if (p) {
        var n2 = p.imp * p.prb, pr2 = priorityFor(n2);
        sit.imp = p.imp; sit.prob = p.prb; sit.score = n2;
        if (pr2) { sit.priority = pr2.p; sit.priorityWord = pr2.word; sit.key = pr2.key; }
      }
    }
    return (dbBroken ? Promise.resolve() : putEntry(sit)).then(render, render);
  }

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

  var b = e.target.closest('.del.remove'); if (!b) return;
  var id = +b.dataset.id;
  var it = S.items.filter(function (x) { return x.id === id; })[0];
  var itSt = it ? statutoryOf(it) : null, itPr = it ? priorityOf(it) : null;
  var what = itSt ? itSt.cat.toLowerCase() : (itPr ? itPr.p + ' find' : 'entry');
  if (!confirm('Remove this ' + what + ' and its photograph? ' +
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
  /* app_priority is the app's own ordering and is always filled in.
     statutory_category and statutory_response_time are filled in only where a
     person assigned one, and are empty everywhere else — an empty cell is the
     honest answer to "what category is this", and a spreadsheet that sorts on
     it puts the unclassified finds together where they belong.

     category and response_time are kept under their old names as well, because
     a spreadsheet or an import template keyed on them should not break on this
     release. They hold the same thing statutory_category holds — which is
     nothing at all unless a person put it there. */
  var head = ['timestamp', 'latitude', 'longitude', 'gps_accuracy_m', 'gps_fix_age_s',
    'defect_type', 'surface', 'impact', 'probability', 'risk_factor',
    'app_priority', 'app_priority_note',
    'category', 'response_time',
    'statutory_category', 'statutory_response_time', 'categorised_by', 'categorised_at',
    'tag', 'scored_by', 'model_confidence', 'model_share_of_frame', 'model_detections']
    .concat(old ? ['depth_mm_deepest', 'wider_than_tyre'] : []).concat(['what3words', 'notes']);
  var rows = S.items.map(function (i) {
    var st = statutoryOf(i), pr = priorityOf(i);
    return [i.t, i.lat, i.lon, i.acc, i.fixAge, i.type, i.surface,
      i.imp, i.prob, i.score,
      pr ? pr.p : '', pr ? pr.word : '',
      st ? st.cat : '', st ? st.resp : '',
      st ? st.cat : '', st ? st.resp : '', st ? st.by : '', st ? st.at : '',
      i.tag || '', i.scoredBy || 'inspector', i.detConf, i.detShare, i.detCount]
      .concat(old ? [i.depth, i.wide === null || i.wide === undefined ? '' : (i.wide ? 'yes' : 'no')] : [])
      .concat([i.w3w ? '///' + i.w3w : '', i.note]).map(q).join(',');
  });
  /* The BOM is what stops Excel turning a road name with an accent in it into
     mojibake when the file is double-clicked. */
  dl('defects-' + stamp() + '.csv',
     new Blob(['﻿' + head.join(',') + '\r\n' + rows.join('\r\n')], { type: 'text/csv' }));
});

/* GeoJSON, for handing to an asset system — Alloy takes it, so does anything
   else with a map in it.

   Two things are easy to get wrong and expensive to notice later. Coordinates
   go longitude first: the spec says so and a file with them the other way round
   puts every defect in the sea off Somalia without complaining. And properties
   are kept flat and scalar, because nested objects are what make a GIS import
   silently drop a column.

   Every feature says who scored it. A defect record drives a response time, and
   an unconfirmed survey find is a machine's guess that nobody has stood over —
   so `confirmed` is there to be filtered on before any of this reaches a system
   that starts a clock. */
$('bGeo').addEventListener('click', function () {
  var rows = S.items.filter(function (i) { return i.lat != null && i.lon != null; });
  if (!rows.length) {
    return alert('Nothing to export: no entry in the log has a location on it.');
  }
  var fc = {
    type: 'FeatureCollection',
    features: rows.map(function (i) {
      var st = statutoryOf(i), pr = priorityOf(i);
      return {
        type: 'Feature',
        id: i.id,
        geometry: { type: 'Point', coordinates: [i.lon, i.lat] },
        properties: {
          logged: i.t,
          defect_type: i.type,
          tag: i.tag || null,
          surface: i.surface,
          /* Null, not a category, wherever nobody assigned one. A GIS that
             styles on statutory_category will show these as unclassified,
             which is what they are. The old key names stay, holding the same
             value, so an existing import does not lose a column — but they are
             null on everything the app classified for itself, which is the
             whole point of the change. */
          category: st ? st.cat : null,
          response_time: st ? st.resp : null,
          statutory_category: st ? st.cat : null,
          statutory_response_time: st ? st.resp : null,
          categorised_by: st ? st.by : null,
          app_priority: pr ? pr.p : null,
          app_priority_note: pr ? pr.word + ' — the app\'s own ordering, not a statutory category' : null,
          impact: i.imp,
          probability: i.prob,
          risk_factor: i.score,
          confirmed: !/unconfirmed/i.test(i.scoredBy || ''),
          scored_by: i.scoredBy || 'inspector',
          gps_accuracy_m: i.acc == null ? null : i.acc,
          gps_fix_age_s: i.fixAge == null ? null : i.fixAge,
          what3words: i.w3w ? '///' + i.w3w : null,
          model_confidence: i.detConf == null ? null : i.detConf,
          model_share_of_frame: i.detShare == null ? null : i.detShare,
          amended: i.amendedAt || null,
          notes: i.note || null,
          has_photograph: !!i.img        // the photographs travel in the JSON export
        }
      };
    })
  };
  dl('defects-' + stamp() + '.geojson',
     new Blob([JSON.stringify(fc, null, 2)], { type: 'application/geo+json' }));
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
        return modelMeta().then(function (meta) { return { wrongRows: wrongRows, meta: meta }; });
      }).then(function (bundle) {
        var wrongRows = bundle.wrongRows, meta = bundle.meta;
        dl('defects-' + stamp() + '.json', new Blob([JSON.stringify({
          defects: rows,
          notDefects: wrongRows,      // the examples a retrain would need
          model: { id: RF_MODEL_ID || (RF_MODEL + '/' + RF_VERSION),
                   loadedBy: RF_MODEL_ID ? 'model id' : 'project and version',
                   build: BUILD,
                   roboflow: meta,     // what the service says it is, and what decodes it
                   selfTest: selfTest },
          lastUnusableOutput: lastRaw // what the model returned when it made no sense
        }, null, 2)], { type: 'application/json' }));
      });
    });
  }).then(function () { btn.disabled = false; }, function () { btn.disabled = false; });
});

/* ---------- diagnostics ----------

   All of this used to live only in the JSON export, which is hidden until
   something has been logged — so the one screen that says why nothing can be
   logged was locked behind logging something. It is its own screen now, always
   reachable, and it is text on the glass rather than a file, because a phone is
   a poor place to find a downloaded .json and a bad place to read one. */
function diagLines() {
  var L = [];
  L.push('Defect Log ' + BUILD);
  L.push('when       ' + new Date().toISOString());
  L.push('page       ' + location.host);
  /* Which key is being spent, without printing the key. A support question
     that starts "why are there no three-word addresses" is answered here. */
  var w3wStored = null;
  try { w3wStored = localStorage.getItem(W3W_KEY_STORE); } catch (e) {}
  L.push('what3words ' + (w3wStored ? 'a key kept on this device'
    : w3wStored === '' ? 'off — lookups turned off here'
    : w3wOwnSite() ? 'the built-in key (this is its own site)'
    : 'none — the built-in key is only used on ' + W3W_HOSTS.join(', ')));
  L.push('');
  L.push('MODEL');
  L.push('id         ' + (RF_MODEL_ID || RF_MODEL + '/' + RF_VERSION));
  if (!rfMeta) {
    L.push('roboflow   not asked yet');
  } else if (rfMeta.error) {
    L.push('roboflow   could not be reached: ' + rfMeta.error);
  } else {
    L.push('type       ' + rfMeta.modelType);
    L.push('decoder    ' + rfMeta.decoder);
    L.push('classes    ' + (rfMeta.classes || []).join(', '));
    L.push('input      ' + rfMeta.size);
    if (rfMeta.environment) {
      L.push('env        ' + (typeof rfMeta.environment === 'string'
        ? rfMeta.environment : JSON.stringify(rfMeta.environment).slice(0, 300)));
    }
    L.push('');
    L.push('WEIGHTS');
    L.push('           ' + describeWeights(rfMeta.weights));
  }
  L.push('');
  L.push('SELF TEST  (the model, shown a flat grey square with nothing in it)');
  if (!selfTest) {
    L.push('           not run — the model has not loaded');
  } else if (selfTest.state !== 'ran') {
    L.push('           ' + selfTest.state + (selfTest.error ? ': ' + selfTest.error : ''));
  } else {
    L.push('returned   ' + selfTest.onFlatGrey);
    L.push('confidence ' + (selfTest.confidenceRange
      ? selfTest.confidenceRange.join(' to ') : 'none reported'));
    L.push('in 0..1    ' + (selfTest.allInRange === null ? 'nothing to judge'
      : selfTest.allInRange ? 'yes' : 'NO — the output does not depend on the picture'));
    if (selfTest.rawShape) L.push('shape      ' + [].concat(selfTest.rawShape).join('×'));
    if (selfTest.firstEight) L.push('first 8    ' + selfTest.firstEight.map(round4).join(', '));
  }
  L.push('');
  L.push('LAST TENSOR  (from a real frame)');
  L.push(lastDiag ? '           ' + describeDiag(lastDiag) : '           nothing yet');
  L.push('');
  L.push('INPUT LAYOUT  (the same picture through the graph both ways round)');
  var lay = describeLayouts(lastDiag) || describeLayouts(selfTest && selfTest.diag);
  L.push(lay ? '           ' + lay : '           nothing yet');
  L.push('');
  L.push('PRECISION  (off the phone this graph answers flat grey with min 0, max 637.6)');
  var pre = describePrecision(lastDiag) || describePrecision(selfTest && selfTest.diag);
  L.push(pre ? '           ' + pre : '           nothing yet');
  L.push('');
  L.push('LAST UNUSABLE OUTPUT');
  if (!lastRaw) {
    L.push('           nothing yet');
  } else {
    L.push('at         ' + lastRaw.at);
    L.push('frame      ' + lastRaw.frame + (lastRaw.video ? ', video ' + lastRaw.video : ''));
    L.push('summary    ' + lastRaw.summary);
    L.push('first      ' + JSON.stringify(lastRaw.first));
  }
  return L.join('\n');
}

function paintDiag() { $('diagText').textContent = diagLines(); }

function openDiag() {
  show('diag');
  paintDiag();
  /* Both are cached and cheap the second time, and this is the screen someone
     opens precisely because something is wrong — so ask now rather than wait
     for a failure to ask on their behalf. */
  modelMeta().then(paintDiag);
  runSelfTest().then(paintDiag);
}

$('mDiag').addEventListener('click', function () { closeMenu(); openDiag(); });
$('xDiag').addEventListener('click', backToCamera);

$('bCopyDiag').addEventListener('click', function () {
  var text = diagLines(), note = $('copyNote');
  note.hidden = false;
  var done = function () { note.textContent = 'Copied. Paste it wherever you need it.'; };
  var failed = function () {
    note.textContent = 'This browser would not copy it. Press and hold the text to select it.';
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done, failed);
  } else { failed(); }
});

$('bDiagFile').addEventListener('click', function () {
  dl('defect-log-diagnostics-' + stamp() + '.txt',
     new Blob([diagLines()], { type: 'text/plain' }));
});

/* ---------- sheets and the menu ----------

   The viewfinder is always underneath. The log, the map and the confirm step
   come up over it rather than replacing it, so going back is one tap and the
   camera never stops — which is the difference between a layer and a tab, and
   the reason there is no longer a row of tabs. */
function show(which) {
  $('p-log').hidden = (which !== 'log');
  $('p-map').hidden = (which !== 'map');
  $('p-score').hidden = (which !== 'score');
  $('p-diag').hidden = (which !== 'diag');
  var open = which === 'log' ? $('p-log') : which === 'map' ? $('p-map') :
             which === 'score' ? $('p-score') : which === 'diag' ? $('p-diag') : null;
  if (open) { var b = open.querySelector('.sh-body'); if (b) b.scrollTop = 0; }
  /* Leaflet is only fetched when a map is actually asked for, and it has to
     measure a container that is on screen, so this happens here rather than at
     startup. */
  if (which === 'map') drawMap();
}

function backToCamera() { confirming = null; show('live'); }

function menuOpen() { return !$('menu').hidden; }

function openMenu() {
  $('menu').hidden = false; $('scrim').hidden = false;
  $('bMenu').setAttribute('aria-expanded', 'true');
}

function closeMenu() {
  $('menu').hidden = true; $('scrim').hidden = true;
  $('bMenu').setAttribute('aria-expanded', 'false');
}

$('bMenu').addEventListener('click', function () { menuOpen() ? closeMenu() : openMenu(); });
$('scrim').addEventListener('click', closeMenu);
$('mLog').addEventListener('click', function () { closeMenu(); show('log'); });
$('bLogQuick').addEventListener('click', function () { closeMenu(); show('log'); });
$('mMap').addEventListener('click', function () { closeMenu(); show('map'); });
$('mFull').addEventListener('click', function () {
  closeMenu();
  if (document.fullscreenElement) exitFull(); else goFull();
});
$('xLog').addEventListener('click', backToCamera);
$('xMap').addEventListener('click', backToCamera);
$('xScore').addEventListener('click', function () { confirming = null; show('log'); });

document.addEventListener('keydown', function (e) {
  if (e.key !== 'Escape') return;
  if (!$('lb').hidden) return;        // the photo viewer has its own handler
  if (menuOpen()) return closeMenu();
  if (!$('p-score').hidden) { confirming = null; return show('log'); }
  if (!$('p-log').hidden || !$('p-map').hidden || !$('p-diag').hidden) backToCamera();
});

/* The camera light staying on after the phone goes in a pocket is both a
   battery drain and a thing people reasonably object to. A page cannot hold the
   camera once it is not the app on screen — the browser suspends it — so a
   survey ends rather than pretending to still be watching, and the picture is
   asked for again when the app comes back, because coming back to a dead black
   rectangle is not what "opens on the camera" means. */
document.addEventListener('visibilitychange', function () {
  if (document.visibilityState === 'hidden') { if (stream) stopAll(); return; }
  if (!stream) openCamera(false);
});
window.addEventListener('pagehide', stopAll);

/* ---------- go ---------- */
$('build').textContent = BUILD;
$('fType').innerHTML = TYPES.map(function (t) { return '<option>' + t + '</option>'; }).join('');
buildMatrix(); verdict(); paintSurface(); paintRec(); loadTag(); paintSpace();
lockLandscape();          // granted when installed off the manifest; refused in a tab

openDb().then(function (d) {
  db = d;
  return migrateLegacy().then(allEntries);
}).catch(function () {
  dbBroken = true;
  return [];
}).then(function (rows) {
  S.items = rows || [];
  render();
  if (new URLSearchParams(location.search).get('open') === 'log') show('log');
  openCamera(false);     // the road is the point; do not make them ask for it
  prefetchModel();       // and have the model ready before the first tap
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  });
}

