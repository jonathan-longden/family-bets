/* Fucking Weather — the screen.

   One job: say what the weather is doing, accurately, and be funny about it.
   The numbers come from weather.js and the mouth from voice.js; this file is
   where the place comes from, what gets drawn, and what the buttons do.

   The order on screen is the product in one line: what it is doing now, what
   the app thinks of that, the numbers, the next 24 hours, today, tomorrow,
   fifteen days. The weather is always the thing; the joke is always on top of
   it, never instead of it.

   There is no scoring, no scheduling and nothing to nag anybody about. */

var W = self.Weather;
var V = self.Voice;
var BRAND = self.Brand;
var N = self.Native;
var $ = function (id) { return document.getElementById(id); };

/* Printed in Settings so a phone can say which copy it is running — and the
   same numbers the two app stores see, because they all come from
   app.config.json. On a release bump the version there, then the ?v= on every
   script and the stylesheet and the cache name in sw.js, which the release
   notes in mobile/README.md walk through. */
var BUILD = BRAND.version + ' (' + BRAND.build + ')' + (N.is ? ' · ' + N.platform : '');

/* Deliberately not named after the brand: the name is the thing most likely to
   change, and nobody's saved location should change with it. */
var STORE_KEY = 'weatherApp.v1';
var OLD_KEYS = ['stepOut.v1', 'bloodyWeather.v1'];

var STALE_MS = 15 * 60 * 1000;
var TICK_MS = 5 * 60 * 1000;

var state = null;
var forecast = null;
var fetching = false;
var lastError = '';
var changeLines = [];

/* ------------------------------------------------------------------- state */

function defaults() {
  return {
    v: 1,
    place: null,
    units: 'metric',
    ampm: false,
    /* On, because that is the app. */
    sweary: true,
    animate: true,
    /* The temperature on the app icon itself. Not a widget, but it is a number
       on the home screen without opening anything. */
    badge: true,
    /* Whether the location explainer has been through once. It is an
       explanation, not a reminder — showing it twice would make it nagging. */
    asked: false,
    cache: null,
    /* A small summary of the forecast before this one, so the app can say what
       has actually changed rather than guess. */
    previous: null
  };
}

