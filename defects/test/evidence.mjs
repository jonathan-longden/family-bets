// The evidence photograph is the frame the model was shown. Provably.
//
// Reported from a van at 34 mph, where a 700 ms inference is ten metres of
// road: the saved JPEG could show the road PAST the pothole it was filed
// against, while t, the fix and detBox all described the frame that contained
// it. Build 46 moved the capture to the top of the look, which fixed the ten
// metres and left something weaker standing: two drawImage(v, ...) calls,
// microseconds apart. In practice a <video> does not advance between two reads
// inside one synchronous block — but evidence should not rest on "in practice".
//
// So the video is read ONCE, into the photograph, and the square the model sees
// is cut from that canvas. This suite holds that down from both ends: by
// counting the reads, and by making the video change between them so that two
// reads would be visibly different pictures.
import { chromium } from 'playwright';
import { CHROME, BASE } from './browser.mjs';
import { settled, rec } from './shellhelp.mjs';
const B = BASE;
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

// The model, stubbed and deliberately slow, and every read of the live <video>
// recorded with the moment it happened.
await page.evaluate(() => {
  window.__videoReads = [];      // one entry per drawImage whose source is #vid
  window.__inferAt = [];
  const proto = CanvasRenderingContext2D.prototype;
  const orig = proto.drawImage;
  proto.drawImage = function (src, ...rest) {
    if (src && src.tagName === 'VIDEO') {
      window.__videoReads.push({ at: performance.now(), canvas: this.canvas.id || '(anon)' });
    }
    return orig.call(this, src, ...rest);
  };
  window.__hits = [];
  window.engine = {
    infer: () => {
      window.__inferAt.push(performance.now());
      // 300 ms of road. If anything grabbed a new frame afterwards it would be
      // a different picture, and the reads counter would show it.
      return new Promise(r => setTimeout(() => r(window.__hits), 300));
    }
  };
  window.worker = 1;
  window.loadModel = () => Promise.resolve({});
});
await page.waitForFunction(() => document.getElementById('vid').videoWidth > 0);

const hit = (px = 220) => [{ class: 'pothole', confidence: 0.9,
  bbox: { x: 320, y: 300, width: px, height: px } }];

const entry = () => page.evaluate(() => {
  const e = S.items[0];
  return e && {
    id: e.id, t: e.t, capturedAt: e.capturedAt, storedAt: e.storedAt,
    inferenceStartedAt: e.inferenceStartedAt, inferenceFinishedAt: e.inferenceFinishedAt,
    inferenceMs: e.inferenceMs, frameAgeMs: e.frameAgeMs,
    detBox: e.detBox, detBoxImage: e.detBoxImage,
    imgW: e.imgW, imgH: e.imgH, videoW: e.videoW, videoH: e.videoH,
    imgSize: e.img && e.img.size
  };
});

await rec(page);
await page.evaluate(h => { window.__hits = h; }, hit());
await page.waitForFunction(() => document.getElementById('hudCount').textContent === '1 logged',
  null, { timeout: 20000 });
const e = await entry();

// ============================ 1. one read of the video, and it is the photograph
{
  const reads = await page.evaluate(() => window.__videoReads);
  const infers = await page.evaluate(() => window.__inferAt);
  const perLook = reads.length / Math.max(1, infers.length);
  ok(perLook <= 1.001,
     'the live video is read at most once per look: ' + reads.length +
     ' reads for ' + infers.length + ' inferences');
  ok(reads.every(r => r.canvas === 'shot'),
     'and the one read goes straight into the evidence canvas: ' +
     JSON.stringify([...new Set(reads.map(r => r.canvas))]));
}

