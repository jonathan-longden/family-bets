// The real-frame test: point it at something and find out what the model made
// of it. This drives the button with a stubbed engine standing in for the
// worker, checking that the diagnostic reports every field the report needs and
// — the part that matters — that it says the right thing in the three cases
// that used to look identical: a hit, a miss, and a hit thrown away by a filter.
import { chromium } from 'playwright';
import { FIXTURES } from './browser.mjs';
import { join } from 'path';
import { CHROME } from './browser.mjs';
import { settled } from './shellhelp.mjs';
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
await page.goto(B, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.getElementById('badge').textContent === 'Live',
  null, { timeout: 15000 });
await settled(page);

// A stub shaped exactly like the patched worker's reply: detections, then the
// __diag element the app strips off.
await page.evaluate(() => {
  window.__reply = [];
  window.__inferCalls = 0;
  window.engine = { infer: (w, img) => { window.__inferCalls++;
    window.__lastImg = { w: img && img.bitmapImage && img.bitmapImage.width,
                         h: img && img.bitmapImage && img.bitmapImage.height };
    return Promise.resolve(window.__reply.slice()); } };
  window.worker = 1;
  window.loadModel = () => Promise.resolve({});
  window.__diagFor = (over) => Object.assign({
    __diag: true, outputs: 1, rawShape: [1, 6, 8400], afterTranspose: [1, 8400, 6],
    readAs: { boxes: 8400, classes: 2 }, firstEight: [13.78, 18.28, 24.19, 30.3, 34.67, 40.58, 47.67, 57.59],
    imageDims: [640, 640], layoutUsed: 'native', layoutNative: 'NCHW',
    layoutProbe: null,
    precision: { tried: [
      { how: 'as loaded', backend: 'webgl', min: -1834411, max: 2634395904, ok: false },
      { how: 'cpu', backend: 'cpu', min: 0, max: 636.4215, ok: true }],
      using: 'cpu', ok: true },
    frameRange: { min: 0, max: 636.4215 },
    best: { score: 0.83, cls: 'pothole', anchor: 4211,
            box: { x: 320, y: 360, width: 180, height: 150 } },
    ms: 412, msExecute: 380, msDecode: 32, inits: 1, infers: 3, backendNow: 'cpu',
    perClass: [{ cls: 'manhole', score: 0.1204, anchor: 7 },
               { cls: 'pothole', score: 0.83, anchor: 4211 }],
    thresholds: { score: 0.5, iou: 0.5, maxBoxes: 20 },
    classNames: ['manhole', 'pothole']
  }, over || {});
});

const openDiag = async () => {
  if (await page.isVisible('#p-diag')) return;
  if (await page.isVisible('#menu')) await page.click('#bMenu');
  await page.click('#bMenu'); await page.click('#mDiag');
  await page.waitForSelector('#p-diag:not([hidden])');
};
await openDiag();

// --- a test that has not run still says why it could not have ---
{
  const diag0 = await page.evaluate(() => diagLines());
  ok(/REAL FRAME/.test(diag0) && /not run/.test(diag0), 'the copied text says the test has not run');
  ok(/last said {2}Not run yet/.test(diag0),
     'and carries what the screen last said, so a failed press is not silent: ' +
     (diag0.match(/last said.*/) || [])[0]);
  // "live" has to be earned from readyState, not inferred from videoWidth — a
  // video element that has stopped still reports its last frame's size
  ok(/camera {5}live, \d+×\d+ \(readyState [234]\)/.test(diag0),
     'with the camera state, and the readyState that justifies calling it live: ' +
     (diag0.match(/camera {5}.*/) || [])[0]);
  ok(/model {6}worker ready/.test(diag0),
     'and the model state: ' + (diag0.match(/model {6}.*/) || [])[0]);
}

// --- the screen is there and says what it is before anything is run ---
ok(await page.isVisible('.ftest'), 'the diagnostics screen leads with a real-frame test');
ok(/Not run yet/.test(await page.textContent('#tState')), 'which says it has not been run');
ok(!(await page.isVisible('#frameText')), 'and shows no stale result');
ok(/same preprocessing|same model|same decoder/i.test(await page.textContent('.ftest .hint')),
   'and says it is the survey’s own pipeline, not a separate one');
ok(await page.isVisible('#tVid'), 'with a live preview so the phone can be aimed');
ok(await page.evaluate(() => !!document.getElementById('tVid').srcObject),
   'bound to the camera that is already open, not a second one');