function load() {
  state = defaults();
  var raw = null;
  try { raw = localStorage.getItem(STORE_KEY); } catch (e) { raw = null; }

  /* A phone that had an earlier version of this app is carrying its saved
     state around. Take the location out of it — that is worth keeping — and
     bin the rest. */
  if (!raw) {
    for (var i = 0; i < OLD_KEYS.length; i++) {
      try {
        var old = JSON.parse(localStorage.getItem(OLD_KEYS[i]) || 'null');
        if (old && old.place) {
          state.place = old.place;
          if (old.units) state.units = old.units;
          if (typeof old.ampm === 'boolean') state.ampm = old.ampm;
          if (typeof old.sweary === 'boolean') state.sweary = old.sweary;
          break;
        }
      } catch (e) { /* nothing worth keeping */ }
    }
  }
  OLD_KEYS.forEach(function (k) { try { localStorage.removeItem(k); } catch (e) {} });

  var saved = null;
  if (raw) { try { saved = JSON.parse(raw); } catch (e) { saved = null; } }
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

/* Where the answer goes when the location request finishes. Set by askHere()
   so the explainer's own button knows which screen asked. */
var askOut = null;

/* Tapping "use where I am" never raises the operating system's prompt on the
   spot. It explains first, in the app's own words, and only asks the phone
   once somebody has said yes to the explanation. A prompt that arrives with a
   reason attached is one a person can actually answer.

   The explanation is shown once per install, not every time: after the phone
   has granted or refused, asking again would be nagging. */
function askHere(outEl) {
  askOut = outEl || null;
  if (outEl) outEl.textContent = '';
  if (state.asked) return useHere(outEl);
  openSheet($('askSheet'));
}

function useHere(outEl) {
  state.asked = true;
  save();
  if (outEl) outEl.textContent = 'Asking the phone where it is…';

  N.locate().then(function (where) {
    setPlace({ name: 'Where you are', lat: where.lat, lon: where.lon });
    if (outEl) outEl.textContent = '';
    closeSheet($('placeSheet'));
  }, function (err) {
    if (!outEl) return;
    /* Three different failures, three different things to do about them, so
       they get three different sentences rather than one shrug. */
    if (err && err.code === 0) {
      outEl.textContent = 'This device will not say where it is. Search for a town instead.';
    } else if (err && err.code === 1) {
      outEl.textContent = 'No location, then — that is fine. Search for a town instead.';
    } else {
      outEl.textContent = 'Could not work out where you are. Search for a town instead.';
    }
  });
}

function setPlace(place) {
  state.place = place;
  state.cache = null;
  /* A new place makes the old forecast's memory meaningless. */
  state.previous = null;
  forecast = null;
  lastError = '';
  changeLines = [];
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
    var next = W.parse(json, state.place);
    var now = Math.floor(Date.now() / 1000);

    /* What has changed since the last one this phone saw. Nothing is claimed
       when there is nothing to compare against. */
    changeLines = V.changeLines(W.changes(state.previous, next, now), state);
    if (!state.previous || next.fetchedAt - state.previous.at >= 3600) {
      state.previous = W.snapshot(next);
    }

    forecast = next;
    state.cache = forecast;
    lastError = '';
    save();
    fetching = false;
    render();
  }).catch(function (err) {
    fetching = false;
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
  if (!state.place) $('setupTitle').textContent = V.noPlace(state);

  var have = !!(state.place && forecast);
  ['hero', 'briefCard', 'factCard', 'stripCard', 'todayCard', 'tomorrowCard', 'daysCard'].forEach(function (id) {
    $(id).hidden = !have;
  });
  $('shareBtn').hidden = !have;
  $('trouble').hidden = !(state.place && !forecast && lastError);

  if (!$('trouble').hidden) {
    $('troubleLine').textContent = V.error(state, Math.floor(now / 600));
    $('troubleWhy').textContent = 'It said: ' + lastError;
  }

  if (!have) {
    $('alerts').hidden = true;
    $('moments').hidden = true;
    renderFoot(now);
    paintSky(null);
    updateBadge();
    return;
  }

  renderHero(now);
  renderAlerts(now);
  renderMoments(now);
  renderBrief(now);
  renderFacts(now);
  renderHours(now);
  renderToday(now);
  renderTomorrow(now);
  renderDays(now);
  renderFoot(now);
  paintSky(W.now(forecast, now));
  updateBadge();
}

function renderHero(now) {
  var n = W.now(forecast, now);
  $('nowTemp').textContent = Math.round(state.units === 'imperial' ? n.temp * 9 / 5 + 32 : n.temp);
  $('nowUnit').textContent = W.tempUnit(state.units);
  $('nowFeels').textContent = 'Feels like ' + W.temp(n.feels, state.units);
  $('nowIcon').textContent = W.icon({
    code: n.code, feels: n.feels, mm: n.mm, prob: n.prob, gust: n.gust, day: n.day
  });
  $('nowCond').textContent = W.skyName(n.code);
  $('shout').textContent = V.headline(forecast, state, now).text;
}

/* Warnings are factual and never a punchline. The lead-in is allowed a bit of
   personality; the sentence under it is not. */
function renderAlerts(now) {
  var wrap = $('alerts');
  wrap.innerHTML = '';
  var list = W.alerts(forecast, now);
  wrap.hidden = !list.length;
  list.forEach(function (a) {
    var el = document.createElement('div');
    el.className = 'alert alert--' + a.kind;
    el.innerHTML = '<div class="alert-head"><span aria-hidden="true">⚠️</span><b></b></div>' +
      '<div class="alert-title"></div><p class="alert-detail"></p>';
    el.querySelector('.alert-head b').textContent = V.alertHead(a, state);
    el.querySelector('.alert-title').textContent = a.title;
    el.querySelector('.alert-detail').textContent = a.detail;
    wrap.appendChild(el);
  });
}

function renderMoments(now) {
  var wrap = $('moments');
  wrap.innerHTML = '';
  /* Real changes since the last forecast come first — they are the newest
     thing the app knows — then the standing observations.

     Tomorrow has a whole card to itself further down, so a moment saying the
     same thing is dropped rather than shown twice. */
  var moments = V.moments(forecast, state, now).filter(function (m) {
    return m.key !== 'betterTomorrow' && m.key !== 'worseTomorrow';
  });
  var list = changeLines.concat(moments).slice(0, 3);
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

function renderBrief(now) {
  $('briefText').textContent = V.brief(forecast, state, now);
  $('moodText').textContent = V.mood(forecast, state, now).text;
}

function renderFacts(now) {
  var n = W.now(forecast, now);
  var today = forecast.days[W.todayIndex(forecast, now)];
  var facts = $('facts');
  facts.innerHTML = '';
  fact(facts, '🌡️', 'Feels like', W.temp(n.feels, state.units));
  fact(facts, '☔', 'Rain chance', (n.prob || 0) + '%');
  fact(facts, '🌧️', 'Rain so far', Math.round((n.mm || 0) * 10) / 10 + ' mm');
  fact(facts, '💨', 'Wind', W.speed(n.wind, state.units));
  fact(facts, '🌬️', 'Gusts', W.speed(n.gust, state.units));
  fact(facts, '💧', 'Humidity', Math.round(n.humidity) + '%');
  if (n.visibility) fact(facts, '👁️', 'Visibility', W.distance(n.visibility, state.units));
  if (today) {
    fact(facts, '🔺', 'High', W.temp(today.max, state.units));
    fact(facts, '🔻', 'Low', W.temp(today.min, state.units));
    fact(facts, '🌅', 'Sunrise', W.clock(today.sunrise, forecast.offset, state.ampm));
    fact(facts, '🌇', 'Sunset', W.clock(today.sunset, forecast.offset, state.ampm));
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

/* The next 24 hours, then the moments in them where the weather changes its
   mind — which is the bit people actually plan around. */
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
    col.setAttribute('role', 'listitem');
    var label = i === 0 ? 'Now' : W.clock(h.t, forecast.offset, state.ampm).replace(':00', '');
    col.innerHTML = '<span class="hr-time"></span><span class="hr-icon" aria-hidden="true"></span>' +
      '<span class="hr-temp"></span><span class="hr-rain"></span>';
    col.querySelector('.hr-time').textContent = label;
    col.querySelector('.hr-icon').textContent = W.icon(h);
    var temp = col.querySelector('.hr-temp');
    temp.textContent = W.temp(h.temp, state.units);
    /* The shape of the day, without a chart: each hour sits at its own height
       inside the day's range. */
    temp.style.transform = 'translateY(' + Math.round((hi - h.temp) / span * 12) + 'px)';
    var rain = col.querySelector('.hr-rain');
    rain.textContent = h.prob >= 15 ? h.prob + '%' : '';
    if (h.prob >= 50) rain.classList.add('wet');
    /* Screen readers get the whole hour as one sentence rather than four
       orphaned fragments. */
    col.setAttribute('aria-label', label + ': ' + W.skyName(h.code) + ', ' +
      W.temp(h.temp, state.units) + ', ' + (h.prob || 0) + '% chance of rain');
    wrap.appendChild(col);
  });

  var wettest = hours.reduce(function (a, h) { return Math.max(a, h.prob || 0); }, 0);
  $('stripHint').textContent = wettest >= 40 ? 'Wettest hour: ' + wettest + '%'
    : (wettest > 0 ? 'Nothing much doing' : 'Dry throughout');

  var line = $('timeline');
  line.innerHTML = '';
  var moves = W.transitions(forecast, now, 24).slice(0, 4);
  moves.forEach(function (m) {
    var li = document.createElement('li');
    li.className = 'move move--' + m.kind;
    li.innerHTML = '<span class="move-dot" aria-hidden="true"></span><b></b><span></span>';
    li.querySelector('b').textContent = W.clock(m.t, forecast.offset, state.ampm);
    li.querySelector('span:last-child').textContent = m.text;
    line.appendChild(li);
  });
  if (!moves.length) {
    var li2 = document.createElement('li');
    li2.className = 'move move--steady';
    li2.innerHTML = '<span class="move-dot" aria-hidden="true"></span><b>Steady</b><span>No real change in the next 24 hours</span>';
    line.appendChild(li2);
  }
}

/* The best and worst moments of what is left of today. */
function renderToday(now) {
  var pair = V.bestWorst(forecast, state, now);
  $('todayCard').hidden = !pair;
  if (!pair) return;
  var bits = $('bits');
  bits.innerHTML = '';
  bit(bits, 'best', 'Best bit', pair.best.hour, pair.best.line);
  bit(bits, 'worst', 'Worst bit', pair.worst.hour, pair.worst.line);
}

function bit(parent, kind, label, hour, line) {
  var el = document.createElement('div');
  el.className = 'bit bit--' + kind;
  el.innerHTML = '<div class="bit-label"></div>' +
    '<div class="bit-when"><span class="bit-icon" aria-hidden="true"></span><b></b></div>' +
    '<div class="bit-facts"></div><div class="bit-line"></div>';
  el.querySelector('.bit-label').textContent = label;
  el.querySelector('.bit-icon').textContent = W.icon(hour);
  el.querySelector('.bit-when b').textContent = W.clock(hour.t, forecast.offset, state.ampm);
  el.querySelector('.bit-facts').textContent =
    W.temp(hour.temp, state.units) + ' · ' + W.skyName(hour.code) + ' · ' + (hour.prob || 0) + '% rain';
  el.querySelector('.bit-line').textContent = line;
  parent.appendChild(el);
}

function renderTomorrow(now) {
  var t = V.tomorrow(forecast, state, now);
  $('tomorrowCard').hidden = !t;
  if (!t) return;
  $('tomIcon').textContent = W.dayIcon(t.day);
  $('tomHigh').textContent = W.temp(t.day.max, state.units);
  $('tomLow').textContent = W.temp(t.day.min, state.units);
  $('tomCond').textContent = W.skyName(t.day.code);
  $('tomRain').textContent = t.day.prob === null ? 'Rain chance not known yet' : t.day.prob + '% chance of rain';
  $('tomLine').textContent = t.line;
}

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
      list.appendChild(tierRow(conf));
      lastTier = conf.tier;
    }
    list.appendChild(dayRow(day, shown, conf, now));
  }
}

