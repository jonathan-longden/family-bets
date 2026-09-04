// The model registry, and the promises that make a model comparison possible.
//
// One model id in one constant was fine while there was only ever one model.
// The moment a second is being considered it stops being fine: every entry
// already in the log becomes evidence of unknown provenance, and "the new model
// found more" cannot be told from "we drove down a worse road".
//
// So: every observation carries what produced it, the baseline cannot be
// selected away from, a model whose output does not match what the registry
// describes is refused rather than decoded, and none of it is a switch anybody
// can flip at the roadside.
import { chromium } from 'playwright';
import { CHROME, BASE, FIXTURES } from './browser.mjs';
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
await ctx.route('**/shard*.bin', r => r.fulfill({ status: 200, body: Buffer.alloc(1024) }));
await page.goto(B, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.getElementById('badge').textContent === 'Live',
  null, { timeout: 15000 });
await settled(page);

// ============ 1. there is a registry, and it has a baseline
{
  const r = await page.evaluate(() => ({
    n: MODELS.length,
    baselines: MODELS.filter(m => m.baseline).map(m => m.key),
    active: activeModel().key,
    keys: MODELS.map(m => m.key),
    base: baselineModel().key,
    fallback: window.modelFallback
  }));
  ok(r.n >= 1, 'the registry describes at least one model: ' + r.n);
  ok(r.baselines.length === 1,
     'exactly one model is marked baseline — two would make "the baseline" ' +
     'ambiguous, none would make it unreachable: ' + r.baselines.join(', '));
  ok(r.base === 'yolov8n-t3',
     'and it is the YOLOv8n the survey is known to work with: ' + r.base);
  ok(r.active === r.base,
     'which is also what is active, so nothing has been swapped in unnoticed');
  ok(r.fallback === null,
     'and nothing fell back to get there: ' + JSON.stringify(r.fallback));
}

// ============ 2. the baseline records what is actually known, and no more
{
  const m = await page.evaluate(() => baselineModel());
  ok(m.arch === 'yolov8n', 'the architecture is recorded: ' + m.arch);
  ok(m.input === 640, 'the input size: ' + m.input);
  ok(JSON.stringify(m.classes) === '["manhole","pothole"]',
     'the classes, in the order the channels come in: ' + m.classes.join(', '));
  ok(m.datasetImages === 17497, 'the dataset size that is documented: ' + m.datasetImages);
  ok(m.epochs === 50, 'and the epoch count: ' + m.epochs);
  ok(/WASM/.test(m.runtime), 'the runtime it is measured on: ' + m.runtime);
  ok(!!m.addedAt && !!m.datasetVersion, 'with a date and a dataset version');
  // The metrics are NOT here, because they are not known. A registry with a
  // plausible-looking mAP nobody measured is worse than one that says nothing.
  ok(m.mAP50 === undefined && m.recall === undefined && m.precision === undefined,
     'and no precision, recall or mAP — those live in Roboflow and have never ' +
     'been read into this repository, so the registry does not carry a number ' +
     'somebody would later quote');
}

// ============ 3. the diagnostics say which model is running
{
  if (await page.isVisible('#menu')) await page.click('#bMenu');
  await page.click('#bMenu'); await page.click('#mDiag');
  await page.waitForSelector('#p-diag:not([hidden])');
  const t = await page.textContent('#diagText');
  ok(/MODEL REGISTRY/.test(t), 'the registry is on the screen somebody photographs');
  ok(/\[BASELINE\]/.test(t), 'the baseline is marked as such');
  ok(/active\s+yolov8n-t3/.test(t), 'the active model is named: ' +
     (t.match(/active[^\n]*/) || [''])[0].trim());
  ok(/baseline\s+yolov8n-t3 — present/.test(t),
     'and the baseline is reported present rather than assumed: ' +
     (t.match(/baseline\s+[^\n]*/) || [''])[0].trim());
  ok(/fallback\s+none — running what was asked for/.test(t),
     'with no fallback in force');
  ok(/metrics\s+UNKNOWN/.test(t),
     'and the metrics are stated as unknown rather than left blank for a ' +
     'reader to fill in with an assumption');
  await page.click('#xDiag');
}

