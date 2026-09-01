// Which backend the survey actually runs on, and what happens when it can't.
//
// The measurement said WASM is 33x faster than CPU and returns identical
// numbers, and that WebGL is not slow but wrong — it answered a frame with one
// pothole by returning TWENTY detections at a "confidence" of 407894400. So the
// production order is WASM, then CPU, and WebGL is not in the list at all.
//
// This suite drives that choice: what is picked, what happens when the first
// choice is missing, when it initialises but talks nonsense, when it goes bad
// mid-survey, and whether the model is loaded once and everything given back.
import { chromium } from 'playwright';
import { CHROME } from './browser.mjs';
import { settled, rec } from './shellhelp.mjs';
const B = 'http://127.0.0.1:8777/defects/';
const fails = [];
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails.push(m); };

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });

// A stand-in for tfjs. The real stack is 2.4 MB and the real weights need
// Roboflow; what is under test is the selection, not TensorFlow.
const fakeTf = (opts) => {
  const o = Object.assign({
    backends: ['webgl', 'wasm', 'cpu'],
    simd: true, threads: false, threadCount: 1,
    // whether each backend's output passes the range check
    sane: { webgl: false, wasm: true, cpu: true },
    // a backend can also go bad only AFTER the startup probe
    goesBadAfter: {},
    infer: { webgl: 2, wasm: 8, cpu: 30 },
    throwOn: null
  }, opts || {});
  window.__loads = [];          // one entry per loadGraphModel, with the backend
  window.__execs = [];          // one per execute
  window.__live = 0;
  window.__disposedModels = 0;
  window.__tracked = [];
  let current = null;

  const mk = (extra) => {
    window.__live++;
    const t = Object.assign({
      _dead: false, shape: [1, 8400, 6],
      dataSync: () => {
        const n = 8400 * 6, d = new Float32Array(n);
        for (let a = 0; a < 8400; a++) {
          d[a * 6] = 300; d[a * 6 + 1] = 337; d[a * 6 + 2] = 40; d[a * 6 + 3] = 30;
          d[a * 6 + 4] = 0.0047; d[a * 6 + 5] = 0.01;
        }
        d[4211 * 6 + 5] = 0.7236;
        const n2 = (o.goesBadAfter[current] || 0);
        const past = window.__execs.filter(e => e === current).length;
        const bad = !o.sane[current] || (n2 && past > n2);
        if (bad) { d[0] = -27024638; d[1] = 407894400; }
        return d;
      },
      dispose: function () {
        if (this._dead) return;
        this._dead = true; window.__live--;
      }
    }, extra || {});
    window.__tracked.push(t);
    return t;
  };

  window.tf = {
    __stub: true,
    version_core: '4.22.0-stub',
    env: () => ({ getAsync: (f) => Promise.resolve(
      f === 'WASM_HAS_SIMD_SUPPORT' ? o.simd :
      f === 'WASM_HAS_MULTITHREAD_SUPPORT' ? o.threads : null) }),
    wasm: {
      setWasmPaths: () => {},
      getThreadsCount: () => {
        if (current !== 'wasm') throw new Error('WASM backend not initialized.');
        return o.threadCount;
      }
    },
    memory: () => ({ numTensors: window.__live }),
    setBackend: (n) => {
      if (o.backends.indexOf(n) === -1) return Promise.resolve(false);
      if (o.throwOn === n) return Promise.reject(new Error(n + ' would not instantiate'));
      current = n; return Promise.resolve(true);
    },
    getBackend: () => current,
    ready: () => Promise.resolve(),
    loadGraphModel: (handler) => {
      const on = current;
      window.__loads.push(on);
      return handler.load().then(() => ({
        execute: () => { window.__execs.push(current); return mk(); },
        dispose: () => { window.__disposedModels++; }
      }));
    },
    tidy: (fn) => {
      const before = window.__tracked.length;
      const out = fn();
      window.__tracked.slice(before).forEach(t => { if (t !== out) t.dispose(); });
      return out;
    },
    dispose: (t) => { if (t && t.dispose) t.dispose(); },
    transpose: (t) => mk({ dataSync: t.dataSync }),
    div: (t) => t,
    image: {
      resizeNearestNeighbor: (t) => t,
      nonMaxSuppression: () => ({ dataSync: () => new Int32Array([4211]) })
    },
    tensor2d: () => ({}),
    /* Top-level, not chained, because that is what @tensorflow/tfjs-core
       actually provides. This stub used to return { expandDims: () => ({
       asType: () => t }) }, which modelled the UNION package's chained ops —
       methods tfjs-core does not register. The app was written against that
       fiction, it worked only while the Roboflow SDK's bundled copy was on the
       page registering them, and when the SDK was removed every backend failed
       in preprocessing. A stub that says yes to anything cannot catch that;
       realtf.mjs runs the same path on the real library. */
    expandDims: (t) => mk({ dataSync: t.dataSync }),
    cast: (t) => t,
    browser: { fromPixels: () => mk() }
  };
  window.modelMeta = () => Promise.resolve({ classes: ['manhole', 'pothole'],
    weights: { modelTopology: { node: [] },
      weightsManifest: [{ paths: ['shard1.bin'],
        weights: [{ name: 'a', shape: [1], dtype: 'float32' }] }] } });

  // The page has already tried to start the model on load, with the real
  // vendor scripts routed to nothing — so that attempt failed and left a
  // rejected promise in `loading`. Clear the session state so the test starts
  // from where a real phone would, rather than inheriting that failure.
  loading = null; benchTf = null; benchLoading = null;
  engine = null; worker = null;
  infSession = null; infExcluded = [];
  infFacts.backend = null; infFacts.tried = []; infFacts.loads = 0;
  infFacts.infers = 0; infFacts.lastMs = null; infFacts.recent = [];
  infFacts.demoted = null; infFacts.threadCount = null;
};

