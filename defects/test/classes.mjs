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

ok(await page.evaluate(() => typeFor('manhole')) === 'Ironwork', 'manhole maps to Ironwork');
ok(await page.evaluate(() => typeFor('pothole')) === 'Pothole', 'pothole maps to Pothole');
ok(await page.evaluate(() => known('rhubarb')) === false, 'a class it does not know is not accepted');

await settled(page);

await page.evaluate(() => {
  window.__hits = [];
  window.engine = { infer: () => Promise.resolve(window.__hits) };
  window.worker = 1;
  window.loadModel = () => Promise.resolve({ CVImage: function (b) { return b; } });
});
await page.waitForFunction(() => document.getElementById('vid').videoWidth > 0);
const hit = (cls, conf = 0.9) => [{ class: cls, confidence: conf, bbox: { x: 260, y: 240, width: 300, height: 260 } }];

// Capture is gone: the survey is the only way a find gets written down, so
// what used to be checked on a photograph is checked on the loop instead.

// --- survey passes over ironwork, logs holes ---
await toCamera(page);
await page.evaluate(h => { window.__hits = h; }, hit('manhole'));
await rec(page);
await page.waitForFunction(() => /Ironwork/.test(document.getElementById('hudState').textContent), null, {timeout:15000});
ok(/sound cover, not logged/.test(await page.textContent('#hudState')), 'a survey passes over a sound cover');
await new Promise(r => setTimeout(r, 3500));
ok(await page.textContent('#hudCount') === '0 logged', 'and writes nothing down for it');
await page.evaluate(h => { window.__hits = h; }, hit('pothole'));
await page.waitForFunction(() => document.getElementById('hudCount').textContent === '1 logged', null, {timeout:15000});
ok(/Logged pothole/.test(await page.textContent('#hudToast')), 'but does log a hole, saying what it is');
await page.evaluate(() => { window.__hits = []; });
await page.click('#bRec');
await openLog(page);
ok(/Pothole/.test(await page.textContent('.item .det')), 'and the entry is typed from the model');

// --- and the confirm screen repeats what the model said, rather than re-guessing ---
await page.click('.del.go');
await page.waitForSelector('#p-score:not([hidden])');
ok(await page.inputValue('#fType') === 'Pothole', 'the confirm screen opens on the type the model gave');
ok(/90% sure when the survey logged it/.test(await page.textContent('#scan')),
   'and repeats how sure it was at the time');

await browser.close();
console.log(fails.length ? '\n' + fails.length + ' FAILED' : '\nall passed');
process.exit(fails.length ? 1 : 0);
