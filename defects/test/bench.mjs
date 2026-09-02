// Benchmarking the backends on one picture.
//
// The survey runs at ~21 s a frame on TensorFlow.js's plain-JavaScript CPU
// backend. This suite drives the harness that asks whether anything else on
// this phone runs the same graph faster — and, more importantly, checks that
// the comparison is fair: one picture drawn once, identical preprocessing,
// identical weights, identical decoder, honest reporting when a backend is
// missing or produces nonsense, and everything given back afterwards.
//
// The real tfjs stack is 2.4 MB and the real model needs Roboflow, so the
// backends and the model loader are stubbed. What is under test is the harness,
// not TensorFlow.
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

// A stand-in for tf: enough surface for the harness, and it records exactly
// which pixels each backend was handed so "the same picture" can be proved.
const fakeTf = (opts) => {
  const o = Object.assign({ backends: ['webgl', 'wasm', 'cpu'], simd: true,
    threads: false, threadCount: 1,
    sane: { webgl: false, wasm: true, cpu: true },
    // the pothole each backend finds — same everywhere unless a test says otherwise
    score: { webgl: 0.7236, wasm: 0.7236, cpu: 0.7236 },
    infer: { webgl: 5, wasm: 120, cpu: 900 } }, opts || {});
  window.__benchSaw = [];
  window.__loads = 0;
  window.__disposed = { models: 0, tensors: 0 };
  window.__live = 0;                       // tensors outstanding, as tf.memory sees it
  let current = null;

  window.__tracked = [];
  const mkTensor = (extra) => {
    window.__live++;
    const t = Object.assign({
      _dead: false,
      shape: [1, 8400, 6],
      dataSync: () => {
        const n = 8400 * 6, d = new Float32Array(n);
        for (let a = 0; a < 8400; a++) {
          d[a * 6] = 300; d[a * 6 + 1] = 337; d[a * 6 + 2] = 40; d[a * 6 + 3] = 30;
          d[a * 6 + 4] = 0.0047; d[a * 6 + 5] = 0.01;
        }
        d[4211 * 6 + 5] = o.score[current];            // the pothole
        if (!o.sane[current]) { d[0] = -1834411; d[1] = 2634395904; }
        return d;
      },
      dispose: function () {
        if (this._dead) return;                 // real tensors ignore a second dispose
        this._dead = true;
        window.__live--; window.__disposed.tensors++;
      }
    }, extra || {});
    window.__tracked.push(t);
    return t;
  };

  window.tf = {
    version_core: '4.22.0-stub',
    env: () => ({ getAsync: (f) => Promise.resolve(
      f === 'WASM_HAS_SIMD_SUPPORT' ? o.simd :
      f === 'WASM_HAS_MULTITHREAD_SUPPORT' ? o.threads : null) }),
    wasm: {
      setWasmPaths: (p) => { window.__wasmPaths = p; },
      // the real one throws before the backend is up, and the harness must not
      // ask it until then
      getThreadsCount: () => {
        if (current !== 'wasm') throw new Error('WASM backend not initialized.');
        return o.threadCount;
      }
    },
    memory: () => ({ numTensors: window.__live }),
    setBackend: (n) => {
      if (o.backends.indexOf(n) === -1) return Promise.resolve(false);
      current = n; return Promise.resolve(true);
    },
    getBackend: () => current,
    ready: () => Promise.resolve(),
    loadGraphModel: (handler) => {
      window.__loads++;
      return handler.load().then((art) => {
        window.__artifacts = { specs: art.weightSpecs.length,
                               bytes: art.weightData.byteLength,
                               topology: !!art.modelTopology };
        return {
          execute: () => {
            // busy-wait so the measured time is real rather than asserted
            const until = performance.now() + o.infer[current];
            while (performance.now() < until) { /* spin */ }
            return mkTensor();
          },
          dispose: () => { window.__disposed.models++; }
        };
      });
    },
    // real tf.tidy disposes everything made inside it except what is returned.
    // A pass-through stub leaves the intermediates alive and makes correct code
    // look like a leak — which it did: benchPreprocess makes one.
    tidy: (fn) => {
      const before = window.__tracked.length;
      const out = fn();
      window.__tracked.slice(before).forEach((t) => { if (t !== out) t.dispose(); });
      return out;
    },
    dispose: (t) => { if (t && t.dispose) t.dispose(); },
    // real tf.transpose returns a NEW tensor, so the caller owns two and must
    // dispose both. A stub returning the same object makes correct disposal
    // look like double-disposal, which is a bug in the stub, not the harness.
    transpose: (t) => mkTensor({ dataSync: t.dataSync }),
    div: (t) => t,
    image: {
      resizeNearestNeighbor: (t) => t,
      nonMaxSuppression: () => ({ dataSync: () => new Int32Array([4211]) })
    },
    tensor2d: () => ({}),
    browser: {
      fromPixels: (canvas) => {
        // record what this backend was actually shown
        const c = document.createElement('canvas');
        c.width = canvas.width; c.height = canvas.height;
        const x = c.getContext('2d');
        x.drawImage(canvas, 0, 0);
        const px = (a, b) => Array.from(x.getImageData(a, b, 1, 1).data).slice(0, 3).join(',');
        window.__benchSaw.push({ backend: current, w: canvas.width, h: canvas.height,
          sig: [px(4, 4), px(320, 320), px(635, 635)].join('|') });
        // the preprocessed input is a tensor too: it is disposed at the end and
        // the harness calls dataSync on it to force the work
        return mkTensor();
      }
    },
    /* Top-level, not chained, because that is what @tensorflow/tfjs-core
       actually provides. This stub used to return { expandDims: () => ({
       asType: () => t }) }, which modelled the UNION package's chained ops —
       methods tfjs-core does not register. The app was written against that
       fiction, it worked only while the Roboflow SDK's bundled copy was on the
       page registering them, and when the SDK was removed every backend failed
       in preprocessing. A stub that says yes to anything cannot catch that;
       realtf.mjs runs the same path on the real library. */
    expandDims: (t) => mkTensor(),
    cast: (t) => t
  };
  // The real loadBenchTf runs — the 2.4 MB of script tags are routed to stubs
  // below, so the ordering, the window.tf check and setWasmPaths are all
  // genuinely exercised rather than replaced.
  window.modelMeta = () => Promise.resolve({ classes: ['manhole', 'pothole'],
    weights: { modelTopology: { node: [] },
      weightsManifest: [{ paths: ['shard1.bin', 'shard2.bin'],
        weights: [{ name: 'a', shape: [1], dtype: 'float32' },
                  { name: 'b', shape: [1], dtype: 'float32' }] }] } });

  // The survey now runs on this same stack, so the page has already tried to
  // load it once on startup — with the real vendor scripts routed to stubs, so
  // that attempt failed and left its wreckage behind. Clear it, so what this
  // suite measures is the button's own load and not startup's.
  loading = null; benchTf = null; benchLoading = null;
  engine = null; worker = null;
  infSession = null; infExcluded = [];
  benchResult = null;
  // ...including which scripts have already RUN. app.js keeps that record so a
  // second attempt never executes a build twice; here it has to be cleared, or
  // the button's load skips the chain entirely and there is nothing to record.
  benchRan = {};
  window.__scripts = [];
};

