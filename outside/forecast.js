/* Step Out — the part of the app that has no screen.

   Everything in here is arithmetic on a forecast: turning an hour of weather
   into a number, turning a run of good numbers into a window worth leaving
   the house for, and deciding whether a window is worth interrupting somebody
   for. None of it touches the DOM.

   That matters because it runs in two places. The page loads this file with a
   <script> tag; the service worker loads the same file with importScripts, so
   that a nudge fired while the app is closed is decided by exactly the same
   rules as one fired while you are looking at it. Two copies of this logic
   would drift, and the drift would show up as the app promising one thing on
   screen and notifying another. */

(function (root) {
  'use strict';

  var S = {};

  /* --------------------------------------------------------------- sources */

  /* Open-Meteo, because it answers a browser directly (CORS), needs no key,
     and asks for nothing about whoever is asking. A key would have to live in
     the page, where it is not a secret anyway. */
  S.API = 'https://api.open-meteo.com/v1/forecast';
  S.GEO = 'https://geocoding-api.open-meteo.com/v1/search';

  S.HOURLY = [
    'temperature_2m',
    'apparent_temperature',
    'precipitation_probability',
    'precipitation',
    'wind_speed_10m',
    'wind_gusts_10m',
    'weather_code',
    'is_day'
  ].join(',');

  S.forecastUrl = function (place, days) {
    return S.API +
      '?latitude=' + encodeURIComponent(place.lat) +
      '&longitude=' + encodeURIComponent(place.lon) +
      '&hourly=' + S.HOURLY +
      '&daily=sunrise,sunset,weather_code' +
      '&wind_speed_unit=kmh' +
      '&timezone=auto' +
      /* Unix time rather than the local strings the API prefers. A wall-clock
         string with no offset on it has to be parsed against *some* zone, and
         the browser's is the wrong one the moment you look up a place you are
         not standing in. Epoch seconds plus the offset the API reports keeps
         "now" and "3pm there" as separate, unconfusable things. */
      '&timeformat=unixtime' +
      '&forecast_days=' + (days || 3);
  };

  S.searchUrl = function (name) {
    return S.GEO + '?name=' + encodeURIComponent(name) + '&count=6&language=en&format=json';
  };

  /* ------------------------------------------------------------- the sky */

  /* WMO codes, which is what the forecast speaks in. The second entry is what
     the app says out loud, so it is written the way somebody would say it. */
  var CODES = {
    0:  ['Clear', 'clear', '☀️'],
    1:  ['Mostly clear', 'mostly clear', '🌤️'],
    2:  ['Partly cloudy', 'some cloud', '⛅'],
    3:  ['Overcast', 'grey', '☁️'],
    45: ['Fog', 'fog', '🌫️'],
    48: ['Freezing fog', 'freezing fog', '🌫️'],
    51: ['Light drizzle', 'spitting', '🌦️'],
    53: ['Drizzle', 'drizzle', '🌦️'],
    55: ['Heavy drizzle', 'heavy drizzle', '🌧️'],
    56: ['Freezing drizzle', 'freezing drizzle', '🌧️'],
    57: ['Freezing drizzle', 'freezing drizzle', '🌧️'],
    61: ['Light rain', 'light rain', '🌦️'],
    63: ['Rain', 'rain', '🌧️'],
    65: ['Heavy rain', 'heavy rain', '🌧️'],
    66: ['Freezing rain', 'freezing rain', '🌧️'],
    67: ['Freezing rain', 'freezing rain', '🌧️'],
    71: ['Light snow', 'light snow', '🌨️'],
    73: ['Snow', 'snow', '🌨️'],
    75: ['Heavy snow', 'heavy snow', '❄️'],
    77: ['Snow grains', 'snow', '🌨️'],
    80: ['Showers', 'showers', '🌦️'],
    81: ['Showers', 'showers', '🌧️'],
    82: ['Heavy showers', 'heavy showers', '⛈️'],
    85: ['Snow showers', 'snow showers', '🌨️'],
    86: ['Snow showers', 'snow showers', '❄️'],
    95: ['Thunderstorm', 'thunder', '⛈️'],
    96: ['Thunderstorm', 'thunder and hail', '⛈️'],
    99: ['Thunderstorm', 'thunder and hail', '⛈️']
  };

  /* Weather that is not a matter of taste. However relaxed the settings, the
     app does not send anybody out into a thunderstorm or freezing rain. */
  var NEVER = { 56: 1, 57: 1, 66: 1, 67: 1, 75: 1, 82: 1, 86: 1, 95: 1, 96: 1, 99: 1 };

  S.sky = function (code) { return CODES[code] || ['Unsettled', 'unsettled', '🌥️']; };
  S.skyName = function (code) { return S.sky(code)[0]; };
  S.skyPhrase = function (code) { return S.sky(code)[1]; };
  S.skyIcon = function (code, day) {
    var icon = S.sky(code)[2];
    /* One substitution: a clear night is not a sun. */
    if (!day && (code === 0 || code === 1)) return '🌙';
    return icon;
  };

  /* Sunshine is worth something on its own — the difference between a grey
     dry hour and a bright one is the difference between going and not. */
  var SKY_BONUS = {
    0: 1, 1: 0.92, 2: 0.75, 3: 0.5,
    45: 0.25, 48: 0.15,
    51: 0.3, 53: 0.2, 55: 0.1,
    61: 0.2, 63: 0.1, 65: 0,
    71: 0.35, 73: 0.2, 77: 0.3,
    80: 0.35, 81: 0.2
  };

  /* --------------------------------------------------------- the activities */

  /* `ideal` is the range where the number is simply right; `hard` is where it
     stops counting as going out at all. Between the two the score falls away
     in a straight line, which is enough shape for a decision this coarse.

     Temperatures are what it *feels* like rather than what the thermometer
     says, because the wind is already in that number and it is the one you
     dress for. Wind is the gust rather than the average, for the same reason:
     the gust is what pushes a bike about. */
  S.ACTIVITIES = [
    {
      id: 'walk', label: 'A walk', short: 'walk', icon: '🚶',
      go: 'Go for a walk', min: 1,
      ideal: [9, 23], hard: [0, 31], prob: 35, mm: 0.4, gust: 45, light: true,
      w: { temp: 0.35, dry: 0.35, wind: 0.2, sky: 0.1 }
    },
    {
      id: 'run', label: 'A run', short: 'run', icon: '🏃',
      go: 'Get a run in', min: 1,
      /* Runners want it colder than everyone else and mind rain less, and
         they are the one activity here that is happy in the dark. */
      ideal: [3, 17], hard: [-4, 26], prob: 50, mm: 0.9, gust: 45, light: false,
      w: { temp: 0.4, dry: 0.3, wind: 0.2, sky: 0.1 }
    },
    {
      id: 'ride', label: 'A bike ride', short: 'ride', icon: '🚲',
      go: 'Get the bike out', min: 2,
      ideal: [10, 24], hard: [2, 31], prob: 25, mm: 0.2, gust: 32, light: true,
      /* Wind is the one that ruins a ride, so it is weighted like it. */
      w: { temp: 0.3, dry: 0.3, wind: 0.3, sky: 0.1 }
    },
    {
      id: 'park', label: 'The park with the kids', short: 'park', icon: '🛝',
      go: 'Take them to the park', min: 1,
      ideal: [11, 26], hard: [3, 31], prob: 25, mm: 0.2, gust: 35, light: true,
      w: { temp: 0.35, dry: 0.35, wind: 0.15, sky: 0.15 }
    },
    {
      id: 'garden', label: 'The garden', short: 'garden', icon: '🌿',
      go: 'Get in the garden', min: 2,
      ideal: [11, 25], hard: [4, 31], prob: 25, mm: 0.2, gust: 38, light: true,
      w: { temp: 0.35, dry: 0.35, wind: 0.2, sky: 0.1 }
    },
    {
      id: 'sit', label: 'Sitting outside', short: 'sit out', icon: '☕',
      go: 'Take it outside', min: 1,
      /* Nobody sits still in a cold wind, so this one is fussy by nature. */
      ideal: [16, 28], hard: [12, 33], prob: 15, mm: 0.1, gust: 25, light: true,
      w: { temp: 0.4, dry: 0.3, wind: 0.15, sky: 0.15 }
    }
  ];

  S.activity = function (id) {
    for (var i = 0; i < S.ACTIVITIES.length; i++) {
      if (S.ACTIVITIES[i].id === id) return S.ACTIVITIES[i];
    }
    return null;
  };

  /* One slider rather than thirty numbers. It moves every threshold at once,
     which is how people actually think about this: "I don't mind a bit of
     drizzle" is a single opinion, not six. */
  var FUSS = {
    /* "I'll go in anything" has to mean it: a better-than-even chance of
       drizzle is exactly the hour this setting exists to keep. */
    relaxed: { temp: 3, prob: 25, mm: 0.4, gust: 8, bar: 45 },
    normal:  { temp: 0, prob: 0,  mm: 0,   gust: 0, bar: 55 },
    fussy:   { temp: -2, prob: -12, mm: -0.1, gust: -7, bar: 66 }
  };

  S.bar = function (fuss) { return (FUSS[fuss] || FUSS.normal).bar; };

  /* The thresholds an activity is actually judged by, once the slider has had
     its say. Kept as its own function so a test can read them. */
  S.limits = function (act, fuss) {
    var f = FUSS[fuss] || FUSS.normal;
    return {
      ideal: act.ideal,
      hard: [act.hard[0] - f.temp, act.hard[1] + f.temp],
      prob: Math.max(5, act.prob + f.prob),
      mm: Math.max(0.05, act.mm + f.mm),
      gust: Math.max(12, act.gust + f.gust),
      light: act.light
    };
  };

  function ramp(value, ideal, hard) {
    if (value >= ideal[0] && value <= ideal[1]) return 1;
    if (value < ideal[0]) {
      if (value <= hard[0]) return 0;
      return (value - hard[0]) / (ideal[0] - hard[0]);
    }
    if (value >= hard[1]) return 0;
    return (hard[1] - value) / (hard[1] - ideal[1]);
  }

  /* ------------------------------------------------------------- the score */

  /* An hour, an activity and an opinion in, a number out of a hundred out.
     Zero means "not this hour" and says why; anything above the bar is a
     candidate for a window. */
  S.scoreHour = function (hour, act, fuss) {
    var lim = S.limits(act, fuss);
    var stops = [];

    if (NEVER[hour.code]) stops.push(S.skyPhrase(hour.code));
    if (lim.light && !hour.day) stops.push('dark');
    if (hour.feels <= lim.hard[0]) stops.push('too cold');
    if (hour.feels >= lim.hard[1]) stops.push('too hot');
    if (hour.mm > lim.mm) stops.push('rain');
    if (hour.prob > lim.prob) stops.push('likely rain');
    if (hour.gust > lim.gust) stops.push('too windy');

    if (stops.length) return { score: 0, stops: stops };

    var temp = ramp(hour.feels, lim.ideal, lim.hard);
    var dry = 1 - Math.min(1, hour.prob / Math.max(1, lim.prob)) * 0.8
                - Math.min(1, hour.mm / Math.max(0.05, lim.mm)) * 0.2;
    var wind = 1 - Math.min(1, hour.gust / Math.max(1, lim.gust));
    var sky = SKY_BONUS[hour.code];
    if (sky === undefined) sky = 0.4;
    /* Daylight is not required for a run, but a run in the light still beats
       one in the dark, so it counts here rather than as a blocker. */
    if (!act.light && !hour.day) sky = Math.min(sky, 0.45);

    var w = act.w;
    var score = w.temp * temp + w.dry * Math.max(0, dry) + w.wind * wind + w.sky * sky;
    return { score: Math.round(score * 100), stops: [] };
  };

  /* ------------------------------------------------------------ the windows */

  /* Nobody needs telling that the next twenty-three hours are fine. A run
     longer than this is trimmed to its best stretch — the app says "go now,
     for these six hours" and mentions that it keeps up afterwards, which is
     an invitation rather than a weather report.

     It also stops a long run swallowing the day: an overnight run window
     touching everything after it would otherwise beat the good afternoon to
     the headline simply by overlapping it. */
  var MAX_HOURS = 6;

  /* A window is a run of consecutive hours that all clear the bar, long
     enough to be worth the coat. Runs are cut at a gap of any length: an hour
     of rain in the middle is not a window with a hole in it, it is two
     windows, and only one of them may be long enough to count. */
  S.findWindows = function (hours, act, fuss, from, until) {
    var bar = S.bar(fuss);
    var out = [];
    var run = [];

    function close() {
      if (run.length >= act.min) {
        var slice = run;
        var trimmed = false;
        if (run.length > MAX_HOURS) {
          trimmed = true;
          /* The best six of them, earliest when two stretches tie — a morning
             that is as good as the afternoon is the one to be told about. */
          var bestSum = -1, bestAt = 0, s, k, sum;
          for (s = 0; s + MAX_HOURS <= run.length; s++) {
            sum = 0;
            for (k = s; k < s + MAX_HOURS; k++) sum += run[k].score;
            if (sum > bestSum) { bestSum = sum; bestAt = s; }
          }
          slice = run.slice(bestAt, bestAt + MAX_HOURS);
        }

        var total = 0, peak = 0, wet = 0, i;
        for (i = 0; i < slice.length; i++) {
          total += slice[i].score;
          if (slice[i].score > peak) peak = slice[i].score;
          if (slice[i].hour.prob > wet) wet = slice[i].hour.prob;
        }
        out.push({
          activity: act.id,
          start: slice[0].hour.t,
          /* An hourly forecast describes the hour that *starts* at its stamp,
             so a window ending at the 15:00 hour is good until 16:00. */
          end: slice[slice.length - 1].hour.t + 3600,
          hours: slice.map(function (r) { return r.hour; }),
          score: Math.round(total / slice.length),
          peak: peak,
          wettest: wet,
          trimmed: trimmed
        });
      }
      run = [];
    }

    for (var i = 0; i < hours.length; i++) {
      var h = hours[i];
      /* The hour you are standing in still counts — it does not end until it
         ends — but one that finished an hour ago is history. */
      if (h.t + 3600 <= from) continue;
      if (until && h.t >= until) break;
      var s = S.scoreHour(h, act, fuss);
      if (s.score >= bar) run.push({ hour: h, score: s.score });
      else close();
    }
    close();
    return out;
  };

  /* Every enabled activity's windows, in the order they arrive. Two
     activities liking the same afternoon is normal and both are kept: they
     are different suggestions, and the picker below sorts out which gets said
     out loud. */
  S.allWindows = function (forecast, settings, now) {
    var out = [];
    var until = now + (settings.horizon || 36) * 3600;
    for (var i = 0; i < S.ACTIVITIES.length; i++) {
      var act = S.ACTIVITIES[i];
      if (!settings.activities || !settings.activities[act.id]) continue;
      out = out.concat(S.findWindows(forecast.hours, act, settings.fuss, now, until));
    }
    out.sort(function (a, b) { return a.start - b.start || b.score - a.score; });
    return out;
  };

  /* Windows that overlap in time are the same piece of good weather described
     twice. For the headline, the better-scoring one wins the slot. */
  S.headline = function (windows) {
    if (!windows.length) return null;
    var best = windows[0];
    for (var i = 1; i < windows.length; i++) {
      var w = windows[i];
      if (w.start >= best.end) break;         /* a later, separate window */
      if (w.score > best.score) best = w;
    }
    return best;
  };

  /* --------------------------------------------------------------- the time */

  /* Everything below reads a timestamp *at the place being forecast*. The
     offset comes from the forecast itself, so a window at three in the
     afternoon in Cornwall reads as three in the afternoon wherever the phone
     happens to be. UTC getters on a shifted date is the trick that does it. */
  S.at = function (t, offset) { return new Date((t + offset) * 1000); };
  S.hourOf = function (t, offset) { return S.at(t, offset).getUTCHours(); };
  S.dayOf = function (t, offset) { return Math.floor((t + offset) / 86400); };

  function pad(n) { return n < 10 ? '0' + n : String(n); }

  S.clock = function (t, offset, ampm) {
    var d = S.at(t, offset);
    var h = d.getUTCHours(), m = d.getUTCMinutes();
    if (!ampm) return pad(h) + ':' + pad(m);
    var suffix = h < 12 ? 'am' : 'pm';
    var h12 = h % 12; if (h12 === 0) h12 = 12;
    return h12 + (m ? ':' + pad(m) : '') + suffix;
  };

  /* A window that ends on the next day says so. "23:00 to 05:00" on its own
     reads as a window that finished eighteen hours ago. */
  S.span = function (win, offset, ampm) {
    var text = S.clock(win.start, offset, ampm) + ' to ' + S.clock(win.end, offset, ampm);
    if (S.dayOf(win.end - 60, offset) !== S.dayOf(win.start, offset)) text += ' next day';
    return text;
  };

  S.hoursLong = function (win) { return Math.round((win.end - win.start) / 3600); };

  /* ------------------------------------------------------------- the words */

  /* The nudge has to earn the interruption, and "it is 18 degrees" does not.
     What earns it is the bit you would not have known: that this is the best
     it gets today, that the rain stops for exactly two hours, that it is the
     last light. Each line below is only offered when its fact is true — see
     `lines` — so the app never manufactures urgency it cannot back up. */
  var OPENERS = {
    best: [
      'Best it gets today.',
      'This is the good bit of today.',
      'Nothing better is coming today.'
    ],
    gap: [
      'The rain is off for a bit.',
      'A dry gap, and then it is back.',
      'It stops raining at {start}. Not for long.'
    ],
    last: [
      'Last of the light.',
      'This is the last of it before dark.',
      'Light goes at {dark}.'
    ],
    sun: [
      'Sun is out.',
      'Blue sky out there.',
      'Proper sunshine, right now.'
    ],
    crisp: [
      'Cold, bright and still — the good kind.',
      'Cold and clear. Coat weather, not excuse weather.'
    ],
    warm: [
      'It is {temp} out there.',
      'Warm and dry for {length}.'
    ],
    plain: [
      'It is decent out.',
      'Weather is on your side for {length}.',
      'A clear run of {length}.'
    ]
  };

  var STREAK = [
    '{n} days on the trot. Do not let today be the one.',
    '{n} in a row. Today is number {next}.',
    'You have been out {n} days running. Keep it.'
  ];

  var FIRST = [
    'You have not been out today.',
    'Nothing logged today yet.'
  ];

  /* Deterministic rather than random: the same window says the same thing
     every time it is drawn, so the card does not reword itself under you
     while you are reading it. */
  function pick(list, seed) {
    if (!list.length) return '';
    var n = 0;
    var key = String(seed);
    for (var i = 0; i < key.length; i++) n = (n * 31 + key.charCodeAt(i)) >>> 0;
    return list[n % list.length];
  }

  function fill(text, vars) {
    return text.replace(/\{(\w+)\}/g, function (m, k) {
      return vars[k] === undefined ? m : String(vars[k]);
    });
  }

  /* What is true about this window, most-interesting first. The order is the
     argument: "best of the day" beats "it is sunny", because one of them is a
     reason to go now rather than later. */
  S.reasons = function (win, forecast, windows, settings, now) {
    var out = [];
    var day = S.dayOf(win.start, forecast.offset);
    var todays = windows.filter(function (w) { return S.dayOf(w.start, forecast.offset) === day; });
    var bestToday = todays.reduce(function (a, w) { return !a || w.score > a.score ? w : a; }, null);

    if (bestToday && bestToday.start === win.start && todays.length > 1) out.push('best');

    /* A gap only counts as one if there is weather either side of it. */
    var before = S.hourAt(forecast, win.start - 3600);
    var after = S.hourAt(forecast, win.end);
    if ((before && before.prob >= 50) || (after && after.prob >= 50)) out.push('gap');

    var dark = S.sunsetAfter(forecast, win.start);
    if (dark && dark - win.end <= 3600 && S.activity(win.activity).light) out.push('last');

    var mid = win.hours[Math.floor(win.hours.length / 2)];
    if (mid.code === 0 || mid.code === 1) out.push(mid.feels >= 6 ? 'sun' : 'crisp');
    if (mid.feels >= 20) out.push('warm');
    out.push('plain');
    return out;
  };

  S.hourAt = function (forecast, t) {
    for (var i = 0; i < forecast.hours.length; i++) {
      if (forecast.hours[i].t === t) return forecast.hours[i];
    }
    return null;
  };

  S.sunsetAfter = function (forecast, t) {
    for (var i = 0; i < forecast.days.length; i++) {
      if (forecast.days[i].sunset > t) return forecast.days[i].sunset;
    }
    return 0;
  };

  /* The sentence itself: an opener that is true, plus the plain facts, plus
     the streak if there is one to lose. */
  S.say = function (win, forecast, windows, settings, now, streak) {
    var reasons = S.reasons(win, forecast, windows, settings, now);
    var mid = win.hours[Math.floor(win.hours.length / 2)];
    var length = S.hoursLong(win);
    var vars = {
      start: S.clock(win.start, forecast.offset, settings.ampm),
      dark: S.clock(S.sunsetAfter(forecast, win.start), forecast.offset, settings.ampm),
      temp: S.temp(mid.feels, settings.units),
      length: length === 1 ? 'an hour' : length + ' hours',
      n: streak && streak.days,
      next: streak && (streak.days + 1)
    };
    var opener = fill(pick(OPENERS[reasons[0]] || OPENERS.plain, win.start + reasons[0]), vars);
    var tail = '';
    if (streak && streak.days >= 2 && !streak.today) {
      tail = ' ' + fill(pick(STREAK, win.start), vars);
    } else if (streak && !streak.today && streak.days === 0 && streak.ever) {
      tail = ' ' + pick(FIRST, win.start);
    }
    return { opener: opener, tail: tail.trim(), reasons: reasons };
  };

  /* ------------------------------------------------------------- the units */

  S.temp = function (c, units) {
    if (units === 'imperial') return Math.round(c * 9 / 5 + 32) + '°F';
    return Math.round(c) + '°';
  };
  S.speed = function (kmh, units) {
    if (units === 'imperial') return Math.round(kmh * 0.621371) + ' mph';
    return Math.round(kmh) + ' km/h';
  };

  /* --------------------------------------------------------------- parsing */

  /* A forecast that arrives in the wrong shape is worse than one that does
     not arrive: the second is obvious, the first draws an empty day and calls
     it settled weather. So the shape is checked before anything believes it. */
  S.parse = function (json, place) {
    if (!json || !json.hourly || !Array.isArray(json.hourly.time) || !json.hourly.time.length) {
      throw new Error('The forecast came back in a shape this app does not know.');
    }
    var h = json.hourly;
    var hours = [];
    for (var i = 0; i < h.time.length; i++) {
      var t = h.time[i];
      if (typeof t !== 'number') throw new Error('The forecast is not stamped in the expected way.');
      hours.push({
        t: t,
        temp: num(h.temperature_2m, i),
        feels: h.apparent_temperature ? num(h.apparent_temperature, i) : num(h.temperature_2m, i),
        prob: num(h.precipitation_probability, i),
        mm: num(h.precipitation, i),
        wind: num(h.wind_speed_10m, i),
        gust: h.wind_gusts_10m ? num(h.wind_gusts_10m, i) : num(h.wind_speed_10m, i),
        code: num(h.weather_code, i),
        day: num(h.is_day, i) ? 1 : 0
      });
    }
    var days = [];
    if (json.daily && Array.isArray(json.daily.time)) {
      for (var j = 0; j < json.daily.time.length; j++) {
        days.push({
          t: json.daily.time[j],
          sunrise: num(json.daily.sunrise, j),
          sunset: num(json.daily.sunset, j),
          code: num(json.daily.weather_code, j)
        });
      }
    }
    return {
      fetchedAt: Math.floor(Date.now() / 1000),
      offset: typeof json.utc_offset_seconds === 'number' ? json.utc_offset_seconds : 0,
      place: place,
      hours: hours,
      days: days
    };
  };

  function num(arr, i) {
    var v = arr && arr[i];
    return typeof v === 'number' && isFinite(v) ? v : 0;
  }

  /* ------------------------------------------------------------ the nudging */

  /* Everything that decides whether to interrupt somebody, in one place.

     The rules are all about restraint, because an app that nudges too often
     gets its notifications turned off and then never nudges again:

     - only a window that starts within the lead time, or one already under
       way with enough of it left to be worth the trip;
     - never during quiet hours, judged where the weather is;
     - never more than the day's allowance;
     - never the same window twice, however many times this runs;
     - never while snoozed. */
  S.dueNudge = function (forecast, settings, log, now) {
    if (!settings.notify) return null;
    if (settings.snoozeUntil && now < settings.snoozeUntil) return null;

    var offset = forecast.offset;
    var hour = S.hourOf(now, offset);
    if (S.inQuiet(hour, settings.quiet)) return null;

    var today = S.dayOf(now, offset);
    var sentToday = 0;
    for (var i = 0; i < log.sent.length; i++) {
      if (S.dayOf(log.sent[i].at, offset) === today) sentToday++;
    }
    if (sentToday >= (settings.maxPerDay || 3)) return null;

    var windows = S.allWindows(forecast, settings, now);
    var lead = (settings.lead || 30) * 60;

    for (var w = 0; w < windows.length; w++) {
      var win = windows[w];
      if (win.start > now + lead) break;               /* the rest start later still */
      /* A window with twenty minutes left in it is not an invitation. */
      if (win.end - Math.max(now, win.start) < 45 * 60) continue;
      var key = S.keyFor(win);
      if (log.keys[key]) continue;
      /* A window that starts inside quiet hours is not woken up for either,
         even if right now is outside them. */
      if (S.inQuiet(S.hourOf(Math.max(now, win.start), offset), settings.quiet)) continue;
      return { window: win, key: key };
    }
    return null;
  };

  S.keyFor = function (win) { return win.activity + '@' + win.start; };

  /* Quiet hours wrap around midnight, which is the normal way to want them:
     from nine at night to seven in the morning is a range that passes through
     zero and would be empty read the obvious way. */
  S.inQuiet = function (hour, quiet) {
    if (!quiet) return false;
    var from = quiet.from, to = quiet.to;
    if (from === to) return false;
    if (from < to) return hour >= from && hour < to;
    return hour >= from || hour < to;
  };

  /* The notification itself. Short title, because a phone truncates it at
     about forty characters; the detail goes in the body, where there is room
     for the reason as well as the numbers.

     The title carries the instruction — "Get the bike out" — rather than the
     weather, because the instruction is the bit that has to survive being
     read on a lock screen at arm's length. */
  S.notificationFor = function (win, forecast, settings, streak, now) {
    var act = S.activity(win.activity);
    var at = now || win.start;
    var windows = S.allWindows(forecast, settings, at);
    var said = S.say(win, forecast, windows, settings, at, streak);
    var mid = win.hours[Math.floor(win.hours.length / 2)];
    var facts = S.skyPhrase(mid.code) + ', ' + S.temp(mid.feels, settings.units) +
      ', ' + S.span(win, forecast.offset, settings.ampm);
    var soon = win.start > at + 300
      ? 'In ' + Math.round((win.start - at) / 60) + ' minutes: ' + lower(act.go)
      : act.go;
    return {
      title: soon,
      body: said.opener + ' ' + facts + '.' + (said.tail ? ' ' + said.tail : ''),
      tag: 'step-out',
      key: S.keyFor(win)
    };
  };

  function lower(text) { return text.charAt(0).toLowerCase() + text.slice(1); }

  /* ------------------------------------------------------------- the streak */

  /* Days in a row with something logged, counted back from today. Yesterday
     still counts as a live streak — the day is not over — which is the whole
     point of nudging about it. */
  S.streak = function (outings, offset, now) {
    var today = S.dayOf(now, offset);
    var seen = {};
    for (var i = 0; i < outings.length; i++) seen[S.dayOf(outings[i].at, offset)] = true;
    var start = seen[today] ? today : (seen[today - 1] ? today - 1 : null);
    var days = 0;
    if (start !== null) {
      var d = start;
      while (seen[d]) { days++; d--; }
    }
    return { days: days, today: !!seen[today], ever: outings.length > 0 };
  };

  /* ------------------------------------------------- the shared little store */

  /* The page keeps its settings in localStorage, which a service worker
     cannot read. So the two things a worker needs — the settings, and what it
     has already sent — live in IndexedDB as well, which both can reach. The
     page writes; both read; the worker only ever adds to the sent list. */
  var DB = 'step-out';
  var STORE = 'kv';

  function open() {
    return new Promise(function (resolve, reject) {
      if (typeof indexedDB === 'undefined') return reject(new Error('no indexedDB'));
      var req = indexedDB.open(DB, 1);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  S.kv = {
    get: function (key) {
      return open().then(function (db) {
        return new Promise(function (resolve, reject) {
          var req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
          req.onsuccess = function () { resolve(req.result); };
          req.onerror = function () { reject(req.error); };
        });
      }).catch(function () { return undefined; });
    },
    set: function (key, value) {
      return open().then(function (db) {
        return new Promise(function (resolve, reject) {
          var tx = db.transaction(STORE, 'readwrite');
          tx.objectStore(STORE).put(value, key);
          tx.oncomplete = function () { resolve(true); };
          tx.onerror = function () { reject(tx.error); };
        });
      }).catch(function () { return false; });
    }
  };

  /* The sent log, trimmed to a week. It is a dedupe record, not a diary. */
  S.rememberSent = function (log, key, now) {
    log.keys[key] = now;
    log.sent.push({ key: key, at: now });
    var cutoff = now - 7 * 86400;
    log.sent = log.sent.filter(function (s) { return s.at > cutoff; });
    var keys = {};
    for (var i = 0; i < log.sent.length; i++) keys[log.sent[i].key] = log.sent[i].at;
    log.keys = keys;
    return log;
  };

  S.emptyLog = function () { return { keys: {}, sent: [] }; };

  root.StepOut = S;

})(typeof self !== 'undefined' ? self : this);
