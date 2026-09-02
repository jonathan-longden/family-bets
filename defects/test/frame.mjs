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
  args: ['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream'] });
const ctx = await browser.newContext({
  permissions: ['camera','geolocation'], geolocation: { latitude: 53, longitude: -1.1, accuracy: 4 },
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

// The real library transfers the ImageBitmap to its worker, which neuters this
// copy — width and height become 0. This stub closes it, which does the same.
await settled(page);
await page.evaluate(() => {
  window.__closed = [];
  /* What the model is actually shown. The survey builds a square and hands it
     over as a bitmap, so this is the last point where its size is still ours
     to read — after the handover the copy is neutered and reads 0×0, which is
     the bug this suite exists for. */
  window.__fed = [];
  const realCIB = window.createImageBitmap;
  window.createImageBitmap = function (src) {
    if (src && src.width) window.__fed.push([src.width, src.height]);
    return realCIB.apply(window, arguments);
  };
  window.loadModel = () => Promise.resolve({
    CVImage: function (bmp) { window.__closed.push([bmp.width, bmp.height]); bmp.close(); return bmp; }
  });
  window.engine = { infer: () => Promise.resolve(window.__hits) };
  window.worker = 1;
  window.__hits = [{ class: 'pothole', confidence: 0.8,
                     bbox: { x: 900, y: 600, width: 400, height: 300 } }];
});
await page.waitForFunction(() => document.getElementById('vid').videoWidth > 0);

// --- the survey, where the bug bit: the bitmap is handed away and neutered ---
await rec(page);
await page.waitForFunction(() => document.getElementById('hudCount').textContent === '1 logged',
  null, { timeout: 20000 });
ok(true, 'the survey logs a find rather than calling the frame 0×0');
const dims = await page.evaluate(() => window.__fed[0]);
ok(dims[0] === 640 && dims[1] === 640,
   'the model is handed the 640 square it was trained on: ' + dims.join('×'));
await page.evaluate(() => { window.__hits = []; });
await page.click('#bRec');
await openLog(page);
ok(/% of frame/.test(await page.textContent('.item .det')), 'and records the measured share');

// --- when it really is unusable, the diagnostic now carries the video size too ---
await toCamera(page);
await page.evaluate(() => {
  window.__hits = [{ class: 'pothole', confidence: 431.38,
                     bbox: { x: 532, y: 346, width: 3145, height: 5234 } }];  // still absurd

});
await rec(page);
await page.waitForFunction(() => /unusable/i.test(document.getElementById('hudState').textContent),
  null, { timeout: 20000 });
const toast = await page.textContent('#hudToast');
ok(/Frame 640×640/.test(toast),
   'the frame is reported truthfully: ' + (toast.match(/Frame[^.]*/) || [''])[0]);
ok(/confidence 431/.test(toast), 'along with the out-of-range confidence');
await page.evaluate(() => { window.__hits = []; });
await page.click('#bRec');

await browser.close();
console.log(fails.length ? '\n' + fails.length + ' FAILED' : '\nall passed');
process.exit(fails.length ? 1 : 0);
