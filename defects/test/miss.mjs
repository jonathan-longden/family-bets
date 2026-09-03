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
  await page.evaluate(() => { window.missResult = null; window.missRuns = []; paintFrameTest(); });
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
  ok(/CANDIDATES BEFORE APPLICATION THRESHOLDS/.test(t),
     'the report shows candidates before any application filter');
  ok(/highest pothole confidence:\s+0\.5351/.test(t),
     'and the pothole the model actually produced: ' +
     (t.match(/highest pothole confidence:[^\n]*/) || ['not found'])[0]);
  ok(/highest manhole confidence:\s+0\.02/.test(t),
     'and the other class alongside it, not instead of it');
  // One candidate, not two: the manhole channel is at 0.02, below the 0.05
  // diagnostic floor, so it is background noise rather than a candidate. The
  // "highest manhole confidence" line above still reports it — the floor
  // decides what gets listed, not what gets measured.
  ok(/number of candidate boxes:\s+1\b/.test(t),
     'with a candidate count: ' + (t.match(/number of candidate boxes:[^\n]*/) || [''])[0]);
  ok(/number of candidate boxes:[^\n]*0 manhole, 1 pothole/.test(t),
     'broken down by class, with the sub-floor manhole excluded');
  ok(/B\. THE MODEL SAW IT AT 0\.5351 AND THE BAR IS 0\.65/.test(t),
     'the verdict names case B — seen, and under the bar');
  ok(/A threshold decision, not a model failure/.test(t),
     'and says so in as many words');
  ok(/FINAL SURVEY RESULTS[\s\S]*?detections:\s+0/.test(t),
     'while still reporting that nothing would be logged: ' +
     (t.match(/detections:[^\n]*/) || [''])[0]);
  ok(/outcome:\s+UNDER THE SURVEY BAR/.test(t),
     'and which stage dropped it: ' + (t.match(/outcome:[^\n]*/) || [''])[0]);

  // The table that answers "what would it cost to accept this?"
  ok(/HOW MANY CANDIDATES CLEAR EACH BAR/.test(t), 'the threshold table is present');
  const bar = (v) => (t.match(new RegExp('^ +' + v + '[^\\n]*', 'm')) || [''])[0];
  ok(/0\.50\s+0\s+1/.test(bar('0\\.50').replace(/ +/g, ' ').trim().replace(/^/, '0.50 ').replace('0.50 0.50', '0.50')) ||
     /1/.test(bar('0\\.50')),
     'showing this candidate would be caught at 0.50: ' + bar('0\\.50'));
  ok(/0\.65 \*/.test(t), 'and the survey bar is marked in it');
}

// ================= 2. the model produced nothing — a different answer entirely
{
  const t = await runOn([]);
  ok(/none — the model produced no pothole candidate at all on this frame/.test(t),
     'an empty frame is reported as no candidate rather than as a low one');
  ok(/A\. THE MODEL NEVER PRODUCED A POTHOLE CANDIDATE/.test(t),
     'and the verdict names case A');
  ok(/Moving the threshold cannot reach this/.test(t),
     'and rules out the threshold as the remedy');

  // "The model produced nothing" is three separate faults, and only one of
  // them is answered by retraining. The report has to say so, or the reader
  // draws the expensive conclusion by default.
  ok(/E\. PREPROCESSING/.test(t),
     'case A names preprocessing as one of the ways to end up here');
  ok(/F\. SIZE/.test(t), 'and the size of the defect in the tensor as another');
  // The stride is a tensor measurement; what a reader needs is how tall that
  // is in the photograph they took, which depends on the y scale. This fixture
  // is 96 px and scaled UP, so the answer is small — the arithmetic is what is
  // being checked, not a particular number.
  const px = (t.match(/object under 8 px in the tensor — under (\d+) px tall/) || [])[1];
  const ys = parseFloat((t.match(/scale y:\s+×([\d.]+)/) || [0, '0'])[1]);
  ok(px !== undefined && ys > 0 && Number(px) === Math.round(8 / ys),
     'with the stride translated back into this photograph through its own ' +
     'y scale (×' + ys + '): under ' + px + ' px tall in the source');
  ok(/Only that last one is answered by retraining/.test(t),
     'and says plainly which of the three retraining would fix');
}

