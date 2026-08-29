/* The test suite.

   Serves the web app over localhost, drives it in Chromium with the forecast
   stubbed, and asserts on the arithmetic (pure, callable directly), the mouth
   (also pure), and the screen (not).

   It tests the web app, which is the app: the iOS and Android builds ship the
   same files with a native bridge attached, so everything proved here is
   proved for all three. What it cannot reach is the bridge itself — a share
   sheet and a location prompt only exist on a real phone — and those are in
   the device checklist in mobile/README.md instead.

   Run it with `npm test` from mobile/. */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

/* mobile/tests → outside/ */
const ROOT = path.resolve(__dirname, '..', '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };

let pass = 0, fail = 0;
const failures = [];

function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; failures.push(name + (detail ? ' — ' + detail : '')); console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}
function eq(name, got, want) {
  ok(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + ', wanted ' + JSON.stringify(want));
}

function serve() {
  const server = http.createServer((req, res) => {
    let file = decodeURIComponent(req.url.split('?')[0]);
    if (file === '/') file = '/index.html';
    fs.readFile(path.join(ROOT, file), (err, data) => {
      if (err) { res.writeHead(404); res.end('no'); return; }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'text/plain' });
      res.end(data);
    });
  });
  return new Promise(resolve => server.listen(0, () => resolve(server)));
}

/* ------------------------------------------------------------ the stub sky */

function topOfHour() { return Math.floor(Date.now() / 1000 / 3600) * 3600; }

/* Builds a whole API answer: 15 days of daily, hours across them, and a
   current block. `hourAt(i)` describes the i-th hour from the start. */
function makeForecast(start, opts) {
  opts = opts || {};
  const offset = opts.offset === undefined ? 0 : opts.offset;
  const hourCount = opts.hours || 72;
  const hourAt = opts.hourAt || (() => ({ t: 14, c: 3 }));
  const dayAt = opts.dayAt || (i => ({ max: 15, min: 8, c: 3, p: 20 }));

  const H = { time: [], temperature_2m: [], apparent_temperature: [], relative_humidity_2m: [],
    precipitation_probability: [], precipitation: [], weather_code: [], wind_speed_10m: [],
    wind_gusts_10m: [], visibility: [], is_day: [] };

  for (let i = 0; i < hourCount; i++) {
    const h = hourAt(i);
    H.time.push(start + i * 3600);
    H.temperature_2m.push(h.t);
    H.apparent_temperature.push(h.f === undefined ? h.t : h.f);
    H.relative_humidity_2m.push(h.hum === undefined ? 70 : h.hum);
    H.precipitation_probability.push(h.p || 0);
    H.precipitation.push(h.mm || 0);
    H.weather_code.push(h.c === undefined ? 3 : h.c);
    H.wind_speed_10m.push(h.w === undefined ? 10 : h.w);
    H.wind_gusts_10m.push(h.g === undefined ? (h.w === undefined ? 16 : h.w + 6) : h.g);
    H.visibility.push(h.vis === undefined ? 24000 : h.vis);
    H.is_day.push(h.n ? 0 : 1);
  }

  const D = { time: [], weather_code: [], temperature_2m_max: [], temperature_2m_min: [],
    apparent_temperature_max: [], sunrise: [], sunset: [], precipitation_probability_max: [],
    precipitation_sum: [], wind_speed_10m_max: [], wind_gusts_10m_max: [], uv_index_max: [] };

  /* The app asks for three days of history as well as fifteen ahead, so the
     stub starts three days back and today is day three. */
  const midnight = Math.floor((start + offset) / 86400) * 86400 - offset - 3 * 86400;
  for (let i = 0; i < 18; i++) {
    const d = dayAt(i - 3);
    D.time.push(midnight + i * 86400);
    D.weather_code.push(d.c === undefined ? 3 : d.c);
    D.temperature_2m_max.push(d.max);
    D.temperature_2m_min.push(d.min);
    D.apparent_temperature_max.push(d.feels === undefined ? d.max - 1 : d.feels);
    D.sunrise.push(midnight + i * 86400 + 6 * 3600);
    D.sunset.push(midnight + i * 86400 + (opts.sunsetHour === undefined ? 20 : opts.sunsetHour) * 3600);
    /* Beyond a week the model stops offering a probability at all. */
    D.precipitation_probability_max.push(d.p === undefined ? null : d.p);
    D.precipitation_sum.push(d.mm === undefined ? 0 : d.mm);
    D.wind_speed_10m_max.push(d.w === undefined ? 18 : d.w);
    D.wind_gusts_10m_max.push(d.g === undefined ? 30 : d.g);
    D.uv_index_max.push(3);
  }

  const c = opts.current || hourAt(0);
  return {
    utc_offset_seconds: offset,
    current: {
      time: start + 60,
      temperature_2m: c.t,
      apparent_temperature: c.f === undefined ? c.t : c.f,
      relative_humidity_2m: c.hum === undefined ? 70 : c.hum,
      precipitation: c.mm || 0,
      weather_code: c.c === undefined ? 3 : c.c,
      wind_speed_10m: c.w === undefined ? 10 : c.w,
      wind_gusts_10m: c.g === undefined ? 16 : c.g,
      is_day: c.n ? 0 : 1
    },
    hourly: H,
    daily: D
  };
}

const CLEAR_DAY = { t: 21, f: 21, c: 0, p: 0, hum: 55 };
const WET_DAY = { t: 11, f: 9, c: 63, p: 90, mm: 2.2, w: 24 };

