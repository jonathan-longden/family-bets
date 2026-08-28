/* The weather itself: asking for it, reading it, and turning an hour or a day
   into the one picture that describes it.

   Nothing in here is funny. That is the point — the jokes are built on top of
   these numbers in voice.js, and they can only be as honest as this file is.
   If this said "sunny" when it was raining, the app would be a liar with a
   good sense of humour, which is worse than a boring weather app. */

(function (root) {
  'use strict';

  var W = {};

  /* Open-Meteo: answers a browser directly, needs no key and no account, and
     asks nothing about who is asking. */
  W.API = 'https://api.open-meteo.com/v1/forecast';
  W.GEO = 'https://geocoding-api.open-meteo.com/v1/search';

  /* Fifteen days is the ask, and sixteen is as far as the model runs. */
  W.DAYS = 15;

  var HOURLY = [
    'temperature_2m',
    'apparent_temperature',
    'relative_humidity_2m',
    'precipitation_probability',
    'precipitation',
    'weather_code',
    'wind_speed_10m',
    'wind_gusts_10m',
    'visibility',
    'is_day'
  ].join(',');

  var DAILY = [
    'weather_code',
    'temperature_2m_max',
    'temperature_2m_min',
    'apparent_temperature_max',
    'sunrise',
    'sunset',
    'precipitation_probability_max',
    'precipitation_sum',
    'wind_speed_10m_max',
    'wind_gusts_10m_max',
    'uv_index_max'
  ].join(',');

  var CURRENT = [
    'temperature_2m',
    'apparent_temperature',
    'relative_humidity_2m',
    'precipitation',
    'weather_code',
    'wind_speed_10m',
    'wind_gusts_10m',
    'is_day'
  ].join(',');

  W.forecastUrl = function (place, days) {
    return W.API +
      '?latitude=' + encodeURIComponent(place.lat) +
      '&longitude=' + encodeURIComponent(place.lon) +
      '&current=' + CURRENT +
      '&hourly=' + HOURLY +
      '&daily=' + DAILY +
      '&wind_speed_unit=kmh' +
      '&timezone=auto' +
      /* Epoch seconds rather than the local strings the API prefers: a
         wall-clock string with no offset on it has to be parsed against some
         zone, and the browser's is the wrong one the moment you look up a
         place you are not standing in. */
      '&timeformat=unixtime' +
      /* Three days of history, so the app can say "first dry day this week"
         and mean it rather than guess it. */
      '&past_days=3' +
      '&forecast_days=' + (days || W.DAYS);
  };

  W.searchUrl = function (name) {
    return W.GEO + '?name=' + encodeURIComponent(name) + '&count=6&language=en&format=json';
  };

  /* ------------------------------------------------------------- the codes */

  /* WMO codes, which is what a forecast speaks in. Second entry is how a
     person would say it out loud; third is the family the personality engine
     reasons about, so it never has to know code numbers. */
  var CODES = {
    0:  ['Clear', 'clear', 'clear'],
    1:  ['Mostly clear', 'mostly clear', 'clear'],
    2:  ['Partly cloudy', 'some cloud about', 'cloud'],
    3:  ['Overcast', 'grey', 'grey'],
    45: ['Fog', 'fog', 'fog'],
    48: ['Freezing fog', 'freezing fog', 'fog'],
    51: ['Light drizzle', 'spitting', 'drizzle'],
    53: ['Drizzle', 'drizzle', 'drizzle'],
    55: ['Heavy drizzle', 'heavy drizzle', 'rain'],
    56: ['Freezing drizzle', 'freezing drizzle', 'ice'],
    57: ['Freezing drizzle', 'freezing drizzle', 'ice'],
    61: ['Light rain', 'light rain', 'rain'],
    63: ['Rain', 'rain', 'rain'],
    65: ['Heavy rain', 'heavy rain', 'downpour'],
    66: ['Freezing rain', 'freezing rain', 'ice'],
    67: ['Freezing rain', 'freezing rain', 'ice'],
    71: ['Light snow', 'light snow', 'snow'],
    73: ['Snow', 'snow', 'snow'],
    75: ['Heavy snow', 'heavy snow', 'snow'],
    77: ['Snow grains', 'snow grains', 'snow'],
    80: ['Showers', 'showers', 'showers'],
    81: ['Showers', 'showers', 'showers'],
    82: ['Heavy showers', 'heavy showers', 'downpour'],
    85: ['Snow showers', 'snow showers', 'snow'],
    86: ['Snow showers', 'heavy snow showers', 'snow'],
    95: ['Thunderstorm', 'thunder', 'thunder'],
    96: ['Thunderstorm', 'thunder and hail', 'thunder'],
    99: ['Thunderstorm', 'thunder and hail', 'thunder']
  };

  W.sky = function (code) { return CODES[code] || ['Unsettled', 'unsettled', 'cloud']; };
  W.skyName = function (code) { return W.sky(code)[0]; };
  W.skyPhrase = function (code) { return W.sky(code)[1]; };
  W.family = function (code) { return W.sky(code)[2]; };

  /* One picture per hour, and it is what the hour feels like rather than what
     the sky is technically doing. The order is a priority list: whatever would
     define the hour wins, because that is the thing worth knowing at a glance.

     Sunglasses only for weather you would actually squint in — a clear
     January morning at three degrees is a scarf, not a pair of shades. */
  W.icon = function (h) {
    var fam = W.family(h.code);
    if (fam === 'thunder') return '⛈️';
    if (fam === 'ice') return '🧊';
    if (fam === 'snow') return '❄️';
    if (fam === 'fog') return '🌫️';
    if (fam === 'downpour') return '☔';
    if (fam === 'rain' || fam === 'showers') return h.mm >= 1.5 ? '☔' : '🌧️';
    if (fam === 'drizzle') return '🌦️';
    if (h.prob >= 60) return '☔';                 /* not raining yet, but it will */
    if (h.gust >= 55) return '💨';
    if (h.feels <= 0) return '🥶';
    if (h.feels >= 30) return '🥵';
    if (!h.day) return '🌙';
    if (fam === 'clear') {
      if (h.feels >= 20) return '😎';
      if (h.feels <= 6) return '🧣';
      return '☀️';
    }
    if (h.feels <= 4) return '🧣';
    if (h.feels <= 11 && h.gust >= 35) return '🧥';
    if (fam === 'grey') return '☁️';
    return '⛅';
  };

  /* The same idea for a whole day, where there is no "is it dark" to worry
     about and the high and low do the talking. */
  W.dayIcon = function (d) {
    var fam = W.family(d.code);
    if (fam === 'thunder') return '⛈️';
    if (fam === 'ice') return '🧊';
    if (fam === 'snow') return '❄️';
    if (fam === 'fog') return '🌫️';
    if (fam === 'downpour') return '☔';
    if (fam === 'rain' || fam === 'showers') return '🌧️';
    if (fam === 'drizzle') return '🌦️';
    if (d.gust >= 65) return '💨';
    if (d.max >= 30) return '🥵';
    if (d.min <= -2) return '🥶';
    if (fam === 'clear') return d.max >= 20 ? '😎' : '☀️';
    if (fam === 'grey') return '☁️';
    return '⛅';
  };

  /* ------------------------------------------------------------- the units */

  W.temp = function (c, units) {
    if (c === null || c === undefined || !isFinite(c)) return '—';
    if (units === 'imperial') return Math.round(c * 9 / 5 + 32) + '°';
    return Math.round(c) + '°';
  };
  W.tempUnit = function (units) { return units === 'imperial' ? '°F' : '°C'; };
  W.speed = function (kmh, units) {
    if (kmh === null || kmh === undefined || !isFinite(kmh)) return '—';
    if (units === 'imperial') return Math.round(kmh * 0.621371) + ' mph';
    return Math.round(kmh) + ' km/h';
  };
  W.distance = function (metres, units) {
    if (!isFinite(metres)) return '—';
    if (units === 'imperial') return Math.round(metres / 1609) + ' mi';
    if (metres >= 1000) return Math.round(metres / 1000) + ' km';
    return Math.round(metres) + ' m';
  };

  /* --------------------------------------------------------------- the time */

  /* Everything below reads a timestamp *at the place being forecast*, using
     the offset the forecast itself reports. Three in the afternoon in Cornwall
     reads as three in the afternoon wherever the phone happens to be. */
  W.at = function (t, offset) { return new Date((t + offset) * 1000); };
  W.hourOf = function (t, offset) { return W.at(t, offset).getUTCHours(); };
  W.dayOf = function (t, offset) { return Math.floor((t + offset) / 86400); };

  function pad(n) { return n < 10 ? '0' + n : String(n); }

  W.clock = function (t, offset, ampm) {
    var d = W.at(t, offset);
    var h = d.getUTCHours(), m = d.getUTCMinutes();
    if (!ampm) return pad(h) + ':' + pad(m);
    var suffix = h < 12 ? 'am' : 'pm';
    var h12 = h % 12; if (h12 === 0) h12 = 12;
    return h12 + (m ? ':' + pad(m) : '') + suffix;
  };

  var DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  W.dayName = function (t, offset) { return DAY_NAMES[W.at(t, offset).getUTCDay()]; };
  W.dayShort = function (t, offset) { return W.dayName(t, offset).slice(0, 3); };
  W.dayDate = function (t, offset) {
    var d = W.at(t, offset);
    return d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()];
  };
  W.isWeekend = function (t, offset) {
    var day = W.at(t, offset).getUTCDay();
    return day === 0 || day === 6;
  };

  /* --------------------------------------------------------------- parsing */

  /* A forecast in an unexpected shape is worse than no forecast: the second is
     obvious, the first draws a plausible day that happens to be fiction. So
     the shape is checked before anything believes a number from it. */
  W.parse = function (json, place) {
    if (!json || !json.hourly || !Array.isArray(json.hourly.time) || !json.hourly.time.length) {
      throw new Error('The forecast came back in a shape this app does not know.');
    }
    var offset = typeof json.utc_offset_seconds === 'number' ? json.utc_offset_seconds : 0;
    var h = json.hourly;
    var hours = [];
    for (var i = 0; i < h.time.length; i++) {
      var t = stamp(h.time[i], offset);
      if (!isFinite(t)) throw new Error('The forecast is not stamped in the expected way.');
      hours.push({
        t: t,
        temp: num(h.temperature_2m, i),
        feels: h.apparent_temperature ? num(h.apparent_temperature, i) : num(h.temperature_2m, i),
        humidity: num(h.relative_humidity_2m, i),
        prob: num(h.precipitation_probability, i),
        mm: num(h.precipitation, i),
        code: num(h.weather_code, i),
        wind: num(h.wind_speed_10m, i),
        gust: h.wind_gusts_10m ? num(h.wind_gusts_10m, i) : num(h.wind_speed_10m, i),
        visibility: num(h.visibility, i),
        day: num(h.is_day, i) ? 1 : 0
      });
    }

    var days = [];
    if (json.daily && Array.isArray(json.daily.time)) {
      var d = json.daily;
      for (var j = 0; j < d.time.length; j++) {
        days.push({
          t: stamp(d.time[j], offset),
          code: num(d.weather_code, j),
          max: maybe(d.temperature_2m_max, j),
          min: maybe(d.temperature_2m_min, j),
          feelsMax: maybe(d.apparent_temperature_max, j),
          sunrise: stamp(d.sunrise && d.sunrise[j], offset) || 0,
          sunset: stamp(d.sunset && d.sunset[j], offset) || 0,
          /* Beyond about a week the model stops offering a probability at all.
             Null is kept as null rather than flattened to zero, because "no
             chance of rain" and "nobody knows yet" are different sentences. */
          prob: maybe(d.precipitation_probability_max, j),
          mm: maybe(d.precipitation_sum, j),
          wind: maybe(d.wind_speed_10m_max, j),
          gust: maybe(d.wind_gusts_10m_max, j),
          uv: maybe(d.uv_index_max, j)
        });
      }
    }
    if (!days.length) throw new Error('The forecast arrived with no days in it.');

    var current = null;
    if (json.current) {
      var c = json.current;
      current = {
        t: stamp(c.time, offset) || Math.floor(Date.now() / 1000),
        temp: num(c, 'temperature_2m', true),
        feels: num(c, 'apparent_temperature', true),
        humidity: num(c, 'relative_humidity_2m', true),
        mm: num(c, 'precipitation', true),
        code: num(c, 'weather_code', true),
        wind: num(c, 'wind_speed_10m', true),
        gust: num(c, 'wind_gusts_10m', true),
        day: num(c, 'is_day', true) ? 1 : 0
      };
    }

    return {
      fetchedAt: Math.floor(Date.now() / 1000),
      offset: offset,
      place: place,
      current: current,
      hours: hours,
      days: days
    };
  };

  function num(arr, i, direct) {
    var v = direct ? arr[i] : (arr && arr[i]);
    return typeof v === 'number' && isFinite(v) ? v : 0;
  }

  /* Same as `num`, except a missing value stays missing. Used for everything
     the long range legitimately does not know. */
  function maybe(arr, i) {
    var v = arr && arr[i];
    return typeof v === 'number' && isFinite(v) ? v : null;
  }

  /* Epoch seconds are asked for, because they cannot be misread. But a stamp
     is the one field where guessing wrong turns the whole app into fiction, so
     the other documented format is accepted rather than refused: with
     `timezone=auto` those strings are local wall clock at the place, which is
     what subtracting the reported offset turns back into an instant. */
  function stamp(value, offset) {
    if (typeof value === 'number' && isFinite(value)) return value;
    if (typeof value === 'string' && value) {
      var zoned = /[zZ]$|[+-]\d\d:?\d\d$/.test(value);
      var ms = Date.parse(zoned ? value : value + 'Z');
      if (!isNaN(ms)) return Math.floor(ms / 1000) - (zoned ? 0 : offset);
    }
    return NaN;
  }

  /* ---------------------------------------------------------- reading it back */

  /* The hour you are standing in. */
  W.hourNow = function (forecast, now) {
    for (var i = 0; i < forecast.hours.length; i++) {
      var h = forecast.hours[i];
      if (h.t <= now && h.t + 3600 > now) return h;
    }
    return forecast.hours[0];
  };

  W.hoursFrom = function (forecast, now, count) {
    var out = [];
    for (var i = 0; i < forecast.hours.length && out.length < count; i++) {
      if (forecast.hours[i].t + 3600 > now) out.push(forecast.hours[i]);
    }
    return out;
  };

  W.dayAt = function (forecast, index) { return forecast.days[index] || null; };

  W.todayIndex = function (forecast, now) {
    var today = W.dayOf(now, forecast.offset);
    for (var i = 0; i < forecast.days.length; i++) {
      if (W.dayOf(forecast.days[i].t, forecast.offset) === today) return i;
    }
    return 0;
  };

  /* Everything the top of the screen needs, in the units asked for. Current
     conditions come from the API's own `current` block where it gave one and
     the hour you are in otherwise — they can differ by a degree, and the live
     one is the one worth showing. */
  W.now = function (forecast, now) {
    var hour = W.hourNow(forecast, now);
    var c = forecast.current;
    return {
      temp: c ? c.temp : hour.temp,
      feels: c ? c.feels : hour.feels,
      humidity: c ? c.humidity : hour.humidity,
      code: c ? c.code : hour.code,
      wind: c ? c.wind : hour.wind,
      gust: c ? c.gust : hour.gust,
      mm: c ? c.mm : hour.mm,
      day: c ? c.day : hour.day,
      /* These two only exist hourly. */
      prob: hour.prob,
      visibility: hour.visibility
    };
  };

  /* How far into the future a day is allowed to pretend to know things. The
     app shows all fifteen days; it just never pretends day fifteen is
     tomorrow. */
  W.confidence = function (index) {
    if (index <= 2) return { tier: 'near', label: 'High confidence' };
    if (index <= 6) return { tier: 'mid', label: 'Good confidence' };
    return { tier: 'far', label: 'Lower confidence' };
  };

  /* ------------------------------------------------------- reading the day */

  /* The hours left in today, at the place being forecast. */
  W.todayHours = function (forecast, now) {
    var key = W.dayOf(now, forecast.offset);
    var out = [];
    for (var i = 0; i < forecast.hours.length; i++) {
      var h = forecast.hours[i];
      if (W.dayOf(h.t, forecast.offset) === key && h.t + 3600 > now) out.push(h);
    }
    return out;
  };

  W.hoursOfDay = function (forecast, dayKey) {
    var out = [];
    for (var i = 0; i < forecast.hours.length; i++) {
      if (W.dayOf(forecast.hours[i].t, forecast.offset) === dayKey) out.push(forecast.hours[i]);
    }
    return out;
  };

  /* How pleasant an hour is, purely as weather. Not a recommendation and not
     a score for doing anything — it exists so the app can point at the nicest
     and grimmest moments of a day, which is what people actually ask about. */
  W.pleasantness = function (h) {
    var fam = W.family(h.code);
    var score = 50;
    if (fam === 'clear') score += 26;
    else if (fam === 'cloud') score += 12;
    else if (fam === 'grey') score += 0;
    else if (fam === 'fog') score -= 12;
    else if (fam === 'drizzle') score -= 16;
    else if (fam === 'showers') score -= 20;
    else if (fam === 'rain') score -= 26;
    else if (fam === 'downpour') score -= 34;
    else if (fam === 'snow') score -= 20;
    else if (fam === 'ice') score -= 34;
    else if (fam === 'thunder') score -= 38;

    /* Comfort, as a curve around eighteen degrees rather than a threshold. */
    score -= Math.min(30, Math.abs(h.feels - 18) * 1.6);
    score -= Math.min(18, (h.prob || 0) * 0.16);
    score -= Math.min(16, Math.max(0, h.gust - 30) * 0.35);
    if (!h.day) score -= 8;
    return Math.round(score);
  };

  W.nicest = function (hours) {
    return hours.reduce(function (best, h) {
      return (!best || W.pleasantness(h) > W.pleasantness(best)) ? h : best;
    }, null);
  };

  W.grimmest = function (hours) {
    return hours.reduce(function (worst, h) {
      return (!worst || W.pleasantness(h) < W.pleasantness(worst)) ? h : worst;
    }, null);
  };

  W.isWet = function (h) {
    var fam = W.family(h.code);
    return h.mm >= 0.15 || fam === 'rain' || fam === 'downpour' || fam === 'showers' ||
      fam === 'drizzle' || fam === 'snow' || fam === 'thunder';
  };

  W.isBright = function (h) { return W.family(h.code) === 'clear' && h.day; };

  /* ----------------------------------------------------------- the timeline */

  /* The moments in the next stretch where the weather actually changes its
     mind. Everything here is a comparison between consecutive hours, so a
     transition can only be reported if the forecast contains it. */
  W.transitions = function (forecast, now, hoursAhead) {
    var hours = W.hoursFrom(forecast, now, hoursAhead || 24);
    var out = [];
    if (hours.length < 2) return out;

    var wasWet = W.isWet(hours[0]);
    var wasBright = W.isBright(hours[0]);
    var wasWindy = hours[0].gust >= 45;

    for (var i = 1; i < hours.length; i++) {
      var h = hours[i];
      var wet = W.isWet(h);
      var bright = W.isBright(h);
      var windy = h.gust >= 45;

      if (wet && !wasWet) out.push({ t: h.t, kind: 'rainStarts', text: 'Rain arrives' });
      if (!wet && wasWet) out.push({ t: h.t, kind: 'rainStops', text: 'Rain clears' });
      if (bright && !wasBright && h.day) out.push({ t: h.t, kind: 'brightens', text: 'Sun breaks through' });
      if (!bright && wasBright && h.day) out.push({ t: h.t, kind: 'clouds', text: 'Cloud moves in' });
      if (windy && !wasWindy) out.push({ t: h.t, kind: 'windUp', text: 'Wind picks up' });

      wasWet = wet; wasBright = bright; wasWindy = windy;
    }

    /* Sunrise and sunset are transitions too, and the two people plan around. */
    for (var d = 0; d < forecast.days.length; d++) {
      var day = forecast.days[d];
      var limit = now + (hoursAhead || 24) * 3600;
      if (day.sunrise > now && day.sunrise < limit) out.push({ t: day.sunrise, kind: 'sunrise', text: 'Sunrise' });
      if (day.sunset > now && day.sunset < limit) out.push({ t: day.sunset, kind: 'sunset', text: 'Sunset' });
    }

    out.sort(function (a, b) { return a.t - b.t; });

    /* Two things happening in the same hour is one line, not two — "rain
       arrives" and "cloud moves in" at seven o'clock is the same event
       described twice, and only the wetter half is worth the row. */
    var rank = { rainStarts: 5, rainStops: 5, brightens: 4, sunset: 3, sunrise: 3, clouds: 2, windUp: 2 };
    var kept = [];
    out.forEach(function (m) {
      var clash = null;
      for (var i = 0; i < kept.length; i++) {
        if (Math.abs(kept[i].t - m.t) < 3600) { clash = i; break; }
      }
      if (clash === null) kept.push(m);
      else if ((rank[m.kind] || 0) > (rank[kept[clash].kind] || 0)) kept[clash] = m;
    });
    return kept;
  };

  /* -------------------------------------------------------------- warnings */

  /* Factual, and only where the numbers are unambiguous. The app is allowed
     to be funny about the weather; it is not allowed to be funny about being
     caught out in it. */
  W.alerts = function (forecast, now) {
    var out = [];
    var soon = W.hoursFrom(forecast, now, 36);
    var todayIndex = W.todayIndex(forecast, now);
    var days = forecast.days.slice(todayIndex, todayIndex + 2);

    function add(kind, title, detail) { out.push({ kind: kind, title: title, detail: detail }); }

    var maxGust = soon.reduce(function (a, h) { return Math.max(a, h.gust); }, 0);
    if (maxGust >= 90) add('wind', 'Severe gusts', 'Gusts near ' + Math.round(maxGust) + ' km/h. Bins, fences and trampolines beware.');
    else if (maxGust >= 70) add('wind', 'Strong winds', 'Gusts up to ' + Math.round(maxGust) + ' km/h in the next day or so.');

    var hottest = days.reduce(function (a, d) { return d.max !== null ? Math.max(a, d.max) : a; }, -99);
    if (hottest >= 35) add('heat', 'Extreme heat', 'Up to ' + Math.round(hottest) + '°. Shade, water, and check on people who need it.');
    else if (hottest >= 30) add('heat', 'Serious heat', 'Up to ' + Math.round(hottest) + '° over the next couple of days.');

    var coldest = days.reduce(function (a, d) { return d.min !== null ? Math.min(a, d.min) : a; }, 99);
    if (coldest <= -8) add('cold', 'Severe cold', 'Down to ' + Math.round(coldest) + '°. Pipes, cars and fingers at risk.');
    else if (coldest <= -3) add('cold', 'Hard frost', 'Down to ' + Math.round(coldest) + '° overnight.');

    var thunder = soon.filter(function (h) { return W.family(h.code) === 'thunder'; });
    if (thunder.length) add('thunder', 'Thunderstorms', 'Storms expected around ' + W.clock(thunder[0].t, forecast.offset, false) + '.');

    var ice = soon.filter(function (h) { return W.family(h.code) === 'ice'; });
    if (ice.length) add('ice', 'Ice', 'Freezing rain around ' + W.clock(ice[0].t, forecast.offset, false) + '. Roads and paths will be lethal.');

    var snowfall = days.reduce(function (a, d) {
      return (W.family(d.code) === 'snow' && d.mm !== null) ? Math.max(a, d.mm) : a;
    }, 0);
    if (snowfall >= 10) add('snow', 'Heavy snow', 'Significant snow expected. Travel will be affected.');

    var rainfall = days.reduce(function (a, d) { return d.mm !== null ? Math.max(a, d.mm) : a; }, 0);
    if (rainfall >= 30) add('rain', 'Very heavy rain', Math.round(rainfall) + ' mm expected in a day. Surface water likely.');

    return out.slice(0, 2);
  };

  /* --------------------------------------------------------- what has been */

  /* The days behind us, which is what makes "first dry day this week" a fact
     rather than a flourish. Needs `past_days` in the request. */
  W.recent = function (forecast, now) {
    var today = W.todayIndex(forecast, now);
    var past = forecast.days.slice(Math.max(0, today - 3), today);
    var greyRun = 0, wetRun = 0, dryRun = 0;
    for (var i = past.length - 1; i >= 0; i--) {
      var fam = W.family(past[i].code);
      var wet = fam === 'rain' || fam === 'showers' || fam === 'downpour' || fam === 'drizzle' || fam === 'snow';
      if (fam === 'grey' || fam === 'cloud' || wet) greyRun++; else break;
    }
    for (var j = past.length - 1; j >= 0; j--) {
      var f2 = W.family(past[j].code);
      if (f2 === 'rain' || f2 === 'showers' || f2 === 'downpour' || f2 === 'drizzle' || f2 === 'snow') wetRun++; else break;
    }
    for (var k = past.length - 1; k >= 0; k--) {
      var f3 = W.family(past[k].code);
      var dry = !(f3 === 'rain' || f3 === 'showers' || f3 === 'downpour' || f3 === 'drizzle' || f3 === 'snow');
      if (dry && (past[k].mm === null || past[k].mm < 1)) dryRun++; else break;
    }
    return { days: past.length, greyRun: greyRun, wetRun: wetRun, dryRun: dryRun };
  };

  /* A small, storable summary of a forecast, so the next one can be compared
     against it. Kept deliberately tiny — it lives in local storage. */
  W.snapshot = function (forecast) {
    return {
      at: forecast.fetchedAt,
      place: forecast.place ? forecast.place.name : '',
      days: forecast.days.map(function (d) {
        return { key: W.dayOf(d.t, forecast.offset), max: d.max, min: d.min, prob: d.prob, code: d.code };
      })
    };
  };

  /* What has actually changed since the last forecast this phone saw. Returns
     nothing at all when there is nothing to compare against — the app never
     invents a change it cannot show its working for. */
  W.changes = function (previous, forecast, now) {
    if (!previous || !previous.days || !previous.days.length) return [];
    if (previous.place && forecast.place && previous.place !== forecast.place.name) return [];
    /* Two readings minutes apart are the same forecast; give it an hour. */
    if (forecast.fetchedAt - previous.at < 3600) return [];

    var out = [];
    var todayKey = W.dayOf(now, forecast.offset);
    var byKey = {};
    previous.days.forEach(function (d) { byKey[d.key] = d; });

    for (var i = 0; i < forecast.days.length && out.length < 2; i++) {
      var day = forecast.days[i];
      var key = W.dayOf(day.t, forecast.offset);
      /* Only today and the two days after it: a change to next Tuesday is not
         news, it is a forecast doing its job. */
      if (key < todayKey || key > todayKey + 2) continue;
      var was = byKey[key];
      if (!was || was.max === null || day.max === null) continue;

      var when = key === todayKey ? 'today' : (key === todayKey + 1 ? 'tomorrow' : W.dayName(day.t, forecast.offset));
      var warmer = day.max - was.max;
      if (warmer >= 3) out.push({ kind: 'warmer', when: when, by: Math.round(warmer) });
      else if (warmer <= -3) out.push({ kind: 'colder', when: when, by: Math.round(-warmer) });

      if (was.prob !== null && day.prob !== null) {
        var wetter = day.prob - was.prob;
        if (wetter >= 30) out.push({ kind: 'wetter', when: when, by: Math.round(wetter) });
        else if (wetter <= -30) out.push({ kind: 'dryer', when: when, by: Math.round(-wetter) });
      }
    }
    return out.slice(0, 2);
  };

  root.Weather = W;

})(typeof self !== 'undefined' ? self : this);