const fresh = async (opts) => {
  const ctx = await browser.newContext({
    permissions: ['camera', 'geolocation'],
    geolocation: { latitude: 53, longitude: -1.1, accuracy: 8 },
    viewport: { width: 844, height: 390 },
    // No service worker. The vendored scripts here are stubs served by
    // ctx.route, and a worker's own fetches do not go through ctx.route — so
    // once one takes charge it pulls the real 2.4 MB and overwrites the stub
    // mid-test. This suite is about backend selection, not caching; sw.mjs and
    // vendorcache.mjs are where the worker is the subject.
    serviceWorkers: 'block' });
  const page = await ctx.newPage();
  page.on('dialog', d => d.accept());
  await ctx.route('**/shard*.bin', r => r.fulfill({ status: 200, body: Buffer.alloc(1024) }));
  await ctx.route('**/vendor/tfjs/*.js', r =>
    r.fulfill({ status: 200, contentType: 'application/javascript', body: ';' }));
  await page.goto(B, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.getElementById('badge').textContent === 'Live',
    null, { timeout: 15000 });
  await settled(page);
  await page.evaluate(fakeTf, opts);
  await page.waitForFunction(() => document.getElementById('vid').videoWidth > 0);
  return { ctx, page };
};

// Raced against a clock. A loadModel that never settles used to kill the whole
// suite with "promise was garbage collected", which says nothing about what it
// was waiting for; this turns it into a failure that reports the state.
const start = (page) => page.evaluate(() => Promise.race([
  loadModel().then(
    () => ({ ok: true, backend: infFacts.backend }),
    (e) => ({ ok: false, error: e.message })),
  new Promise(r => setTimeout(() => r({
    ok: false, stuck: true,
    error: 'loadModel never settled',
    benchTf: !!window.benchTf, benchLoading: !!window.benchLoading,
    ran: Object.keys(window.benchRan || {}),
    retried: infFacts.retried, tried: infFacts.tried.map(t => t.backend),
    loads: window.__loads, controller: !!(navigator.serviceWorker || {}).controller,
    tfIsStub: !!(window.tf && window.tf.__stub)
  }), 45000))
]));

// ============================= 1. WASM is chosen when available and sane
{
  const { ctx, page } = await fresh();
  const r = await start(page);
  ok(r.ok && r.backend === 'wasm', 'WASM is selected when it works: ' + JSON.stringify(r));
  ok((await page.evaluate(() => window.__loads)).join(',') === 'wasm',
     'and nothing else was even loaded');
  const facts = await page.evaluate(() => infFacts);
  ok(facts.simd === true, 'SIMD is recorded from the runtime');
  ok(facts.threads === false && facts.threadCount === 1,
     'and so are threads and the thread count: ' + facts.threads + ', ' + facts.threadCount);
  const diag = await page.evaluate(() => diagLines());
  ok(/SURVEY BACKEND {2}\(what the survey itself is running on, right now\)/.test(diag),
     'diagnostics have a survey-backend block');
  ok(/using {8}WASM/.test(diag), 'naming what is in use: ' + (diag.match(/using {8}.*/) || [])[0]);
  await ctx.close();
}

