// Which way up the model is being shown the road.
//
// The app turns its own chrome when the viewport is portrait — #app rotates
// +90° and the video counter-rotates −90° so the preview looks upright — but
// squareFrame draws the raw <video> element, which no CSS touches. So what the
// operator sees and what the model gets can be a quarter turn apart, with
// nothing on screen to say so. This is that asymmetry, measured, plus the
// four-rotation probe that separates "cannot see this pothole" from "cannot see
// this pothole sideways".
import { chromium } from 'playwright';
import { CHROME } from './browser.mjs';
import { settled } from './shellhelp.mjs';
const B = 'http://127.0.0.1:8777/defects/';
const fails = [];
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails.push(m); };

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });

const stub = () => {
  window.__reply = [];
  window.__rotSeen = [];
  window.engine = { infer: (w, img) => {
    // remember the corner colours, which is how the test knows the frame turned
    const c = document.createElement('canvas');
    c.width = c.height = 640;
    const x = c.getContext('2d');
    x.drawImage(img.bitmapImage, 0, 0);
    const px = (a, b) => Array.from(x.getImageData(a, b, 1, 1).data).slice(0, 3).join(',');
    // Which SIDE the letterbox padding is on. Since build 55 the square is
    // letterboxed, and that turns out to be the sturdiest evidence a rotation
    // happened: at 0° and 180° the bars run across the top and bottom, at 90°
    // and 270° they run down the sides. Canvas corners are padding at every
    // angle and read 0,0,0 four times over; interior pixels of this fake
    // camera are a flat field and read the same four times too. The bars are
    // neither — they move.
    window.__rotSeen.push({ tl: px(320, 20), tr: px(20, 320),
                            br: px(320, 620), bl: px(620, 320) });
    return Promise.resolve(window.__reply.slice());
  } };
  window.worker = 1;
  window.loadModel = () => Promise.resolve({});
  window.__diagFor = (over) => Object.assign({
    __diag: true, outputs: 1, rawShape: [1, 6, 8400], afterTranspose: [1, 8400, 6],
    readAs: { boxes: 8400, classes: 2 }, firstEight: [1, 2, 3, 4, 5, 6, 7, 8],
    imageDims: [640, 640], layoutUsed: 'native', layoutNative: 'NCHW', layoutProbe: null,
    precision: { tried: [{ how: 'cpu', backend: 'cpu', min: 0, max: 636, ok: true }],
      using: 'cpu', ok: true },
    frameRange: { min: 0, max: 636.42 },
    best: { score: 0.33, cls: 'manhole', anchor: 12,
            box: { x: 388, y: 50, width: 261, height: 105 } },
    ms: 21353, msExecute: 21200, msDecode: 153, inits: 1, infers: 1, backendNow: 'cpu',
    thresholds: { score: 0.5, iou: 0.5, maxBoxes: 20 }, classNames: ['manhole', 'pothole']
  }, over || {});
};

const openDiag = async (page) => {
  if (await page.isVisible('#p-diag')) return;
  if (await page.isVisible('#menu')) await page.click('#bMenu');
  await page.click('#bMenu'); await page.click('#mDiag');
  await page.waitForSelector('#p-diag:not([hidden])');
};

