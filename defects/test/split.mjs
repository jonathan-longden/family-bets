// An observation is not a defect.
//
// Every row used to be a sighting and a sighting was treated as a thing: drive
// the same road twice and you had two defects. This drives the split — the
// migration of rows written before it, the clustering of new observations onto
// known defects, the pass counting, and what happens to a defect when its last
// observation leaves.
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

// ============================================================ the migration
// Put a version-2 database on disk, exactly as an earlier build left it: the
// two stores it had, rows with no observation_id and no defect_id, and a
// statutory category the survey wrote for itself.
await page.addInitScript(() => {
  window.__seeded = new Promise((done) => {
    const req = indexedDB.open('deflog', 2);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains('defects')) d.createObjectStore('defects', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('wrong')) d.createObjectStore('wrong', { keyPath: 'id' });
    };
    req.onsuccess = () => {
      const d = req.result;
      const t = d.transaction('defects', 'readwrite');
      const s = t.objectStore('defects');
      const T = '2026-08-01T09:00:00.000Z';
      [1, 2, 3].forEach((i) => s.put({
        id: 1000 + i, t: T, img: null,
        imp: 3, prob: 3, score: 9,
        cat: 'Category 2', resp: '28 calendar days', key: 'k2',
        surface: 'Carriageway', scoredBy: 'survey, unconfirmed',
        type: 'Pothole', note: '', lat: 53 + i / 10000, lon: -1.1, acc: 7, fixAge: 1 }));
      t.oncomplete = () => { d.close(); done(true); };
    };
    req.onerror = () => done(false);
  });
});
await page.goto(B, { waitUntil: 'domcontentloaded' });
ok(await page.evaluate(() => window.__seeded) === true, 'a version-2 database is on disk');
await page.waitForFunction(() => document.getElementById('badge').textContent === 'Live',
  null, { timeout: 15000 });
await page.waitForFunction(() => S.items.length === 3, null, { timeout: 15000 });
await settled(page);

// Version 4 adds the two footage stores. The bump is deliberate and this
// assertion is what makes it deliberate: an accidental schema change fails here.
ok(await page.evaluate(() => db.version) === 4, 'the app opened it at version 4');
ok(await page.evaluate(() => S.items.length) === 3,
   'and every existing entry is still there — nothing disappeared in the upgrade');
const mig = await page.evaluate(() => S.items.map(i => ({
  id: i.id, obs: i.observation_id, def: i.defect_id, runId: i.runId,
  lat: i.lat, score: i.score })));
ok(mig.every(m => /^[0-9a-f-]{36}$/.test(m.obs)),
   'each got a UUID of its own: ' + mig[0].obs);
ok(new Set(mig.map(m => m.obs)).size === 3, 'all distinct');
ok(mig.every(m => /^[0-9a-f-]{36}$/.test(m.def)), 'and a defect to belong to');
ok(new Set(mig.map(m => m.def)).size === 3,
   'one observation, one provisional defect — nothing merged retrospectively');
ok(mig.every(m => m.lat != null && m.score === 9),
   'and everything that was on the row before is still on it');

const phys = await page.evaluate(() => S.defects.map(d => ({
  status: d.status, n: d.observation_count, runs: d.runs.length,
  lat: d.best_lat, migrated: d.migrated, type: d.type })));
ok(phys.length === 3, 'three defects were created: ' + phys.length);
ok(phys.every(d => d.status === 'provisional' && d.n === 1),
   'each provisional with one observation: ' + JSON.stringify(phys[0]));
ok(phys.every(d => d.runs === 0),
   'with no pass count, because the runs behind them were never recorded');
ok(phys.every(d => d.migrated === true), 'and marked as having been migrated');

// running it again must change nothing
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => S.items.length === 3, null, { timeout: 15000 });
const again = await page.evaluate(() => ({
  items: S.items.length, defects: S.defects.length,
  ids: S.items.map(i => i.observation_id).sort().join(',') }));
ok(again.items === 3 && again.defects === 3,
   'a second load creates nothing new: ' + JSON.stringify([again.items, again.defects]));
ok(again.ids === mig.map(m => m.obs).sort().join(','),
   'and the ids are the same ones, not fresh ones');

// the log says what each row is an observation of
await openLog(page);
const row = await page.textContent('.item .obs');
ok(/Defect/.test(row) && /1 observation/.test(row), 'the log shows the defect: ' + row.trim());
ok(/provisional/.test(row), 'and that it is provisional');
ok(/not yet claimed to exist/.test(row), 'and what that means');
ok(!/over \d+ pass/.test(row), 'with no pass count invented for a migrated row');
await page.click('#xLog');

