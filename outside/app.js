/* Step Out — the screen, the settings and the nudging.

   The app has one job: notice that the next two hours are the good bit of the
   day, and say so while there is still time to do something about it. A
   forecast app tells you what the weather will be. This one tells you when to
   put your shoes on.

   The arithmetic — scoring an hour, finding a window, deciding a nudge is
   worth sending — lives in forecast.js, because the service worker runs the
   same code when the app is closed. This file is what happens around it:
   where the place comes from, what gets drawn, and what the buttons do.

   Everything is kept on the phone. The only thing that leaves it is a pair of
   coordinates, sent to Open-Meteo to ask what the weather is doing there. */

var S = self.StepOut;
var $ = function (id) { return document.getElementById(id); };

/* Printed in Settings, so a phone can say which copy it is running without a
   round trip to find out. Bump it, the ?v= on the two script tags, the
   stylesheet and the cache name in sw.js together on a release. */
var BUILD = '2026-08-23 · 1';

var STORE_KEY = 'stepOut.v1';

/* A forecast this old is redrawn from cache but refetched in the background.
   Hourly data does not change faster than this, and a phone on a train should
   not be asking every time it is looked at. */
var STALE_MS = 20 * 60 * 1000;

/* How often the open app looks again. Notifications from a closed app are the
   worker's job; this is the belt to its braces, and the reason the card in
   front of you never says something the notification would disagree with. */
var TICK_MS = 5 * 60 * 1000;

var state = null;
var forecast = null;      /* the parsed forecast, or null before the first one */
var windows = [];
var log = S.emptyLog();   /* what has already been nudged, shared with the worker */
var fetching = false;
var lastError = '';

/* ------------------------------------------------------------------- state */

function defaults() {
  return {
    v: 1,
    place: null,
    activities: { walk: true, run: false, ride: false, park: false, garden: false, sit: false },
    fuss: 'normal',
    units: 'metric',
    ampm: false,
    lead: 30,
    maxPerDay: 3,
    quiet: { from: 21, to: 7 },
    horizon: 36,
    notify: false,
    asked: false,          /* whether the nudges banner has been answered */
    snoozeUntil: 0,
    outings: [],
    cache: null            /* the last forecast that arrived, for opening offline */
  };
}

function load() {
  var raw = null;
  try { raw = localStorage.getItem(STORE_KEY); } catch (e) { raw = null; }
  var saved = null;
  if (raw) { try { saved = JSON.parse(raw); } catch (e) { saved = null; } }
  state = defaults();
  if (saved && typeof saved === 'object') {
    for (var k in state) {
      if (Object.prototype.hasOwnProperty.call(saved, k) && saved[k] !== null && saved[k] !== undefined) {
        state[k] = saved[k];
      }
    }
    /* An older copy might be missing an activity added since. */
    var d = defaults().activities;
    for (var a in d) if (!(a in state.activities)) state.activities[a] = d[a];
  }
  if (state.cache) forecast = state.cache;
}

function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* full or private */ }
  publish();
}

/* The worker cannot read localStorage, so the settings it needs are mirrored
   into the little IndexedDB store both can reach. The page is the only writer
   of settings; the worker only ever adds to the sent log. */
function publish() {
  if (!S.kv) return;
  S.kv.set('settings', {
    place: state.place,
    activities: state.activities,
    fuss: state.fuss,
    units: state.units,
    ampm: state.ampm,
    lead: state.lead,
    maxPerDay: state.maxPerDay,
    quiet: state.quiet,
    horizon: state.horizon,
    notify: state.notify,
    snoozeUntil: state.snoozeUntil,
    outings: state.outings.slice(-40)
  });
}

function loadLog() {
  if (!S.kv) return Promise.resolve();
  return S.kv.get('log').then(function (saved) {
    if (saved && saved.keys && saved.sent) log = saved;
  });
}

function saveLog() {
  if (S.kv) S.kv.set('log', log);
}

/* --------------------------------------------------------------- the place */

