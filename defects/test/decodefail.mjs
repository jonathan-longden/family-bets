// "The source image could not be decoded", and which end of the pipeline it
// actually came from.
//
// That sentence is Chromium's own, and it is thrown by exactly one thing:
// createImageBitmap given a Blob whose bytes it cannot read. This app calls
// createImageBitmap on a Blob in exactly one place — the "Test a photo" handler.
// The camera path never does: it draws the video onto a canvas and converts the
// canvas, and a canvas that will not convert produces different words ("The
// image source's width is 0", "The image source is not usable"). Probed in the
// real browser rather than assumed; see probe-decode.mjs and probe-blob.mjs.
//
// So the message was a photograph the browser could not read, reported as
// "The model failed while running" — which is how an afternoon went to the
// camera path, which was fine.
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
  window.__inferCalls = 0;
  window.engine = { infer: (w, img) => {
    window.__inferCalls++;
    window.__lastImg = { kind: img && img.bitmapImage &&
                           img.bitmapImage.constructor && img.bitmapImage.constructor.name,
                         w: img && img.bitmapImage && img.bitmapImage.width,
                         h: img && img.bitmapImage && img.bitmapImage.height };
    return Promise.resolve(window.__reply.slice());
  } };
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

// ============ only the Blob path can produce those words. Proved, not assumed.
{
  const words = await page.evaluate(async () => {
    const grab = async (fn) => { try { await fn(); return 'no error'; }
                                 catch (e) { return e.message; } };
    const v = document.getElementById('vid');
    return {
      badBlob: await grab(() => createImageBitmap(
        new Blob([new Uint8Array([110, 111])], { type: 'image/png' }))),
      zeroCanvas: await grab(() => {
        const c = document.createElement('canvas'); c.width = 0; c.height = 640;
        c.getContext('2d'); return createImageBitmap(c);
      }),
      emptyVideo: await grab(() => createImageBitmap(document.createElement('video'))),
      liveCanvas: await grab(async () => {
        const c = document.createElement('canvas'); c.width = c.height = 640;
        c.getContext('2d').drawImage(v, 0, 0, v.videoWidth, v.videoHeight, 0, 0, 640, 640);
        await createImageBitmap(c);
      })
    };
  });
  ok(/could not be decoded/.test(words.badBlob),
     'an undecodable Blob is the thing that says it: ' + words.badBlob);
  ok(!/could not be decoded/.test(words.zeroCanvas),
     'a zero-width canvas says something else: ' + words.zeroCanvas);
  ok(!/could not be decoded/.test(words.emptyVideo),
     'a video with no frame says something else: ' + words.emptyVideo);
  ok(words.liveCanvas === 'no error',
     'and the camera path — video to canvas to ImageBitmap — simply works');
}