// =========== 3. over the bar, and something later in the chain dropped it
{
  const t = await runOn([{ anchor: 4211, x: 311, y: 387, w: 56, h: 49,
                           manhole: 0.02, pothole: 0.91 }]);
  ok(/NOT A MISS\. This frame would have been logged: pothole at 0\.91/.test(t),
     'a confident detection is reported as one that would be logged');
  ok(/outcome:\s+WOULD BE LOGGED/.test(t),
     'and the NMS section agrees: ' + (t.match(/outcome:[^\n]*/) || [''])[0]);
  ok(/FINAL SURVEY RESULTS[\s\S]*?detections:\s+1/.test(t), 'and the count agrees');
  ok(/FINAL SURVEY RESULTS[\s\S]*?box:\s+x 311, y 387, w 56, h 49/.test(t),
     'with the box that would be filed: ' +
     (t.match(/box:[^\n]*/) || [''])[0]);
}

// ===================== 4. the stretch is reported, because it distorts shape
{
  const t = await page.textContent('#frameText');
  ok(/IMAGE[\s\S]*?width:\s+\d+[\s\S]*?height:\s+\d+/.test(t),
     'the image block reports its own dimensions: ' +
     (t.match(/IMAGE\n[^\n]*\n[^\n]*/) || [''])[0].replace(/\n/g, ' | '));
  ok(/method:\s+STRETCH, not crop or letterbox/.test(t),
     'the report says the frame is stretched rather than cropped');
  ok(/preprocessing time:\s+\d+ ms/.test(t),
     'preprocessing is timed on its own, apart from inference: ' +
     (t.match(/preprocessing time:[^\n]*/) || [''])[0]);
  ok(/tensor handed over:\s+1 × 3 × 640 × 640/.test(t),
     'and the tensor the model was actually given is named: ' +
     (t.match(/tensor handed over:[^\n]*/) || [''])[0]);
  const sx = parseFloat((t.match(/scale x:\s+×([\d.]+)/) || [0, '0'])[1]);
  const sy = parseFloat((t.match(/scale y:\s+×([\d.]+)/) || [0, '0'])[1]);
  ok(sx > 0 && sy > 0, 'with both scale factors: x×' + sx + ' y×' + sy);
  const dist = (t.match(/shape distortion:[^\n]*/) || [''])[0];
  const skewed = Math.abs(sy / sx - 1) > 0.005;
  ok(skewed ? /(taller|wider) than/.test(dist) : /none — the axes scale equally/.test(dist),
     skewed
       ? 'and says what the unequal axes do to a round pothole: ' + dist
       : 'and does not claim a distortion this square fixture does not have: ' + dist);
}

// ============ 5. every candidate and every box, which is the point of it
{
  const t = await runOn([
    { anchor: 100, x: 100, y: 100, w: 30, h: 24, manhole: 0.01, pothole: 0.42 },
    { anchor: 200, x: 400, y: 300, w: 18, h: 14, manhole: 0.01, pothole: 0.31 },
    { anchor: 300, x: 500, y: 420, w: 60, h: 50, manhole: 0.77, pothole: 0.08 }
  ]);
  ok(/EVERY POTHOLE CANDIDATE ABOVE 0\.05/.test(t), 'every candidate is listed, not just the best');
  // Each candidate carries class, confidence, x, y, width and height as its
  // own labelled value rather than a compressed one-liner.
  ok(/confidence:\s+0\.42\n\s+x:\s+100\n\s+y:\s+100\n\s+width:\s+30\n\s+height:\s+24/.test(t),
     'each with class, confidence, x, y, width and height set out separately');
  ok(/confidence:\s+0\.31\n\s+x:\s+400/.test(t),
     'including ones well under any threshold');
  ok(/share of frame:\s+[\d.]+%/.test(t),
     'and how much of the frame it fills, which is what scores it');
  ok(/EVERY MANHOLE CANDIDATE ABOVE 0\.05/.test(t) && /confidence:\s+0\.77/.test(t),
     'the other class gets the same treatment');
  ok(/RAW MODEL[\s\S]*?output shape:\s+1 × 6 × 8400/.test(t) &&
     /raw min:\s+[\d.-]+/.test(t) && /raw max:\s+[\d.-]+/.test(t),
     'with the raw range and the output shape: ' +
     (t.match(/output shape:[^\n]*/) || [''])[0]);
  ok(/score threshold:\s+0\.5/.test(t) && /IoU threshold:\s+0\.5/.test(t) &&
     /maximum boxes:\s+20/.test(t),
     'and the NMS parameters actually used');
  ok(/anchors in:\s+8400/.test(t), 'anchors in');
  ok(/boxes out:\s+\d+/.test(t), 'and boxes out');
  ok(/SURVEY THRESHOLD[\s\S]*?current threshold:\s+0\.65/.test(t),
     'the survey threshold is stated: ' +
     (t.match(/current threshold:[^\n]*/) || [''])[0]);
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