function tierRow(conf) {
  var li = document.createElement('li');
  li.className = 'tier';
  li.textContent = conf.label;
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

  var name = index === 0 ? 'Today' : (index === 1 ? 'Tomorrow' : W.dayShort(day.t, forecast.offset));
  btn.querySelector('.day-when b').textContent = name;
  btn.querySelector('.day-when small').textContent = W.dayDate(day.t, forecast.offset);
  btn.querySelector('.day-icon').textContent = W.dayIcon(day);
  btn.querySelector('.day-line').textContent = V.dayLine(day, state);
  /* A missing probability is a dash, not a nought: the long range does not
     know, and "0%" would be a lie. */
  btn.querySelector('.day-rain').textContent = day.prob === null ? '—' : day.prob + '%';
  if (day.prob !== null && day.prob >= 50) btn.querySelector('.day-rain').classList.add('wet');
  btn.querySelector('.day-temps b').textContent = W.temp(day.max, state.units);
  btn.querySelector('.day-temps small').textContent = W.temp(day.min, state.units);
  btn.setAttribute('aria-label', name + ': ' + W.skyName(day.code) + ', high ' +
    W.temp(day.max, state.units) + ', low ' + W.temp(day.min, state.units) + ', ' +
    (day.prob === null ? 'rain chance not known' : day.prob + '% chance of rain') + '. ' + conf.label + '.');

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
  fact(facts, '☔', 'Rain chance', day.prob === null ? 'Not known yet' : day.prob + '%');
  if (day.mm !== null) fact(facts, '🌧️', 'Rain total', Math.round(day.mm * 10) / 10 + ' mm');
  if (day.wind !== null) fact(facts, '💨', 'Wind', W.speed(day.wind, state.units));
  if (day.gust !== null) fact(facts, '🌬️', 'Gusts', W.speed(day.gust, state.units));
  fact(facts, '🌅', 'Sunrise', W.clock(day.sunrise, forecast.offset, state.ampm));
  fact(facts, '🌇', 'Sunset', W.clock(day.sunset, forecast.offset, state.ampm));

  var hoursBox = $('dayHours');
  hoursBox.innerHTML = '';
  var dayKey = W.dayOf(day.t, forecast.offset);
  var hours = W.hoursOfDay(forecast, dayKey).filter(function (h) { return h.t + 3600 > now; });
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
      : conf.label + ' — this far out, take it as the mood rather than the detail.');

  openSheet($('daySheet'));
}

