// Where the defect is, as opposed to where the phone was.
//
// The app used to record the last GPS fix at the moment the database was
// written — no heading, no speed, no frame timestamp, and a fix the browser was
// free to have cached for five seconds. This drives the new path and checks
// that it estimates only when it can, refuses when it cannot, says which of the
// two positions any given number is, and never fabricates a heading or a speed.
import { chromium } from 'playwright';
import { CHROME } from './browser.mjs';
import { openLog, openMap, toCamera, rec, settled, openMenu, closeMenu } from './shellhelp.mjs';
const B = 'http://127.0.0.1:8777/defects/';
const fails = [];
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails.push(m); };
const near = (a, b, tol) => Math.abs(a - b) <= tol;

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
const ctx = await browser.newContext({
  permissions: ['camera', 'geolocation'],
  geolocation: { latitude: 53.0, longitude: -1.1, accuracy: 8 },
  viewport: { width: 844, height: 390 } });
const page = await ctx.newPage();
page.on('dialog', d => d.accept());
const dls = [];
page.on('download', d => dls.push(d));
const grab = async (sel) => {
  const before = dls.length;
  await page.click(sel);
  for (let i = 0; i < 80 && dls.length === before; i++) await page.waitForTimeout(150);
  if (dls.length === before) return null;
  const s = await dls[dls.length - 1].createReadStream();
  let out = ''; for await (const c of s) out += c;
  return out;
};

await page.goto(B, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.getElementById('badge').textContent === 'Live',
  null, { timeout: 15000 });
await settled(page);

// ---------------------------------------------------------------- the maths
const proj = await page.evaluate(() => {
  const n = project(53.0, -1.1, 0, 111.32);      // ~0.001° of latitude, due north
  const e = project(53.0, -1.1, 90, 100);
  return { n, e };
});
ok(near(proj.n.lat, 53.001, 0.0001) && near(proj.n.lon, -1.1, 0.0001),
   'due north moves latitude and leaves longitude: ' + JSON.stringify(proj.n));
ok(proj.e.lon > -1.1 && near(proj.e.lat, 53.0, 0.0001),
   'due east moves longitude and leaves latitude: ' + JSON.stringify(proj.e));

// ------------------------------------------------- readings that are not readings
const r = await page.evaluate(() => ({
  nan: reading(NaN, 0, 360), nul: reading(null, 0, 360), neg: reading(-1, 0, 360),
  over: reading(400, 0, 360), str: reading('abc', 0, 360),
  good: reading(93.4, 0, 360), zero: reading(0, 0, 360)
}));
ok(r.nan === null && r.nul === null && r.neg === null && r.over === null && r.str === null,
   'a heading that is not a heading becomes null, not a plausible number: ' + JSON.stringify(r));
ok(r.good === 93.4 && r.zero === 0,
   'and a real one — including a genuine due north — survives');

// ---------------------------------------------------- the estimate, case by case
const cases = await page.evaluate(() => {
  const t = 1000000;
  const fix = (over) => Object.assign(
    { lat: 53, lon: -1.1, acc: 8, at: t, heading: 90, speed: 13.4 }, over || {});
  return {
    none:      estimatePosition(null, t, 8),
    noHeading: estimatePosition(fix({ heading: null }), t, 8),
    stale:     estimatePosition(fix(), t + 9000, 8),
    good:      estimatePosition(fix(), t + 500, 8),
    noSpeed:   estimatePosition(fix({ speed: null }), t + 500, 8),
    slack:     estimatePosition(fix({ acc: 40 }), t + 500, 8)
  };
});
ok(cases.none.lat === null && cases.none.why === 'no fix',
   'no fix, no estimate, and it says so');
ok(cases.noHeading.lat === null && /no heading/.test(cases.noHeading.why),
   'no heading, no estimate: ' + cases.noHeading.why);
ok(cases.stale.lat === null && /old when the frame/.test(cases.stale.why),
   'a fix too old for the frame is not used to place anything: ' + cases.stale.why);

ok(cases.good.lat !== null && cases.good.by === 'projected along heading',
   'with a fix, a heading and a fresh frame it estimates');
ok(cases.good.lon > -1.1 && near(cases.good.lat, 53, 0.0002),
   'and it moves east, which is where a heading of 90 points: ' + JSON.stringify(cases.good));