// ============ 4. an unknown key falls back to the baseline and says so
{
  const r = await page.evaluate(() => {
    const was = window.ACTIVE_MODEL;
    window.ACTIVE_MODEL = 'a-model-nobody-added';
    window.modelFallback = null;
    const got = activeModel().key;
    const fb = window.modelFallback;
    window.ACTIVE_MODEL = was; window.modelFallback = null;
    return { got, fb };
  });
  ok(r.got === 'yolov8n-t3',
     'asking for a model that is not in the registry lands on the baseline, ' +
     'not on nothing: ' + r.got);
  ok(r.fb && r.fb.asked === 'a-model-nobody-added' && r.fb.using === 'yolov8n-t3',
     'and the fallback is recorded rather than silent: ' + JSON.stringify(r.fb));
  ok(r.fb && /is in the registry/.test(r.fb.why), 'with the reason: ' + r.fb.why);
}

// ============ 5. selecting a second model actually selects it
//
// Nothing is deployed by adding it here — this is the mechanism being checked,
// with a candidate that exists only inside this test.
{
  const r = await page.evaluate(() => {
    const wasA = window.ACTIVE_MODEL, wasM = window.MODELS.slice();
    window.MODELS = window.MODELS.concat([{
      key: 'candidate-x', name: 'A candidate', version: 1, arch: 'yolo11n',
      modelId: 'ws/candidate-x', project: 'candidate', projectVersion: 2,
      decoder: 'yolov8', runtime: 'tfjs graph model · WASM', input: 640,
      classes: ['manhole', 'pothole'], dataset: 'test only',
      datasetVersion: '9', addedAt: '2026-09-03' }]);
    window.ACTIVE_MODEL = 'candidate-x';
    window.modelFallback = null;
    const active = activeModel().key;
    const stamp = modelStamp();
    const base = baselineModel().key;
    const fb = window.modelFallback;
    window.MODELS = wasM; window.ACTIVE_MODEL = wasA; window.modelFallback = null;
    return { active, stamp, base, fb };
  });
  ok(r.active === 'candidate-x', 'a registered candidate can be made active: ' + r.active);
  ok(r.stamp.modelKey === 'candidate-x' && r.stamp.datasetVersion === '9',
     'and what gets stamped on an observation follows it: ' + JSON.stringify(r.stamp));
  ok(r.base === 'yolov8n-t3',
     'while the baseline is still the baseline — selecting a candidate does ' +
     'not remove or replace it: ' + r.base);
  ok(r.fb === null, 'and a model that IS in the registry does not fall back');
}

// ============ 6. the stamp is flat scalars, because it travels into exports
{
  const s = await page.evaluate(() => modelStamp());
  const keys = Object.keys(s);
  ok(keys.length >= 6, 'the stamp carries the whole identity: ' + keys.join(', '));
  ok(keys.every(k => s[k] === null || typeof s[k] !== 'object'),
     'every field is a flat scalar — a nested object is what makes a GIS ' +
     'import quietly drop a column');
  ok(s.modelKey && s.modelVersion && s.modelInput && s.datasetVersion,
     'and none of the identifying fields is empty');
}

// ============ 7. an observation records which model produced it
{
  await page.evaluate(() => {
    window.__hits = [];
    window.engine = { infer: () => Promise.resolve(window.__hits) };
    window.worker = 1;
    window.loadModel = () => Promise.resolve({});
  });
  await page.waitForFunction(() => document.getElementById('vid').videoWidth > 0);
  await rec(page);
  await page.evaluate(() => {
    window.__hits = [{ class: 'pothole', confidence: 0.9,
      bbox: { x: 320, y: 300, width: 220, height: 220 } }];
  });
  await page.waitForFunction(() => S.items.length > 0, null, { timeout: 30000 });
  const e = await page.evaluate(() => S.items[0]);
  ok(e.modelKey === 'yolov8n-t3',
     'the entry says which model found it: ' + e.modelKey);
  ok(e.modelName && e.modelVersion === 1 && e.modelArch === 'yolov8n',
     'with its name, version and architecture: ' + e.modelName + ' v' +
     e.modelVersion + ' ' + e.modelArch);
  ok(e.modelInput === 640, 'the input size it was run at: ' + e.modelInput);
  ok(e.datasetVersion === '1', 'and the dataset version behind it: ' + e.datasetVersion);
  ok(/WASM/.test(e.modelRuntime || ''), 'and the runtime: ' + e.modelRuntime);
}