// ============================================================ a clear hit
await page.evaluate(() => {
  window.__reply = [
    { class: 'pothole', confidence: 0.83, bbox: { x: 320, y: 360, width: 180, height: 150 } },
    window.__diagFor()
  ];
});
await page.click('#bTestCam');
await page.waitForFunction(() => /Done/.test(document.getElementById('tState').textContent),
  null, { timeout: 20000 });
let t = await page.textContent('#frameText');

ok(/REAL FRAME {2}\(camera\)/.test(t), 'the result names where the frame came from');
ok(/backend {6}cpu/.test(t), 'reports the backend: ' + (t.match(/backend.*/) || [])[0]);
ok(/forced/.test(t), 'and that it had to be forced there');
ok(/execute {7}380 ms/.test(t), 'reports the graph time on its own: ' + (t.match(/execute.*/) || [])[0]);
ok(/read\+decode {3}32 ms/.test(t), 'kept apart from readback and decode');
ok(/preprocess {4}\d+ ms/.test(t), 'and preprocessing timed separately');
ok(/encode {8}\d+ ms/.test(t), 'and encoding the thumbnail, which is not inference at all');
ok(/whole test {4}\d+ ms/.test(t), 'with the wall-clock total');
ok(/model loads {2}1 initialise for 3 inferences/.test(t) && /loaded once and reused/.test(t),
   'and says whether the model is being rebuilt each time: ' + (t.match(/model loads.*/) || [])[0]);
ok(/raw shape {4}1×6×8400/.test(t) && /raw min {6}0/.test(t) &&
   /raw max {6}636\.4215/.test(t),
   'reports the raw output shape and range, one question per line: ' +
   (t.match(/raw shape.*/) || [])[0]);
// the type of the thing engine.infer handed back, asked of it rather than assumed
ok(/raw type {5}Array\(2\) — what engine\.infer returned/.test(t),
   'and what it actually was at runtime: ' + (t.match(/raw type.*/) || [])[0]);
ok(/sane\? +yes/.test(t), 'and judges it sane rather than leaving that to the reader');
ok(/BEST ANCHOR/.test(t) && /pothole {2}0\.83/.test(t), 'reports the best anchor in the frame');
ok(/box x 320 y 360 w 180 h 150/.test(t), 'with its box: ' + (t.match(/pothole {2}0\.83.*/) || [])[0]);
ok(/by class {3}manhole 0\.1204 {4}pothole 0\.83/.test(t),
   'reports what it thought of every class, not just the winner: ' +
   (t.match(/by class.*/) || [])[0]);
