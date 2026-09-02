// "raw.forEach is not a function", and why it was the wrong error.
//
// engine.infer is documented as resolving with a list of detections. It does
// not always: the library catches a worker rejection and RETURNS the error
// payload as a fulfilled value, so a worker that died mid-inference arrives
// looking exactly like a successful answer. The first thing the app did to it
// was a list operation, so the real fault — whatever the worker actually said —
// was discarded and replaced by a type error three frames downstream.
//
// This suite drives every runtime shape that can arrive there: a string, an
// Error, a plain object, a Tensor-like, a typed array, null, and the normal
// list. What it checks is not that the app survives, but that it says what
// actually came back.
import { chromium } from 'playwright';
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
  geolocation: { latitude: 53, longitude: -1.1, accuracy: 8 },
  viewport: { width: 844, height: 390 } });
const page = await ctx.newPage();
page.on('dialog', d => d.accept());
await page.goto(B, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.getElementById('badge').textContent === 'Live',
  null, { timeout: 15000 });
await settled(page);

await page.evaluate(() => {
  window.__reply = [];
  window.engine = { infer: () => Promise.resolve(window.__reply) };
  window.worker = 1;
  window.loadModel = () => Promise.resolve({});
  window.__diagFor = () => ({
    __diag: true, outputs: 1, rawShape: [1, 6, 8400], afterTranspose: [1, 8400, 6],
    readAs: { boxes: 8400, classes: 2 }, firstEight: [1, 2, 3, 4, 5, 6, 7, 8],
    imageDims: [640, 640], layoutUsed: 'native', layoutNative: 'NCHW', layoutProbe: null,
    precision: { tried: [{ how: 'cpu', backend: 'cpu', min: 0, max: 636, ok: true }],
      using: 'cpu', ok: true },
    frameRange: { min: 0, max: 636.4215 },
    best: { score: 0.7236, cls: 'pothole', anchor: 4211,
            box: { x: 320, y: 360, width: 180, height: 150 } },
    ms: 412, msExecute: 380, msDecode: 32, inits: 1, infers: 1, backendNow: 'cpu',
    perClass: [{ cls: 'manhole', score: 0.0047, anchor: 7 },
               { cls: 'pothole', score: 0.7236, anchor: 4211 }],
    thresholds: { score: 0.5, iou: 0.5, maxBoxes: 20 }, classNames: ['manhole', 'pothole']
  });
});
await page.waitForFunction(() => document.getElementById('vid').videoWidth > 0);

const openDiag = async () => {
  if (await page.isVisible('#p-diag')) return;
  if (await page.isVisible('#menu')) await page.click('#bMenu');
  await page.click('#bMenu'); await page.click('#mDiag');
  await page.waitForSelector('#p-diag:not([hidden])');
};
await openDiag();

// Press the camera button and wait for it to settle either way.
const press = async () => {
  await page.evaluate(() => { document.getElementById('tState').textContent = '…'; });
  await page.click('#bTestCam');
  await page.waitForFunction(
    () => /Done|Could not run it/.test(document.getElementById('tState').textContent),
    null, { timeout: 25000 });
  return page.textContent('#tState');
};

// ===================================================== the type inspector
{
  const seen = await page.evaluate(() => ({
    list: runtimeType([1, 2, 3]),
    empty: runtimeType([]),
    str: runtimeType('worker died'),
    err: runtimeType(new Error('boom')),
    obj: runtimeType({ status: 500, res: 'nope' }),
    f32: runtimeType(new Float32Array(8400)),
    u8: runtimeType(new Uint8Array(4)),
    tensor: runtimeType({ shape: [1, 6, 8400], dataSync: () => new Float32Array(1) }),
    nul: runtimeType(null),
    undef: runtimeType(undefined),
    num: runtimeType(7)
  }));
  ok(seen.list === 'Array(3)', 'an array is named an array, with its length: ' + seen.list);
  ok(seen.empty === 'Array(0)', 'including an empty one: ' + seen.empty);
  ok(seen.str === 'string(11 chars)', 'a string is named a string: ' + seen.str);
  ok(seen.err === 'Error', 'an Error is named an Error: ' + seen.err);
  ok(/^Object\{status, res\}$/.test(seen.obj),
     'a plain object is named with its keys, which is what identifies it: ' + seen.obj);
  ok(seen.f32 === 'Float32Array(8400)', 'a typed array keeps its kind and length: ' + seen.f32);
  ok(seen.u8 === 'Uint8Array(4)', 'and so does a different one: ' + seen.u8);
  ok(seen.tensor === 'Tensor(1×6×8400)',
     'a tfjs Tensor is recognised by what it can do, and reports its shape: ' + seen.tensor);
  ok(seen.nul === 'null' && seen.undef === 'undefined' && seen.num === 'number',
     'and the empty cases are not dressed up as objects');
}

// ============================== the exact object that produced the bug report
// The library resolves — does not reject — with the worker's error payload.
{
  await page.evaluate(() => { window.__reply = 'Error: inference failed in worker 0'; });
  const said = await press();
  ok(/Could not run it/.test(said), 'a string reply is reported as a failure, not a result');
  ok(!/is not a function/.test(said),
     'and NOT as a missing array method — that was the bug: ' + said);
  ok(/string\(35 chars\)/.test(said),
     'it names what actually came back: ' + said);
  ok(/inference failed in worker 0/.test(said),
     'and carries the worker\'s own words, which the type error had thrown away');

  const diag = await page.evaluate(() => diagLines());
  ok(/raw type   string\(35 chars\)/.test(diag),
     'the copied diagnostics record the type too: ' +
     (diag.match(/raw type.*/) || [])[0]);
}