// ================================= 2. CPU when WASM is not available at all
{
  const { ctx, page } = await fresh({ backends: ['webgl', 'cpu'] });
  const r = await start(page);
  ok(r.ok && r.backend === 'cpu', 'CPU is used when there is no WASM backend: ' + r.backend);
  const facts = await page.evaluate(() => infFacts);
  const wasmTry = facts.tried.filter(t => t.backend === 'wasm')[0];
  ok(wasmTry && /no wasm backend/.test(wasmTry.error),
     'and the reason WASM was skipped is recorded: ' + (wasmTry && wasmTry.error));
  ok(facts.tried.map(t => t.backend).join(',') === 'wasm,cpu',
     'WASM was tried first and CPU second: ' + facts.tried.map(t => t.backend).join(','));
  await ctx.close();
}

// ======================= 3. CPU when WASM starts but fails the sanity check
{
  const { ctx, page } = await fresh({ sane: { webgl: false, wasm: false, cpu: true } });
  const r = await start(page);
  ok(r.ok && r.backend === 'cpu',
     'a WASM backend that talks nonsense is not used: ' + r.backend);
  const facts = await page.evaluate(() => infFacts);
  const wasmTry = facts.tried.filter(t => t.backend === 'wasm')[0];
  ok(wasmTry.initialised === true && wasmTry.sane === false,
     'it initialised — which is exactly why initialising is not the test');
  ok(/failed the sanity check/.test(wasmTry.error) && /407894400/.test(wasmTry.error),
     'and the numbers it produced are quoted: ' + wasmTry.error);
  ok(await page.evaluate(() => window.__disposedModels) >= 1,
     'its model was disposed rather than left holding memory');
  await ctx.close();
}

