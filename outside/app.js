/* Bloody Weather — the screen.

   One job: say what the weather is doing, accurately, and be funny about it.
   The numbers come from weather.js and the mouth comes from voice.js; this
   file is where the place comes from, what gets drawn, and what the buttons
   do.

   There is no scoring, no scheduling and nothing to nag you about. If the app
   ever tells you what to do with your afternoon, something has gone wrong. */

var W = self.Weather;
var V = self.Voice;
var BRAND = self.Brand;
var $ = function (id) { return document.getElementById(id); };

/* Printed in Settings so a phone can say which copy it is running. Bump it,
   the ?v= on every script and the stylesheet, and the cache name in sw.js
   together on a release. */
var BUILD = '2026-08-28 · 3';

var STORE_KEY = 'bloodyWeather.v1';

/* A forecast older than this is refetched in the background when the app is
   opened or comes back to the front. */
var STALE_MS = 15 * 60 * 1000;
var TICK_MS = 5 * 60 * 1000;

var state = null;
var forecast = null;
var fetching = false;
var lastError = '';

/* ------------------------------------------------------------------- state */

function defaults() {
  return {
    v: 1,
    place: null,
    units: 'metric',
    ampm: false,
    /* On, because that is the app. The toggle is in Settings, and turning it
       off swaps in lines written to be funny rather than lines with a hole
       where the swearing was. */
    sweary: true,
    cache: null
  };
}

function load() {
  /* A phone that had the app this one replaced is still carrying its saved
     state around. It means nothing here, so it goes. */
  try { localStorage.removeItem('stepOut.v1'); } catch (e) {}

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
  }
  if (state.cache) forecast = state.cache;
}

function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* full or private */ }
}

/* --------------------------------------------------------------- the place */

function useHere(outEl) {
  if (!navigator.geolocation) {
    if (outEl) outEl.textContent = 'This browser will not say where it is. Search for a town instead.';
    return;
  }
  if (outEl) outEl.textContent = 'Asking the phone where it is…';
  navigator.geolocation.getCurrentPosition(function (pos) {
    setPlace({
      name: 'Where you are',
      lat: Math.round(pos.coords.latitude * 10000) / 10000,
      lon: Math.round(pos.coords.longitude * 10000) / 10000
    });
    if (outEl) outEl.textContent = '';
    closeSheet($('placeSheet'));
  }, function (err) {
    if (outEl) {
      outEl.textContent = err && err.code === 1
        ? 'Location is switched off for this app. Search for a town instead.'
        : 'Could not work out where you are. Search for a town instead.';
    }
  }, { enableHighAccuracy: false, timeout: 12000, maximumAge: 10 * 60 * 1000 });
}