// ================================================ new observations, live
await page.evaluate(() => {
  window.__hits = [];
  window.engine = { infer: () => Promise.resolve(window.__hits) };
  window.worker = 1;
  window.loadModel = () => Promise.resolve({});
  S.gps = { lat: 54.0, lon: -1.5, acc: 5, at: Date.now(), heading: 90, speed: 13.4 };
  setInterval(() => { if (S.gps) S.gps.at = Date.now(); }, 200);
});
await page.waitForFunction(() => document.getElementById('vid').videoWidth > 0);
const hit = [{ class: 'pothole', confidence: 0.9, bbox: { x: 300, y: 300, width: 180, height: 180 } }];

// --- first pass ---
await rec(page);
const run1 = await page.evaluate(() => survey.runId);
ok(/^[0-9a-f-]{36}$/.test(run1), 'a survey run gets an id of its own');
await page.evaluate(h => { window.__hits = h; }, hit);
await page.waitForFunction(() => S.items.length === 4, null, { timeout: 20000 });
await page.click('#bRec');

let d1 = await page.evaluate(() => {
  const d = defectById(S.items[0].defect_id);
  return { id: d.defect_id, status: d.status, n: d.observation_count, runs: d.runs.length,
           lat: d.best_lat, conf: d.position_confidence_m, heading: d.heading };
});
ok(d1.status === 'provisional' && d1.n === 1 && d1.runs === 1,
   'one pass gives a provisional defect with one observation: ' + JSON.stringify(d1));

// --- second pass over the same place: same defect, now confirmed ---
await page.evaluate(() => { window.__hits = []; });
await rec(page);
const run2 = await page.evaluate(() => survey.runId);
ok(run2 !== run1, 'the next press of record is a different run');
await page.evaluate(h => { window.__hits = h; }, hit);
await page.waitForFunction(() => S.items.length === 5, null, { timeout: 20000 });
await page.click('#bRec');

const d2 = await page.evaluate(() => {
  const d = defectById(S.items[0].defect_id);
  return { id: d.defect_id, status: d.status, n: d.observation_count, runs: d.runs.length,
           conf: d.position_confidence_m, obsIds: S.items.slice(0, 2).map(i => i.observation_id) };
});
ok(d2.id === d1.id, 'the second pass lands on the same defect, not a new one');
ok(d2.n === 2 && d2.runs === 2, 'with two observations over two passes: ' + JSON.stringify(d2));
ok(d2.status === 'confirmed',
   'and it stops being provisional once a second independent pass agrees');
ok(d2.conf <= d1.conf,
   'the position estimate does not get vaguer with more evidence: ' + d1.conf + ' → ' + d2.conf);
ok(d2.obsIds[0] !== d2.obsIds[1], 'the two observations are still two rows with two ids');
ok(await page.evaluate(() => S.defects.length) === 4,
   'and no extra defect was created');

// --- a defect a long way off is its own ---
await page.evaluate(() => { S.gps.lat = 54.01; window.__hits = []; });
await rec(page);
await page.evaluate(h => { window.__hits = h; }, hit);
await page.waitForFunction(() => S.items.length === 6, null, { timeout: 20000 });
await page.click('#bRec');
ok(await page.evaluate(() => S.defects.length) === 5,
   'a find a kilometre away is a defect of its own');

// --- the other carriageway is a different defect ---
await page.evaluate(() => { S.gps.lat = 54.0; S.gps.heading = 270; window.__hits = []; });
await rec(page);
await page.evaluate(h => { window.__hits = h; }, hit);
await page.waitForFunction(() => S.items.length === 7, null, { timeout: 20000 });
await page.click('#bRec');
ok(await page.evaluate(() => S.defects.length) === 6,
   'and so is the same place seen travelling the other way');

// --- everything survives a reload ---
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => S.items.length === 7, null, { timeout: 20000 });
await settled(page);
const kept = await page.evaluate(() => {
  const d = S.defects.filter(x => x.observation_count === 2)[0];
  return { defects: S.defects.length, twoObs: !!d, status: d && d.status, runs: d && d.runs.length };
});
ok(kept.defects === 6 && kept.twoObs && kept.status === 'confirmed' && kept.runs === 2,
   'the defects and their pass counts survive a reload: ' + JSON.stringify(kept));

// ============================================ a person verifying one
await openLog(page);
await page.click('.item .del.go');
await page.waitForSelector('#p-score:not([hidden])');
await page.click('.cell[data-i="4"][data-p="4"]');
await page.click('#bSave');
await page.waitForSelector('#p-log:not([hidden])');
const ver = await page.evaluate(() => {
  const it = S.items[0], d = defectById(it.defect_id);
  return { status: d.status, verifiedBy: d.verifiedBy, verifiedAt: !!d.verifiedAt,
           statCat: d.statCat, statResp: d.statResp };
});
ok(ver.status === 'verified', 'confirming an observation verifies its defect');
ok(ver.statCat === 'Category 1' && ver.statResp === '1 working day',
   'and the category the person assigned travels up to it: ' + JSON.stringify(ver));