function useHere(outEl) {
  if (!navigator.geolocation) {
    if (outEl) outEl.textContent = 'This browser will not say where it is. Search for a place instead.';
    return;
  }
  if (outEl) outEl.textContent = 'Asking the phone where it is…';
  navigator.geolocation.getCurrentPosition(function (pos) {
    setPlace({
      name: 'Where you are',
      lat: Math.round(pos.coords.latitude * 10000) / 10000,
      lon: Math.round(pos.coords.longitude * 10000) / 10000,
      here: true
    });
    if (outEl) outEl.textContent = '';
    closeSheet($('placeSheet'));
  }, function (err) {
    /* The two failures worth telling apart: refused, and could not tell. */
    if (outEl) {
      outEl.textContent = err && err.code === 1
        ? 'Location is turned off for this app. Search for a place instead.'
        : 'Could not work out where you are. Search for a place instead.';
    }
  }, { enableHighAccuracy: false, timeout: 12000, maximumAge: 10 * 60 * 1000 });
}

function setPlace(place) {
  state.place = place;
  state.cache = null;
  forecast = null;
  save();
  render();
  refresh(true);
}

function searchPlaces(query) {
  var out = $('placeOut');
  var list = $('placeResults');
  list.innerHTML = '';
  if (!query) return;
  out.textContent = 'Looking…';
  fetch(S.searchUrl(query)).then(function (r) {
    if (!r.ok) throw new Error('search ' + r.status);
    return r.json();
  }).then(function (json) {
    var found = (json && json.results) || [];
    if (!found.length) { out.textContent = 'Nothing by that name.'; return; }
    out.textContent = '';
    found.forEach(function (place) {
      var li = document.createElement('li');
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'result';
      var where = [place.admin1, place.country].filter(Boolean).join(', ');
      btn.innerHTML = '<b></b><span></span>';
      btn.firstChild.textContent = place.name;
      btn.lastChild.textContent = where;
      btn.addEventListener('click', function () {
        setPlace({
          name: place.name,
          where: where,
          lat: Math.round(place.latitude * 10000) / 10000,
          lon: Math.round(place.longitude * 10000) / 10000
        });
        closeSheet($('placeSheet'));
      });
      li.appendChild(btn);
      list.appendChild(li);
    });
  }).catch(function () {
    out.textContent = 'Could not reach the place list. Check the signal.';
  });
}

/* ------------------------------------------------------------ the forecast */

function fresh() {
  return forecast && forecast.fetchedAt && (Date.now() - forecast.fetchedAt * 1000) < STALE_MS;
}

function refresh(force) {
  if (!state.place || fetching) return Promise.resolve();
  if (!force && fresh()) return Promise.resolve();
  fetching = true;
  render();
  return fetch(S.forecastUrl(state.place, 3)).then(function (r) {
    if (!r.ok) throw new Error('forecast ' + r.status);
    return r.json();
  }).then(function (json) {
    forecast = S.parse(json, state.place);
    /* The whole forecast is kept, not just the summary: it is what lets the
       app open on the underground and still be honest about what it knows. */
    state.cache = forecast;
    lastError = '';
    save();
    fetching = false;
    render();
    checkNudge();
  }).catch(function (err) {
    fetching = false;
    lastError = String(err && err.message || err);
    render();
  });
}

/* ------------------------------------------------------------- the drawing */

function anyActivity() {
  for (var k in state.activities) if (state.activities[k]) return true;
  return false;
}

function render() {
  var now = Math.floor(Date.now() / 1000);

  $('placeName').textContent = state.place ? state.place.name : 'Set a place';
  $('setup').hidden = !!state.place;

  var have = !!(state.place && forecast);
  $('nowCard').hidden = !have;
  $('stripCard').hidden = !have;
  $('laterCard').hidden = !have;
  $('streakCard').hidden = !state.place;
  $('verdict').hidden = true;
  $('noWindow').hidden = true;

  if (!have) { renderStreak(now); renderFoot(now); renderAsk(); return; }

  windows = anyActivity() ? S.allWindows(forecast, state, now) : [];
  var pick = S.headline(windows);

  renderNow(now);
  if (pick) renderVerdict(pick, now); else renderNothing(now);
  renderStrip(now);
  renderWindows(pick, now);
  renderStreak(now);
  renderAsk();
  renderFoot(now);
}

