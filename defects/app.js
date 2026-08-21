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

var STALE_MS = 30000;   // a fix older than this is called out, not trusted quietly
var POOR_ACC = 25;      // metres; wider than this and you cannot find the defect again
var MAX_EDGE = 1600;    // longest side of a saved photograph

var S = { imp: 0, prob: 0, foot: false, wide: null,
          shot: null, shotFix: null, prevUrl: null, gps: null, items: [] };
var stream = null, watchId = null, ageTimer = null, urls = [], lbUrl = null;

/* ---------- store ---------- */
/* IndexedDB, with the whole thing degrading to memory if the browser won't
   give us one (private windows, storage switched off). The difference from the
   prototype is that the degradation is announced. */
var DB_NAME = 'deflog', STORE = 'defects', db = null, dbBroken = false;

function openDb() {
  return new Promise(function (resolve, reject) {
    if (!self.indexedDB) return reject(new Error('no IndexedDB'));
    var req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = function () {
      req.result.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = function () { resolve(req.result); };
    req.onerror = function () { reject(req.error); };
  });
}

function tx(mode, fn) {
  return new Promise(function (resolve, reject) {
    if (!db) return reject(new Error('no store'));
    var t = db.transaction(STORE, mode), out = fn(t.objectStore(STORE));
    t.oncomplete = function () { resolve(out && out.result); };
    t.onerror = function () { reject(t.error); };
    t.onabort = function () { reject(t.error); };
  });
}

function putEntry(e) { return tx('readwrite', function (s) { return s.put(e); }); }
function delEntry(id) { return tx('readwrite', function (s) { return s.delete(id); }); }
function clearEntries() { return tx('readwrite', function (s) { return s.clear(); }); }
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
    S.imp = +b.dataset.i; S.prob = +b.dataset.p;
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
  escalation();   // the escalation test stands on depth and width, not on the score
}

/* ---------- Cat 1 escalation ---------- */
function escalation() {
  var d = parseFloat($('fDepth').value), lim = S.foot ? 20 : 40, o = $('escOut');
  var parts = [], pass = 0, total = 2;
  if (isNaN(d)) { parts.push('<span class="no">Depth not measured — cannot test.</span>'); }
  else if (d >= lim) { parts.push('<span class="yes">Depth ' + d + 'mm meets the ' + lim + 'mm limit.</span>'); pass++; }
  else { parts.push('<span class="no">Depth ' + d + 'mm is under the ' + lim + 'mm limit.</span>'); }
  if (S.wide === null) { parts.push('<span class="no">Width not stated.</span>'); }
  else if (S.wide) { parts.push('<span class="yes">Wider than a tyre.</span>'); pass++; }
  else { parts.push('<span class="no">Not wider than a tyre.</span>'); }
  var concl;
  if (pass === total) concl = '<br><b style="color:#fff">Both limbs met — escalates to Category 1.</b>';
  else if (isNaN(d) || S.wide === null) concl = '<br>Incomplete — gauge it on site before escalating.';
  else concl = '<br>Does not escalate on this test.';
  o.innerHTML = parts.join(' ') + concl;
}
$('fDepth').addEventListener('input', escalation);

/* ---------- segmented controls ---------- */
function seg(a, b, fn) {
  a.addEventListener('click', function () {
    a.setAttribute('aria-pressed', 'true'); b.setAttribute('aria-pressed', 'false'); fn(true);
  });
  b.addEventListener('click', function () {
    b.setAttribute('aria-pressed', 'true'); a.setAttribute('aria-pressed', 'false'); fn(false);
  });
}
seg($('segCar'), $('segFoot'), function (isCar) { S.foot = !isCar; escalation(); });
seg($('segW1'), $('segW0'), function (y) { S.wide = y; escalation(); });

/* ---------- camera ---------- */
$('bStart').addEventListener('click', async function () {
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
    $('vid').srcObject = stream; $('badge').textContent = 'Live';
    $('bStart').hidden = true; $('capRow').hidden = false; $('rec').hidden = false;
    $('camNote').hidden = true;
    startGps();
  } catch (e) {
    note('Camera did not open: ' + e.name + '. If this is not an https address, that is why.', true);
  }
});
$('bStop').addEventListener('click', stopAll);

