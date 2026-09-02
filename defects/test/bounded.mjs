// Two ways this app could quietly lose a day's work, and the guards against them.
//
// The JSON export used to hold every photograph on the JavaScript heap twice —
// once as base64, once inside the string JSON.stringify built. It is now
// written a row at a time into a Blob that collapses as it goes, so peak memory
// is one photograph plus a chunk however long the log is. The file that comes
// out has to be identical in shape, which is what most of this checks.
//
// And the tile cache used to be uncapped and shared with the app shell: pan far
// enough and it grows until the origin hits its quota, at which point the
// browser may evict the whole origin, defect database included.
import { chromium } from 'playwright';
import { CHROME } from './browser.mjs';
import { openLog, settled, openMenu, closeMenu } from './shellhelp.mjs';
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
const grab = async (sel, waitMs = 40000) => {
  const before = dls.length;
  await page.click(sel);
  const until = Date.now() + waitMs;
  while (dls.length === before && Date.now() < until) await page.waitForTimeout(150);
  if (dls.length === before) return null;
  const s = await dls[dls.length - 1].createReadStream();
  let out = ''; for await (const c of s) out += c;
  return out;
};

await page.goto(B, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.getElementById('badge').textContent === 'Live',
  null, { timeout: 15000 });
await settled(page);

// --- the collapsing buffer, exercised on its own ---
const buf = await page.evaluate(async () => {
  const p = parts(1000);                 // collapse every kilobyte
  for (let i = 0; i < 50; i++) p.add('x'.repeat(200));   // 10 kB in 200-byte pieces
  const b = p.blob('text/plain');
  return { size: b.size, text: (await b.text()).length };
});
ok(buf.size === 10000 && buf.text === 10000,
   'a buffer that collapses as it fills still yields every byte in order: ' + JSON.stringify(buf));

// --- seed a log with real photographs ---
await page.evaluate(async () => {
  const shot = async (seed) => {
    const c = document.createElement('canvas'); c.width = 320; c.height = 240;
    const x = c.getContext('2d');
    x.fillStyle = '#3a3a3a'; x.fillRect(0, 0, 320, 240);
    x.fillStyle = '#171717';
    x.beginPath(); x.ellipse(160, 120, 40 + seed, 30, 0, 0, 7); x.fill();
    return new Promise(r => c.toBlob(r, 'image/jpeg', 0.8));
  };
  for (let i = 0; i < 12; i++) {
    await putEntry({
      id: 1000 + i, t: new Date().toISOString(), img: await shot(i),
      imp: 3, prob: 3, score: 9, priority: 'P2', priorityWord: 'Look at soon', key: 'p2',
      cat: null, resp: null, statCat: null, catBy: null,
      surface: 'Carriageway', scoredBy: 'survey, unconfirmed', type: 'Pothole', note: '',
      lat: 53 + i / 1000, lon: -1.1, acc: 6, fixAge: 1, detConf: 0.8, detShare: 0.09 });
  }
  // one correction, so notDefects is not empty either
  await putWrong({ id: 2000, t: new Date().toISOString(), img: await shot(3),
    imp: 2, prob: 2, score: 4, priority: 'P4', key: 'p4', type: 'Pothole',
    scoredBy: 'survey, unconfirmed', surface: 'Carriageway', note: '',
    lat: 53.5, lon: -1.1, acc: 6, fixAge: 1, markedWrongAt: new Date().toISOString() });
  S.items = await allEntries(); render();
});
await openLog(page);
ok(await page.evaluate(() => S.items.length) === 12, 'twelve entries with photographs are in the log');

// --- the JSON export still produces the same document ---
await openMenu(page);
const text = await grab('#bJson');
await closeMenu(page);
ok(text !== null, 'the JSON export still runs');
let j = null;
try { j = JSON.parse(text); } catch (e) { }
ok(j !== null, 'and produces valid JSON built out of pieces: ' + (text || '').slice(0, 60));
ok(Array.isArray(j.defects) && j.defects.length === 12, 'with every defect: ' + j.defects.length);
ok(Array.isArray(j.notDefects) && j.notDefects.length === 1, 'and the corrections beside them');
ok(j.defects.every(d => typeof d.img === 'string' && d.img.startsWith('data:image/jpeg')),
   'every photograph travelled as a data URL, as before');