function renderNow(now) {
  /* The hour you are in, which is the one whose stamp is at or before now. */
  var hour = null;
  for (var i = 0; i < forecast.hours.length; i++) {
    if (forecast.hours[i].t <= now && forecast.hours[i].t + 3600 > now) { hour = forecast.hours[i]; break; }
  }
  if (!hour) hour = forecast.hours[0];
  $('nowIcon').textContent = S.skyIcon(hour.code, hour.day);
  $('nowTemp').textContent = S.temp(hour.temp, state.units);
  var bits = [S.skyName(hour.code)];
  if (Math.round(hour.feels) !== Math.round(hour.temp)) {
    bits.push('feels ' + S.temp(hour.feels, state.units));
  }
  bits.push(S.speed(hour.gust, state.units) + ' gusts');
  bits.push(hour.prob + '% rain');
  $('nowSub').textContent = bits.join(' · ');
}

function whenLine(win, now) {
  if (win.start <= now) return 'Right now';
  var mins = Math.round((win.start - now) / 60);
  if (mins <= 90) return 'In ' + mins + ' minutes';
  var today = S.dayOf(now, forecast.offset);
  var day = S.dayOf(win.start, forecast.offset);
  var at = S.clock(win.start, forecast.offset, state.ampm);
  if (day === today) return 'At ' + at;
  if (day === today + 1) return 'Tomorrow, ' + at;
  return dayName(win.start) + ', ' + at;
}

function dayName(t) {
  var names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return names[S.at(t, forecast.offset).getUTCDay()];
}

function renderVerdict(win, now) {
  var act = S.activity(win.activity);
  var said = S.say(win, forecast, windows, state, now, S.streak(state.outings, forecast.offset, now));
  var el = $('verdict');
  el.hidden = false;
  el.className = 'card verdict' + (win.start <= now ? ' verdict--now' : '');
  $('verdictWhen').textContent = whenLine(win, now);
  $('verdictLine').textContent = act.go;
  /* A trimmed window is the best six hours of something longer, and saying so
     turns "you have six hours" into "you are not going to miss it". */
  $('verdictWhy').textContent = said.opener +
    (win.trimmed ? ' It stays good after that.' : '') +
    (said.tail ? ' ' + said.tail : '');

  var mid = win.hours[Math.floor(win.hours.length / 2)];
  var facts = $('verdictFacts');
  facts.innerHTML = '';
  addFact(facts, S.skyIcon(mid.code, mid.day), S.span(win, forecast.offset, state.ampm));
  addFact(facts, '🌡️', S.temp(mid.feels, state.units));
  addFact(facts, '💨', S.speed(mid.gust, state.units));
  addFact(facts, '🌧️', win.wettest + '%');

  var score = $('verdictScore');
  score.hidden = false;
  score.textContent = win.score;
  score.className = 'score ' + band(win.score);
}

function addFact(parent, icon, text) {
  var span = document.createElement('span');
  span.className = 'fact';
  var i = document.createElement('i');
  i.textContent = icon;
  span.appendChild(i);
  span.appendChild(document.createTextNode(text));
  parent.appendChild(span);
}

function band(score) {
  if (score >= 80) return 'b4';
  if (score >= 66) return 'b3';
  if (score >= 55) return 'b2';
  if (score >= 35) return 'b1';
  return 'b0';
}

/* Nothing worth going out for is a real answer, and a better one than an
   empty screen — as long as it says why, and how long the misery lasts. */
function renderNothing(now) {
  var el = $('noWindow');
  el.hidden = false;
  if (!anyActivity()) {
    $('noWindowLine').textContent = 'Nothing chosen';
    $('noWindowWhy').textContent = 'Tell it what you would go out for and it will start watching for it.';
    return;
  }
  var horizon = now + state.horizon * 3600;
  var worst = commonStop(now, horizon);
  $('noWindowLine').textContent = 'Not worth it yet';
  $('noWindowWhy').textContent =
    'Nothing clears the bar between now and ' + dayName(horizon).toLowerCase() +
    ' ' + S.clock(horizon, forecast.offset, state.ampm) +
    (worst ? ' — ' + worst + '.' : '.') +
    ' Turn the fussiness down or add something you would go out in.';
}

/* The reason the most hours were thrown out, so "not worth it" can name the
   thing rather than shrug. */
function commonStop(from, until) {
  var counts = {};
  var best = '', bestN = 0;
  for (var i = 0; i < forecast.hours.length; i++) {
    var h = forecast.hours[i];
    if (h.t + 3600 <= from || h.t >= until) continue;
    for (var a = 0; a < S.ACTIVITIES.length; a++) {
      var act = S.ACTIVITIES[a];
      if (!state.activities[act.id]) continue;
      var stops = S.scoreHour(h, act, state.fuss).stops;
      for (var s = 0; s < stops.length; s++) {
        counts[stops[s]] = (counts[stops[s]] || 0) + 1;
        if (counts[stops[s]] > bestN) { bestN = counts[stops[s]]; best = stops[s]; }
      }
    }
  }
  if (!best) return '';
  return 'mostly ' + best;
}

