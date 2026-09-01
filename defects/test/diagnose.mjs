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
  permissions: ['camera','geolocation'], geolocation: { latitude: 53.0287, longitude: -1.1371, accuracy: 2 },
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

// exactly what the phone returned
const REAL = () => Array.from({ length: 20 }, () => ({ class: 'pothole', confidence: 1.0039973258972168 }));
const summary = await page.evaluate(r => describeRaw(r), REAL());
console.log('   → ' + summary);
ok(/20 results/.test(summary), 'counts what came back');
ok(/keys \[class, confidence\]/.test(summary), 'names the keys that were present');
ok(/confidence 1\.004/.test(summary), 'reports the confidence range');
ok(/0 with a measurable box/.test(summary), 'says none had a usable box');
ok(/no box/.test(summary), 'and that the first had none at all');

const mixed = await page.evaluate(() => describeRaw([
  { class: 'pothole', confidence: 5323169.5, bbox: { x: 10, y: 20, width: NaN, height: 30 } },
  { class: 'pothole', confidence: 0.5, bbox: { x: 1, y: 2, width: 3, height: 4 } }]));
console.log('   → ' + mixed);
ok(/confidence 0\.5 to 5323170/.test(mixed), 'reports a range across results');
ok(/1 with a measurable box/.test(mixed), 'counts only the measurable ones');

// --- the survey shows it and keeps it for the export ---
await settled(page);
await page.evaluate(() => {
  window.engine = { infer: () => Promise.resolve(window.__hits) };
  window.worker = 1;
  window.loadModel = () => Promise.resolve({ CVImage: function (b) { return b; } });
  window.__hits = Array.from({ length: 20 }, () => ({ class: 'pothole', confidence: 1.0039973258972168 }));
});
await page.waitForFunction(() => document.getElementById('vid').videoWidth > 0);
await rec(page);
await page.waitForFunction(() => /unusable/i.test(document.getElementById('hudState').textContent), null, {timeout:15000});
const toast = await page.textContent('#hudToast');
ok(/20 results/.test(toast) && /Frame \d+×\d+/.test(toast), 'the HUD shows what came back: ' + toast.slice(0, 70));
ok(await page.textContent('#hudCount') === '0 logged', 'and still logs nothing');
await page.evaluate(() => { window.__hits = []; });
await page.click('#bRec');

// --- and it reaches the export, so no second drive is needed ---
await openLog(page);
await page.evaluate(() => {                       // one real entry so an export exists
  return putEntry({ id: Date.now(), t: new Date().toISOString(), img: null,
    imp: 2, prob: 2, score: 4, cat: 'Below threshold', resp: 'No response category', key: 'k0',
    surface: 'Carriageway', scoredBy: 'inspector', type: 'Pothole', note: '' })
    .then(() => allEntries()).then(r => { S.items = r; render(); });
});
const dl = page.waitForEvent('download');
await openMenu(page); await page.click('#bJson');
const j = JSON.parse((await import('fs')).readFileSync(await (await dl).path(), 'utf8'));
ok(j.model && j.model.id && j.model.build, 'the export names the model and build: ' + JSON.stringify(j.model));
ok(j.lastUnusableOutput && /20 results/.test(j.lastUnusableOutput.summary),
   'and carries what the model last returned');
ok(j.lastUnusableOutput.first && j.lastUnusableOutput.first.confidence === 1.0039973258972168,
   'including a verbatim first result');
ok(/\d+×\d+/.test(j.lastUnusableOutput.frame), 'and the frame it came from');

await browser.close();
console.log(fails.length ? '\n' + fails.length + ' FAILED' : '\nall passed');
process.exit(fails.length ? 1 : 0);