const openDiag = async (page) => {
  if (await page.isVisible('#p-diag')) return;
  if (await page.isVisible('#menu')) await page.click('#bMenu');
  await page.click('#bMenu'); await page.click('#mDiag');
  await page.waitForSelector('#p-diag:not([hidden])');
};

const fresh = async (opts) => {
  const ctx = await browser.newContext({
    permissions: ['camera', 'geolocation'],
    geolocation: { latitude: 53, longitude: -1.1, accuracy: 8 },
    viewport: { width: 844, height: 390 },
    // No service worker. The vendored scripts here are stubs served by
    // ctx.route, and a worker's own fetches do not go through ctx.route — so
    // once one takes charge it pulls the real 2.4 MB and overwrites the stub
    // mid-test. This suite is about the benchmark, not caching; sw.mjs and
    // vendorcache.mjs are where the worker is the subject.
    serviceWorkers: 'block' });
  const page = await ctx.newPage();
  await ctx.route('**/shard*.bin', r =>
    r.fulfill({ status: 200, body: Buffer.alloc(2048) }));
  await ctx.route('**/vendor/tfjs/*.js', r => r.fulfill({ status: 200,
    contentType: 'application/javascript',
    body: 'window.__scripts=(window.__scripts||[]).concat(' +
          JSON.stringify(r.request().url().split('/').pop()) + ');' }));
  await page.goto(B, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.getElementById('badge').textContent === 'Live',
    null, { timeout: 15000 });
  await settled(page);
  await page.evaluate(fakeTf, opts);
  await page.waitForFunction(() => document.getElementById('vid').videoWidth > 0);
  await openDiag(page);
  return { ctx, page };
};

const run = async (page, timeout = 120000) => {
  await page.click('#bTestBench');
  await page.waitForFunction(
    () => /Done|could not run/.test(document.getElementById('tState').textContent),
    null, { timeout });
  return page.textContent('#frameText');
};

