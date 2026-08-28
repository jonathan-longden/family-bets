// Fucking Weather — iPhone home screen widget
// ---------------------------------------------------------------------------
// A real iOS home-screen widget, without an App Store account or a native
// build: it runs inside Scriptable (free, App Store), which is the only way a
// web app gets onto the home screen as anything other than an icon.
//
// It does NOT reimplement the app. It downloads the app's own weather.js and
// voice.js and uses them, so the widget and the app read the same forecast and
// tell the same jokes. If the site is unreachable it falls back to the last
// thing it drew, clearly marked with when that was.
//
// SETUP — five minutes, once
//   1. Install Scriptable from the App Store.
//   2. Open it, tap + for a new script, paste this whole file in, and name it
//      "Fucking Weather".
//   3. Long-press the home screen → + → Scriptable → pick a size → Add.
//   4. Long-press the new widget → Edit Widget:
//        Script      : Fucking Weather
//        When Interacting : Run Script  (or Open URL, if you would rather it
//                           opened the web app — the script sets that anyway)
//        Parameter   : leave empty to use where the phone is, or type a place
//                      as "Name,lat,lon" — e.g.  Ilkley,53.925,-1.822
//   5. Done. iOS decides how often it refreshes; the script asks for hourly.
//
// The three settings below are yours to change.
// ---------------------------------------------------------------------------

const SITE = 'https://jonathan-longden.github.io/family-bets/outside/';
const UNITS = 'metric';   // 'metric' (°C, km/h) or 'imperial' (°F, mph)
const SWEARY = true;      // false swaps in the clean lines, same as the app

// ---------------------------------------------------------------- the palette
// Matching the app, so the widget looks like it belongs to it.
const INK = new Color('#f2f6ff');
const DIM = new Color('#aebbdc');
const WARM = new Color('#ffe6a8');
const TOP = new Color('#123268');
const BOTTOM = new Color('#081128');

const fm = FileManager.local();
const CACHE = fm.joinPath(fm.cacheDirectory(), 'fucking-weather-widget.json');

// ------------------------------------------------------------------ the place

async function place() {
  const param = (args.widgetParameter || '').trim();
  if (param) {
    const bits = param.split(',').map(s => s.trim());
    if (bits.length >= 3) {
      const lat = Number(bits[1]), lon = Number(bits[2]);
      if (isFinite(lat) && isFinite(lon)) return { name: bits[0], lat: lat, lon: lon };
    }
  }
  // No parameter: ask the phone. Widgets get location sparingly, so a failure
  // here is normal rather than exceptional — the cache covers it.
  try {
    Location.setAccuracyToThreeKilometers();
    const here = await Location.current();
    return {
      name: 'Here',
      lat: Math.round(here.latitude * 10000) / 10000,
      lon: Math.round(here.longitude * 10000) / 10000
    };
  } catch (e) {
    return null;
  }
}

// ------------------------------------------------------- the app's own brains

// weather.js and voice.js are written to attach themselves to a global. Under
// Scriptable there is no `self`, so they fall through to `this` — which is why
// they are evaluated with an indirect call rather than a direct eval.
async function loadBrains() {
  const globals = {};
  for (const file of ['weather.js', 'voice.js']) {
    const src = await new Request(SITE + file + '?w=1').loadString();
    const run = new Function('globalThis', 'self', src + '\nreturn self;');
    run(globals, globals);
  }
  if (!globals.Weather || !globals.Voice) throw new Error('could not load the app');
  return globals;
}

// ------------------------------------------------------------------- the data

async function readWeather() {
  const where = await place();
  if (!where) throw new Error('no location');

  const brains = await loadBrains();
  const W = brains.Weather, V = brains.Voice;

  const json = await new Request(W.forecastUrl(where, 15)).loadJSON();
  const forecast = W.parse(json, where);
  const now = Math.floor(Date.now() / 1000);
  const n = W.now(forecast, now);
  const today = forecast.days[W.todayIndex(forecast, now)];
  const settings = { units: UNITS, ampm: false, sweary: SWEARY };

  return {
    place: where.name,
    temp: W.temp(n.temp, UNITS),
    feels: W.temp(n.feels, UNITS),
    icon: W.icon({ code: n.code, feels: n.feels, mm: n.mm, prob: n.prob, gust: n.gust, day: n.day }),
    condition: W.skyName(n.code),
    high: W.temp(today.max, UNITS),
    low: W.temp(today.min, UNITS),
    rain: today.prob === null ? '—' : today.prob + '%',
    line: V.headline(forecast, settings, now).text,
    at: new Date().toISOString()
  };
}

