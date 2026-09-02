// The 2.4 MB the survey cannot start without, and the four seconds that stopped
// it arriving.
//
// The service worker is network-first with a four-second timeout, and it passes
// cache:'reload' so the browser's own HTTP cache never answers either. That is
// right for the app's own files — a deploy has to be able to land — and it was
// actively wrong for the vendored TensorFlow.js: five scripts, loaded one after
// another, re-fetched on EVERY page load, and if any one of them took longer
// than four seconds there was nothing cached to fall back to and the model would
// not load at all. The app said "No model" and meant "this file was slow".
//
// Reproduced before it was fixed: with a five-second delay on vendor/tfjs the
// backend list came back empty, meaning nothing was ever tried.
import { chromium } from 'playwright';
import { CHROME } from './browser.mjs';
const B = 'http://127.0.0.1:8777/defects/';
const fails = [];
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails.push(m); };

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });

// ================== a slow vendor file no longer stops the model loading
{
  const ctx = await browser.newContext({
    permissions: ['camera', 'geolocation'],
    geolocation: { latitude: 53, longitude: -1.1, accuracy: 8 },
    viewport: { width: 844, height: 390 } });
  const page = await ctx.newPage();
  let vendorHits = 0;
  // every tfjs asset takes five seconds — comfortably past the worker's timeout
  await ctx.route('**/vendor/tfjs/**', async r => {
    vendorHits++;
    await new Promise(x => setTimeout(x, 5000));
    await r.continue();
  });
  await page.goto(B, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.getElementById('badge').textContent === 'Live',
    null, { timeout: 20000 });
  // the runtime has to actually arrive, however long it takes
  await page.waitForFunction(() => typeof window.tf === 'object' && window.tf !== null,
    null, { timeout: 90000 }).catch(() => {});
  const gotTf = await page.evaluate(() => !!(window.tf && window.tf.setBackend));
  ok(gotTf, 'TensorFlow.js arrives even when every file takes five seconds');

  // window.tf exists as soon as tf-core lands, so the count is only meaningful
  // once the whole chain has run — which reaching the backends proves
  await page.waitForFunction(() => (infFacts.tried || []).length > 0,
    null, { timeout: 90000 }).catch(() => {});
  ok(vendorHits >= 5, 'and all five scripts were fetched, not just the first: ' + vendorHits);
  const tried = await page.evaluate(() => (infFacts.tried || []).map(t => t.backend));
  ok(tried.length > 0,
     'so the backend choice is actually reached rather than never happening: ' +
     JSON.stringify(tried));
  ok(tried[0] === 'wasm', 'and WASM is still the one tried first: ' + tried[0]);
  await ctx.close();
}

// =========================== second load comes from the cache, not the network
{
  const ctx = await browser.newContext({
    permissions: ['camera', 'geolocation'],
    geolocation: { latitude: 53, longitude: -1.1, accuracy: 8 },
    viewport: { width: 844, height: 390 } });
  const page = await ctx.newPage();
  let hits = 0;
  await ctx.route('**/vendor/tfjs/**', async r => { hits++; await r.continue(); });
  await page.goto(B, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => typeof window.tf === 'object' && window.tf !== null,
    null, { timeout: 60000 }).catch(() => {});
  const first = hits;
  ok(first >= 5, 'the first load fetches the runtime: ' + first);

  // The worker is not controlling the very first load — it installs during it —
  // so that load goes straight past it and caches nothing. The steady state is
  // what matters: once the worker is in charge and has filled its cache, a
  // pinned version cannot have changed, so asking again can only cost time.
  hits = 0;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (infFacts.tried || []).length > 0,
    null, { timeout: 60000 }).catch(() => {});
  const second = hits;
  hits = 0;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (infFacts.tried || []).length > 0,
    null, { timeout: 60000 }).catch(() => {});
  ok(hits === 0,
     'once the worker is in charge, later loads fetch none of it: ' +
     second + ' then ' + hits);
  ok(await page.evaluate(() => !!(window.tf && window.tf.setBackend)),
     'while still having the runtime');
  await ctx.close();
}

// ============ the app's own files still go network first, so deploys land
{
  const src = await (await fetch(B + 'sw.js')).text();
  ok(/req\.url\.includes\('\/vendor\/'\)\) return event\.respondWith\(vendored\(req\)\)/.test(src),
     'only /vendor/ is routed to the cache-first path');
  ok(/event\.respondWith\(networkFirst\(req\)\)/.test(src),
     'and everything else — the app itself — is still network first');
  const v = src.slice(src.indexOf('async function vendored'), src.indexOf('async function unstorable'));
  ok(!/NET_TIMEOUT|setTimeout/.test(v),
     'the vendored path has no timeout: a slow first load is slow once');
  ok(/cache\.match\(req\)/.test(v) && v.indexOf('cache.match') < v.indexOf('fetch(req)'),
     'and it looks in the cache before it looks at the network');
}

// ================= and the failure says why, when there is nothing else to read
{
  const ctx = await browser.newContext({
    permissions: ['camera', 'geolocation'],
    geolocation: { latitude: 53, longitude: -1.1, accuracy: 8 },
    viewport: { width: 844, height: 390 } });
  const page = await ctx.newPage();
  // the runtime never arrives at all
  await ctx.route('**/vendor/tfjs/*.js', r => r.abort());
  await page.goto(B, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.getElementById('badge').textContent === 'Live',
    null, { timeout: 20000 });
  await page.waitForFunction(
    () => /No runtime/.test(document.getElementById('modelChip').textContent),
    null, { timeout: 60000 });
  const diag = await page.evaluate(() => diagLines());
  ok(/LAST FAILURE/.test(diag),
     'the diagnostics carry the reason, not just the two words on the chip: ' +
     (diag.match(/LAST FAILURE.*/) || [])[0]);
  ok(/No backend was reached, so this happened before the choice was made/.test(diag),
     'and say the failure came before any backend was chosen, which is the ' +
     'difference between a bad runtime and a bad backend');
  await ctx.close();
}

console.log(fails.length ? '\n' + fails.length + ' FAILED' : '\nall passed');
await browser.close();
process.exit(fails.length ? 1 : 0);
