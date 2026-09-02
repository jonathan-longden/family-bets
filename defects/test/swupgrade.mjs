// The load that installs the fix is the one the fix cannot reach.
//
// v20 sends /vendor/ down a cache-first path with no timeout, which is the fix
// for "No model" meaning "this file was slow". A service worker cannot fix the
// load that installs it, though: that page is still being served by the old
// worker and its four-second timeout, so the deploy landed and the app still
// said "No model" — which is exactly what came back from the phone.
//
// So the app asks again. A script that fails is re-requested once, after the
// new worker claims the page (controllerchange), capped at a second and a half
// so a page with no worker does not sit waiting for one.
//
// Served over a deliberately slow link — six seconds per vendor file, past the
// old timeout and irrelevant to the new one. The weights are unreachable from
// here and do not need to be: what is measured is whether the RUNTIME arrives.
import { chromium } from 'playwright';
import { DEFECTS, FIXTURES, HERE } from './browser.mjs';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { CHROME } from './browser.mjs';
import { copyFileSync, cpSync, rmSync, mkdirSync } from 'fs';
import { spawn } from 'child_process';

const DIR = mkdtempSync(join(tmpdir(), 'swupgrade-'));
const B = 'http://127.0.0.1:8779/defects/';
const fails = [];
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails.push(m); };

// A copy of the site that can be redeployed under the browser's feet, and a
// server that makes every vendor file take six seconds. Both belong to this
// suite: the whole point is the changeover from one worker to the next, and
// that cannot be staged against a directory somebody else is serving.
rmSync(DIR + '/stage', { recursive: true, force: true });
mkdirSync(DIR + '/stage', { recursive: true });
cpSync(DEFECTS, DIR + '/stage/defects', { recursive: true });
copyFileSync(DIR + '/stage/defects/sw.js', DIR + '/stage/sw-new.js');
copyFileSync(join(FIXTURES, 'sw-v19.js'), DIR + '/stage/sw-old.js');
const srv = spawn('python3', [join(HERE, 'slowsrv.py'), DIR + '/stage'],
  { stdio: 'ignore', detached: true });
process.on('exit', () => { try { process.kill(-srv.pid); } catch {} });
for (let i = 0; i < 40; i++) {
  try { await fetch('http://127.0.0.1:8779/defects/index.html'); break; }
  catch { await new Promise(r => setTimeout(r, 250)); }
}

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });

const ctx = await browser.newContext({
  permissions: ['camera', 'geolocation'],
  geolocation: { latitude: 53, longitude: -1.1, accuracy: 8 },
  viewport: { width: 844, height: 390 } });
const page = await ctx.newPage();
await ctx.route('https://api.roboflow.com/**', r => r.abort());

// The gauge's value, without the label the markup puts in front of it.
const state = async () => page.evaluate(() => {
  const g = document.getElementById('gModel');
  const b = g && g.querySelector('b');
  return {
    chip: b ? b.textContent.trim() : '',
    tried: (window.infFacts ? infFacts.tried : []).map(t => t.backend),
    retried: (window.infFacts ? infFacts.retried : []).slice(),
    fail: window.infFacts && infFacts.startFail ? infFacts.startFail.why : null,
    tf: !!(window.tf && window.tf.setBackend)
  };
});

// Settled = the model is up, or it has given up. Anything else is still trying.
const settle = (ms) => page.waitForFunction(() => {
  const g = document.getElementById('gModel');
  const b = g && g.querySelector('b');
  return !!b && /^(Ready|No |Nonsense|Layout|Precision)/.test(b.textContent.trim());
}, null, { timeout: ms }).catch(() => {});

const show = (label, s) => console.log('  ' + label + ' → chip ' + JSON.stringify(s.chip) +
  ', tried ' + JSON.stringify(s.tried) + ', retried ' + JSON.stringify(s.retried) +
  ', fail ' + JSON.stringify(s.fail));

copyFileSync(DIR + '/stage/sw-old.js', DIR + '/stage/defects/sw.js');