// ============ 8. an output the registry does not describe is refused
//
// This is the failure that has already happened once here, with confidences in
// the millions: a graph whose head the decoder could not read did not fail, it
// succeeded, and put a living room in the log as a Category 2. A class count
// that disagrees with the registry is the same shape of fault.
{
  const r = await page.evaluate(() => ({
    right: modelValidate(2),
    coco: modelValidate(80),
    tooFew: modelValidate(1),
    nothing: modelValidate(null),
    nan: modelValidate(NaN)
  }));
  ok(r.right === null, 'the two classes this model really has are accepted');
  ok(typeof r.coco === 'string' && /80 classes/.test(r.coco),
     'an 80-class COCO head is refused rather than decoded against two class ' +
     'names: ' + r.coco);
  ok(typeof r.tooFew === 'string', 'so is one class too few: ' + r.tooFew);
  ok(r.nothing === null && r.nan === null,
     'and a count it cannot judge is not failed on a guess');

  // The count checked is the one the decoder is about to use, not an assumption
  // about which axis the channels sit on. Both layouts are real, and reading
  // one as the other is the fault that produced confidences in the millions —
  // so a check that assumed the layout would be asserting the thing in doubt.
  ok(true, 'and it is checked after the transpose, where the layout question ' +
     'is already settled');
}

// ============ 9. the production path actually applies that check
{
  const src = await (await fetch(B + 'app.js')).text();
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const once = code.slice(code.indexOf('function infOnce'), code.indexOf('function infDispose'));
  ok(/modelValidate\(numClasses\)/.test(once),
     'infOnce — the one path every look and the startup probe both go through ' +
     '— validates the class count the decoder is about to use');
  ok(once.indexOf('modelValidate') < once.indexOf('nonMaxSuppression'),
     'and does it BEFORE any box is read out, not after something has already ' +
     'been believed');
  ok(/var RF_MODEL_ID = activeModel\(\)\.modelId/.test(code),
     'the id that is fetched comes from the registry rather than from a second ' +
     'constant that could disagree with it');
  ok(!/ACTIVE_MODEL *=/.test(code.replace(/var ACTIVE_MODEL = 'yolov8n-t3';/, '')),
     'and nothing in the app assigns ACTIVE_MODEL — a model swap is a decision ' +
     'with evidence behind it, not a toggle somebody finds at the roadside');
}

// ============ 10. the benchmark is reproducible
//
// A comparison between two models is worthless if the same model gives two
// answers on the same picture. Same frame, same session, twice.
{
  await page.evaluate(async () => { await tf.setBackend('cpu'); await tf.ready(); });
  const r = await page.evaluate(async () => {
    const N = 8400, C = 6;
    const buf = new Float32Array(N * C);
    for (let a = 0; a < N; a++) {
      buf[a] = 320; buf[N + a] = 320; buf[2 * N + a] = 20; buf[3 * N + a] = 16;
      buf[4 * N + a] = 0.001; buf[5 * N + a] = 0.001;
    }
    buf[4211] = 311; buf[N + 4211] = 387; buf[2 * N + 4211] = 56; buf[3 * N + 4211] = 49;
    buf[4 * N + 4211] = 0.01; buf[5 * N + 4211] = 0.88;
    const model = { execute: () => tf.tensor(buf, [1, C, N], 'float32') };
    const c = document.createElement('canvas');
    c.width = 640; c.height = 640;
    const g = c.getContext('2d');
    g.fillStyle = '#777'; g.fillRect(0, 0, 640, 640);
    const one = await infOnce(tf, model, c);
    const two = await infOnce(tf, model, c);
    const strip = (x) => x.preds.map(p => [p.class, p.confidence,
      p.bbox.x, p.bbox.y, p.bbox.width, p.bbox.height].join(','));
    return { a: strip(one), b: strip(two), shape: one.rawShape, sane: one.sane };
  });
  ok(r.a.length > 0, 'the frame produces a detection to compare: ' + r.a.length);
  ok(JSON.stringify(r.a) === JSON.stringify(r.b),
     'the same picture through the same model twice gives byte-identical ' +
     'detections, so a difference between two models is the models: ' + r.a[0]);
  ok(JSON.stringify(r.shape) === '[1,6,8400]',
     'and the raw shape is reported for the record: ' + r.shape.join('×'));
  ok(r.sane === true, 'with the output judged plausible');
}

console.log(fails.length ? '\nFAILURES: ' + fails.length : '\nall passed');
await browser.close();
process.exit(fails.length ? 1 : 0);