function stopAll() {
  if (stream) { stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; }
  if (watchId != null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
  if (ageTimer) { clearInterval(ageTimer); ageTimer = null; }
  /* The last fix goes with the camera. Keeping it means the next capture — which
     could be a mile down the road — gets tagged with where you were standing
     when you last stopped. */
  S.gps = null;
  $('badge').textContent = 'Camera off'; $('bStart').hidden = false;
  $('capRow').hidden = true; $('rec').hidden = true; $('gpsBox').hidden = true;
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

    S.imp = 0; S.prob = 0; S.wide = null;
    $('fDepth').value = ''; $('fNote').value = ''; $('fType').selectedIndex = 0;
    $('segW1').setAttribute('aria-pressed', 'false');
    $('segW0').setAttribute('aria-pressed', 'false');
    clearMatrix();
    verdict();
    paintFixNote();
    show('score');
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
  var n = S.imp * S.prob, c = category(n), d = parseFloat($('fDepth').value), f = S.shotFix;
  var e = {
    id: nextId(), t: new Date().toISOString(), img: S.shot,
    imp: S.imp, prob: S.prob, score: n, cat: c.k, resp: c.r, key: c.key,
    surface: S.foot ? 'Footway/cycleway' : 'Carriageway',
    depth: isNaN(d) ? null : d, wide: S.wide,
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
    var dep = (it.depth != null) ? it.depth + 'mm at deepest point' : 'Depth not measured';
    var w = (it.wide === null) ? 'width not stated' : (it.wide ? 'wider than a tyre' : 'not wider than a tyre');
    var src = '';
    if (it.img) { src = URL.createObjectURL(it.img); urls.push(src); }
    return '<div class="item ' + it.key + '">' +
      (src ? '<button type="button" class="thumb" data-full="' + it.id + '">' +
             '<img src="' + src + '" alt="Defect photograph, tap for full size"></button>' : '') +
      '<div class="body"><div class="top"><span class="cat">' + esc(it.cat) + '</span>' +
      '<span class="sc">' + it.imp + ' × ' + it.prob + ' = ' + it.score + '</span></div>' +
      '<div class="det">' + esc(it.resp) + ' · ' + esc(it.type) + ' · ' + esc(it.surface) + '<br>' +
      esc(dep) + ', ' + esc(w) + '<br>' + esc(loc) + flag + '<br>' +
      new Date(it.t).toLocaleString() +
      (it.note ? '<br>' + esc(it.note) : '') + '</div>' +
      '<button class="del" data-id="' + it.id + '">Remove</button></div></div>';
  }).join('');
  quota();
}

$('list').addEventListener('click', function (e) {
  var full = e.target.closest('.thumb');
  if (full) return openFull(+full.dataset.full);
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
  var head = ['timestamp', 'latitude', 'longitude', 'gps_accuracy_m', 'gps_fix_age_s',
    'defect_type', 'surface', 'impact', 'probability', 'risk_factor', 'category', 'response_time',
    'depth_mm_deepest', 'wider_than_tyre', 'notes'];
  var rows = S.items.map(function (i) {
    return [i.t, i.lat, i.lon, i.acc, i.fixAge, i.type, i.surface,
      i.imp, i.prob, i.score, i.cat, i.resp, i.depth,
      i.wide === null ? '' : (i.wide ? 'yes' : 'no'), i.note].map(q).join(',');
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
    dl('defects-' + stamp() + '.json',
       new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json' }));
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
document.addEventListener('visibilitychange', function () {
  if (document.visibilityState === 'hidden' && stream) stopAll();
});
window.addEventListener('pagehide', stopAll);

/* ---------- go ---------- */
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
  // home-screen shortcuts land on a tab rather than always on the camera
  if (new URLSearchParams(location.search).get('open') === 'log') show('log');
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  });
}