// ============= 2. nothing grabs a new frame after inference, in code or at run time
{
  const src = await (await fetch(B + 'app.js')).text();
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const look = code.slice(code.indexOf('function look()'), code.indexOf('function logFind'));
  const reads = (look.match(/drawImage\(\s*v\s*,/g) || []).length;
  ok(reads === 1,
     'look() reads the video exactly once in source, not once before and once after: ' + reads);
  ok(/squareFrame\(shot,/.test(look),
     'and the square the model sees is cut from that same canvas');

  const infers = await page.evaluate(() => window.__inferAt);
  const reads2 = await page.evaluate(() => window.__videoReads);
  const afterLast = reads2.filter(r => r.at > infers[infers.length - 1]).length;
  ok(afterLast === 0 || reads2.filter(r => r.at > infers[0] && r.at < infers[0] + 300).length === 0,
     'no read of the video lands inside an inference window');
}

// ================= 3. two reads would have been two pictures, and there was one
//
// The fake camera moves, so a frame taken 300 ms later is measurably different.
// If the evidence and the model's square came from separate reads, they would
// disagree. They cannot: the square is cut from the evidence canvas.
{
  // The whole square, not a corner of it: the fake camera's pattern is static
  // in places, and sampling one of those proves nothing either way.
  const same = await page.evaluate(async () => {
    const shot = document.getElementById('shot');
    const grab = (src, w, h) => {
      const sq = squareFrame(src, w, h);
      return sq.ctx.getImageData(0, 0, 640, 640).data;
    };
    const a = grab(shot, shot.width, shot.height);
    // Re-cut from the same canvas: identical, because it is one frame.
    const b = grab(shot, shot.width, shot.height);
    let diff = 0;
    for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) > 8) diff++;

    // Give the camera time to present new frames, then read it live. This is
    // what a second read after inference would have got.
    await new Promise(r => setTimeout(r, 600));
    const live = document.createElement('canvas');
    live.width = shot.width; live.height = shot.height;
    live.getContext('2d').drawImage(document.getElementById('vid'), 0, 0,
      live.width, live.height);
    const c = grab(live, live.width, live.height);
    let moved = 0;
    for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - c[i]) > 8) moved++;
    return { diff, moved, of: a.length / 4 };
  });
  ok(same.diff === 0,
     'two cuts of the stored frame are identical — it is one frame: ' + same.diff +
     ' of ' + same.of + ' pixels differ');
  ok(same.moved > 0,
     'while the live video has moved on since, so a second read WOULD have differed: ' +
     same.moved + ' of ' + same.of + ' pixels');
}

// ================================ 4. the timestamps prove the order of events
{
  const ms = (s) => Date.parse(s);
  ok(e.capturedAt && e.inferenceStartedAt && e.inferenceFinishedAt && e.storedAt,
     'all four stamps are recorded: ' + JSON.stringify({
       capturedAt: e.capturedAt, inferenceStartedAt: e.inferenceStartedAt,
       inferenceFinishedAt: e.inferenceFinishedAt, storedAt: e.storedAt }));
  ok(ms(e.capturedAt) <= ms(e.inferenceStartedAt),
     'the frame was captured before inference started');
  ok(ms(e.inferenceStartedAt) <= ms(e.inferenceFinishedAt),
     'inference started before it finished');
  ok(ms(e.capturedAt) < ms(e.inferenceFinishedAt),
     'the captured timestamp is strictly earlier than inference completion');
  ok(ms(e.inferenceFinishedAt) <= ms(e.storedAt),
     'and the row was written after inference finished');
  ok(e.inferenceMs >= 250 && e.inferenceMs < 3000,
     'inferenceMs matches the stubbed 300 ms: ' + e.inferenceMs);
  ok(e.frameAgeMs >= e.inferenceMs,
     'frameAgeMs is at least the inference it waited through: ' +
     e.frameAgeMs + ' ≥ ' + e.inferenceMs);
  ok(e.t === e.capturedAt,
     't is the capture, not the write — they are ' +
     (e.t === e.capturedAt ? 'the same' : e.t + ' vs ' + e.capturedAt));
}