// ================================================ the buttons exist and warn
{
  const { ctx, page } = await fresh();
  ok(await page.isVisible('#bTestBench'), 'there is a camera benchmark button');
  ok(await page.isVisible('#benchFileLabel'),
     'and one for a photograph, which is what the known result came from');
  const hint = await page.textContent('.ftest');
  ok(/2\.4 MB/.test(hint), 'the hint says what it will download');
  ok(/does not change what the survey uses/.test(hint.replace(/\s+/g, ' ')),
     'and that it changes nothing about the survey');
  ok(/photograph you already have a result for/.test(hint.replace(/\s+/g, ' ')),
     'and says to use the picture with a known answer, so faster can be told ' +
     'from differently wrong');

  const t = await run(page);

  // --- the same picture, provably ---
  const saw = await page.evaluate(() => window.__benchSaw);
  ok(saw.length === 3, 'every backend was handed a picture: ' + saw.length);
  ok(saw.every(s => s.w === 640 && s.h === 640),
     'each one 640×640, the size the survey uses');
  ok(new Set(saw.map(s => s.sig)).size === 1,
     'and all three were the identical picture — same pixels, drawn once: ' +
     JSON.stringify([...new Set(saw.map(s => s.sig))].map(x => x.slice(0, 24))));
  ok(saw.map(s => s.backend).join(',') === 'webgl,wasm,cpu',
     'run in the order webgl, wasm, cpu: ' + saw.map(s => s.backend).join(','));

  // --- identical weights, from the metadata the app already had ---
  const art = await page.evaluate(() => window.__artifacts);
  ok(art.topology === true && art.specs === 2 && art.bytes === 4096,
     'each backend loaded the same weights from the same manifest: ' + JSON.stringify(art));
  ok(await page.evaluate(() => window.__loads) === 3,
     'once per backend, because weights live on the backend that loaded them');
  ok(await page.evaluate(() => window.__wasmPaths) === 'vendor/tfjs/',
     'and the wasm binaries are served from this origin, so they work offline');
  ok((await page.evaluate(() => window.__scripts) || []).join(',') ===
     'tf-core.min.js,tf-converter.min.js,tf-backend-cpu.min.js,' +
     'tf-backend-webgl.min.js,tf-backend-wasm.min.js',
     'the runtime was loaded core first, then the backends: ' +
     JSON.stringify(await page.evaluate(() => window.__scripts)));

  // --- the report, field by field as asked for ---
  ok(/BACKEND BENCHMARK {2}\(one picture, drawn once, reused for every backend\)/.test(t),
     'the report says what it did');
  ok(/passes {7}3 per backend — the first cold, the rest warmed/.test(t),
     'and how many passes: ' + (t.match(/passes {7}.*/) || [])[0]);
  for (const f of ['backend', 'supported', 'initialised', 'sanity check', 'preprocess_ms',
                   'execute_ms', 'read_decode_ms', 'total_ms', 'detections', 'best_class',
                   'best_confidence', 'raw_min', 'raw_max']) {
    ok(new RegExp('^ {2}' + f.replace(/[_ ]/g, '[_ ]') + ' +\\S', 'm').test(t),
       'every backend reports ' + f);
  }
  for (const b of ['WEBGL', 'WASM', 'CPU']) ok(new RegExp('^' + b + '$', 'm').test(t),
    'there is a section for ' + b);

  // --- cold and warmed are separated ---
  ok(/execute_ms {7}\d+ {3}\(warmed; first pass \d+\)/.test(t),
     'the warmed figure is reported with the cold one beside it: ' +
     (t.match(/execute_ms.*/) || [])[0]);
  ok(/all passes {7}\d+, \d+, \d+ ms/.test(t),
     'and every individual pass is shown, not just an average: ' +
     (t.match(/all passes.*/) || [])[0]);
  ok(/one-time cost {4}backend init \d+ ms, model load \d+ ms {2}\(excluded/.test(t),
     'with backend init and model load timed and excluded: ' +
     (t.match(/one-time cost.*/) || [])[0]);

  // --- WASM capabilities, asked rather than assumed ---
  ok(/SIMD {7}yes/.test(t), 'SIMD comes from the runtime');
  ok(/threads {4}no/.test(t), 'and so does threading');
  ok(/thread count 1 \(asked of the wasm backend after it initialised\)/.test(t),
     'the thread count is read from the wasm backend once it is up: ' +
     (t.match(/thread count.*/) || [])[0]);
  ok(/cores {6}\d+ \(what the browser says the phone has, which is not what wasm uses\)/.test(t),
     'and is not confused with the core count: ' + (t.match(/cores {6}.*/) || [])[0]);
  ok(/crossOriginIsolated/.test(t) && /GitHub Pages does not send them/.test(t),
     'threads being off is explained as a hosting property, not a phone one');

  // --- the sanity check still governs everything ---
  ok(/sanity check {5}FAIL — this backend cannot be trusted/.test(t),
     'the insane backend fails the sanity check');
  ok(/FASTEST USABLE {2}wasm/.test(t),
     'so the fastest USABLE backend is named, not the fastest overall: ' +
     (t.match(/FASTEST USABLE.*/) || [])[0]);
  ok(!/FASTEST USABLE {2}webgl/.test(t),
     'a backend producing garbage in 5 ms never wins');

  // --- do they agree with CPU? ---
  ok(/DO THEY AGREE\? {2}\(CPU is the reference — it is what produced 0\.7236\)/.test(t),
     'there is a consistency section, and CPU is the reference');
  ok(/wasm {5}pothole 0\.7236, 1 detection — AGREES with CPU/.test(t),
     'wasm agreeing with CPU is stated: ' + (t.match(/ {2}wasm .*/) || [])[0]);
  ok(/webgl {4}output failed the sanity check — not comparable/.test(t),
     'and an insane backend is not compared at all: ' + (t.match(/ {2}webgl .*/) || [])[0]);

  // --- timings are measured, not asserted ---
  const wasm = +(t.match(/^WASM$[\s\S]*?execute_ms {7}(\d+)/m) || [])[1];
  const cpu = +(t.match(/^CPU$[\s\S]*?execute_ms {7}(\d+)/m) || [])[1];
  ok(wasm > 60 && wasm < 400, 'the wasm figure is real, not a constant: ' + wasm + ' ms');
  ok(cpu > wasm, 'and cpu is slower, as the stub was set up to be: ' + cpu + ' ms');

  const diag = await page.evaluate(() => diagLines());
  ok(/BACKEND BENCHMARK/.test(diag), 'and the whole table reaches the clipboard');
  await ctx.close();
}

// ======================================= disposal: nothing is left holding on
{
  const { ctx, page } = await fresh();
  await run(page);
  const d = await page.evaluate(() => window.__disposed);
  ok(d.models === 3, 'every backend disposed its model: ' + d.models);
  ok(d.tensors >= 3 * 4,
     'and its tensors — input plus one per pass, per backend: ' + d.tensors);
  const live = await page.evaluate(() => window.__live);
  ok(live === 0, 'nothing is left outstanding when the run finishes: ' + live);
  const t = await page.textContent('#frameText');
  ok(/tensors left {5}0 after disposal/.test(t),
     'and the report says so rather than leaving it to be trusted: ' +
     (t.match(/tensors left.*/) || [])[0]);
  await ctx.close();
}

// ============ disposal happens even when a backend fails halfway through
{
  const { ctx, page } = await fresh();
  await page.evaluate(() => {
    const real = window.tf.loadGraphModel;
    window.tf.loadGraphModel = (h) => real(h).then((m) => {
      if (window.tf.getBackend() === 'wasm') {
        return { execute: () => { throw new Error('wasm kernel missing'); },
                 dispose: m.dispose };
      }
      return m;
    });
  });
  const t = await run(page);
  ok(/FAILED {11}wasm kernel missing/.test(t),
     'a backend that throws mid-run reports it: ' + (t.match(/FAILED.*/) || [])[0]);
  ok(await page.evaluate(() => window.__live) === 0,
     'and still gives everything back');
  ok(await page.evaluate(() => window.__disposed.models) === 3,
     'including the model it had already loaded');
  await ctx.close();
}

// =============================================== WASM missing on this browser
{
  const { ctx, page } = await fresh({ backends: ['webgl', 'cpu'] });
  const t = await run(page);
  ok(/^WASM$/m.test(t), 'a browser with no WASM backend still gets a section');
  ok(/WASM\n {2}backend {10}wasm\n {2}supported {8}no/.test(t),
     'reported as unsupported rather than omitted');
  ok(/WASM\n[\s\S]*?FAILED {11}this browser has no wasm backend/.test(t),
     'with the exact reason, not a crash');
  ok(/thread count not reported — the wasm backend never initialised/.test(t),
     'and the thread count says why it is absent instead of showing a zero: ' +
     (t.match(/thread count.*/) || [])[0]);
  ok(/^CPU$/m.test(t) && /ONLY USABLE {5}cpu|FASTEST USABLE {2}cpu/.test(t),
     'CPU still runs and is still the fallback');
  ok(/Done/.test(await page.textContent('#tState')), 'the app finishes rather than hanging');
  ok(!(await page.isDisabled('#bTestBench')), 'and the screen is usable again');
  await ctx.close();
}

// ================= WASM present but answering differently — the case that matters
{
  const { ctx, page } = await fresh({ score: { webgl: 0.7236, wasm: 0.41, cpu: 0.7236 } });
  const t = await run(page);
  ok(/wasm {5}pothole 0\.41, 1 detection — DIFFERS from CPU by 0\.3136/.test(t),
     'a backend that is sane but answers differently is called out: ' +
     (t.match(/ {2}wasm .*/) || [])[0]);
  ok(/A faster backend that answers differently is not usable/.test(t),
     'and the reader is told why that matters');
  await ctx.close();
}

// ====================================== everything unusable, nothing pretended
{
  const { ctx, page } = await fresh({ sane: { webgl: false, wasm: false, cpu: false } });
  const t = await run(page);
  ok(/NOTHING USABLE/.test(t),
     'when no backend answers sensibly it says so rather than picking one');
  ok((t.match(/sanity check {5}FAIL/g) || []).length === 3, 'all three marked unusable');
  ok(/CPU did not produce a usable answer, so there is nothing to/.test(t),
     'and the comparison says it has no reference rather than inventing one');
  await ctx.close();
}

// ======================================= a backend that will not start at all
{
  const { ctx, page } = await fresh();
  await page.evaluate(() => {
    const real = window.tf.setBackend;
    window.tf.setBackend = (n) => n === 'wasm'
      ? Promise.reject(new Error('wasm binary would not instantiate'))
      : real(n);
  });
  const t = await run(page);
  ok(/FAILED {11}wasm binary would not instantiate/.test(t),
     'a throwing backend reports its exact failure: ' + (t.match(/FAILED.*/) || [])[0]);
  ok(/^CPU$/m.test(t) && /execute_ms {7}\d+/.test(t),
     'and the backends after it still run');
  await ctx.close();
}

// ============================ a photograph can be benchmarked, same code path
{
  const { ctx, page } = await fresh();
  await page.setInputFiles('#benchFile', join(FIXTURES, 'pothole-fixture.png'));
  await page.waitForFunction(
    () => /Done|could not run/.test(document.getElementById('tState').textContent),
    null, { timeout: 120000 });
  const t = await page.textContent('#frameText');
  ok(/picture {6}photo · pothole-fixture\.png, \d+×\d+ → 640×640/.test(t),
     'the photo is named and its size given: ' + (t.match(/picture {6}.*/) || [])[0]);
  const saw = await page.evaluate(() => window.__benchSaw);
  ok(saw.length === 3 && new Set(saw.map(s => s.sig)).size === 1,
     'and all three backends got that same one picture');
  await ctx.close();
}

// ================================ the survey is not touched by any of this
{
  const src = await (await fetch(B + 'app.js')).text();
  const look = src.slice(src.indexOf('function look()'), src.indexOf('function logFind'));
  ok(!/bench/i.test(look), 'the survey loop still knows nothing about the benchmark');
  // The survey now runs on the same tfjs stack this benchmark measured — that
  // was the point of measuring it — so it no longer imports the 6 MB SDK. What
  // must remain true is that pressing this button changes nothing about which
  // backend the survey chose.
  ok(!/vendor\/inference\.es\.js/.test(look),
     'and no longer drags the 6 MB SDK in to look at a road');
  ok(/engine\.infer\(worker, \{ bitmapImage: input \}\)/.test(look),
     'inferring through the same one-line seam it always did');
  ok(!/setBackend|SURVEY_BACKENDS/.test(look),
     'the survey loop does not pick a backend per frame — that is done once');
  ok(/BENCH_SCRIPTS/.test(src) && /loadBenchTf/.test(src),
     'the benchmark harness exists, reached from the buttons');
  const bench = src.slice(src.indexOf('function runBench('), src.indexOf('function benchLines'));
  ok(!/infSession|SURVEY_BACKENDS|infPick/.test(bench),
     'and the benchmark cannot reach into the survey\'s own session');
  ok(/actually runs on is chosen separately/.test(src),
     'the report says the benchmark decides nothing by itself');
}

console.log(fails.length ? '\n' + fails.length + ' FAILED' : '\nall passed');
await browser.close();
process.exit(fails.length ? 1 : 0);