// 8 m of lead + 13.4 m/s for half a second ≈ 14.7 m east
ok(near(cases.good.travelM, 6.7, 0.2), 'counting how far the vehicle moved between fix and frame: '
   + cases.good.travelM + ' m');

ok(cases.good.confM >= 8 + 8, 'the radius carries the fix accuracy and the whole of the lead: ±'
   + cases.good.confM + ' m');
ok(cases.noSpeed.confM > cases.good.confM,
   'not knowing the speed widens it rather than being ignored: ±' + cases.noSpeed.confM + ' m');
ok(cases.slack.confM > cases.good.confM,
   'and a vaguer fix widens it too: ±' + cases.slack.confM + ' m');

// ------------------------------------------------ a real find, end to end
await page.evaluate(() => {
  window.__hits = [];
  window.engine = { infer: () => new Promise(r => setTimeout(() => r(window.__hits), 250)) };
  window.worker = 1;
  window.loadModel = () => Promise.resolve({});
  // a moving vehicle: the geolocation stub has no heading, so put one on
  window.__realStart = startGps;
  S.gps = { lat: 53, lon: -1.1, acc: 6, at: Date.now(), heading: 90, speed: 13.4 };
  setInterval(() => { if (S.gps) S.gps.at = Date.now(); }, 200);
});
await page.waitForFunction(() => document.getElementById('vid').videoWidth > 0);
const hit = [{ class: 'pothole', confidence: 0.9, bbox: { x: 300, y: 300, width: 200, height: 200 } }];
await rec(page);
await page.evaluate(h => { window.__hits = h; }, hit);
await page.waitForFunction(() => document.getElementById('hudCount').textContent === '1 logged',
  null, { timeout: 20000 });
await page.click('#bRec');

const e = await page.evaluate(() => {
  const it = S.items[0];
  return { t: it.t, capturedAt: it.capturedAt, storedAt: it.storedAt,
           lat: it.lat, lon: it.lon, acc: it.acc, fixAgeMs: it.fixAgeMs,
           headingDeg: it.headingDeg, speedMps: it.speedMps,
           estLat: it.estLat, estLon: it.estLon, posConfM: it.posConfM,
           estBy: it.estBy, estWhy: it.estWhy, cameraLeadM: it.cameraLeadM };
});
ok(e.headingDeg === 90, 'the entry carries the heading: ' + e.headingDeg);
ok(e.speedMps === 13.4, 'and the speed: ' + e.speedMps);
ok(e.capturedAt === e.t, 'the timestamp on the entry is when the frame was taken');
ok(new Date(e.storedAt) - new Date(e.capturedAt) >= 200,
   'and the write time is recorded separately, later than it: ' +
   (new Date(e.storedAt) - new Date(e.capturedAt)) + ' ms apart');
ok(e.lat === 53 && e.lon === -1.1, 'the vehicle position is kept unmodified');
ok(e.estLat !== null && e.estLon > e.lon,
   'and an estimated defect position sits ahead of it: ' + JSON.stringify([e.estLat, e.estLon]));
ok(e.posConfM >= 14, 'with an error radius on it: ±' + e.posConfM + ' m');
ok(e.cameraLeadM === 8, 'and the camera lead it was worked out with: ' + e.cameraLeadM);

// --- the log says which is which ---
await openLog(page);
const row = await page.textContent('.item');
ok(/estimated defect position/.test(row), 'the log labels the position as an estimate');
ok(/heading 90/.test(row), 'and shows the heading it was projected along');
ok(/±\d+m/.test(row), 'and the radius: ' + (row.match(/±\d+m/) || [])[0]);

// --- the confirm screen separates the two ---
await page.click('.item .del.go');
await page.waitForSelector('#p-score:not([hidden])');
const fx = await page.textContent('#fixNote');
ok(/Vehicle position/.test(fx) && /Estimated defect position/.test(fx),
   'the confirm screen shows both positions as two separate things');
ok(/has not been calibrated|uncalibrated/i.test(fx),
   'and says the lead behind the estimate is a guess');
await page.click('#xScore');