/* The strip is the argument for the verdict: you can see the good hours and
   the bad ones, and that the app picked the right run out of them. */
function renderStrip(now) {
  var wrap = $('hours');
  wrap.innerHTML = '';
  var acts = S.ACTIVITIES.filter(function (a) { return state.activities[a.id]; });
  $('stripFor').textContent = acts.length
    ? 'scored for ' + acts.map(function (a) { return a.short; }).join(', ')
    : '';
  var shown = 0;
  var lastDay = null;
  for (var i = 0; i < forecast.hours.length && shown < 36; i++) {
    var h = forecast.hours[i];
    if (h.t + 3600 <= now) continue;
    var best = 0, bestAct = null;
    for (var a = 0; a < acts.length; a++) {
      var s = S.scoreHour(h, acts[a], state.fuss).score;
      if (s > best) { best = s; bestAct = acts[a]; }
    }
    var col = document.createElement('button');
    col.type = 'button';
    col.className = 'hr ' + band(best) + (h.day ? '' : ' night');
    var bar = document.createElement('span');
    bar.className = 'bar';
    bar.style.height = Math.max(4, Math.round(best * 0.6)) + 'px';
    var label = document.createElement('span');
    label.className = 'hrlab';
    var hourNum = S.hourOf(h.t, forecast.offset);
    label.textContent = shown === 0 ? 'now' : (hourNum % 3 === 0 ? S.clock(h.t, forecast.offset, state.ampm).replace(':00', '') : '');
    col.appendChild(bar);
    col.appendChild(label);
    var day = S.dayOf(h.t, forecast.offset);
    if (lastDay !== null && day !== lastDay) col.classList.add('daybreak');
    lastDay = day;
    (function (hour, score, act) {
      col.addEventListener('click', function () { describeHour(hour, score, act); });
    })(h, best, bestAct);
    wrap.appendChild(col);
    shown++;
  }
  $('hourDetail').textContent = 'Tap an hour for what it is doing.';
}

function describeHour(hour, score, act) {
  var when = S.clock(hour.t, forecast.offset, state.ampm);
  var line = when + ' — ' + S.skyName(hour.code) + ', ' + S.temp(hour.temp, state.units) +
    ' (feels ' + S.temp(hour.feels, state.units) + '), ' + hour.prob + '% rain, ' +
    S.speed(hour.gust, state.units) + ' gusts.';
  if (score > 0 && act) {
    line += ' ' + score + '/100 for a ' + act.short + '.';
  } else {
    /* Naming the blocker is the difference between a bar being short and
       knowing not to bother looking again at four o'clock. */
    var stops = [];
    for (var a = 0; a < S.ACTIVITIES.length; a++) {
      if (!state.activities[S.ACTIVITIES[a].id]) continue;
      stops = S.scoreHour(hour, S.ACTIVITIES[a], state.fuss).stops;
      if (stops.length) break;
    }
    line += stops.length ? ' No good: ' + stops.join(', ') + '.' : ' Not up to much.';
  }
  $('hourDetail').textContent = line;
}

function renderWindows(pick, now) {
  var list = $('windowList');
  list.innerHTML = '';
  var shown = 0;
  var lastDay = null;
  /* Two activities liking the same afternoon is one piece of weather, not two
     suggestions. The card at the top has already claimed its hours, so they
     are taken before the list starts — otherwise the same afternoon appears
     twice, once as "go for a walk" and again as "sit out". */
  var taken = pick ? [[pick.start, pick.end]] : [];
  for (var i = 0; i < windows.length && shown < 6; i++) {
    var win = windows[i];
    if (overlaps(win, taken)) continue;
    taken.push([win.start, win.end]);
    var day = S.dayOf(win.start, forecast.offset);
    if (day !== lastDay) {
      list.appendChild(dayHeading(day, win.start, now));
      lastDay = day;
    }
    list.appendChild(windowRow(win, now));
    shown++;
  }
  $('laterCard').hidden = shown === 0;
}