ok(/inspector|accepted by a person/.test(ver.verifiedBy || ''),
   'with who verified it: ' + ver.verifiedBy);
ok(/verified/.test(await page.textContent('.item .obs')), 'and the log says so');

// ===================================== a defect does not outlive its observations
const before = await page.evaluate(() => ({
  defects: S.defects.length, target: S.items[0].defect_id, id: S.items[0].id }));
await page.evaluate(() => {
  // the two-observation defect, so one removal must NOT delete it
  const d = S.defects.filter(x => x.observation_count === 2)[0];
  window.__twoId = d.defect_id;
  window.__rows = S.items.filter(i => i.defect_id === d.defect_id).map(i => i.id);
});
const two = await page.evaluate(() => ({ id: window.__twoId, rows: window.__rows }));
ok(two.rows.length === 2, 'one defect has two observations in the log');

await page.evaluate((id) => {
  const it = S.items.filter(i => i.id === id)[0];
  S.items = S.items.filter(i => i.id !== id);
  return unfileObservation(it).then(() => delEntry(id)).then(render);
}, two.rows[0]);
const after1 = await page.evaluate((id) => {
  const d = defectById(id);
  return { exists: !!d, n: d ? d.observation_count : 0, status: d ? d.status : null };
}, two.id);
ok(after1.exists && after1.n === 1,
   'removing one of its two observations leaves the defect with one: ' + JSON.stringify(after1));
ok(after1.status === 'provisional',
   'and it drops back to provisional — the evidence for the second pass is gone, ' +
   'so the claim about it goes too');

await page.evaluate((id) => {
  const it = S.items.filter(i => i.id === id)[0];
  S.items = S.items.filter(i => i.id !== id);
  return unfileObservation(it).then(() => delEntry(id)).then(render);
}, two.rows[1]);
ok(await page.evaluate((id) => !defectById(id), two.id),
   'removing the last one takes the defect with it — nothing is left with no evidence');
ok(await page.evaluate(() => S.defects.length) === 5,
   'and the count drops by exactly one');

// and it stays gone
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => S.items.length === 5, null, { timeout: 20000 });
await settled(page);
ok(await page.evaluate(() => S.defects.length) === 5,
   'across a reload, with no orphan reappearing: ' + await page.evaluate(() => S.defects.length));

// ============================================================ the exports
await openLog(page);
await openMenu(page);
const csv = await grab('#bCsv');
await closeMenu(page);
const cols = csv.split('\r\n')[0].replace(/^﻿/, '').split(',').map(s => s.replace(/"/g, ''));
for (const c of ['observation_id', 'defect_id', 'defect_status',
                 'defect_observation_count', 'independent_pass_count', 'run_id']) {
  ok(cols.includes(c), 'CSV has a ' + c + ' column');
}
const vals = csv.split('\r\n')[1].match(/"(?:[^"]|"")*"/g).map(s => s.slice(1, -1));
const col = (n) => vals[cols.indexOf(n)];
ok(/^[0-9a-f-]{36}$/.test(col('observation_id')), 'filled with a real observation id');
ok(/provisional|confirmed|verified/.test(col('defect_status')),
   'and a status: ' + col('defect_status'));

await openMenu(page);
const geo = JSON.parse(await grab('#bGeo'));
await closeMenu(page);
const gp = geo.features[0].properties;
ok(gp.observation_id && gp.defect_id, 'GeoJSON carries both ids');
ok(['provisional', 'confirmed', 'verified'].includes(gp.defect_status),
   'and the defect status: ' + gp.defect_status);
ok(gp.independent_pass_count === null || typeof gp.independent_pass_count === 'number',
   'and a pass count that is null rather than a fabricated 1 where runs are unknown');

await openMenu(page);
const j = JSON.parse(await grab('#bJson'));
await closeMenu(page);
ok(Array.isArray(j.defects) && j.defects.length === 5,
   'the JSON export keeps `defects` as the observation list, for compatibility');
ok(Array.isArray(j.physicalDefects) && j.physicalDefects.length === 5,
   'and carries the defects themselves beside it: ' + j.physicalDefects.length);
ok(j.physicalDefects.every(d => d.defect_id && d.status),
   'each with an id and a status');
ok(j.defects.every(o => j.physicalDefects.some(d => d.defect_id === o.defect_id)),
   'and every observation points at one that is actually in the file');

console.log(fails.length ? '\n' + fails.length + ' FAILED' : '\nall passed');
await browser.close();
process.exit(fails.length ? 1 : 0);