// The widget should never be blank and never lie: a failed refresh draws the
// last good reading with the time it was taken.
function remember(data) {
  try { fm.writeString(CACHE, JSON.stringify(data)); } catch (e) { /* full disk */ }
}

function recall() {
  try {
    if (!fm.fileExists(CACHE)) return null;
    return JSON.parse(fm.readString(CACHE));
  } catch (e) {
    return null;
  }
}

// ---------------------------------------------------------------- the drawing

function shell() {
  const w = new ListWidget();
  const bg = new LinearGradient();
  bg.colors = [TOP, BOTTOM];
  bg.locations = [0, 1];
  w.backgroundGradient = bg;
  w.setPadding(14, 15, 14, 15);
  w.url = SITE;
  // Ask for an hourly refresh. iOS treats this as a hint, not an instruction.
  w.refreshAfterDate = new Date(Date.now() + 60 * 60 * 1000);
  return w;
}

function label(parent, text, size, colour, weight) {
  const t = parent.addText(text);
  t.font = weight === 'bold' ? Font.boldSystemFont(size) : Font.systemFont(size);
  t.textColor = colour;
  return t;
}

function drawSmall(w, d, stale) {
  const top = w.addStack();
  top.centerAlignContent();
  label(top, d.place.toUpperCase(), 10, DIM, 'bold');
  top.addSpacer();
  label(top, d.icon, 15, INK);

  w.addSpacer(4);
  label(w, d.temp, 40, INK, 'bold');
  label(w, d.high + ' / ' + d.low + '  ☔ ' + d.rain, 10, DIM);
  w.addSpacer(4);

  const line = label(w, d.line, 11, WARM, 'bold');
  line.minimumScaleFactor = 0.7;
  line.lineLimit = 3;

  if (stale) {
    w.addSpacer(2);
    label(w, 'saved ' + when(d.at), 8, DIM);
  }
}

function drawMedium(w, d, stale) {
  const row = w.addStack();
  row.centerAlignContent();

  const left = row.addStack();
  left.layoutVertically();
  label(left, d.place.toUpperCase(), 11, DIM, 'bold');
  label(left, d.temp, 46, INK, 'bold');
  label(left, 'Feels ' + d.feels, 11, DIM);

  row.addSpacer();

  const right = row.addStack();
  right.layoutVertically();
  right.centerAlignContent();
  const ic = right.addStack();
  ic.addSpacer();
  label(ic, d.icon, 34, INK);
  const cond = right.addStack();
  cond.addSpacer();
  label(cond, d.condition, 12, DIM, 'bold');
  const hilo = right.addStack();
  hilo.addSpacer();
  label(hilo, d.high + ' / ' + d.low + '   ☔ ' + d.rain, 11, DIM);

  w.addSpacer(10);
  const line = label(w, d.line, 15, WARM, 'bold');
  line.minimumScaleFactor = 0.6;
  line.lineLimit = 2;

  if (stale) {
    w.addSpacer(3);
    label(w, 'Saved forecast, ' + when(d.at) + ' — could not reach the weather', 9, DIM);
  }
}

function when(iso) {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + ' min ago';
  return Math.round(mins / 60) + ' h ago';
}

function drawTrouble(w, why) {
  label(w, SWEARY ? 'FUCK.' : 'WELL.', 22, WARM, 'bold');
  label(w, SWEARY ? 'THE WEATHER MACHINE HAS GONE QUIET.' : 'THE WEATHER MACHINE HAS GONE QUIET.',
    12, INK, 'bold');
  w.addSpacer(4);
  label(w, why, 9, DIM);
}

// ----------------------------------------------------------------- the script

let data = null;
let stale = false;
let trouble = '';

try {
  data = await readWeather();
  remember(data);
} catch (e) {
  data = recall();
  stale = true;
  trouble = String((e && e.message) || e);
}

const widget = shell();

if (!data) drawTrouble(widget, trouble || 'no forecast saved yet');
else if (config.widgetFamily === 'small') drawSmall(widget, data, stale);
else drawMedium(widget, data, stale);

if (config.runsInWidget) {
  Script.setWidget(widget);
} else {
  // Running it inside Scriptable shows a preview, which is how you check it
  // works before putting it on the home screen.
  await widget.presentMedium();
}
Script.complete();