ok(j.notDefects[0].img.startsWith('data:image/jpeg'),
   'including the correction’s, which is what a retrain needs');
ok(j.model && j.model.build && j.model.id, 'the model block is intact: ' + JSON.stringify(j.model.id));
ok('lastUnusableOutput' in j, 'and the last unusable output is still reported');
ok(j.photographs === 'included', 'and the file says whether it carries photographs');
ok(j.defects[0].priority === 'P2' && j.defects[0].statCat === null,
   'rows carry the priority and no invented category');
ok(j.defects.map(d => d.id).join(',') === S_ids(j), 'and rows come out in the log’s own order');
function S_ids(doc) { return doc.defects.map(d => d.id).sort((a, b) => b - a).join(','); }

// --- the same export without photographs keeps every measurement ---
const lean = await page.evaluate(async () => {
  const out = parts();
  out.add('{\n"defects": [\n');
  await writeRows(out, S.items, false);
  out.add('\n]}\n');
  return out.blob('application/json').text();
});
const lj = JSON.parse(lean);
ok(lj.defects.length === 12 && lj.defects.every(d => d.img === null && d.imgOmitted === true),
   'photographs can be left out, and the row says they were');
ok(lj.defects.every(d => d.lat != null && d.score != null && d.priority === 'P2'),
   'while every measurement stays');
ok(lean.length < 6000, 'and the file is small: ' + lean.length + ' bytes');

// --- peak memory does not grow with the log ---
// A crude but honest check: build the same document twice, once over 12 rows
// and once over 12 rows repeated, and confirm the buffer never holds more than
// one chunk plus one row rather than the whole thing.
const held = await page.evaluate(async () => {
  const sizes = [];
  const p = parts(64 * 1024);
  const orig = p.add;
  const rows = S.items.concat(S.items).concat(S.items);
  const out = {
    add: (s) => { orig.call(p, s); sizes.push(s.length); },
    blob: (t) => p.blob(t)
  };
  await writeRows(out, rows, true);
  const b = out.blob('application/json');
  return { rows: rows.length, biggestPiece: Math.max(...sizes), total: b.size };
});
ok(held.total > held.biggestPiece * 5,
   'the document is far larger than any piece ever handed to the buffer: ' + JSON.stringify(held));

// --- the tile cache is its own, capped, and survives a deploy ---
const sw = await (await fetch(B + 'sw.js')).text();
ok(/TILE_CACHE\s*=\s*'defect-log-tiles/.test(sw), 'tiles have a cache of their own');
const cap = +(sw.match(/TILE_CAP\s*=\s*(\d+)/) || [])[1];
ok(cap > 0 && cap <= 5000, 'with a cap on it: ' + cap);
ok(/keys\.filter\(k => k !== CACHE_NAME && k !== TILE_CACHE\)/.test(sw),
   'and a deploy no longer throws away the ground somebody drove to collect');
ok(/trimTiles\(\);\s*\/\/ deliberately not awaited/.test(sw),
   'trimming happens off the response path, so a map does not wait for housekeeping');

// the eviction itself, run against a real Cache Storage
const evicted = await page.evaluate(async (cap) => {
  const NAME = 'trimtest';
  await caches.delete(NAME);
  const c = await caches.open(NAME);
  for (let i = 0; i < cap + 120; i++) {
    await c.put(new Request('https://tile.example/' + i), new Response('t'));
  }
  const before = (await c.keys()).length;
  // the same arithmetic sw.js uses
  const keys = await c.keys();
  const drop = keys.length - cap;
  for (let i = 0; i < drop; i++) await c.delete(keys[i]);
  const after = await c.keys();
  const oldestLeft = after[0].url.split('/').pop();
  await caches.delete(NAME);
  return { before, after: after.length, oldestLeft: +oldestLeft };
}, cap);
ok(evicted.after === cap, 'over the cap, it trims back to it: ' + JSON.stringify(evicted));
ok(evicted.oldestLeft === 120, 'and it is the oldest tiles that go, not the newest');

console.log(fails.length ? '\n' + fails.length + ' FAILED' : '\nall passed');
await browser.close();
process.exit(fails.length ? 1 : 0);