function renderFoot(now) {
  var bits = [];
  if (fetching) bits.push('Checking…');
  else if (forecast) bits.push(ageText());
  if (lastError && forecast) bits.push('using the last forecast we managed to grab');
  $('footStatus').textContent = bits.join(' · ');
}

function ageText() {
  var age = Math.round((Date.now() / 1000 - forecast.fetchedAt) / 60);
  return age < 1 ? 'Updated just now' : (age < 60 ? 'Updated ' + age + ' min ago' : 'Updated ' + Math.round(age / 60) + ' h ago');
}

/* ------------------------------------------------------------- the app icon */

/* The closest a web app gets to a widget: the installed icon can carry a
   number, and the number worth carrying is the temperature.

   Two honesty rules, because a badge is read at a glance and believed
   completely. A forecast more than three hours old gets no badge rather than a
   stale one. And the API counts things — it cannot show a minus sign — so
   below zero the badge is cleared rather than showing "3" for minus three. */
var BADGE_STALE_MS = 3 * 60 * 60 * 1000;

function updateBadge() {
  if (!navigator.setAppBadge || !navigator.clearAppBadge) return;
  var drop = function () { navigator.clearAppBadge().catch(function () {}); };

  if (!state.badge || !state.place || !forecast) return drop();
  if (Date.now() - forecast.fetchedAt * 1000 > BADGE_STALE_MS) return drop();

  var n = W.now(forecast, Math.floor(Date.now() / 1000));
  var shown = Math.round(state.units === 'imperial' ? n.temp * 9 / 5 + 32 : n.temp);
  if (!isFinite(shown) || shown < 0) return drop();
  navigator.setAppBadge(shown).catch(function () {});
}

