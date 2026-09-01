import { chromium } from 'playwright';
import { CHROME } from './browser.mjs';
import { toCamera, openLog, openMap, rec } from './shellhelp.mjs';
import { openMenu, menuHas } from './shellhelp.mjs';
const B = 'http://127.0.0.1:8777/defects/';
const fails = [];
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails.push(m); };
const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream'] });
const ctx = await browser.newContext({
  permissions: ['camera','geolocation'], geolocation: { latitude: 53.0287, longitude: -1.1371, accuracy: 4 },
  viewport: { width: 412, height: 915 } });
const page = await ctx.newPage();
let lastDialog = '';
page.on('dialog', d => { lastDialog = d.message(); d.accept(); });
await page.goto(B, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.getElementById('badge').textContent === 'Live', null, {timeout:20000});
// read out of app.js rather than hard-coded: this line had to be edited on
// every build bump, which makes it a test that only ever cries wolf
const wantBuild = (await (await fetch(B + 'app.js')).text())
  .match(/var BUILD = '([^']+)'/)[1];
ok(await page.textContent('#build') === wantBuild,
   'the screen shows the build that is in app.js: ' + wantBuild);

// two confirmed with a location, one unconfirmed with a location, one with none
await page.evaluate(async () => {
  const T = '2026-08-21T09:00:00.000Z';
  // by === 'survey, unconfirmed' means nobody classified it: no category at all
  const mk = (id, lat, lon, by, w3w, cat, key) => {
    const raw = by === 'survey, unconfirmed';
    return {
      id, t: T, img: null, imp: 4, prob: 4, score: 16,
      cat: raw ? null : cat, resp: raw ? null : '1 working day', key: raw ? 'p1' : key,
      statCat: raw ? null : cat, statResp: raw ? null : '1 working day',
      catBy: raw ? null : by, catAt: raw ? null : T, confirmedAt: raw ? null : T,
      priority: 'P1', priorityWord: 'Look at first',
      surface: 'Carriageway', scoredBy: by,
      type: 'Pothole', note: 'by the "bus" stop', lat, lon,
      acc: lat == null ? null : 4, fixAge: 0, w3w, detConf: 0.8, detShare: 0.2 };
  };
  for (const r of [
    mk(1, 53.0287, -1.1371, 'inspector', 'filled.count.soap', 'Category 1', 'k1'),
    mk(2, 53.0300, -1.1360, 'app proposal, accepted', null, 'Category 2', 'k2'),
    mk(3, 53.0270, -1.1390, 'survey, unconfirmed', null, null, null),
    mk(4, null, null, 'inspector', null, 'Category 3', 'k3')]) await putEntry(r);
  S.items = await allEntries(); render();
});
await openLog(page);

// --- the hint tells you what each export can carry ---
const hint = await page.textContent('#expHint');
ok(/GeoJSON carries 3 of 4/.test(hint), 'says how many have a location: ' + hint.slice(0, 60));
ok(/1 has none/.test(hint), 'and that one does not');
ok(/1 unconfirmed/.test(hint) && /response clock/.test(hint), 'and warns about the unconfirmed one');

const dl = page.waitForEvent('download');
await openMenu(page); await page.click('#bGeo');
const g = JSON.parse((await import('fs')).readFileSync(await (await dl).path(), 'utf8'));

ok(g.type === 'FeatureCollection', 'it is a FeatureCollection');
ok(g.features.length === 3, 'with only the located entries');
const f = g.features.find(x => x.id === 1);

// the classic GeoJSON trap: longitude first
ok(f.geometry.type === 'Point', 'each is a Point');
ok(f.geometry.coordinates[0] === -1.1371 && f.geometry.coordinates[1] === 53.0287,
   'longitude first, latitude second: ' + JSON.stringify(f.geometry.coordinates));
ok(Math.abs(f.geometry.coordinates[0]) < 10 && f.geometry.coordinates[1] > 45,
   'which puts it in Nottinghamshire rather than the sea off Somalia');

// properties a GIS can actually read
const vals = Object.values(f.properties);
ok(vals.every(v => v === null || ['string','number','boolean'].includes(typeof v)),
   'every property is a flat scalar');
ok(f.properties.category === 'Category 1' && f.properties.response_time === '1 working day',
   'the old category and response_time keys still carry a real classification');
ok(f.properties.statutory_category === 'Category 1' &&
   f.properties.categorised_by === 'inspector',
   'and the new keys say who assigned it');
ok(f.properties.app_priority === 'P1', 'the app\u2019s own priority rides alongside');

// the one nobody looked at: a priority, and nothing that reads as a duty
const raw = g.features.find(x => x.id === 3);
ok(raw.properties.category === null && raw.properties.response_time === null &&
   raw.properties.statutory_category === null && raw.properties.categorised_by === null,
   'an unconfirmed survey find exports no category and no response time');
ok(raw.properties.app_priority === 'P1' && /not a statutory category/.test(raw.properties.app_priority_note),
   'only a priority, labelled as one: ' + raw.properties.app_priority_note);
ok(f.properties.what3words === '///filled.count.soap', 'three-word address carried');
ok(f.properties.notes === 'by the "bus" stop', 'notes carried verbatim, quotes and all');
ok(f.properties.has_photograph === false, 'and it says whether a photograph exists elsewhere');

// the part that matters before this reaches anything with an SLA
ok(f.properties.confirmed === true, 'an inspector entry is confirmed');
ok(g.features.find(x => x.id === 2).properties.confirmed === true,
   'an accepted proposal counts as confirmed');
const un = g.features.find(x => x.id === 3);
ok(un.properties.confirmed === false, 'a survey find is not');
ok(un.properties.scored_by === 'survey, unconfirmed', 'and says so in words too');
ok(g.features.filter(x => x.properties.confirmed).length === 2, 'two of three are confirmed');

// --- nothing located at all ---
await page.evaluate(async () => { await clearEntries(); S.items = []; render();
  await putEntry({ id: 9, t: new Date().toISOString(), img: null, imp: 1, prob: 1, score: 1,
    cat: 'Below threshold', resp: 'No response category', key: 'k0', surface: 'Carriageway',
    scoredBy: 'inspector', type: 'Pothole', note: '' });
  S.items = await allEntries(); render(); });
lastDialog = '';
await openMenu(page); await page.click('#bGeo');
await page.waitForFunction(() => true);
ok(/no entry in the log has a location/.test(lastDialog),
   'with nothing located it says so rather than writing an empty file: ' + lastDialog);

await browser.close();
console.log(fails.length ? '\n' + fails.length + ' FAILED' : '\nall passed');
process.exit(fails.length ? 1 : 0);