function dayHeading(day, t, now) {
  var li = document.createElement('li');
  li.className = 'dayhead';
  var today = S.dayOf(now, forecast.offset);
  li.textContent = day === today ? 'Later today' : (day === today + 1 ? 'Tomorrow' : dayName(t));
  return li;
}

function overlaps(win, taken) {
  for (var i = 0; i < taken.length; i++) {
    if (win.start < taken[i][1] && win.end > taken[i][0]) return true;
  }
  return false;
}

function windowRow(win, now) {
  var act = S.activity(win.activity);
  var li = document.createElement('li');
  li.className = 'window';
  li.setAttribute('data-start', win.start);
  li.setAttribute('data-end', win.end);
  var mid = win.hours[Math.floor(win.hours.length / 2)];
  li.innerHTML =
    '<span class="wicon"></span>' +
    '<span class="wmain"><b></b><span class="wsub"></span></span>' +
    '<span class="wscore"></span>';
  li.querySelector('.wicon').textContent = act.icon;
  li.querySelector('.wmain b').textContent = whenLine(win, now) + ' · ' + act.short;
  li.querySelector('.wsub').textContent =
    S.span(win, forecast.offset, state.ampm) + ' · ' + S.skyPhrase(mid.code) +
    ', ' + S.temp(mid.feels, state.units);
  var score = li.querySelector('.wscore');
  score.textContent = win.score;
  score.className = 'wscore score ' + band(win.score);
  return li;
}

function renderStreak(now) {
  var streak = S.streak(state.outings, forecast ? forecast.offset : 0, now);
  $('streakN').textContent = streak.days;
  $('streakLine').textContent = streak.days === 1 ? 'day on the trot' : 'days on the trot';
  $('streakSub').textContent = streak.today
    ? 'Out today. That is the one that counts.'
    : (streak.days ? 'Not out today yet.' : 'Log one and it starts counting.');

  var dots = $('streakDots');
  dots.innerHTML = '';
  var offset = forecast ? forecast.offset : 0;
  var today = S.dayOf(now, offset);
  var seen = {};
  for (var i = 0; i < state.outings.length; i++) seen[S.dayOf(state.outings[i].at, offset)] = true;
  for (var d = today - 6; d <= today; d++) {
    var dot = document.createElement('span');
    dot.className = 'dot' + (seen[d] ? ' on' : '') + (d === today ? ' today' : '');
    dots.appendChild(dot);
  }
}

function renderAsk() {
  var supported = ('Notification' in self) && ('serviceWorker' in navigator);
  var granted = supported && Notification.permission === 'granted';
  $('askCard').hidden = !supported || state.asked || granted || !state.place;
}

function renderFoot(now) {
  var bits = [];
  if (fetching) bits.push('Checking…');
  else if (forecast) {
    var age = Math.round((Date.now() / 1000 - forecast.fetchedAt) / 60);
    bits.push(age < 1 ? 'Just now' : (age < 60 ? age + ' min ago' : Math.round(age / 60) + ' h ago'));
  }
  if (lastError) bits.push(forecast ? 'no signal, showing the last one' : 'could not fetch the forecast');
  if (state.snoozeUntil > (now || 0)) bits.push('nudges off until tomorrow');
  $('footStatus').textContent = bits.join(' · ');
}

/* -------------------------------------------------------------- the nudging */

/* The page's own check. The worker does this when the app is closed; this one
   covers the case of the app being open, or in a background tab, which on a
   desktop is most of the day. */
function checkNudge() {
  if (!forecast || !state.notify) return;
  if (!('Notification' in self) || Notification.permission !== 'granted') return;
  var now = Math.floor(Date.now() / 1000);
  var due = S.dueNudge(forecast, state, log, now);
  if (!due) return;
  fire(due.window, now);
}

function fire(win, now) {
  var streak = S.streak(state.outings, forecast.offset, now);
  var note = S.notificationFor(win, forecast, state, streak, now);
  show(note);
  log = S.rememberSent(log, note.key, now);
  saveLog();
}

/* Through the service worker where there is one — that is the only kind
   Android will show, and the only kind that survives the tab being closed.

   The wait for it is raced against a second and a half, because
   `serviceWorker.ready` does not reject when there is no worker to become
   ready: it simply never settles. Without the race, a browser with workers
   turned off would swallow every nudge silently, which is the worst way for
   this to fail. */