// =================================================== portrait: the real case
{
  const ctx = await browser.newContext({
    permissions: ['camera', 'geolocation'],
    geolocation: { latitude: 53, longitude: -1.1, accuracy: 8 },
    viewport: { width: 390, height: 844 } });          // a phone held upright
  const page = await ctx.newPage();
  await page.goto(B, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.getElementById('badge').textContent === 'Live',
    null, { timeout: 15000 });
  await settled(page);
  await page.evaluate(stub);
  await page.waitForFunction(() => document.getElementById('vid').videoWidth > 0);

  const rots = await page.evaluate(() => ({
    app: cssRotation(document.getElementById('app')),
    vid: cssRotation(document.getElementById('vid')),
    portrait: window.matchMedia('(orientation: portrait)').matches
  }));
  ok(rots.portrait === true, 'the viewport is portrait, so the app turns itself');
  ok(rots.app === 90, 'the chrome is rotated +90°: ' + rots.app);
  ok(rots.vid === -90, 'and the preview counter-rotated −90° so it looks upright: ' + rots.vid);

  await page.evaluate(() => {
    window.__reply = [window.__diagFor()];
  });
  await openDiag(page);
  await page.click('#bTestCam');
  await page.waitForFunction(() => /Done/.test(document.getElementById('tState').textContent),
    null, { timeout: 20000 });
  const t = await page.textContent('#frameText');

  ok(/ORIENTATION/.test(t), 'the report has an orientation block');
  ok(/app turned 90°/.test(t) && /video turned -90°/.test(t),
     'reporting both rotations: ' + (t.match(/app turned.*/) || [])[0]);
  /* The video's -90° exists to cancel the app's +90°, so the net turn on screen
     is zero and the preview agrees with the model. An earlier version compared
     the video's own transform against the model's and shouted on every portrait
     test; the rotation probe beside it proved that wrong. */
  ok(/net on screen 0°/.test(t),
     'the two CSS rotations are added rather than one being read alone: ' +
     (t.match(/net on screen.*/) || [])[0]);
  ok(!/WHAT YOU SEE IS TURNED/.test(t),
     'so portrait raises no warning — they agree, and it used to cry wolf here');
  ok(/the preview and the model agree on which way up this is/.test(t),
     'and it says so');
  ok(/camera {5}\d+×\d+ — (landscape|portrait) as the browser hands it over/.test(t),
     'and reports the shape the browser actually delivers: ' + (t.match(/camera {5}.*/) || [])[0]);
  ok(/squashed to {3}640×640 from \d+×\d+ — \w+ squeezed [\d.]+× more/.test(t),
     'and the aspect squash, which is not a rotation and is easy to miss: ' +
     (t.match(/squashed to.*/) || [])[0]);

  // --- the timing breakdown ---
  ok(/execute {7}21200 ms/.test(t), 'the graph time is reported on its own');
  ok(/read\+decode {3}153 ms/.test(t), 'apart from readback and decode');
  ok(/preprocess {4}\d+ ms/.test(t) && /encode {8}\d+ ms/.test(t),
     'with preprocessing and encoding timed separately — neither is inference');
  ok(/model loads {2}1 initialise for 1 inference/.test(t),
     'and how many times the model was loaded: ' + (t.match(/model loads.*/) || [])[0]);
  ok(/loaded once and reused/.test(t), 'so a slow figure cannot be blamed on reloading');

  await ctx.close();
}

// ================================================ landscape: no disagreement
{
  const ctx = await browser.newContext({
    permissions: ['camera', 'geolocation'],
    geolocation: { latitude: 53, longitude: -1.1, accuracy: 8 },
    viewport: { width: 844, height: 390 } });          // on a mount, as intended
  const page = await ctx.newPage();
  await page.goto(B, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.getElementById('badge').textContent === 'Live',
    null, { timeout: 15000 });
  await settled(page);
  await page.evaluate(stub);
  await page.waitForFunction(() => document.getElementById('vid').videoWidth > 0);
  await page.evaluate(() => { window.__reply = [window.__diagFor()]; });
  await openDiag(page);
  await page.click('#bTestCam');
  await page.waitForFunction(() => /Done/.test(document.getElementById('tState').textContent),
    null, { timeout: 20000 });
  const t = await page.textContent('#frameText');
  ok(/app turned 0°/.test(t) && /video turned 0°/.test(t),
     'landscape applies no rotation at all: ' + (t.match(/app turned.*/) || [])[0]);
  ok(/the preview and the model agree on which way up this is/.test(t),
     'and the report says the two agree');
  ok(!/WHAT YOU SEE IS TURNED/.test(t), 'with no warning raised');
  await ctx.close();
}

