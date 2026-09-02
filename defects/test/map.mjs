import { chromium } from 'playwright';
import { CHROME } from './browser.mjs';
import { toCamera, openLog, openMap, rec } from './shellhelp.mjs';
import { openMenu, menuHas } from './shellhelp.mjs';
const B = 'http://127.0.0.1:8777/defects/';
const fails = [];
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails.push(m); };
const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
const ctx = await browser.newContext({
  permissions: ['camera','geolocation'], geolocation: { latitude: 53.0287, longitude: -1.1371, accuracy: 4 },
  viewport: { width: 412, height: 915 } });
// tiles are somebody else's server and are blocked here; the map must not need them
await ctx.route('https://tile.openstreetmap.org/**', r => r.abort('failed'));
const page = await ctx.newPage();
page.on('dialog', d => d.accept());
await page.goto(B, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.getElementById('badge').textContent === 'Live', null, {timeout:20000});
// read out of app.js rather than hard-coded: this line had to be edited on
// every build bump, which makes it a test that only ever cries wolf
const wantBuild = (await (await fetch(B + 'app.js')).text())
  .match(/var BUILD = '([^']+)'/)[1];
ok(await page.textContent('#build') === wantBuild,
   'the screen shows the build that is in app.js: ' + wantBuild);

// --- an empty map says so rather than showing blank grey ---
await openMap(page);
ok(await page.isVisible('#mapEmpty'), 'with nothing located, it says so');
ok(!(await page.isVisible('#map')), 'and shows no empty map');

// --- seed entries: two a person classified, one raw survey find ---
await page.evaluate(async () => {
  const now = new Date().toISOString();
  const signed = (id, lat, lon, cat, resp, key, w3w) => ({
    id, t: now, img: null, imp: 4, prob: 4, score: 16,
    cat, resp, key, statCat: cat, statResp: resp, catBy: 'inspector', catAt: now,
    confirmedAt: now, priority: 'P1', surface: 'Carriageway', scoredBy: 'inspector',
    type: 'Pothole', note: '', lat, lon, acc: 4, fixAge: 0, w3w });
  // what the survey writes now: a priority, no category, no response time
  const surveyed = (id, lat, lon) => ({
    id, t: now, img: null, imp: 4, prob: 4, score: 16,
    cat: null, resp: null, statCat: null, catBy: null,
    priority: 'P1', priorityWord: 'Look at first', key: 'p1',
    surface: 'Carriageway', scoredBy: 'survey, unconfirmed',
    type: 'Pothole', note: '', lat, lon, acc: 4, fixAge: 0, w3w: null });
  const rows = [
    signed(1, 53.0287, -1.1371, 'Category 1', '1 working day', 'k1', 'filled.count.soap'),
    signed(2, 53.0300, -1.1360, 'Category 2', '28 calendar days', 'k2', null),
    surveyed(3, 53.0270, -1.1390),
  ];
  for (const r of rows) await putEntry(r);
  S.items = await allEntries(); render();
});
await toCamera(page); await openMap(page);
await page.waitForFunction(() => document.querySelectorAll('.mappin').length === 3, null, { timeout: 20000 });
ok(true, 'a pin is dropped for every located defect');
ok(await page.isVisible('#map'), 'and the map is shown');
ok(!(await page.isVisible('#mapEmpty')), 'and the empty notice is gone');

// --- pins say category where there is one, priority where there is not ---
const classes = await page.$$eval('.mappin', ns => ns.map(n => n.className));
ok(classes.some(c => /\bk1\b/.test(c)) && classes.some(c => /\bk2\b/.test(c)),
   'a classified pin carries its category: ' + classes.join(' | '));
ok(classes.some(c => /\bp1\b/.test(c)),
   'and an unclassified survey find carries the app\u2019s priority instead');
ok(!classes.some(c => /\bkem\b|\bk3\b|\bk0\b/.test(c)),
   'nothing the survey wrote is coloured as a statutory category');
ok(classes.filter(c => /unconf/.test(c)).length === 1,
   'exactly the unconfirmed survey find is hollowed');

// --- the map works with no tiles at all ---
ok(await page.evaluate(() => !!window.L && !!document.querySelector('.leaflet-container')),
   'leaflet runs from the app itself, with every tile request refused');
ok(await page.evaluate(() => !!document.querySelector('.leaflet-control-attribution')),
   'and OpenStreetMap is credited');

// --- a pin tells you what it is ---
await page.click('.mappin >> nth=0');
await page.waitForSelector('.leaflet-popup-content', { timeout: 10000 });
const pop = await page.textContent('.leaflet-popup-content');
ok(/Category|Emergency|P[1-4]/.test(pop),
   'the pin opens saying what it is: ' + pop.split('\n')[0]);
ok(/53\.0\d+, -1\.1\d+/.test(pop), 'and its coordinates');

// --- the three-word address shows where there is one ---
const withWords = await page.evaluate(() => {
  const m = [...document.querySelectorAll('.mappin')];
  return m.length;
});
ok(withWords === 3, 'all three are on the map');
await openLog(page);
const log = await page.textContent('#list');
ok(/\/\/\/filled\.count\.soap/.test(log), 'the log shows a three-word address when an entry has one');
ok(/No GPS fix|53\.03000/.test(log), 'and entries without one still show coordinates');

// --- and it reaches the CSV ---
const dl = page.waitForEvent('download');
await openMenu(page); await page.click('#bCsv');
const csv = (await import('fs')).readFileSync(await (await dl).path(), 'utf8');
ok(/what3words/.test(csv.split('\r\n')[0]), 'the CSV has a what3words column');
ok(/\/\/\/filled\.count\.soap/.test(csv), 'carrying the address');

// --- a key ships with the app but is spent only on the site it belongs to ---
ok(await page.evaluate(() => w3wKey()) === '',
   'off its own site the app uses no key rather than this account\u2019s');
ok(await page.evaluate(() => {
  const was = W3W_HOSTS.slice();
  W3W_HOSTS.length = 0; W3W_HOSTS.push(location.hostname);
  const k = w3wKey();
  W3W_HOSTS.length = 0; was.forEach(h => W3W_HOSTS.push(h));
  return k;
}) !== '', 'and on its own site the built-in key still applies');
await page.evaluate(() => { localStorage.setItem('deflog.w3w', ''); });
ok(await page.evaluate(() => w3wKey()) === '', 'an emptied field is honoured, not treated as absent');
ok(await page.evaluate(() => words(53, -1).then(w => w === null)), 'and no lookup is attempted');

await browser.close();
console.log(fails.length ? '\n' + fails.length + ' FAILED' : '\nall passed');
process.exit(fails.length ? 1 : 0);
