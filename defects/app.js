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
var BUILD = '2026-09-04 · 56';

var STALE_MS = 30000;   // a fix older than this is called out, not trusted quietly
var POOR_ACC = 25;      // metres; wider than this and you cannot find the defect again
var MAX_EDGE = 1600;    // longest side of a saved photograph

/* ---------- how old a fix may be, and what it costs ----------

   maximumAge was five seconds. At 30 mph a vehicle covers 13.4 metres a
   second, so the browser was free to hand back a position sixty-seven metres
   behind the camera and the app had no way to know it had. For a survey done
   at a walking pace that is invisible; for one done from a windscreen mount it
   is the difference between two roads.

   One second is asked for instead. The trade is real and is worth stating:

     Battery. watchPosition with enableHighAccuracy already keeps the GNSS
     receiver running; maximumAge governs whether a cached fix may be reused,
     not how often the chip is woken. The cost of asking for a fresher one is
     therefore small — but it is not nothing, because fewer cache hits means
     more fixes are actually computed.

     Reliability. A tighter window does not make the browser produce fixes it
     does not have. It makes it hand back the one it has, which is what the
     age is recorded for. Nothing here fails because a fix is old; the app
     simply stops using an old one to place a defect.

     Accuracy. This buys nothing about how good a fix is — only about how
     current. A ±10 m fix from a second ago and a ±10 m fix from five seconds
     ago are equally vague about where you were, and the second one is wrong
     about where you are.

   The timeout stays at fifteen seconds. It governs how long the browser may
   take to produce the first fix in a cold start under trees, and shortening it
   would turn a slow fix into an error rather than a fix. */
var FIX_MAX_AGE_MS = 1000;    // how stale a cached fix may be before one is computed
var GPS_TIMEOUT_MS = 15000;   // how long a cold start may take before it is an error

/* Separately from either: how old the fix behind a frame may be before it is
   no longer good enough to say where the defect was. Three seconds is 40 m at
   30 mph, which is already generous; past it the app records the raw fix and
   declines to estimate a defect position from it. */
var USABLE_FIX_MS = 3000;

/* ---------- the camera lead ----------

   The defect is not where the vehicle is. It is on the road ahead, inside the
   part of the frame the camera can see, which for a phone on a windscreen
   mount is somewhere between about five and fifteen metres in front of the
   lens depending on the mount angle, the height and the lens.

   This is the one number in the app that has to be calibrated against reality
   and has not been. It is exposed rather than buried for exactly that reason:
   drive a known pothole, compare what the app recorded against where the hole
   actually is, and set this to what closes the gap. Until somebody does that,
   eight metres is a guess, the app says so, and the uncertainty it adds to
   every estimate is the whole of the lead — a ±100% error bar on a number
   nobody has measured. */
var CAMERA_LEAD_M = 8;
var LEAD_STORE = 'deflog.lead';
var LEAD_UNCERTAINTY = 1.0;   // ±100% of the lead, because it is uncalibrated
var LEAD_MAX_M = 60;          // beyond this somebody has typed a number, not a lead

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
/* THE MODEL REGISTRY.

   Until now there was one model id in one constant, and an entry in the log
   carried no record of what produced it. That is fine while there is only ever
   one model and it never changes. It stops being fine the moment a second one
   is being considered: every observation already in the log becomes evidence of
   unknown provenance, and "the new model found more" cannot be told from "we
   drove down a worse road".

   So each model is declared here with what it is, what it was trained on, and
   when it arrived, and every observation is stamped with the one that made it.

   The baseline is not a default that happens to be first in the list. It is the
   model this survey is known to work with, it is marked as such, and nothing in
   the app can select its way out of having one: an unknown key, a model that
   will not load, a registry someone has edited badly — all of them end up back
   here. Adding a candidate does not deploy it; ACTIVE_MODEL does, and only a
   person editing that line does. */
var MODELS = [
  { key: 'yolov8n-t3',
    name: 'YOLOv8n pothole/manhole',
    version: 1,
    baseline: true,
    modelId: 'jonathan-longden-s-workspace/pothole-fine-tuning-ghl9u-54ssb-1-yolov8n-t3',
    project: 'pothole-fine-tuning-ghl9u-54ssb',
    projectVersion: 1,
    arch: 'yolov8n',
    decoder: 'yolov8',
    runtime: 'tfjs graph model · WASM, CPU fallback',
    input: 640,
    classes: ['manhole', 'pothole'],
    /* What is actually known about the training run, and no more. The split,
       the class balance and the metrics live in Roboflow and have never been
       read into this repository; the report says UNKNOWN rather than a number
       somebody would later quote. */
    dataset: 'fork of pothole-model-for-zed-cameras/pothole-fine-tuning-ghl9u',
    datasetVersion: '1',
    datasetImages: 17497,
    epochs: 50,
    addedAt: '2026-08-19' }
];

/* Which one the survey runs. Deliberately a constant and not a setting: a
   model swap is a decision with evidence behind it, not a toggle to be found by
   somebody scrolling through a diagnostics screen at the roadside. */
var ACTIVE_MODEL = 'yolov8n-t3';

/* Why the app is not running what was asked for, when that happens. Read by the
   diagnostics; null when nothing went wrong. */
var modelFallback = null;

function baselineModel() {
  for (var i = 0; i < MODELS.length; i++) if (MODELS[i].baseline) return MODELS[i];
  return MODELS[0] || null;
}
function modelByKey(k) {
  for (var i = 0; i < MODELS.length; i++) if (MODELS[i].key === k) return MODELS[i];
  return null;
}
/* The model in force. Never null while the registry has anything in it, and
   never something the registry does not describe. */
function activeModel() {
  var m = modelByKey(ACTIVE_MODEL);
  if (m) return m;
  var b = baselineModel();
  if (b && !modelFallback) {
    modelFallback = { asked: ACTIVE_MODEL, using: b.key,
                      why: 'no model with that key is in the registry',
                      at: new Date().toISOString() };
  }
  return b;
}
/* What goes on an observation. Flat scalars on purpose: these travel into the
   CSV and the GeoJSON, and a nested object is what makes a GIS import quietly
   drop a column. */
function modelStamp() {
  var m = activeModel();
  if (!m) return {};
  return { modelKey: m.key, modelName: m.name, modelVersion: m.version,
           modelArch: m.arch, modelInput: m.input,
           modelRuntime: m.runtime, datasetVersion: m.datasetVersion };
}
/* A model that returns the wrong number of classes is not a model that is doing
   badly — it is a different model, or a broken export, and decoding it against
   this registry's class names would put confident nonsense in the log.

   The count checked is the one the decoder is about to USE, not the raw output
   shape. Both layouts are real — [1, 6, 8400] and [1, 8400, 6] — and this app
   has already been burned by reading one as the other, so a check that assumed
   which axis the channels were on would be asserting the very thing in doubt.
   After the transpose there is no ambiguity left: whatever numClasses says is
   what the class names will be matched against. */
function modelValidate(numClasses, m) {
  m = m || activeModel();
  if (!m || typeof numClasses !== 'number' || !isFinite(numClasses)) return null;
  if (numClasses !== m.classes.length) {
    return 'the graph decodes to ' + numClasses + ' classes; ' + m.name +
           ' is registered with ' + m.classes.length + ' (' + m.classes.join(', ') +
           '). This is not the model the registry describes.';
  }
  return null;
}

var RF_MODEL_ID = activeModel().modelId;
var RF_MODEL = activeModel().project;              // only the fallback path uses these
var RF_VERSION = activeModel().projectVersion;

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
/* The frame the model is shown: a ROAD CROP, square, then scaled.

   It stretched until build 55, letterboxed until 56, and neither was right for
   a 2340x1080 frame. The stretch put a 2.17x distortion through the model. The
   letterbox fixed the shape and paid for it in resolution: preserving the ratio
   means scaling both axes by the SMALLER factor, so the road lost more than
   half its vertical detail and 54% of the square was padding the model still
   had to process.

   A square crop of the road band is the only variant that improves both axes at
   once — on 2340x1080, x3.80 horizontally and x1.76 vertically against the
   stretch, with no distortion and no padding. A 0.3 m pothole at 15 m goes from
   about 11 x 3 px in the tensor to 42 x 6, across the 8 px stride in both
   directions for the first time.

   What it costs is field of view: on a 2340-wide frame the crop is about 26% of
   the width. Verges, kerb lines and anything at the edge of the carriageway are
   outside the frame the model sees. That is the trade, and the diagnostics say
   what the crop was so it is never a surprise.

   ROAD_TOP and ROAD_BOT are where the road is in a frame taken through a
   windscreen: below the horizon, above the bonnet. Fractions rather than
   pixels, so the same numbers work whatever the camera hands over. */
var ROAD_TOP = 0.35, ROAD_BOT = 0.92;

function squareFrame(source, w, h) {
  var c = document.createElement('canvas');
  c.width = RF_SIZE; c.height = RF_SIZE;
  var ctx = c.getContext('2d', { willReadFrequently: true });

  /* The band, then the largest square that fits inside it. A frame narrower
     than its own road band — a portrait camera — gives a square limited by the
     width instead, centred on the band rather than hanging off it. */
  var top = Math.round(h * ROAD_TOP), bot = Math.round(h * ROAD_BOT);
  var band = Math.max(1, bot - top);
  var side = Math.max(1, Math.min(w, band));
  var cx = Math.round((w - side) / 2);
  var cy = Math.round(top + (band - side) / 2);
  cy = Math.max(0, Math.min(cy, Math.max(0, h - side)));

  var s = RF_SIZE / side;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, RF_SIZE, RF_SIZE);
  ctx.drawImage(source, cx, cy, side, side, 0, 0, RF_SIZE, RF_SIZE);

  return { canvas: c, ctx: ctx,
           fit: { s: s, padX: 0, padY: 0, cropX: cx, cropY: cy,
                  cropW: side, cropH: side, dw: RF_SIZE, dh: RF_SIZE,
                  srcW: w, srcH: h } };
}

/* A model box, in the 640 square, back to the coordinates of whatever was
   handed to squareFrame. One function, so there is one place to be right. */
function fitToSource(box, fit) {
  if (!box || !fit) return null;
  var x = fit.cropX + (box.x - fit.padX) / fit.s;
  var y = fit.cropY + (box.y - fit.padY) / fit.s;
  var w = box.w / fit.s, h = box.h / fit.s;
  /* A box may straddle the padding: the model is shown those bars and is free
     to draw across them. Mapped back, that lands outside the photograph — a
     box starting above row zero, or running past the bottom edge. Clamped to
     the picture, because the part over the padding corresponds to nothing that
     was photographed, and a box drawn off the edge of the evidence is worse
     than one that stops at it. */
  var x0 = Math.max(0, Math.min(x, fit.srcW));
  var y0 = Math.max(0, Math.min(y, fit.srcH));
  var x1 = Math.max(0, Math.min(x + w, fit.srcW));
  var y1 = Math.max(0, Math.min(y + h, fit.srcH));
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
}

/* Survey mode: the camera runs and the model watches it, and anything it finds
   is written down without being asked. Three numbers govern how that behaves.

   The same hole stays in shot for many frames and, from a moving vehicle, for
   many metres, so without a memory a single pothole becomes fifty entries. A
   find is ignored if one was already logged within NEAR_M of it; with no fix to
   compare, the fallback is time alone, which is cruder and is why a survey
   without GPS says so. SURVEY_CONF is higher than the deliberate-capture
   threshold because nobody is looking at these before they land. */
var SURVEY_MS = 1200;    // between looks when there is no speed to go on
var SURVEY_CONF = 0.65;  // unattended entries should be surer than watched ones
var NEAR_M = 20;         // kept: the distance an older build called "the same defect"
var QUIET_MS = 45000;    // with no fix, this long before the same view counts again

/* ---------- one look every so many metres, rather than every so many seconds ----------

   A fixed 1.2-second cadence means a survey at 40 mph looks every 21 metres and
   the same survey stopped at a red light looks every 21 centimetres. The
   interval that matters to a survey is a distance: one look per stretch of
   road, so coverage does not change with the traffic.

   Speed is what turns one into the other, and it is not always reported — so
   this is a refinement of the old behaviour rather than a replacement for it.
   With no speed the fixed interval stands. The clamps stop it becoming silly at
   either end: below the floor the phone cannot finish one inference before the
   next is due, and above the ceiling a survey crawling in traffic would stop
   looking at the road altogether. */
var SURVEY_M = 10;        // metres of road per look
var LOOK_MIN_MS = 700;    // faster than this and inference cannot keep up
var LOOK_MAX_MS = 4000;   // slower than this and a crawl stops being a survey

/* ---------- what counts as standing still ----------

   A vehicle stopped with a pothole in shot will photograph it as many times as
   it is asked to. Below a metre a second nothing new is coming into frame, so
   nothing new is looked for: it saves the battery and it stops a queue at a
   junction becoming forty rows.

   Only when the speed is actually known. A device that does not report one is
   not standing still — it is a device that does not report a speed, and
   treating the two the same would silently stop the survey on hardware that
   works perfectly well. */
var STATIONARY_MPS = 1;

/* ---------- telling one defect from the one before it ----------

   The old test compared the current vehicle position against the vehicle
   position of the single most recent find. One slot, so driving past a defect,
   logging something else twenty-five metres on and coming back logged the first
   one again; and vehicle-to-vehicle rather than defect-to-defect, so it was
   really asking "have I moved" rather than "is this the same hole".

   A small ring of recent finds replaces it, and a candidate has to match one of
   them on position, on heading and on time before it is called the same defect.
   The position threshold scales with how good the fixes actually are, because a
   fixed radius is either too tight for a poor fix or too loose for a good one —
   and past a point the fixes are too vague to separate anything at all, at
   which point position is abandoned rather than trusted. */
var RECENT_MAX = 30;         // finds kept in mind during a run
var DUP_MIN_M = 15;          // never call two things the same when they are further apart
var DUP_MAX_M = 60;          // beyond this the fixes cannot tell anything apart
var DUP_HEADING_DEG = 45;    // seen travelling the other way is the other carriageway
var DUP_WINDOW_MS = 60000;   // recent enough to still be the same hole in shot
var DUP_TRAVEL_M = 30;       // or the vehicle has not gone far enough to have left it
var TEX_MIN = 1.18;      // below this the dark patch is grained like the road around it
var ASPECT_MAX = 4.5;    // a band far longer than it is wide is a shadow, not a hole

var TYPES = ['Pothole', 'Edge deterioration', 'Spalled crack / material loss',
             'Ironwork', 'Street furniture', 'Other'];

/* items holds observations; defects holds the things they are observations of.
   The two are separate lists on purpose — the log shows the first and the
   second is what any later grouping, trend or repair check would hang off. */
var S = { imp: 0, prob: 0, foot: false, by: null,
          prevUrl: null, gps: null, det: null, tag: '',
          items: [], defects: [] };
var stream = null, watchId = null, ageTimer = null, urls = [], lbUrl = null;

/* ---------- store ---------- */
/* IndexedDB, with the whole thing degrading to memory if the browser won't
   give us one (private windows, storage switched off). The difference from the
   prototype is that the degradation is announced. */
/* ---------- an observation is not a defect ----------

   Every row in this app used to be a sighting, and a sighting was treated as a
   thing. Drive the same road twice and you have two defects; drive it fifty
   times and you have fifty. Nothing downstream of that works — you cannot say a
   defect is getting worse, or that a repair happened, or how sure you are that
   it exists at all, because there is nothing for those to be properties of.

   Two stores now. An observation is one detection event: a frame, a box, a
   position, a photograph, and it never changes after it is written. A defect is
   the thing in the road that observations are of, and it does change — it gains
   observations, its position estimate improves, its status moves on.

   The store names are historical and are deliberately left alone: `defects`
   holds observations, because renaming an object store means copying every
   photograph in it and there is no version of that worth the risk. The code
   says observation everywhere it means one. */
var DB_NAME = 'deflog', STORE = 'defects', WRONG = 'wrong', PHYS = 'physical';
/* Version 4 adds two stores and touches nothing that was already there.
   FOOT holds one sidecar record per recording — when, how long, what
   resolution, which way up. FOOTC holds the recording itself, in the
   pieces MediaRecorder hands over, because a drive's worth of video
   assembled in memory before it is written is the phone running out of
   it. The key is a string rather than a compound one so a range read is
   the same on every engine. */
var FOOT = 'footage', FOOTC = 'footchunk';
var db = null, dbBroken = false;

/* Timestamp ids were fine for one device and are not for two. Two phones
   surveying the same round produce colliding ids within a millisecond of each
   other, and the day anything is combined the collision is silent. */