function show(note) {
  var opts = {
    body: note.body,
    tag: note.tag,
    icon: 'icon-192.png',
    badge: 'icon-192.png',
    data: { url: location.href }
  };
  var direct = function () { try { new Notification(note.title, opts); } catch (e) {} };
  if (!(navigator.serviceWorker && navigator.serviceWorker.ready)) return direct();

  var settled = false;
  var timer = setTimeout(function () {
    if (settled) return;
    settled = true;
    direct();
  }, 1500);
  navigator.serviceWorker.ready.then(function (reg) {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    reg.showNotification(note.title, opts);
  }).catch(function () {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    direct();
  });
}

function askPermission() {
  if (!('Notification' in self)) return Promise.resolve('unsupported');
  return Notification.requestPermission().then(function (result) {
    state.asked = true;
    state.notify = result === 'granted';
    save();
    if (state.notify) registerPeriodic();
    render();
    syncSettingsForm();
    return result;
  });
}

/* Periodic Background Sync is the only way a page with no server behind it
   gets to run while it is closed. Chrome on Android grants it to an installed
   app that gets used; everything else refuses, quietly, and the app falls
   back to checking whenever it is opened. Both paths are honest about
   themselves in Settings rather than pretending. */
function registerPeriodic() {
  if (!('serviceWorker' in navigator)) return Promise.resolve(false);
  return navigator.serviceWorker.ready.then(function (reg) {
    if (!reg.periodicSync) return false;
    return navigator.permissions.query({ name: 'periodic-background-sync' }).then(function (status) {
      if (status.state !== 'granted') return false;
      return reg.periodicSync.register('step-out-nudge', { minInterval: 60 * 60 * 1000 })
        .then(function () { return true; }).catch(function () { return false; });
    }).catch(function () { return false; });
  }).catch(function () { return false; });
}

/* What the browser turned out to allow: true if it will run the app in the
   background, false if it refused, null before we have asked. */
var periodicKnown = null;

function nudgeState() {
  if (!('Notification' in self)) return 'This browser does not do notifications at all.';
  if (Notification.permission === 'denied') {
    return 'Notifications are blocked for this app in the browser’s own settings. It cannot ask again from here.';
  }
  if (Notification.permission !== 'granted') return 'Not allowed yet — tick the box and the browser will ask.';
  if (!('serviceWorker' in navigator)) return 'Nudges arrive while the app is open.';
  return periodicKnown === true
    ? 'Nudges arrive on their own, app open or closed.'
    : (periodicKnown === false
      ? 'This browser will not run the app in the background, so a nudge arrives the next time you open it. Installing it to the home screen helps on Android.'
      : 'Checking what this browser allows…');
}

/* ------------------------------------------------------------- the settings */

function buildActivityPicks() {
  var wrap = $('activityPicks');
  wrap.innerHTML = '';
  S.ACTIVITIES.forEach(function (act) {
    var label = document.createElement('label');
    label.className = 'pick';
    var input = document.createElement('input');
    input.type = 'checkbox';
    input.value = act.id;
    input.checked = !!state.activities[act.id];
    input.addEventListener('change', function () {
      state.activities[act.id] = input.checked;
      save();
      render();
    });
    var span = document.createElement('span');
    span.innerHTML = '<i></i>';
    span.firstChild.textContent = act.icon;
    span.appendChild(document.createTextNode(act.label));
    label.appendChild(input);
    label.appendChild(span);
    wrap.appendChild(label);
  });
}

function buildHourSelects() {
  ['quietFrom', 'quietTo'].forEach(function (id) {
    var sel = $(id);
    sel.innerHTML = '';
    for (var h = 0; h < 24; h++) {
      var opt = document.createElement('option');
      opt.value = String(h);
      opt.textContent = (h < 10 ? '0' + h : h) + ':00';
      sel.appendChild(opt);
    }
  });
}

function syncSettingsForm() {
  var radios = document.querySelectorAll('input[name="fuss"]');
  for (var i = 0; i < radios.length; i++) radios[i].checked = radios[i].value === state.fuss;
  $('notifyOn').checked = state.notify;
  $('notifyState').textContent = nudgeState();
  $('leadSel').value = String(state.lead);
  $('maxSel').value = String(state.maxPerDay);
  $('quietFrom').value = String(state.quiet.from);
  $('quietTo').value = String(state.quiet.to);
  $('unitsSel').value = state.units;
  $('clockSel').value = state.ampm ? '12' : '24';
  $('buildHint').textContent = 'Build ' + BUILD;
  $('aboutBuild').textContent = 'Build ' + BUILD;
  var picks = $('activityPicks').querySelectorAll('input');
  for (var p = 0; p < picks.length; p++) picks[p].checked = !!state.activities[picks[p].value];
}

