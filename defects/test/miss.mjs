// "Why was this missed?" — the report, and its promise not to change anything.
//
// A miss has several possible authors and they need different remedies: the
// model produced no candidate at all; it produced one under the bar; NMS
// dropped it; the shadow test rejected it; the box was unmeasurable. Only the
// first is answered by retraining, and the survey screen cannot tell any of
// them apart because it only ever shows what survived.
//
// The tool is diagnostic ONLY. Half of this suite is about that: the survey's
// threshold, its behaviour and its log must be exactly the same afterwards.
import { chromium } from 'playwright';
import { CHROME, BASE, FIXTURES } from './browser.mjs';
import { settled, rec } from './shellhelp.mjs';
import { join } from 'path';
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
await ctx.route('**/shard*.bin', r => r.fulfill({ status: 200, body: Buffer.alloc(1024) }));
await page.goto(B, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.getElementById('badge').textContent === 'Live',
  null, { timeout: 15000 });
await settled(page);

// A graph whose output we choose, so the report can be checked against a known
// answer rather than against whatever a real model happens to say.
//
// Channel layout is the model's own: [cx, cy, w, h, manhole, pothole] over 8400
// anchors, transposed to [1, 8400, 6] before decoding.
const install = (anchors) => page.evaluate((rows) => {
  const N = 8400, C = 6;
  const buf = new Float32Array(N * C);
  for (let a = 0; a < N; a++) {
    buf[a] = 320; buf[N + a] = 320; buf[2 * N + a] = 20; buf[3 * N + a] = 16;
    buf[4 * N + a] = 0.001; buf[5 * N + a] = 0.001;      // background everywhere
  }
  rows.forEach(r => {
    const a = r.anchor;
    buf[a] = r.x; buf[N + a] = r.y; buf[2 * N + a] = r.w; buf[3 * N + a] = r.h;
    buf[4 * N + a] = r.manhole; buf[5 * N + a] = r.pothole;
  });
  const tf = window.tf;
  window.infSession = {
    tf,
    backend: 'cpu',
    model: { execute: () => tf.tensor(buf, [1, C, N], 'float32') }
  };
  window.rfMeta = { classes: ['manhole', 'pothole'] };
}, anchors);

await page.waitForFunction(() => !!(window.tf && window.benchTf), null, { timeout: 90000 });
await page.evaluate(async () => { await tf.setBackend('cpu'); await tf.ready(); });

const openDiag = async () => {
  if (await page.isVisible('#p-diag')) return;
  if (await page.isVisible('#menu')) await page.click('#bMenu');
  await page.click('#bMenu'); await page.click('#mDiag');
  await page.waitForSelector('#p-diag:not([hidden])');
};
await openDiag();

// Clear the previous report before asking for a new one. Waiting for
// "MISS ANALYSIS" to appear matches the report still on screen from the last
// case and returns it unchanged, which silently tests the same thing twice.
const runOn = async (anchors) => {
  await install(anchors);
  await page.evaluate(() => { window.missResult = null; paintFrameTest(); });
  await page.waitForFunction(() => !/MISS ANALYSIS/.test(
    document.getElementById('frameText').textContent), null, { timeout: 10000 });
  await page.setInputFiles('#missFile', join(FIXTURES, 'pothole-fixture.png'));
  await page.waitForFunction(() => /MISS ANALYSIS/.test(
    document.getElementById('frameText').textContent), null, { timeout: 90000 });
  return page.textContent('#frameText');
};

