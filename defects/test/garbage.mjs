import { chromium } from 'playwright';
import { CHROME } from './browser.mjs';
import { toCamera, openLog, openMap, rec } from './shellhelp.mjs';
import { settled } from './shellhelp.mjs';
const B = 'http://127.0.0.1:8777/defects/';
const fails = [];
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails.push(m); };
const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
const ctx = await browser.newContext({
  permissions: ['camera','geolocation'], geolocation: { latitude: 53.0287, longitude: -1.1371, accuracy: 4 },
  viewport: { width: 844, height: 390 } });
const page = await ctx.newPage();
page.on('dialog', d => d.accept());
await page.goto(B, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.getElementById('badge').textContent === 'Live', null, {timeout:20000});

// --- the arithmetic that turned nothing into an Emergency ---
ok(await page.evaluate(() => bandFor(NaN)) === null, 'an unmeasurable share is no band at all');
ok(await page.evaluate(() => bandFor(Infinity)) === null, 'and neither is an infinite one');
ok(await page.evaluate(() => bandFor(0)) === null, 'nor zero');
ok(await page.evaluate(() => bandFor(1.4)) === null, 'nor more than the whole frame');
ok(await page.evaluate(() => bandFor(0.2).imp) === 4, 'a real share still bands normally');
ok(await page.evaluate(() => proposal({ share: NaN, count: 7 })) === null,
   'and no score is proposed from one');

// --- the exact shapes the phone produced ---
const real = await page.evaluate(() => ({
  // confidence 5323169.5, no bbox — entry 1, the inside of the van
  vanEntry: usableFind({ class: 'pothole', confidence: 5323169.5 }, 1920, 1080),
  // confidence 1.004, no bbox — entries 2 to 5
  overOne: usableFind({ class: 'pothole', confidence: 1.0039973258972168 }, 1920, 1080),
  // a sound find
  good: usableFind({ class: 'pothole', confidence: 0.82,
                     bbox: { x: 300, y: 300, width: 400, height: 300 } }, 640, 640),
  // sound box, nonsense confidence: usable, but says nothing about sureness
  noConf: usableFind({ class: 'pothole', confidence: 5323169.5,
                       bbox: { x: 300, y: 300, width: 400, height: 300 } }, 640, 640),
  zeroFrame: usableFind({ class: 'pothole', confidence: 0.8,
                          bbox: { x: 1, y: 1, width: 10, height: 10 } }, 0, 0),
}));
ok(real.vanEntry === null, 'the van-interior find is refused outright');
ok(real.overOne === null, 'so are the four that scored 1.004');
ok(real.good && Math.abs(real.good.share - 0.293) < 0.002, 'a sound find measures correctly');
ok(real.noConf && real.noConf.conf === null && real.noConf.share > 0,
   'a sound box with a nonsense confidence is kept, but claims no sureness');
ok(real.zeroFrame === null, 'a frame with no size cannot produce a share');

// --- and end to end: the survey refuses to log it ---
await settled(page);
await page.evaluate(() => {
  window.engine = { infer: () => Promise.resolve(window.__hits) };
  window.worker = 1;
  window.loadModel = () => Promise.resolve({ CVImage: function (b) { return b; } });
  // twenty boxless results with scores over one, exactly as the phone returned
  window.__hits = Array.from({ length: 20 }, () => ({ class: 'pothole', confidence: 1.0039973258972168 }));
});
await page.waitForFunction(() => document.getElementById('vid').videoWidth > 0);
await rec(page);
await page.waitForFunction(() => /unusable/i.test(document.getElementById('hudState').textContent),
  null, { timeout: 15000 });
ok(true, 'the survey says the output is unusable');
await new Promise(r => setTimeout(r, 4000));
ok(await page.textContent('#hudCount') === '0 logged', 'and writes down nothing at all');

// --- a sound find still logs ---
await page.evaluate(() => { window.__hits = [{ class: 'pothole', confidence: 0.82,
  bbox: { x: 300, y: 300, width: 400, height: 300 } }]; });
await page.waitForFunction(() => document.getElementById('hudCount').textContent === '1 logged',
  null, { timeout: 15000 });
ok(true, 'a sound find is still logged');
ok(!/Emergency/.test(await page.textContent('#hudToast')),
   'and is not an Emergency: ' + (await page.textContent('#hudToast')));
await page.evaluate(() => { window.__hits = []; });
await page.click('#bRec');
await openLog(page);
const line = await page.textContent('.item .det');
// Not a fixed percentage. Share is the fraction of the photograph and the crop
// covers about 18% of it, so the number a given stub produces moves whenever
// preprocessing does — and the property under test is that a share is measured
// and written down at all.
ok(/\d+% of frame/.test(line), 'the log records the measured share: ' +
   (line.match(/model[^\n]*/) || [''])[0]);
ok(/82% sure/.test(line), 'and the confidence, this time a real one');

await browser.close();
console.log(fails.length ? '\n' + fails.length + ' FAILED' : '\nall passed');
process.exit(fails.length ? 1 : 0);