// ============ load 1: v19 installs, and takes charge partway through the load
//
// The five scripts load one after another over about thirty seconds, and the
// worker claims the page inside that window — so the first few requests go
// straight to the network and the rest go through v19's timeout. The chain
// dies wherever the changeover caught it, which is why the failing file here
// is not the same one as on load 2. That is the shape of the bug, not noise.
{
  await page.goto(B, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => navigator.serviceWorker.ready);
  await settle(180000);
  const s = await state();
  show('load 1, v19 taking over mid-load', s);
  ok(s.chip === 'No runtime',
     'a worker taking charge mid-chain stops the runtime just the same: ' + s.chip);
  ok(/could not load .*\.js/.test(s.fail || ''),
     'and the reason names whichever script the changeover caught: ' + s.fail);
}

// ============================ load 2: v19 in charge, and this is the old fault
{
  await page.reload({ waitUntil: 'domcontentloaded' });
  await settle(180000);
  const s = await state();
  show('load 2, v19 in charge', s);
  ok(s.chip === 'No runtime',
     'under the old worker a slow vendor file still stops the runtime — the ' +
     'fault as reported — and the gauge now says which half: ' + s.chip);
  ok(/could not load .*\.js/.test(s.fail || ''),
     'the reason names a script, so it is the download: ' + s.fail);
  ok(s.retried.length > 0,
     'and it was asked for twice before giving up: ' + JSON.stringify(s.retried));
}

// ============================== the deploy: v20 published, and the load after
{
  copyFileSync(DIR + '/stage/sw-new.js', DIR + '/stage/defects/sw.js');
  const version = await (await fetch(B + 'sw.js')).text();
  ok(/defect-log-v20/.test(version), 'v20 is what the server is serving');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await settle(180000);
  const s = await state();
  show('load 3, the one that installs v20', s);
  // This is the load that was broken. The first request for tf-core is answered
  // by v19 and times out; v20 activates, claims the page, and the retry goes
  // down the cache-first path instead.
  ok(s.tf, 'the load that INSTALLS the fix now gets the runtime, on the retry');
  ok(s.retried.length > 0,
     'which is what happened — a script was asked for twice: ' + JSON.stringify(s.retried));
  ok(s.chip !== 'No runtime',
     'so it no longer reports a missing runtime on the deploy load: ' + s.chip);
  ok(s.tried.length > 0,
     'and it gets far enough to choose a backend: ' + JSON.stringify(s.tried));
}

// =================== and from then on it is cached, with nothing to retry
{
  await page.reload({ waitUntil: 'domcontentloaded' });
  await settle(180000);
  const s = await state();
  show('load 4, v20 settled', s);
  ok(s.tf, 'the runtime comes from the cache');
  ok(s.retried.length === 0,
     'and nothing needed asking for twice: ' + JSON.stringify(s.retried));
  const diag = await page.evaluate(() => diagLines());
  ok(/runtime      loaded/.test(diag),
     'diagnostics say the runtime loaded, separately from the backend choice');
}

// ============ a second attempt does not re-run the builds that already ran
//
// The chain can now be started more than once — a failed attempt leaves nothing
// behind, and getting signal back or a new worker taking charge starts another.
// If that second attempt re-executed the scripts that already loaded,
// TensorFlow.js would throw on the second registration of a kernel it already
// has, and a recoverable failure would become a permanent one.
{
  const before = await page.evaluate(() => document.querySelectorAll(
    'script[src*="vendor/tfjs/"]').length);
  const r = await page.evaluate(() => {
    // exactly what a retry from 'online' or 'controllerchange' does
    benchTf = null; benchLoading = null;
    return loadBenchTf().then(
      () => ({ ok: true, tags: document.querySelectorAll('script[src*="vendor/tfjs/"]').length }),
      (e) => ({ ok: false, error: String(e && e.message) }));
  });
  ok(r.ok, 'starting the chain a second time succeeds rather than throwing: ' +
     JSON.stringify(r));
  ok(r.tags === before,
     'and appends no new script tags, so nothing is executed twice: ' +
     before + ' then ' + r.tags);
  ok(await page.evaluate(() => !!(window.tf && window.tf.setBackend)),
     'while the runtime is still there afterwards');
}

await ctx.close();
console.log(fails.length ? '\n' + fails.length + ' FAILED' : '\nall passed');
await browser.close();
process.exit(fails.length ? 1 : 0);