// --- exports carry both, and the geometry is the estimate ---
await openMenu(page);
const geo = JSON.parse(await grab('#bGeo'));
await closeMenu(page);
const p0 = geo.features[0].properties;
ok(geo.features[0].geometry.coordinates[0] === e.estLon &&
   geo.features[0].geometry.coordinates[1] === e.estLat,
   'GeoJSON geometry is the estimated defect position');
ok(p0.vehicle_lat === 53 && p0.vehicle_lon === -1.1,
   'with the vehicle position beside it under its own name');
ok(p0.position_source === 'estimated' && p0.position_confidence_m === e.posConfM,
   'labelled as an estimate, with its radius: ' + JSON.stringify([p0.position_source, p0.position_confidence_m]));
ok(p0.heading_deg === 90 && p0.speed_mps === 13.4, 'heading and speed carried');
ok(p0.captured_at === e.capturedAt && p0.stored_at === e.storedAt,
   'and the two timestamps kept apart');
ok(Object.values(p0).every(v => v === null || ['string', 'number', 'boolean'].includes(typeof v)),
   'every property is still a flat scalar a GIS can read');

await openMenu(page);
const csv = await grab('#bCsv');
await closeMenu(page);
const head = csv.split('\r\n')[0].replace(/^﻿/, '').split(',').map(s => s.replace(/"/g, ''));
for (const c of ['captured_at', 'stored_at', 'heading_deg', 'speed_mps',
                 'estimated_defect_lat', 'estimated_defect_lon', 'position_confidence_m',
                 'position_source', 'camera_lead_m']) {
  ok(head.includes(c), 'CSV has a ' + c + ' column');
}

// --- no heading means no estimate, and the log says why ---
await page.evaluate(async () => {
  await putEntry({ id: 5, t: new Date().toISOString(), img: null,
    imp: 2, prob: 2, score: 4, priority: 'P4', key: 'p4', cat: null, resp: null,
    surface: 'Carriageway', scoredBy: 'survey, unconfirmed', type: 'Pothole', note: '',
    lat: 53.4, lon: -1.2, acc: 9, fixAge: 0, headingDeg: null, speedMps: null,
    estLat: null, estLon: null, posConfM: null, estBy: null,
    estWhy: 'no heading — a phone reports one only while it is moving' });
  S.items = await allEntries(); render();
});
const noEst = await page.textContent('.item:last-child');
ok(/vehicle position, not the defect/.test(noEst),
   'an entry with no estimate says the number is the vehicle’s');
ok(/no heading/.test(noEst), 'and why there is no estimate: ' +
   (noEst.match(/no heading[^<]*/) || [])[0]);

// --- the camera lead is settable, and is what later finds use ---
await openLog(page);
await page.fill('#camLead', '14');
await page.dispatchEvent('#camLead', 'change');
ok(await page.evaluate(() => cameraLead()) === 14, 'the camera lead can be set');
ok(/set on this device/.test(await page.textContent('#leadState')),
   'and says it is no longer the built-in guess');
const wider = await page.evaluate(() => estimatePosition(
  { lat: 53, lon: -1.1, acc: 8, at: 1000, heading: 90, speed: 10 }, 1000, null));
ok(wider.leadM === 14, 'later estimates use it: ' + wider.leadM);
ok(wider.confM >= 8 + 14, 'and a longer lead means a wider radius, not a tighter one: ±' +
   wider.confM + ' m');
const bad = await page.evaluate(() => {
  const el = document.getElementById('camLead');
  el.value = '999'; el.dispatchEvent(new Event('change'));
  return { field: el.value, lead: cameraLead() };
});
ok(bad.lead === 14 && bad.field === '14', 'a nonsense lead is refused rather than stored: ' +
   JSON.stringify(bad));

// --- the fix window actually tightened ---
const src = await (await fetch(B + 'app.js')).text();
ok(/maximumAge: FIX_MAX_AGE_MS/.test(src) && /FIX_MAX_AGE_MS = 1000/.test(src),
   'watchPosition asks for a fix no more than a second old');
ok(/USABLE_FIX_MS = 3000/.test(src),
   'and refuses to place a defect from one older than three seconds');

console.log(fails.length ? '\n' + fails.length + ' FAILED' : '\nall passed');
await browser.close();
process.exit(fails.length ? 1 : 0);