function badgeState() {
  /* The installed app from the two stores has no badge yet: iOS and Android
     both put the app icon's number behind a native call, and adding one means
     shipping a small piece of native code alongside the widget work rather
     than a web setting. Saying so beats a toggle that quietly does nothing. */
  if (N.is) {
    return 'Not in the ' + (N.platform === 'ios' ? 'iPhone' : 'Android') + ' app yet — it arrives ' +
      'with the home screen widget. Add the app to your home screen from the web and it works there.';
  }
  if (!navigator.setAppBadge) return 'This browser cannot put anything on the app icon.';
  return 'Works on the installed app. Below zero it clears itself — the icon can only carry a count, ' +
    'so it cannot show a minus sign, and half a temperature is worse than none.';
}

/* ---------------------------------------------------------------- the sky */

/* Decorative only, and cheap: a handful of absolutely-positioned elements
   animated by CSS transforms, which the compositor handles without waking the
   main thread. No canvas loop, no rAF, nothing running when the app is in the
   background. Switched off entirely by the setting or by reduced motion. */
function motionAllowed() {
  var reduced = self.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  return !!state.animate && !reduced;
}

var skyPainted = '';

function paintSky(now) {
  var box = $('sky');
  if (!now || !motionAllowed()) { box.innerHTML = ''; skyPainted = ''; box.className = 'sky'; return; }

  var fam = W.family(now.code);
  var kind = fam;
  if (fam === 'downpour' || fam === 'showers') kind = 'rain';
  if (fam === 'drizzle') kind = 'rain';
  if (!now.day && (fam === 'clear' || fam === 'cloud')) kind = 'night';
  if (fam === 'clear' && now.day) kind = 'sun';
  if (fam === 'grey' || fam === 'cloud' || fam === 'fog') kind = 'cloud';
  if (now.gust >= 55 && kind === 'cloud') kind = 'wind';

  /* Redrawing the same sky on every tick would restart every animation, so it
     is only rebuilt when the weather itself changes. */
  if (skyPainted === kind) return;
  skyPainted = kind;
  box.className = 'sky sky--' + kind;
  box.innerHTML = '';

  var make = function (cls, count, style) {
    for (var i = 0; i < count; i++) {
      var el = document.createElement('span');
      el.className = cls;
      style(el, i);
      box.appendChild(el);
    }
  };

  if (kind === 'sun') {
    make('ray', 1, function (el) { el.style.animationDuration = '9s'; });
  } else if (kind === 'cloud' || kind === 'wind') {
    make('drift', 3, function (el, i) {
      el.style.top = (6 + i * 13) + '%';
      el.style.animationDuration = (kind === 'wind' ? 26 - i * 5 : 62 - i * 9) + 's';
      el.style.animationDelay = (-i * 7) + 's';
      el.style.opacity = 0.16 - i * 0.03;
    });
  } else if (kind === 'rain') {
    make('drop', 14, function (el, i) {
      el.style.left = ((i * 7.3) % 100) + '%';
      el.style.animationDuration = (0.9 + (i % 4) * 0.22) + 's';
      el.style.animationDelay = (-(i % 7) * 0.31) + 's';
    });
  } else if (kind === 'snow') {
    make('flake', 12, function (el, i) {
      el.style.left = ((i * 8.7) % 100) + '%';
      el.style.animationDuration = (7 + (i % 5)) + 's';
      el.style.animationDelay = (-(i % 6) * 1.4) + 's';
    });
  } else if (kind === 'night') {
    make('star', 10, function (el, i) {
      el.style.left = ((i * 11.3) % 96) + '%';
      el.style.top = (4 + (i * 7) % 34) + '%';
      el.style.animationDuration = (3 + (i % 4)) + 's';
      el.style.animationDelay = (-(i % 5)) + 's';
    });
  } else if (kind === 'thunder') {
    make('drop', 10, function (el, i) {
      el.style.left = ((i * 9.7) % 100) + '%';
      el.style.animationDuration = (0.7 + (i % 3) * 0.15) + 's';
      el.style.animationDelay = (-(i % 5) * 0.2) + 's';
    });
    make('flash', 1, function (el) { el.style.animationDuration = '7s'; });
  }
}