/* ---------------------------------------------------------------- the sheets */

function openSheet(el) { if (el.showModal) el.showModal(); else el.setAttribute('open', ''); }
function closeSheet(el) { if (el.close) el.close(); else el.removeAttribute('open'); }

function wireSheets() {
  var sheets = document.querySelectorAll('dialog.sheet');
  for (var i = 0; i < sheets.length; i++) {
    (function (sheet) {
      var closers = sheet.querySelectorAll('[data-close]');
      for (var c = 0; c < closers.length; c++) {
        closers[c].addEventListener('click', function () { closeSheet(sheet); });
      }
      /* Tapping the backdrop closes it, which is what a sheet that slid up
         from the bottom of a phone is expected to do. */
      sheet.addEventListener('click', function (e) { if (e.target === sheet) closeSheet(sheet); });
    })(sheets[i]);
  }
}

/* ----------------------------------------------------------------- the wiring */

function wire() {
  $('placeBtn').addEventListener('click', function () {
    $('placeOut').textContent = '';
    $('placeResults').innerHTML = '';
    $('placeQuery').value = '';
    openSheet($('placeSheet'));
    setTimeout(function () { $('placeQuery').focus(); }, 60);
  });

  $('placeForm').addEventListener('submit', function (e) {
    e.preventDefault();
    searchPlaces($('placeQuery').value.trim());
  });

  $('hereBtn').addEventListener('click', function () { useHere($('placeOut')); });
  $('useHereBtn').addEventListener('click', function () { useHere($('setupOut')); });
  $('searchPlaceBtn').addEventListener('click', function () { $('placeBtn').click(); });

  $('settingsBtn').addEventListener('click', function () {
    syncSettingsForm();
    openSheet($('settingsSheet'));
  });

  $('aboutBtn').addEventListener('click', function () { openSheet($('aboutSheet')); });

  $('refreshBtn').addEventListener('click', function () { refresh(true); });

  $('wentBtn').addEventListener('click', function () {
    var pick = S.headline(windows);
    state.outings.push({ at: Math.floor(Date.now() / 1000), activity: pick ? pick.activity : 'walk' });
    if (state.outings.length > 400) state.outings = state.outings.slice(-400);
    save();
    render();
  });

  /* "Not today" is a snooze rather than a switch: it is the answer to this
     afternoon's weather, not to the idea of going outside, so it lapses at
     midnight where the weather is. */
  $('notTodayBtn').addEventListener('click', function () {
    var now = Math.floor(Date.now() / 1000);
    var offset = forecast ? forecast.offset : 0;
    state.snoozeUntil = (S.dayOf(now, offset) + 1) * 86400 - offset;
    save();
    render();
  });

  $('askBtn').addEventListener('click', function () {
    askPermission().then(function () { state.asked = true; save(); render(); });
  });
  $('askNoBtn').addEventListener('click', function () {
    state.asked = true; save(); render();
  });

  $('notifyOn').addEventListener('change', function () {
    if ($('notifyOn').checked) {
      askPermission().then(function () { syncSettingsForm(); });
    } else {
      state.notify = false;
      save();
      syncSettingsForm();
    }
  });

  var radios = document.querySelectorAll('input[name="fuss"]');
  for (var i = 0; i < radios.length; i++) {
    radios[i].addEventListener('change', function (e) {
      state.fuss = e.target.value;
      save();
      render();
    });
  }

  $('leadSel').addEventListener('change', function () { state.lead = Number($('leadSel').value); save(); });
  $('maxSel').addEventListener('change', function () { state.maxPerDay = Number($('maxSel').value); save(); });
  $('quietFrom').addEventListener('change', function () { state.quiet.from = Number($('quietFrom').value); save(); });
  $('quietTo').addEventListener('change', function () { state.quiet.to = Number($('quietTo').value); save(); });
  $('unitsSel').addEventListener('change', function () { state.units = $('unitsSel').value; save(); render(); });
  $('clockSel').addEventListener('change', function () { state.ampm = $('clockSel').value === '12'; save(); render(); });

  /* A test nudge sends the real thing about the real next window where there
     is one, because a fake one proves nothing about whether they arrive. */
  $('testNudge').addEventListener('click', function () {
    var out = $('testOut');
    if (!('Notification' in self)) { out.textContent = 'This browser has no notifications.'; return; }
    if (Notification.permission !== 'granted') {
      askPermission().then(function (r) {
        out.textContent = r === 'granted' ? 'Allowed. Try again.' : 'Not allowed.';
        syncSettingsForm();
      });
      return;
    }
    var now = Math.floor(Date.now() / 1000);
    var win = forecast ? S.headline(S.allWindows(forecast, state, now)) : null;
    if (win) {
      var note = S.notificationFor(win, forecast, state, S.streak(state.outings, forecast.offset, now), now);
      show(note);
      out.textContent = 'Sent — that is the next real one.';
    } else {
      show({
        title: 'Step Out',
        body: 'This is what a nudge looks like. There is no window to send you out into just now.',
        tag: 'step-out'
      });
      out.textContent = 'Sent.';
    }
  });

  $('exportBtn').addEventListener('click', function () {
    var blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'step-out.json';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
  });

  $('importBtn').addEventListener('click', function () { $('importFile').click(); });
  $('importFile').addEventListener('change', function () {
    var file = $('importFile').files[0];
    if (!file) return;
    file.text().then(function (text) {
      var incoming = JSON.parse(text);
      state = Object.assign(defaults(), incoming);
      forecast = state.cache || null;
      save();
      buildActivityPicks();
      syncSettingsForm();
      render();
      refresh(true);
    }).catch(function () { alert('That file is not a Step Out export.'); });
  });

  $('resetBtn').addEventListener('click', function () {
    if (!confirm('Erase the place, the settings and every day you have logged?')) return;
    try { localStorage.removeItem(STORE_KEY); } catch (e) {}
    log = S.emptyLog();
    saveLog();
    state = defaults();
    forecast = null;
    save();
    buildActivityPicks();
    syncSettingsForm();
    render();
  });

  $('updateBtn').addEventListener('click', function () {
    var out = $('updateOut');
    out.textContent = 'Fetching…';
    var done = caches && caches.keys ? caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) { return caches.delete(k); }));
    }) : Promise.resolve();
    done.then(function () {
      return navigator.serviceWorker ? navigator.serviceWorker.getRegistrations() : [];
    }).then(function (regs) {
      return Promise.all((regs || []).map(function (r) { return r.unregister(); }));
    }).then(function () { location.reload(true); })
      .catch(function () { out.textContent = 'Could not. Check the signal.'; });
  });

  /* Coming back to the app is the moment its answer is most likely to be
     stale, and the moment somebody is most likely to act on it. */
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') { render(); refresh(false); }
  });
  window.addEventListener('online', function () { refresh(true); });

  setInterval(function () {
    render();
    refresh(false);
    checkNudge();
  }, TICK_MS);
}

/* ------------------------------------------------------------------- start */

load();
wireSheets();
buildHourSelects();
buildActivityPicks();
syncSettingsForm();
wire();
render();
publish();

loadLog().then(function () {
  render();
  return refresh(false);
}).then(function () {
  checkNudge();
});

if (state.notify) {
  registerPeriodic().then(function (ok) { periodicKnown = ok; syncSettingsForm(); });
} else {
  periodicKnown = null;
}

/* -------------------------------------------------------- the service worker */

if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('sw.js').catch(function (e) { console.warn('sw', e); });

    /* A new worker taking over means the files under it have changed, so the
       page reloads once to be the new app rather than the old one running
       against new files. Not on the first visit, where a worker takes over a
       page that had none and nothing has actually changed. */
    var hadWorker = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (!hadWorker) return;
      if (sessionStorage.getItem('stepOut.reloaded')) return;
      try { sessionStorage.setItem('stepOut.reloaded', '1'); } catch (e) { return; }
      location.reload();
    });

    /* The worker tells the page when it has sent something, so an app opened
       straight after a nudge does not consider sending it again. */
    navigator.serviceWorker.addEventListener('message', function (e) {
      if (e.data && e.data.type === 'nudged') {
        loadLog().then(render);
      }
    });
  });
}