// =============================================== an Error object, same route
{
  await page.evaluate(() => { window.__reply = new Error('WebGL context lost'); });
  const said = await press();
  ok(/Could not run it/.test(said) && !/is not a function/.test(said),
     'an Error reply is reported as itself');
  ok(/Error/.test(said) && /WebGL context lost/.test(said),
     'with its message intact: ' + said);
}

// ================================================ a plain object, same route
{
  await page.evaluate(() => { window.__reply = { status: 500, res: 'model init failed' }; });
  const said = await press();
  ok(/Object\{status, res\}/.test(said), 'an object reply names its keys: ' + said);
  ok(/model init failed/.test(said), 'and its payload is quoted');
}

// ==================================== a Tensor, which is the shape people fear
{
  await page.evaluate(() => {
    window.__reply = { shape: [1, 6, 8400], dataSync: () => new Float32Array(6) };
  });
  const said = await press();
  ok(/Tensor\(1×6×8400\)/.test(said),
     'a raw Tensor is named as a Tensor with its shape, not "not a function": ' + said);
}

// ============================================ a typed array, likewise named
{
  await page.evaluate(() => { window.__reply = new Float32Array(50400); });
  const said = await press();
  ok(/Float32Array\(50400\)/.test(said),
     'a Float32Array is named with its length: ' + said);
  ok(!/is not a function/.test(said), 'and still not as a missing method');
}

// ======================== null is a legitimate nil answer, not a failure
{
  await page.evaluate(() => { window.__reply = null; });
  const said = await press();
  ok(/Done/.test(said), 'null is treated as "nothing found", because it is: ' + said);
  const t = await page.textContent('#frameText');
  ok(/DETECTIONS {3}zero came back/.test(t),
     'and reported as zero in words rather than a bare 0: ' +
     (t.match(/DETECTIONS.*/) || [])[0]);
  ok(/best class {6}none — nothing was returned/.test(t),
     'with the best-detection fields saying none rather than being absent');
}

// ================================= and the normal case still works end to end
{
  await page.evaluate(() => {
    window.__reply = [
      { class: 'pothole', confidence: 0.7236,
        bbox: { x: 320, y: 360, width: 180, height: 150 } },
      window.__diagFor()
    ];
  });
  const said = await press();
  ok(/Done/.test(said), 'a proper list of detections runs to completion: ' + said);
  const t = await page.textContent('#frameText');
  // Array(2), not Array(1): the patched worker appends a diagnostic element that
  // the app strips. Reporting the stripped count here would be reporting
  // something engine.infer never returned, so it reports both.
  ok(/raw type {5}Array\(2\) — what engine\.infer returned \(1 detection plus the diagnostic block the patched worker appends\)/.test(t),
     'the type is reported on success too, and the extra element accounted for: ' +
     (t.match(/raw type.*/) || [])[0]);
  ok(/DETECTIONS {3}1 came back/.test(t), 'one detection came back');
  ok(/best class {6}pothole/.test(t), 'the best class is named: ' +
     (t.match(/best class.*/) || [])[0]);
  ok(/best confidence 0\.7236/.test(t),
     'with the confidence that was measured on the real photograph: ' +
     (t.match(/best confidence.*/) || [])[0]);
  ok(/best box {8}x 320 y 360 w 180 h 150/.test(t),
     'and the box: ' + (t.match(/best box.*/) || [])[0]);
  ok(/raw shape {4}1×6×8400/.test(t) && /raw min {6}0/.test(t) && /raw max {6}636\.4215/.test(t),
     'shape, min and max each on their own line');
  ok(/WOULD LOG {4}1 pothole/.test(t), 'and the survey filters still ran over it');
}

// ==================== the diagnostic uses the survey's decoder, not a copy
{
  const src = await (await fetch(B + 'app.js')).text();
  const tf = src.slice(src.indexOf('function testFrame'), src.indexOf('function rotatedFrame'));
  // The engine is the app's own tfjs session now, not the SDK's — the SDK
  // could not host WASM. The seam is unchanged: one engine.infer(worker, image).
  ok(/engine\.infer\(worker, \{ bitmapImage: input \}\)/.test(tf),
     'the diagnostic infers through the same engine call the survey uses');
  ok(/squareFrame\(source, w, h\)/.test(tf),
     'and preprocesses with the same squareFrame');
  ok(/takeDiag\(out\.preds\)/.test(tf), 'and unwraps the reply with the same takeDiag');
  // Comments stripped first. The point is that no decoding HAPPENS here, and a
  // word-grep over the prose fails the moment a comment mentions decoding —
  // which it did, and the code was fine.
  const code = tf.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ok(!/decode|nonMaxSuppression|sigmoid/i.test(code),
     'there is no second decoder in the diagnostic path: ' +
     ((code.match(/.*(decode|nonMaxSuppression|sigmoid).*/i) || [])[0] || 'nothing found'));
  const ft = src.slice(src.indexOf('function filterTrace'), src.indexOf('function cssRotation'));
  ok(/usableFind\(p, RF_SIZE, RF_SIZE\)/.test(ft) && /SURVEY_CONF/.test(ft),
     'and the filters are the survey\'s own, at the survey\'s own threshold');
}

console.log(fails.length ? '\n' + fails.length + ' FAILED' : '\nall passed');
await browser.close();
process.exit(fails.length ? 1 : 0);