/* -------------------------------------------------------------- the sharing */

/* A picture of today, drawn on a canvas so it can go into a message rather
   than a screenshot. The joke is on it, but so are the numbers — a card that
   says nothing about the weather is just a meme. */
function drawShareCard() {
  var canvas = $('shareCanvas');
  var ctx = canvas.getContext('2d');
  var now = Math.floor(Date.now() / 1000);
  var n = W.now(forecast, now);
  var today = forecast.days[W.todayIndex(forecast, now)];
  var head = V.headline(forecast, state, now).text;
  var w = canvas.width, h = canvas.height;

  var grad = ctx.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, '#123268');
  grad.addColorStop(0.55, '#0d1b3e');
  grad.addColorStop(1, '#081128');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  var glow = ctx.createRadialGradient(w * 0.78, h * 0.12, 20, w * 0.78, h * 0.12, w * 0.8);
  glow.addColorStop(0, 'rgba(255,203,61,0.34)');
  glow.addColorStop(1, 'rgba(255,203,61,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);

  ctx.textAlign = 'left';
  ctx.fillStyle = '#aebbdc';
  ctx.font = '600 44px ui-rounded, system-ui, sans-serif';
  ctx.fillText((state.place.name || '').toUpperCase(), 90, 170);

  ctx.fillStyle = '#ffffff';
  ctx.font = '800 250px ui-rounded, system-ui, sans-serif';
  var temp = Math.round(state.units === 'imperial' ? n.temp * 9 / 5 + 32 : n.temp) + '°';
  ctx.fillText(temp, 82, 420);

  ctx.font = '80px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(W.icon({ code: n.code, feels: n.feels, mm: n.mm, prob: n.prob, gust: n.gust, day: n.day }), w - 90, 400);
  ctx.textAlign = 'left';

  ctx.fillStyle = '#aebbdc';
  ctx.font = '600 46px ui-rounded, system-ui, sans-serif';
  ctx.fillText(W.skyName(n.code) + ' · feels like ' + W.temp(n.feels, state.units), 90, 500);

  /* The headline, wrapped by hand — it is the whole point of the card. */
  ctx.fillStyle = '#ffe6a8';
  ctx.font = '800 92px ui-rounded, system-ui, sans-serif';
  var words = head.split(' ');
  var line = '', y = 700;
  for (var i = 0; i < words.length; i++) {
    var test = line ? line + ' ' + words[i] : words[i];
    if (ctx.measureText(test).width > w - 180 && line) {
      ctx.fillText(line, 90, y);
      y += 104;
      line = words[i];
    } else line = test;
  }
  if (line) ctx.fillText(line, 90, y);

  ctx.strokeStyle = 'rgba(255,255,255,0.16)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(90, h - 250);
  ctx.lineTo(w - 90, h - 250);
  ctx.stroke();

  ctx.fillStyle = '#f2f6ff';
  ctx.font = '600 44px ui-rounded, system-ui, sans-serif';
  var strip = 'High ' + W.temp(today.max, state.units) + ' · Low ' + W.temp(today.min, state.units) +
    ' · ' + (today.prob === null ? 'rain unknown' : today.prob + '% rain');
  ctx.fillText(strip, 90, h - 170);

  ctx.fillStyle = 'rgba(174,187,220,0.75)';
  ctx.font = '600 34px ui-rounded, system-ui, sans-serif';
  ctx.fillText(BRAND.signature(state.sweary), 90, h - 90);

  return canvas;
}