// ================= the app calls createImageBitmap on a Blob in one place only
{
  const src = await (await fetch(B + 'app.js')).text();
  const calls = src.match(/createImageBitmap\([^)]*/g) || [];
  const onFile = calls.filter(c => /\bfile\b/.test(c));
  // Derived, not hard-coded. There are three photo entry points now — the
  // real-frame test, the benchmark and the miss analysis — each with a retry
  // without the orientation option, and this assertion had to be edited every
  // time one was added, which made it a test of the count rather than of the
  // property. The property is that every Blob decode belongs to a picker:
  // nothing on the camera or survey path decodes a Blob, so nothing there can
  // raise those words.
  const pickers = src.match(/\$\('(tFile|benchFile|missFile)'\)\.addEventListener/g) || [];
  ok(pickers.length >= 2,
     'the photo pickers are found: ' + JSON.stringify(pickers));
  ok(onFile.length === pickers.length * 2,
     'and every Blob-decoding call is one of them plus its retry — ' +
     pickers.length + ' pickers, ' + onFile.length + ' calls: ' +
     JSON.stringify(onFile));
  const look = src.slice(src.indexOf('function look()'), src.indexOf('function logFind'));
  ok(/createImageBitmap\(sq\.canvas\)/.test(look) && !/createImageBitmap\(file/.test(look),
     'the survey converts a canvas, never a file, so it cannot raise those words');
}

// ========================= an undecodable photo blames the file, not the model
{
  await page.evaluate(() => { window.__inferCalls = 0; });
  await page.setInputFiles('#tFile',
    { name: 'IMG_2317.HEIC', mimeType: 'image/heic', buffer: Buffer.from('not an image') });
  await page.waitForFunction(
    () => /Could not run it/.test(document.getElementById('tState').textContent),
    null, { timeout: 20000 });
  const said = await page.textContent('#tState');

  ok(!/The model failed while running/.test(said),
     'it no longer says the model failed — the model was never asked: ' + said);
  ok(/never reached the model/.test(said),
     'it says the picture never got there');
  ok(/IMG_2317\.HEIC/.test(said), 'and names the file');
  ok(/HEIC\/HEIF/.test(said) && /iPhone/.test(said) && /JPEG/i.test(said),
     'and, for the format an iPhone saves by default, says what to do about it');
  ok(/says nothing about the model/.test(said),
     'and refuses to let the reader draw a conclusion about the model from it');
  ok(await page.evaluate(() => window.__inferCalls) === 0, 'the model was never called');

  const diag = await page.evaluate(() => diagLines());
  ok(/THE PICTURE NEVER REACHED THE MODEL/.test(diag),
     'and the copied diagnostics say so where the reason belongs');
  ok(/IMG_2317\.HEIC/.test(diag), 'naming the file there too');
}

// ============ a non-HEIC undecodable file gets the plain reason, not HEIC advice
{
  await page.setInputFiles('#tFile',
    { name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('not a png') });
  await page.waitForFunction(
    () => /Could not run it/.test(document.getElementById('tState').textContent),
    null, { timeout: 20000 });
  const said = await page.textContent('#tState');
  ok(/broken\.png/.test(said) && /not in a format this browser can read/.test(said),
     'a broken file of another kind gets the plain reason: ' + said);
  ok(!/iPhone/.test(said), 'without HEIC advice that does not apply to it');
}

// ================================ the camera path still works, and reports itself
{
  await page.evaluate(() => {
    window.__reply = [
      { class: 'pothole', confidence: 0.7236,
        bbox: { x: 320, y: 360, width: 180, height: 150 } },
      window.__diagFor()
    ];
    window.__inferCalls = 0;
  });
  await page.click('#bTestCam');
  await page.waitForFunction(
    () => /Done|Could not run it/.test(document.getElementById('tState').textContent),
    null, { timeout: 25000 });
  ok(/Done/.test(await page.textContent('#tState')),
     'the camera test runs: ' + await page.textContent('#tState'));
  ok(await page.evaluate(() => window.__inferCalls) === 1, 'through one inference');

  const t = await page.textContent('#frameText');
  ok(/SOURCE {2}\(checked before the model was asked anything\)/.test(t),
     'the report has a source block');
  ok(/given as {3}HTMLVideoElement/.test(t),
     'naming the object the camera path hands over: ' + (t.match(/given as.*/) || [])[0]);
  ok(/readyState 4 — enough to play through/.test(t),
     'with the readyState in words as well as in numbers: ' +
     (t.match(/readyState.*/) || [])[0]);
  ok(/video {6}\d+×\d+, playing/.test(t),
     'and whether it is actually playing: ' + (t.match(/video {6}.*/) || [])[0]);
  ok(/drawn onto 640×640 canvas/.test(t), 'the canvas it was drawn onto');
  ok(/handed to model as ImageBitmap 640×640/.test(t),
     'and what the model was finally handed: ' +
     (t.match(/handed to model.*/) || [])[0]);
  ok(/frame {6}brightness \d+ to \d+ — there is a picture here/.test(t),
     'and that something actually landed on it: ' + (t.match(/frame {6}.*/) || [])[0]);

  // the model really did get an ImageBitmap, not a video element or a canvas
  const got = await page.evaluate(() => window.__lastImg);
  ok(got.kind === 'ImageBitmap' && got.w === 640 && got.h === 640,
     'and the object reaching the library is an ImageBitmap: ' + JSON.stringify(got));
}

// ============ a camera element with no frame refuses before drawing anything
{
  await page.evaluate(() => {
    window.__inferCalls = 0;
    // a video element that reports a size but has no frame — what a stalled
    // camera looks like, and the case a dimension check alone would miss
    window.__fake = { readyState: 1, videoWidth: 1920, videoHeight: 1080,
                      paused: false, ended: false };
    Object.setPrototypeOf(window.__fake, HTMLVideoElement.prototype);
    window.__err = null;
    return testFrame(window.__fake, 1920, 1080, 'camera', 'camera', 0)
      .catch((e) => { window.__err = { msg: e.message, source: !!e.source }; });
  });
  const err = await page.evaluate(() => window.__err);
  ok(err && err.source === true, 'a stalled camera is refused as a source fault, not a model one');
  ok(/readyState 1/.test(err.msg) && /metadata only/.test(err.msg),
     'saying which readyState, in words: ' + err.msg);
  ok(await page.evaluate(() => window.__inferCalls) === 0,
     'and the model is never asked about a frame that does not exist');
}

// ==================== the survey's own path is untouched by any of this
{
  const src = await (await fetch(B + 'app.js')).text();
  const look = src.slice(src.indexOf('function look()'), src.indexOf('function logFind'));
  ok(!/sourceFacts|sourceProblem|SourceError|canvasContent/.test(look),
     'the survey loop has none of this checking bolted onto it');
  ok(/squareFrame\(shot, shot\.width, shot\.height\)/.test(look) &&
     /createImageBitmap\(sq\.canvas\)/.test(look),
     'and still builds its frame the same way — one square, from the captured ' +
     'photograph, handed over as a bitmap');
  const tf = src.slice(src.indexOf('function testFrame'), src.indexOf('function rotatedFrame'));
  ok(/squareFrame\(source, w, h\)/.test(tf) &&
     /engine\.infer\(worker, \{ bitmapImage: input \}\)/.test(tf),
     'and the diagnostic still uses that same preprocessing and the same engine call');
  ok(!/nonMaxSuppression|sigmoid/i.test(tf), 'with no second pipeline in the diagnostic');
}

console.log(fails.length ? '\n' + fails.length + ' FAILED' : '\nall passed');
await browser.close();
process.exit(fails.length ? 1 : 0);