ok(/DETECTIONS {3}1 came back/.test(t), 'reports how many detections came back');
ok(/#1 {2}pothole {2}0\.83/.test(t), 'and lists them');
// The verdict, not a particular verdict. Since build 56 the survey crops the
// road band, and on the live fake camera that band is a moving pattern — so the
// shadow test genuinely keeps this detection on some runs and rejects it as
// grained-like-the-road on others. Pinning the assertion to KEPT made the suite
// flaky (65, 63, 65 over three runs) without saying anything true about the app.
//
// What must hold is that every detection is traced to an outcome, and that the
// count at the bottom agrees with the trace above it.
const kept = /KEPT — the survey would log this/.test(t);
ok(kept || /dropped — .*shadow, not a hole|dropped — a band far longer/.test(t),
   'and traces them through the survey filters, to an outcome either way: ' +
   ((t.match(/#1 .*/) || [])[0] || 'no trace line'));
ok(new RegExp('WOULD LOG {4}' + (kept ? 1 : 0) + ' pothole').test(t),
   'and says what the survey would have done, agreeing with that trace: ' +
   (t.match(/WOULD LOG.*/) || [])[0]);
ok(await page.isVisible('#tShot'), 'and shows the frame that was actually analysed');
ok(await page.evaluate(() => (document.getElementById('tShot').src || '').startsWith('blob:')),
   'as a blob that is never written to the database');
ok(await page.evaluate(() => S.items.length) === 0,
   'and the test logs nothing — the defect log is untouched');
ok(await page.evaluate(() => window.__lastImg.w) === 640 &&
   await page.evaluate(() => window.__lastImg.h) === 640,
   'the model was handed a 640 square, exactly as the survey hands it one');

// ================================ a real miss, and it can be told from a hit
await page.evaluate(() => {
  window.__reply = [window.__diagFor({ best: { score: 0.02, cls: 'manhole', anchor: 12,
    box: { x: 10, y: 10, width: 4, height: 4 } } })];
});
await page.click('#bTestCam');
await page.waitForFunction(() => /Done/.test(document.getElementById('tState').textContent),
  null, { timeout: 20000 });
t = await page.textContent('#frameText');
ok(/DETECTIONS {3}zero came back/.test(t),
   'a miss reports nothing came back, in words: ' + (t.match(/DETECTIONS.*/) || [])[0]);
ok(/best class {6}none — nothing was returned/.test(t),
   'with the best-detection fields present and saying none');
ok(/manhole {2}0\.02/.test(t), 'but still reports what the model scored highest anywhere');
ok(/NEVER REACHED THE APP/.test(t),
   'and says the library dropped it, not the app: ' + (t.match(/library keeps.*/) || [])[0]);
ok(/WOULD LOG {4}0 potholes/.test(t), 'and that nothing would be logged');

// ==================== a hit the shadow filter throws away — the third case
await page.evaluate(() => {
  // a band far longer than it is wide: the geometric shadow test rejects it
  window.__reply = [
    { class: 'pothole', confidence: 0.91, bbox: { x: 320, y: 300, width: 500, height: 40 } },
    window.__diagFor({ best: { score: 0.91, cls: 'pothole', anchor: 900,
      box: { x: 320, y: 300, width: 500, height: 40 } } })
  ];
});
await page.click('#bTestCam');
await page.waitForFunction(() => /Done/.test(document.getElementById('tState').textContent),
  null, { timeout: 20000 });
t = await page.textContent('#frameText');
ok(/DETECTIONS {3}1 came back/.test(t), 'a rejected hit still shows as a detection');
ok(/dropped — a band far longer than it is wide/.test(t),
   'with the filter that threw it away named: ' + (t.match(/#1.*/) || [])[0]);
ok(/WOULD LOG {4}0 potholes/.test(t),
   'so "the model found it and a filter binned it" is distinguishable from "it found nothing"');

// ------- and the sub-threshold case, which the survey drops rather than the library
await page.evaluate(() => {
  window.__reply = [
    { class: 'pothole', confidence: 0.55, bbox: { x: 320, y: 360, width: 180, height: 150 } },
    window.__diagFor({ best: { score: 0.55, cls: 'pothole', anchor: 7,
      box: { x: 320, y: 360, width: 180, height: 150 } } })
  ];
});
await page.click('#bTestCam');
await page.waitForFunction(() => /Done/.test(document.getElementById('tState').textContent),
  null, { timeout: 20000 });
t = await page.textContent('#frameText');
ok(/dropped — under the survey threshold of 0\.65/.test(t),
   'a detection the library passed but the survey would not says exactly that');
ok(!/NEVER REACHED THE APP/.test(t), 'and does not blame the library for it');

// ==================================================== testing a photo file
// A real 96x96 PNG on disk: grey tarmac with a dark ellipse in it. Written by
// hand the first time and rejected by the decoder, which is exactly what the
// app is supposed to do with a file it cannot read.
// A road-shaped fixture, not a 96px square. Since build 56 the survey crops
// the road band out of the frame, and a tiny flat fixture crops down to a
// single shade — which the app correctly reports as ALL ONE SHADE and the
// shadow test correctly refuses. The fixture was the problem, not the app.
const fixture = join(FIXTURES, 'road-640.png');
await page.evaluate(() => {
  window.__reply = [
    { class: 'pothole', confidence: 0.72, bbox: { x: 100, y: 200, width: 90, height: 80 } },
    window.__diagFor({ best: { score: 0.72, cls: 'pothole', anchor: 55,
      box: { x: 100, y: 200, width: 90, height: 80 } } })
  ];
  window.__inferCalls = 0;
});
await page.setInputFiles('#tFile', fixture);
await page.waitForFunction(() => /Done/.test(document.getElementById('tState').textContent),
  null, { timeout: 20000 });
t = await page.textContent('#frameText');
// headed PHOTO TEST rather than REAL FRAME: identical code from squareFrame
// onwards, but a different test to whoever is reading the result
ok(/PHOTO TEST {2}\(photo · road-640\.png\)/.test(t),
   'a photo from the phone can be tested, and is named: ' + t.split('\n')[0]);
ok(/image {8}\d+×\d+ as supplied/.test(t),
   'and the report gives the image dimensions it was handed: ' +
   (t.match(/image {8}.*/) || [])[0]);
ok(await page.evaluate(() => window.__inferCalls) === 1, 'through one inference call');
ok(await page.evaluate(() => window.__lastImg.w) === 640,
   'squared to 640 by the same preprocessing the camera path uses');
ok(/pothole {2}0\.72/.test(t) && /WOULD LOG {4}1 pothole/.test(t),
   'and reported the same way');
ok(await page.evaluate(() => S.items.length) === 0, 'still nothing written to the log');

// --- a file the browser cannot decode is reported, not swallowed ---
await page.evaluate(() => { window.__inferCalls = 0; });
await page.setInputFiles('#tFile',
  { name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('not a png') });
await page.waitForFunction(() => /Could not run it/.test(document.getElementById('tState').textContent),
  null, { timeout: 20000 });
ok(/could not be decoded/i.test(await page.textContent('#tState')),
   'a file the browser cannot read says so: ' + await page.textContent('#tState'));
ok(await page.evaluate(() => window.__inferCalls) === 0, 'and never reaches the model');
ok(!(await page.isDisabled('#bTestCam')), 'and leaves the screen usable');

// put the good result back for the clipboard check
await page.evaluate(() => {
  window.__reply = [
    { class: 'pothole', confidence: 0.72, bbox: { x: 100, y: 200, width: 90, height: 80 } },
    window.__diagFor({ best: { score: 0.72, cls: 'pothole', anchor: 55,
      box: { x: 100, y: 200, width: 90, height: 80 } } })
  ];
});
await page.setInputFiles('#tFile', fixture);
await page.waitForFunction(() => /Done/.test(document.getElementById('tState').textContent),
  null, { timeout: 20000 });

// ============================================ it all reaches the clipboard
const diag = await page.evaluate(() => diagLines());
ok(/PHOTO TEST/.test(diag),
   'the copied diagnostics carry the result — headed PHOTO TEST, because the last ' +
   'thing run here was a photograph');
ok(/road-640\.png/.test(diag), 'including which frame it was');
ok(/BEST ANCHOR/.test(diag) && /backend/.test(diag),
   'with the best anchor and the backend, so one paste is the whole answer');
ok(/LAST TENSOR/.test(diag), 'and the last-tensor line is still there');
ok(!/nothing yet/.test((diag.match(/LAST TENSOR[\s\S]{0,200}/) || [''])[0]),
   'and is no longer "nothing yet" — the test filled it in');

// ================================================== failure modes are safe
await page.evaluate(() => { window.worker = null; window.engine = null;
  window.loadModel = () => Promise.reject(new Error('no signal')); });
await page.click('#bTestCam');
await page.waitForFunction(() => !/Running|Loading/.test(document.getElementById('tState').textContent),
  null, { timeout: 20000 });
ok(/Could not run it/.test(await page.textContent('#tState')),
   'with no model it says so rather than throwing: ' + await page.textContent('#tState'));
ok(!(await page.isDisabled('#bTestCam')), 'and the button is usable again');
{
  // clear the last good result so the not-run branch is what renders
  await page.evaluate(() => { frameTest = null; });
  const d = await page.evaluate(() => diagLines());
  ok(/last said {2}Could not run it/.test(d),
     'and the failure reaches the clipboard, which it did not before: ' +
     (d.match(/last said.*/) || [])[0]);
  ok(/model {6}not loaded/.test(d), 'along with the precondition that failed');
}

// leaving the screen releases the preview
await page.click('#xDiag');
ok(await page.evaluate(() => !document.getElementById('tVid').srcObject),
   'leaving diagnostics releases the preview rather than decoding video behind a sheet');

// --- the survey screen is untouched by any of this ---
ok(await page.isVisible('#bRec'), 'the record button is where it was');
// The camera zoom control is two buttons inside .pills, and it belongs on the
// driving screen — it is a camera control, not a diagnostic. So the count that
// guards this excludes it, and a second assertion states the intent directly:
// nothing that opens diagnostics or runs a test may appear on the driving
// screen, whatever the button count says.
ok(await page.evaluate(() =>
     document.querySelectorAll('.live .chrome button:not(#zoomPills button)').length) <= 2,
   'and no test button was added to the driving screen');
ok(await page.evaluate(() => ['bTestCam', 'bTestSpin', 'bTestBench', 'bFootStart',
      'bFootStop', 'bFootFrame', 'tFile', 'benchFile', 'missFile', 'bCopyDiag']
      .every((id) => { const el = document.getElementById(id); return !el || !el.closest('.live'); })),
   'and no diagnostic or test control lives inside the driving screen at all');

console.log(fails.length ? '\n' + fails.length + ' FAILED' : '\nall passed');
await browser.close();
process.exit(fails.length ? 1 : 0);
