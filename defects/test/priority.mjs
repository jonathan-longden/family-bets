// The line between what the app may say and what only a person may say.
//
// The app writes a priority: P1 to P4, its own ordering, no time attached.
// A statutory category — Emergency, Category 1, "2 hours" — exists only where
// somebody sat with the photograph and chose a cell. This suite drives both
// paths and checks that neither leaks into the other, on screen and in every
// export, including for rows written by builds that did not know the
// difference.
import { chromium } from 'playwright';
import { CHROME } from './browser.mjs';
import { toCamera, openLog, openMap, rec, settled, openMenu, closeMenu } from './shellhelp.mjs';
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

// downloads, so the exports can actually be read back rather than assumed
const dls = [];
page.on('download', d => dls.push(d));
const grab = async (sel) => {
  const before = dls.length;
  await page.click(sel);
  for (let i = 0; i < 60 && dls.length === before; i++) await page.waitForTimeout(100);
  if (dls.length === before) return null;
  const s = await dls[dls.length - 1].createReadStream();
  let out = ''; for await (const c of s) out += c;
  return out;
};

await page.goto(B, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.getElementById('badge').textContent === 'Live',
  null, { timeout: 15000 });
await settled(page);

// --- the pure functions, exercised directly ---
const pri = await page.evaluate(() => ({
  p1: priorityFor(20).p, p2: priorityFor(12).p, p3: priorityFor(6).p, p4: priorityFor(4).p,
  none: priorityFor(NaN), zero: priorityFor(0)
}));
ok(pri.p1 === 'P1' && pri.p2 === 'P2' && pri.p3 === 'P3' && pri.p4 === 'P4',
   'the four priority bands come out in order: ' + JSON.stringify(pri));
ok(pri.none === null && pri.zero === null,
   'a score that is not a score gets no priority rather than the bottom one');

// A row written by an older build: a category the survey wrote for itself,
// never seen by anybody. It must not read as a classification.
const legacy = await page.evaluate(() => statutoryOf({
  cat: 'Category 2', resp: '28 calendar days', score: 12, scoredBy: 'survey, unconfirmed' }));
ok(legacy === null,
   'a category an old build wrote for itself is not treated as one');
const legacyPri = await page.evaluate(() => priorityOf({
  cat: 'Category 2', score: 12, scoredBy: 'survey, unconfirmed' }).p);
ok(legacyPri === 'P2', 'but its score still yields a priority, so it still sorts: ' + legacyPri);

const human = await page.evaluate(() => statutoryOf({
  statCat: 'Category 1', statResp: '1 working day', catBy: 'inspector',
  catAt: '2026-01-01T00:00:00.000Z' }));
ok(human && human.cat === 'Category 1' && human.by === 'inspector',
   'a category with a person\'s name on it is one');

// --- drive the survey and read what lands ---
await page.evaluate(() => {
  window.__hits = [];
  window.engine = { infer: () => Promise.resolve(window.__hits) };
  window.worker = 1;
  window.loadModel = () => Promise.resolve({});
});
await page.waitForFunction(() => document.getElementById('vid').videoWidth > 0);
const hit = (w) => [{ class: 'pothole', confidence: 0.9, bbox: { x: 300, y: 300, width: w, height: w } }];

await rec(page);
// 600px in the 640 square is about 16% of the PHOTOGRAPH once the road crop
// is taken into account — the 'large' band, imp 4 x prb 4 = 16, which is P1.
// It cannot be 43% any more: the crop is roughly 18% of the frame, so
// nothing inside it covers more of the photograph than that. P1 is still
// reachable; only the 'very large' label above it is out of range, and that
// scored P1 too.
await page.evaluate(h => { window.__hits = h; }, hit(600));
await page.waitForFunction(() => document.getElementById('hudCount').textContent === '1 logged',
  null, { timeout: 15000 });
await page.click('#bRec');

const stored = await page.evaluate(() => {
  const it = S.items[0];
  return { priority: it.priority, word: it.priorityWord, key: it.key,
           cat: it.cat, resp: it.resp, statCat: it.statCat, catBy: it.catBy,
           score: it.score, scoredBy: it.scoredBy };
});
ok(stored.priority === 'P1', 'the survey wrote a priority: ' + stored.priority);
ok(stored.cat === null && stored.resp === null,
   'and left the category and the response time empty: ' + JSON.stringify([stored.cat, stored.resp]));
ok(stored.catBy === null && stored.statCat === null,
   'and named nobody as having classified it');