function setPlace(place) {
  state.place = place;
  state.cache = null;
  forecast = null;
  lastError = '';
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
  fetch(W.searchUrl(query)).then(function (r) {
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
  return fetch(W.forecastUrl(state.place, W.DAYS)).then(function (r) {
    if (!r.ok) throw new Error('the forecast service answered ' + r.status);
    return r.json();
  }).then(function (json) {
    forecast = W.parse(json, state.place);
    state.cache = forecast;
    lastError = '';
    save();
    fetching = false;
    render();
  }).catch(function (err) {
    fetching = false;
    /* The message is kept for the small print. The funny line is chosen by
       voice.js, and the app never pretends a failure is a forecast. */
    lastError = String((err && err.message) || err);
    render();
  });
}

/* ------------------------------------------------------------- the drawing */

function render() {
  var now = Math.floor(Date.now() / 1000);

  document.title = BRAND.pick(state.sweary);
  $('placeName').textContent = state.place ? state.place.name : 'Pick a place';
  $('setup').hidden = !!state.place;
  $('setupTitle').textContent = state.place ? '' : V.noPlace(state);

  var have = !!(state.place && forecast);
  $('hero').hidden = !have;
  $('stripCard').hidden = !have;
  $('daysCard').hidden = !have;
  $('moments').hidden = true;
  /* Trouble only shows when there is nothing to show instead. With a cached
     forecast the footer says it is old and the weather still gets drawn. */
  $('trouble').hidden = !(state.place && !forecast && lastError);

  if ($('trouble').hidden === false) {
    $('troubleLine').textContent = V.error(state, Math.floor(now / 600));
    $('troubleWhy').textContent = 'It said: ' + lastError;
  }

  if (!have) { renderFoot(now); return; }

  renderHero(now);
  renderMoments(now);
  renderHours(now);
  renderDays(now);
  renderFoot(now);
}

function renderHero(now) {
  var n = W.now(forecast, now);
  var head = V.headline(forecast, state, now);

  $('shout').textContent = head.text;
  $('nowTemp').textContent = Math.round(state.units === 'imperial' ? n.temp * 9 / 5 + 32 : n.temp);
  $('nowUnit').textContent = W.tempUnit(state.units);
  $('nowIcon').textContent = W.icon({
    code: n.code, feels: n.feels, mm: n.mm, prob: n.prob, gust: n.gust, day: n.day
  });
  $('nowSub').textContent = V.subline(forecast, state, now);

  var today = forecast.days[W.todayIndex(forecast, now)];
  var facts = $('facts');
  facts.innerHTML = '';
  fact(facts, '🌡️', 'Feels like', W.temp(n.feels, state.units));
  fact(facts, '☔', 'Rain', (n.prob || 0) + '%');
  fact(facts, '💨', 'Wind', W.speed(n.wind, state.units));
  fact(facts, '🌬️', 'Gusts', W.speed(n.gust, state.units));
  fact(facts, '💧', 'Humidity', Math.round(n.humidity) + '%');
  if (n.visibility) fact(facts, '👁️', 'Visibility', W.distance(n.visibility, state.units));
  if (today) {
    fact(facts, '🌅', 'Sunrise', W.clock(today.sunrise, forecast.offset, state.ampm));
    fact(facts, '🌇', 'Sunset', W.clock(today.sunset, forecast.offset, state.ampm));
    fact(facts, '🔺', 'High', W.temp(today.max, state.units));
    fact(facts, '🔻', 'Low', W.temp(today.min, state.units));
  }
}

function fact(parent, icon, label, value) {
  var el = document.createElement('div');
  el.className = 'fact';
  el.innerHTML = '<span class="fact-icon" aria-hidden="true"></span>' +
    '<span class="fact-body"><span class="fact-label"></span><span class="fact-value"></span></span>';
  el.querySelector('.fact-icon').textContent = icon;
  el.querySelector('.fact-label').textContent = label;
  el.querySelector('.fact-value').textContent = value;
  parent.appendChild(el);
}

function renderMoments(now) {
  var wrap = $('moments');
  wrap.innerHTML = '';
  var list = V.moments(forecast, state, now);
  wrap.hidden = !list.length;
  list.forEach(function (m) {
    var el = document.createElement('div');
    el.className = 'moment';
    el.innerHTML = '<span class="moment-icon" aria-hidden="true"></span><span class="moment-text"></span>';
    el.querySelector('.moment-icon').textContent = m.icon;
    el.querySelector('.moment-text').textContent = m.text;
    wrap.appendChild(el);
  });
}

function renderHours(now) {
  var wrap = $('hours');
  wrap.innerHTML = '';
  var hours = W.hoursFrom(forecast, now, 24);
  var temps = hours.map(function (h) { return h.temp; });
  var lo = Math.min.apply(null, temps), hi = Math.max.apply(null, temps);
  var span = Math.max(1, hi - lo);

  hours.forEach(function (h, i) {
    var col = document.createElement('div');
    col.className = 'hr' + (h.day ? '' : ' night');
    var label = i === 0 ? 'Now' : W.clock(h.t, forecast.offset, state.ampm).replace(':00', '');

    col.innerHTML =
      '<span class="hr-time"></span>' +
      '<span class="hr-icon" aria-hidden="true"></span>' +
      '<span class="hr-temp"></span>' +
      '<span class="hr-rain"></span>';
    col.querySelector('.hr-time').textContent = label;
    col.querySelector('.hr-icon').textContent = W.icon(h);
    col.querySelector('.hr-temp').textContent = W.temp(h.temp, state.units);
    /* The temperature line: each hour sits at its own height within the day's
       range, so the shape of the day is visible without a chart. */
    col.querySelector('.hr-temp').style.transform =
      'translateY(' + Math.round((hi - h.temp) / span * 12) + 'px)';
    var rain = col.querySelector('.hr-rain');
    rain.textContent = h.prob >= 15 ? h.prob + '%' : '';
    if (h.prob >= 50) rain.classList.add('wet');
    wrap.appendChild(col);
  });

  var wettest = hours.reduce(function (a, h) { return h.prob > a ? h.prob : a; }, 0);
  $('stripHint').textContent = wettest >= 40
    ? 'Wettest hour: ' + wettest + '%'
    : (wettest > 0 ? 'Nothing much doing' : 'Dry throughout');
}

/* Fifteen days, and honest about which of them it actually knows. */
function renderDays(now) {
  var list = $('dayList');
  list.innerHTML = '';
  var start = W.todayIndex(forecast, now);
  var shown = 0;
  var lastTier = null;

  for (var i = start; i < forecast.days.length && shown < 15; i++, shown++) {
    var day = forecast.days[i];
    var conf = W.confidence(shown);
    if (conf.tier !== lastTier) {
      list.appendChild(tierRow(conf.tier));
      lastTier = conf.tier;
    }
    list.appendChild(dayRow(day, shown, conf, now));
  }
}

function tierRow(tier) {
  var li = document.createElement('li');
  li.className = 'tier';
  li.textContent = tier === 'near' ? 'The next few days'
    : (tier === 'mid' ? 'Later this week' : 'Long range — the shape of it');
  return li;
}

function dayRow(day, index, conf, now) {
  var li = document.createElement('li');
  li.className = 'day day--' + conf.tier;

  var btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'day-btn';
  btn.innerHTML =
    '<span class="day-when"><b></b><small></small></span>' +
    '<span class="day-icon" aria-hidden="true"></span>' +
    '<span class="day-line"></span>' +
    '<span class="day-rain"></span>' +
    '<span class="day-temps"><b></b><small></small></span>';

  btn.querySelector('.day-when b').textContent =
    index === 0 ? 'Today' : (index === 1 ? 'Tomorrow' : W.dayShort(day.t, forecast.offset));
  btn.querySelector('.day-when small').textContent = W.dayDate(day.t, forecast.offset);
  btn.querySelector('.day-icon').textContent = W.dayIcon(day);
  btn.querySelector('.day-line').textContent = V.dayLine(day, state);
  /* A missing probability is drawn as a dash rather than as nought per cent:
     the long range does not know, and saying "0%" would be a lie. */
  btn.querySelector('.day-rain').textContent = day.prob === null ? '—' : day.prob + '%';
  if (day.prob !== null && day.prob >= 50) btn.querySelector('.day-rain').classList.add('wet');
  btn.querySelector('.day-temps b').textContent = W.temp(day.max, state.units);
  btn.querySelector('.day-temps small').textContent = W.temp(day.min, state.units);

  btn.addEventListener('click', function () { openDay(day, index, conf, now); });
  li.appendChild(btn);
  return li;
}

function openDay(day, index, conf, now) {
  $('dayTitle').textContent = index === 0 ? 'Today'
    : (index === 1 ? 'Tomorrow' : W.dayName(day.t, forecast.offset) + ' ' + W.dayDate(day.t, forecast.offset));
  $('dayShout').textContent = V.dayLine(day, state);

  var facts = $('dayFacts');
  facts.innerHTML = '';
  fact(facts, W.dayIcon(day), 'Sky', W.skyName(day.code));
  fact(facts, '🔺', 'High', W.temp(day.max, state.units));
  fact(facts, '🔻', 'Low', W.temp(day.min, state.units));
  if (day.feelsMax !== null) fact(facts, '🌡️', 'Feels up to', W.temp(day.feelsMax, state.units));
  fact(facts, '☔', 'Rain', day.prob === null ? 'Not known yet' : day.prob + '%');
  if (day.mm !== null) fact(facts, '💧', 'Total', Math.round(day.mm * 10) / 10 + ' mm');
  if (day.wind !== null) fact(facts, '💨', 'Wind', W.speed(day.wind, state.units));
  if (day.gust !== null) fact(facts, '🌬️', 'Gusts', W.speed(day.gust, state.units));
  fact(facts, '🌅', 'Sunrise', W.clock(day.sunrise, forecast.offset, state.ampm));
  fact(facts, '🌇', 'Sunset', W.clock(day.sunset, forecast.offset, state.ampm));

  /* Hour by hour only where there is an hourly forecast to show — the near
     days. Further out the app has days and says so. */
  var hoursBox = $('dayHours');
  hoursBox.innerHTML = '';
  var dayKey = W.dayOf(day.t, forecast.offset);
  var hours = forecast.hours.filter(function (h) {
    return W.dayOf(h.t, forecast.offset) === dayKey && h.t + 3600 > now;
  });
  if (hours.length && conf.tier === 'near') {
    var strip = document.createElement('div');
    strip.className = 'hours hours--sheet';
    hours.forEach(function (h) {
      var col = document.createElement('div');
      col.className = 'hr' + (h.day ? '' : ' night');
      col.innerHTML = '<span class="hr-time"></span><span class="hr-icon"></span>' +
        '<span class="hr-temp"></span><span class="hr-rain"></span>';
      col.querySelector('.hr-time').textContent = W.clock(h.t, forecast.offset, state.ampm).replace(':00', '');
      col.querySelector('.hr-icon').textContent = W.icon(h);
      col.querySelector('.hr-temp').textContent = W.temp(h.temp, state.units);
      col.querySelector('.hr-rain').textContent = h.prob >= 15 ? h.prob + '%' : '';
      strip.appendChild(col);
    });
    hoursBox.appendChild(strip);
  }

  $('dayConfidence').textContent = conf.tier === 'near'
    ? conf.label + ' — this close, the forecast is worth planning around.'
    : (conf.tier === 'mid'
      ? conf.label + ' — the shape is reliable, the details will move.'
      : conf.label + ' — this far out, treat it as the mood rather than the detail.');

  openSheet($('daySheet'));
}

function renderFoot(now) {
  var bits = [];
  if (fetching) bits.push('Checking…');
  else if (forecast) {
    var age = Math.round((Date.now() / 1000 - forecast.fetchedAt) / 60);
    bits.push(age < 1 ? 'Just now' : (age < 60 ? age + ' min ago' : Math.round(age / 60) + ' h ago'));
  }
  /* A cached forecast is always labelled as one. */
  if (lastError && forecast) bits.push('saved copy — could not reach the weather');
  $('footStatus').textContent = bits.join(' · ');
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
      sheet.addEventListener('click', function (e) { if (e.target === sheet) closeSheet(sheet); });
    })(sheets[i]);
  }
}

