// The survey's own inference path, on the real TensorFlow.js.
//
// Every other suite runs infOnce against a stub `tf`, which is right for
// testing the CHOICE between backends and useless for testing whether the calls
// it makes are calls the library actually accepts. A stub says yes to anything.
// The phone said "No backend" — the runtime loaded, the weights loaded, and both
// WASM and CPU refused — which is exactly the shape of an API misuse that a stub
// cannot see.
//
// So: real tfjs, real WASM and CPU backends, a real tensor of the model's shape
// standing in for the graph, and the app's own infOnce over it. No Roboflow
// needed — the weights are not what is under test.
import { chromium } from 'playwright';
import { CHROME } from './browser.mjs';
const B = 'http://127.0.0.1:8777/defects/';
const fails = [];
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails.push(m); };

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
const ctx = await browser.newContext({
  permissions: ['camera', 'geolocation'],
  geolocation: { latitude: 53, longitude: -1.1, accuracy: 8 },
  viewport: { width: 844, height: 390 },
  serviceWorkers: 'block' });
const page = await ctx.newPage();
page.on('pageerror', e => console.log('  pageerror: ' + e.message.slice(0, 300)));
// The weights are not reachable here and are not what is under test.
await ctx.route('https://api.roboflow.com/**', r => r.abort());
await page.goto(B, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!(window.tf && window.tf.setBackend && window.benchTf),
  null, { timeout: 90000 });

// Wait for the app's OWN startup attempt to finish before touching the backend.
//
// tf.setBackend is global. The page starts the model on load, and with the
// weights unreachable here it works down the list — setBackend('wasm'), fail,
// setBackend('cpu'), fail — ending on cpu. Setting the backend from underneath
// that leaves tensors on one backend being read by another's kernels, which
// surfaces as "Cannot read properties of undefined (reading 'get')" from inside
// a CPU kernel. It passed alone and failed in the runner, which is what a race
// against a slower machine looks like rather than anything about the app.
await page.waitForFunction(() => {
  const b = document.querySelector('#gModel b');
  return !!b && /^(Ready|No |Nonsense|Layout|Precision)/.test(b.textContent.trim());
}, null, { timeout: 90000 });
ok(true, 'the real TensorFlow.js loaded: ' + await page.evaluate(() => tf.version_core) +
   ', and the page has finished its own startup attempt (' +
   await page.evaluate(() => document.querySelector('#gModel b').textContent.trim()) + ')');

// One pass of the production path on one backend, reported rather than thrown.
const run = (name) => page.evaluate(async (backend) => {
  try {
    const okB = await tf.setBackend(backend);
    if (!okB) return { backend, stage: 'setBackend', error: 'no such backend' };
    await tf.ready();
    // Stands in for the graph: the exact shape the YOLOv8 head returns, with
    // plausible magnitudes — pixel boxes in the first four channels, scores in
    // the last two.
    //
    // Built from a typed array rather than with tf ops on purpose. Composing it
    // with randomUniform/concat would test which ops THIS backend implements,
    // which is not what is under test and made WASM fail on the stand-in while
    // the app's own path was fine. Uploading data works on every backend.
    const N = 8400, C = 6;
    const buf = new Float32Array(N * C);
    for (let a = 0; a < N; a++) {
      buf[a] = 300; buf[N + a] = 337; buf[2 * N + a] = 40; buf[3 * N + a] = 30;
      buf[4 * N + a] = 0.0047; buf[5 * N + a] = 0.01;
    }
    buf[5 * N + 4211] = 0.7236;          // the one real detection
    const model = { execute: () => tf.tensor(buf, [1, C, N], 'float32') };
    const before = tf.memory().numTensors;
    const r = await infOnce(tf, model, infProbeCanvas());
    const after = tf.memory().numTensors;
    return { backend, ok: true, sane: r.sane, min: r.min, max: r.max,
             rawShape: r.rawShape, preds: r.preds.length,
             best: r.best && { cls: r.best.cls, score: r.best.score },
             backendAfter: tf.getBackend(), leaked: after - before };
  } catch (e) {
    return { backend, ok: false, error: String((e && e.message) || e).slice(0, 300),
             stack: String((e && e.stack) || '').split('\n').slice(0, 3).join(' | ') };
  }
}, name);

for (const name of ['wasm', 'cpu']) {
  const r = await run(name);
  console.log('  ' + name + ': ' + JSON.stringify(r));
  ok(r.ok, name + ' runs the survey inference path on real tfjs');
  if (r.ok) {
    ok(r.rawShape && r.rawShape.join('x') === '1x6x8400',
       name + ' sees the head shape it expects: ' + (r.rawShape || []).join('x'));
    ok(r.sane === true, name + ' passes the sanity check on plausible output');
    ok(r.preds === 1, name + ' decodes the one real detection: ' + r.preds);
    ok(r.best && r.best.cls === 'pothole' && Math.abs(r.best.score - 0.7236) < 1e-4,
       name + ' finds it and scores it the same as the benchmark did: ' +
       JSON.stringify(r.best));
    ok(r.backendAfter === name,
       name + ' is still the backend afterwards — the NMS detour puts it back: ' +
       r.backendAfter);
    ok(r.leaked === 0, name + ' gives every tensor back: ' + r.leaked + ' left over');
  }
}

// ===================================== and it must not be written back in
//
// What broke this was invisible in review: x.expandDims(0) is ordinary-looking
// TensorFlow.js and is only defined by the UNION package, @tensorflow/tfjs.
// What is vendored is @tensorflow/tfjs-core plus backends, which registers none
// of them — so a chained call is undefined at runtime and fine at a glance. It
// worked only for as long as the Roboflow SDK's bundled copy was on the page
// registering them onto the shared prototype.
//
// Only names that are unambiguously tfjs ops are listed: .concat, .slice, .add
// and .map are Array and Set methods this file uses everywhere, and .dataSync,
// .arraySync and .dispose are real Tensor members rather than chained ops.
{
  const src = await (await fetch(B + 'app.js')).text();
  // Comments out, then the legitimate top-level receivers flattened so that
  // tf.expandDims(x, 0) does not read as a chained .expandDims( — after this,
  // any remaining ".op(" has a tensor on its left, which is the bug.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
                  .replace(/\btf\s*\.\s*(image|browser|linalg|signal|math)\s*\./g, 'TF_')
                  .replace(/\btf\s*\./g, 'TF_');
  const banned = ['expandDims', 'asType', 'toFloat', 'toInt', 'toBool', 'argMax',
                  'argMin', 'softmax', 'sigmoid', 'squeeze', 'clipByValue',
                  'batchNorm', 'logSoftmax', 'resizeNearestNeighbor'];
  const found = banned.filter(n => new RegExp('\\.\\s*' + n + '\\s*\\(').test(code));
  ok(found.length === 0,
     'no chained tensor ops in app.js — tfjs-core registers none of them: ' +
     (found.length ? found.join(', ') : 'none'));
  // Against the unflattened source: `code` has had the tf. receivers rewritten.
  const plain = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ok(/tf\.expandDims\(/.test(plain) && /tf\.cast\(/.test(plain),
     'preprocessing uses the top-level calls instead');
}

await ctx.close();
console.log(fails.length ? '\n' + fails.length + ' FAILED' : '\nall passed');
await browser.close();
process.exit(fails.length ? 1 : 0);