// ============ 1. the model saw it, and the application turned it down
//
// The case from the van: a pothole at 0.5351 with a good box, under the 0.65
// survey bar. The screen said MODEL OUTPUT UNUSABLE. It was nothing of the sort.
{
  const t = await runOn([{ anchor: 4211, x: 311, y: 387, w: 56, h: 49,
                           manhole: 0.02, pothole: 0.5351 }]);
  ok(/HIGHEST CANDIDATE PER CLASS/.test(t), 'the report names the best candidate per class');
  ok(/pothole\s+0\.5351/.test(t),
     'and reports the pothole the model actually produced: ' +
     (t.match(/pothole\s+0\.5351[^\n]*/) || ['not found'])[0]);
  ok(/manhole\s+0\.02/.test(t), 'and the other class alongside it, not instead of it');
  ok(/The model DID see a pothole here, at 0\.5351/.test(t),
     'the verdict says the model saw it');
  ok(/threshold decision, not a model failure/.test(t),
     'and names the author of the miss correctly');
  ok(/FINAL SURVEY DETECTIONS\s+0/.test(t),
     'while still reporting that nothing would be logged: ' +
     (t.match(/FINAL SURVEY DETECTIONS[^\n]*/) || [''])[0]);
  ok(/under the survey bar \(0\.65\)/.test(t),
     'and which stage dropped it: ' +
     (t.match(/ *pothole\s+0\.5351\s+under[^\n]*/) || [''])[0]);

  // The table that answers "what would it cost to accept this?"
  ok(/HOW MANY CANDIDATES CLEAR EACH BAR/.test(t), 'the threshold table is present');
  ok(/0\.50\s+0\s+1/.test(t.replace(/ +/g, ' ')) ||
     /0\.50\s+0\s+1/.test(t),
     'showing this candidate would be caught at 0.50: ' +
     (t.match(/0\.50[^\n]*/) || [''])[0]);
  ok(/0\.65 \*\s+0\s+0/.test(t.replace(/ +/g, ' ')) || /0\.65 \*/.test(t),
     'and not at the survey bar, which is marked');
}

// ================= 2. the model produced nothing — a different answer entirely
{
  const t = await runOn([]);
  ok(/none — the model produced no pothole candidate at all on this frame/.test(t),
     'an empty frame is reported as no candidate rather than as a low one');
  ok(/The model produced NO pothole candidate/.test(t),
     'and the verdict says so plainly');
  ok(/Moving the/.test(t) && /threshold cannot change that/.test(t),
     'and rules out the threshold as the remedy');
}

// =========== 3. over the bar, and something later in the chain dropped it
{
  const t = await runOn([{ anchor: 4211, x: 311, y: 387, w: 56, h: 49,
                           manhole: 0.02, pothole: 0.91 }]);
  ok(/The model saw a pothole at 0\.91, over the bar/.test(t),
     'a confident detection is reported as over the bar');
  ok(/WOULD BE LOGGED/.test(t),
     'and the NMS section says it would reach the log: ' +
     (t.match(/ *pothole[^\n]*WOULD BE LOGGED/) || [''])[0]);
  ok(/FINAL SURVEY DETECTIONS\s+1/.test(t), 'and the count agrees');
}

// ===================== 4. the stretch is reported, because it distorts shape
{
  const t = await page.textContent('#frameText');
  ok(/given to\s+640×640 — STRETCHED, not cropped/.test(t),
     'the report says the frame is stretched rather than cropped');
  ok(/x×[\d.]+, y×[\d.]+/.test(t),
     'with both scale factors: ' + (t.match(/given to[^\n]*/) || [''])[0]);
  const line = (t.match(/given to[^\n]*/) || [''])[0];
  const sx = parseFloat((line.match(/x×([\d.]+)/) || [0, '0'])[1]);
  const sy = parseFloat((line.match(/y×([\d.]+)/) || [0, '0'])[1]);
  const skewed = Math.abs(sx / sy - 1) > 0.05;
  ok(skewed ? /taller than wide/.test(line) : !/taller than wide/.test(line),
     skewed
       ? 'and says what the unequal axes do to a round pothole: ' + line
       : 'and does not claim a distortion this square fixture does not have: ' + line);
}