ok(stored.key === 'p1', 'the colour it carries is a priority colour, not a category one');

// --- the log reads as a priority, with no response time anywhere ---
await openLog(page);
const row = await page.textContent('.item');
ok(/P1/.test(row), 'the log entry leads with the priority');
ok(/app priority/i.test(row), 'and says in as many words whose priority it is');
ok(/not classified/i.test(row), 'and that nothing has been classified');
ok(!/(2 hours|1 working day|28 calendar days|90 calendar days)/.test(row),
   'and carries no response time: ' + row.replace(/\s+/g, ' ').slice(0, 200));
ok(!/Category [123]|Emergency|Below threshold/.test(row),
   'and no statutory category');
ok(await page.isVisible('.item.p1'), 'and is marked in the app\'s own colour');

// --- CSV: priority filled, statutory blank ---
const was = await openMenu(page);
const csv = await grab('#bCsv');
await closeMenu(page);
ok(csv !== null, 'the CSV still exports');
const head = csv.split('\r\n')[0];
const body = csv.split('\r\n')[1];
const col = (n) => {
  const cols = head.replace(/^﻿/, '').split(',').map(s => s.replace(/^"|"$/g, ''));
  const vals = body.match(/"(?:[^"]|"")*"/g).map(s => s.slice(1, -1).replace(/""/g, '"'));
  return vals[cols.indexOf(n)];
};
ok(/app_priority/.test(head) && /statutory_category/.test(head),
   'with both columns in it: ' + head.replace(/^﻿/, '').slice(0, 160));
ok(col('app_priority') === 'P1', 'the priority column is filled: ' + col('app_priority'));
ok(col('statutory_category') === '' && col('statutory_response_time') === '',
   'the statutory columns are empty, which is the honest answer');
ok(col('categorised_by') === '', 'and nobody is named as having categorised it');

// --- GeoJSON: null, not a category ---
await openMenu(page);
const geo = JSON.parse(await grab('#bGeo'));
await closeMenu(page);
const props = geo.features[0].properties;
ok(props.app_priority === 'P1', 'GeoJSON carries the priority');
ok(props.statutory_category === null && props.statutory_response_time === null,
   'and nulls the statutory fields rather than inventing them');
ok(/not a statutory category/.test(props.app_priority_note || ''),
   'and says on the feature itself what the priority is not');
ok(props.confirmed === false, 'and still marks it unconfirmed for anything filtering on that');

// --- a person confirms it, and only then is there a category ---
await openLog(page);
await page.click('.item .del.go');
await page.waitForSelector('#p-score:not([hidden])');
ok(/priority and nothing else/i.test(await page.textContent('#scan')),
   'the confirm screen says the survey gave it a priority and nothing else');
ok(/Nothing is classified until you confirm/.test(await page.textContent('#vBy')),
   'and that the category on screen is not one yet');
await page.click('.cell[data-i="4"][data-p="4"]');       // 16 → Category 1
ok(await page.textContent('#vCat') === 'Category 1', 'a person picking a cell sees the category');
await page.click('#bSave');
await page.waitForSelector('#p-log:not([hidden])');

const after = await page.evaluate(() => {
  const it = S.items[0];
  return { statCat: it.statCat, statResp: it.statResp, catBy: it.catBy, catAt: it.catAt,
           priority: it.priority, cat: it.cat };
});
ok(after.statCat === 'Category 1' && after.statResp === '1 working day',
   'confirming writes the statutory category: ' + JSON.stringify(after));
ok(/inspector|accepted by a person/.test(after.catBy || ''),
   'with who assigned it: ' + after.catBy);
ok(!!after.catAt, 'and when');
ok(after.priority === 'P1', 'the app\'s priority is kept alongside it, not overwritten');

const row2 = await page.textContent('.item');
ok(/Category 1/.test(row2) && /1 working day/.test(row2),
   'the confirmed entry now shows the category and its response time');
ok(/assigned by/.test(row2), 'and who assigned it');
ok(!/app priority/i.test(row2), 'and no longer reads as an app priority');

await openMenu(page);
const csv2 = await grab('#bCsv');
await closeMenu(page);
const body2 = csv2.split('\r\n')[1];
ok(/Category 1/.test(body2) && /1 working day/.test(body2),
   'and the CSV now carries the statutory columns');

console.log(fails.length ? '\n' + fails.length + ' FAILED' : '\nall passed');
await browser.close();
process.exit(fails.length ? 1 : 0);