function shareText() {
  var now = Math.floor(Date.now() / 1000);
  var n = W.now(forecast, now);
  var today = forecast.days[W.todayIndex(forecast, now)];
  return state.place.name + ': ' + W.temp(n.temp, state.units) + ', ' + W.skyName(n.code).toLowerCase() +
    '. ' + V.headline(forecast, state, now).text +
    ' (High ' + W.temp(today.max, state.units) + ' · Low ' + W.temp(today.min, state.units) +
    ' · ' + (today.prob === null ? 'rain unknown' : today.prob + '% rain) ') +
    '— ' + BRAND.pick(state.sweary);
}

function canvasBlob(canvas) {
  return new Promise(function (resolve) {
    if (canvas.toBlob) canvas.toBlob(resolve, 'image/png');
    else resolve(null);
  });
}

function wireShare() {
  $('shareBtn').addEventListener('click', function () {
    if (!forecast) return;
    drawShareCard();
    $('shareOut').textContent = '';
    openSheet($('shareSheet'));
  });

  /* The operating system's own share sheet on a phone, the browser's where
     there is one, a download where there is not, and plain text as the last
     resort — every route ends with something the user can actually send.

     Neither WebView implements Web Share for files, so on iOS and Android the
     bridge writes the card to the app's cache and hands the sheet a real file.
     In a browser navigator.share does that job directly. */
  $('shareGoBtn').addEventListener('click', function () {
    var out = $('shareOut');
    var name = (state.place.name || 'weather').replace(/\s+/g, '-').toLowerCase() + '-weather.png';

    canvasBlob(drawShareCard()).then(function (blob) {
      if (N.is) return N.share(shareText(), blob, name);

      var file = blob && self.File ? new File([blob], name, { type: 'image/png' }) : null;
      if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
        return navigator.share({ files: [file], text: shareText() });
      }
      if (navigator.share) return navigator.share({ text: shareText() });
      return saveCard(blob, out);
    }).then(function () {
      /* A cancelled share is not a failure and does not deserve a message. */
    }).catch(function (e) {
      if (e && e.name === 'AbortError') return;
      out.textContent = 'Sharing is not available here — save the image instead.';
    });
  });

  $('shareSaveBtn').addEventListener('click', function () {
    canvasBlob(drawShareCard()).then(function (blob) { saveCard(blob, $('shareOut')); });
  });

  $('shareCopyBtn').addEventListener('click', function () {
    var text = shareText();
    var out = $('shareOut');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { out.textContent = 'Copied.'; })
        .catch(function () { out.textContent = text; });
    } else out.textContent = text;
  });
}