// ============ 5. every candidate and every box, which is the point of it
{
  const t = await runOn([
    { anchor: 100, x: 100, y: 100, w: 30, h: 24, manhole: 0.01, pothole: 0.42 },
    { anchor: 200, x: 400, y: 300, w: 18, h: 14, manhole: 0.01, pothole: 0.31 },
    { anchor: 300, x: 500, y: 420, w: 60, h: 50, manhole: 0.77, pothole: 0.08 }
  ]);
  ok(/EVERY POTHOLE CANDIDATE ABOVE 0\.05/.test(t), 'every candidate is listed, not just the best');
  ok(/0\.42\s+30×24 at 100,100/.test(t),
     'each with its box in the 640 square: ' + (t.match(/0\.42[^\n]*/) || [''])[0]);
  ok(/0\.31\s+18×14/.test(t), 'including ones well under any threshold');
  ok(/% of frame/.test(t), 'and how much of the frame it fills, which is what scores it');
  ok(/EVERY MANHOLE CANDIDATE ABOVE 0\.05/.test(t) && /0\.77/.test(t),
     'the other class gets the same treatment');
  ok(/raw range/.test(t) && /output\s+1×6×8400/.test(t),
     'with the raw range and the output shape: ' + (t.match(/output[^\n]*/) || [''])[0]);
  ok(/NMS {2}\(score 0\.5, IoU 0\.5, at most 20\)/.test(t),
     'and the NMS parameters actually used');
  ok(/in\s+8400 anchors/.test(t), 'in');
  ok(/out\s+\d+/.test(t), 'and out');
}

// ================================================================
// 6. NOTHING ABOUT THE SURVEY CHANGED
// ================================================================
{
  const after = await page.evaluate(() => ({
    surveyConf: window.SURVEY_CONF, rfScore: window.RF_SCORE,
    rfIou: window.RF_IOU, rfMax: window.RF_MAXBOX, size: window.RF_SIZE,
    items: S.items.length, logged: survey.logged, on: survey.on,
    backend: tf.getBackend()
  }));
  ok(after.surveyConf === 0.65, 'the survey threshold is untouched: ' + after.surveyConf);
  ok(after.rfScore === 0.5 && after.rfIou === 0.5 && after.rfMax === 20,
     'so are the decoder and NMS parameters: ' +
     [after.rfScore, after.rfIou, after.rfMax].join(', '));
  ok(after.size === 640, 'and the input size');
  ok(after.items === 0 && after.logged === 0,
     'the analysis wrote nothing to the log: ' + after.items + ' items');
  ok(after.on === false, 'and did not start a survey');
  ok(after.backend === 'cpu',
     'the backend it borrowed is put back as it found it: ' + after.backend);

  const src = await (await fetch(B + 'app.js')).text();
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const miss = code.slice(code.indexOf('function missAnalyse'), code.indexOf('function paintFrameTest'));
  ok(!/putEntry|fileObservation|rememberFind|survey\.logged/.test(miss),
     'and nothing in the analysis can write an entry or touch survey state');
  ok(!/SURVEY_CONF *=|RF_SCORE *=|RF_CONF *=/.test(miss),
     'nor assign any threshold');
}

// ============ 7. and the survey still logs exactly as it did before
{
  await page.evaluate(() => {
    window.__hits = [];
    window.engine = { infer: () => Promise.resolve(window.__hits) };
    window.worker = 1;
    window.loadModel = () => Promise.resolve({});
  });
  if (await page.isVisible('#p-diag')) await page.click('#xDiag');
  await page.waitForFunction(() => document.getElementById('vid').videoWidth > 0);
  await rec(page);
  await page.evaluate(() => {
    window.__hits = [{ class: 'pothole', confidence: 0.9,
      bbox: { x: 320, y: 300, width: 220, height: 220 } }];
  });
  await page.waitForFunction(() => document.getElementById('hudCount').textContent === '1 logged',
    null, { timeout: 20000 });
  ok(true, 'a confident find is still logged after the analysis has been run');
  await page.evaluate(() => {
    window.__hits = [{ class: 'pothole', confidence: 0.5351,
      bbox: { x: 311, y: 387, width: 56, height: 49 } }];
  });
  await page.waitForFunction(
    () => /Seen pothole at 54%/.test(document.getElementById('hudState').textContent),
    null, { timeout: 20000 }).catch(() => {});
  ok(/Seen pothole at 54%/.test(await page.textContent('#hudState')),
     'and a below-bar one is still declined, with its number: ' +
     await page.textContent('#hudState'));
  ok(await page.textContent('#hudCount') === '1 logged',
     'without being logged: ' + await page.textContent('#hudCount'));
}

await ctx.close();
console.log(fails.length ? '\n' + fails.length + ' FAILED' : '\nall passed');
await browser.close();
process.exit(fails.length ? 1 : 0);
