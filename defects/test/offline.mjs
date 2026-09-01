// The whole point of the app is a lay-by with no signal. None of this release's
// changes may have made it depend on a network: not the defect store, not the
// position estimate, not the exports, not the what3words lookup.
import { chromium } from 'playwright';
import { CHROME } from './browser.mjs';
import { openLog, rec, settled, openMenu, closeMenu } from './shellhelp.mjs';
const B = 'http://127.0.0.1:8777/defects/';
const fails = [];
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails.push(m); };

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

// --- warm the service worker up, the way a first visit with signal would ---
await page.goto(B, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => navigator.serviceWorker.controller !== null ||
  navigator.serviceWorker.ready.then(() => true), null, { timeout: 20000 });
await page.evaluate(() => navigator.serviceWorker.ready);
await page.waitForFunction(() => document.getElementById('badge').textContent === 'Live',
  null, { timeout: 15000 });
await settled(page);

// something in the log before the signal goes, so the reload has data to restore
await page.evaluate(async () => {
  await putEntry({ id: 900, t: '2026-08-01T09:00:00.000Z',
    capturedAt: '2026-08-01T09:00:00.000Z', storedAt: '2026-08-01T09:00:01.000Z',
    img: null, imp: 3, prob: 3, score: 9,
    priority: 'P2', priorityWord: 'Look at soon', key: 'p2',
    cat: null, resp: null, statCat: null, catBy: null,
    surface: 'Carriageway', scoredBy: 'survey, unconfirmed', type: 'Pothole', note: '',
    lat: 53.0, lon: -1.1, acc: 7, fixAge: 1, headingDeg: 90, speedMps: 12,
    estLat: 53.00001, estLon: -1.09988, posConfM: 17, estBy: 'projected along heading',
    cameraLeadM: 8 });
  S.items = await allEntries();
  S.defects = await allPhys();
  await migrateToDefects(S.items, S.defects).then(m => { S.defects = S.defects.concat(m); });
  render();
});
const beforeDefects = await page.evaluate(() => S.defects.length);
ok(beforeDefects >= 1, 'an entry and its defect exist while there is signal');

// ------------------------------------------------------------------ signal off
await ctx.setOffline(true);
await page.reload({ waitUntil: 'domcontentloaded' });
ok(await page.title() === 'Defect Log', 'the app loads with no network at all');
await page.waitForFunction(() => typeof S !== 'undefined' && Array.isArray(S.items),
  null, { timeout: 20000 });
await page.waitForFunction(() => S.items.length >= 1, null, { timeout: 20000 });

ok(await page.evaluate(() => S.items.length) >= 1, 'with the log intact');
ok(await page.evaluate(() => S.defects.length) === beforeDefects,
   'and the defects intact: ' + await page.evaluate(() => S.defects.length));
ok(await page.evaluate(() => navigator.onLine) === false, 'and the browser agrees it is offline');

await openLog(page);
const row = await page.textContent('.item');
ok(/P2/.test(row), 'the entry renders, priority and all');
ok(/estimated defect position/.test(row), 'with its estimated position');
ok(/±17m/.test(row), 'and its error radius');
ok(/provisional|confirmed|verified/.test(await page.textContent('.item .obs')),
   'and what it is an observation of');

// --- the camera and the survey do not need the network ---
await page.click('#xLog');
await page.waitForFunction(() => document.getElementById('badge').textContent === 'Live',
  null, { timeout: 20000 });
ok(true, 'the camera opens offline');
await page.evaluate(() => {
  window.__hits = [];
  window.engine = { infer: () => Promise.resolve(window.__hits) };
  window.worker = 1;
  window.loadModel = () => Promise.resolve({});
  S.gps = { lat: 53.5, lon: -1.2, acc: 5, at: Date.now(), heading: 180, speed: 13.4 };
  setInterval(() => { if (S.gps) S.gps.at = Date.now(); }, 200);
});
await page.waitForFunction(() => document.getElementById('vid').videoWidth > 0);
await rec(page);
await page.evaluate(h => { window.__hits = h; },
  [{ class: 'pothole', confidence: 0.9, bbox: { x: 300, y: 300, width: 180, height: 180 } }]);
await page.waitForFunction(() => document.getElementById('hudCount').textContent === '1 logged',
  null, { timeout: 20000 });
await page.click('#bRec');
ok(true, 'a defect is logged with no signal');

const off = await page.evaluate(() => {
  const it = S.items[0], d = defectById(it.defect_id);
  return { est: it.estLat != null, conf: it.posConfM, heading: it.headingDeg,
           defect: !!d, status: d && d.status, w3w: it.w3w || null };
});
ok(off.est && off.conf > 0 && off.heading === 180,
   'the position estimate is worked out on the device, with no lookup: ' + JSON.stringify(off));
ok(off.defect && off.status === 'provisional',
   'and it gets a defect, offline, like any other observation');
ok(off.w3w === null,
   'the three-word address is simply absent rather than holding anything up');

// --- exports work offline ---
await openLog(page);
await openMenu(page);
const csv = await grab('#bCsv');
await closeMenu(page);
ok(csv && /app_priority/.test(csv) && csv.split('\r\n').length >= 3,
   'CSV exports with no signal');
await openMenu(page);
const geo = await grab('#bGeo');
await closeMenu(page);
ok(geo && JSON.parse(geo).features.length >= 1, 'GeoJSON exports with no signal');
await openMenu(page);
const json = await grab('#bJson');
await closeMenu(page);
const j = JSON.parse(json);
ok(Array.isArray(j.defects) && Array.isArray(j.physicalDefects),
   'and so does JSON, defects and all — the model metadata it cannot fetch is simply absent');

// --- everything survives coming back and going again ---
await ctx.setOffline(false);
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => S.items.length >= 2, null, { timeout: 20000 });
ok(await page.evaluate(() => S.items.length) >= 2,
   'what was logged offline is still there when the signal comes back');
ok(await page.evaluate(() => S.defects.length) >= 2,
   'with its defect: ' + await page.evaluate(() => S.defects.length));

console.log(fails.length ? '\n' + fails.length + ' FAILED' : '\nall passed');
await browser.close();
process.exit(fails.length ? 1 : 0);
