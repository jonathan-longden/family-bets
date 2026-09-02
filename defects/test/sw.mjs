import { chromium } from 'playwright';
import { CHROME } from './browser.mjs';
import { toCamera, openLog, openMap, rec } from './shellhelp.mjs';
import { openMenu, menuHas } from './shellhelp.mjs';
const B = 'http://127.0.0.1:8777/defects/';
const fails = [];
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails.push(m); };
const browser = await chromium.launch({ executablePath: CHROME });
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 } });
const page = await ctx.newPage();

// what the worker asks the network for, and whether it lets the HTTP cache answer
const modes = [];
await page.route('**/app.js', route => { modes.push(route.request().headers()['cache-control'] || ''); route.continue(); });

await page.goto(B, { waitUntil: 'networkidle' });
await page.evaluate(() => navigator.serviceWorker.ready);
ok(await page.textContent('#build') !== '—', 'the build is printed: ' + await page.textContent('#build'));

// second load goes through the worker
await page.reload({ waitUntil: 'networkidle' });
const viaSw = await page.evaluate(async () => {
  const r = await fetch('./app.js');
  return r.ok;
});
ok(viaSw, 'the worker still serves app.js');
// whether a deploy actually lands is proved end to end in deploy.mjs, against a
// server sending the same max-age Pages does; page-level routing cannot see
// service-worker requests, so asserting on them here measured nothing.

// the new error wording actually reaches the page
const src = await page.evaluate(() => fetch('./app.js').then(r => r.text()));
ok(!/detect\.roboflow\.com/.test(src), 'the dead hosted call is gone from what is served');
ok(/Waiting for the model/.test(src), 'the on-device wording is in what is served');

// The old shell is evicted. The expected name is read out of sw.js rather than
// written here, because a hard-coded one silently asserts nothing the moment
// someone bumps the cache and forgets this line.
const want = (await page.evaluate(() => fetch('./sw.js').then(r => r.text())))
  .match(/CACHE_NAME\s*=\s*'([^']+)'/)[1];
const caches_ = await page.evaluate(() => caches.keys());
ok(caches_.length === 1 && caches_[0] === want,
   'only the current cache survives, and it is the one sw.js names (' + want + '): ' +
   JSON.stringify(caches_));

// still works offline
await ctx.setOffline(true);
await page.reload({ waitUntil: 'domcontentloaded' });
ok(await page.evaluate(() => document.title) === 'Defect Log' &&
   await page.isVisible('#bRec'), 'and it still loads with no network');
await ctx.setOffline(false);

await browser.close();
console.log(fails.length ? '\n' + fails.length + ' FAILED' : '\nall passed');
process.exit(fails.length ? 1 : 0);