// ======================================= the four-rotation probe does rotate
{
  const ctx = await browser.newContext({
    permissions: ['camera', 'geolocation'],
    geolocation: { latitude: 53, longitude: -1.1, accuracy: 8 },
    viewport: { width: 844, height: 390 } });
  const page = await ctx.newPage();
  await page.goto(B, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.getElementById('badge').textContent === 'Live',
    null, { timeout: 15000 });
  await settled(page);
  await page.evaluate(stub);
  await page.waitForFunction(() => document.getElementById('vid').videoWidth > 0);

  await openDiag(page);
  ok(await page.isVisible('#bTestSpin'), 'there is a four-rotation button');
  ok(/slow/.test(await page.textContent('.ftest')), 'which warns that it is slow');

  // Armed here, after openDiag: opening the screen runs the flat-grey self-test,
  // which is one inference of its own and would otherwise eat the first score.
  await page.evaluate(() => {
    let n = 0;
    const scores = [0.33, 0.81, 0.10, 0.22];
    const realInfer = window.engine.infer;
    window.__rotSeen = [];
    window.engine = { infer: (w, img) => realInfer(w, img).then(() => {
      const s = scores[n++ % 4];
      return [window.__diagFor({ best: { score: s, cls: 'pothole', anchor: 1,
        box: { x: 300, y: 300, width: 100, height: 100 } } })];
    }) };
  });

  await page.click('#bTestSpin');
  await page.waitForFunction(() => /Done\. Best at/.test(document.getElementById('tState').textContent),
    null, { timeout: 60000 });

  const seen = await page.evaluate(() => window.__rotSeen);
  ok(seen.length === 4, 'it ran the model four times: ' + seen.length);
  // a quarter turn moves the letterbox bars from the top and bottom to the
  // sides; identical readings across all four would mean nothing turned
  const corners = seen.map(s => s.tl + '|' + s.tr);
  ok(new Set(corners).size > 1,
     'and the frame genuinely changed between them — the padding moved: ' +
     JSON.stringify(corners.map(c => c.slice(0, 11))));

  const t = await page.textContent('#frameText');
  ok(/FOUR WAYS UP/.test(t), 'the report carries the four-way table');
  ok(/ {2}0° {5}pothole/.test(t) && / {2}90° {4}pothole/.test(t) &&
     / {2}180° {3}pothole/.test(t) && / {2}270° {3}pothole/.test(t),
     'with a row per rotation');
  ok(/Best at 90°/.test(t), 'and names the best: ' + (t.match(/Best at.*/) || [])[0]);
  ok(/NOT the best of the four/.test(t) && /quarter turn from upright/.test(t),
     'and draws the conclusion rather than leaving it to the reader');

  const diag = await page.evaluate(() => diagLines());
  ok(/FOUR WAYS UP/.test(diag), 'and it reaches the clipboard');

  // and when 0° is best, it says the opposite
  await page.evaluate(() => {
    let n = 0;
    const scores = [0.9, 0.2, 0.1, 0.15];
    window.engine = { infer: () => Promise.resolve(
      [window.__diagFor({ best: { score: scores[n++ % 4], cls: 'pothole', anchor: 1,
        box: { x: 300, y: 300, width: 100, height: 100 } } })]) };
  });
  await page.click('#bTestSpin');
  await page.waitForFunction(() => /Done\. Best at 0°/.test(document.getElementById('tState').textContent),
    null, { timeout: 60000 });
  const t2 = await page.textContent('#frameText');
  ok(/orientation is not what is holding this back/.test(t2),
     'when 0° wins, it rules orientation out rather than in');
  await ctx.close();
}

// ============================== the survey itself is untouched by any of this
{
  const src = await (await fetch(B + 'app.js')).text();
  const look = src.slice(src.indexOf('function look()'), src.indexOf('function logFind'));
  ok(!/rotatedFrame/.test(look),
     'the survey loop does not rotate anything — this release only measures');
  // The square is now cut from the captured photograph rather than from a
  // second read of the <video> — see evidence.mjs. What this suite cares about
  // is unchanged and still asserted: ONE unrotated square, built the same way
  // for every look, with no orientation work anywhere near it.
  ok(/squareFrame\(shot, shot\.width, shot\.height\)/.test(look),
     'and still builds one unrotated square, now cut from the captured frame');
  ok((look.match(/squareFrame\(/g) || []).length === 1,
     'exactly once per look, so there is no second frame to disagree about');
}

console.log(fails.length ? '\n' + fails.length + ' FAILED' : '\nall passed');
await browser.close();
process.exit(fails.length ? 1 : 0);
