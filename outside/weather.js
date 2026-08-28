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

  /* How far into the future a day is allowed to pretend to know things.
     Nothing in the app claims day fifteen is as solid as tomorrow. */
  W.confidence = function (index) {
    if (index <= 2) return { tier: 'near', label: 'Pretty confident' };
    if (index <= 6) return { tier: 'mid', label: 'Fair bet' };
    return { tier: 'far', label: 'Best guess' };
  };

  root.Weather = W;

})(typeof self !== 'undefined' ? self : this);