function saveCard(blob, out) {
  if (!blob) { out.textContent = 'Could not make the image on this browser.'; return; }
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = (state.place.name || 'weather').replace(/\s+/g, '-').toLowerCase() + '-weather.png';
  a.click();
  setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
  out.textContent = 'Saved to your downloads.';
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
  $('animOn').checked = !!state.animate;
  $('badgeOn').checked = !!state.badge;
  $('badgeState').textContent = badgeState();
  $('unitsSel').value = state.units;
  $('clockSel').value = state.ampm ? '12' : '24';
  $('buildHint').textContent = 'Build ' + BUILD;
  $('aboutBuild').textContent = 'Build ' + BUILD;
  $('aboutTitle').textContent = BRAND.pick(state.sweary);
  $('aboutTagline').textContent = BRAND.tagline;
  $('dataStatus').textContent = forecast
    ? ageText() + (lastError ? ' · saved copy, could not reach the weather' : '')
    : 'No forecast saved on this phone yet.';
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
  $('hereBtn').addEventListener('click', function () { askHere($('placeOut')); });
  $('useHereBtn').addEventListener('click', function () { askHere($('setupOut')); });
  $('askYesBtn').addEventListener('click', function () {
    closeSheet($('askSheet'));
    useHere(askOut);
  });
  $('searchPlaceBtn').addEventListener('click', function () { $('placeBtn').click(); });

  $('settingsBtn').addEventListener('click', function () { syncSettings(); openSheet($('settingsSheet')); });
  $('aboutBtn').addEventListener('click', function () { syncSettings(); openSheet($('aboutSheet')); });
  $('retryBtn').addEventListener('click', function () { refresh(true); });
  $('refreshBtn').addEventListener('click', function () { refresh(true).then(syncSettings); });

  $('swearyOn').addEventListener('change', function () {
    state.sweary = $('swearyOn').checked;
    save(); render(); syncSettings();
  });
  $('badgeOn').addEventListener('change', function () {
    state.badge = $('badgeOn').checked;
    save();
    updateBadge();
  });
  $('animOn').addEventListener('change', function () {
    state.animate = $('animOn').checked;
    save();
    skyPainted = '';
    render();
  });
  $('unitsSel').addEventListener('change', function () {
    state.units = $('unitsSel').value; save(); render();
  });
  $('clockSel').addEventListener('change', function () {
    state.ampm = $('clockSel').value === '12'; save(); render();
  });

  $('exportBtn').addEventListener('click', function () {
    var blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'weather-settings.json';
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
      save(); syncSettings(); render(); refresh(true);
    }).catch(function () { alert('That file is not a settings export from this app.'); });
  });

  $('resetBtn').addEventListener('click', function () {
    if (!confirm('Erase the place and the settings on this phone?')) return;
    try { localStorage.removeItem(STORE_KEY); } catch (e) {}
    state = defaults();
    forecast = null;
    lastError = '';
    changeLines = [];
    skyPainted = '';
    save(); syncSettings(); render();
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

  wireShare();

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') { render(); refresh(false); }
  });
  window.addEventListener('online', function () { refresh(true); });

  /* Coming back from the lock screen is the moment the number on screen is
     most likely to be wrong. A WebView does fire visibilitychange, but the
     native resume event is the one that can be relied on. */
  N.onResume(function () { render(); refresh(false); });

  /* Android's back button. Without this it does nothing at all, which reads as
     a broken app rather than a considered one: it should close whatever is
     open, and leave the app only from the weather itself. */
  N.onBack(function () {
    var open = document.querySelector('dialog.sheet[open]');
    if (open) { closeSheet(open); return; }
    var app = self.Capacitor && Capacitor.Plugins && Capacitor.Plugins.App;
    if (app && app.exitApp) app.exitApp();
  });
  if (self.matchMedia) {
    var mq = matchMedia('(prefers-reduced-motion: reduce)');
    var onChange = function () { skyPainted = ''; render(); };
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else if (mq.addListener) mq.addListener(onChange);
  }

  setInterval(function () { render(); refresh(false); }, TICK_MS);
}

/* ------------------------------------------------------------------- start */

load();
wireSheets();
wire();
syncSettings();
render();
refresh(false);

/* The splash screen comes down here rather than on a timer, so the first thing
   behind it is the weather — or the "where are you, then?" card — and never a
   blank screen with a spinner on it. */
N.ready();

/* -------------------------------------------------------- the service worker */

/* Web only, deliberately. A service worker exists to keep a website on a phone;
   inside the iOS or Android app every file is already on the phone, and a
   worker caching them would only be a way to ship a version that can never
   update itself. */
if (!N.is && 'serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('sw.js').catch(function (e) { console.warn('sw', e); });

    var hadWorker = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (!hadWorker) return;
      if (sessionStorage.getItem('weatherApp.reloaded')) return;
      try { sessionStorage.setItem('weatherApp.reloaded', '1'); } catch (e) { return; }
      location.reload();
    });
  });
}