function syncSettings() {
  $('swearyOn').checked = !!state.sweary;
  $('unitsSel').value = state.units;
  $('clockSel').value = state.ampm ? '12' : '24';
  $('buildHint').textContent = 'Build ' + BUILD;
  $('aboutBuild').textContent = 'Build ' + BUILD;
  $('aboutTitle').textContent = BRAND.pick(state.sweary);
  $('aboutTagline').textContent = BRAND.tagline;
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

  $('settingsBtn').addEventListener('click', function () { syncSettings(); openSheet($('settingsSheet')); });
  $('aboutBtn').addEventListener('click', function () { syncSettings(); openSheet($('aboutSheet')); });
  $('retryBtn').addEventListener('click', function () { refresh(true); });
  $('refreshBtn').addEventListener('click', function () { refresh(true); });

  $('swearyOn').addEventListener('change', function () {
    state.sweary = $('swearyOn').checked;
    save();
    render();
    syncSettings();
  });
  $('unitsSel').addEventListener('change', function () {
    state.units = $('unitsSel').value;
    save();
    render();
  });
  $('clockSel').addEventListener('change', function () {
    state.ampm = $('clockSel').value === '12';
    save();
    render();
  });

  $('resetBtn').addEventListener('click', function () {
    if (!confirm('Erase the place and the settings on this phone?')) return;
    try { localStorage.removeItem(STORE_KEY); } catch (e) {}
    state = defaults();
    forecast = null;
    lastError = '';
    save();
    syncSettings();
    render();
  });

  $('updateBtn').addEventListener('click', function () {
    var out = $('updateOut');
    out.textContent = 'Fetching…';
    var done = (self.caches && caches.keys) ? caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) { return caches.delete(k); }));
    }) : Promise.resolve();
    done.then(function () {
      return navigator.serviceWorker ? navigator.serviceWorker.getRegistrations() : [];
    }).then(function (regs) {
      return Promise.all((regs || []).map(function (r) { return r.unregister(); }));
    }).then(function () { location.reload(true); })
      .catch(function () { out.textContent = 'Could not. Check the signal.'; });
  });

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') { render(); refresh(false); }
  });
  window.addEventListener('online', function () { refresh(true); });

  setInterval(function () { render(); refresh(false); }, TICK_MS);
}

/* ------------------------------------------------------------------- start */

load();
wireSheets();
wire();
syncSettings();
render();
refresh(false);

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
      if (sessionStorage.getItem('bloodyWeather.reloaded')) return;
      try { sessionStorage.setItem('bloodyWeather.reloaded', '1'); } catch (e) { return; }
      location.reload();
    });
  });
}