// ================================ 4. WebGL is never selected for the survey
{
  // even when WebGL is the only sane backend, it must not be chosen
  const { ctx, page } = await fresh({ sane: { webgl: true, wasm: false, cpu: false } });
  const r = await start(page);
  ok(!r.ok, 'with WASM and CPU both bad the survey refuses to start rather than ' +
     'falling back to WebGL: ' + JSON.stringify(r));
  // Check the structure, not the prose: one of the failure messages explains
  // what WebGL does on this phone, and a JSON-grep for the word matches that.
  const triedNames = (await page.evaluate(() => infFacts.tried)).map(t => t.backend);
  ok(triedNames.indexOf('webgl') === -1,
     'WebGL was never even tried: ' + JSON.stringify(triedNames));
  const order = await page.evaluate(() => SURVEY_BACKENDS);
  ok(order.join(',') === 'wasm,cpu', 'the production order is wasm,cpu: ' + order.join(','));
  const src = await (await fetch(B + 'app.js')).text();
  const sel = src.slice(src.indexOf('var SURVEY_BACKENDS'), src.indexOf('function infProbeCanvas'));
  ok(!/webgl/.test(sel.replace(/\/\*[\s\S]*?\*\//g, '')),
     'and no code in the selection path mentions it');
  const diag = await page.evaluate(() => diagLines());
  ok(/WebGL is NOT in this list and cannot be selected/.test(diag),
     'diagnostics say so in as many words');
  await ctx.close();
}

// ================================= 5. the model is loaded once and reused
{
  const { ctx, page } = await fresh();
  await start(page);
  await page.evaluate(() => { window.__hits = []; });
  await rec(page);
  await page.waitForFunction(() => infFacts.infers >= 3, null, { timeout: 20000 });
  await page.click('#bRec');
  const loads = await page.evaluate(() => window.__loads);
  const facts = await page.evaluate(() => infFacts);
  ok(loads.length === 1, 'the model was loaded exactly once for the whole survey: ' + loads.length);
  ok(facts.infers >= 3, 'across several looks: ' + facts.infers);
  ok(facts.loads === 1, 'and the count the diagnostics show agrees: ' + facts.loads);
  const diag = await page.evaluate(() => diagLines());
  ok(/model loads {2}1 for \d+ inferences {2}— loaded once and reused/.test(diag),
     'reported as loaded once and reused: ' + (diag.match(/model loads.*/) || [])[0]);
  await ctx.close();
}

// ============================== 6. overlapping inference cannot happen
{
  const { ctx, page } = await fresh();
  await start(page);
  // make every inference slow, then check no two are ever in flight together
  await page.evaluate(() => {
    window.__inFlight = 0; window.__maxInFlight = 0;
    const real = window.engine.infer;
    window.engine = { infer: function (w, img) {
      window.__inFlight++;
      window.__maxInFlight = Math.max(window.__maxInFlight, window.__inFlight);
      return new Promise(r => setTimeout(r, 350))
        .then(() => real.call(this, w, img))
        .then((v) => { window.__inFlight--; return v; },
              (e) => { window.__inFlight--; throw e; });
    } };
  });
  await rec(page);
  await page.waitForFunction(() => window.__maxInFlight >= 1, null, { timeout: 15000 });
  await new Promise(r => setTimeout(r, 3000));
  await page.click('#bRec');
  const max = await page.evaluate(() => window.__maxInFlight);
  ok(max === 1, 'never more than one inference in flight at a time: ' + max);
  await ctx.close();
}

// ================================= 7. tensors are given back every frame
{
  const { ctx, page } = await fresh();
  await start(page);
  const afterStart = await page.evaluate(() => window.__live);
  ok(afterStart === 0, 'the startup sanity probe leaves nothing behind: ' + afterStart);
  await rec(page);
  await page.waitForFunction(() => infFacts.infers >= 3, null, { timeout: 20000 });
  await page.click('#bRec');
  const live = await page.evaluate(() => window.__live);
  ok(live === 0, 'and neither does a run of looks: ' + live + ' tensors outstanding');
  await ctx.close();
}

// ========================= 8. a backend that goes bad mid-survey is dropped
{
  const { ctx, page } = await fresh({ goesBadAfter: { wasm: 2 } });
  const r = await start(page);
  ok(r.backend === 'wasm', 'it starts on WASM, which was sane at the time');
  await rec(page);
  await page.waitForFunction(() => infFacts.demoted != null, null, { timeout: 25000 });
  const facts = await page.evaluate(() => infFacts);
  ok(facts.demoted.backend === 'wasm',
     'when it stops making sense it is dropped: ' + JSON.stringify(facts.demoted.why));
  ok(/407894400/.test(facts.demoted.why), 'quoting what it produced');
  // and the next look brings CPU up
  await page.waitForFunction(() => infFacts.backend === 'cpu', null, { timeout: 25000 });
  ok(await page.evaluate(() => infFacts.backend) === 'cpu',
     'and the survey carries on, on CPU');
  ok((await page.evaluate(() => window.__loads)).join(',') === 'wasm,cpu',
     'having loaded the model onto the fallback: ' +
     (await page.evaluate(() => window.__loads)).join(','));
  const diag = await page.evaluate(() => diagLines());
  ok(/WASM WAS DROPPED MID-SURVEY/.test(diag), 'and the diagnostics record it');
  await page.click('#bRec');
  await ctx.close();
}

// ============================ 9. stationary suppression still works
{
  const { ctx, page } = await fresh();
  await start(page);
  await page.evaluate(() => {
    S.gps = { lat: 53, lon: -1.1, acc: 8, at: Date.now(), heading: null, speed: 0 };
  });
  await rec(page);
  await page.waitForFunction(
    () => /Stopped — not looking/.test(document.getElementById('hudState').textContent),
    null, { timeout: 15000 });
  const before = await page.evaluate(() => infFacts.infers);
  await new Promise(r => setTimeout(r, 2500));
  const after = await page.evaluate(() => infFacts.infers);
  ok(after === before, 'standing still, the model is not run at all: ' + before + ' → ' + after);
  await page.click('#bRec');
  await ctx.close();
}

// ============================= 10. distance-based cadence still works
{
  const { ctx, page } = await fresh();
  await start(page);
  const fast = await page.evaluate(() => {
    S.gps = { lat: 53, lon: -1.1, acc: 8, at: Date.now(), heading: null, speed: 13.4 };
    return lookDelay();
  });
  const slow = await page.evaluate(() => {
    S.gps = { lat: 53, lon: -1.1, acc: 8, at: Date.now(), heading: null, speed: 2 };
    return lookDelay();
  });
  const none = await page.evaluate(() => { S.gps = null; return lookDelay(); });
  // a float, not an integer: 10 m / 13.4 m/s = 746.27 ms, and setTimeout does
  // not care. Asserting the exact integer was asserting a rounding that is not
  // there.
  ok(Math.abs(fast - 746.27) < 0.5,
     'at 30 mph a look every 10 m is one every ~746 ms: ' + fast);
  ok(slow === 4000, 'at walking pace the ceiling holds it at 4000 ms: ' + slow);
  ok(none === 1200, 'and with no speed the old fixed interval stands: ' + none);
  ok(fast < slow, 'faster travel means more frequent looks, which is the whole idea');
  await ctx.close();
}

// ================= detections still decode correctly through the new path
{
  const { ctx, page } = await fresh();
  await start(page);
  const preds = await page.evaluate(() =>
    engine.infer(1, { bitmapImage: document.createElement('canvas') })
      .then(p => p.map(x => x.__diag
        ? { diag: true, backend: x.backendNow, min: x.frameRange.min,
            max: x.frameRange.max, best: x.best && x.best.cls + ' ' + x.best.score,
            thresholds: x.thresholds }
        : { cls: x.class, conf: x.confidence, box: x.bbox })));
  const det = preds.filter(p => !p.diag);
  const diag = preds.filter(p => p.diag)[0];
  ok(det.length === 1 && det[0].cls === 'pothole',
     'one pothole comes back, in the shape the rest of the app understands: ' +
     JSON.stringify(det));
  ok(Math.abs(det[0].conf - 0.7236) < 1e-6,
     'at the confidence the model gave it: ' + det[0].conf);
  ok(det[0].box && det[0].box.width === 40 && det[0].box.height === 30,
     'with a box in the 640 square: ' + JSON.stringify(det[0].box));
  ok(diag && diag.backend === 'wasm', 'and the diagnostic block names the backend');
  ok(diag.thresholds.score === 0.5 && diag.thresholds.iou === 0.5 &&
     diag.thresholds.maxBoxes === 20,
     'with the library\'s own unchanged NMS numbers: ' + JSON.stringify(diag.thresholds));
  // usableFind is what the survey uses to turn these into finds
  const find = await page.evaluate(() => usableFind(
    { class: 'pothole', confidence: 0.7236, bbox: { x: 300, y: 337, width: 228, height: 78 } },
    640, 640));
  ok(find && find.cls === 'pothole' && Math.abs(find.conf - 0.7236) < 1e-6,
     'and the survey\'s own filter still reads them: ' + JSON.stringify(find));
  await ctx.close();
}

// ================================= the telemetry, and the honest slow warning
{
  const { ctx, page } = await fresh();
  await start(page);
  await page.evaluate(() => {
    S.gps = { lat: 53.0001, lon: -1.1001, acc: 8, at: Date.now(), heading: 90, speed: 13.4 };
  });
  await rec(page);
  await page.waitForFunction(() => !document.getElementById('hudTele').hidden,
    null, { timeout: 15000 });
  const t = await page.textContent('#hudTele');
  for (const f of ['Backend', 'Inference', 'Last GPS', 'Speed', 'Distance', 'Next look']) {
    ok(new RegExp('^' + f, 'm').test(t), 'the telemetry shows ' + f);
  }
  // the labels are padded to a common width so the numbers do not jump about
  ok(/Backend {4}WASM/.test(t), 'naming the live backend: ' + (t.match(/Backend.*/) || [])[0]);
  ok(t.split('\n').every(l => !l.trim() || /^\S[\w ]{8} {2}\S/.test(l)),
     'and every line is aligned on the same column, so it does not reflow');
  ok(/Speed {4}\s*30 mph/.test(t.replace(/\s+/g, ' ')) || /29\.9|30 mph/.test(t),
     'with the speed in mph: ' + (t.match(/Speed.*/) || [])[0]);

  // a slow backend must not claim a coverage it is not achieving
  const warn = await page.evaluate(() => {
    infFacts.lastMs = 4000;              // 13.4 m/s x 4 s = 53 m per look
    return coverageWarning();
  });
  ok(/Slow inference — survey coverage reduced/.test(warn),
     'a slow look at speed is called out: ' + warn);
  // 13.4 m/s x 4 s = 53.6 m, which rounds to 54
  ok(/54 m passes per look, not 10/.test(warn),
     'with the distance actually passing between looks: ' + warn);
  const ok2 = await page.evaluate(() => { infFacts.lastMs = 533; return coverageWarning(); });
  ok(ok2 === null, 'and 533 ms at 30 mph raises nothing, because it covers the ground');
  await page.click('#bRec');
  await page.waitForFunction(() => document.getElementById('hudTele').hidden,
    null, { timeout: 5000 });
  ok(true, 'the telemetry goes away when the survey stops');
  await ctx.close();
}

// ================================== the survey no longer drags in the 6 MB SDK
{
  const src = await (await fetch(B + 'app.js')).text();
  ok(!/vendor\/inference\.es\.js/.test(src),
     'nothing in the app imports the SDK any more');
  const load = src.slice(src.indexOf('function loadModel'), src.indexOf('function whyLocal'));
  ok(/loadBenchTf/.test(load) && /infPick/.test(load),
     'loadModel brings up the tfjs session and picks a backend');
  ok(/worker = 1/.test(load),
     'and keeps the worker sentinel, so every "is there a model" guard still works');
}

console.log(fails.length ? '\n' + fails.length + ' FAILED' : '\nall passed');
await browser.close();
process.exit(fails.length ? 1 : 0);