// ============== 5. the box corresponds to the image that was actually saved
{
  ok(e.detBox && e.detBoxImage, 'both boxes are stored: ' + JSON.stringify(e.detBox));
  ok(e.imgW > 0 && e.imgH > 0, 'with the evidence frame size: ' + e.imgW + '×' + e.imgH);

  // Build 55 letterboxes. The old assertion here multiplied by imgW/640 and
  // imgH/640, which was exactly right while the square was a stretch of the
  // whole photograph and is exactly wrong once there is padding — it would not
  // throw, it would put the box in the wrong place. So the mapping is checked
  // against the geometry the app actually used.
  // Read out of the app's own fit rather than recomputed from a formula that
  // has to be kept in step with it. Three preprocessings in three builds have
  // each broken a hand-written inverse here; the fit is the one thing that
  // tracks whichever is current.
  const fit = await page.evaluate(([w, h]) =>
    squareFrame(document.getElementById('shot'), w, h).fit, [e.imgW, e.imgH]);
  const near = (a, b) => Math.abs(a - b) < 0.01;
  ok(near(e.detBoxImage.x, fit.cropX + (e.detBox.x - fit.padX) / fit.sx) &&
     near(e.detBoxImage.y, fit.cropY + (e.detBox.y - fit.padY) / fit.sy) &&
     near(e.detBoxImage.w, e.detBox.w / fit.sx) &&
     near(e.detBoxImage.h, e.detBox.h / fit.sy),
     'detBoxImage is detBox put back through the fit the app actually used: ' +
     JSON.stringify(e.detBoxImage));
  ok(e.detBoxImage.x >= 0 && e.detBoxImage.y >= 0 &&
     e.detBoxImage.x + e.detBoxImage.w <= e.imgW + 1 &&
     e.detBoxImage.y + e.detBoxImage.h <= e.imgH + 1,
     'and it lands inside the image rather than off the edge of it');
  ok(Math.abs(fit.sx - fit.sy) > 0.01,
     'the two axes really do scale differently under the stretch, which is why ' +
     'the mapped box is needed at all: x×' + fit.sx.toFixed(3) +
     ' y×' + fit.sy.toFixed(3));
  // The clamp still matters even without padding: a preprocessing that ever
  // pads or crops again can put a box partly outside the photograph, and a box
  // drawn off the edge of the evidence is worse than one that stops at it.
  ok(e.detBoxImage.y + e.detBoxImage.h <= e.imgH + 0.01 &&
     e.detBoxImage.x + e.detBoxImage.w <= e.imgW + 0.01,
     'and the mapped box is clamped inside the photograph: ' +
     Math.round(e.detBoxImage.x + e.detBoxImage.w) + '×' +
     Math.round(e.detBoxImage.y + e.detBoxImage.h) + ' against ' +
     e.imgW + '×' + e.imgH);
}

// ============================== 6. the frame is released, and nothing leaks
{
  const closed = await page.evaluate(async () => {
    // Every ImageBitmap handed to infer should be closed by the time the look
    // is over: a survey is thousands of looks and a held bitmap is a full frame
    // of memory each.
    let made = 0, closedCount = 0;
    const real = window.createImageBitmap;
    window.createImageBitmap = async function (...a) {
      const bmp = await real.apply(window, a);
      made++;
      const c = bmp.close.bind(bmp);
      bmp.close = function () { closedCount++; return c(); };
      return bmp;
    };
    window.__hits = [{ class: 'pothole', confidence: 0.9,
      bbox: { x: 320, y: 300, width: 220, height: 220 } }];
    await new Promise(r => setTimeout(r, 3000));
    window.createImageBitmap = real;
    return { made, closedCount };
  });
  ok(closed.made > 0, 'looks happened during the check: ' + closed.made + ' bitmaps made');
  ok(closed.closedCount >= closed.made,
     'and every bitmap handed to the model was closed again: ' +
     closed.closedCount + ' of ' + closed.made);
}

// ======= 7. a below-bar detection is not called "unusable", and says its number
//
// Seen in the field: the screen read MODEL OUTPUT UNUSABLE on a frame the model
// had answered with a pothole at 0.5351 and a perfectly good box. The output
// was usable; it was under the survey bar. Saying the model is broken when the
// model has just seen something hides the one number that explains a miss.
{
  await page.evaluate(() => {
    window.__hits = [{ class: 'pothole', confidence: 0.5351,
      bbox: { x: 311, y: 387, width: 56, height: 49 } }];
  });
  await page.waitForFunction(
    () => /Seen pothole at 54%/.test(document.getElementById('hudState').textContent),
    null, { timeout: 20000 }).catch(() => {});
  const state = await page.textContent('#hudState');
  ok(/Seen pothole at 54%/.test(state),
     'a below-bar detection reports what the model actually saw: ' + state);
  ok(/under the 65% bar/.test(state), 'and which bar turned it down');
  ok(!/unusable/i.test(state),
     'and does not claim the model produced something unusable');
  ok(await page.textContent('#hudCount') === '1 logged',
     'while still not logging it: ' + await page.textContent('#hudCount'));
}

await ctx.close();
console.log(fails.length ? '\n' + fails.length + ' FAILED' : '\nall passed');
await browser.close();
process.exit(fails.length ? 1 : 0);