async function main() {
  const server = await serve();
  const base = 'http://127.0.0.1:' + server.address().port + '/';
  /* PLAYWRIGHT_BROWSERS_PATH points at a shared browser on some machines and
     nothing at all on others, so an explicitly installed Chromium wins where
     there is one and Playwright's own is used everywhere else. */
  const shared = process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium';
  const browser = await chromium.launch(fs.existsSync(shared) ? { executablePath: shared } : {});

  const errors = [];
  const context = await browser.newContext({ serviceWorkers: 'block', permissions: [] });
  const page = await context.newPage();
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));

  let stub = null;
  await context.route('https://api.open-meteo.com/**', route => {
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(stub) });
  });
  await context.route('https://geocoding-api.open-meteo.com/**', route => {
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ results: [{ name: 'Ilkley', admin1: 'England', country: 'United Kingdom', latitude: 53.925, longitude: -1.822 }] })
    });
  });

  const start = topOfHour();
  stub = makeForecast(start, { hourAt: () => CLEAR_DAY, dayAt: () => ({ max: 21, min: 12, c: 0, p: 10 }) });

  await page.goto(base + 'index.html');
  await page.waitForFunction(() => !!(window.Weather && window.Voice && window.Brand));

  /* --------------------------------------------------------- suite: parsing */

  console.log('\nreading the forecast');
  const parsed = await page.evaluate(({ start, stubJson }) => {
    const W = window.Weather;
    const json = JSON.parse(stubJson);
    const f = W.parse(json, { name: 'Test' });

    /* the same forecast written the other documented way */
    const asStrings = JSON.parse(stubJson);
    const iso = t => new Date((t + json.utc_offset_seconds) * 1000).toISOString().slice(0, 16);
    asStrings.hourly.time = json.hourly.time.map(iso);
    asStrings.daily.time = json.daily.time.map(iso);
    asStrings.daily.sunrise = json.daily.sunrise.map(iso);
    asStrings.daily.sunset = json.daily.sunset.map(iso);
    asStrings.current.time = iso(json.current.time);
    const g = W.parse(asStrings, {});

    const out = {
      days: f.days.length,
      hours: f.hours.length,
      firstHour: f.hours[0].t - start,
      current: !!f.current && f.current.temp,
      stringsMatch: g.hours[0].t === f.hours[0].t && g.days[3].t === f.days[3].t,
      fields: {
        temp: f.hours[0].temp, feels: f.hours[0].feels, prob: f.hours[0].prob,
        code: f.hours[0].code, humidity: f.hours[0].humidity, day: f.hours[0].day
      }
    };

    /* a long-range day with no probability keeps the gap rather than pretending */
    const gappy = JSON.parse(stubJson);
    gappy.daily.precipitation_probability_max[15] = null;
    out.nullKept = W.parse(gappy, {}).days[15].prob;

    try { W.parse({ hourly: { time: ['nonsense'] } }, {}); out.rubbish = 'accepted'; }
    catch (e) { out.rubbish = 'refused'; }
    try { W.parse({ nothing: true }, {}); out.empty = 'accepted'; }
    catch (e) { out.empty = 'refused'; }
    try { W.parse({ hourly: { time: [start], temperature_2m: [10] } }, {}); out.noDays = 'accepted'; }
    catch (e) { out.noDays = 'refused'; }
    return out;
  }, { start, stubJson: JSON.stringify(stub) });

  eq('fifteen days ahead plus three behind', parsed.days, 18);
  ok('and the hours with them', parsed.hours >= 72, String(parsed.hours));
  eq('the first hour is where it should be', parsed.firstHour, 0);
  eq('the current block is read', parsed.current, 21);
  ok('both documented time formats land on the same instants', parsed.stringsMatch);
  eq('every field is read off the right hour', parsed.fields,
    { temp: 21, feels: 21, prob: 0, code: 0, humidity: 55, day: 1 });
  eq('a long-range day with no rain figure keeps the gap', parsed.nullKept, null);
  eq('rubbish stamps are refused', parsed.rubbish, 'refused');
  eq('an empty answer is refused', parsed.empty, 'refused');
  eq('an answer with no days is refused', parsed.noDays, 'refused');

  /* ----------------------------------------------------------- suite: icons */

  console.log('\nwhat the hour looks like');
  const icons = await page.evaluate(() => {
    const W = window.Weather;
    const h = over => Object.assign({ t: 0, temp: 15, feels: 15, prob: 5, mm: 0, code: 0, wind: 8, gust: 12, day: 1, humidity: 60 }, over);
    return {
      shades: W.icon(h({ code: 0, feels: 24 })),
      sun: W.icon(h({ code: 1, feels: 14 })),
      scarfClear: W.icon(h({ code: 0, feels: 3 })),
      brolly: W.icon(h({ code: 63, mm: 2 })),
      rain: W.icon(h({ code: 61, mm: 0.4 })),
      drizzle: W.icon(h({ code: 53, mm: 0.1 })),
      likely: W.icon(h({ code: 3, prob: 70 })),
      thunder: W.icon(h({ code: 95 })),
      snow: W.icon(h({ code: 73 })),
      ice: W.icon(h({ code: 66 })),
      fog: W.icon(h({ code: 45 })),
      gale: W.icon(h({ code: 3, gust: 70 })),
      freezing: W.icon(h({ code: 3, feels: -3 })),
      boiling: W.icon(h({ code: 1, feels: 33 })),
      night: W.icon(h({ code: 0, day: 0 })),
      grey: W.icon(h({ code: 3 })),
      partly: W.icon(h({ code: 2 })),
      coat: W.icon(h({ code: 3, feels: 9, gust: 40 })),
      dayHot: W.dayIcon({ code: 0, max: 31, min: 18, gust: 20 }),
      dayWet: W.dayIcon({ code: 61, max: 12, min: 7, gust: 20 }),
      dayClear: W.dayIcon({ code: 0, max: 22, min: 12, gust: 15 })
    };
  });

  eq('sunglasses for weather you would squint in', icons.shades, '😎');
  eq('a sun for bright but ordinary', icons.sun, '☀️');
  eq('a scarf for bright and freezing', icons.scarfClear, '🧣');
  eq('an umbrella for proper rain', icons.brolly, '☔');
  eq('rain for light rain', icons.rain, '🌧️');
  eq('drizzle gets its own', icons.drizzle, '🌦️');
  eq('an umbrella when rain is likely but not here yet', icons.likely, '☔');
  eq('thunder beats everything', icons.thunder, '⛈️');
  eq('snow', icons.snow, '❄️');
  eq('ice', icons.ice, '🧊');
  eq('fog', icons.fog, '🌫️');
  eq('wind when the wind is the story', icons.gale, '💨');
  eq('a cold face below zero', icons.freezing, '🥶');
  eq('a hot face above thirty', icons.boiling, '🥵');
  eq('a moon at night', icons.night, '🌙');
  eq('cloud for grey', icons.grey, '☁️');
  eq('sun and cloud for partly cloudy', icons.partly, '⛅');
  eq('a coat for cold and blowy', icons.coat, '🧥');
  eq('a hot day', icons.dayHot, '🥵');
  eq('a wet day', icons.dayWet, '🌧️');
  eq('a clear warm day', icons.dayClear, '😎');

  /* ----------------------------------------------------------- suite: mouth */

  console.log('\nthe mouth');
  const voice = await page.evaluate(({ start }) => {
    const W = window.Weather, V = window.Voice;
    const midnight = Math.floor(start / 86400) * 86400;

    /* A forecast pinned to a chosen local hour, so morning means morning. */
    function at(hour, over, dayOver) {
      const hours = [];
      for (let i = 0; i < 30; i++) {
        hours.push(Object.assign({
          t: midnight + (hour + i) * 3600, temp: 15, feels: 15, humidity: 60,
          prob: 0, mm: 0, code: 3, wind: 10, gust: 15, visibility: 20000, day: 1
        }, over));
      }
      const days = [];
      for (let i = 0; i < 15; i++) {
        days.push(Object.assign({
          t: midnight + i * 86400, code: 3, max: 15, min: 8, feelsMax: 14,
          sunrise: midnight + i * 86400 + 6 * 3600, sunset: midnight + i * 86400 + 20 * 3600,
          prob: 20, mm: 0, wind: 15, gust: 25, uv: 3
        }, dayOver || {}));
      }
      const f = { offset: 0, fetchedAt: start, place: {}, hours: hours, days: days, current: null };
      f.current = {
        t: midnight + hour * 3600, temp: hours[0].temp, feels: hours[0].feels,
        humidity: hours[0].humidity, mm: hours[0].mm, code: hours[0].code,
        wind: hours[0].wind, gust: hours[0].gust, day: hours[0].day
      };
      return f;
    }
    const S = { units: 'metric', ampm: false, sweary: true };
    const clean = { units: 'metric', ampm: false, sweary: false };
    const head = (hour, over, settings) => V.headline(at(hour, over), settings || S, midnight + hour * 3600);

    const out = {};
    out.morningSun = head(8, { code: 0, temp: 20, feels: 20 });
    out.rain = head(9, { code: 63, mm: 2, prob: 90, temp: 11, feels: 9 });
    out.grey = head(14, { code: 3, temp: 12, feels: 11 });
    out.thunder = head(15, { code: 95, mm: 4, prob: 95 });
    out.snow = head(10, { code: 73, temp: -1, feels: -4 });
    out.gale = head(13, { code: 3, gust: 75 });
    out.scorching = head(14, { code: 0, temp: 34, feels: 34 });
    out.freezing = head(7, { code: 3, temp: -4, feels: -6 });
    out.night = head(23, { code: 0, day: 0, temp: 8, feels: 7 });
    out.fog = head(9, { code: 45 });

    /* stability and rotation */
    out.stable = head(8, { code: 0, temp: 20, feels: 20 }).text === out.morningSun.text;
    const seen = {};
    for (let d = 0; d < 40; d++) {
      const f = at(8, { code: 0, temp: 20, feels: 20 });
      const shifted = { offset: 0, fetchedAt: start, place: {}, current: f.current,
        hours: f.hours.map(h => Object.assign({}, h, { t: h.t + d * 86400 })),
        days: f.days };
      seen[V.headline(shifted, S, midnight + d * 86400 + 8 * 3600).text] = true;
    }
    out.variety = Object.keys(seen).length;

    /* the clean twin says the same thing without the mouth */
    out.cleanMorning = head(8, { code: 0, temp: 20, feels: 20 }, clean).text;

    /* every line in the app, walked */
    const banks = V.banks;
    const flat = [];
    [banks.LINES, banks.DAY_LINES, banks.MOMENTS].forEach(group => {
      Object.keys(group).forEach(key => group[key].forEach(pair => flat.push([key, pair])));
    });
    banks.ERRORS.forEach(p => flat.push(['error', p]));
    banks.NO_PLACE.forEach(p => flat.push(['noplace', p]));

    /* Word boundaries matter: SCRAPER is not swearing. */
    const swears = /\b(fuck|shit|bastard|bollock|arse|piss|wank|twat|bugger|crap|bloody|damn|sod)\w*/i;
    out.lineCount = flat.length;
    out.malformed = flat.filter(([, p]) => !Array.isArray(p) || p.length !== 2 || !p[0] || !p[1]).length;
    out.dirtyClean = flat.filter(([, p]) => swears.test(p[1])).map(([k, p]) => k + ': ' + p[1]);
    out.swearyShare = flat.filter(([, p]) => swears.test(p[0])).length / flat.length;
    /* a clean twin that is just the sweary one with the word deleted is not a
       clean twin — check the ones that differ actually read as sentences */
    out.emptyish = flat.filter(([, p]) => p[1].length < 8).length;
    /* A day line shares a narrow column with the numbers: two short lines. */
    out.longestDayLine = Math.max.apply(null, Object.keys(banks.DAY_LINES)
      .map(k => banks.DAY_LINES[k].map(p => Math.max(p[0].length, p[1].length)))
      .reduce((a, b) => a.concat(b), []));
    return out;
  }, { start });

  ok('a sunny morning gets a sunny morning line', /MORNING|SUNSHINE|GORGEOUS/.test(voice.morningSun.text), voice.morningSun.text);
  eq('and it knows why it said it', voice.morningSun.kind, 'glorious');
  ok('rain gets a rain line', voice.rain.kind === 'rain', voice.rain.kind + ' / ' + voice.rain.text);
  ok('and never claims the sun is out', !/SUN|SUNSHINE|LOVELY|GORGEOUS/.test(voice.rain.text), voice.rain.text);
  ok('grey gets a grey line', voice.grey.kind === 'grey', voice.grey.text);
  ok('grey never claims the sun is out', !/SUN|BLUE SKY/.test(voice.grey.text), voice.grey.text);
  eq('thunder wins over everything else', voice.thunder.kind, 'thunder');
  eq('snow wins too', voice.snow.kind, 'snow');
  eq('a gale is a gale', voice.gale.kind, 'gale');
  eq('34 degrees is scorching', voice.scorching.kind, 'scorching');
  eq('minus six is freezing', voice.freezing.kind, 'freezing');
  eq('a clear night knows it is night', voice.night.kind, 'night.clear');
  eq('fog', voice.fog.kind, 'fog');
  ok('the same hour says the same thing twice', voice.stable);
  ok('but the same weather does not say it forever', voice.variety >= 2, voice.variety + ' distinct lines over 40 days');
  ok('the clean twin is a real line', voice.cleanMorning.length > 10 && !/FUCK/.test(voice.cleanMorning), voice.cleanMorning);
  ok('every line is a proper pair', voice.malformed === 0, String(voice.malformed) + ' malformed');
  ok('no clean line swears', voice.dirtyClean.length === 0, voice.dirtyClean.join(' | '));
  ok('no line is a stub', voice.emptyish === 0, String(voice.emptyish));
  ok('day lines fit the narrow column they live in',
    voice.longestDayLine <= 30, 'longest is ' + voice.longestDayLine + ' characters');
  ok('swearing is seasoning, not the meal',
    voice.swearyShare > 0.05 && voice.swearyShare < 0.5,
    Math.round(voice.swearyShare * 100) + '% of lines swear');

  /* --------------------------------------------------------- suite: moments */

  console.log('\nthe little moments');
  const moments = await page.evaluate(({ start }) => {
    const W = window.Weather, V = window.Voice;
    const midnight = Math.floor(start / 86400) * 86400;
    const S = { units: 'metric', ampm: false, sweary: true };

    function build(hourSpec, daySpec, hour) {
      hour = hour === undefined ? 10 : hour;
      const hours = [];
      for (let i = 0; i < 40; i++) {
        hours.push(Object.assign({
          t: midnight + (hour + i) * 3600, temp: 14, feels: 13, humidity: 65,
          prob: 0, mm: 0, code: 3, wind: 10, gust: 15, visibility: 20000, day: 1
        }, hourSpec(i)));
      }
      const days = [];
      for (let i = 0; i < 15; i++) {
        days.push(Object.assign({
          t: midnight + i * 86400, code: 3, max: 15, min: 8, feelsMax: 14,
          sunrise: midnight + i * 86400 + 6 * 3600, sunset: midnight + i * 86400 + 20 * 3600,
          prob: 20, mm: 0, wind: 15, gust: 25, uv: 3
        }, daySpec(i)));
      }
      const f = { offset: 0, fetchedAt: start, place: {}, hours: hours, days: days };
      f.current = Object.assign({}, hours[0]);
      return V.moments(f, S, midnight + hour * 3600).map(m => m.key + '|' + m.text);
    }

    return {
      /* raining now, dry from the fourth hour */
      rainEnding: build(i => (i < 3 ? { code: 63, mm: 2, prob: 90 } : {}), () => ({})),
      /* dry now, wet later */
      rainComing: build(i => (i >= 4 ? { code: 63, mm: 2, prob: 90 } : {}), () => ({})),
      /* tomorrow six degrees warmer */
      better: build(() => ({}), i => (i === 0 ? { max: 12, prob: 80 } : { max: 20, prob: 5 })),
      /* tomorrow much colder and wetter */
      worse: build(() => ({}), i => (i === 0 ? { max: 22, prob: 5 } : { max: 12, prob: 90, code: 63 })),
      /* a proper hot spell */
      heat: build(() => ({}), i => ({ max: i >= 1 && i <= 4 ? 31 : 20, min: 15 })),
      /* and a proper cold one */
      cold: build(() => ({}), i => ({ max: 2, min: i >= 1 && i <= 4 ? -5 : 1 }))
    };
  }, { start });

  ok('it spots the rain stopping, with a time', /rainEnding\|.*\d\d:\d\d/.test(moments.rainEnding.join(' ')), moments.rainEnding.join(' '));
  ok('and the rain arriving', /rainComing\|.*\d\d:\d\d/.test(moments.rainComing.join(' ')), moments.rainComing.join(' '));
  ok('a much better tomorrow', /betterTomorrow/.test(moments.better.join(' ')), moments.better.join(' '));
  ok('a much worse one', /worseTomorrow/.test(moments.worse.join(' ')), moments.worse.join(' '));
  ok('a hot spell coming', /heatwave/.test(moments.heat.join(' ')), moments.heat.join(' '));
  ok('a cold snap coming', /coldSnap/.test(moments.cold.join(' ')), moments.cold.join(' '));
  ok('never more than two at once', moments.rainEnding.length <= 2 && moments.better.length <= 2);

  /* ---------------------------------------------------- suite: units, clocks */

  console.log('\nunits and clocks');
  const units = await page.evaluate(({ start }) => {
    const W = window.Weather;
    const offset = 9 * 3600;
    const nineAm = Math.floor((start + offset) / 86400) * 86400 - offset + 9 * 3600;
    return {
      c: W.temp(21.4, 'metric'), f: W.temp(21.4, 'imperial'),
      kmh: W.speed(32, 'metric'), mph: W.speed(32, 'imperial'),
      km: W.distance(24000, 'metric'), mi: W.distance(24000, 'imperial'),
      missing: W.temp(null, 'metric'),
      clock: W.clock(nineAm, offset, false), ampm: W.clock(nineAm, offset, true),
      utc: W.clock(nineAm, 0, false)
    };
  }, { start });

  eq('celsius', units.c, '21°');
  eq('fahrenheit', units.f, '71°');
  eq('km/h', units.kmh, '32 km/h');
  eq('mph', units.mph, '20 mph');
  eq('kilometres', units.km, '24 km');
  eq('miles', units.mi, '15 mi');
  eq('a missing number is a dash, not a zero', units.missing, '—');
  eq('the clock reads where the weather is', units.clock, '09:00');
  eq('am/pm too', units.ampm, '9am');
  eq('and the same instant is another hour in UTC', units.utc, '00:00');

  /* ---------------------------------------------------------- suite: screen */

  console.log('\nthe screen');

  /* Pin the stub's timezone so that "now, where the weather is" is always
     early morning, whatever time of day the suite happens to be run at.

     Everything this suite asserts about the rest of today — the best bit, the
     worst bit, the timeline, the brief — needs some of today left to be about.
     Run at nine in the evening the stub had three hours in it, all identical,
     and the app quite correctly declined to name a best and a worst among
     three of the same hour. That is the app being right and the test being
     written at eleven in the morning. */
  const localNow = 8 * 3600;
  const offset = localNow - (Math.floor(Date.now() / 1000) % 86400);

  stub = makeForecast(start, {
    offset,
    hourAt: i => (i < 3 ? { t: 19, f: 19, c: 0, p: 0, hum: 52 } : (i < 8 ? { t: 16, f: 15, c: 61, p: 80, mm: 1.2 } : { t: 13, f: 12, c: 3, p: 20, n: i % 24 > 20 ? 1 : 0 })),
    dayAt: i => ({ max: 21 - i, min: 11 - i / 2, c: i % 3 === 0 ? 0 : (i % 3 === 1 ? 61 : 3), p: i > 7 ? null : 10 + i * 5 }),
    current: { t: 19, f: 19, c: 0, hum: 52, w: 12, g: 20 }
  });

  await page.evaluate(() => localStorage.clear());
  await page.goto(base + 'index.html');
  await page.evaluate(() => localStorage.setItem('weatherApp.v1', JSON.stringify({
    place: { name: 'Ilkley', where: 'England', lat: 53.9, lon: -1.8 }, sweary: true
  })));
  await page.reload();
  await page.waitForSelector('#hero:not([hidden])', { timeout: 5000 });

  const screen = await page.evaluate(() => ({
    title: document.title,
    place: document.getElementById('placeName').textContent,
    shout: document.getElementById('shout').textContent,
    temp: document.getElementById('nowTemp').textContent,
    unit: document.getElementById('nowUnit').textContent,
    icon: document.getElementById('nowIcon').textContent,
    feels: document.getElementById('nowFeels').textContent,
    cond: document.getElementById('nowCond').textContent,
    brief: document.getElementById('briefText').textContent,
    mood: document.getElementById('moodText').textContent,
    timeline: Array.from(document.querySelectorAll('#timeline .move')).map(m => m.textContent),
    bits: Array.from(document.querySelectorAll('.bit')).map(b =>
      b.querySelector('.bit-label').textContent + '@' + b.querySelector('.bit-when b').textContent),
    tomorrow: {
      high: document.getElementById('tomHigh').textContent,
      low: document.getElementById('tomLow').textContent,
      line: document.getElementById('tomLine').textContent,
      rain: document.getElementById('tomRain').textContent
    },
    facts: Array.from(document.querySelectorAll('#facts .fact')).map(f =>
      f.querySelector('.fact-label').textContent + '=' + f.querySelector('.fact-value').textContent),
    hours: document.querySelectorAll('#hours .hr').length,
    firstHourLabel: document.querySelector('#hours .hr .hr-time').textContent,
    days: document.querySelectorAll('#dayList .day').length,
    tiers: Array.from(document.querySelectorAll('#dayList .tier')).map(t => t.textContent),
    firstDay: document.querySelector('#dayList .day .day-when b').textContent,
    secondDay: document.querySelectorAll('#dayList .day .day-when b')[1].textContent,
    dayLines: Array.from(document.querySelectorAll('.day-line')).filter(l => l.textContent.length > 3).length,
    farRain: Array.from(document.querySelectorAll('.day-rain')).slice(-3).map(r => r.textContent),
    moments: document.querySelectorAll('.moment').length,
    troubleHidden: document.getElementById('trouble').hidden
  }));

  eq('the app is named', screen.title, 'Blooming Weather');
  eq('the place is on screen', screen.place, 'Ilkley');
  ok('the headline shouts', screen.shout.length > 10 && screen.shout === screen.shout.toUpperCase(), screen.shout);
  eq('the temperature is the hero', screen.temp, '19');
  eq('with its unit', screen.unit, '°C');
  ok('the current icon is a picture', screen.icon.length > 0, screen.icon);
  ok('feels-like sits under the temperature', /Feels like/.test(screen.feels), screen.feels);
  ok('and the condition is named in words', /Clear/.test(screen.cond), screen.cond);
  ok('the facts are all there', screen.facts.length >= 9, screen.facts.join(', '));
  ok('feels like', screen.facts.some(f => /^Feels like=/.test(f)), screen.facts.join(', '));
  ok('humidity', screen.facts.some(f => /^Humidity=52%/.test(f)), screen.facts.join(', '));
  ok('wind', screen.facts.some(f => /^Wind=12 km\/h/.test(f)), screen.facts.join(', '));
  ok('rain chance', screen.facts.some(f => /^Rain chance=/.test(f)), screen.facts.join(', '));
  ok('sunrise and sunset', screen.facts.some(f => /^Sunrise=/.test(f)) && screen.facts.some(f => /^Sunset=/.test(f)), screen.facts.join(', '));
  ok('visibility', screen.facts.some(f => /^Visibility=/.test(f)), screen.facts.join(', '));
  eq('twenty-four hours are drawn', screen.hours, 24);
  eq('the first one is now', screen.firstHourLabel, 'Now');
  eq('fifteen days are drawn', screen.days, 15);
  eq('and labelled by how much it knows', screen.tiers,
    ['High confidence', 'Good confidence', 'Lower confidence']);
  eq('today is called today', screen.firstDay, 'Today');
  eq('and tomorrow tomorrow', screen.secondDay, 'Tomorrow');
  eq('every day has something to say', screen.dayLines, 15);
  eq('the far days show a dash rather than a made-up number', screen.farRain, ['—', '—', '—']);
  ok('a moment or two is surfaced', screen.moments >= 1, String(screen.moments));

  /* how's it looking, sky mood, timeline, best/worst, tomorrow */
  ok('the plain-English brief reads like a person wrote it',
    /\.$/.test(screen.brief) && screen.brief.split(' ').length >= 6, screen.brief);
  ok('and it does not swear at you in the useful bit',
    !/\b(fuck|shit|bastard|arse|bloody)\w*/i.test(screen.brief), screen.brief);
  ok('the sky has a mood', screen.mood.length > 5, screen.mood);
  ok('the timeline names what changes and when',
    screen.timeline.length >= 1 && /\d\d:\d\d|Steady/.test(screen.timeline.join(' ')), screen.timeline.join(' | '));
  eq('today has a best bit and a worst bit', screen.bits.length, 2);
  ok('both are pinned to an hour', screen.bits.every(b => /@\d\d:\d\d/.test(b)), screen.bits.join(', '));
  ok('tomorrow gets its own preview', screen.tomorrow.high !== '—' && screen.tomorrow.line.length > 5,
    JSON.stringify(screen.tomorrow));
  ok('with its rain chance spelled out', /%|not known/.test(screen.tomorrow.rain), screen.tomorrow.rain);
  ok('no trouble card while there is weather', screen.troubleHidden);

  /* the day sheet */
  await page.click('#dayList .day:nth-of-type(2) .day-btn');
  await page.waitForSelector('#daySheet[open]');
  const sheet = await page.evaluate(() => ({
    title: document.getElementById('dayTitle').textContent,
    shout: document.getElementById('dayShout').textContent,
    facts: Array.from(document.querySelectorAll('#dayFacts .fact')).map(f => f.querySelector('.fact-label').textContent),
    hours: document.querySelectorAll('#dayHours .hr').length,
    confidence: document.getElementById('dayConfidence').textContent
  }));
  ok('a day opens with its own detail', /Today|Tomorrow|day/i.test(sheet.title), sheet.title);
  ok('and its own line', sheet.shout.length > 3, sheet.shout);
  ok('with the numbers', sheet.facts.indexOf('High') >= 0 && sheet.facts.indexOf('Low') >= 0, sheet.facts.join(','));
  ok('near days carry their hours', sheet.hours > 0, String(sheet.hours));
  ok('and say how much they are guessing', /confidence/i.test(sheet.confidence), sheet.confidence);
  await page.evaluate(() => document.getElementById('daySheet').close());

  /* ---------------------------------------------------------- suite: alerts */

  console.log('\nwarnings');
  const alerts = await page.evaluate(({ start }) => {
    const W = window.Weather, V = window.Voice;
    const midnight = Math.floor(start / 86400) * 86400;
    function build(hourSpec, daySpec) {
      const hours = [], days = [];
      for (let i = 0; i < 40; i++) {
        hours.push(Object.assign({ t: midnight + (10 + i) * 3600, temp: 14, feels: 13, humidity: 65,
          prob: 0, mm: 0, code: 3, wind: 10, gust: 15, visibility: 20000, day: 1 }, hourSpec(i)));
      }
      for (let i = 0; i < 15; i++) {
        days.push(Object.assign({ t: midnight + i * 86400, code: 3, max: 15, min: 8, feelsMax: 14,
          sunrise: midnight + i * 86400 + 6 * 3600, sunset: midnight + i * 86400 + 20 * 3600,
          prob: 20, mm: 0, wind: 15, gust: 25, uv: 3 }, daySpec(i)));
      }
      const f = { offset: 0, fetchedAt: start, place: {}, hours: hours, days: days };
      f.current = Object.assign({}, hours[0]);
      return W.alerts(f, midnight + 10 * 3600);
    }
    const S = { units: 'metric', ampm: false, sweary: true };
    return {
      calm: build(() => ({}), () => ({})),
      gale: build(i => ({ gust: 95 }), () => ({})),
      heat: build(() => ({}), i => (i === 0 ? { max: 36, min: 22 } : {})),
      freeze: build(() => ({}), i => (i === 0 ? { max: 1, min: -9 } : {})),
      storm: build(i => (i === 3 ? { code: 95, mm: 5, prob: 90 } : {}), () => ({})),
      deluge: build(() => ({}), i => (i === 0 ? { mm: 42, code: 65, prob: 100 } : {})),
      head: V.alertHead({ kind: 'wind' }, S)
    };
  }, { start });

  eq('a quiet day gets no warnings', alerts.calm.length, 0);
  ok('a gale is warned about, with the number', /95|9\d/.test(JSON.stringify(alerts.gale)), JSON.stringify(alerts.gale));
  ok('serious heat', /heat/i.test(JSON.stringify(alerts.heat)), JSON.stringify(alerts.heat));
  ok('severe cold', /cold|frost/i.test(JSON.stringify(alerts.freeze)), JSON.stringify(alerts.freeze));
  ok('thunderstorms, with a time', /Storms expected around \d\d:\d\d/.test(JSON.stringify(alerts.storm)), JSON.stringify(alerts.storm));
  ok('very heavy rain', /heavy rain/i.test(JSON.stringify(alerts.deluge)), JSON.stringify(alerts.deluge));
  ok('the warning detail never swears',
    !/\b(fuck|shit|bastard|arse|bloody)\w*/i.test(JSON.stringify([alerts.gale, alerts.heat, alerts.storm])),
    JSON.stringify(alerts.gale));
  ok('but the lead-in has a bit of personality', alerts.head.length > 4, alerts.head);

  /* ------------------------------------------------ suite: special moments */

  console.log('\nspecial moments');
  const specials = await page.evaluate(({ start }) => {
    const W = window.Weather, V = window.Voice;
    const midnight = Math.floor(start / 86400) * 86400;
    const S = { units: 'metric', ampm: false, sweary: true };
    /* Three days of history sit before today, exactly as the API returns. */
    function build(hourSpec, daySpec, hour) {
      hour = hour === undefined ? 10 : hour;
      const hours = [], days = [];
      for (let i = 0; i < 40; i++) {
        hours.push(Object.assign({ t: midnight + (hour + i) * 3600, temp: 14, feels: 13, humidity: 65,
          prob: 0, mm: 0, code: 3, wind: 10, gust: 15, visibility: 20000, day: 1 }, hourSpec(i)));
      }
      for (let i = -3; i < 15; i++) {
        days.push(Object.assign({ t: midnight + i * 86400, code: 3, max: 15, min: 8, feelsMax: 14,
          sunrise: midnight + i * 86400 + 6 * 3600, sunset: midnight + i * 86400 + 20 * 3600,
          prob: 20, mm: 0, wind: 15, gust: 25, uv: 3 }, daySpec(i)));
      }
      const f = { offset: 0, fetchedAt: start, place: {}, hours: hours, days: days };
      f.current = Object.assign({}, hours[0]);
      return V.moments(f, S, midnight + hour * 3600).map(m => m.key + '|' + m.text);
    }
    return {
      sunAfterRain: build(i => (i < 3 ? { code: 63, mm: 2, prob: 90 } : { code: 0 }), () => ({})),
      firstSun: build(() => ({ code: 0 }), i => (i < 0 ? { code: 3 } : (i === 0 ? { code: 0 } : {}))),
      firstRain: build(() => ({}), i => (i < 0 ? { code: 0, mm: 0, prob: 5 } : (i === 0 ? { code: 63, prob: 85 } : {}))),
      jump: build(() => ({}), i => (i === -1 ? { max: 12 } : (i === 0 ? { max: 21 } : {}))),
      drop: build(() => ({}), i => (i === -1 ? { max: 22 } : (i === 0 ? { max: 12 } : {}))),
      windy: build(() => ({ gust: 75 }), () => ({})),
      thunder: build(i => (i === 4 ? { code: 95 } : {}), () => ({})),
      snow: build(i => (i === 5 ? { code: 73 } : {}), () => ({})),
      sunset: build(() => ({ code: 0 }), () => ({}), 17),
      sunrise: build(() => ({ code: 0 }), () => ({}), 4)
    };
  }, { start });

  ok('sun turning up after rain', /sunAfterRain/.test(specials.sunAfterRain.join(' ')), specials.sunAfterRain.join(' '));
  ok('the first sun after a grey run', /firstSunAfterGrey/.test(specials.firstSun.join(' ')), specials.firstSun.join(' '));
  ok('the first rain after a dry one', /firstRainAfterDry/.test(specials.firstRain.join(' ')), specials.firstRain.join(' '));
  ok('a big jump on yesterday', /bigJump/.test(specials.jump.join(' ')), specials.jump.join(' '));
  ok('and a big drop', /bigDrop/.test(specials.drop.join(' ')), specials.drop.join(' '));
  ok('a proper blow', /veryWindy/.test(specials.windy.join(' ')), specials.windy.join(' '));
  ok('thunder on the way, with a time', /thunderComing\|.*\d\d:\d\d/.test(specials.thunder.join(' ')), specials.thunder.join(' '));
  ok('snow on the way', /snowComing/.test(specials.snow.join(' ')), specials.snow.join(' '));
  ok('a sunset worth looking at', /goodSunset/.test(specials.sunset.join(' ')), specials.sunset.join(' '));
  ok('a sunrise worth getting up for', /goodSunrise/.test(specials.sunrise.join(' ')), specials.sunrise.join(' '));
  ok('never more than three at once', specials.windy.length <= 3, String(specials.windy.length));

  /* ------------------------------------------------- suite: what has changed */

  console.log('\nwhat changed since last time');
  const changed = await page.evaluate(({ start }) => {
    const W = window.Weather;
    const midnight = Math.floor(start / 86400) * 86400;
    function forecastWith(maxes, probs, fetchedAt) {
      const days = [];
      for (let i = 0; i < 6; i++) {
        days.push({ t: midnight + i * 86400, code: 3, max: maxes[i], min: 8, feelsMax: 12,
          sunrise: midnight + i * 86400 + 6 * 3600, sunset: midnight + i * 86400 + 20 * 3600,
          prob: probs[i], mm: 0, wind: 12, gust: 20, uv: 3 });
      }
      return { offset: 0, fetchedAt: fetchedAt, place: { name: 'Ilkley' }, hours: [], days: days, current: null };
    }
    const before = forecastWith([15, 15, 15, 15, 15, 15], [20, 20, 20, 20, 20, 20], start - 7200);
    const snap = W.snapshot(before);
    const now = midnight + 10 * 3600;

    return {
      none: W.changes(null, forecastWith([15, 21, 15, 15, 15, 15], [20, 20, 20, 20, 20, 20], start), now),
      warmer: W.changes(snap, forecastWith([15, 21, 15, 15, 15, 15], [20, 20, 20, 20, 20, 20], start), now),
      colder: W.changes(snap, forecastWith([15, 9, 15, 15, 15, 15], [20, 20, 20, 20, 20, 20], start), now),
      wetter: W.changes(snap, forecastWith([15, 15, 15, 15, 15, 15], [20, 75, 20, 20, 20, 20], start), now),
      /* two readings minutes apart are the same forecast */
      tooSoon: W.changes(Object.assign({}, snap, { at: start - 60 }),
        forecastWith([15, 21, 15, 15, 15, 15], [20, 20, 20, 20, 20, 20], start), now),
      /* and a different town is not a change, it is a different question */
      elsewhere: W.changes(Object.assign({}, snap, { place: 'Leeds' }),
        forecastWith([15, 21, 15, 15, 15, 15], [20, 20, 20, 20, 20, 20], start), now),
      /* nothing beyond the next few days is reported */
      farOff: W.changes(snap, forecastWith([15, 15, 15, 15, 26, 15], [20, 20, 20, 20, 20, 20], start), now),
      lines: window.Voice.changeLines(
        W.changes(snap, forecastWith([15, 21, 15, 15, 15, 15], [20, 20, 20, 20, 20, 20], start), now),
        { sweary: true, units: 'metric' })
    };
  }, { start });

  eq('no previous forecast means no claims about change', changed.none, []);
  ok('a warmer tomorrow is noticed', changed.warmer.length === 1 && changed.warmer[0].kind === 'warmer',
    JSON.stringify(changed.warmer));
  ok('a colder one too', changed.colder[0] && changed.colder[0].kind === 'colder', JSON.stringify(changed.colder));
  ok('and rain making plans', changed.wetter[0] && changed.wetter[0].kind === 'wetter', JSON.stringify(changed.wetter));
  eq('two readings minutes apart are not a change', changed.tooSoon, []);
  eq('another town is not a change', changed.elsewhere, []);
  eq('next week moving about is not news', changed.farOff, []);
  ok('and it is said out loud with the number in it',
    /\d/.test(changed.lines[0].text) && changed.lines[0].text.length > 12, JSON.stringify(changed.lines));

  /* --------------------------------------------------- suite: the share card */

  console.log('\nthe share card');
  const share = await page.evaluate(async () => {
    document.getElementById('shareBtn').click();
    await new Promise(r => setTimeout(r, 150));
    const canvas = document.getElementById('shareCanvas');
    const ctx = canvas.getContext('2d');
    /* Something was actually painted: sample a few pixels for ink. */
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let lit = 0;
    for (let i = 0; i < data.length; i += 4000) {
      if (data[i] + data[i + 1] + data[i + 2] > 120) lit++;
    }
    const open = document.getElementById('shareSheet').hasAttribute('open');
    document.getElementById('shareSheet').close();
    return { open: open, lit: lit, w: canvas.width, h: canvas.height };
  });
  ok('the share sheet opens', share.open);
  eq('the card is portrait and big enough to post', [share.w, share.h], [1080, 1350]);
  ok('and something is actually drawn on it', share.lit > 50, String(share.lit));

  /* ------------------------------------------------------ suite: animation */

  console.log('\nthe moving sky');
  const sky = await page.evaluate(() => {
    const box = document.getElementById('sky');
    const on = { cls: box.className, kids: box.children.length };
    document.getElementById('settingsBtn').click();
    document.querySelector('.check:has(#animOn)').click();
    const off = { cls: box.className, kids: box.children.length };
    document.querySelector('.check:has(#animOn)').click();
    document.getElementById('settingsSheet').close();
    return { on: on, off: off, hidden: box.getAttribute('aria-hidden') };
  });
  ok('the sky is drawn for the weather', sky.on.kids > 0 && /sky--/.test(sky.on.cls), JSON.stringify(sky.on));
  ok('and the toggle empties it completely', sky.off.kids === 0, JSON.stringify(sky.off));
  eq('it is invisible to a screen reader', sky.hidden, 'true');

  const reduced = await browser.newContext({ serviceWorkers: 'block', reducedMotion: 'reduce' });
  await reduced.route('https://api.open-meteo.com/**', route => {
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(stub) });
  });
  const rPage = await reduced.newPage();
  await rPage.goto(base + 'index.html');
  await rPage.evaluate(() => localStorage.setItem('weatherApp.v1', JSON.stringify({
    place: { name: 'Ilkley', lat: 53.9, lon: -1.8 }, sweary: true, animate: true
  })));
  await rPage.reload();
  await rPage.waitForSelector('#hero:not([hidden])', { timeout: 5000 });
  const reducedSky = await rPage.evaluate(() => document.getElementById('sky').children.length);
  eq('reduced motion outranks the setting', reducedSky, 0);
  await reduced.close();

  /* ------------------------------------------------- suite: the old app is gone */

  console.log('\nnothing left of the old app');
  const sweep = await page.evaluate(() => {
    const text = document.body.innerText + ' ' + document.title;
    const banned = ['step out', 'go for a walk', 'walk', 'run ', 'cycle', 'bike ride', 'streak',
      'nudge', 'go outside', 'outdoor', 'window opens', 'how fussy', 'i went'];
    return banned.filter(w => text.toLowerCase().indexOf(w) >= 0);
  });
  eq('no trace of the outdoor app on screen', sweep, []);

  /* Not only what is on screen at this moment: every file that can put words
     in front of a user, including the ones the app stores will read. The two
     deliberate exceptions live in app.js and sw.js, which name the old app's
     storage key and its old background task purely in order to delete them
     from phones that still carry them. */
  const sourceSweep = await page.evaluate(async () => {
    const files = ['index.html', 'manifest.json', 'privacy.html', 'voice.js', 'brand.js', 'native.js'];
    const banned = ['step out', 'streak', 'nudge', 'go for a walk', 'go outside', 'outdoor',
      'exercise', 'fitness', 'workout', 'motivation', 'shoes on', 'how fussy'];
    const hits = [];
    for (const f of files) {
      const text = (await (await fetch(f)).text()).toLowerCase();
      banned.forEach(w => { if (text.indexOf(w) >= 0) hits.push(f + ': ' + w); });
    }
    return hits;
  });
  eq('nor anywhere in the words the app can say', sourceSweep, []);

  /* ------------------------------------------------------- suite: settings */

  console.log('\nsettings');
  await page.click('#settingsBtn');
  const swearyBefore = await page.textContent('#shout');
  await page.click('.check:has(#swearyOn)');
  await page.selectOption('#unitsSel', 'imperial');
  await page.selectOption('#clockSel', '12');
  await page.evaluate(() => document.getElementById('settingsSheet').close());
  await page.reload();
  await page.waitForSelector('#hero:not([hidden])', { timeout: 5000 });

  const after = await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('weatherApp.v1'));
    return {
      sweary: s.sweary, units: s.units, ampm: s.ampm,
      unit: document.getElementById('nowUnit').textContent,
      shout: document.getElementById('shout').textContent,
      title: document.title,
      sunrise: Array.from(document.querySelectorAll('#facts .fact'))
        .filter(f => f.querySelector('.fact-label').textContent === 'Sunrise')
        .map(f => f.querySelector('.fact-value').textContent)[0],
      wind: Array.from(document.querySelectorAll('#facts .fact'))
        .filter(f => f.querySelector('.fact-label').textContent === 'Wind')
        .map(f => f.querySelector('.fact-value').textContent)[0]
    };
  });

  eq('the swear toggle is remembered', after.sweary, false);
  eq('so are the units', after.units, 'imperial');
  eq('and the clock', after.ampm, true);
  eq('fahrenheit shows up', after.unit, '°F');
  eq('and mph with it', after.wind, '7 mph');
  ok('am/pm shows up', /am|pm/.test(after.sunrise), after.sunrise);
  ok('the clean mouth is clean', !/fuck|arse|bastard|bloody/i.test(after.shout), after.shout);
  /* The name is clean and the mouth is not, and the setting only ever moves
     the mouth. The app used to rename itself; a test that let it start again
     would be a rename nobody asked for. */
  eq('but the app keeps its name', after.title, 'Blooming Weather');
  ok('the clean line is still a line', after.shout.length > 10, after.shout);

  /* --------------------------------------------------- suite: when it breaks */

  console.log('\nwhen it goes wrong');
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('weatherApp.v1'));
    s.cache = null;
    localStorage.setItem('weatherApp.v1', JSON.stringify(s));
  });
  await context.unroute('https://api.open-meteo.com/**');
  await context.route('https://api.open-meteo.com/**', route => route.abort());
  await page.reload();
  await page.waitForSelector('#trouble:not([hidden])', { timeout: 5000 });
  const broken = await page.evaluate(() => ({
    line: document.getElementById('troubleLine').textContent,
    why: document.getElementById('troubleWhy').textContent,
    heroHidden: document.getElementById('hero').hidden,
    retry: !!document.getElementById('retryBtn')
  }));
  ok('it says so, in its own voice', broken.line.length > 10 && broken.line === broken.line.toUpperCase(), broken.line);
  ok('and shows what actually went wrong', broken.why.length > 5, broken.why);
  ok('no fake weather is drawn', broken.heroHidden);
  ok('there is a way to try again', broken.retry);

  /* with something cached it draws that, labelled */
  await context.unroute('https://api.open-meteo.com/**');
  await context.route('https://api.open-meteo.com/**', route => {
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(stub) });
  });
  await page.reload();
  await page.waitForSelector('#hero:not([hidden])', { timeout: 5000 });
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('weatherApp.v1'));
    s.cache.fetchedAt -= 3600;
    localStorage.setItem('weatherApp.v1', JSON.stringify(s));
  });
  await context.unroute('https://api.open-meteo.com/**');
  await context.route('https://api.open-meteo.com/**', route => route.abort());
  await page.reload();
  await page.waitForSelector('#hero:not([hidden])', { timeout: 5000 });
  await page.waitForTimeout(500);
  const cached = await page.evaluate(() => ({
    foot: document.getElementById('footStatus').textContent,
    temp: document.getElementById('nowTemp').textContent
  }));
  ok('the saved forecast is still drawn', cached.temp !== '—', cached.temp);
  ok('and clearly labelled as the last one it managed to get',
    /last forecast we managed to grab/.test(cached.foot), cached.foot);

  /* ---------------------------------------------------------- suite: search */

  console.log('\nfinding a place');
  await context.unroute('https://api.open-meteo.com/**');
  await context.route('https://api.open-meteo.com/**', route => {
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(stub) });
  });
  await page.evaluate(() => localStorage.clear());
  await page.goto(base + 'index.html');
  await page.waitForSelector('#setup:not([hidden])');
  const setupLine = await page.textContent('#setupTitle');
  ok('the empty state has a voice too', setupLine.length > 5, setupLine);
  await page.click('#searchPlaceBtn');
  await page.fill('#placeQuery', 'Ilkley');
  await page.press('#placeQuery', 'Enter');
  await page.waitForSelector('.result');
  await page.click('.result');
  await page.waitForSelector('#hero:not([hidden])', { timeout: 5000 });
  const searched = await page.evaluate(() => ({
    place: document.getElementById('placeName').textContent,
    saved: JSON.parse(localStorage.getItem('weatherApp.v1')).place.name
  }));
  eq('the chosen place is used', searched.place, 'Ilkley');
  eq('and remembered', searched.saved, 'Ilkley');

  /* --------------------------------------------- suite: asking for location */

  /* The rule this suite exists to hold: the operating system's permission
     prompt is never the first thing a user sees. The app explains itself, in
     its own words, and only then asks. */

  console.log('\nasking for location');
  await page.evaluate(() => localStorage.clear());
  await page.goto(base + 'index.html');
  await page.waitForSelector('#setup:not([hidden])');

  /* geolocation is recorded rather than answered, so the test can see whether
     the app reached for it and when. It has to go on with defineProperty:
     navigator.geolocation is a getter on the prototype, so a plain assignment
     fails silently and the test ends up quietly measuring the real one. */
  await page.addInitScript(() => {
    window.__geo = 0;
    window.__geoAnswer = null;
    const fake = {
      getCurrentPosition: function (ok, no) {
        window.__geo++;
        if (window.__geoAnswer) window.__geoAnswer(ok, no);
      }
    };
    Object.defineProperty(navigator, 'geolocation', { configurable: true, get: () => fake });
  });
  await page.reload();
  await page.waitForSelector('#setup:not([hidden])');

  await page.click('#useHereBtn');
  await page.waitForTimeout(120);
  const asked = await page.evaluate(() => ({
    open: document.getElementById('askSheet').hasAttribute('open'),
    calls: window.__geo,
    title: document.getElementById('askTitle').textContent,
    body: document.querySelector('.ask').textContent
  }));
  ok('the explainer opens first', asked.open);
  eq('and the phone has not been asked anything yet', asked.calls, 0);
  ok('it says what the location is for', /forecast where you are/i.test(asked.body), asked.body.slice(0, 80));
  ok('it says the coordinates are rounded', /rounded/i.test(asked.body));
  ok('it says no is a real answer', /works exactly the same|search for a town/i.test(asked.body));
  ok('it has a title worth reading', asked.title.length > 8, asked.title);
  ok('and the privacy policy is one tap away',
    await page.$eval('.ask a[href="privacy.html"]', a => !!a).catch(() => false));

  /* Backing out asks nothing and breaks nothing. */
  await page.click('.ask [data-close]');
  await page.waitForTimeout(80);
  const backedOut = await page.evaluate(() => ({
    open: document.getElementById('askSheet').hasAttribute('open'),
    calls: window.__geo,
    setup: !document.getElementById('setup').hidden
  }));
  ok('"not now" closes it', !backedOut.open);
  eq('and still nothing was asked of the phone', backedOut.calls, 0);
  ok('the app is exactly where it was', backedOut.setup);

  /* Saying yes is what raises the real prompt — and only then. */
  await page.click('#useHereBtn');
  await page.waitForTimeout(80);
  await page.click('#askYesBtn');
  await page.waitForTimeout(120);
  const agreed = await page.evaluate(() => ({
    calls: window.__geo,
    out: document.getElementById('setupOut').textContent
  }));
  eq('agreeing asks the phone, once', agreed.calls, 1);
  ok('and says what it is doing while it waits', /asking/i.test(agreed.out), agreed.out);

  /* Second time round it goes straight there: an explanation shown twice is
     not an explanation, it is nagging. */
  await page.click('#useHereBtn');
  await page.waitForTimeout(120);
  const again = await page.evaluate(() => ({
    open: document.getElementById('askSheet').hasAttribute('open'),
    calls: window.__geo
  }));
  ok('the second time it does not explain itself again', !again.open);
  eq('it just asks', again.calls, 2);

  /* A refusal has to leave a usable app behind, not a dead end. */
  await page.evaluate(() => localStorage.clear());
  await page.goto(base + 'index.html');
  await page.waitForSelector('#setup:not([hidden])');
  await page.evaluate(() => { window.__geoAnswer = (ok2, no) => no({ code: 1, message: 'denied' }); });
  await page.click('#useHereBtn');
  await page.waitForTimeout(80);
  await page.click('#askYesBtn');
  await page.waitForTimeout(200);
  const refused = await page.evaluate(() => ({
    out: document.getElementById('setupOut').textContent,
    canSearch: !document.getElementById('searchPlaceBtn').disabled
  }));
  ok('a refusal is answered without sulking', /that is fine|search for a town/i.test(refused.out), refused.out);
  ok('and the town search is still right there', refused.canSearch);

  /* ------------------------------------------------ suite: the native bridge */

  /* The bridge ships in the web app as well as the phone apps, so the thing
     worth proving here is that it stays out of the way: on a browser it must
     report itself as web and leave every route exactly as it was. */

  console.log('\nthe native bridge, on the web');
  const bridge = await page.evaluate(() => ({
    exists: !!window.Native,
    is: window.Native.is,
    platform: window.Native.platform,
    canShare: window.Native.canShare(),
    resume: window.Native.onResume(function () {}),
    ready: (function () { try { window.Native.ready(); return 'quiet'; } catch (e) { return String(e); } })(),
    back: (function () { try { window.Native.onBack(function () {}); return 'quiet'; } catch (e) { return String(e); } })()
  }));
  ok('the bridge is there', bridge.exists);
  eq('and knows it is not on a phone', bridge.is, false);
  eq('it names the platform honestly', bridge.platform, 'web');
  eq('the chrome calls do nothing at all', bridge.ready, 'quiet');
  eq('so does the back button', bridge.back, 'quiet');
  eq('and there is no native resume to listen to', bridge.resume, false);
  ok('sharing falls back to whatever the browser has',
    bridge.canShare === !!(await page.evaluate(() => !!navigator.share)));

  /* A web page must never be handed a native share. */
  const nativeShare = await page.evaluate(() =>
    window.Native.share('x', null, 'x.png').then(() => 'shared', e => 'refused: ' + (e && e.message)));
  ok('and a native share is refused rather than faked', /refused/.test(nativeShare), nativeShare);

  /* The service worker is a website's way of staying on a phone. The phone
     apps already are on the phone, so it must not be registered there. */
  const swGuard = await page.evaluate(() => {
    const src = document.querySelector('script[src^="app.js"]').src;
    return fetch(src).then(r => r.text()).then(t => /if \(!N\.is && 'serviceWorker' in navigator\)/.test(t));
  });
  ok('and the worker is registered on the web only', swGuard);

  /* Put a working app back on screen for the suites that follow, which expect
     a place and a fresh forecast rather than the first-run card. */
  await page.evaluate(() => localStorage.clear());
  await page.goto(base + 'index.html');
  await page.evaluate(() => localStorage.setItem('weatherApp.v1', JSON.stringify({
    place: { name: 'Ilkley', where: 'England', lat: 53.9, lon: -1.8 }, sweary: true
  })));
  await page.reload();
  await page.waitForSelector('#hero:not([hidden])', { timeout: 5000 });

  /* ------------------------------------------------------- suite: the icon badge */

  console.log('\nthe number on the icon');
  const badge = await page.evaluate(async () => {
    /* Headless Chromium has no badge API, so it is stubbed and the calls
       recorded — what matters is which call the app decides to make. */
    const calls = [];
    navigator.setAppBadge = n => { calls.push(['set', n]); return Promise.resolve(); };
    navigator.clearAppBadge = () => { calls.push(['clear']); return Promise.resolve(); };

    const store = () => JSON.parse(localStorage.getItem('weatherApp.v1'));
    const put = s => localStorage.setItem('weatherApp.v1', JSON.stringify(s));
    const out = {};

    const reload = async () => {
      calls.length = 0;
      location.reload();
      await new Promise(r => setTimeout(r, 10));
    };

    /* The app is already loaded with a fresh forecast: opening it should have
       put the temperature on the icon. */
    document.getElementById('settingsBtn').click();
    document.getElementById('settingsSheet').close();
    out.hint = document.getElementById('badgeState').textContent;
    out.on = document.getElementById('badgeOn').checked;

    /* Toggling it off clears rather than leaving the last number sitting there. */
    calls.length = 0;
    document.querySelector('.check:has(#badgeOn)').click();
    out.afterOff = calls.slice();
    document.querySelector('.check:has(#badgeOn)').click();
    out.afterOn = calls.slice(-1);
    return out;
  });

  ok('the badge is on by default', badge.on);
  ok('and it explains what it can and cannot do', /minus|count/i.test(badge.hint), badge.hint);
  eq('switching it off clears the icon', badge.afterOff, [['clear']]);
  ok('switching it back on puts a number there', badge.afterOn[0][0] === 'set' && typeof badge.afterOn[0][1] === 'number',
    JSON.stringify(badge.afterOn));

  /* The two honesty rules: nothing stale, and nothing below zero. The badge
     API is stubbed before the page's own scripts run, so the reload keeps it. */
  await page.addInitScript(() => {
    window.__badge = [];
    navigator.setAppBadge = n => { window.__badge.push(['set', n]); return Promise.resolve(); };
    navigator.clearAppBadge = () => { window.__badge.push(['clear']); return Promise.resolve(); };
  });

  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('weatherApp.v1'));
    s.badge = true;
    s.cache.fetchedAt -= 4 * 3600;          /* four hours old */
    localStorage.setItem('weatherApp.v1', JSON.stringify(s));
  });
  await context.unroute('https://api.open-meteo.com/**');
  await context.route('https://api.open-meteo.com/**', route => route.abort());
  await page.reload();
  await page.waitForSelector('#hero:not([hidden])', { timeout: 5000 });
  await page.waitForTimeout(300);
  const staleBadge = await page.evaluate(() => window.__badge);
  ok('a forecast four hours old gets no badge at all',
    staleBadge.length > 0 && staleBadge.every(c => c[0] === 'clear'), JSON.stringify(staleBadge));

  /* Below zero: the screen shows minus three, the icon shows nothing. */
  await context.unroute('https://api.open-meteo.com/**');
  const freezingStub = JSON.parse(JSON.stringify(stub));
  freezingStub.current.temperature_2m = -3;
  freezingStub.current.apparent_temperature = -6;
  await context.route('https://api.open-meteo.com/**', route => {
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(freezingStub) });
  });
  await page.evaluate(() => localStorage.removeItem('weatherApp.v1'));
  await page.goto(base + 'index.html');
  await page.evaluate(() => localStorage.setItem('weatherApp.v1', JSON.stringify({
    place: { name: 'Ilkley', lat: 53.9, lon: -1.8 }, sweary: true, badge: true
  })));
  await page.reload();
  await page.waitForSelector('#hero:not([hidden])', { timeout: 5000 });
  await page.waitForTimeout(300);
  const belowZero = await page.evaluate(() => ({
    calls: window.__badge,
    temp: document.getElementById('nowTemp').textContent
  }));
  eq('the screen still shows the real temperature', belowZero.temp, '-3');
  ok('but the icon carries nothing rather than a wrong number',
    belowZero.calls.length > 0 && belowZero.calls.every(c => c[0] === 'clear'), JSON.stringify(belowZero.calls));

  /* And a normal forecast puts the actual number there. The saved freezing
     forecast is dropped first, otherwise the app is quite right not to go
     back to the network for one it fetched seconds ago. */
  await context.unroute('https://api.open-meteo.com/**');
  await context.route('https://api.open-meteo.com/**', route => {
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(stub) });
  });
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('weatherApp.v1'));
    delete s.cache;
    localStorage.setItem('weatherApp.v1', JSON.stringify(s));
  });
  await page.reload();
  await page.waitForFunction(() => document.getElementById('nowTemp').textContent === '19', null, { timeout: 5000 });
  await page.waitForTimeout(200);
  const warmBadge = await page.evaluate(() => window.__badge.filter(c => c[0] === 'set'));
  ok('a fresh, above-zero forecast puts the temperature on the icon',
    warmBadge.length > 0 && warmBadge[warmBadge.length - 1][1] === 19, JSON.stringify(warmBadge));

  /* -------------------------------------------------- suite: the worker itself */

  console.log('\nthe service worker');
  const swCtx = await browser.newContext();
  const swErrors = [];
  await swCtx.route('https://api.open-meteo.com/**', route => {
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(stub) });
  });
  const swPage = await swCtx.newPage();
  swPage.on('pageerror', e => swErrors.push(e.message));
  await swPage.goto(base + 'index.html');
  const swState = await swPage.evaluate(() =>
    navigator.serviceWorker.ready.then(reg => ({
      active: !!reg.active,
      /* nothing in this app should be asking to run in the background */
      periodic: !!reg.periodicSync
    })).catch(e => ({ error: String(e) })));
  ok('the worker registers and activates', swState.active === true, JSON.stringify(swState));
  ok('nothing threw while it did', swErrors.length === 0, swErrors.join(' | '));
  await swCtx.close();

  /* --------------------------------------------------------------- console */

  console.log('\nconsole');
  const real = errors.filter(e => !/net::ERR_FAILED/.test(e));
  ok('no console errors anywhere in that', real.length === 0, real.join(' | '));

  await browser.close();
  server.close();

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  if (failures.length) { console.log('\nfailures:\n - ' + failures.join('\n - ')); process.exit(1); }
}

main().catch(e => { console.error(e); process.exit(1); });