function uuid() {
  if (self.crypto && crypto.randomUUID) return crypto.randomUUID();
  var b = new Uint8Array(16), i;
  if (self.crypto && crypto.getRandomValues) crypto.getRandomValues(b);
  else for (i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;      // version 4
  b[8] = (b[8] & 0x3f) | 0x80;      // variant 1
  var h = [];
  for (i = 0; i < 16; i++) h.push((b[i] + 0x100).toString(16).slice(1));
  return h.slice(0, 4).join('') + '-' + h.slice(4, 6).join('') + '-' +
         h.slice(6, 8).join('') + '-' + h.slice(8, 10).join('') + '-' +
         h.slice(10, 16).join('');
}

function openDb() {
  return new Promise(function (resolve, reject) {
    if (!self.indexedDB) return reject(new Error('no IndexedDB'));
    var req = indexedDB.open(DB_NAME, 4);
    req.onupgradeneeded = function () {
      var d = req.result;
      if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE, { keyPath: 'id' });
      /* Corrections live beside the log rather than in it. A thing you have said
         is not a defect must never read as a defect, and deleting it outright
         throws away the only examples a retrain could learn this from. */
      if (!d.objectStoreNames.contains(WRONG)) d.createObjectStore(WRONG, { keyPath: 'id' });
      /* Version 3. The observations already in the store are not touched here —
         adding the store is all the schema change there is, and giving the
         existing rows their defects is done afterwards in ordinary code, where
         a failure can be reported rather than aborting an upgrade transaction
         and leaving the database on the old version with no explanation. */
      if (!d.objectStoreNames.contains(PHYS)) d.createObjectStore(PHYS, { keyPath: 'defect_id' });
      /* Version 4. Additive in exactly the same way: two new stores, and not a
         line that reads or rewrites an observation. Footage is a diagnostic
         that happens to live in the same database; it must never be able to
         cost somebody their survey. */
      if (!d.objectStoreNames.contains(FOOT)) d.createObjectStore(FOOT, { keyPath: 'id' });
      if (!d.objectStoreNames.contains(FOOTC)) d.createObjectStore(FOOTC, { keyPath: 'key' });
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

function putPhys(d) { return tx('readwrite', function (s) { return s.put(d); }, PHYS); }
function delPhys(id) { return tx('readwrite', function (s) { return s.delete(id); }, PHYS); }
function allPhys() {
  return tx('readonly', function (s) { return s.getAll(); }, PHYS)
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

/* ---------- zoom ----------

   At 34 mph a pothole is in frame for about one look, and at 15 m it is roughly
   eleven pixels wide and one and a half tall in the tensor. Zoom is the one
   lever that changes that arithmetic without touching the model: it puts more
   sensor pixels on the road ahead before anything is resized.

   It has to happen at the TRACK, not afterwards. Cropping the 640 square would
   be the same pixels enlarged — no new detail, a narrower field of view, and a
   quiet lie in the diagnostics. So this drives MediaStreamTrack.applyConstraints
   and then reads getSettings back to find out what the camera actually did,
   because asking and being obeyed are different things.

   Support is narrow and this says so rather than pretending. */

/* The zoom the survey wants. One constant, because the number appears on a
   button, in the diagnostics, in what is asked of the camera and in what the
   tests check — and four of those drifting apart is how a screen ends up
   claiming 4x while the camera is at 2. */
var ZOOM_WANT = 4;

var zoom = { supported: false, requested: ZOOM_WANT, actual: null, min: null,
             max: null, step: null, why: 'not looked at yet', asked: null };

function zoomTrack() {
  if (!stream) return null;
  return stream.getVideoTracks()[0] || null;
}

/* What this camera can actually do. Read from the track rather than assumed
   from the browser name: two phones running the same Chrome differ, and the
   same phone differs between its front and back cameras. */
function zoomProbe() {
  var t = zoomTrack();
  zoom.actual = null;
  if (!t) {
    zoom.supported = false; zoom.why = 'the camera is not running';
    return zoom;
  }
  if (!t.getCapabilities) {
    zoom.supported = false;
    zoom.why = 'this browser has no getCapabilities — zoom cannot be asked for';
    return zoom;
  }
  var caps = {};
  try { caps = t.getCapabilities() || {}; }
  catch (e) {
    zoom.supported = false;
    zoom.why = 'getCapabilities threw: ' + String((e && e.message) || e);
    return zoom;
  }
  if (!('zoom' in caps)) {
    zoom.supported = false;
    zoom.why = 'this camera reports no zoom capability';
    zoom.min = zoom.max = zoom.step = null;
    return zoom;
  }
  var z = caps.zoom || {};
  zoom.supported = true;
  zoom.why = null;
  zoom.min = z.min == null ? null : z.min;
  zoom.max = z.max == null ? null : z.max;
  zoom.step = z.step == null ? null : z.step;
  try {
    var st = t.getSettings ? t.getSettings() : {};
    zoom.actual = st.zoom == null ? null : st.zoom;
  } catch (e) {}
  return zoom;
}

/* The nearest value this camera will accept. A device whose range stops at 1.5
   should go to 1.5 rather than fail, and one with a step of 0.5 should not be
   asked for 2.3 — being refused for asking a fraction too precisely is a
   pointless way to have no zoom. */
function zoomNearest(want) {
  var lo = zoom.min == null ? 1 : zoom.min;
  var hi = zoom.max == null ? want : zoom.max;
  var v = Math.min(hi, Math.max(lo, want));
  if (zoom.step && zoom.step > 0) {
    v = lo + Math.round((v - lo) / zoom.step) * zoom.step;
    v = Math.min(hi, Math.max(lo, v));
    /* Steps are floats and floats drift; 1.9999999999 is not a value anybody
       should read on a diagnostics screen. */
    v = Math.round(v * 1e6) / 1e6;
  }
  return v;
}

function zoomApply(want) {
  zoom.requested = want;
  zoomProbe();
  var t = zoomTrack();
  if (!t || !zoom.supported) { paintZoom(); return Promise.resolve(zoom); }
  var v = zoomNearest(want);
  zoom.asked = v;
  /* advanced: a plain constraint is a requirement and is rejected outright by
     some implementations; advanced is best-effort, which is why the result is
     read back rather than believed. */
  return t.applyConstraints({ advanced: [{ zoom: v }] }).then(function () {
    var st = {};
    try { st = t.getSettings ? t.getSettings() : {}; } catch (e) {}
    zoom.actual = st.zoom == null ? null : st.zoom;
    /* Applied without complaint and did nothing is a real outcome on some
       cameras, and it must not read as success. */
    if (zoom.actual == null) {
      zoom.why = 'the camera accepted the request but reports no zoom setting back';
    } else if (Math.abs(zoom.actual - v) > (zoom.step || 0.01)) {
      zoom.why = 'asked for ' + v + ' and the camera settled at ' + zoom.actual;
    } else {
      zoom.why = null;
    }
    paintZoom();
    return zoom;
  }, function (e) {
    zoom.why = 'the camera refused it: ' + String((e && e.name) || (e && e.message) || e);
    try {
      var st = t.getSettings ? t.getSettings() : {};
      zoom.actual = st.zoom == null ? null : st.zoom;
    } catch (x) {}
    paintZoom();
    return zoom;
  });
}

/* What the diagnostics and the entry metadata quote: what the camera IS doing,
   never what it was asked to do. */
function zoomNow() {
  var t = zoomTrack();
  if (!t || !t.getSettings) return null;
  try {
    var st = t.getSettings() || {};
    return st.zoom == null ? null : st.zoom;
  } catch (e) { return null; }
}

function paintZoom() {
  var box = $('zoomPills');
  if (!box) return;
  var t = zoomTrack();
  box.hidden = !t;
  if (!t) return;
  var on = zoom.actual != null && zoom.actual > 1.01;
  $('zoom1').setAttribute('aria-pressed', String(!on));
  $('zoomIn').setAttribute('aria-pressed', String(on));
  $('zoomIn').textContent = ZOOM_WANT + '×';
  var un = !zoom.supported;
  $('zoom1').disabled = un;
  $('zoomIn').disabled = un;
  $('zoomNote').textContent = un
    ? ZOOM_WANT + '× zoom unavailable on this camera'
    : (zoom.why ? zoom.why : (zoom.actual == null ? '' : zoom.actual + '× applied'));
  $('zoomNote').hidden = !un && !zoom.why && zoom.actual == null;
}

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
    footPaint();         // recording needs a stream, so the button follows it
    /* 4× is what the survey wants, so the camera is asked for it as it opens
       rather than waiting for somebody to remember a button at the roadside.
       On a camera with no zoom this does nothing at all and says so; on one
       whose range stops short it goes as far as it goes and reports the number
       it reached. It never pretends. */
    zoomProbe();
    paintZoom();
    if (zoom.supported) zoomApply(ZOOM_WANT);
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
  releaseWake();          // in case the survey was already off and the lock was not
  /* A recorder whose track has been stopped does not pause, it errors. The
     footage is a diagnostic and must never be the thing that breaks closing
     the camera, so it is ended first and its failure is its own. */
  if (foot.on) { try { footStop('camera closed'); } catch (e) {} }
  if (stream) { stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; }
  if (watchId != null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
  if (ageTimer) { clearInterval(ageTimer); ageTimer = null; }
  /* The last fix goes with the camera. Keeping it means the next find — which
     could be a mile down the road — gets tagged with where you were standing
     when you last stopped. */
  S.gps = null;
  $('badge').textContent = 'Camera off';
  zoom.supported = false; zoom.actual = null; zoom.why = 'the camera is not running';
  paintZoom();
  footPaint();
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

/* A number, or null. Never a substitute.

   coords.heading and coords.speed are absent far more often than they are
   present: a phone reports a heading only while it is moving, and some devices
   never report a speed at all. What comes back for those is null, or NaN, or
   occasionally a negative. All of it means "not known", and all of it becomes
   null here — because a survey that filled in a plausible zero would be
   claiming the vehicle was pointing north and standing still, which is a
   statement about the world rather than an absence of one. */
function reading(v, lo, hi) {
  /* null, undefined and '' have to be rejected before the coercion rather than
     after it, because +null is 0 and +'' is 0 — so "the device did not report a
     heading" would come out of this as a confident due north, and "no camera
     lead has been set" as a lead of zero metres. Both were exactly the kind of
     fabricated reading this function exists to prevent, and both got past it
     until the suite caught them. */
  if (v === null || v === undefined || v === '') return null;
  var n = +v;
  return (isFinite(n) && n >= lo && n <= hi) ? n : null;
}

/* Where a point that far along that bearing lands. Great-circle, which is
   overkill at eight metres and costs nothing. */
function project(lat, lon, bearingDeg, metres) {
  var R = 6371000, rad = Math.PI / 180;
  var d = metres / R, br = bearingDeg * rad, la1 = lat * rad, lo1 = lon * rad;
  var la2 = Math.asin(Math.sin(la1) * Math.cos(d) +
                      Math.cos(la1) * Math.sin(d) * Math.cos(br));
  var lo2 = lo1 + Math.atan2(Math.sin(br) * Math.sin(d) * Math.cos(la1),
                             Math.cos(d) - Math.sin(la1) * Math.sin(la2));
  return { lat: la2 / rad, lon: ((lo2 / rad + 540) % 360) - 180 };
}

function cameraLead() {
  var v = null;
  try { v = localStorage.getItem(LEAD_STORE); } catch (e) {}
  var n = reading(v, 0, LEAD_MAX_M);
  return n == null ? CAMERA_LEAD_M : n;
}

/* ---------- where the defect probably is ----------

   Given the fix behind a frame and when that frame was taken, put a point on
   the road ahead and say how wrong it might be. Everything it needs is
   something the app now records; anything missing means no estimate rather
   than a worse one, and the reason travels with the entry so the log can say
   why a find has no estimated position.

   The error bar is deliberately pessimistic and is the sum of three separate
   ignorances, not a statistical combination of them:

     the fix's own accuracy — how vague the GPS is about where the vehicle was;
     the whole of the camera lead — because nobody has calibrated it;
     half the distance travelled between the fix and the frame.

   Adding them rather than combining them in quadrature means the number is
   larger than a careful treatment would give. That is the right direction to
   be wrong in: the radius is a promise that the defect is probably inside it,
   and a promise that is too generous costs somebody a longer look, while one
   that is too tight sends them to the wrong place. */
function estimatePosition(fix, capturedAt, leadM) {
  if (!fix) return { lat: null, lon: null, confM: null, by: null, why: 'no fix' };
  var age = capturedAt - fix.at;
  if (!(age >= 0)) age = 0;
  if (age > USABLE_FIX_MS) {
    return { lat: null, lon: null, confM: null, by: null,
             why: 'the fix was ' + Math.round(age / 100) / 10 + ' s old when the frame was taken' };
  }
  if (fix.heading == null) {
    return { lat: null, lon: null, confM: null, by: null,
             why: 'no heading — a phone reports one only while it is moving' };
  }
  var travel = fix.speed == null ? 0 : fix.speed * (age / 1000);
  var lead = leadM == null ? cameraLead() : leadM;
  var p = project(fix.lat, fix.lon, fix.heading, lead + travel);
  var conf = fix.acc + lead * LEAD_UNCERTAINTY + travel * 0.5;
  /* With no speed, the distance covered between fix and frame is unknown
     rather than zero, so the lead's own width stands in for it. */
  if (fix.speed == null) conf += lead;
  return { lat: p.lat, lon: p.lon, confM: Math.ceil(conf),
           by: 'projected along heading', why: null,
           leadM: lead, travelM: Math.round(travel * 10) / 10 };
}

/* The one place that decides which of an entry's two positions to use.

   An entry can carry both: where the vehicle was, which is measured, and where
   the defect probably is, which is worked out from it. Anything pointing a
   person at the road wants the second — the map pin, the three-word address,
   the geometry in a GeoJSON export. Anything reporting what was measured wants
   the first, and gets it under the field names it has always had.

   Entries logged before this existed, and entries logged with no heading, have
   only the vehicle position. They come back marked as such rather than
   silently promoted. */
function bestPos(it) {
  if (!it) return null;
  if (it.estLat != null && it.estLon != null) {
    return { lat: it.estLat, lon: it.estLon, confM: it.posConfM,
             source: 'estimated', estimated: true };
  }
  if (it.lat != null && it.lon != null) {
    return { lat: it.lat, lon: it.lon, confM: it.acc == null ? null : it.acc,
             source: 'vehicle', estimated: false };
  }
  return null;
}

function startGps() {
  if (!navigator.geolocation) { $('recTxt').textContent = 'No GPS'; gauge('rec', 'No GPS', 'none'); return; }
  $('gpsBox').hidden = false;
  watchId = navigator.geolocation.watchPosition(function (p) {
    var c = p.coords;
    S.gps = {
      lat: c.latitude, lon: c.longitude, acc: c.accuracy, at: Date.now(),
      /* Free, already in the payload, and never captured until now. A heading
         is what separates the two carriageways of a dual carriageway; without
         one there is no way to tell a defect seen going north from a different
         defect seen going south at the same coordinates. */
      heading: reading(c.heading, 0, 360),
      speed: reading(c.speed, 0, 200)
    };
    $('mLat').textContent = S.gps.lat.toFixed(6);
    $('mLon').textContent = S.gps.lon.toFixed(6);
    $('mAcc').textContent = '±' + Math.round(S.gps.acc) + ' m';
    $('mAcc').className = S.gps.acc > POOR_ACC ? 'warn' : '';
    $('mHead').textContent = S.gps.heading == null ? 'not reported'
      : Math.round(S.gps.heading) + '°';
    $('mSpeed').textContent = S.gps.speed == null ? 'not reported'
      : (S.gps.speed * 2.23694).toFixed(1) + ' mph';
    paintFix();
  }, function (err) {
    /* A refusal and a timeout are not the same problem and used to produce the
       same message. Only the first is permanent, and only the first is worth
       telling somebody to go and change a setting for. */
    var denied = err && err.code === 1;
    if (denied) {
      $('recTxt').textContent = 'GPS denied'; gauge('rec', 'GPS denied', 'none');
      S.gps = null; $('gpsBox').hidden = true;
      toast('Location was refused, so finds will be logged with no coordinates — they cannot go ' +
            'on the map or into GeoJSON. Allow it for this site, then stop and start the camera.');
      return;
    }
    /* No fix yet. The watch is still running and may well produce one, so the
       last fix is left where it is and the strip says what is happening. */
    if (!S.gps) { $('recTxt').textContent = 'Waiting for GPS'; gauge('rec', 'No fix yet', 'poor'); }
    toast(err && err.code === 3
      ? 'No GPS fix yet — still trying. Under trees or between buildings this can take a while.'
      : 'The device could not work out where it is. Still trying.');
  }, { enableHighAccuracy: true, maximumAge: FIX_MAX_AGE_MS, timeout: GPS_TIMEOUT_MS });
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
    bits.push('it was ' + it.fixAge + ' seconds old when the frame was taken');
  }
  if (!bits.length) n.className = 'fixnote ok';

  /* Two positions, said as two things. The vehicle's is measured; the
     defect's is worked out from it and carries a radius that is deliberately
     generous. Reading them as one number is exactly the mistake this is here
     to prevent. */
  var est = (it.estLat != null)
    ? '<br><b>Estimated defect position.</b> ' + it.estLat.toFixed(5) + ', ' +
      it.estLon.toFixed(5) + ' — ' + (it.cameraLeadM || cameraLead()) + ' m along a heading of ' +
      Math.round(it.headingDeg) + '°, and it could be anywhere within ±' + it.posConfM +
      ' m of that. The camera lead has not been calibrated against a known defect, so most of ' +
      'that radius is the app admitting it does not know how far ahead it is looking.'
    : '<br><b>No estimated defect position.</b> ' + esc(it.estWhy || 'not enough to work one out') +
      ', so what is recorded is where the vehicle was and not where the defect is.';

  n.innerHTML = '<b>Vehicle position.</b> ' + it.lat.toFixed(5) + ', ' + it.lon.toFixed(5) +
    ' at ±' + it.acc + ' m' +
    (bits.length ? ' — ' + bits.join(', ') + '. It stands as it is, and stays flagged in the log.'
                 : '. Kept with the entry.') + est;
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

  /* Confirming an observation is also a person standing over the defect it is
     an observation of, so the category and the signature travel up to it. That
     is the only route by which a defect ever gets a statutory category. */
  var d = it.defect_id ? defectById(it.defect_id) : null;
  var upward = Promise.resolve();
  if (d) {
    d.statCat = it.statCat; d.statResp = it.statResp;
    d.catBy = it.catBy; d.catAt = it.catAt;
    d.verifiedBy = it.catBy; d.verifiedAt = it.catAt;
    d.type = it.type;
    if (it.score != null) { d.score = it.score; d.priority = it.priority || d.priority; }
    d.updated_at = it.catAt;
    d.status = defectStatus(d);
    upward = dbBroken ? Promise.resolve() : putPhys(d).catch(function () {});
  }

  upward.then(function () {
    return dbBroken ? Promise.resolve() : putEntry(it);
  }).then(function () {
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
    modelChip(noModelWord(), 'bad');
  });
}

/* "No model" is two words and a shrug.

   Three separate things have to happen before there is a model: 2.4 MB of
   TensorFlow.js off this origin, the weights off Roboflow, and a backend that
   will run them. They fail for different reasons, they are fixed by different
   people, and the gauge said the same thing for all three — so the only way to
   tell them apart was to open Diagnostics and read the reason, which is a lot
   to ask of somebody standing at a van looking at a phone.

   The gauge now names the half. The reason still lives in Diagnostics; this is
   the difference between "it's broken" and "the signal is". */
function noModelWord() {
  if (!benchTf) return 'No runtime';
  /* Asked for and not got. A null rfMeta is NOT this case — it means the
     weights were never asked for, which is somebody else's failure and must not
     be pinned on the signal. */
  if (rfMeta && (rfMeta.error || !rfMeta.weights)) return 'No weights';
  if (infFacts.tried.length) return 'No backend';
  /* The runtime loaded and it fell over before the weights were reached. Rare,
     unclassified, and the old shrug is the honest answer: Diagnostics has the
     reason. */
  return 'No model';
}
window.addEventListener('online', prefetchModel);
/* And when the worker changes hands.

   Getting signal back is not the only thing that can turn a failed load into a
   working one: a deploy does it too. The page that installs a new worker was
   served by the old one, so its 2.4 MB may have failed under whatever the old
   one did — and the moment the new worker claims the page, the same request
   would succeed. The retry inside loadBenchTf covers the ordinary case; this
   covers a changeover slower than that retry was willing to wait for.

   prefetchModel does nothing if a load is already running or has succeeded, so
   this cannot start a second one. */
if (navigator.serviceWorker) {
  try {
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      prefetchModel();
    });
  } catch (e) { /* nothing to hook; the retry above is the cover */ }
}

/* Bringing the model up.

   This used to start the Roboflow SDK's worker, and the survey inferred through
   it. It cannot any more, and the reason is structural rather than a
   preference: the SDK bundles TensorFlow.js inside its worker and keeps it
   module-scoped — inside that worker self.tf is undefined — so the WASM backend
   has nothing to register itself against. WASM is 33x faster than the CPU
   backend the SDK fell back to, and 33x is the difference between surveying a
   road at 30 mph and at 1.25 mph, so the inference path moves here.

   What did NOT move: the preprocessing, the decoder, the NMS parameters and the
   640 square. Those are the same functions, called from a different place. The
   six-megabyte SDK is no longer fetched to look at a road. */
function loadModel() {
  if (loading) return loading;
  loading = loadBenchTf().then(function (tf) {
    return infCapabilities(tf).then(function () { return infPick(tf); });
  }).then(function (s) {
    infSession = s;
    infFacts.backend = s.backend;
    infFacts.startedAt = new Date().toISOString();
    engine = surveyEngine();
    /* A sentinel rather than a worker id. Everything that asks "is there a
       worker" is asking "can this thing be shown a picture", and now it can. */
    worker = 1;
    return engine;
  }).catch(function (e) {
    loading = null;   // a failure must not poison every later capture
    /* Kept so the diagnostics can say WHY there is no model. "No model" on the
       chip is two words and a shrug; when the failure happens before any
       backend is tried — the runtime itself not loading, say — the list of
       tried backends is empty and there was nothing else to read. */
    infFacts.startFail = { why: String((e && e.message) || e).slice(0, 200),
                           at: new Date().toISOString() };
    throw e;
  });
  return loading;
}

/* Three things can fail and they are not the same problem: the library did not
   load from this site, the model would not start, or the run itself broke. */
/* Four things can fail and they are not the same problem, and saying the wrong
   one costs a drive.

   This used to have three branches, written when the Roboflow SDK did the
   inferring: the library would not load, the model would not start, or the run
   broke. The SDK is gone, and with it the first branch's meaning — TensorFlow.js
   is served from this origin and does not need a network. So a phone with no
   signal now fails at the WEIGHTS, which are fetched from Roboflow, and the old
   code called that "the detection library would not load from this site". It is
   the same class of misattribution this file has been correcting all along:
   blaming the part that worked. */
function whyLocal(e) {
  var msg = e && e.message ? String(e.message).slice(0, 200) : '';
  var tail = msg ? ' (' + msg + ')' : '';
  if (!benchTf) {
    return 'The detection runtime would not load from this site.' + tail;
  }
  if (rfMeta && rfMeta.error) {
    return 'The model itself could not be fetched — that is the signal or the key, ' +
           'not the detector, which loaded.' + tail;
  }
  if (!engine || !worker) {
    return 'No backend on this phone could run the model.' + tail;
  }
  return 'The model failed while running.' + tail;
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
    return engine.infer(worker, { bitmapImage: bmp });
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

/* What a value actually is at runtime, named rather than assumed.

   Written because "raw.forEach is not a function" is the least useful thing a
   diagnostic can say: it names the method that was missing and nothing about
   the object that was missing it. Anything reaching here may be a list of
   detections, a tfjs Tensor, a typed array, a string the worker sent back, or
   an Error — and which one it is is the whole answer. */
function runtimeType(v) {
  if (v === null) return 'null';
  if (v === undefined) return 'undefined';
  if (Array.isArray(v)) return 'Array(' + v.length + ')';
  var t = typeof v;
  if (t === 'string') return 'string(' + v.length + ' chars)';
  if (t !== 'object' && t !== 'function') return t;
  var tag = Object.prototype.toString.call(v).slice(8, -1);
  /* Float32Array and the rest. DataView is a view too and has no length. */
  if (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(v) &&
      typeof v.length === 'number') {
    return tag + '(' + v.length + ')';
  }
  if (v instanceof Error) return 'Error';
  /* A tfjs Tensor, recognised by what it can do rather than by importing tfjs
     to ask it — the library keeps its own copy and this file has none. */
  if (v.shape && typeof v.dataSync === 'function') {
    return 'Tensor(' + [].concat(v.shape).join('×') + ')';
  }
  if (tag === 'Object') {
    var k = Object.keys(v);
    return 'Object{' + (k.length ? k.slice(0, 6).join(', ') + (k.length > 6 ? ', …' : '')
                                 : 'no keys') + '}';
  }
  return tag;
}

/* engine.infer resolves with a list of detections — except when it does not.

   The library turns a failed request into a RESOLVED promise carrying the
   worker's error payload, not a rejected one:

       .then((c) => c).catch((c) => {
         if (c === "Model initialization failed") throw new Error(...);
         return c;                    // <- the rejection becomes a value
       })

   So a worker that failed mid-inference arrives here looking like a successful
   answer, and the first thing done to it is a list operation. That is where
   "raw.forEach is not a function" came from: the real fault was thrown away by
   the library and replaced by a type error three frames later. This says what
   actually came back instead. */
function inferFault(v) {
  var msg = '';
  if (typeof v === 'string') msg = v;
  else if (v && typeof v.message === 'string') msg = v.message;
  else if (v && typeof v.error === 'string') msg = v.error;
  else {
    try { msg = JSON.stringify(v); } catch (e) { msg = String(v); }
  }
  return 'the model returned ' + runtimeType(v) + ' where a list of detections was ' +
         'expected' + (msg ? ' — ' + String(msg).slice(0, 300) : '');
}

/* What engine.infer last handed back, kept so the screen can print it whether
   the run succeeded or failed. */
var lastInferType = null;

function takeDiag(preds) {
  lastInferType = runtimeType(preds);
  /* Nothing at all is a legitimate answer: no detections. */
  if (preds === null || preds === undefined) return [];
  /* Anything else that is not a list is a failure wearing a success's clothes.
     Throwing here puts the real reason in front of whoever pressed the button,
     which is the whole point; returning an empty list would turn a broken
     worker into a quiet "nothing found". */
  if (!Array.isArray(preds)) throw new Error(inferFault(preds));
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
               recent: [], startedAt: null, clock: null,
               lastLookAt: null, lastLookFix: null, lastLookPos: null };

function metresBetween(a, b) {
  var R = 6371000, rad = Math.PI / 180;
  var dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  var la1 = a.lat * rad, la2 = b.lat * rad;
  var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
          Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/* The smaller of the two ways round a compass. 350° and 10° are 20° apart. */
function headingGap(a, b) {
  var d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/* How far apart two things can be and still be the same thing.

   Twice the worse of the two error bars, floored so a pair of very good fixes
   cannot start separating a hole from itself, and reported as unusable beyond
   the ceiling — at which point the caller falls back to time, because a
   threshold wide enough to cover a bad fix is wide enough to swallow every real
   neighbour on the street. */
function dupRadius(a, b) {
  var worst = Math.max(a == null ? 0 : a, b == null ? 0 : b);
  var r = Math.max(DUP_MIN_M, 2 * worst);
  return r > DUP_MAX_M ? null : r;
}

/* Have we already written this one down?

   Returns the recent find it matches, or null. Every test that can be applied
   has to agree before two things are called one thing, and a test that cannot
   be applied — no heading on one side, no position on either — abstains rather
   than voting either way. Suppressing a real defect is the more expensive
   mistake of the two, so the tie goes to logging it. */
function alreadyLogged(cand) {
  if (!cand) return null;
  var here = (cand.vlat != null) ? { lat: cand.vlat, lon: cand.vlon } : null;
  for (var i = survey.recent.length - 1; i >= 0; i--) {
    var r = survey.recent[i];

    /* Seen travelling the other way is the other carriageway, which is a
       different asset with a different owner's crew going to it. Only decisive
       when both headings are known. */
    if (cand.heading != null && r.heading != null &&
        headingGap(cand.heading, r.heading) > DUP_HEADING_DEG) continue;

    var dt = cand.at - r.at;
    var moved = (here && r.vlat != null) ? metresBetween(here, { lat: r.vlat, lon: r.vlon }) : null;
    /* Still recent enough to be the same hole still in shot: either not long
       ago, or the vehicle has not gone far enough to have left it behind. */
    var fresh = dt < DUP_WINDOW_MS || (moved != null && moved < DUP_TRAVEL_M);
    if (!fresh) continue;

    if (cand.lat != null && r.lat != null) {
      var radius = dupRadius(cand.confM, r.confM);
      if (radius == null) {
        /* The fixes are too vague to separate anything. Fall back to the crude
           rule the app used before it had positions worth trusting. */
        if (dt < QUIET_MS) return r;
        continue;
      }
      if (metresBetween(cand, r) < radius) return r;
      continue;
    }

    /* No position on one side or the other, so only time can settle it — and
       time alone cannot tell a second pothole from the first one still in
       shot. It errs towards not logging, which is why a survey with no fix
       says so on the screen. */
    if (dt < QUIET_MS) return r;
  }
  return null;
}

function rememberFind(cand) {
  survey.recent.push(cand);
  if (survey.recent.length > RECENT_MAX) survey.recent.shift();
  survey.last = { at: cand.at, gps: cand.vlat == null ? null : { lat: cand.vlat, lon: cand.vlon } };
}

/* ---------- the defect layer ----------

   Deliberately small. It does one thing: decide whether an observation is of a
   defect already known about, and keep a short record of the thing itself. It
   does not cluster retrospectively, it does not merge defects, and it does not
   run in the background. Anything cleverer than this belongs on a server with
   every device's observations in front of it, and building it here would mean
   building it twice.

   How far apart two observations can be and still be of the same defect. More
   generous than the within-a-run duplicate radius, because this is mostly
   asking about a later pass on a different day with a different fix, where the
   two error bars are independent rather than nearly identical. */
var SAME_DEFECT_MIN_M = 20;
var SAME_DEFECT_MAX_M = 80;

function defectRadius(a, b) {
  var r = Math.max(SAME_DEFECT_MIN_M, (a == null ? 0 : a) + (b == null ? 0 : b));
  return Math.min(r, SAME_DEFECT_MAX_M);
}

/* The nearest known defect this observation could be of, or null.

   Same type, close enough given both error bars, and pointing the same way
   where both headings are known. A defect with no position cannot be matched
   against — there is nothing to compare — so an observation with no fix always
   becomes its own defect rather than being attached to whichever one happened
   to be nearest in the list. */
function defectFor(obs) {
  var pos = bestPos(obs);
  if (!pos) return null;
  var best = null, bestD = Infinity;
  for (var i = 0; i < S.defects.length; i++) {
    var d = S.defects[i];
    if (d.type !== obs.type) continue;
    if (d.best_lat == null) continue;
    if (obs.headingDeg != null && d.heading != null &&
        headingGap(obs.headingDeg, d.heading) > DUP_HEADING_DEG) continue;
    var gap = metresBetween(pos, { lat: d.best_lat, lon: d.best_lon });
    if (gap < defectRadius(pos.confM, d.position_confidence_m) && gap < bestD) {
      best = d; bestD = gap;
    }
  }
  return best;
}

/* An observation's position, folded into the defect's.

   Weighted by 1/r², so a ±6 m observation moves the estimate a great deal more
   than a ±40 m one, and the combined radius shrinks as observations accumulate
   — but never below the best single one, because averaging vague positions
   cannot manufacture a precise one. */
function foldPosition(d, obs) {
  var pos = bestPos(obs);
  if (!pos) return;
  if (d.best_lat == null) {
    d.best_lat = pos.lat; d.best_lon = pos.lon;
    d.position_confidence_m = pos.confM;
    d.position_source = pos.source;
    return;
  }
  var ra = d.position_confidence_m, rb = pos.confM;
  if (ra == null || rb == null || ra <= 0 || rb <= 0) return;
  var wa = 1 / (ra * ra), wb = 1 / (rb * rb), w = wa + wb;
  d.best_lat = (d.best_lat * wa + pos.lat * wb) / w;
  d.best_lon = (d.best_lon * wa + pos.lon * wb) / w;
  d.position_confidence_m = Math.max(Math.ceil(Math.sqrt(1 / w)), Math.min(ra, rb));
  if (pos.source === 'estimated') d.position_source = 'estimated';
}

/* Provisional until a second pass agrees with the first, confirmed after that,
   verified once a person has been shown it and signed it off.

   Passes are counted as distinct survey runs, which is the only version of
   "independent" this app can honestly measure: fifty frames of one hole on one
   drive is one opinion, and three drives on three days is evidence. Defects
   migrated from before runs were recorded have no run ids at all, so their pass
   count is null rather than one — not knowing has to mean not knowing. */
function defectStatus(d) {
  if (d.verifiedAt) return 'verified';
  return (d.runs && d.runs.length >= 2) ? 'confirmed' : 'provisional';
}

function newDefect(obs, runId) {
  var pos = bestPos(obs);
  return {
    defect_id: uuid(),
    created_at: obs.capturedAt || obs.t,
    updated_at: obs.capturedAt || obs.t,
    type: obs.type,
    best_lat: pos ? pos.lat : null,
    best_lon: pos ? pos.lon : null,
    position_confidence_m: pos ? pos.confM : null,
    position_source: pos ? pos.source : null,
    heading: obs.headingDeg == null ? null : obs.headingDeg,
    /* The worst its observations have made it look, so a defect does not get
       quieter because the last pass caught it in shadow. */
    score: obs.score == null ? null : obs.score,
    priority: obs.priority || null,
    first_seen: obs.capturedAt || obs.t,
    last_seen: obs.capturedAt || obs.t,
    observation_count: 1,
    runs: runId ? [runId] : [],
    statCat: null, statResp: null, catBy: null, catAt: null,
    verifiedBy: null, verifiedAt: null,
    status: 'provisional'
  };
}

function foldObservation(d, obs, runId) {
  d.observation_count = (d.observation_count || 0) + 1;
  d.last_seen = obs.capturedAt || obs.t;
  d.updated_at = new Date().toISOString();
  if (runId && d.runs.indexOf(runId) === -1) d.runs.push(runId);
  if (obs.score != null && (d.score == null || obs.score > d.score)) {
    d.score = obs.score; d.priority = obs.priority || d.priority;
  }
  if (d.heading == null && obs.headingDeg != null) d.heading = obs.headingDeg;
  foldPosition(d, obs);
  d.status = defectStatus(d);
}

/* Attach an observation to a defect — an existing one where there is a
   plausible match, a new one otherwise — and write both. */
function fileObservation(obs, runId) {
  obs.observation_id = obs.observation_id || uuid();
  obs.runId = runId || obs.runId || null;
  var d = defectFor(obs);
  if (d) {
    foldObservation(d, obs, obs.runId);
  } else {
    d = newDefect(obs, obs.runId);
    S.defects.push(d);
  }
  obs.defect_id = d.defect_id;
  if (dbBroken) return Promise.resolve(d);
  return putPhys(d).then(function () { return d; }, function () { return d; });
}

function defectById(id) {
  for (var i = 0; i < S.defects.length; i++) if (S.defects[i].defect_id === id) return S.defects[i];
  return null;
}

/* An observation leaving the log takes its share of the defect with it, and a
   defect with no observations left is not a defect. Nothing is orphaned and
   nothing is silently kept alive by a row that has gone. */
function unfileObservation(obs) {
  var d = obs && obs.defect_id ? defectById(obs.defect_id) : null;
  if (!d) return Promise.resolve();
  d.observation_count = Math.max(0, (d.observation_count || 1) - 1);
  if (d.observation_count === 0) {
    S.defects = S.defects.filter(function (x) { return x.defect_id !== d.defect_id; });
    return dbBroken ? Promise.resolve() : delPhys(d.defect_id).catch(function () {});
  }
  /* The runs are rebuilt from the observations that are actually left, so a
     defect cannot stay "confirmed on two passes" once the evidence for one of
     them has been deleted. Losing that status is the point: it is a claim about
     how much is known, and less is known now. */
  var runs = [];
  S.items.forEach(function (o) {
    if (o.defect_id === d.defect_id && o.runId && runs.indexOf(o.runId) === -1) runs.push(o.runId);
  });
  d.runs = runs;
  d.updated_at = new Date().toISOString();
  d.status = defectStatus(d);
  return dbBroken ? Promise.resolve() : putPhys(d).catch(function () {});
}

/* ---------- giving the rows that came before this a defect each ----------

   Every existing entry becomes one observation of one provisional defect. It
   would be possible to cluster them retrospectively — they have positions — and
   it would be wrong: those positions are the vehicle's, recorded with no
   heading, from fixes that were allowed to be five seconds old. Merging two of
   them would be a guess presented as a finding, and unmerging it afterwards is
   not something the app can offer. One each, provisional, and any real grouping
   comes from passes made after this build.

   Runs are unknown for these, so the pass count is null and not one. */
function migrateToDefects(rows, existing) {
  var known = {};
  (existing || []).forEach(function (d) { known[d.defect_id] = true; });
  var todo = rows.filter(function (r) {
    return !r.observation_id || !r.defect_id || !known[r.defect_id];
  });
  if (!todo.length) return Promise.resolve([]);
  var made = [];
  return todo.reduce(function (chain, obs) {
    return chain.then(function () {
      obs.observation_id = obs.observation_id || uuid();
      if (obs.runId === undefined) obs.runId = null;
      var d = newDefect(obs, null);
      d.migrated = true;
      d.status = 'provisional';
      obs.defect_id = d.defect_id;
      made.push(d);
      return putPhys(d).then(function () { return putEntry(obs); });
    });
  }, Promise.resolve()).then(function () { return made; },
    function () { return made; });      // a partial migration is retried next load
}

/* ---------- keeping the screen awake ----------

   A survey ends when the screen sleeps, because the browser suspends the page
   and the camera with it. The Wake Lock API is the fix and is not universally
   available — Safari came to it late and some Android browsers still refuse —
   so every path through this treats failure as normal. Nothing about the survey
   depends on getting one. */
var wakeLock = null, wakeState = 'not asked';

function requestWake() {
  if (!navigator.wakeLock || !navigator.wakeLock.request) {
    wakeState = 'not supported by this browser';
    return Promise.resolve(null);
  }
  return navigator.wakeLock.request('screen').then(function (s) {
    wakeLock = s; wakeState = 'held';
    /* The system can take it back — a call arrives, the battery saver comes on.
       That is not an error, it is a fact to record; the visibility handler asks
       again when the app is back in front. */
    s.addEventListener('release', function () {
      wakeLock = null;
      if (wakeState === 'held') wakeState = 'released by the system';
    });
    return s;
  }, function (e) {
    wakeLock = null;
    wakeState = 'refused (' + ((e && e.name) || 'unknown') + ')';
    return null;
  });
}

function releaseWake() {
  var s = wakeLock;
  wakeLock = null;
  wakeState = 'released';
  if (!s) return;
  try { s.release(); } catch (e) { /* already gone */ }
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
  survey.recent = [];
  /* One id per press of the record button. It is what "independent pass" is
     counted in: fifty frames of one hole on one drive is one opinion, three
     drives on three days is evidence. */
  survey.runId = uuid();
  survey.startedAt = Date.now();
  /* Asked for, never waited on. A browser that will not give one runs the
     survey exactly as before — with the screen able to sleep, which is a worse
     survey but still a survey. */
  requestWake().then(function (s) {
    if (!s && survey.on && /not supported/.test(wakeState)) {
      toast('This browser will not keep the screen awake, so set the phone\u2019s screen ' +
            'timeout long enough for the run — a survey ends when the screen sleeps.');
    }
  });
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
  releaseWake();
  paintRec();
  paintTele();          // hides it: there is nothing to report when nothing runs
  exitFull();
  toast(survey.logged
    ? survey.logged + ' logged this run — all unconfirmed until you open them.'
    : '');
}

/* How long until the next look. A distance, converted to a time by whatever
   speed the device is reporting; the old fixed interval when it reports none. */
function lookDelay() {
  var sp = S.gps ? S.gps.speed : null;
  if (sp == null) return SURVEY_MS;
  if (sp < STATIONARY_MPS) return LOOK_MAX_MS;      // stopped: idle, do not stare
  var ms = (SURVEY_M / sp) * 1000;
  return Math.max(LOOK_MIN_MS, Math.min(LOOK_MAX_MS, ms));
}

/* How far the vehicle has come since the last look, and how far is left before
   the next one. Reported rather than used: the cadence is still the distance
   converted to a time by the reported speed, exactly as before. */
function sinceLastLook() {
  if (!survey.lastLookPos || !S.gps || S.gps.lat == null) return null;
  return metresBetween(survey.lastLookPos, { lat: S.gps.lat, lon: S.gps.lon });
}

/* What the survey is doing, in six lines, for whoever is not driving. */
function teleLines() {
  var g = S.gps || null;
  var gone = sinceLastLook();
  var left = gone == null ? null : Math.max(0, SURVEY_M - gone);
  var sp = g ? g.speed : null;
  var age = g && g.at ? Math.round((Date.now() - g.at) / 1000) : null;
  var pad2 = function (k, v) { return k + '  ' + v; };
  return [
    pad2('Backend  ', (infFacts.backend || 'not started').toUpperCase() +
      (infFacts.demoted ? ' (fell back from ' + infFacts.demoted.backend + ')' : '')),
    pad2('Inference', infFacts.lastMs == null ? 'none yet' : infFacts.lastMs + ' ms'),
    pad2('Last GPS ', !g || g.lat == null ? 'no fix'
      : g.lat.toFixed(5) + ', ' + g.lon.toFixed(5) +
        (g.acc == null ? '' : ' ±' + Math.round(g.acc) + ' m') +
        (age == null ? '' : ', ' + age + ' s ago')),
    pad2('Speed    ', sp == null ? 'not reported'
      : (Math.round(sp * 2.23694 * 10) / 10) + ' mph'),
    pad2('Distance ', gone == null ? 'unknown' : Math.round(gone) + ' m since last look'),
    pad2('Next look', left == null ? 'on the timer, no fix to measure with'
      : Math.round(left) + ' m')
  ].join('\n');
}

function paintTele() {
  var n = $('hudTele');
  if (!n) return;
  if (!survey.on) { n.hidden = true; return; }
  var warn = coverageWarning();
  n.textContent = teleLines() + (warn ? '\n' + warn : '');
  n.className = 'tele' + (warn ? ' warn' : '');
  n.hidden = false;
}

function tick() {
  if (!survey.on) return;
  paintTele();
  survey.timer = setTimeout(look, lookDelay());
}

function look() {
  if (!survey.on) return;
  var v = $('vid');
  if (survey.busy || !stream || !v.videoWidth || document.hidden) return tick();
  /* Standing still, and the device is sure enough about that to say so. Nothing
     new is coming into frame, so nothing is looked for — which saves the
     battery and stops a queue at a junction becoming forty rows of the same
     hole. A device that reports no speed is not standing still; it is a device
     that reports no speed, and the survey carries on. */
  if (S.gps && S.gps.speed != null && S.gps.speed < STATIONARY_MPS) {
    hud('Stopped — not looking');
    return tick();
  }
  survey.busy = true;
  /* No engine to ask. Either the model has not started yet, or a backend was
     dropped mid-survey for talking nonsense and the fallback has not been
     brought up. Either way the answer is to start one, not to keep calling
     infer on nothing — which is what an earlier version did, once per look,
     for the rest of the run. */
  if (!engine || !worker) {
    return loadModel().then(function () {
      hud('Switched to ' + String(infFacts.backend || '?').toUpperCase(), 'bad');
      survey.busy = false; tick();
    }, function (e) {
      hud('No usable backend', 'bad');
      toast(whyLocal(e));
      survey.busy = false; tick();
    });
  }
  var vw = v.videoWidth, vh = v.videoHeight;

  /* ONE read of the live video, and everything downstream comes from it.
     This is evidence, so which frame it is has to be a fact rather than a
     likelihood.

     The original fault was blatant: the JPEG was drawn AFTER inference
     returned, straight off the live <video>, while t, the fix and detBox all
     described the frame the model had been shown. At 34 mph a 700 ms inference
     is ten metres of road, so the photograph could show the road past the
     pothole it was filed against.

     Drawing both here fixed the ten metres and left something weaker in place:
     two drawImage(v, ...) calls, microseconds apart. In practice a <video>
     does not advance between two reads inside one synchronous block — but "in
     practice" is not a property, and a photograph that has to stand up as
     evidence should not rest on one. So the video is read ONCE, into the
     photograph, and the square the model sees is cut FROM THAT CANVAS. There
     is now no second frame for them to disagree about.

     The cost is one extra resample: 1920×1080 → 1600×900 → 640×640 rather than
     straight to 640. The intermediate is far larger than 640 in both axes, so
     nothing the model can resolve is lost on the way through. */
  var shot = $('shot');
  var shotScale = Math.min(1, MAX_EDGE / Math.max(vw, vh));
  shot.width = Math.round(vw * shotScale);
  shot.height = Math.round(vh * shotScale);
  shot.getContext('2d').drawImage(v, 0, 0, shot.width, shot.height);
  var sq = squareFrame(shot, shot.width, shot.height);
  /* When the picture was taken, and what the fix said at that moment.

     Both used to be read at the end, when the entry was written — after
     inference, after the shadow test, after the JPEG was encoded. On a
     mid-range phone that is a second or more, during which the vehicle has
     moved and watchPosition has very likely replaced the fix. The entry then
     recorded a position the camera was never at, timestamped when the database
     was written rather than when the road was looked at.

     The frame is the observation. It is stamped here, and the fix is copied
     rather than referenced so that a later update cannot change what this
     frame was taken against. */
  var capturedAt = Date.now();
  var fixAtCapture = S.gps ? {
    lat: S.gps.lat, lon: S.gps.lon, acc: S.gps.acc, at: S.gps.at,
    heading: S.gps.heading, speed: S.gps.speed
  } : null;
  survey.lastLookAt = capturedAt;
  survey.lastLookFix = fixAtCapture;
  survey.lastLookPos = fixAtCapture && fixAtCapture.lat != null
    ? { lat: fixAtCapture.lat, lon: fixAtCapture.lon } : null;
  createImageBitmap(sq.canvas).then(function (input) {
    /* The same shape the library's CVImage had, without the library. */
    var startedAt = Date.now();
    return engine.infer(worker, { bitmapImage: input }).then(function (preds) {
      var finishedAt = Date.now();
      /* The bitmap is a copy of the square, held only for the call that needs
         it. The canvas it came from stays alive as long as `sq` is in scope,
         which is what the rejectReason texture test reads. */
      if (input && input.close) { try { input.close(); } catch (e) {} }
      return { preds: takeDiag(preds), w: RF_SIZE, h: RF_SIZE, ctx: sq.ctx,
               /* Where the picture sits inside the padded square. Everything
                  that turns a model box back into a picture coordinate needs
                  this, and nothing may assume the square is a linear map of
                  the photograph any more. */
               fit: sq.fit,
               vw: vw, vh: vh, capturedAt: capturedAt, fix: fixAtCapture,
               /* The frame's own size, so a box in the 640 square can be put
                  back where it belongs on the photograph that was saved. */
               shotW: shot.width, shotH: shot.height,
               inferenceStartedAt: startedAt, inferenceFinishedAt: finishedAt };
    }, function (e) {
      if (input && input.close) { try { input.close(); } catch (x) {} }
      throw e;
    });
  }).then(function (out) {
    var raw = out.preds || [];
    /* Measurable and confident are two different questions, and answering them
       together said the wrong thing out loud.

       These used to be one filter, so anything that came back under
       SURVEY_CONF fell into the branch below and the screen read "Model output
       unusable". It was seen in the field on a frame the model had answered
       with a pothole at 0.5351 and a perfectly good box: the output was
       usable, it was simply below the bar this survey sets for writing a
       defect down with nobody watching. Telling the driver the model is broken
       when the model has just seen something is the exact misattribution this
       file keeps having to correct — and it hides the one number that matters
       when working out why a pothole was missed. */
    /* Share is the fraction of the PHOTOGRAPH the defect covers — never the
       fraction of the square the model happened to be shown.

       This is the number that drives bandFor() and so the priority a survey
       writes down, and it must not move when preprocessing does. Under the
       original stretch, box ÷ 640² already was the fraction of the photograph.
       Under letterboxing it had to be taken against the content. Under a crop
       it would be far larger, because cropping zooms in: the same pothole
       covers more of a narrower view, and every defect would quietly score
       higher than the same defect did last week.

       s × srcW by s × srcH is the whole photograph measured at the crop's own
       scale, which makes the ratio the same under all three. It is one rule,
       and it is why entries from before and after this build can still be
       compared. */
    var fitW = (out.fit && out.fit.s) ? out.fit.s * out.fit.srcW : out.w;
    var fitH = (out.fit && out.fit.s) ? out.fit.s * out.fit.srcH : out.h;
    var measurable = raw.map(function (p) { return usableFind(p, fitW, fitH); })
                        .filter(Boolean);
    var hits = measurable.filter(function (f) {
      return f.conf == null || f.conf >= SURVEY_CONF;
    });
    if (raw.length && !measurable.length) {
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
    if (!hits.length) {
      /* Nothing found is the normal case and says so — unless one look is no
         longer covering one stretch of road, in which case saying "Watching"
         would be claiming a coverage the survey is not achieving. */
      var slow = coverageWarning();
      /* Seen, and not sure enough. Worth saying out loud rather than showing
         the same "Watching" as an empty road: it is the difference between a
         model that found nothing and a threshold that turned something down,
         and only one of those is answered by driving closer. The number is the
         one to bring to any argument about where the bar should sit. */
      var near = measurable.reduce(function (a, b) {
        return (b.conf || 0) > (a.conf || 0) ? b : a;
      }, { conf: 0 });
      if (!slow && near.conf) {
        return hud('Seen ' + typeFor(near.cls).toLowerCase() + ' at ' +
                   Math.round(near.conf * 100) + '% — under the ' +
                   Math.round(SURVEY_CONF * 100) + '% bar, not logged');
      }
      return hud(slow || 'Watching', slow ? 'bad' : '');
    }
    /* Boxes and pixels are both in the 640 square, so no rescaling is needed
       between them — the mismatch that used to live here is gone. */
    hits = hits.filter(function (f) {
      return !rejectReason(out.ctx, RF_SIZE, RF_SIZE, f.box);
    });
    /* Already drawn, at the top of this look, from the frame the model was
       actually shown. Nothing is grabbed from the live video here. */
    var c = $('shot');
    if (!hits.length) return hud('Shadow, not a defect');
    var holes = hits.filter(function (f) { return typeFor(f.cls) === 'Pothole'; });
    if (!holes.length) return hud('Ironwork — sound cover, not logged');
    /* Compared as defect to defect where there is enough to work one out, not
       as vehicle to vehicle. */
    var est = estimatePosition(out.fix, out.capturedAt, null);
    var cand = {
      at: out.capturedAt,
      lat: est.lat != null ? est.lat : (out.fix ? out.fix.lat : null),
      lon: est.lat != null ? est.lon : (out.fix ? out.fix.lon : null),
      confM: est.confM != null ? est.confM : (out.fix ? out.fix.acc : null),
      heading: out.fix ? out.fix.heading : null,
      vlat: out.fix ? out.fix.lat : null, vlon: out.fix ? out.fix.lon : null
    };
    var dup = alreadyLogged(cand);
    if (dup) {
      /* Suppressed, but not forgotten: the match's clock is moved forward so a
         defect that stays in shot keeps suppressing rather than timing out and
         being logged a second time from the same view. */
      dup.at = out.capturedAt;
      return improveFind(dup, holes, out, c, cand);
    }
    return logFind(holes, out, c, cand);
  }).catch(function (e) {
    hud('Look failed', 'bad');
    toast(whyLocal(e));
  }).then(function () {
    survey.busy = false; tick();
  });
}

/* Writes the entry with no one looking, which is exactly why it is marked as
   such: the log has to keep saying which scores a person stood over. */
/* The same defect, seen closer.

   A defect is first detected at the far end of what the camera can resolve, and
   the duplicate rule then suppressed every later look at it — so the entry kept
   was always the worst one available: the defect twenty or forty metres off,
   small, and at the top of the frame. Driving nearer only refreshed the
   suppression clock.

   Nearer is measurable without guessing at it. `share` is the detection box as
   a fraction of the frame, and approaching a fixed object makes it grow; a
   bigger share is a closer look at the same thing. When one arrives, the entry
   is REPLACED rather than added to — same row, same defect, better photograph —
   so the log still holds one entry per defect and the crew gets the frame taken
   from closest to it.

   Left alone once a person has touched it. An entry somebody has classified,
   scored or annotated is theirs, and a later frame must not quietly overwrite
   the thing they wrote. */
function improveFind(dup, hits, out, c, cand) {
  var best = hits.reduce(function (a, b) { return (b.share || 0) > (a.share || 0) ? b : a; });
  var better = best && best.share != null && dup.share != null && best.share > dup.share;
  if (!better) return hud('Same defect — not logged again');

  var e = null;
  for (var i = 0; i < S.items.length; i++) {
    if (S.items[i].id === dup.id) { e = S.items[i]; break; }
  }
  /* No row to improve — it was deleted, or this record predates the id being
     kept. The suppression still stands; only the replacement is skipped. */
  if (!e) return hud('Same defect — not logged again');
  if (e.catBy || e.catAt || (e.note && e.note.length) ||
      e.scoredBy !== 'survey, unconfirmed') {
    return hud('Same defect — already looked at, left alone');
  }
  return logFind(hits, out, c, cand, e);
}

/* `replacing` is an existing entry this look supersedes — see improveFind. It
   deliberately goes through this same function rather than a second writer: a
   replacement that built its fields anywhere else would drift from the original
   the first time either changed, and a photograph disagreeing with the fields
   filed beside it is the exact fault this pass is fixing. */
function logFind(hits, out, c, cand, replacing) {
  var best = hits.reduce(function (a, b) { return (b.conf || 0) > (a.conf || 0) ? b : a; });
  var det = { conf: best.conf, share: best.share, count: hits.length,
              cls: best.cls, box: best.box };
  var was = S.det; S.det = det;                 // proposal() reads the current find
  var p = proposal(det);
  S.det = was;
  if (!p) { hud('Found something, could not measure it', 'bad'); return Promise.resolve(); }
  var n = p.imp * p.prb, pri = priorityFor(n) || PRIORITY[PRIORITY.length - 1];

  /* The fix as it was when the frame was taken, not as it is now. */
  var capturedAt = (out && out.capturedAt) || Date.now();
  var f = (out && out.fix) || null;
  var mdl = modelStamp();
  var est = estimatePosition(f, capturedAt, null);

  return new Promise(function (resolve) {
    c.toBlob(function (blob) {
      if (!blob) { hud('Could not save the frame', 'bad'); return resolve(); }
      var capturedIso = new Date(capturedAt).toISOString();
      var e = {
        /* The same row when this is a closer look at something already
           logged, so the log keeps one entry per defect rather than one per
           sighting. */
        id: replacing ? replacing.id : nextId(),
        /* t is when the road was looked at, not when the row was written. The
           two are a second or so apart and it is the first that is the
           observation; storedAt keeps the second, because the gap between them
           is itself worth being able to see. */
        t: capturedIso, capturedAt: capturedIso, storedAt: new Date().toISOString(),
        /* The frame's own history, so which frame produced this observation is
           a matter of record rather than of trust. inferenceStartedAt is
           strictly after capturedAt and strictly before inferenceFinishedAt;
           frameAgeMs is how old the photograph already was when the row was
           written, which is the number that was silently many metres before
           the capture was moved to the top of the look. */
        inferenceStartedAt: out && out.inferenceStartedAt
          ? new Date(out.inferenceStartedAt).toISOString() : null,
        inferenceFinishedAt: out && out.inferenceFinishedAt
          ? new Date(out.inferenceFinishedAt).toISOString() : null,
        inferenceMs: out && out.inferenceFinishedAt && out.inferenceStartedAt
          ? out.inferenceFinishedAt - out.inferenceStartedAt : null,
        frameAgeMs: Math.max(0, Date.now() - capturedAt),
        img: blob,
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
        /* Which model said so. Without this, an entry logged today and an entry
           logged after a model swap are indistinguishable, and no comparison
           between the two can be made afterwards from the log alone. */
        /* What the camera was doing when this frame was taken. A find at 2×
           is a different observation from a find at 1× — same road, different
           number of pixels on it — and later comparison needs to know which. */
        zoom: zoomNow(),
        modelKey: mdl.modelKey, modelName: mdl.modelName,
        modelVersion: mdl.modelVersion, modelArch: mdl.modelArch,
        modelInput: mdl.modelInput, modelRuntime: mdl.modelRuntime,
        datasetVersion: mdl.datasetVersion,
        detConf: det.conf, detShare: det.share, detCount: det.count,
        detBox: det.box,          // kept so a wrong entry can be diagnosed later
        /* The same box on the photograph that was actually saved.
           detBox is in the 640 square, and the square is a STRETCH of a 16:9
           frame — 1920×1080 squashed 3× horizontally and 1.7× vertically — so
           its numbers cannot be drawn on the evidence photograph without being
           put back. Anyone marking up the image needs this one; anyone arguing
           about the model needs detBox. Both are kept because they are not
           interchangeable, and working one out from the other later means
           knowing what the frame size was at the time. */
        /* Through the fit, never by multiplying by shotW/RF_SIZE. That
           shortcut was correct while the square was a stretch of the whole
           photograph and became silently wrong the moment there was padding:
           it would not throw, it would just draw the box in the wrong place,
           which is this file's oldest failure mode. */
        detBoxImage: (out && out.fit && det.box) ? fitToSource(det.box, out.fit) : null,
        imgW: (out && out.shotW) || null, imgH: (out && out.shotH) || null,
        videoW: (out && out.vw) || null, videoH: (out && out.vh) || null,
        type: typeFor(best.cls), note: '',
        /* Where the vehicle was, unmodified. These keep the names they have
           always had and mean what they have always meant, so nothing reading
           an older export changes behaviour. */
        lat: f ? f.lat : null, lon: f ? f.lon : null,
        acc: f ? Math.round(f.acc) : null,
        fixAge: f ? Math.round((capturedAt - f.at) / 1000) : null,
        fixAgeMs: f ? Math.max(0, capturedAt - f.at) : null,
        headingDeg: f ? f.heading : null,
        speedMps: f ? f.speed : null,
        /* Where the defect probably is, kept apart from where the vehicle was
           and never mistaken for it. estWhy holds the reason when there is no
           estimate, so the log can say why rather than showing a blank. */
        estLat: est.lat, estLon: est.lon,
        posConfM: est.confM, estBy: est.by, estWhy: est.why,
        cameraLeadM: est.leadM == null ? null : est.leadM
      };
      /* Which defect this is an observation of. A closer look is an observation
         of the SAME defect, so the existing link is carried over rather than
         asked for again — re-filing on a position that has just moved a few
         metres nearer risks the layer deciding this is a second defect, which
         is the opposite of what a replacement is for. */
      if (replacing && replacing.defect_id) e.defect_id = replacing.defect_id;
      /* The observation is attached to a defect before it is written, so the
         row that lands in the store already knows what it is an observation
         of — rather than being written first and patched afterwards, which
         leaves a window where a crash orphans it. */
      (replacing && e.defect_id ? Promise.resolve()
                                : fileObservation(e, survey.runId)).then(function () {
      return (dbBroken ? Promise.resolve() : putEntry(e)).then(function () {
        if (replacing) {
          /* In place, and in the position it already holds: a closer look is
             not newer news, it is the same news better photographed, and
             moving it to the top of the log would make one defect look like
             two arrivals. */
          for (var i = 0; i < S.items.length; i++) {
            if (S.items[i].id === e.id) { S.items[i] = e; break; }
          }
        } else {
          S.items.unshift(e);
          survey.logged++;
        }
        addWords(e);
        /* The remembered find carries the row it produced and how big the
           detection was, which is what lets the next look know there is
           something to improve and whether it is closer. */
        var rec = cand || { at: capturedAt, lat: est.lat, lon: est.lon, confM: est.confM,
          heading: f ? f.heading : null,
          vlat: f ? f.lat : null, vlon: f ? f.lon : null };
        rec.id = e.id;
        rec.share = det.share;
        if (replacing) {
          /* Update the record already suppressing this defect rather than
             adding a second one for the same hole. */
          for (var k = 0; k < survey.recent.length; k++) {
            if (survey.recent[k].id === e.id) { survey.recent[k] = rec; break; }
          }
          survey.last = { at: rec.at,
            gps: rec.vlat == null ? null : { lat: rec.vlat, lon: rec.vlon } };
        } else {
          rememberFind(rec);
        }
        $('hudCount').textContent = survey.logged + ' logged';
        render();
        hud('Watching');
        /* A missing confidence used to just not appear, which reads exactly
           like a confident find. It is the one number that says whether the
           model is being decoded at all, so its absence is now said out loud. */
        var sure = det.conf == null
          ? ' (sureness out of range — the model is not being read properly)'
          : ' (' + Math.round(det.conf * 100) + '% sure)';
        toast(replacing
          ? 'Closer look kept for the ' + typeFor(best.cls).toLowerCase() +
            ' already logged — ' + pri.p + ', ' + pri.word.toLowerCase() + sure + '.'
          : 'Logged ' + typeFor(best.cls).toLowerCase() + ' — ' + pri.p + ', ' +
            pri.word.toLowerCase() + sure +
            '. Not classified — nobody has looked at it.');
        resolve();
      }, function () {
        hud('Could not write it down', 'bad');
        toast('This device refused the write. Export what is in the log.');
        resolve();
      });
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
  return S.items.filter(function (i) { return !!bestPos(i); });
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
      var pos = bestPos(it);
      var where = (it.w3w ? '///' + esc(it.w3w)
                          : pos.lat.toFixed(5) + ', ' + pos.lon.toFixed(5)) +
                  (pos.confM != null ? ' (±' + pos.confM + 'm)' : '');
      var st = statutoryOf(it), pr = priorityOf(it);
      var title = st ? esc(st.cat) + ' — ' + esc(st.resp)
                     : (pr ? pr.p + ' — ' + esc(pr.word) : 'Not scored') +
                       ' <em>(app priority, not classified)</em>';
      /* The pin is a point and the defect is not. A circle the size of the
         honest error bar is drawn under it, so a pin sitting confidently on the
         wrong side of a road is read as what it is — a best guess with a
         radius — rather than as a survey mark. */
      if (pos.confM != null && pos.confM > 0) {
        L.circle([pos.lat, pos.lon], { radius: pos.confM, weight: 1,
          color: unconfirmed ? '#FF6B1A' : '#8C93A0', opacity: 0.5,
          fillOpacity: 0.06, interactive: false }).addTo(pins);
      }
      L.marker([pos.lat, pos.lon], { icon: pinFor(it) })
        .bindPopup('<b>' + title + '</b><br>' + esc(it.type) + ' · ' + esc(it.surface) +
                   '<br>' + where +
                   '<br><em>' + (pos.estimated
                     ? 'estimated defect position, ±' + pos.confM + ' m'
                     : 'vehicle position — no defect estimate') + '</em>' +
                   '<br>' + new Date(it.t).toLocaleString() +
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
  var b = L.latLngBounds(rows.map(function (i) {
    var p = bestPos(i); return [p.lat, p.lon];
  }));
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
  /* The address someone reads out should be of the road they are being sent
     to, so this looks up the best position the entry has rather than the
     vehicle's. Where there is no estimate the two are the same thing. */
  var pos = bestPos(entry);
  if (entry.w3w || !pos) return;
  entry.w3wOf = pos.source;
  words(pos.lat, pos.lon).then(function (w) {
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

/* The camera lead is on screen and editable because it is the one number in
   the app that can only be settled by driving at a defect somebody has already
   measured. Burying it would mean nobody ever calibrates it. */
function paintLead() {
  var n = $('leadState'); if (!n) return;
  var lead = cameraLead();
  var stored = null;
  try { stored = localStorage.getItem(LEAD_STORE); } catch (e) {}
  n.innerHTML = stored == null
    ? '<b>' + lead + ' m, the built-in guess.</b> Every estimate made with it carries ±' +
      (lead * (1 + LEAD_UNCERTAINTY)) + ' m or worse, because an uncalibrated lead is a metre ' +
      'of doubt for every metre of lead.'
    : '<b>' + lead + ' m, set on this device.</b> Kept here only, and used for finds logged from ' +
      'now on — entries already in the log keep the lead they were recorded with.';
}

$('camLead').value = cameraLead();
paintLead();
$('camLead').addEventListener('change', function () {
  var v = reading(this.value, 0, LEAD_MAX_M);
  if (v == null) { this.value = cameraLead(); return paintLead(); }
  try { localStorage.setItem(LEAD_STORE, String(v)); } catch (e) {}
  this.value = v;
  paintLead();
});

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
    var loc, flag = '', pos = bestPos(it);
    if (pos) {
      /* The three-word address is what someone reads out on a radio and types
         into a van's satnav; six decimal places of latitude is not. So it
         stands in place of the coordinates once it arrives — the coordinates
         are still what is stored and exported, they are simply not the useful
         thing to show. The error bar stays either way, because how well the
         position is known is not a detail: it is the difference between "this
         road" and "one of these two roads". */
      loc = it.w3w ? '///' + esc(it.w3w) : pos.lat.toFixed(5) + ', ' + pos.lon.toFixed(5);
      if (pos.confM != null) loc += ' (±' + pos.confM + 'm)';
      /* Which of the two positions this is. An estimate that read like a
         measurement would be the whole problem back again. */
      loc += pos.estimated ? ' · estimated defect position'
                           : ' · vehicle position, not the defect\u2019s';
      if (pos.confM != null && pos.confM > POOR_ACC) {
        flag = ' <span class="flag">±' + pos.confM + ' m — could be either side of the road</span>';
      }
      if (!pos.estimated && it.lat != null) {
        flag += ' <span class="flag">' +
          esc(it.estWhy || 'no defect estimate') + '</span>';
      }
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
    if (it.headingDeg != null) {
      how += ' · heading ' + Math.round(it.headingDeg) + '°';
      if (it.speedMps != null) how += ' at ' + (it.speedMps * 2.23694).toFixed(0) + ' mph';
    }
    /* What this row is an observation of. A defect seen once is provisional and
       says so: one pass is one opinion, and the app has no business claiming a
       hole exists on the strength of a single drive past it. */
    var od = it.defect_id ? defectById(it.defect_id) : null;
    var obsLine = '';
    if (od) {
      var passes = od.runs && od.runs.length ? od.runs.length : null;
      obsLine = '<div class="obs">Defect <code>' + esc(od.defect_id.slice(0, 8)) + '</code> · ' +
        od.observation_count + ' observation' + (od.observation_count === 1 ? '' : 's') +
        (passes ? ' over ' + passes + ' pass' + (passes === 1 ? '' : 'es') : '') +
        ' · <b class="st-' + esc(od.status) + '">' + esc(od.status) + '</b>' +
        (od.status === 'provisional'
          ? ' <span class="obsnote">seen on one pass — not yet claimed to exist</span>' : '') +
        '</div>';
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
      /* The chip sits inside the heading rather than beside it: .top stacks its
         children, so a sibling would put "app priority" on a line of its own,
         a whole line away from the P4 it is qualifying. */
      head = '<span class="cat prio">' + esc(pr ? pr.p : '—') +
             '<span class="prionote">app priority</span></span>';
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
      (it.note ? '<br>' + esc(it.note) : '') + '</div>' + obsLine +
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
    var done = unfileObservation(wit).then(function () {
      return dbBroken ? Promise.resolve()
        : putWrong(wit).then(function () { return delEntry(wid); });
    });
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
  unfileObservation(it).then(function () {
    return dbBroken ? Promise.resolve() : delEntry(id);
  }).then(render, render);
});

$('bClear').addEventListener('click', function () {
  if (!confirm('Remove all ' + S.items.length + ' entries? This cannot be undone.')) return;
  S.items = [];
  var gone = S.defects.slice();
  S.defects = [];
  (dbBroken ? Promise.resolve()
            : clearEntries().then(function () {
                /* The defects go with their observations. A defect store left
                   full after the log was emptied would put every one of them
                   back on the next pass as a thing with no evidence. */
                return Promise.all(gone.map(function (d) {
                  return delPhys(d.defect_id).catch(function () {});
                }));
              })).then(render, render);
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
/* Which call is allowed to paint.

   quota() runs on every render, and both of the things it shows come back
   asynchronously — a read of the corrections store and the browser's storage
   estimate. Two renders close together leave two reads in flight, and nothing
   made them land in the order they were started, so an older answer could
   arrive last and overwrite a newer one. That put "0 corrections kept" on the
   screen, hidden, while the store held one and the export carried it.

   It was always possible and it became likely when a closer look started
   re-rendering the log mid-survey. A counter that reads the store correctly and
   then paints the previous answer is worse than one that is simply slow. */
var quotaSeq = 0;
function quota() {
  var el = $('quota'); if (!el) return;
  if (dbBroken) {
    el.innerHTML = ' <b>This device would not open a database, so entries are held in memory only ' +
      'and will be gone when the tab closes. Export before you finish.</b>';
    return;
  }
  var seq = ++quotaSeq;
  allWrong().then(function (w) {
    if (seq !== quotaSeq) return;        // a later read has already answered
    var n = $('wrongCount');
    if (!n) return;
    n.hidden = !w.length;
    n.innerHTML = '<b>' + w.length + ' correction' + (w.length === 1 ? '' : 's') + ' kept.</b> ' +
      'Things you marked as not a defect. They are in the JSON export, which is what a ' +
      'retrain would be fed — the app cannot teach the model on its own.';
  });
  if (!navigator.storage || !navigator.storage.estimate) { el.textContent = ''; return; }
  navigator.storage.estimate().then(function (q) {
    if (seq !== quotaSeq) return;
    if (!q || !q.quota) { el.textContent = ''; return; }
    var mb = function (n) { return (n / 1048576).toFixed(n < 104857600 ? 1 : 0) + ' MB'; };
    el.textContent = ' Using ' + mb(q.usage || 0) + ' of about ' + mb(q.quota) + ' available.';
  }).catch(function () { if (seq === quotaSeq) el.textContent = ''; });
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
  var head = ['observation_id', 'defect_id', 'defect_status',
    'defect_observation_count', 'independent_pass_count', 'run_id',
    'timestamp', 'captured_at', 'stored_at',
    'latitude', 'longitude', 'gps_accuracy_m', 'gps_fix_age_s',
    'heading_deg', 'speed_mps',
    'estimated_defect_lat', 'estimated_defect_lon', 'position_confidence_m',
    'position_source', 'position_note', 'camera_lead_m',
    'defect_type', 'surface', 'impact', 'probability', 'risk_factor',
    'app_priority', 'app_priority_note',
    'category', 'response_time',
    'statutory_category', 'statutory_response_time', 'categorised_by', 'categorised_at',
    'tag', 'scored_by', 'model_confidence', 'model_share_of_frame', 'model_detections']
    .concat(old ? ['depth_mm_deepest', 'wider_than_tyre'] : []).concat(['what3words', 'notes']);
  var rows = S.items.map(function (i) {
    var st = statutoryOf(i), pr = priorityOf(i);
    var pos = bestPos(i);
    var d = i.defect_id ? defectById(i.defect_id) : null;
    /* Null rather than 1 where the runs are unknown — the rows migrated from
       before runs were recorded cannot honestly claim a pass count. */
    var passes = d && d.runs && d.runs.length ? d.runs.length : '';
    return [i.observation_id || '', i.defect_id || '', d ? d.status : '',
      d ? d.observation_count : '', passes, i.runId || '',
      i.t, i.capturedAt || i.t, i.storedAt || '',
      i.lat, i.lon, i.acc, i.fixAge,
      i.headingDeg, i.speedMps,
      i.estLat, i.estLon, pos ? pos.confM : '',
      pos ? pos.source : '', i.estBy || i.estWhy || '', i.cameraLeadM,
      i.type, i.surface,
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
  var rows = S.items.filter(function (i) { return !!bestPos(i); });
  if (!rows.length) {
    return alert('Nothing to export: no entry in the log has a location on it.');
  }
  var fc = {
    type: 'FeatureCollection',
    features: rows.map(function (i) {
      var st = statutoryOf(i), pr = priorityOf(i), pos = bestPos(i);
      var dfc = i.defect_id ? defectById(i.defect_id) : null;
      return {
        type: 'Feature',
        id: i.id,
        /* The geometry is the best estimate of where the defect is, because
           that is what anything with a map in it is going to drive somebody
           to. Where the vehicle was is carried in the properties beside it,
           under its own names, along with which of the two this point is and
           how wide the error bar around it is. A point with no radius beside it
           would be the same false precision in a different file format. */
        geometry: { type: 'Point', coordinates: [pos.lon, pos.lat] },
        properties: {
          observation_id: i.observation_id || null,
          defect_id: i.defect_id || null,
          defect_status: dfc ? dfc.status : null,
          defect_observation_count: dfc ? dfc.observation_count : null,
          independent_pass_count: (dfc && dfc.runs && dfc.runs.length) ? dfc.runs.length : null,
          logged: i.t,
          captured_at: i.capturedAt || i.t,
          stored_at: i.storedAt || null,
          position_source: pos.source,
          position_confidence_m: pos.confM == null ? null : pos.confM,
          position_note: pos.estimated
            ? 'projected ' + (i.cameraLeadM || 0) + ' m along the recorded heading; the camera ' +
              'lead is uncalibrated and most of the radius is that'
            : (i.estWhy || 'no heading, so no defect estimate — this is the vehicle position'),
          vehicle_lat: i.lat == null ? null : i.lat,
          vehicle_lon: i.lon == null ? null : i.lon,
          heading_deg: i.headingDeg == null ? null : i.headingDeg,
          speed_mps: i.speedMps == null ? null : i.speedMps,
          camera_lead_m: i.cameraLeadM == null ? null : i.cameraLeadM,
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

/* ---------- the JSON export, and why it is built the long way round ----------

   It used to read every photograph at once — Promise.all over the whole log,
   each one turned into a base64 data URL — and then hand the lot to
   JSON.stringify, which built one more string containing all of them again. A
   200 kB JPEG is about 270 kB as base64, so four hundred entries is somewhere
   over 100 MB of JavaScript string, held twice, on a phone. It does not fail
   politely: the tab is killed and the export is simply gone.

   Two changes fix that without changing the file that comes out.

   The photographs are read one at a time, so only one is on the heap at once.
   And the pieces of the document are handed to a Blob as they are made rather
   than concatenated: once a few megabytes have gathered they are collapsed into
   a Blob, which the browser holds outside the JavaScript heap and spills to
   disk, and the collapsed Blob becomes the first piece of the next batch. Peak
   memory is the chunk size plus one photograph, whatever the size of the log.

   It is a true stream in the sense that matters — nothing whole is ever
   resident — but it is not a streaming download: the file is finished before
   the browser is asked to save it, because a page cannot hand a save dialogue
   something it is still writing. A log large enough to fill the device's free
   space would still fail, and that is a disk limit rather than a memory one. */
function parts(limitBytes) {
  var buf = [], pending = 0, limit = limitBytes || 4 * 1024 * 1024;
  return {
    add: function (s) {
      buf.push(s); pending += s.length;
      /* Collapsing turns however many strings have gathered into one Blob, and
         a Blob does not live on the heap. The strings become unreachable the
         moment the array is replaced. */
      if (pending >= limit) { buf = [new Blob(buf)]; pending = 0; }
    },
    blob: function (type) { return new Blob(buf, { type: type }); }
  };
}

/* One photograph, as a data URL, resolved rather than rejected on failure: an
   image that will not read must cost that entry its picture and nothing else. */
function imgDataUrl(blob) {
  return new Promise(function (resolve) {
    if (!blob) return resolve(null);
    var fr = new FileReader();
    fr.onload = function () { resolve(fr.result); };
    fr.onerror = function () { resolve(null); };
    try { fr.readAsDataURL(blob); } catch (e) { resolve(null); }
  });
}

/* Rows are written into the document one at a time, in order, each one read,
   serialised and released before the next is touched. */
function writeRows(out, list, withImages, onProgress) {
  var i = 0;
  function step() {
    if (i >= list.length) return Promise.resolve();
    var it = list[i], row = {};
    for (var k in it) if (k !== 'img') row[k] = it[k];
    return (withImages ? imgDataUrl(it.img) : Promise.resolve(null)).then(function (url) {
      row.img = url;
      if (!withImages && it.img) row.imgOmitted = true;
      out.add((i ? ',\n' : '') + JSON.stringify(row));
      row = null; url = null;          // nothing from this entry outlives the step
      i++;
      if (onProgress) onProgress(i, list.length);
      return step();
    });
  }
  return step();
}

function imageBytes(list) {
  return list.reduce(function (n, i) { return n + (i.img ? i.img.size : 0); }, 0);
}

$('bJson').addEventListener('click', function () {
  var btn = this, label = btn.textContent;
  btn.disabled = true;

  allWrong().then(function (wrong) {
    var all = S.items.concat(wrong);
    var raw = imageBytes(all);
    var encoded = Math.round(raw * 4 / 3);            // base64 costs a third more
    var mb = Math.round(encoded / 1048576);
    var withImages = true;

    /* Above a few hundred megabytes this stops being a question of memory and
       becomes a question of whether the phone has the room and the patience.
       The choice is offered rather than made: the photographs are the thing a
       retrain needs, so quietly dropping them would be the wrong default. */
    if (encoded > 250 * 1024 * 1024) {
      withImages = confirm(
        'This export contains ' + all.filter(function (i) { return i.img; }).length +
        ' photographs — about ' + mb + ' MB once encoded. Writing it will take a while and ' +
        'needs that much free space on this device.\n\n' +
        'OK to include the photographs.\n' +
        'Cancel to export the same records without them (a few hundred kilobytes), which ' +
        'keeps every measurement and loses only the images.');
    }

    var out = parts();
    var meta;
    out.add('{\n"defects": [\n');
    return writeRows(out, S.items, withImages, function (n, total) {
      btn.textContent = 'JSON ' + n + '/' + total;
    }).then(function () {
      out.add('\n],\n"notDefects": [\n');
      return writeRows(out, wrong, withImages);
    }).then(function () {
      out.add('\n],\n');
      return modelMeta();
    }).then(function (m) {
      meta = m;
      out.add('"model": ' + JSON.stringify({
        id: RF_MODEL_ID || (RF_MODEL + '/' + RF_VERSION),
        loadedBy: RF_MODEL_ID ? 'model id' : 'project and version',
        build: BUILD,
        roboflow: meta,               // what the service says it is, and what decodes it
        selfTest: selfTest
      }, null, 2) + ',\n');
      /* The defects the observations above are observations of. `defects` is
         the observation list and keeps that name for compatibility; this is the
         new thing beside it. */
      out.add('"physicalDefects": ' + JSON.stringify(S.defects, null, 2) + ',\n');
      out.add('"photographs": ' + JSON.stringify(withImages ? 'included' : 'omitted at export') + ',\n');
      // what the model returned when it made no sense
      out.add('"lastUnusableOutput": ' + JSON.stringify(lastRaw == null ? null : lastRaw) + '\n}\n');
      dl('defects-' + stamp() + '.json', out.blob('application/json'));
    });
  }).then(function () {
    btn.disabled = false; btn.textContent = label;
  }, function (e) {
    btn.disabled = false; btn.textContent = label;
    alert('The export could not be written (' + (e && e.name ? e.name : 'unknown') + '). ' +
          'The log is untouched. CSV carries every measurement without the photographs.');
  });
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
  L.push('screen     wake lock ' + wakeState);
  L.push('cadence    ' + (S.gps && S.gps.speed != null
    ? Math.round(lookDelay()) + ' ms — one look per ' + SURVEY_M + ' m at ' +
      (S.gps.speed * 2.23694).toFixed(0) + ' mph'
    : SURVEY_MS + ' ms fixed — no speed reported, so distance cannot be used'));
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
  L.push('CAMERA');
  var zv = $('vid');
  L.push('  resolution ' + (zv && zv.videoWidth
    ? zv.videoWidth + ' × ' + zv.videoHeight
    : 'no camera running'));
  var ztr = zoomTrack();
  if (ztr) {
    var zst = {};
    try { zst = ztr.getSettings ? ztr.getSettings() : {}; } catch (e) {}
    L.push('  track      ' + (zst.width || '?') + ' × ' + (zst.height || '?') +
      (zst.frameRate ? ' @ ' + Math.round(zst.frameRate) : '') +
      (zst.facingMode ? ' · ' + zst.facingMode : ''));
  }
  /* What the model is actually being shown, which is no longer the whole
     photograph. A crop is the kind of thing that must never be a surprise to
     somebody reading a report and wondering why a verge defect was missed. */
  if (zv && zv.videoWidth) {
    var cf = squareFrame(zv, zv.videoWidth, zv.videoHeight).fit;
    L.push('  crop       ' + cf.cropW + '×' + cf.cropH + ' at ' + cf.cropX + ',' +
      cf.cropY + '  — ' + Math.round(cf.cropW / zv.videoWidth * 100) + '% of the width, ' +
      Math.round(cf.cropH / zv.videoHeight * 100) + '% of the height');
    L.push('             the road band between ' + Math.round(ROAD_TOP * 100) + '% and ' +
      Math.round(ROAD_BOT * 100) + '% down the frame, squared and scaled ×' +
      cf.s.toFixed(3) + '.');
    L.push('             Anything outside it is not shown to the model at all.');
  }
  L.push('');
  L.push('ZOOM');
  L.push('  supported  ' + (zoom.supported ? 'yes' : 'no' +
    (zoom.why ? ' — ' + zoom.why : '')));
  L.push('  requested  ' + zoom.requested + '×' +
    (zoom.asked != null && zoom.asked !== zoom.requested
      ? '  (asked the camera for ' + zoom.asked + ', the nearest it allows)' : ''));
  L.push('  actual     ' + (zoom.actual == null
    ? 'the camera reports none' : zoom.actual + '×'));
  L.push('  min        ' + (zoom.min == null ? '—' : zoom.min));
  L.push('  max        ' + (zoom.max == null ? '—' : zoom.max));
  L.push('  step       ' + (zoom.step == null ? '—' : zoom.step));
  if (zoom.supported && zoom.why) L.push('  note       ' + zoom.why);
  L.push('  applied at the camera track, not by cropping the frame the model is');
  L.push('  given — a crop would be the same pixels enlarged and a narrower view.');
  L.push('');
  /* The registry, on the glass. A comparison between two models is only worth
     anything if it is obvious which one was running, and this is the screen
     somebody photographs and sends back. */
  L.push('MODEL REGISTRY');
  var act = activeModel(), base = baselineModel();
  MODELS.forEach(function (m) {
    L.push('  ' + (m.key === (act && act.key) ? '> ' : '  ') + m.key +
      (m.baseline ? '   [BASELINE]' : ''));
    L.push('      ' + m.name + ' · v' + m.version + ' · ' + m.arch);
    L.push('      input ' + m.input + ' · classes ' + m.classes.join(', '));
    L.push('      runtime ' + m.runtime);
    L.push('      dataset ' + m.dataset + ' · v' + m.datasetVersion +
      (m.datasetImages ? ' · ' + m.datasetImages.toLocaleString() + ' images' : '') +
      (m.epochs ? ' · ' + m.epochs + ' epochs' : ''));
    L.push('      added ' + m.addedAt);
  });
  L.push('  active     ' + (act ? act.key : 'NONE — the registry is empty'));
  L.push('  baseline   ' + (base ? base.key + ' — present' : 'MISSING'));
  L.push('  fallback   ' + (modelFallback
    ? 'asked for ' + modelFallback.asked + ', using ' + modelFallback.using +
      ' — ' + modelFallback.why
    : 'none — running what was asked for'));
  L.push('  metrics    UNKNOWN. Precision, recall, mAP and the train/val/test');
  L.push('             split live in Roboflow and have never been read into');
  L.push('             this repository. No number here is invented to fill it.');
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
  /* The one block somebody actually needs to send back. It goes near the end
     rather than the top only because the model block above says which model
     produced it. */
  if (frameTest) {
    L.push(frameLines(frameTest));
  } else {
    /* A test that was pressed and failed used to produce a paste identical to
       one that was never pressed: the reason lived only in the status line on
       screen, which Copy does not include. So the not-run state now carries
       what the screen last said and the three preconditions the button checks,
       which is the difference between a diagnosable report and a shrug. */
    var v = $('vid'), st = $('tState');
    L.push('REAL FRAME');
    L.push('           not run — press "Test the camera" at the top of this screen');
    L.push('last said  ' + ((st && st.textContent) || '(nothing)'));
    /* "live, 1920×1080" used to be asserted from videoWidth alone, and a video
       element that has stopped keeps reporting the size of its last frame — so
       that line called a stalled camera live. readyState is the part that knows. */
    L.push('camera     ' + (!stream ? 'NOT RUNNING — that is why the button refuses'
      : !(v && v.videoWidth) ? 'open, but no frames have arrived yet'
      : (v.readyState >= 2 ? 'live, ' : 'STALLED at ') +
        v.videoWidth + '×' + v.videoHeight +
        ' (readyState ' + v.readyState + (v.readyState >= 2 ? '' : ' — no frame to give') +
        (v.paused ? ', paused' : '') + ')'));
    L.push('model      ' + (worker ? 'worker ready'
      : engine ? 'engine loaded but no worker — the model would not start'
               : 'not loaded'));
    /* When a run failed, this is the line that says what the library handed
       back — the thing the old type error was hiding. */
    if (lastInferType) L.push('raw type   ' + lastInferType + ' from the last engine.infer');
    /* And this one says the model was never reached at all, which is a
       different fault from the model failing and used to read as the same. */
    if (lastSourceFail) {
      L.push('source     THE PICTURE NEVER REACHED THE MODEL —');
      L.push('           ' + lastSourceFail);
    }
    var bench0 = benchLines();
    if (bench0) { L.push(''); L.push(bench0); }
    var miss0 = missLines();
    if (miss0) { L.push(''); L.push(miss0); }
  }
  L.push('');
  L.push('SURVEY BACKEND  (what the survey itself is running on, right now)');
  L.push('using        ' + (infFacts.backend
    ? infFacts.backend.toUpperCase() + ' — chosen ' + (infFacts.startedAt || '?')
    : 'nothing yet — the model has not been started'));
  L.push('runtime      ' + (benchTf ? 'loaded' : 'NOT loaded') +
    ((infFacts.retried || []).length
      ? ' — asked twice for ' + infFacts.retried.join(', ') +
        '. The first request was answered by a service worker on its way out; ' +
        'that is the load a deploy lands on.'
      : ''));
  if (infFacts.startFail) {
    L.push('LAST FAILURE ' + infFacts.startFail.why);
    L.push('             at ' + infFacts.startFail.at +
      ((infFacts.tried || []).length ? '' :
        '. No backend was reached, so this happened before the choice was made — ' +
        'the runtime or the weights, not the backends.'));
  }
  L.push('order        ' + SURVEY_BACKENDS.join(', then ') +
    '.  WebGL is NOT in this list and cannot be selected.');
  L.push('             (on this phone WebGL returned 20 detections at a');
  L.push('              "confidence" of 407894400 — fast, and entirely wrong)');
  L.push('SIMD         ' + (infFacts.simd === null ? 'not determined'
    : infFacts.simd ? 'yes' : 'no'));
  L.push('threads      ' + (infFacts.threads === null ? 'not determined'
    : infFacts.threads ? 'yes' : 'no') +
    (infFacts.threadCount != null ? ', thread count ' + infFacts.threadCount : '') +
    (infFacts.threads ? '' : ' — needs COOP/COEP headers this host does not send'));
  L.push('model loads  ' + infFacts.loads + ' for ' + infFacts.infers + ' inference' +
    (infFacts.infers === 1 ? '' : 's') +
    (infFacts.loads <= 1 ? '  — loaded once and reused'
                         : '  — MORE THAN ONE LOAD, which should not happen'));
  L.push('last look    ' + (infFacts.lastMs == null ? 'none yet'
    : infFacts.lastMs + ' ms' +
      (infFacts.recent.length > 1 ? '  (recent: ' + infFacts.recent.join(', ') + ')' : '')));
  var cw = coverageWarning();
  if (cw) L.push('             >> ' + cw);
  (infFacts.tried || []).forEach(function (t) {
    L.push('  tried ' + pad(t.backend, 6) +
      (t.error ? 'REFUSED — ' + t.error
               : 'ok — sane, min ' + round4(t.min) + ', max ' + round4(t.max) +
                 ', init ' + t.initMs + ' ms, weights ' + t.loadMs + ' ms'));
  });
  if (infFacts.demoted) {
    L.push('  >> ' + infFacts.demoted.backend.toUpperCase() + ' WAS DROPPED MID-SURVEY: ' +
      infFacts.demoted.why);
    L.push('     at ' + infFacts.demoted.at + '. It will not be tried again this session.');
  }

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

/* ---------- putting one real picture through it ----------

   Everything else on the diagnostics screen describes the model in the
   abstract: what Roboflow says it is, what shape it returns, what it does with
   a flat grey square. None of that answers the only question that matters —
   point it at a pothole and does it see one.

   This does, and it does it through the same code the survey uses: the same
   squareFrame, the same CVImage, the same engine.infer, the same worker, the
   same usableFind and the same shadow test. There is deliberately no separate
   inference path here, because a diagnostic that exercises different code from
   the thing being diagnosed is worse than none.

   The picture is drawn, inferred and shown. It is not written to the database
   and it does not leave the device. */
var frameTest = null, testUrl = null;
/* The last time a picture failed to reach the model at all, kept so the
   not-run report can say so rather than leaving a blank where the reason
   should be. */
var lastSourceFail = null;

/* What the survey's own filters would do with these detections, and where each
   one was lost. "The model found it and the shadow test threw it away" and "the
   model never found it" are different faults, and they used to look identical
   from outside. */
/* fit is optional so a caller with no letterbox geometry still gets the old
   behaviour rather than a crash; every caller in the app passes one. */
function filterTrace(raw, ctx, fit) {
  var trace = [], kept = [];
  /* The same rule the survey uses: the whole photograph at the crop's scale,
     so a share here means what a share there means. */
  var fitW = (fit && fit.s) ? fit.s * fit.srcW : RF_SIZE;
  var fitH = (fit && fit.s) ? fit.s * fit.srcH : RF_SIZE;
  raw.forEach(function (p, i) {
    var f = usableFind(p, fitW, fitH);
    if (!f) {
      trace.push('#' + (i + 1) + ' dropped — not a usable find (unknown class, or a box ' +
                 'that is not a box)');
      return;
    }
    if (f.conf != null && f.conf < SURVEY_CONF) {
      trace.push('#' + (i + 1) + ' ' + f.cls + ' ' + round4(f.conf) +
                 ' dropped — under the survey threshold of ' + SURVEY_CONF);
      return;
    }
    var why = rejectReason(ctx, RF_SIZE, RF_SIZE, f.box);
    if (why) {
      trace.push('#' + (i + 1) + ' ' + f.cls + ' ' + round4(f.conf) + ' dropped — ' + why);
      return;
    }
    if (typeFor(f.cls) !== 'Pothole') {
      trace.push('#' + (i + 1) + ' ' + f.cls + ' ' + round4(f.conf) +
                 ' recognised but not logged — ' + typeFor(f.cls).toLowerCase() +
                 ' is not a defect');
      return;
    }
    kept.push(f);
    trace.push('#' + (i + 1) + ' ' + f.cls + ' ' + round4(f.conf) + ' KEPT — the survey would ' +
               'log this');
  });
  return { trace: trace, kept: kept };
}

/* ---------- what is upright, and what is not ----------

   The app turns itself when the viewport is portrait: #app is rotated 90° so
   the chrome reads landscape, and the video is counter-rotated so the picture
   on screen looks the right way up. Neither of those touches the video
   element's own pixels, and squareFrame draws those — so what the operator is
   looking at and what the model is handed can differ by ninety degrees, with
   nothing on screen to say so.

   Read out of the DOM rather than assumed, because "the model sees the camera's
   frame either way" is exactly the sort of thing that is written down once as a
   reassurance and then quietly stops being true. */
function cssRotation(el) {
  if (!el) return null;
  var t;
  try { t = getComputedStyle(el).transform; } catch (e) { return null; }
  if (!t || t === 'none') return 0;
  var m = t.match(/matrix\(([^)]+)\)/);
  if (!m) return null;
  var p = m[1].split(',').map(parseFloat);
  if (p.length < 4) return null;
  return Math.round(Math.atan2(p[1], p[0]) * 180 / Math.PI);
}

function orientationFacts(srcW, srcH, from) {
  var v = $('vid');
  var o = (screen && screen.orientation) || null;
  return {
    from: from,
    srcW: srcW, srcH: srcH,
    videoW: v ? v.videoWidth : null, videoH: v ? v.videoHeight : null,
    screenType: o ? o.type : null,
    screenAngle: o ? o.angle : null,
    portraitViewport: window.matchMedia
      ? window.matchMedia('(orientation: portrait)').matches : null,
    appRot: cssRotation($('app')),
    videoRot: cssRotation(v)
  };
}

/* One picture, from wherever it came, through the pipeline.

   Timed in four separate pieces, because "21 seconds" is not a finding until
   you know which piece it was in. */
/* An error raised before the model was ever asked anything.

   Marked, because the message that started this said "The model failed while
   running" about a picture the browser could not even decode — the model was
   never handed anything and never ran. Blaming it sent the search to the wrong
   end of the pipeline. */
function SourceError(msg) { this.message = msg; this.source = true; }
SourceError.prototype = Object.create(Error.prototype);
SourceError.prototype.name = 'SourceError';

/* What the thing being handed to the model actually is — asked of the object,
   not assumed from which button was pressed. */
function sourceKind(v) {
  if (v === null || v === undefined) return String(v);
  var tag = Object.prototype.toString.call(v).slice(8, -1);
  /* Chrome reports several of these as [object Object] in some contexts, so the
     constructor name is preferred when there is one. */
  if (v.constructor && v.constructor.name) return v.constructor.name;
  return tag;
}

/* Everything worth knowing about the frame before the model is asked about it.

   A video element that has stopped producing frames still reports the size of
   the last one it managed, so videoWidth alone is not evidence that there is a
   picture — readyState is the part that says whether a frame is actually
   there. */
function sourceFacts(source, w, h) {
  var f = {
    kind: sourceKind(source), askedW: w, askedH: h,
    readyState: null, readyWord: null, videoW: null, videoH: null,
    paused: null, ended: null, srcW: null, srcH: null
  };
  if (typeof HTMLVideoElement !== 'undefined' && source instanceof HTMLVideoElement) {
    f.readyState = source.readyState;
    f.readyWord = ['nothing yet', 'metadata only', 'this frame', 'this frame and the next',
                   'enough to play through'][source.readyState] || '?';
    f.videoW = source.videoWidth; f.videoH = source.videoHeight;
    f.paused = source.paused; f.ended = source.ended;
    f.srcW = source.videoWidth; f.srcH = source.videoHeight;
  } else {
    if (typeof source.width === 'number') f.srcW = source.width;
    if (typeof source.height === 'number') f.srcH = source.height;
  }
  return f;
}

/* The check that turns a generic failure into a sentence worth reading. Run
   before the canvas is drawn, so nothing downstream has to guess. */
function sourceProblem(f) {
  if (f.kind === 'HTMLVideoElement') {
    if (f.readyState < 2) {
      return 'the camera element has no frame to give (readyState ' + f.readyState +
             ', ' + f.readyWord + '). The stream may be open without decoding yet.';
    }
    if (!f.videoW || !f.videoH) {
      return 'the camera reports a frame of ' + f.videoW + '×' + f.videoH +
             ' — there is nothing to draw.';
    }
  }
  if (!f.askedW || !f.askedH) {
    return 'the frame was asked for at ' + f.askedW + '×' + f.askedH +
           ', which cannot be drawn from.';
  }
  if (f.srcW === 0 || f.srcH === 0) {
    return 'the source measures ' + f.srcW + '×' + f.srcH + '.';
  }
  return null;
}

/* Whether anything actually landed on the canvas.

   A frame that draws as one flat colour is not proof of a fault — a lens cap,
   a dark road and a video element that quietly stopped all look the same from
   here — so this is reported as an observation and never used to refuse a run.
   Sampled on a grid rather than read whole: this is a diagnostic, not a
   reason to walk 1.6 MB of pixels. */
function canvasContent(ctx, size) {
  try {
    var d = ctx.getImageData(0, 0, size, size).data;
    var lo = 255, hi = 0, step = size * 4 * 8;          // every eighth row
    for (var i = 0; i < d.length; i += step) {
      var v = (d[i] + d[i + 1] + d[i + 2]) / 3;
      if (v < lo) lo = v; if (v > hi) hi = v;
    }
    return { min: Math.round(lo), max: Math.round(hi), flat: hi - lo < 2 };
  } catch (e) {
    /* A tainted canvas cannot be read. Worth saying, never worth failing on. */
    return { min: null, max: null, flat: null, error: String((e && e.message) || e) };
  }
}

function testFrame(source, w, h, label, from, rotate) {
  if (!engine || !worker) {
    return Promise.reject(new Error('the model is not loaded'));
  }
  var facts = orientationFacts(w, h, from);
  /* Checked before anything is drawn, so a source that cannot produce a picture
     says so itself instead of arriving as a decode failure further along. */
  var src = sourceFacts(source, w, h);
  var bad = sourceProblem(src);
  if (bad) return Promise.reject(new SourceError(bad));
  var t0 = performance.now();
  var sq = rotate ? rotatedFrame(source, w, h, rotate) : squareFrame(source, w, h);
  src.canvasW = sq.canvas.width; src.canvasH = sq.canvas.height;
  src.content = canvasContent(sq.ctx, RF_SIZE);
  return createImageBitmap(sq.canvas).catch(function (e) {
    /* The canvas is built here and is always RF_SIZE square, so this failing is
       a fact about the device rather than about the picture. */
    throw new SourceError('the ' + sq.canvas.width + '×' + sq.canvas.height +
      ' canvas could not be turned into an image — ' + String((e && e.message) || e));
  }).then(function (input) {
    src.bmpW = input.width; src.bmpH = input.height;
    var tPre = performance.now();
    /* The same engine the survey uses. A diagnostic that exercises different
       code from the thing being diagnosed is worse than none. */
    return engine.infer(worker, { bitmapImage: input }).then(function (preds) {
      return { preds: preds, tPre: tPre, tInf: performance.now() };
    });
  }).then(function (out) {
    /* takeDiag names what came back before anything is done to it, and refuses
       anything that is not a list — so a failed worker reports its own reason
       rather than surfacing later as a missing array method. */
    var raw = takeDiag(out.preds);             // also refreshes lastDiag for the screen below
    var rawType = lastInferType;
    var d = lastDiag || {};
    var tDec = performance.now();
    var f = filterTrace(raw, sq.ctx);
    var msFilter = performance.now() - tDec;
    return new Promise(function (resolve) {
      var tEnc = performance.now();
      sq.canvas.toBlob(function (blob) {
        resolve({
          label: label, at: new Date().toISOString(),
          raw: raw, rawType: rawType, from: from,
          trace: f.trace, kept: f.kept, diag: d, shot: blob,
          rotate: rotate || 0, facts: facts, src: src,
          t: {
            pre: Math.round(out.tPre - t0),
            infer: Math.round(out.tInf - out.tPre),
            filter: Math.round(msFilter),
            encode: Math.round(performance.now() - tEnc),
            wall: Math.round(performance.now() - t0)
          }
        });
      }, 'image/jpeg', 0.8);
    });
  });
}

/* The same square the survey builds, turned by a quarter turn first.

   The point of it is one question: is the model failing on this road, or
   failing on this road sideways? Nothing else in the app rotates anything, and
   this does not change what the survey does — it only asks the model the same
   question four ways round. */
function rotatedFrame(source, w, h, deg) {
  var c = document.createElement('canvas');
  c.width = c.height = RF_SIZE;
  var ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.save();
  ctx.translate(RF_SIZE / 2, RF_SIZE / 2);
  ctx.rotate(deg * Math.PI / 180);
  ctx.translate(-RF_SIZE / 2, -RF_SIZE / 2);
  /* Drawn to the same square the survey builds — a road crop since build 56 —
     so the only difference from the survey's own frame is the quarter turn. A
     rotation test whose frame differed from production in a second way would
     answer a question nobody asked. */
  var rsq = squareFrame(source, w, h);
  ctx.drawImage(rsq.canvas, 0, 0);
  ctx.restore();
  return { canvas: c, ctx: ctx };
}

function frameLines(f) {
  if (!f) return '';
  var d = f.diag || {}, L = [];
  var pr = d.precision || {}, th = d.thresholds || {};

  var t = f.t || {}, fa = f.facts || {};

  /* A photograph and a camera frame go through identical code from squareFrame
     onwards, but they are different tests to whoever is reading the result, so
     they are headed differently. */
  var photo = /^photo/.test(f.from || '');
  L.push((photo ? 'PHOTO TEST' : 'REAL FRAME') + '  (' + f.label +
    (f.rotate ? ', turned ' + f.rotate + '°' : '') + ')');
  L.push('when         ' + f.at);
  L.push('image        ' + (fa.srcW || '?') + '×' + (fa.srcH || '?') + ' as supplied');
  L.push('backend      ' + (pr.using || 'not reported') +
    (d.backendNow && d.backendNow !== pr.using ? ' (now ' + d.backendNow + ')' : '') +
    (precisionForced(d) ? '  (forced — WebGL would not answer sensibly)' : ''));

  /* Where the time actually went. One total is not a finding — it cannot tell
     a slow graph from a model being rebuilt on every press. */
  L.push('');
  L.push('TIME         preprocess    ' + t.pre + ' ms   (draw to ' + RF_SIZE +
    '² and make a bitmap)');
  L.push('             inference     ' + t.infer +
    ' ms   (the whole round trip to the worker and back)');
  L.push('             execute       ' + (d.msExecute == null ? '?' : Math.round(d.msExecute)) +
    ' ms   (the graph itself, inside that)');
  L.push('             read+decode   ' + (d.msDecode == null ? '?' : Math.round(d.msDecode)) +
    ' ms   (readback, boxes, scores, NMS)');
  L.push('             filters       ' + (t.filter == null ? '?' : t.filter) +
    ' ms   (the survey\'s own thresholds, run over the result)');
  L.push('             encode        ' + t.encode + ' ms   (the JPEG for the screen)');
  L.push('             whole test    ' + t.wall + ' ms');
  /* The first question a twenty-second inference raises: is it the graph, or is
     the model being loaded again every time? */
  L.push('model loads  ' + (d.inits == null ? '?' : d.inits) + ' initialise' +
    (d.inits === 1 ? '' : 's') + ' for ' + (d.infers == null ? '?' : d.infers) +
    ' inference' + (d.infers === 1 ? '' : 's') +
    (d.inits === 1 ? '  — loaded once and reused, so the time above is the graph running'
                   : '  — MORE THAN ONE LOAD: the model is being rebuilt'));
  L.push('');

  /* Everything the app knows about which way up things are. */
  L.push('ORIENTATION');
  L.push('  source     ' + fa.srcW + '×' + fa.srcH + ' (' + fa.from + ')');
  if (fa.videoW) L.push('  camera     ' + fa.videoW + '×' + fa.videoH + ' — ' +
    (fa.videoW >= fa.videoH ? 'landscape' : 'portrait') + ' as the browser hands it over');
  L.push('  screen     ' + (fa.screenType || 'not reported') +
    (fa.screenAngle == null ? '' : ', angle ' + fa.screenAngle));
  L.push('  viewport   ' + (fa.portraitViewport ? 'portrait' : 'landscape'));
  L.push('  app turned ' + (fa.appRot == null ? '?' : fa.appRot + '°') +
    '   video turned ' + (fa.videoRot == null ? '?' : fa.videoRot + '°') + ' (on screen only)');
  L.push('  fed to model  the raw camera frame, turned ' + (f.rotate || 0) + '°');
  /* Not a rotation, and easy to miss because of that. The frame is stretched
     into a square, so a source that is not already square is distorted — and by
     how much depends on which way up the phone is. The model was trained on
     images stretched the same way, so a source shaped like the training set is
     distorted like the training set, and one shaped the other way round is
     not. */
  if (fa.srcW && fa.srcH) {
    var ratio = (fa.srcW / fa.srcH);
    var squash = ratio >= 1 ? ratio : 1 / ratio;
    L.push('  squashed to   ' + RF_SIZE + '×' + RF_SIZE + ' from ' +
      fa.srcW + '×' + fa.srcH + ' — ' +
      (Math.abs(ratio - 1) < 0.02 ? 'already square, no distortion'
        : (ratio < 1 ? 'vertical' : 'horizontal') + ' squeezed ' +
          (Math.round(squash * 100) / 100) + '× more than the other axis'));
  }
  /* The line worth reading. CSS turning the preview does not turn the pixels
     squareFrame draws from, so when the app is in forced-landscape the picture
     on the glass and the picture the model gets are a quarter turn apart. */
  /* The net turn, not the video's own transform.

     The first version of this compared videoRot against what the model got and
     shouted whenever they differed — which is always, in forced-landscape,
     because the video's -90° exists precisely to cancel the +90° on #app it
     sits inside. Net zero. It cried wolf on every portrait test, and the
     rotation probe standing next to it proved it wrong. Add the two. */
  var seen = ((fa.appRot || 0) + (fa.videoRot || 0) % 360 + 540) % 360 - 180;
  var fed = (f.rotate || 0);
  var apart = Math.abs(((seen - fed) % 360 + 540) % 360 - 180);
  L.push('  net on screen ' + seen + '°   (the app\'s ' + (fa.appRot || 0) +
    '° and the video\'s ' + (fa.videoRot || 0) + '° together)');
  if (apart >= 45) {
    L.push('  >> WHAT YOU SEE IS TURNED ' + seen + '°. WHAT THE MODEL GOT IS TURNED ' +
      fed + '°.');
    L.push('     They are ' + apart +
      '° apart. The preview is not evidence of what the model was shown.');
  } else {
    L.push('  >> the preview and the model agree on which way up this is');
  }
  L.push('');

  /* What was handed over, checked rather than assumed. The camera and a
     photograph reach the model as different objects and the difference matters
     enough to print: a video element that has stopped still reports the size of
     its last frame, so a dimension on its own proves nothing. */
  var sc = f.src || {};
  L.push('SOURCE  (checked before the model was asked anything)');
  L.push('  given as   ' + (sc.kind || '?'));
  if (sc.kind === 'HTMLVideoElement') {
    L.push('  readyState ' + sc.readyState + ' — ' + sc.readyWord);
    L.push('  video      ' + sc.videoW + '×' + sc.videoH +
      (sc.paused ? ', paused' : ', playing') + (sc.ended ? ', ended' : ''));
  } else {
    L.push('  measured   ' + sc.srcW + '×' + sc.srcH);
  }
  L.push('  drawn onto ' + sc.canvasW + '×' + sc.canvasH + ' canvas');
  L.push('  handed to model as ImageBitmap ' + sc.bmpW + '×' + sc.bmpH);
  if (sc.content) {
    L.push('  frame      ' + (sc.content.error
      ? 'could not be read — ' + sc.content.error
      : 'brightness ' + sc.content.min + ' to ' + sc.content.max +
        (sc.content.flat ? '  >> ALL ONE SHADE. A lens cap, a dark road and a video ' +
                           'that stopped all look like this.'
                         : ' — there is a picture here')));
  }
  L.push('');

  L.push('raw shape    ' + (Array.isArray(d.rawShape) ? [].concat(d.rawShape).join('×') : '?'));
  L.push('raw min      ' + (d.frameRange ? round4(d.frameRange.min) : 'not reported'));
  L.push('raw max      ' + (d.frameRange ? round4(d.frameRange.max) : 'not reported'));
  /* What engine.infer actually handed back, asked of the object rather than
     assumed of it. A list here is the normal answer; anything else is the
     library passing a failure off as a result, and the run stops before this
     line is ever reached. */
  L.push('raw type     ' + (f.rawType || 'not recorded') +
    ' — what engine.infer returned' +
    (d.__diag ? ' (' + f.raw.length + ' detection' + (f.raw.length === 1 ? '' : 's') +
                ' plus the diagnostic block the patched worker appends)' : ''));
  L.push('sane?        ' + (d.frameRange && isFinite(d.frameRange.max) &&
      Math.abs(d.frameRange.max) < 1e4
    ? 'yes — box values in pixels for a ' + RF_SIZE + ' model, scores in 0..1'
    : 'NO — the runtime is not executing this graph'));
  L.push('');

  /* The number that makes a nil return readable. Without it, "0 detections" is
     two different findings wearing the same words. */
  L.push('BEST ANCHOR  (the highest the model scored anywhere in the frame,');
  L.push('              before NMS and before any threshold)');
  if (d.best) {
    var b = d.best;
    L.push('             ' + (b.cls || 'class ?') + '  ' + round4(b.score) +
      '  box x ' + Math.round(b.box.x) + ' y ' + Math.round(b.box.y) +
      ' w ' + Math.round(b.box.width) + ' h ' + Math.round(b.box.height));
    L.push('             library keeps ≥ ' + (th.score == null ? '?' : th.score) +
      ', the survey keeps ≥ ' + SURVEY_CONF);
    if (th.score != null && b.score < th.score) {
      L.push('             SO THIS ONE NEVER REACHED THE APP — it was dropped inside the');
      L.push('             library, not by anything in this repository.');
    }
  } else {
    L.push('             nothing scored above zero anywhere in the frame');
  }
  /* The winner hides the other class entirely, and the other class is usually
     the one being asked about. */
  if (d.perClass && d.perClass.length) {
    L.push('  by class   ' + d.perClass.map(function (c) {
      return (c.cls || '?') + ' ' + round4(c.score);
    }).join('    '));
  }
  L.push('');

  L.push('DETECTIONS   ' + (f.raw.length || 'zero') + ' came back from the library');
  if (!f.raw.length) {
    L.push('             (the library returns at most ' + (th.maxBoxes == null ? '?' : th.maxBoxes) +
      ' and drops anything under ' + (th.score == null ? '?' : th.score) + ')');
  }
  /* Named on their own lines as well as listed below, because "the best one"
     is the question being asked and reading it out of a table is not the same
     as being told it. */
  var top = f.raw.reduce(function (a, p) {
    return (!a || (+p.confidence || 0) > (+a.confidence || 0)) ? p : a;
  }, null);
  L.push('  best class      ' + (top ? top.class : 'none — nothing was returned'));
  L.push('  best confidence ' + (top ? round4(top.confidence) : 'none'));
  if (top) {
    var tb = top.bbox || {};
    L.push('  best box        x ' + Math.round(tb.x) + ' y ' + Math.round(tb.y) +
      ' w ' + Math.round(tb.width) + ' h ' + Math.round(tb.height) +
      '  (in the ' + RF_SIZE + '² the model was shown)');
  } else {
    L.push('  best box        none');
  }
  f.raw.forEach(function (p, i) {
    var bx = p.bbox || {};
    L.push('  #' + (i + 1) + '  ' + p.class + '  ' + round4(p.confidence) +
      '  box x ' + Math.round(bx.x) + ' y ' + Math.round(bx.y) +
      ' w ' + Math.round(bx.width) + ' h ' + Math.round(bx.height));
  });
  L.push('');

  L.push('THROUGH THE SURVEY\'S OWN FILTERS');
  if (!f.trace.length) L.push('             nothing to filter');
  f.trace.forEach(function (t) { L.push('  ' + t); });
  L.push('');
  L.push('WOULD LOG    ' + f.kept.length + ' pothole' + (f.kept.length === 1 ? '' : 's'));
  var spin = spinLines();
  if (spin) { L.push(''); L.push(spin); }
  var bench = benchLines();
  if (bench) { L.push(''); L.push(bench); }
  return L.join('\n');
}

/* ---------- benchmarking the backends ----------

   The survey runs at about seventeen seconds a frame, and the diagnostics say
   that is genuinely the graph running on TensorFlow.js's plain-JavaScript CPU
   backend: one initialise for two inferences, and eleven milliseconds of that
   in the decoder. So the question is whether another backend runs this same
   graph faster on this same phone, and the only way to answer it is to measure
   rather than to reason about it.

   The vendored SDK cannot host the WASM backend. Its worker keeps TensorFlow.js
   module-scoped and minified — there is no `self.tf` for a plugin backend to
   register against — so the standalone tfjs-backend-wasm has nothing to attach
   to, and reconstructing the export surface it needs out of minified names is
   not a thing anyone should do. That is a real limit and it is reported rather
   than worked around: this benchmark therefore runs its own copy of
   TensorFlow.js 4.22.0, the same version the SDK bundles.

   What makes the comparison fair is that everything else is held identical, and
   held identical by construction rather than by intention:

     one frame, captured once and reused for every backend;
     the same preprocessing, transcribed from the SDK's own preprocess() —
       fromPixels, resizeNearestNeighbor to 640, float32, divide by 255,
       transpose to NCHW;
     the same weights, taken from the model.json the SDK already fetched, shard
       URLs and all, rather than a second copy from somewhere else;
     the same decoder arithmetic, transcribed from the bundle and already under
       test in decode.mjs;
     the same NMS parameters the library uses — 0.5 score, 0.5 IoU, 20 boxes.

   It is a measurement harness. It does not touch the survey, it is loaded only
   when the button is pressed, and nothing it decides changes what the app does
   with a road. */
var BENCH_DIR = 'vendor/tfjs/';
var BENCH_SCRIPTS = ['tf-core.min.js', 'tf-converter.min.js',
                     'tf-backend-cpu.min.js', 'tf-backend-webgl.min.js',
                     'tf-backend-wasm.min.js'];
/* The order the chain would take if this were the survey: the fastest thing
   that answers sensibly, and the CPU last because it always answers. */
var BENCH_ORDER = ['webgl', 'wasm', 'cpu'];
var benchTf = null, benchLoading = null, benchResult = null;

/* One classic script tag. The five are loaded in order, each waiting for the
   last: the UMD builds attach to one shared `tf` global and the backends must
   find the core there before they register.

   This used to be fetched only when the benchmark button was pressed. The
   survey runs on it now, so the 2.4 MB is fetched at startup — which is what
   made how it fails worth this much care. */
/* Which of them have actually executed. Not a cache of the fetch — a record of
   the script having RUN, which is a different thing and the one that matters.

   The chain can be started more than once now: a failed attempt leaves nothing
   behind, and getting signal back or a new worker taking charge starts another.
   Without this, that second attempt re-runs the builds that already loaded, and
   TensorFlow.js throws on the second registration of a kernel it already has —
   turning a recoverable failure into a permanent one. */
var benchRan = {};

function oneBenchScript(file) {
  if (benchRan[file]) return Promise.resolve();
  return new Promise(function (resolve, reject) {
    var el = document.createElement('script');
    el.src = BENCH_DIR + file;
    el.onload = function () { benchRan[file] = true; resolve(); };
    el.onerror = function () { reject(new Error('could not load ' + file)); };
    document.head.appendChild(el);
  });
}

/* A service worker cannot fix the load that installs it.

   Caching these files cache-first was the right fix and it arrives one load
   late: the page that fetches the new worker is still being served by the old
   one, so its 2.4 MB still went through a four-second timeout and still said
   "No model". Reproduced: the load that installs the fix fails, the one after
   it succeeds. Telling somebody to load the app twice is not a fix.

   So a script that fails is asked for again, once, after the new worker has
   taken charge — which is a real event, not a guess: controllerchange fires
   when it claims the page. Four seconds is the cap, because a page with no new
   worker coming must not sit here waiting for one; four rather than one is
   because the new worker precaches the shell before it activates, and on the
   connection where this bug shows up at all that is not instant. The cost of
   the cap is only ever a slower error message.

   Only the file that failed is asked for again — the ones before it in the
   chain already ran, and benchRan above is what makes sure they are not run a
   second time. */
function newWorkerInCharge() {
  var timer = new Promise(function (r) { setTimeout(r, 4000); });
  if (!navigator.serviceWorker) return timer;
  var claimed = new Promise(function (r) {
    try {
      navigator.serviceWorker.addEventListener('controllerchange',
        function () { r(); }, { once: true });
    } catch (e) { /* left to the timer */ }
  });
  /* A short pause either way: claiming the page and being ready to answer for
     it are not the same instant. */
  return Promise.race([claimed, timer]).then(function () {
    return new Promise(function (r) { setTimeout(r, 200); });
  });
}

function benchScript(file) {
  return oneBenchScript(file).catch(function (first) {
    infFacts.retried.push(file);
    return newWorkerInCharge().then(function () {
      return oneBenchScript(file);
    }).catch(function () {
      /* The second failure says nothing the first did not, and the first is
         the one that names what was being fetched. */
      throw first;
    });
  });
}

function loadBenchTf() {
  if (benchTf) return Promise.resolve(benchTf);
  if (benchLoading) return benchLoading;
  benchLoading = BENCH_SCRIPTS.reduce(function (chain, file) {
    return chain.then(function () { return benchScript(file); });
  }, Promise.resolve()).then(function () {
    if (!window.tf) throw new Error('TensorFlow.js did not attach itself');
    /* Same-origin, so the binaries work with no signal once cached. */
    if (window.tf.wasm && window.tf.wasm.setWasmPaths) {
      window.tf.wasm.setWasmPaths(BENCH_DIR);
    }
    benchTf = window.tf;
    return benchTf;
  }, function (e) { benchLoading = null; throw e; });
  return benchLoading;
}

/* What the runtime itself says about SIMD and threads, asked rather than
   assumed. Threads additionally need the page to be cross-origin isolated,
   which needs COOP and COEP headers that GitHub Pages does not send — so the
   answer is reported alongside the reason. */
function benchWasmCapabilities(tf) {
  var env = tf.env();
  var ask = function (flag) {
    try { return Promise.resolve(env.getAsync(flag)); }
    catch (e) { return Promise.resolve(null); }
  };
  return ask('WASM_HAS_SIMD_SUPPORT').then(function (simd) {
    return ask('WASM_HAS_MULTITHREAD_SUPPORT').then(function (threads) {
      return {
        simd: simd,
        threads: threads,
        isolated: (typeof crossOriginIsolated === 'boolean') ? crossOriginIsolated : null,
        cores: navigator.hardwareConcurrency || null,
        sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined'
      };
    });
  }).catch(function () {
    return { simd: null, threads: null, isolated: null, cores: null,
             sharedArrayBuffer: false };
  });
}

/* The weights the SDK already has, handed to this copy of TensorFlow.js
   unchanged. Roboflow returns model.json inline with absolute shard URLs, so
   there is nothing to re-resolve and no second version of the model anywhere. */
function benchLoader(tf, weights) {
  return {
    load: function () {
      var specs = [], paths = [];
      (weights.weightsManifest || []).forEach(function (g) {
        (g.weights || []).forEach(function (w) { specs.push(w); });
        (g.paths || []).forEach(function (p) { paths.push(p); });
      });
      return Promise.all(paths.map(function (u) {
        return fetch(u).then(function (r) {
          if (!r.ok) throw new Error('shard HTTP ' + r.status);
          return r.arrayBuffer();
        });
      })).then(function (buffers) {
        var total = buffers.reduce(function (n, b) { return n + b.byteLength; }, 0);
        var all = new Uint8Array(total), at = 0;
        buffers.forEach(function (b) { all.set(new Uint8Array(b), at); at += b.byteLength; });
        return { modelTopology: weights.modelTopology,
                 weightSpecs: specs, weightData: all.buffer };
      });
    }
  };
}

/* The SDK's own preprocess(), transcribed:
     tensor4D -> resizeNearestNeighbor([640,640]) -> float32 -> /255 -> NCHW

   Written with top-level tf.* calls and NO METHOD CHAINING, and that is the
   whole point rather than a style preference.

   Chained ops — x.expandDims(0), x.asType('float32') — are not part of a
   Tensor. They are registered onto its prototype by the UNION package,
   @tensorflow/tfjs. What is vendored here is @tensorflow/tfjs-core plus the
   backends, which is the smaller, correct dependency for this and does not
   register any of them: x.expandDims is undefined.

   This was written when the Roboflow SDK was still loaded. The SDK bundles the
   union package, its copy registered the chained ops onto the shared prototype,
   and these two lines worked — which is why the benchmark ran and produced the
   numbers the survey was moved onto WASM for. Removing the SDK removed the
   thing that was making them work, so preprocessing threw on the first frame,
   every backend failed identically in the probe, and the gauge said "No
   backend". The library was never the problem and neither was the model.

   tf.cast is what asType aliases, so the arithmetic is unchanged. */
function benchPreprocess(tf, canvas) {
  return tf.tidy(function () {
    var px = tf.expandDims(tf.browser.fromPixels(canvas), 0);
    var r = tf.cast(tf.image.resizeNearestNeighbor(px, [RF_SIZE, RF_SIZE]), 'float32');
    return tf.transpose(tf.div(r, 255), [0, 3, 1, 2]);
  });
}

/* The library's decoder arithmetic, transcribed from its bundle. The index
   expression below reads oddly and is correct: w*nc + (w+1)*4 expands to
   w*(nc+4) + 4, which is the first class channel of anchor w. */
function benchMaxScores(data, numBoxes, numClasses) {
  var scores = [], classes = [];
  for (var w = 0; w < numBoxes; w++) {
    var best = Number.MIN_VALUE, bi = -1;
    for (var a = 0; a < numClasses; a++) {
      var v = data[w * numClasses + (w + 1) * 4 + a];
      if (v > best) { best = v; bi = a; }
    }
    scores[w] = best; classes[w] = bi;
  }
  return { scores: scores, classes: classes };
}

function benchBoxes(data, numBoxes, numClasses, size) {
  var out = new Float32Array(numBoxes * 4);
  for (var w = 0; w < numBoxes; w++) {
    var o = w * (numClasses + 4);
    var x = data[o], y = data[o + 1], bw = data[o + 2], bh = data[o + 3];
    out[w * 4]     = (y - bh / 2) / size;      // y1, x1, y2, x2 — the order NMS wants
    out[w * 4 + 1] = (x - bw / 2) / size;
    out[w * 4 + 2] = (y + bh / 2) / size;
    out[w * 4 + 3] = (x + bw / 2) / size;
  }
  return out;
}

/* One backend, one frame. Load and warm-up are timed separately and excluded
   from the inference figure — the first execute on any backend pays for kernel
   and shader compilation, and reporting that as the cost of a frame would
   flatter whichever backend happened to go last. */
/* How many times each backend runs the graph. The first is the cold one — it
   pays for kernel and shader compilation and for whatever the backend defers
   until something actually asks — and the rest are what a survey would
   actually experience, because the survey loads the model once and reuses it.
   Reporting only the first would libel a backend; reporting only the warmed
   ones would hide a cost that is real the first time a phone looks at a road. */
var BENCH_PASSES = 3;

/* One backend, one picture, several passes.

   Everything that happens once — choosing the backend, initialising it, loading
   the weights, preprocessing the frame — is timed separately and kept out of
   the inference figures. What is left is the graph, measured the way the survey
   would experience it. */
function benchOne(tf, name, weights, canvas) {
  var row = { backend: name, supported: false, initialised: false, sane: null,
              init: null, load: null, pre: null,
              first: null, warmed: null, passes: [],
              decode: null, total: null, detections: null, best: null,
              min: null, max: null, threads: null, error: null };
  var model = null, input = null;

  var t0 = performance.now();
  return tf.setBackend(name).then(function (okBackend) {
    if (!okBackend) throw new Error('this browser has no ' + name + ' backend');
    return tf.ready();
  }).then(function () {
    row.supported = true;
    row.init = Math.round(performance.now() - t0);
    /* Only answerable once the backend is actually up — asked before that, the
       library throws rather than guessing, which is the right behaviour and the
       reason this is here and not in the capability probe. */
    if (name === 'wasm' && tf.wasm && tf.wasm.getThreadsCount) {
      try { row.threads = tf.wasm.getThreadsCount(); } catch (e) { row.threads = null; }
    }
    var t = performance.now();
    return tf.loadGraphModel(benchLoader(tf, weights)).then(function (m) {
      model = m; row.load = Math.round(performance.now() - t);
      row.initialised = true;
    });
  }).then(function () {
    /* Preprocessing is per backend because it builds tensors on that backend,
       so it is genuinely part of what that backend costs — but it is not
       inference, and it is reported on its own line. */
    var t = performance.now();
    input = benchPreprocess(tf, canvas);
    /* Force the work rather than timing the queueing of it. */
    input.dataSync();
    row.pre = Math.round(performance.now() - t);
  }).then(function () {
    /* The passes. dataSync stays inside the timed region deliberately: on a
       lazy backend execute only queues the work, and a figure that stopped
       before the readback would be timing the queueing rather than the graph. */
    var last = null;
    var runPass = function (i) {
      if (i >= BENCH_PASSES) return Promise.resolve();
      var a = performance.now();
      var out = model.execute(input);
      var one = Array.isArray(out) ? out[0] : out;
      var moved = tf.transpose(one, [0, 2, 1]);
      var data = moved.dataSync();
      var ms = Math.round(performance.now() - a);
      row.passes.push(ms);
      if (last) { tf.dispose(last.out); tf.dispose(last.moved); }
      last = { out: out, moved: moved, data: data, shape: moved.shape };
      /* Yield to the event loop between passes so a twenty-second synchronous
         graph does not make the page look hung, and so the status line moves. */
      return new Promise(function (r) { setTimeout(r, 0); }).then(function () {
        return runPass(i + 1);
      });
    };
    return runPass(0).then(function () {
      row.first = row.passes[0];
      var rest = row.passes.slice(1);
      row.warmed = rest.length
        ? Math.round(rest.reduce(function (a, b) { return a + b; }, 0) / rest.length)
        : row.passes[0];

      var t1 = performance.now();
      var data = last.data;
      var numBoxes = last.shape[1], numClasses = last.shape[2] - 4;
      var lo = Infinity, hi = -Infinity;
      for (var i = 0; i < data.length; i++) {
        var v = data[i]; if (v < lo) lo = v; if (v > hi) hi = v;
      }
      row.min = lo; row.max = hi;
      row.sane = isFinite(lo) && isFinite(hi) && Math.abs(hi) < 1e4 && Math.abs(lo) < 1e4;

      var sc = benchMaxScores(data, numBoxes, numClasses);
      var boxes = benchBoxes(data, numBoxes, numClasses, RF_SIZE);
      var classNames = (rfMeta && rfMeta.classes) || ['manhole', 'pothole'];

      /* The library forces NMS onto the CPU backend whatever it inferred with,
         so this does too — otherwise the decode figure would carry a different
         backend's cost on every row. */
      var was = tf.getBackend();
      return tf.setBackend('cpu').then(function () {
        var keep = tf.tidy(function () {
          return tf.image.nonMaxSuppression(
            tf.tensor2d(boxes, [numBoxes, 4]), sc.scores, 20, 0.5, 0.5).dataSync();
        });
        var best = null, perClass = {};
        for (var k = 0; k < numBoxes; k++) {
          var ci = sc.classes[k];
          if (ci < 0) continue;
          var nm = classNames[ci];
          if (perClass[nm] == null || sc.scores[k] > perClass[nm]) perClass[nm] = sc.scores[k];
          if (!best || sc.scores[k] > best.score) best = { score: sc.scores[k], cls: nm };
        }
        row.detections = keep.length;
        row.best = best;
        row.perClass = perClass;
        row.decode = Math.round(performance.now() - t1);
        row.total = row.pre + row.warmed + row.decode;
        tf.dispose(last.out); tf.dispose(last.moved);
        last = null;
        return tf.setBackend(was);
      });
    });
  }).then(function () { return row; }, function (e) {
    row.error = String((e && e.message) || e).slice(0, 200);
    return row;
  }).then(function (r) {
    /* Everything this backend allocated goes back, whether it succeeded or
       not: three backends each holding a copy of a 229-tensor model is how a
       phone runs out of memory halfway down a road. */
    if (input) { try { tf.dispose(input); } catch (e) {} }
    if (model && model.dispose) { try { model.dispose(); } catch (e) {} }
    input = null; model = null;
    r.leftOver = (function () {
      try { return tf.memory().numTensors; } catch (e) { return null; }
    })();
    return r;
  });
}

/* The benchmark, over one picture.

   The picture is drawn to the 640² square ONCE, before any backend is touched,
   and that one canvas is handed to all three. Drawing per backend would be
   measuring three different pictures and calling the difference a backend.

   A photograph is the better subject than a camera frame, and not only because
   it holds still: the known result — pothole 0.7236, manhole 0.0047 — was
   measured on one, so running the same file again is the only way to tell a
   faster backend from a differently-wrong one. */
function runBench(source, w, h, label) {
  var s = $('tState');
  busy(true);
  s.textContent = 'Fetching TensorFlow.js (about 2.4 MB, once)…';

  var sq = squareFrame(source, w, h);
  var started = new Date().toISOString();

  loadBenchTf().then(function (tf) {
    s.textContent = 'Asking the runtime what it supports…';
    return benchWasmCapabilities(tf).then(function (caps) {
      return modelMeta().then(function (meta) {
        if (!meta || !meta.weights || !meta.weights.modelTopology) {
          throw new Error('the model metadata has no weights in it — no signal?');
        }
        var rows = [];
        return BENCH_ORDER.reduce(function (chain, name) {
          return chain.then(function () {
            s.textContent = 'Running the same picture on ' + name + ', ' +
              BENCH_PASSES + ' passes… (' + (rows.length + 1) + ' of ' +
              BENCH_ORDER.length + ', the CPU pass is slow)';
            return benchOne(tf, name, meta.weights, sq.canvas).then(function (r) {
              rows.push(r);
            });
          });
        }, Promise.resolve()).then(function () {
          return { at: started, caps: caps, rows: rows, label: label,
                   source: w + '×' + h };
        });
      });
    });
  }).then(function (out) {
    benchResult = out;
    paintFrameTest(); paintDiag();
    var fastest = out.rows.filter(function (r) { return r.sane && r.warmed != null; })
      .sort(function (a, b) { return a.warmed - b.warmed; })[0];
    s.textContent = fastest
      ? 'Done. Fastest usable: ' + fastest.backend + ' at ' + fastest.warmed +
        ' ms warmed. Read the table before concluding anything.'
      : 'Done — no backend produced usable output. Read the table below.';
    busy(false);
  }, function (e) {
    benchResult = null;
    s.textContent = 'Benchmark could not run: ' + String((e && e.message) || e);
    busy(false);
  });
}

/* The camera, for a quick look. */
function runBenchCamera() {
  var v = $('vid');
  if (!stream || !v.videoWidth) {
    $('tState').textContent = 'The camera is not running — start it, then come back, ' +
      'or benchmark a photograph instead.';
    return;
  }
  runBench(v, v.videoWidth, v.videoHeight, 'camera');
}

function benchLines() {
  if (!benchResult) return '';
  var b = benchResult, c = b.caps || {}, L = [];
  L.push('BACKEND BENCHMARK  (one picture, drawn once, reused for every backend)');
  L.push('when         ' + b.at);
  L.push('picture      ' + (b.label || 'camera') + ', ' + b.source + ' → ' +
    RF_SIZE + '×' + RF_SIZE + ', preprocessed exactly as the survey does it');
  L.push('passes       ' + BENCH_PASSES + ' per backend — the first cold, the rest warmed');
  L.push('runtime      TensorFlow.js ' + ((benchTf && benchTf.version_core) || '?') +
    ' loaded by this benchmark — the SDK keeps its own copy module-scoped');
  L.push('');
  L.push('WASM SUPPORT (what the runtime reports, not what it is assumed to have)');
  L.push('  SIMD       ' + (c.simd === null ? 'could not be determined' : c.simd ? 'yes' : 'no'));
  L.push('  threads    ' + (c.threads === null ? 'could not be determined' : c.threads ? 'yes' : 'no'));
  var wasmRow = null;
  b.rows.forEach(function (r) { if (r.backend === 'wasm') wasmRow = r; });
  L.push('  thread count ' + (wasmRow && wasmRow.threads != null
    ? wasmRow.threads + ' (asked of the wasm backend after it initialised)'
    : 'not reported — the wasm backend never initialised, and it throws rather ' +
      'than guess before it has'));
  L.push('  cores      ' + (c.cores == null ? 'not reported' : c.cores) +
    ' (what the browser says the phone has, which is not what wasm uses)');
  L.push('  SharedArrayBuffer ' + (c.sharedArrayBuffer ? 'present' : 'absent'));
  L.push('  crossOriginIsolated ' + (c.isolated === null ? 'unknown' : c.isolated));
  if (!c.threads) {
    L.push('  >> threads need the page to be cross-origin isolated, which needs COOP');
    L.push('     and COEP headers. GitHub Pages does not send them, so this is a');
    L.push('     property of where the app is hosted rather than of the phone.');
  }
  L.push('');
  b.rows.forEach(function (r) {
    L.push(r.backend.toUpperCase());
    L.push('  backend          ' + r.backend);
    L.push('  supported        ' + (r.supported ? 'yes' : 'no'));
    L.push('  initialised      ' + (r.initialised ? 'yes' : 'no'));
    if (r.error) {
      L.push('  FAILED           ' + r.error);
      L.push('');
      return;
    }
    L.push('  sanity check     ' + (r.sane ? 'PASS' : 'FAIL — this backend cannot be trusted'));
    L.push('  preprocess_ms    ' + r.pre);
    L.push('  execute_ms       ' + r.warmed + '   (warmed; first pass ' + r.first + ')');
    L.push('  all passes       ' + r.passes.join(', ') + ' ms');
    L.push('  read_decode_ms   ' + r.decode);
    L.push('  total_ms         ' + r.total + '   (preprocess + warmed execute + decode)');
    L.push('  detections       ' + r.detections);
    L.push('  best_class       ' + (r.best ? r.best.cls : 'none'));
    L.push('  best_confidence  ' + (r.best ? round4(r.best.score) : 'none'));
    if (r.perClass) {
      L.push('  by class         ' + Object.keys(r.perClass).map(function (k) {
        return k + ' ' + round4(r.perClass[k]);
      }).join('    '));
    }
    L.push('  raw_min          ' + round4(r.min));
    L.push('  raw_max          ' + round4(r.max));
    L.push('  one-time cost    backend init ' + r.init + ' ms, model load ' + r.load +
      ' ms  (excluded from the figures above)');
    L.push('  tensors left     ' + (r.leftOver == null ? '?' : r.leftOver) +
      ' after disposal');
    L.push('');
  });

  /* A faster backend that answers differently is not a faster backend, it is a
     different model. CPU is the reference because CPU is what produced the
     result this whole exercise is measured against. */
  var cpu = null;
  b.rows.forEach(function (r) { if (r.backend === 'cpu') cpu = r; });
  L.push('DO THEY AGREE?  (CPU is the reference — it is what produced 0.7236)');
  if (!cpu || !cpu.sane) {
    L.push('             CPU did not produce a usable answer, so there is nothing to');
    L.push('             compare the others against.');
  } else {
    L.push('  cpu        ' + (cpu.best ? cpu.best.cls + ' ' + round4(cpu.best.score) : 'nothing') +
      ', ' + cpu.detections + ' detection' + (cpu.detections === 1 ? '' : 's'));
    b.rows.forEach(function (r) {
      if (r.backend === 'cpu' || r.error) return;
      if (!r.sane) {
        L.push('  ' + pad(r.backend, 9) + 'output failed the sanity check — not comparable');
        return;
      }
      var same = !!(r.best && cpu.best) && r.best.cls === cpu.best.cls;
      var gap = (r.best && cpu.best) ? Math.abs(r.best.score - cpu.best.score) : null;
      var det = r.detections === cpu.detections;
      L.push('  ' + pad(r.backend, 9) +
        (r.best ? r.best.cls + ' ' + round4(r.best.score) : 'nothing') +
        ', ' + r.detections + ' detection' + (r.detections === 1 ? '' : 's') +
        ' — ' + (same && det && gap != null && gap < 0.01
          ? 'AGREES with CPU (within ' + round4(gap) + ')'
          : 'DIFFERS from CPU' + (gap == null ? '' : ' by ' + round4(gap)) +
            '. A faster backend that answers differently is not usable.'));
    });
  }
  L.push('');

  var usable = b.rows.filter(function (r) { return r.sane && r.warmed != null; });
  if (usable.length > 1) {
    var sorted = usable.slice().sort(function (a, b2) { return a.warmed - b2.warmed; });
    var f = sorted[0], sl = sorted[sorted.length - 1];
    L.push('FASTEST USABLE  ' + f.backend + ' at ' + f.warmed + ' ms warmed — ' +
      (Math.round((sl.warmed / f.warmed) * 10) / 10) + '× the ' + sl.backend + ' figure');
  } else if (usable.length === 1) {
    L.push('ONLY USABLE     ' + usable[0].backend + ' at ' + usable[0].warmed + ' ms warmed');
  } else {
    L.push('NOTHING USABLE  no backend produced output in a plausible range');
  }
  L.push('');
  L.push('This is a measurement and it changes nothing by itself. What the survey');
  L.push('actually runs on is chosen separately and reported under SURVEY BACKEND');
  L.push('above: WASM if it is sane, CPU if not, and WebGL never.');
  return L.join('\n');
}

function pad(s, n) {
  s = String(s);
  while (s.length < n) s += ' ';
  return s;
}

/* ---------- the backend the survey actually runs on ----------

   Measured on this phone, on the photograph that already had an answer:

     wasm   533 ms warmed, pothole 0.7236, raw 0 to 637.0227   <- sane
     cpu  17692 ms warmed, pothole 0.7236, raw 0 to 637.0227   <- sane, and 33x slower
     webgl  174 ms warmed, "manhole 407894400", raw -27024638 to 407894400

   WebGL is not slow, it is wrong, and it is wrong in the most dangerous way
   available: it returned TWENTY detections — the library's own cap — on a frame
   containing one pothole. A survey trusting that would have written down twenty
   phantom defects from a single look. It is therefore not in the list below,
   and there is no flag that puts it there.

   CPU's 17.7 s is not a slow backend, it is an unusable one: at one look per
   ten metres that is a survey speed of 1.25 mph. WASM is what makes this
   application do the thing it claims to do.

   None of the machinery here is new. The preprocessing, the decoder, the NMS
   parameters and the weight loader are the same functions the benchmark used,
   called from a different place — deliberately, because a production path that
   is not the measured path has not been measured. */

/* CPU is last because it always works, and it is in the list at all because a
   phone that cannot do WASM must still be able to survey a road slowly rather
   than not at all. */
var SURVEY_BACKENDS = ['wasm', 'cpu'];

/* The library's own numbers, named rather than repeated. Unchanged. */
var RF_IOU = 0.5, RF_MAXBOX = 20, RF_SCORE = 0.5;

/* Beyond this, one look is no longer one look at a stretch of road. */
var SLOW_INFER_MS = 3000;

var infSession = null;                 // { tf, model, backend }
var infExcluded = [];                  // backends that failed, and stay failed
var infFacts = {
  backend: null, tried: [], simd: null, threads: null, threadCount: null,
  cores: null, isolated: null, loads: 0, infers: 0, startFail: null,
  lastMs: null, recent: [], demoted: null, startedAt: null,
  /* Which of the five runtime scripts had to be asked for twice. Empty is the
     normal case; anything in it means the first request was answered by a
     worker on its way out, and is worth seeing rather than being silently
     papered over. */
  retried: []
};

/* The picture the sanity check is run on.

   NOT flat grey. A flat frame makes every score and every box zero, and zeros
   cannot tell a working backend from one that returns zeros — which is exactly
   the failure being screened for. A gradient with an edge in it makes the graph
   produce a range, and a range is the thing being judged. */
function infProbeCanvas() {
  var c = document.createElement('canvas');
  c.width = c.height = RF_SIZE;
  var x = c.getContext('2d', { willReadFrequently: true });
  var g = x.createLinearGradient(0, 0, RF_SIZE, RF_SIZE);
  g.addColorStop(0, '#1e1e1e'); g.addColorStop(1, '#d8d8d8');
  x.fillStyle = g; x.fillRect(0, 0, RF_SIZE, RF_SIZE);
  x.fillStyle = '#0d0d0d';
  x.beginPath();
  x.ellipse(RF_SIZE / 2, RF_SIZE * 0.6, 90, 55, 0, 0, Math.PI * 2);
  x.fill();
  return c;
}

/* One frame through the graph, decoded exactly as the library decodes it.

   Shared by the sanity probe and by every look the survey takes, so the thing
   screened at startup is the thing that runs on the road. */
function infOnce(tf, model, source) {
  var input = null, out = null, moved = null;
  return Promise.resolve().then(function () {
    input = benchPreprocess(tf, source);
    var t0 = performance.now();
    out = model.execute(input);
    var one = Array.isArray(out) ? out[0] : out;
    var rawShape = one && one.shape ? [].concat(one.shape) : null;
    moved = tf.transpose(one, [0, 2, 1]);
    var data = moved.dataSync();
    var msExecute = performance.now() - t0;
    var t1 = performance.now();
    var numBoxes = moved.shape[1], numClasses = moved.shape[2] - 4;
    /* Before a single box is read out, check this is the output the registry
       says this model has. A graph with a different number of classes decoded
       against these class names does not fail — it succeeds, and puts a
       confident wrong answer in the log. That is the failure mode this app has
       already had, with confidences in the millions. */
    var wrong = modelValidate(numClasses);
    if (wrong) throw new Error('model mismatch: ' + wrong);

    var lo = Infinity, hi = -Infinity;
    for (var i = 0; i < data.length; i++) {
      var v = data[i]; if (v < lo) lo = v; if (v > hi) hi = v;
    }
    /* The same check that caught WebGL, applied to whatever is running now —
       not once at startup and then trusted forever. */
    var sane = isFinite(lo) && isFinite(hi) && Math.abs(hi) < 1e4 && Math.abs(lo) < 1e4;

    var sc = benchMaxScores(data, numBoxes, numClasses);
    var boxes = benchBoxes(data, numBoxes, numClasses, RF_SIZE);
    var classNames = (rfMeta && rfMeta.classes) || ['manhole', 'pothole'];

    /* NMS on the CPU backend whatever inferred, because that is what the
       library does and what the benchmark measured. The switch is inside the
       13 ms the benchmark reported, so it is already paid for. */
    var was = tf.getBackend();
    return tf.setBackend('cpu').then(function () {
      var keep = tf.tidy(function () {
        return tf.image.nonMaxSuppression(
          tf.tensor2d(boxes, [numBoxes, 4]), sc.scores,
          RF_MAXBOX, RF_IOU, RF_SCORE).dataSync();
      });
      var preds = [], best = null, perClass = [];
      var byClass = {};
      for (var k = 0; k < numBoxes; k++) {
        var ci = sc.classes[k];
        if (ci < 0) continue;
        var nm = classNames[ci];
        if (byClass[nm] == null || sc.scores[k] > byClass[nm].score) {
          byClass[nm] = { cls: nm, score: sc.scores[k], anchor: k };
        }
        if (!best || sc.scores[k] > best.score) {
          best = { score: sc.scores[k], cls: nm, anchor: k,
                   box: { x: data[k * (numClasses + 4)],
                          y: data[k * (numClasses + 4) + 1],
                          width: data[k * (numClasses + 4) + 2],
                          height: data[k * (numClasses + 4) + 3] } };
        }
      }
      Object.keys(byClass).forEach(function (n) { perClass.push(byClass[n]); });
      /* The shape the rest of this file already understands: class, confidence,
         bbox. Nothing downstream needs to know which backend produced it. */
      for (var j = 0; j < keep.length; j++) {
        var a = keep[j], o = a * (numClasses + 4);
        preds.push({ class: classNames[sc.classes[a]], confidence: sc.scores[a],
                     bbox: { x: data[o], y: data[o + 1],
                             width: data[o + 2], height: data[o + 3] } });
      }
      var msDecode = performance.now() - t1;
      return tf.setBackend(was).then(function () {
        return { preds: preds, sane: sane, min: lo, max: hi, rawShape: rawShape,
                 best: best, perClass: perClass,
                 msExecute: msExecute, msDecode: msDecode };
      });
    });
  }).then(function (r) { infDispose(tf, [input, out, moved]); return r; },
          function (e) { infDispose(tf, [input, out, moved]); throw e; });
}

/* Every frame allocates and every frame gives it back. A survey is thousands of
   looks; one tensor leaked per look is the phone running out of memory halfway
   down a road. */
function infDispose(tf, list) {
  list.forEach(function (t) {
    if (!t) return;
    try { tf.dispose(t); } catch (e) { /* already gone */ }
  });
}

/* Bring one backend up, load the weights onto it, and refuse to trust it until
   it has answered a picture sensibly. */
function infStart(tf, name) {
  var row = { backend: name, supported: false, initialised: false, sane: null,
              min: null, max: null, initMs: null, loadMs: null, error: null };
  var model = null, t0 = performance.now();
  return tf.setBackend(name).then(function (okBackend) {
    if (!okBackend) throw new Error('this browser has no ' + name + ' backend');
    return tf.ready();
  }).then(function () {
    row.supported = true;
    row.initMs = Math.round(performance.now() - t0);
    if (name === 'wasm' && tf.wasm && tf.wasm.getThreadsCount) {
      /* Answerable only once the backend is up; it throws before that rather
         than guessing, which is the right behaviour. */
      try { infFacts.threadCount = tf.wasm.getThreadsCount(); } catch (e) {}
    }
    return modelMeta();
  }).then(function (meta) {
    if (!meta || !meta.weights || !meta.weights.modelTopology) {
      throw new Error('the model metadata carries no weights' +
        (meta && meta.error ? ' — ' + meta.error : ''));
    }
    var t = performance.now();
    return tf.loadGraphModel(benchLoader(tf, meta.weights)).then(function (m) {
      model = m;
      row.loadMs = Math.round(performance.now() - t);
      row.initialised = true;
      infFacts.loads++;
    });
  }).then(function () {
    return infOnce(tf, model, infProbeCanvas());
  }).then(function (probe) {
    row.min = probe.min; row.max = probe.max; row.sane = probe.sane;
    if (!probe.sane) {
      throw new Error('output failed the sanity check — min ' + round4(probe.min) +
        ', max ' + round4(probe.max) + '. This is what WebGL does on this phone.');
    }
    infFacts.tried.push(row);
    return { tf: tf, model: model, backend: name };
  }).catch(function (e) {
    row.error = String((e && e.message) || e).slice(0, 200);
    infFacts.tried.push(row);
    if (model && model.dispose) { try { model.dispose(); } catch (x) {} }
    throw e;
  });
}

/* WASM, then CPU. Anything that has already failed stays failed for the rest of
   the session rather than being retried on every frame. */
function infPick(tf) {
  var names = SURVEY_BACKENDS.filter(function (n) {
    return infExcluded.indexOf(n) === -1;
  });
  if (!names.length) {
    return Promise.reject(new Error('no usable backend left — tried ' +
      SURVEY_BACKENDS.join(' and ')));
  }
  return names.reduce(function (chain, name) {
    return chain.catch(function () { return infStart(tf, name); });
  }, Promise.reject(new Error('start')));
}

/* A backend that was sane at startup and is not any more. Rather than logging
   whatever it produced, it is put down and the next one is brought up. */
function infDemote(why) {
  var was = infSession && infSession.backend;
  if (!was) return;
  infExcluded.push(was);
  infFacts.demoted = { backend: was, why: why, at: new Date().toISOString() };
  try {
    if (infSession.model && infSession.model.dispose) infSession.model.dispose();
  } catch (e) { /* nothing to be done about it */ }
  infSession = null;
  engine = null; worker = null; loading = null;
  infFacts.backend = null;
}

/* The object the rest of the app talks to.

   It is deliberately the same shape as the library's InferenceEngine — one
   infer(workerId, image) returning a list of detections with the diagnostic
   block on the end — so look(), testFrame(), the self-test and the diagnostics
   screen did not have to learn anything new. */
function surveyEngine() {
  return {
    tfjs: true,
    infer: function (workerId, img) {
      if (!infSession) return Promise.reject(new Error('no inference session'));
      var s = infSession;
      var source = (img && img.bitmapImage) ? img.bitmapImage : img;
      var t0 = performance.now();
      return infOnce(s.tf, s.model, source).then(function (r) {
        var whole = performance.now() - t0;
        infFacts.infers++;
        infFacts.lastMs = Math.round(r.msExecute);
        infFacts.recent.push(infFacts.lastMs);
        if (infFacts.recent.length > 10) infFacts.recent.shift();
        if (!r.sane) {
          /* Down it goes. The caller gets the failure rather than the numbers. */
          infDemote('returned min ' + round4(r.min) + ', max ' + round4(r.max) +
            ' on a real frame');
          throw new Error('the ' + s.backend + ' backend stopped making sense ' +
            '(min ' + round4(r.min) + ', max ' + round4(r.max) + ') and has been ' +
            'dropped; the next look will use the fallback');
        }
        return r.preds.concat([{
          __diag: true, outputs: 1, rawShape: r.rawShape,
          afterTranspose: r.rawShape ? [r.rawShape[0], r.rawShape[2], r.rawShape[1]] : null,
          readAs: { boxes: r.rawShape ? r.rawShape[2] : null,
                    classes: r.rawShape ? r.rawShape[1] - 4 : null },
          imageDims: [RF_SIZE, RF_SIZE],
          layoutUsed: 'native', layoutNative: 'NCHW', layoutProbe: null,
          precision: { tried: [{ how: 'as loaded', backend: s.backend,
                                 min: r.min, max: r.max, ok: true }],
                       using: s.backend, ok: true },
          frameRange: { min: r.min, max: r.max },
          best: r.best, perClass: r.perClass,
          ms: Math.round(whole), msExecute: Math.round(r.msExecute),
          msDecode: Math.round(r.msDecode),
          inits: infFacts.loads, infers: infFacts.infers,
          backendNow: s.backend,
          thresholds: { score: RF_SCORE, iou: RF_IOU, maxBoxes: RF_MAXBOX },
          classNames: (rfMeta && rfMeta.classes) || ['manhole', 'pothole']
        }]);
      });
    }
  };
}

/* What the runtime says about WASM, asked once and kept. */
function infCapabilities(tf) {
  return benchWasmCapabilities(tf).then(function (c) {
    infFacts.simd = c.simd; infFacts.threads = c.threads;
    infFacts.cores = c.cores; infFacts.isolated = c.isolated;
    return c;
  });
}

/* Whether one look is still one look at a stretch of road.

   Not a fixed threshold pretending to be a judgement: at 30 mph a 600 ms
   inference covers five metres and the survey is fine; the same 600 ms at
   70 mph covers nineteen and it is not. So the warning is computed from the
   speed actually being reported, and falls back to a flat limit when there is
   no speed to reason with. */
function coverageWarning() {
  var ms = infFacts.lastMs;
  if (ms == null) return null;
  var sp = S.gps ? S.gps.speed : null;
  if (sp != null && sp >= STATIONARY_MPS) {
    var m = sp * (ms / 1000);
    if (m > SURVEY_M) {
      return 'Slow inference — survey coverage reduced (' + Math.round(m) +
             ' m passes per look, not ' + SURVEY_M + ')';
    }
    return null;
  }
  if (ms >= SLOW_INFER_MS) return 'Slow inference — survey coverage reduced';
  return null;
}

/* ---------- why was that pothole not logged? ----------

   Diagnostic only. It changes nothing about the survey: no threshold moves, no
   weights change, nothing is written to the log. It exists to answer one
   question that the survey screen cannot, because the survey screen only ever
   shows what survived.

   A miss has several possible authors and they need different remedies:

     the model produced no pothole candidate at all      — a model problem
     it produced one, under the bar                      — a threshold argument
     it produced one, and NMS dropped it                 — a decoder problem
     it produced one, and the shadow test rejected it    — a filter problem
     the box was unmeasurable                            — a decode problem

   Only the first is answered by retraining, and the survey's own display
   cannot tell any of them apart. So this reports EVERY candidate the graph
   produced above a deliberately low floor, what each stage did to it, and what
   would have survived at each threshold — which turns "it missed it" into a
   number somebody can argue with. */
var MISS_FLOOR = 0.05;          // below this a YOLO anchor is background noise
var MISS_STEPS = [0.05, 0.10, 0.25, 0.40, 0.45, 0.50, 0.55, 0.60, 0.65];
/* The sweep is the part of that table anybody would actually consider
   moving the bar to. Below it the question stops being calibration and
   starts being whether the model saw anything at all. */
var MISS_SWEEP = 0.40;
var MISS_LIST = 25;             // candidates listed per class, highest first
/* The finest stride in a YOLOv8 head: the P3 feature map is the input divided
   by 8, so anything smaller than this in the tensor has at most one anchor
   sitting on it. Used only to say, in the report, how small is too small. */
var MISS_STRIDE = 8;
var missResult = null;
/* Every photograph in the batch, in the order they were picked. One image
   answers "was this one missed, and by which stage". The decision that is
   actually in front of us — whether 0.65 is too high, or whether the model
   needs replacing — cannot be made from one image, so a batch keeps its runs
   side by side and the report leads with the table across them. */
var missRuns = [];

/* Every anchor, every class — not the winner-takes-all the decoder needs.

   benchMaxScores keeps one score per anchor, the best class, because that is
   what NMS wants. For a miss that is exactly the wrong summary: a pothole at
   0.42 sitting under a manhole at 0.44 on the same anchor disappears from the
   report entirely, and that is a case worth being able to see. */
function missCandidates(data, numBoxes, numClasses, classNames, size) {
  var per = [];
  for (var c = 0; c < numClasses; c++) per.push([]);
  var best = [];
  for (var c2 = 0; c2 < numClasses; c2++) best.push(null);

  for (var w = 0; w < numBoxes; w++) {
    var o = w * (numClasses + 4);
    for (var a = 0; a < numClasses; a++) {
      var v = data[w * numClasses + (w + 1) * 4 + a];
      if (!isFinite(v)) continue;
      var rec = null;
      if (v >= MISS_FLOOR) {
        rec = { anchor: w, cls: classNames[a] || ('class ' + a), conf: v,
                box: { x: data[o], y: data[o + 1], w: data[o + 2], h: data[o + 3] } };
        per[a].push(rec);
      }
      if (!best[a] || v > best[a].conf) {
        best[a] = rec || { anchor: w, cls: classNames[a] || ('class ' + a), conf: v,
                           box: { x: data[o], y: data[o + 1],
                                  w: data[o + 2], h: data[o + 3] } };
      }
    }
  }
  per.forEach(function (l) { l.sort(function (x, y) { return y.conf - x.conf; }); });
  return { per: per, best: best };
}

/* One picture, every stage, nothing filtered out of the report.

   The preprocessing, the decoder arithmetic, the NMS parameters and the shadow
   test are the survey's own functions called from here, not copies. A report
   produced by a second implementation would describe a pipeline that does not
   run on a road. */
function missAnalyse(tf, model, canvas, label, srcW, srcH, shape) {
  var input = null, out = null, moved = null;
  return Promise.resolve().then(function () {
    /* Preprocessing timed on its own. It is not inference, and a miss blamed
       on a slow model when the cost was the resize would send somebody after
       the wrong thing. dataSync forces the work rather than timing the
       queueing of it on a lazy backend. */
    var tp = performance.now();
    input = benchPreprocess(tf, canvas);
    input.dataSync();
    var msPre = Math.round(performance.now() - tp);
    var inShape = input && input.shape ? [].concat(input.shape) : null;
    var t0 = performance.now();
    out = model.execute(input);
    var one = Array.isArray(out) ? out[0] : out;
    var rawShape = one && one.shape ? [].concat(one.shape) : null;
    moved = tf.transpose(one, [0, 2, 1]);
    var data = moved.dataSync();
    var ms = performance.now() - t0;
    var numBoxes = moved.shape[1], numClasses = moved.shape[2] - 4;
    var classNames = (rfMeta && rfMeta.classes) || ['manhole', 'pothole'];

    var lo = Infinity, hi = -Infinity;
    for (var i = 0; i < data.length; i++) {
      var v = data[i]; if (v < lo) lo = v; if (v > hi) hi = v;
    }
    var sane = isFinite(lo) && isFinite(hi) && Math.abs(hi) < 1e4 && Math.abs(lo) < 1e4;

    var cand = missCandidates(data, numBoxes, numClasses, classNames, RF_SIZE);
    /* How many anchors clear each bar, per class. This is the table that says
       whether moving the threshold would have caught the thing, and by how
       much — rather than anybody guessing. */
    var steps = MISS_STEPS.map(function (t) {
      return { at: t, counts: cand.per.map(function (l) {
        return l.filter(function (r) { return r.conf >= t; }).length;
      }) };
    });

    /* NMS exactly as the survey runs it, on the CPU backend as the library
       does, with the same score, IoU and box cap. */
    var sc = benchMaxScores(data, numBoxes, numClasses);
    var boxes = benchBoxes(data, numBoxes, numClasses, RF_SIZE);
    var was = tf.getBackend();

    /* One survivor, taken through the rest of the survey's stages. Pulled out
       because NMS has to be run twice: once at the score the survey uses, for
       the report of what really happens, and once at the bottom of the sweep,
       because a bar of 0.40 is meaningless if NMS threw everything under 0.50
       away before the bar was ever consulted. */
    var stages = function (ai) {
      var o = ai * (numClasses + 4);
      var p = { class: classNames[sc.classes[ai]], confidence: sc.scores[ai],
                bbox: { x: data[o], y: data[o + 1],
                        width: data[o + 2], height: data[o + 3] } };
      var u = usableFind(p, RF_SIZE, RF_SIZE);
      var shadow = u ? rejectReason(canvasCtx(canvas), RF_SIZE, RF_SIZE, u.box) : null;
      return { anchor: ai, cls: p.class, conf: p.confidence, box: u && u.box,
               share: u && u.share, measurable: !!u,
               overBar: !!(u && (u.conf == null || u.conf >= SURVEY_CONF)),
               shadow: shadow,
               /* The survey logs potholes and drops ironwork — "Ironwork —
                  sound cover, not logged". A report that said a manhole
                  WOULD BE LOGGED would be wrong about the one thing it
                  exists to be right about. */
               logs: typeFor(p.class) === 'Pothole' };
    };
    var nmsAt = function (score) {
      var keep = tf.tidy(function () {
        return tf.image.nonMaxSuppression(
          tf.tensor2d(boxes, [numBoxes, 4]), sc.scores,
          RF_MAXBOX, RF_IOU, score).dataSync();
      });
      var list = [];
      for (var k = 0; k < keep.length; k++) list.push(stages(keep[k]));
      return list;
    };

    return tf.setBackend('cpu').then(function () {
      var kept = nmsAt(RF_SCORE);

      /* The sweep. Not candidate counts — these are boxes that came through
         NMS and through the shadow test, which is what "a detection" means to
         the survey. Run from the bottom of the sweep so that lowering the bar
         is actually tested rather than assumed. */
      var wide = nmsAt(Math.min(MISS_SWEEP, RF_SCORE));
      var sweep = MISS_STEPS.filter(function (t) { return t >= MISS_SWEEP; })
        .map(function (t) {
          var live = wide.filter(function (k) {
            return k.measurable && !k.shadow && k.conf >= t;
          });
          return { at: t,
                   pot: live.filter(function (k) { return k.logs; }).length,
                   man: live.filter(function (k) { return !k.logs; }).length };
        });

      return tf.setBackend(was).then(function () {
        return {
          at: new Date().toISOString(), label: label,
          srcW: srcW, srcH: srcH, inW: RF_SIZE, inH: RF_SIZE,
          msPre: msPre, inShape: inShape, shape: shape || null,
          rawShape: rawShape, numBoxes: numBoxes, numClasses: numClasses,
          classNames: classNames, min: lo, max: hi, sane: sane, ms: Math.round(ms),
          backend: was, floor: MISS_FLOOR, steps: steps, sweep: sweep,
          sweepFrom: Math.min(MISS_SWEEP, RF_SCORE),
          best: cand.best, per: cand.per.map(function (l) { return l.slice(0, MISS_LIST); }),
          perTotal: cand.per.map(function (l) { return l.length; }),
          nmsIn: numBoxes, kept: kept,
          thresholds: { score: RF_SCORE, iou: RF_IOU, maxBoxes: RF_MAXBOX,
                        survey: SURVEY_CONF }
        };
      });
    });
  }).then(function (r) { infDispose(tf, [input, out, moved]); return r; },
          function (e) { infDispose(tf, [input, out, moved]); throw e; });
}

/* The shadow test reads pixels, so it needs the context the frame was drawn
   on rather than the canvas element. */
function canvasCtx(c) {
  try { return c.getContext('2d', { willReadFrequently: true }); }
  catch (e) { return c.getContext('2d'); }
}

/* ---------- preprocessing A/B ----------

   The survey stretches whatever the camera gives it into a 640 square. On a
   16:9 frame that is a 1.78x distortion; on the 2340x1080 a modern phone hands
   over it is 2.17x, and a round pothole arrives more than twice as tall as it
   is wide.

   The obvious fix is letterboxing, and for THIS aspect ratio the obvious fix is
   wrong: preserving the ratio means scaling both axes by the smaller factor, so
   the road loses more than half its vertical detail and 54% of the square is
   padding the model still has to process. The arithmetic says a road-focused
   square crop is the only variant that improves both axes at once.

   That is a prediction, and predictions about this model have been wrong before.
   So: run the same picture through all four and let the numbers decide.

   Diagnostic only. Nothing here touches squareFrame, which is what the survey
   uses and what production still does. */

var MISS_AB = [
  { key: 'A', name: 'STRETCH (what the survey does now)', how: 'stretch' },
  { key: 'B', name: 'LETTERBOX', how: 'letterbox' },
  { key: 'C', name: 'ROAD CROP, square (what the survey does now)', how: 'cropSquare' },
  { key: 'D', name: 'ROAD CROP + LETTERBOX', how: 'cropLetterbox' }
];
/* ROAD_TOP and ROAD_BOT are declared with squareFrame, which is where they
   matter: the A/B's crop variants must use the same band the survey does, or
   the comparison would be against a crop production never makes. */

/* One variant's 640 square, and the transform that undoes it.
   A box at (tx, ty) in the tensor came from
       srcX = cropX + (tx - padX) / sx
   which is what maps the model's answer back onto the photograph. */
function missVariant(source, w, h, how) {
  var c = document.createElement('canvas');
  c.width = c.height = RF_SIZE;
  var ctx = canvasCtx(c);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, RF_SIZE, RF_SIZE);

  var cx = 0, cy = 0, cw = w, ch = h;
  if (how === 'cropSquare' || how === 'cropLetterbox') {
    var top = Math.round(h * ROAD_TOP), bot = Math.round(h * ROAD_BOT);
    cy = top; ch = Math.max(1, bot - top);
    if (how === 'cropSquare') {
      /* A square crop cannot be wider than the band is tall, and it sits in the
         middle because that is where the road ahead is. */
      cw = Math.min(w, ch);
      cx = Math.round((w - cw) / 2);
    } else {
      cw = w; cx = 0;
    }
  }

  var sx, sy, padX = 0, padY = 0;
  if (how === 'stretch') {
    sx = RF_SIZE / cw; sy = RF_SIZE / ch;
  } else {
    var sc = Math.min(RF_SIZE / cw, RF_SIZE / ch);
    sx = sy = sc;
    padX = (RF_SIZE - cw * sc) / 2;
    padY = (RF_SIZE - ch * sc) / 2;
  }
  ctx.drawImage(source, cx, cy, cw, ch, padX, padY, cw * sx, ch * sy);

  return { canvas: c, ctx: ctx,
           /* ab marks a variant built for the A/B comparison. runMiss also
              carries a shape now — the survey's own letterbox geometry, so its
              boxes map back too — and without this flag a batch of photographs
              would render the A/B table instead of the table across them. */
           shape: { ab: true, how: how, srcW: w, srcH: h,
                    cropX: cx, cropY: cy, cropW: cw, cropH: ch,
                    sx: sx, sy: sy, padX: padX, padY: padY,
                    used: (cw * sx) * (ch * sy) / (RF_SIZE * RF_SIZE) } };
}

/* A tensor box back onto the original photograph. Without this the comparison
   cannot answer the question that matters — whether the model is looking at the
   defect or at some unrelated texture — because every variant reports its boxes
   in a different 640 square. */
function missToSource(box, sh) {
  if (!box || !sh) return null;
  return {
    x: sh.cropX + (box.x - sh.padX) / sh.sx,
    y: sh.cropY + (box.y - sh.padY) / sh.sy,
    w: box.w / sh.sx,
    h: box.h / sh.sy
  };
}

function runMissAB(source, w, h, label) {
  var st = $('tState');
  busy(true);
  missRuns = []; missResult = null; paintFrameTest();
  st.textContent = 'Bringing the model up…';
  return loadBenchTf().then(function (tf) {
    var have = infSession && infSession.model
      ? Promise.resolve(infSession)
      : infCapabilities(tf).then(function () { return infPick(tf); });
    return have.then(function (sess) {
      var i = 0;
      function step() {
        if (i >= MISS_AB.length) return Promise.resolve();
        var v = MISS_AB[i];
        st.textContent = 'Variant ' + v.key + ' of ' + MISS_AB.length + ': ' +
          v.name + '…';
        var built = missVariant(source, w, h, v.how);
        return missAnalyse(sess.tf, sess.model, built.canvas,
                           v.key + ' · ' + v.name + ' · ' + label, w, h,
                           built.shape)
          .then(function (r) {
            missRuns.push(r);
            paintFrameTest();
            i++;
            return step();
          });
      }
      return step();
    });
  }).then(function () {
    paintFrameTest(); paintDiag();
    var best = missRuns.reduce(function (a, b) {
      return (missCase(b).best || 0) > (missCase(a).best || 0) ? b : a;
    }, missRuns[0]);
    st.textContent = missRuns.length
      ? 'Done. Strongest pothole candidate under ' +
        String(best.label).split(' · ')[0] + ': ' + round4(missCase(best).best)
      : 'Nothing ran.';
    busy(false);
  }, function (e) {
    st.textContent = 'The A/B could not run: ' + String((e && e.message) || e);
    busy(false);
  });
}

function runMiss(source, w, h, label) {
  var s = $('tState');
  busy(true);
  s.textContent = 'Bringing the model up…';
  var sq = squareFrame(source, w, h);
  /* The survey's own geometry, handed to the report so its boxes can be put
     back on the photograph exactly the way the evidence box is. */
  var shape = { how: 'cropSquare', srcW: w, srcH: h,
                cropX: sq.fit.cropX, cropY: sq.fit.cropY,
                cropW: sq.fit.cropW, cropH: sq.fit.cropH,
                sx: sq.fit.s, sy: sq.fit.s,
                padX: sq.fit.padX, padY: sq.fit.padY,
                used: (sq.fit.dw * sq.fit.dh) / (RF_SIZE * RF_SIZE) };
  return loadBenchTf().then(function (tf) {
    /* The session the survey itself uses when there is one, so this reports on
       the same weights on the same backend rather than on a second setup that
       happens to be lying around. */
    var have = infSession && infSession.model
      ? Promise.resolve(infSession)
      : infCapabilities(tf).then(function () { return infPick(tf); });
    return have.then(function (sess) {
      s.textContent = 'Running one picture through ' + sess.backend.toUpperCase() + '…';
      return missAnalyse(sess.tf, sess.model, sq.canvas, label, w, h, shape);
    });
  }).then(function (r) {
    missResult = r;
    missRuns.push(r);
    paintFrameTest(); paintDiag();
    var pot = r.classNames.indexOf('pothole');
    var top = pot >= 0 && r.best[pot] ? r.best[pot].conf : null;
    s.textContent = top == null
      ? 'Done — no pothole channel in this output. Read the table below.'
      : 'Done. Best pothole candidate anywhere in the frame: ' +
        round4(top) + (top >= SURVEY_CONF ? ' — over the survey bar.'
                                          : ' — under the ' + SURVEY_CONF + ' survey bar.');
    busy(false);
  }, function (e) {
    missResult = null;
    s.textContent = 'Miss analysis could not run: ' + String((e && e.message) || e);
    busy(false);
    return null;                        // a bad frame ends that image, not the batch
  });
}

/* Which of the possible authors a miss had, as a letter and a reason. Shared
   between the table across images and the verdict under each one, so the two
   can never disagree about the same frame. */
function missCase(r) {
  var pot = r.classNames.indexOf('pothole');
  var bp = (pot >= 0 && r.best[pot]) ? r.best[pot] : null;
  var best = bp ? bp.conf : 0;
  var kept = r.kept.filter(function (k) { return k.logs; });
  if (!best || best < MISS_FLOOR) return { code: 'A', best: 0 };
  if (best < r.thresholds.survey) return { code: 'B', best: best };
  if (!kept.length) return { code: 'C', best: best };
  if (kept.some(function (k) { return k.shadow; })) {
    return { code: 'D', best: best,
             why: (kept.filter(function (k) { return k.shadow; })[0] || {}).shadow };
  }
  if (kept.some(function (k) { return !k.measurable; })) return { code: 'G', best: best };
  return { code: '-', best: best };
}

/* The largest pothole candidate on a frame, which is the one worth quoting:
   the box that would have been logged if anything was going to be. */
function missBiggest(r) {
  var i = r.classNames.indexOf('pothole');
  var list = (i >= 0 && r.per[i]) ? r.per[i] : [];
  return list.reduce(function (a, b) {
    if (!a) return b;
    return (b.box.w * b.box.h) > (a.box.w * a.box.h) ? b : a;
  }, null);
}

function missOne(r) {
  if (!r) return '';
  var L = [];
  var pad = function (t, n) { t = String(t); while (t.length < n) t += ' '; return t; };
  var f = function (k, v) { L.push('  ' + pad(k + ':', 29) + v); };
  var pot = r.classNames.indexOf('pothole');
  var man = r.classNames.indexOf('manhole');
  var bestOf = function (i) { return (i >= 0 && r.best[i]) ? r.best[i] : null; };

  L.push('MISS ANALYSIS  (diagnostic only — nothing here changes the survey)');
  L.push('  ' + r.label + ', ' + r.at);
  L.push('');

  L.push('IMAGE');
  f('width', r.srcW);
  f('height', r.srcH);
  f('aspect', (r.srcW / r.srcH).toFixed(3) +
    (r.srcW < r.srcH ? '  — PORTRAIT. The survey never sees a portrait frame; a ' +
                       'photograph turned on its side is a different question.' : ''));
  L.push('');

  L.push('PREPROCESSING');
  f('source dimensions', r.srcW + ' × ' + r.srcH);
  f('model dimensions', r.inW + ' × ' + r.inH);
  f('tensor handed over', (r.inShape || []).join(' × ') + '  (NCHW)');
  f('preprocessing time', r.msPre + ' ms');
  f('method', 'STRETCH, not crop or letterbox');
  f('scale x', '×' + (r.inW / r.srcW).toFixed(4));
  f('scale y', '×' + (r.inH / r.srcH).toFixed(4));
  var skew = (r.inH / r.srcH) / (r.inW / r.srcW);
  f('shape distortion', Math.abs(skew - 1) < 0.005
    ? 'none — the axes scale equally'
    : 'a round pothole arrives ' + skew.toFixed(2) + '× ' +
      (skew > 1 ? 'taller than wide' : 'wider than tall'));
  L.push('');

  L.push('RAW MODEL');
  f('output shape', (r.rawShape || []).join(' × '));
  f('after transpose', '1 × ' + r.numBoxes + ' × ' + (r.numClasses + 4) +
    '  (' + r.numBoxes + ' anchors, ' + r.numClasses + ' classes)');
  f('raw min', round4(r.min));
  f('raw max', round4(r.max));
  f('plausible', r.sane ? 'yes' : 'NO — this backend is producing nonsense');
  f('backend', String(r.backend).toUpperCase());
  f('inference time', r.ms + ' ms');
  L.push('');

  L.push('CANDIDATES BEFORE APPLICATION THRESHOLDS');
  f('diagnostic floor', r.floor + '  (below this an anchor is background noise)');
  f('number of candidate boxes', r.perTotal.reduce(function (a, b) { return a + b; }, 0) +
    '  (' + r.classNames.map(function (n, i) {
      return r.perTotal[i] + ' ' + n; }).join(', ') + ')');
  var bp = bestOf(pot), bm = bestOf(man);
  f('highest pothole confidence', bp ? round4(bp.conf) : 'no pothole channel');
  f('highest manhole confidence', bm ? round4(bm.conf) : 'no manhole channel');
  L.push('');

  /* Every candidate, laid out one field per line as asked. The box is in the
     640 square the model was given, which is not the photograph's own
     coordinates — see PREPROCESSING above for the two scale factors. */
  r.classNames.forEach(function (n, i) {
    L.push('EVERY ' + n.toUpperCase() + ' CANDIDATE ABOVE ' + r.floor +
      '  (' + r.perTotal[i] + ' total' +
      (r.perTotal[i] > MISS_LIST ? ', highest ' + MISS_LIST + ' shown' : '') + ')');
    if (!r.per[i].length) {
      L.push('  none — the model produced no ' + n + ' candidate at all on this frame');
    } else {
      r.per[i].forEach(function (c, k) {
        L.push('  [' + (k + 1) + ']');
        f('  class', c.cls);
        f('  confidence', round4(c.conf));
        f('  x', round4(c.box.x));
        f('  y', round4(c.box.y));
        f('  width', round4(c.box.w));
        f('  height', round4(c.box.h));
        f('  share of frame', ((c.box.w * c.box.h) / (RF_SIZE * RF_SIZE) * 100).toFixed(3) + '%');
        f('  anchor', c.anchor);
      });
    }
    L.push('');
  });

  L.push('HOW MANY CANDIDATES CLEAR EACH BAR');
  L.push('  ' + pad('bar', 8) + r.classNames.map(function (n) { return pad(n, 12); }).join(''));
  r.steps.forEach(function (st) {
    L.push('  ' + pad(st.at.toFixed(2) + (st.at === r.thresholds.survey ? ' *' : ''), 8) +
      st.counts.map(function (c) { return pad(c, 12); }).join(''));
  });
  L.push('  * the survey bar. Nothing below it is written down unattended.');
  L.push('');

  L.push('NMS RESULTS');
  f('score threshold', r.thresholds.score);
  f('IoU threshold', r.thresholds.iou);
  f('maximum boxes', r.thresholds.maxBoxes);
  f('anchors in', r.nmsIn);
  f('boxes out', r.kept.length);
  if (!r.kept.length) {
    L.push('  nothing survived NMS, so nothing could reach the survey');
  } else {
    r.kept.forEach(function (k, i) {
      L.push('  [' + (i + 1) + ']');
      f('  class', k.cls);
      f('  confidence', round4(k.conf));
      if (k.box) {
        f('  x', round4(k.box.x));
        f('  y', round4(k.box.y));
        f('  width', round4(k.box.w));
        f('  height', round4(k.box.h));
      }
      f('  outcome', !k.measurable ? 'REJECTED — box not measurable'
        : k.shadow ? 'REJECTED by the shadow test: ' + k.shadow
        : !k.overBar ? 'UNDER THE SURVEY BAR — not logged'
        : !k.logs ? 'IRONWORK — the survey does not log this class'
        : 'WOULD BE LOGGED');
    });
  }
  L.push('');

  /* What the survey would actually detect at each bar — boxes through NMS and
     through the shadow test, not raw anchors. The two are different by a lot,
     and the difference is the whole argument about where the bar should be. */
  L.push('THRESHOLD SWEEP  (diagnostic — the bar in production is still ' +
    r.thresholds.survey + ')');
  if (!r.sweep) {
    L.push('  not available on this run');
  } else {
    L.push('  ' + pad('bar', 8) + pad('potholes', 12) + pad('ironwork', 12) +
      'change from ' + r.thresholds.survey);
    var atBar = 0;
    r.sweep.forEach(function (st) {
      if (st.at === r.thresholds.survey) atBar = st.pot;
    });
    r.sweep.forEach(function (st) {
      var d = st.pot - atBar;
      L.push('  ' + pad(st.at.toFixed(2) + (st.at === r.thresholds.survey ? ' *' : ''), 8) +
        pad(st.pot, 12) + pad(st.man, 12) +
        (d === 0 ? 'same' : (d > 0 ? '+' + d : String(d)) + ' pothole box' +
          (Math.abs(d) === 1 ? '' : 'es')));
    });
    L.push('  NMS was run from ' + r.sweepFrom + ' for this table. In production it');
    L.push('  runs at ' + r.thresholds.score + ', so anything below that is discarded');
    L.push('  before the ' + r.thresholds.survey + ' bar is ever consulted — which is');
    L.push('  why a bar of 0.40 alone would not change what gets logged.');
    L.push('  Extra boxes at a lower bar are NOT known to be false positives.');
    L.push('  Nothing here can tell a real pothole from a wet patch; that needs');
    L.push('  a person looking at the photograph.');
  }
  L.push('');

  L.push('SURVEY THRESHOLD');
  f('current threshold', r.thresholds.survey);
  f('unchanged by this tool', 'yes — nothing here writes a threshold');
  L.push('');

  var logged = r.kept.filter(function (k) {
    return k.measurable && !k.shadow && k.overBar && k.logs;
  });
  L.push('FINAL SURVEY RESULTS');
  f('detections', logged.length);
  if (!logged.length) {
    L.push('  this frame would produce no entry');
  } else {
    logged.forEach(function (k, i) {
      L.push('  [' + (i + 1) + ']');
      f('  class', k.cls);
      f('  confidence', round4(k.conf));
      f('  box', 'x ' + round4(k.box.x) + ', y ' + round4(k.box.y) +
        ', w ' + round4(k.box.w) + ', h ' + round4(k.box.h));
    });
  }
  L.push('');

  /* Which of the possible authors this was. The whole point of the report is
     that these need different remedies and only one of them is retraining. */
  L.push('WHICH KIND OF MISS IS THIS?');
  var verdict = missCase(r);
  var bestPot = verdict.best;
  if (verdict.code === 'A') {
    L.push('  A. THE MODEL NEVER PRODUCED A POTHOLE CANDIDATE.');
    L.push('     Moving the threshold cannot reach this, and neither can NMS or');
    L.push('     any filter — there was nothing for them to drop. Three things');
    L.push('     can put a frame here, and they are not the same fault:');
    L.push('       E. PREPROCESSING. The stretch above is anisotropic, so a');
    L.push('          round defect is not round by the time the model sees it.');
    L.push('       F. SIZE. The finest stride in this head is ' + MISS_STRIDE +
      ' px, so an');
    L.push('          object under ' + MISS_STRIDE + ' px in the tensor — under ' +
      Math.round(MISS_STRIDE / (r.inH / r.srcH)) + ' px tall in this');
    L.push('          photograph, after the y scale above — has at most one');
    L.push('          anchor to be found by. Distant potholes lose height first.');
    L.push('       Otherwise it is the model itself, on this kind of road, in');
    L.push('       this light. Only that last one is answered by retraining.');
  } else if (verdict.code === 'B') {
    L.push('  B. THE MODEL SAW IT AT ' + round4(bestPot) + ' AND THE BAR IS ' +
      r.thresholds.survey + '.');
    L.push('     A threshold decision, not a model failure. The table above says');
    L.push('     what else gets in at each lower bar — that is the cost side.');
  } else if (verdict.code === 'C') {
    L.push('  C. THE MODEL WAS CONFIDENT (' + round4(bestPot) + ') AND NMS DROPPED IT.');
    L.push('     The decoder, not the model and not the threshold.');
  } else if (verdict.code === 'D') {
    L.push('  D. THE SHADOW/GEOMETRY FILTER REJECTED IT: ' + verdict.why);
    L.push('     The filter, not the model.');
  } else if (verdict.code === 'G') {
    L.push('  G. THE BOX CAME BACK UNMEASURABLE — a decode problem, not a miss.');
  } else {
    L.push('  NOT A MISS. This frame would have been logged: pothole at ' +
      round4(bestPot) + '.');
  }
  return L.join('\n');
}

/* The table across a batch. One image says which stage dropped one pothole;
   this says whether the bar is wrong, whether the model is wrong, or whether
   the pictures are. It is the shape of the decision, not a summary of it —
   there is no ground truth in the app, so "was there really a pothole?" is a
   column a person fills in, and the report says UNKNOWN rather than guessing. */
function missTable() {
  if (missRuns.length < 2) return '';
  var L = [];
  var pad = function (t, n) { t = String(t); while (t.length < n) t += ' '; return t; };
  var bars = MISS_STEPS.filter(function (t) { return t >= MISS_SWEEP; });

  L.push('ACROSS ALL ' + missRuns.length + ' PHOTOGRAPHS');
  L.push('');
  var head = pad('image', 26) + pad('real?', 9) + pad('best pot', 10) +
    pad('box 640', 12) + pad('box source', 13) +
    bars.map(function (b) { return pad(b.toFixed(2), 6); }).join('') + 'type';
  L.push('  ' + head);
  L.push('  ' + new Array(head.length + 1).join('-'));

  var confs = [], counts = { A: 0, B: 0, C: 0, D: 0, G: 0, '-': 0 };
  var over = 0, between = 0, none = 0;
  missRuns.forEach(function (r) {
    var v = missCase(r);
    var big = missBiggest(r);
    counts[v.code] = (counts[v.code] || 0) + 1;
    confs.push(v.best);
    if (v.best >= r.thresholds.survey) over++;
    else if (v.best >= MISS_SWEEP) between++;
    else none++;
    var sx = r.srcW / r.inW, sy = r.srcH / r.inH;
    var name = String(r.label).replace(/^photo · /, '');
    L.push('  ' + pad(name.length > 24 ? name.slice(0, 23) + '…' : name, 26) +
      pad('UNKNOWN', 9) +
      pad(v.best ? round4(v.best) : 'none', 10) +
      pad(big ? Math.round(big.box.w) + '×' + Math.round(big.box.h) : '—', 12) +
      pad(big ? Math.round(big.box.w * sx) + '×' + Math.round(big.box.h * sy) : '—', 13) +
      bars.map(function (b) {
        var st = (r.sweep || []).filter(function (x) { return x.at === b; })[0];
        return pad(st ? st.pot : '?', 6);
      }).join('') + v.code);
  });
  L.push('');
  L.push('  real?      UNKNOWN in every row on purpose. The app has no ground');
  L.push('             truth; whether each photograph really shows a pothole is');
  L.push('             a judgement to write in by hand before reading the rest.');
  L.push('  0.40-0.65  pothole boxes surviving NMS and the shadow test at that');
  L.push('             bar. Not candidates — detections.');
  L.push('  type       A no candidate · B under the bar · C NMS dropped it');
  L.push('             D filter rejected it · G unmeasurable · - would be logged');
  L.push('');

  var sum = confs.reduce(function (a, b) { return a + b; }, 0);
  var g = function (k, v) { L.push('  ' + pad(k + ':', 29) + v); };
  g('photographs tested', missRuns.length);
  g('best pothole confidence', round4(Math.max.apply(null, confs)));
  g('worst', round4(Math.min.apply(null, confs)));
  g('average', round4(sum / confs.length));
  g('at or above ' + SURVEY_CONF, over);
  g('between ' + MISS_SWEEP + ' and ' + SURVEY_CONF, between);
  g('no useful candidate', none);
  /* A tie is not a most-common outcome, and calling one of them the winner
     because it sorted first would be the report inventing a finding. */
  var live = Object.keys(counts).filter(function (k) { return counts[k]; })
    .sort(function (a, b) { return counts[b] - counts[a]; });
  var top = live.filter(function (k) { return counts[k] === counts[live[0]]; });
  g('most common outcome', !live.length ? 'none'
    : top.length > 1
      ? 'no single one — ' + top.join(', ') + ' tie at ' + counts[live[0]]
      : live[0] + ' (' + counts[live[0]] + ' of ' + missRuns.length + ')');
  L.push('');

  /* The reading, spelled out, because the whole point of the batch is to stop
     the decision being made on a feeling about one photograph. */
  L.push('  WHAT THIS SHAPE MEANS');
  if (over > missRuns.length / 2) {
    L.push('    Mostly over the bar. The model is working on these frames; a');
    L.push('    miss in the van is then about which frames get looked at —');
    L.push('    cadence and speed — not about detection.');
  } else if (between >= missRuns.length / 2) {
    L.push('    Mostly between ' + MISS_SWEEP + ' and ' + SURVEY_CONF + '. The model is');
    L.push('    finding these and the application is declining them. That is a');
    L.push('    calibration question, and the cost side is false positives —');
    L.push('    which needs somebody to look at the extra boxes, not more');
    L.push('    training.');
  } else if (none > missRuns.length / 2) {
    L.push('    Mostly no candidate at all. Now the box sizes above matter: if');
    L.push('    the misses are small and distant, look at camera geometry and');
    L.push('    input strategy first. If they are large and obvious, that is');
    L.push('    the case for retraining or replacing the model.');
  } else {
    L.push('    No majority. Read the type column: the remedies differ per row');
    L.push('    and a single verdict over this set would be a guess.');
  }
  return L.join('\n');
}

/* The A/B, as one table. Four full reports underneath it answer "what did each
   stage do"; this answers the only question being asked — which preprocessing
   gets the most out of this picture, and is the box it found on the defect. */
function missAB() {
  var runs = missRuns.filter(function (r) { return r.shape && r.shape.ab; });
  if (runs.length < 2) return '';
  var L = [];
  var pad = function (t, n) { t = String(t); while (t.length < n) t += ' '; return t; };
  var bars = [0.05, 0.10, 0.25, 0.40, 0.50, 0.65];

  L.push('PREPROCESSING A/B  (diagnostic — production crops the road since build 56)');
  L.push('  ' + runs[0].srcW + ' × ' + runs[0].srcH + ' source, aspect ' +
    (runs[0].srcW / runs[0].srcH).toFixed(3));
  L.push('');
  var head = pad('variant', 24) + pad('crop', 12) + pad('scale x', 10) +
    pad('scale y', 10) + pad('distort', 9) + pad('used', 7) + pad('best pot', 10) +
    'best man';
  L.push('  ' + head);
  L.push('  ' + new Array(head.length + 1).join('-'));
  runs.forEach(function (r) {
    var sh = r.shape, v = missCase(r);
    var man = r.classNames.indexOf('manhole');
    var bm = man >= 0 && r.best[man] ? r.best[man].conf : 0;
    L.push('  ' + pad(String(r.label).split(' · ').slice(0, 2).join(' ').slice(0, 22), 24) +
      pad(sh.cropW + '×' + sh.cropH, 12) +
      pad('×' + sh.sx.toFixed(4), 10) + pad('×' + sh.sy.toFixed(4), 10) +
      pad((sh.sy / sh.sx).toFixed(3), 9) +
      pad(Math.round(sh.used * 100) + '%', 7) +
      pad(v.best ? round4(v.best) : 'none', 10) +
      (bm ? round4(bm) : 'none'));
  });
  L.push('');

  L.push('  HOW MANY POTHOLE CANDIDATES CLEAR EACH BAR');
  L.push('  ' + pad('variant', 24) + bars.map(function (b) {
    return pad(b.toFixed(2), 7); }).join('') + 'NMS out');
  runs.forEach(function (r) {
    var pot = r.classNames.indexOf('pothole');
    var list = pot >= 0 ? r.per[pot] : [];
    var total = pot >= 0 ? r.perTotal[pot] : 0;
    L.push('  ' + pad(String(r.label).split(' · ')[0] + ' ' +
        String(r.label).split(' · ')[1].slice(0, 18), 24) +
      bars.map(function (b) {
        /* per[] is capped at MISS_LIST for display; the steps table is the
           honest count over every anchor. */
        var st = r.steps.filter(function (x) { return Math.abs(x.at - b) < 1e-9; })[0];
        return pad(st ? st.counts[pot] : (b <= r.floor ? total : '?'), 7);
      }).join('') + r.kept.length);
  });
  L.push('');

  /* The whole point: every variant reports its boxes in a different 640 square,
     so they cannot be compared until they are put back on the photograph. */
  L.push('  STRONGEST POTHOLE CANDIDATES, MAPPED BACK TO THE ORIGINAL IMAGE');
  runs.forEach(function (r) {
    var pot = r.classNames.indexOf('pothole');
    var list = (pot >= 0 ? r.per[pot] : []).slice(0, 3);
    L.push('  ' + String(r.label).split(' · ').slice(0, 2).join(' '));
    if (!list.length) { L.push('      no pothole candidate above ' + r.floor); return; }
    list.forEach(function (c, i) {
      var o = missToSource(c.box, r.shape);
      L.push('      [' + (i + 1) + '] ' + round4(c.conf) +
        '   640: x ' + Math.round(c.box.x) + ' y ' + Math.round(c.box.y) +
        ' w ' + Math.round(c.box.w) + ' h ' + Math.round(c.box.h));
      L.push('          original: x ' + Math.round(o.x) + ' y ' + Math.round(o.y) +
        ' w ' + Math.round(o.w) + ' h ' + Math.round(o.h) +
        '   (' + Math.round(o.x / r.srcW * 100) + '% across, ' +
        Math.round(o.y / r.srcH * 100) + '% down)');
    });
  });
  L.push('');
  L.push('  Compare the ORIGINAL coordinates between variants. Boxes that land in');
  L.push('  the same place are the model finding the same thing; boxes scattered');
  L.push('  across the frame are texture, not a defect.');
  return L.join('\n');
}

function missLines() {
  if (!missRuns.length) return missOne(missResult);
  var ab = missAB();
  if (ab) return [ab].concat(missRuns.map(missOne))
    .filter(Boolean).join('\n\n' + new Array(72).join('=') + '\n\n');
  return [missTable()].concat(missRuns.map(missOne))
    .filter(Boolean).join('\n\n' + new Array(72).join('=') + '\n\n');
}

/* ---------- footage ----------

   A development tool, and it earns its place because of what the last few days
   established: the app cannot tell you why a pothole was missed if the frame it
   was missed on is gone. The miss report is only as good as the pictures fed to
   it, and a photograph taken afterwards, from a stopped vehicle, at a different
   angle, in different light, is not the frame that was missed.

   So: record the drive, scrub back to the hole nobody logged, and put THAT
   frame through the miss report.

   The rule that makes it worth anything is that the footage comes from the same
   MediaStream the survey looks at — not from the screen, and not from a second
   camera request. A recording of the screen would carry the CSS rotation that
   the model never sees, which on current evidence is the one thing most worth
   being able to see plainly.

   Nothing here runs unless somebody turns it on. */

var FOOT_SLICE = 3000;             // ms per chunk handed over and written away
var FOOT_MAX_MS = 10 * 60 * 1000;  // a cap, because a phone's storage is not a disk
var FOOT_MAX_BYTES = 512 * 1024 * 1024;
var FOOT_KEEP_FREE = 200 * 1024 * 1024;  // never fill the device to the brim
/* Probed, never assumed. isTypeSupported is the only honest answer, and it
   differs between two phones of the same make. Ordered best-compression first;
   whatever this browser can record it can also play back, which is the only
   playback that has to work. */
var FOOT_TYPES = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm',
                  'video/mp4;codecs=h264', 'video/mp4'];

var foot = { rec: null, id: null, on: false, seq: 0, bytes: 0,
             startedAt: null, timer: null, meta: null, err: null };
var footPlay = { id: null, url: null, meta: null };

/* What this browser will actually record. Returns the whole picture rather than
   just the winner, because "no supported type" and "MediaRecorder is missing"
   are different faults and the screen should be able to say which. */
function footSupport() {
  if (typeof MediaRecorder === 'undefined') {
    return { ok: false, why: 'this browser has no MediaRecorder', types: [], picked: null };
  }
  var able = [];
  if (MediaRecorder.isTypeSupported) {
    for (var i = 0; i < FOOT_TYPES.length; i++) {
      try { if (MediaRecorder.isTypeSupported(FOOT_TYPES[i])) able.push(FOOT_TYPES[i]); }
      catch (e) { /* a browser that throws on the question has not said yes */ }
    }
  }
  return able.length
    ? { ok: true, why: null, types: able, picked: able[0] }
    : { ok: false, why: 'MediaRecorder is here but supports none of the types this asks for',
        types: [], picked: null };
}

/* The video track the survey is looking at, and what it says about itself. Read
   rather than assumed: the resolution asked for in openCamera is an "ideal",
   and a phone is free to hand back something else entirely. */
function footTrack() {
  if (!stream) return null;
  var t = stream.getVideoTracks()[0];
  if (!t) return null;
  var st = {};
  try { st = t.getSettings ? t.getSettings() : {}; } catch (e) {}
  return { track: t, label: t.label || null, settings: st };
}

function footRoom() {
  if (!navigator.storage || !navigator.storage.estimate) return Promise.resolve(null);
  return navigator.storage.estimate().then(function (e) {
    if (!e || !e.quota) return null;
    return Math.max(0, e.quota - (e.usage || 0) - FOOT_KEEP_FREE);
  }).catch(function () { return null; });
}

function footStart() {
  if (foot.on) return Promise.resolve(null);
  var sup = footSupport();
  if (!sup.ok) { foot.err = sup.why; footPaint(); return Promise.resolve(null); }
  var tr = footTrack();
  if (!tr) { foot.err = 'the camera is not running'; footPaint(); return Promise.resolve(null); }

  return footRoom().then(function (room) {
    var cap = room == null ? FOOT_MAX_BYTES : Math.min(FOOT_MAX_BYTES, room);
    if (cap < 20 * 1024 * 1024) {
      foot.err = 'not enough free storage to record safely';
      footPaint();
      return null;
    }
    var v = $('vid');
    /* Everything about which way up this is, taken at the moment recording
       starts. It is the reason the feature exists, so it is recorded before a
       single frame is, not reconstructed afterwards. */
    var facts = orientationFacts(v.videoWidth, v.videoHeight, 'camera');
    var id = 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    var meta = {
      id: id, startedAt: new Date().toISOString(), startedMs: Date.now(),
      endedAt: null, ms: 0, bytes: 0, chunks: 0,
      mime: sup.picked, supported: sup.types,
      videoW: v.videoWidth || null, videoH: v.videoHeight || null,
      trackLabel: tr.label,
      trackW: tr.settings.width || null, trackH: tr.settings.height || null,
      frameRate: tr.settings.frameRate || null,
      facing: tr.settings.facingMode || null,
      zoom: tr.settings.zoom == null ? null : tr.settings.zoom,
      zoomSupported: !!zoom.supported,
      /* H: the orientation question, in full, per recording. */
      appRot: facts.appRot, videoRot: facts.videoRot,
      screenAngle: facts.screenAngle, screenType: facts.screenType,
      portraitViewport: facts.portraitViewport,
      /* G: the sidecar. Which drive this belongs to, and where the vehicle was
         when it started. Samples are added as the recording runs. */
      runId: (survey && survey.runId) || null,
      surveyOn: !!(survey && survey.on),
      build: BUILD, ua: (navigator.userAgent || '').slice(0, 200),
      modelKey: modelStamp().modelKey || null,
      gps: [], cap: cap, capped: null
    };

    var mr;
    try { mr = new MediaRecorder(stream, { mimeType: sup.picked }); }
    catch (e) {
      foot.err = 'MediaRecorder refused this stream: ' + String((e && e.message) || e);
      footPaint();
      return null;
    }

    foot.rec = mr; foot.id = id; foot.on = true; foot.seq = 0; foot.bytes = 0;
    foot.startedAt = Date.now(); foot.meta = meta; foot.err = null;

    /* Each slice is written away as it arrives. Nothing accumulates: the array
       MediaRecorder would otherwise fill is never built. */
    mr.ondataavailable = function (ev) {
      if (!ev.data || !ev.data.size) return;
      var seq = foot.seq++;
      foot.bytes += ev.data.size;
      meta.bytes = foot.bytes; meta.chunks = foot.seq;
      putFootChunk({ key: id + ':' + String(seq).padStart(6, '0'),
                     rec: id, seq: seq, bytes: ev.data.size, blob: ev.data })
        .catch(function (e) {
          /* A write that fails is the end of this recording, said out loud.
             Carrying on would produce a video with a hole in it and no sign. */
          foot.err = 'could not write a chunk: ' + String((e && e.message) || e);
          footStop('write failed');
        });
      if (foot.bytes >= cap) { meta.capped = 'storage'; footStop('storage cap'); }
    };
    mr.onerror = function (ev) {
      foot.err = 'MediaRecorder error: ' +
        String((ev && ev.error && ev.error.name) || 'unknown');
      footStop('recorder error');
    };

    /* Painted before the metadata write, not after it. The indicator and the
       buttons describe whether this is recording, and that became true a line
       ago — making the screen wait for a database round trip to say so leaves
       Start live while recording is already running. */
    footPaint();

    try { mr.start(FOOT_SLICE); }
    catch (e) {
      foot.on = false; foot.rec = null;
      foot.err = 'MediaRecorder would not start: ' + String((e && e.message) || e);
      footPaint();
      return null;
    }

    foot.timer = setInterval(function () {
      if (!foot.on) return;
      var ms = Date.now() - foot.startedAt;
      if (foot.meta) foot.meta.ms = ms;
      /* One GPS sample a second at most, so a frame can later be put on a map
         without the recording carrying the burden of doing it live. */
      if (S.gps && foot.meta) {
        var g = foot.meta.gps;
        if (!g.length || Date.now() - g[g.length - 1].t > 950) {
          g.push({ t: Date.now(), ms: ms, lat: S.gps.lat, lon: S.gps.lon,
                   acc: S.gps.acc == null ? null : Math.round(S.gps.acc),
                   speed: S.gps.speed, heading: S.gps.heading });
        }
      }
      if (ms >= FOOT_MAX_MS) { if (foot.meta) foot.meta.capped = 'time'; footStop('time cap'); return; }
      footPaint();
    }, 1000);

    return putFootMeta(meta).then(function () { footPaint(); return id; });
  });
}

function footStop(why) {
  if (!foot.on) return Promise.resolve(null);
  foot.on = false;
  if (foot.timer) { clearInterval(foot.timer); foot.timer = null; }
  var mr = foot.rec, meta = foot.meta;
  foot.rec = null;
  if (mr && mr.state !== 'inactive') {
    try { mr.stop(); } catch (e) { /* already gone */ }
  }
  if (!meta) { footPaint(); return Promise.resolve(null); }
  meta.endedAt = new Date().toISOString();
  meta.ms = Date.now() - foot.startedAt;
  meta.bytes = foot.bytes; meta.chunks = foot.seq;
  meta.stopWhy = why || 'asked';
  /* The last slice arrives after stop() resolves, so the record is written once
     more a moment later rather than being trusted as final here. */
  return putFootMeta(meta).then(function () {
    footPaint();
    setTimeout(function () {
      meta.bytes = foot.bytes; meta.chunks = foot.seq;
      putFootMeta(meta).then(footPaint, function () {});
    }, FOOT_SLICE + 500);
    return meta.id;
  });
}

function putFootMeta(m) { return tx('readwrite', function (st) { return st.put(m); }, FOOT); }
function putFootChunk(c) { return tx('readwrite', function (st) { return st.put(c); }, FOOTC); }
function allFootage() {
  return tx('readonly', function (st) { return st.getAll(); }, FOOT).then(function (r) {
    return (r || []).sort(function (a, b) { return b.startedMs - a.startedMs; });
  });
}
/* The pieces back in the order they were written. A range over the key rather
   than a filter over everything, so opening one recording does not read every
   recording on the device. */
function footChunks(id) {
  return tx('readonly', function (st) {
    return st.getAll(IDBKeyRange.bound(id + ':', id + ':￿'));
  }, FOOTC).then(function (r) {
    return (r || []).sort(function (a, b) { return a.seq - b.seq; });
  });
}
function footAssemble(id, mime) {
  return footChunks(id).then(function (rows) {
    if (!rows.length) throw new Error('no chunks were written for this recording');
    return new Blob(rows.map(function (r) { return r.blob; }),
                    { type: mime || 'video/webm' });
  });
}
function footDelete(id) {
  return footChunks(id).then(function (rows) {
    return rows.reduce(function (p, r) {
      return p.then(function () {
        return tx('readwrite', function (st) { return st.delete(r.key); }, FOOTC);
      });
    }, Promise.resolve());
  }).then(function () {
    return tx('readwrite', function (st) { return st.delete(id); }, FOOT);
  });
}

/* ---------- footage: on the screen ---------- */

function footSize(b) {
  if (b == null) return '?';
  return b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB'
       : b >= 1024 ? Math.round(b / 1024) + ' kB' : b + ' B';
}
function footClock(ms) {
  var s = Math.max(0, Math.round((ms || 0) / 1000));
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}

function footPaint() {
  var sup = footSupport();
  var bs = $('bFootStart'), bx = $('bFootStop'), st = $('footState');
  if (!bs) return;
  bs.disabled = foot.on || !sup.ok || !stream;
  bx.disabled = !foot.on;
  $('footDot').classList.toggle('on', foot.on);

  var L = [];
  if (foot.err) L.push('⚠ ' + foot.err);
  if (!sup.ok) {
    L.push(sup.why + ' — recording is not available on this browser.');
  } else if (foot.on) {
    L.push('Recording ' + footClock(Date.now() - foot.startedAt) +
      ' · ' + footSize(foot.bytes) + ' · ' + foot.meta.mime);
    L.push('Stops itself at ' + footClock(FOOT_MAX_MS) + ' or when storage runs low.');
  } else {
    L.push('Ready. This browser will record ' + sup.picked + '.');
    L.push('The camera stream itself is recorded, not the screen — so what you ' +
           'see here is what the model is given, CSS rotation and all.');
  }
  st.textContent = L.join('\n');
  footList();
}

function footList() {
  var box = $('footList');
  if (!box) return;
  allFootage().then(function (rows) {
    if (!rows.length) { box.innerHTML = '<div class="hint">Nothing recorded yet.</div>'; return; }
    box.innerHTML = '';
    rows.forEach(function (m) {
      var d = document.createElement('div');
      d.className = 'footrow';
      var res = (m.videoW && m.videoH) ? m.videoW + '×' + m.videoH : 'resolution not reported';
      var turn = (m.appRot || m.videoRot)
        ? '  ·  app ' + (m.appRot || 0) + '°, video ' + (m.videoRot || 0) + '°'
        : '';
      d.innerHTML = '<b>' + esc(new Date(m.startedMs).toLocaleString()) + '</b><br>' +
        '<span class="hint">' + esc(footClock(m.ms)) + '  ·  ' + esc(footSize(m.bytes)) +
        '  ·  ' + esc(res) + '  ·  ' + esc(m.mime || '?') + esc(turn) +
        (m.capped ? '  ·  stopped by the ' + esc(m.capped) + ' cap' : '') + '</span>';
      var row = document.createElement('div');
      row.className = 'row';
      var open = document.createElement('button');
      open.className = 'btn ghost'; open.textContent = 'Open';
      open.addEventListener('click', function () { footOpen(m.id); });
      var del = document.createElement('button');
      del.className = 'btn ghost'; del.textContent = 'Delete';
      del.addEventListener('click', function () {
        if (!confirm('Delete this recording? Survey observations are not touched.')) return;
        footDelete(m.id).then(function () {
          if (footPlay.id === m.id) footClose();
          footPaint();
        });
      });
      row.appendChild(open); row.appendChild(del);
      d.appendChild(row);
      box.appendChild(d);
    });
  }, function (e) {
    box.innerHTML = '<div class="hint">Could not read the recordings: ' +
      esc(String((e && e.message) || e)) + '</div>';
  });
}

function footClose() {
  if (footPlay.url) { URL.revokeObjectURL(footPlay.url); footPlay.url = null; }
  footPlay.id = null; footPlay.meta = null;
  var w = $('footPlayWrap');
  if (w) w.hidden = true;
  var v = $('footVid');
  if (v) v.removeAttribute('src');
}

function footOpen(id) {
  $('footState').textContent = 'Assembling the recording…';
  return allFootage().then(function (rows) {
    var m = rows.filter(function (r) { return r.id === id; })[0];
    if (!m) throw new Error('that recording is not in the store');
    return footAssemble(id, m.mime).then(function (blob) {
      footClose();
      footPlay.id = id; footPlay.meta = m;
      footPlay.url = URL.createObjectURL(blob);
      var v = $('footVid');
      v.src = footPlay.url;
      $('footPlayWrap').hidden = false;
      $('footPlayMeta').textContent = footWhere(m, 0);
      $('footState').textContent =
        'Scrub to the defect that was missed, pause, then Analyse this frame.';
      footPaint();
    });
  }).catch(function (e) {
    $('footState').textContent = 'Could not open it: ' + String((e && e.message) || e);
  });
}

/* Where the vehicle was at a given moment of a recording, from the sidecar
   samples. The nearest sample rather than an interpolation: saying "about here,
   from a fix half a second away" is honest, and a smoothed position between two
   fixes is a number nobody measured. */
function footWhere(m, sec) {
  if (!m) return '';
  var L = [new Date(m.startedMs + sec * 1000).toISOString()];
  var g = m.gps || [], best = null;
  for (var i = 0; i < g.length; i++) {
    var d = Math.abs(g[i].ms - sec * 1000);
    if (!best || d < best.d) best = { d: d, s: g[i] };
  }
  if (best) {
    var s = best.s;
    L.push(s.lat.toFixed(5) + ', ' + s.lon.toFixed(5) +
      (s.acc == null ? '' : ' ±' + s.acc + ' m') +
      (s.speed == null ? '' : ' · ' + (s.speed * 2.23694).toFixed(0) + ' mph') +
      (s.heading == null ? '' : ' · heading ' + Math.round(s.heading) + '°') +
      ' (fix ' + (best.d / 1000).toFixed(1) + ' s away)');
  } else {
    L.push('no position was recorded');
  }
  L.push('video ' + (m.videoW || '?') + '×' + (m.videoH || '?') +
    ' · app ' + (m.appRot || 0) + '° · video ' + (m.videoRot || 0) +
    '° · screen ' + (m.screenAngle == null ? '?' : m.screenAngle) + '°' +
    ' · viewport ' + (m.portraitViewport ? 'portrait' : 'landscape'));
  return L.join('\n');
}

/* E and F: the frame on screen, into the miss report.

   Drawn at the video's own videoWidth × videoHeight — the frame's real pixels,
   its real aspect ratio, nothing cropped and nothing letterboxed. From there it
   goes through runMiss, which is the same function the photo picker calls, so
   the preprocessing is the survey's own and the report prints its two scale
   factors as it always does. */
function footFrame() {
  /* Named pv, not v. `v` is the live camera everywhere else in this file, and
     closer.mjs greps the source to prove nothing reads the live video again
     after inference — the fix that stopped evidence photographs being ten
     metres down the road from the pothole they were filed against. This draws
     from the RECORDING, which is a different element and a different question,
     and it should not have to look like the thing that guard exists to catch. */
  var pv = $('footVid');
  if (!pv || !footPlay.id) return null;
  var w = pv.videoWidth, h = pv.videoHeight;
  if (!w || !h) return null;
  /* HAVE_CURRENT_DATA. Below it there is no frame decoded for the current
     time, and drawImage returns black rather than failing — which would put a
     miss report on an empty square and have it read like a finding. */
  if (pv.readyState < 2) return null;
  var c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d').drawImage(pv, 0, 0, w, h);
  return { canvas: c, w: w, h: h, t: pv.currentTime };
}

function footAnalyse() {
  var f = footFrame();
  if (!f) {
    $('footState').textContent =
      'No frame to take — open a recording and let it show a picture first.';
    return;
  }
  var m = footPlay.meta || {};
  footPlay.frameAt = f.t;
  $('footPlayMeta').textContent = footWhere(m, f.t);
  /* The label carries the recording and the offset, so a report copied out of
     here can be traced back to the second of the drive it came from. */
  runMiss(f.canvas, f.w, f.h,
    'footage · ' + (m.id || '?') + ' at ' + f.t.toFixed(2) + 's');
}

function paintFrameTest() {
  var pre = $('frameText'), wrap = $('tShotWrap');
  /* The benchmark never runs the SDK, so it produces no frame test. Its table
     still belongs on the screen rather than only in the copied diagnostics. */
  var extra = [missLines(), benchLines()].filter(Boolean).join('\n\n');
  pre.hidden = !frameTest && !extra;
  if (!frameTest) {
    wrap.hidden = true;
    pre.textContent = extra;
    return;
  }
  pre.textContent = frameLines(frameTest);
  if (testUrl) { URL.revokeObjectURL(testUrl); testUrl = null; }
  if (frameTest.shot) {
    testUrl = URL.createObjectURL(frameTest.shot);
    $('tShot').src = testUrl;
    wrap.hidden = false;
  } else { wrap.hidden = true; }
}

function busy(on) {
  $('bTestCam').disabled = on;
  $('bTestSpin').disabled = on;
  $('bTestBench').disabled = on;
  $('benchFileLabel').classList.toggle('off', on);
  $('tFileLabel').classList.toggle('off', on);
}

function runTest(label, get, from) {
  var s = $('tState');
  busy(true);
  s.textContent = 'Loading the model…';
  loadModel().then(function () {
    s.textContent = 'Running the model on the frame…';
    return get();
  }).then(function (args) {
    return testFrame(args[0], args[1], args[2], label, from || 'camera', 0);
  }).then(function (f) {
    frameTest = f;
    paintFrameTest();
    paintDiag();
    s.textContent = f.kept.length
      ? 'Done — the survey would have logged ' + f.kept.length + ' of these.'
      : 'Done — nothing the survey would log. Read the result below before concluding anything.';
    busy(false);
  }, function (e) {
    frameTest = null;
    /* A picture that never reached the model is not the model failing. Saying
       "The model failed while running" about an undecodable file is what sent
       a whole afternoon after the camera path, which was working. */
    lastSourceFail = (e && e.source) ? String(e.message) : null;
    paintFrameTest();
    s.textContent = 'Could not run it: ' +
      (lastSourceFail ? 'the picture never reached the model — ' + lastSourceFail
                      : whyLocal(e));
    busy(false);
  });
}

/* ---------- the same frame, four ways up ----------

   The one experiment that separates "the model cannot see this pothole" from
   "the model cannot see this pothole sideways". It matters because the app
   turns its own chrome when the viewport is portrait and does not turn the
   pixels the model is given, so an operator looking at an upright road can be
   handing the model a road on its side.

   Four inferences, and on the CPU backend those are not fast — which is why
   the button says how long it will take and why it is a separate button rather
   than something every test does. */
var spinTest = null;

function runSpin() {
  var v = $('vid'), s = $('tState');
  if (!stream || !v.videoWidth) {
    s.textContent = 'The camera is not running — start it, then come back.';
    return;
  }
  busy(true);
  spinTest = { at: new Date().toISOString(), rows: [] };
  var angles = [0, 90, 180, 270], i = 0;

  function step() {
    if (i >= angles.length) return Promise.resolve();
    var deg = angles[i];
    s.textContent = 'Turning the frame ' + deg + '° and asking again… (' +
      (i + 1) + ' of 4, this is slow on the CPU backend)';
    return testFrame(v, v.videoWidth, v.videoHeight, 'camera', 'camera', deg)
      .then(function (f) {
        var b = (f.diag && f.diag.best) || null;
        spinTest.rows.push({
          deg: deg, best: b, kept: f.kept.length, raw: f.raw.length,
          ms: f.diag && f.diag.msExecute
        });
        if (deg === 0) { frameTest = f; paintFrameTest(); }
        i++;
        return step();
      });
  }

  loadModel().then(step).then(function () {
    paintFrameTest(); paintDiag();
    var best = spinTest.rows.reduce(function (a, b) {
      return (b.best && b.best.score || 0) > (a.best && a.best.score || 0) ? b : a;
    });
    s.textContent = 'Done. Best at ' + best.deg + '°: ' +
      (best.best ? best.best.cls + ' ' + round4(best.best.score) : 'nothing') +
      '. Read the table below.';
    busy(false);
  }, function (e) {
    s.textContent = 'Could not run it: ' + whyLocal(e);
    busy(false);
  });
}

function spinLines() {
  if (!spinTest || !spinTest.rows.length) return '';
  var L = ['FOUR WAYS UP  (the same camera frame, turned before the model sees it)'];
  L.push('  turn   best class   score    detections   would log');
  spinTest.rows.forEach(function (r) {
    L.push('  ' + String(r.deg + '°').padEnd(6) + ' ' +
      String((r.best && r.best.cls) || '—').padEnd(12) + ' ' +
      String(r.best ? round4(r.best.score) : '—').padEnd(8) + ' ' +
      String(r.raw).padEnd(12) + ' ' + r.kept);
  });
  var top = spinTest.rows.reduce(function (a, b) {
    return (b.best && b.best.score || 0) > (a.best && a.best.score || 0) ? b : a;
  });
  L.push('');
  L.push('  Best at ' + top.deg + '°. ' + (top.deg === 0
    ? 'The frame the survey already feeds the model is the best of the four, so'
    : 'The survey feeds the model 0°, which is NOT the best of the four, so'));
  L.push('  ' + (top.deg === 0
    ? 'orientation is not what is holding this back.'
    : 'the frame is reaching the model a quarter turn from upright.'));
  return L.join('\n');
}

$('bTestCam').addEventListener('click', function () {
  var v = $('vid');
  if (!stream || !v.videoWidth) {
    $('tState').textContent = 'The camera is not running. Go back, start it, then come here — ' +
      'or use Test a photo.';
    return;
  }
  runTest('camera', function () {
    return Promise.resolve([v, v.videoWidth, v.videoHeight]);
  }, 'camera');
});

$('bTestSpin').addEventListener('click', runSpin);
$('bTestBench').addEventListener('click', runBenchCamera);

/* The same benchmark over a photograph. The known result — pothole 0.7236 —
   came off a file, so putting that same file through all three backends is the
   only way to separate "faster" from "differently wrong". */
$('benchFile').addEventListener('change', function () {
  var file = this.files && this.files[0];
  this.value = '';
  if (!file) return;
  busy(true);
  $('tState').textContent = 'Decoding the photograph…';
  createImageBitmap(file, { imageOrientation: 'from-image' })
    .catch(function () { return createImageBitmap(file); })
    .then(function (bmp) {
      runBench(bmp, bmp.width, bmp.height, 'photo · ' + file.name);
    }, function (e) {
      busy(false);
      $('tState').textContent = 'Could not run it: the picture never reached the model — ' +
        'this browser could not decode "' + file.name + '" (' +
        (file.type || 'no type given') + '). [' + String((e && e.message) || e) + ']';
    });
});

/* The miss analysis, over a photograph of a road that WAS missed.
   Diagnostic only: it reports what every stage did and changes nothing. */
/* Zoom. The only thing these change is the camera track — no threshold, no
   cadence, and nothing about how the frame is cut up afterwards. */
$('zoom1').addEventListener('click', function () { zoomApply(1); });
$('zoomIn').addEventListener('click', function () { zoomApply(ZOOM_WANT); });

/* Footage controls. Diagnostic only: none of these touch the survey, the
   model, the thresholds or the evidence photographs. */
$('bFootStart').addEventListener('click', function () { footStart(); });
$('bFootStop').addEventListener('click', function () { footStop('asked'); });
$('bFootFrame').addEventListener('click', footAnalyse);
$('bFootClose').addEventListener('click', function () { footClose(); footPaint(); });
/* Scrubbing updates where and which way up, so the numbers on screen always
   describe the frame being looked at rather than the one it opened on. */
$('footVid').addEventListener('timeupdate', function () {
  if (footPlay.meta) $('footPlayMeta').textContent =
    footWhere(footPlay.meta, $('footVid').currentTime);
});

/* One picture, four preprocessings, same weights and same decoder. Diagnostic:
   squareFrame is untouched and the survey still stretches. */
$('abFile').addEventListener('change', function () {
  var file = this.files && this.files[0];
  this.value = '';
  if (!file) return;
  busy(true);
  $('tState').textContent = 'Decoding the photograph…';
  createImageBitmap(file, { imageOrientation: 'from-image' })
    .catch(function () { return createImageBitmap(file); })
    .then(function (bmp) {
      runMissAB(bmp, bmp.width, bmp.height, file.name);
    }, function (e) {
      busy(false);
      $('tState').textContent = 'Could not run it: this browser could not decode "' +
        file.name + '" — ' + String((e && e.message) || e);
    });
});

$('missFile').addEventListener('change', function () {
  var files = [].slice.call(this.files || []);
  this.value = '';
  if (!files.length) return;
  /* A new pick is a new batch. Otherwise the table across images would grow
     every time somebody tried one more photograph, and quietly stop being a
     table about the set they meant. */
  missRuns = [];
  missResult = null;
  paintFrameTest();
  busy(true);

  var next = function (i) {
    if (i >= files.length) {
      busy(false);
      if (files.length > 1) {
        $('tState').textContent = 'Done. ' + missRuns.length + ' of ' +
          files.length + ' photographs went through. The table across them is ' +
          'at the top of the report.';
      }
      return;
    }
    var file = files[i];
    $('tState').textContent = files.length > 1
      ? 'Decoding ' + (i + 1) + ' of ' + files.length + ': ' + file.name + '…'
      : 'Decoding the photograph…';
    return createImageBitmap(file, { imageOrientation: 'from-image' })
      .catch(function () { return createImageBitmap(file); })
      .then(function (bmp) {
        return runMiss(bmp, bmp.width, bmp.height, 'photo · ' + file.name);
      }, function (e) {
        /* One picture this browser cannot decode should not take the other
           seven with it — say which one, and carry on. */
        $('tState').textContent = 'Could not run it: the picture never reached ' +
          'the model — this browser could not decode "' + file.name + '" (' +
          (file.type || 'no type given') + '). [' +
          String((e && e.message) || e) + ']';
        return null;
      })
      .then(function () { return next(i + 1); });
  };
  next(0);
});

$('tFile').addEventListener('change', function () {
  var file = this.files && this.files[0];
  this.value = '';                       // so the same file can be picked twice
  if (!file) return;
  runTest('photo · ' + file.name, function () {
    /* from-image honours the EXIF rotation a phone camera writes, so a picture
       taken in portrait is not analysed on its side. Browsers that do not know
       the option ignore it. */
    return createImageBitmap(file, { imageOrientation: 'from-image' })
      .catch(function () { return createImageBitmap(file); })
      .catch(function (e) {
        /* "The source image could not be decoded" is the browser's own words
           for a file whose bytes it cannot read, and it is the ONLY thing in
           this app that produces that sentence. Reported here, with the file
           named, because the same message arriving unattributed reads like a
           camera fault and sends the search to the wrong end of the pipeline.
           HEIC is the usual culprit: it is what an iPhone saves by default and
           what no browser will decode. */
        var heic = /\.(heic|heif)$/i.test(file.name) || /heic|heif/i.test(file.type || '');
        throw new SourceError('this browser could not decode "' + file.name + '" (' +
          (file.type || 'no type given') + ', ' + Math.round(file.size / 1024) + ' kB)' +
          (heic ? '. That is an HEIC/HEIF file — the format an iPhone saves by ' +
                  'default, and one no browser decodes. Share or export it as JPEG ' +
                  'and try that.'
                : '. The file is not in a format this browser can read as an image.') +
          ' The model was never given anything, so this says nothing about the model. ' +
          '[' + String((e && e.message) || e) + ']');
      })
      .then(function (bmp) { return [bmp, bmp.width, bmp.height]; });
  }, 'photo, EXIF rotation applied');
});

function paintDiag() { $('diagText').textContent = diagLines(); }

function openDiag() {
  show('diag');
  paintFrameTest();
  paintDiag();
  footPaint();
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
  /* A second view of the same stream, so the phone can be aimed at a pothole
     while the diagnostics screen is up. It is the same MediaStream — no second
     camera is opened — and it is released the moment the screen is left, so
     nothing keeps decoding video behind a sheet nobody is looking at. */
  var tv = $('tVid');
  if (tv) {
    if (which === 'diag' && stream) {
      tv.srcObject = stream; $('tNo').hidden = true;
    } else {
      tv.srcObject = null; $('tNo').hidden = !!stream;
    }
  }
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
  /* A wake lock does not survive the page being hidden, and the system can take
     one back at any time. If a survey is somehow still running when the app
     comes back, ask again — and carry on regardless if the answer is no. */
  if (survey.on && !wakeLock) requestWake();
});
window.addEventListener('pagehide', stopAll);

/* ---------- go ---------- */
$('build').textContent = BUILD;
$('fType').innerHTML = TYPES.map(function (t) { return '<option>' + t + '</option>'; }).join('');
buildMatrix(); verdict(); paintSurface(); paintRec(); loadTag(); paintSpace();
lockLandscape();          // granted when installed off the manifest; refused in a tab

openDb().then(function (d) {
  db = d;
  return migrateLegacy().then(function () {
    return Promise.all([allEntries(), allPhys()]);
  }).then(function (both) {
    var rows = both[0] || [], phys = both[1] || [];
    /* Anything written before the split gets an observation id and a defect of
       its own, once. Rows that already have both are left alone, so this is a
       no-op on every load after the first. */
    return migrateToDefects(rows, phys).then(function (made) {
      S.defects = phys.concat(made);
      return rows;
    });
  });
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

