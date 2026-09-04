import { chromium } from 'playwright';
import { CHROME } from './browser.mjs';
import { toCamera, openLog, openMap, rec } from './shellhelp.mjs';
import { settled } from './shellhelp.mjs';
import { openMenu, menuHas } from './shellhelp.mjs';
const B = 'http://127.0.0.1:8777/defects/';
const fails = [];
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails.push(m); };
const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
const ctx = await browser.newContext({
  permissions: ['camera','geolocation'], geolocation: { latitude: 53, longitude: -1.1, accuracy: 8 },
  viewport: { width: 844, height: 390 } });
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

// --- the surface can be set where a survey is actually started ---
await page.click('#bMenu');
ok(await page.isVisible('#segSurvCar') && await page.isVisible('#segSurvFoot'),
   'the survey has a surface setting of its own, in the menu');
ok(await page.textContent('#hudSurface') === 'Carriageway', 'defaulting to carriageway');
await page.click('#segSurvFoot');
ok(await page.textContent('#hudSurface') === 'Footway', 'switching it updates the chip on the glass');
await page.click('#bMenu');
ok(await page.getAttribute('#segFoot', 'aria-pressed') === 'true',
   'and the scoring screen agrees — it is one setting, not two');

// --- a survey find is recorded against it ---
await settled(page);
await page.evaluate(() => {
  // 0.75x the box this was written with: share is measured against the
  // letterboxed picture since build 55, and that factor makes the measured
  // share identical to what it was before, so the bands under test are the
  // same ones.
  window.__hits = [{ class:'pothole', confidence:0.9, bbox:{x:300,y:280,width:262,height:240} }];
  window.engine = { infer: () => Promise.resolve(window.__hits) };
  window.worker = 1; window.loadModel = () => Promise.resolve({});
});
await page.waitForFunction(() => document.getElementById('vid').videoWidth > 0);
await rec(page);
await page.waitForFunction(() => document.getElementById('hudCount').textContent === '1 logged', null, {timeout:15000});
await page.evaluate(() => { window.__hits = []; });
await page.click('#bRec');
await openLog(page);
let det = await page.textContent('.item .det');
ok(/Footway\/cycleway/.test(det), 'the find is logged against the footway, not the carriageway');
ok(/Pothole/.test(det), 'and typed as what the model can say');

// --- an inspection cover: right defect, wrong words ---
await page.click('.item .amend-open');
ok(await page.isVisible('.item .amend'), 'an entry can be amended rather than only binned');
const before = await page.textContent('.item .sc');
await page.selectOption('.item .amType', 'Ironwork');
await page.selectOption('.item .amSurface', 'Carriageway');
await page.click('.item .amSave');
await page.waitForFunction(() => /Ironwork/.test(document.querySelector('.item .det').textContent), null, {timeout:10000});
det = await page.textContent('.item .det');
ok(/Ironwork/.test(det), 'the type is corrected');
ok(/Carriageway/.test(det) && !/Footway/.test(det), 'and the surface with it');
ok(/amended/.test(det), 'and the entry says it was amended');
const after = await page.textContent('.item .sc');
ok(before !== after, 'moving it between surfaces re-scores the app’s proposal: ' + before + ' → ' + after);

// --- a score a person chose is theirs, and is left alone ---
await page.evaluate(() => {
  const it = S.items[0];
  it.scoredBy = 'inspector'; it.imp = 5; it.prob = 5; it.score = 25;
  it.cat = 'Emergency'; it.resp = '2 hours'; it.key = 'kem';
  return putEntry(it).then(render);
});
await page.click('.item .amend-open');
await page.selectOption('.item .amSurface', 'Footway/cycleway');
await page.click('.item .amSave');
await page.waitForFunction(() => /Footway/.test(document.querySelector('.item .det').textContent), null, {timeout:10000});
ok(await page.textContent('.item .sc') === '5 × 5 = 25', 'an inspector’s own score survives an amend');

// --- corrections persist ---
await page.reload({ waitUntil: 'domcontentloaded' });
await openLog(page);
det = await page.textContent('.item .det');
ok(/Ironwork/.test(det) && /amended/.test(det), 'the correction survives a reload');
const dl = page.waitForEvent('download');
await openMenu(page); await page.click('#bCsv');
const csv = (await import('fs')).readFileSync(await (await dl).path(), 'utf8');
ok(/Ironwork/.test(csv), 'and reaches the CSV');

await browser.close();
console.log(fails.length ? '\n' + fails.length + ' FAILED' : '\nall passed');
process.exit(fails.length ? 1 : 0);
