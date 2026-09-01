// The built-in what3words key is public and cannot be made otherwise from a
// static page. What the app can do is spend it only on the site it belongs to,
// say plainly which of the three states it is in, and never break the lookups
// for someone who brings their own key. That is what this checks.
//
// The suite runs on 127.0.0.1, which is deliberately NOT the production host,
// so the default here is the off-site case.
import { chromium } from 'playwright';
import { CHROME } from './browser.mjs';
import { openLog, settled } from './shellhelp.mjs';
const B = 'http://127.0.0.1:8777/defects/';
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

// every what3words call is intercepted, so nothing here spends a real quota
const calls = [];
await ctx.route('https://api.what3words.com/**', route => {
  calls.push(route.request().url());
  route.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ words: 'filled.count.soap' }) });
});

await page.goto(B, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.getElementById('badge').textContent === 'Live',
  null, { timeout: 15000 });
await settled(page);

// --- off its own site, the built-in key is not used ---
ok(await page.evaluate(() => w3wOwnSite()) === false,
   '127.0.0.1 is not the site the key belongs to');
ok(await page.evaluate(() => w3wKey()) === '',
   'so no key is used, rather than this account’s');
ok(await page.evaluate(() => W3W_DEFAULT.length > 0),
   'the key is still in the source, because it has to be — this is a mitigation, not a fix');

await openLog(page);
const state = await page.textContent('#w3wState');
ok(/No key, so no lookups/.test(state), 'and the log says so: ' + state.slice(0, 70));
ok(/does not spend that account/.test(state), 'and why');
const warn = await page.textContent('#w3wBox .warnhint');
ok(/not a secret/i.test(warn) && /restrict the key/i.test(warn),
   'with the honest statement of what the key is and where the real protection lives');

// --- a find still gets logged, just without an address ---
await page.evaluate(async () => {
  await putEntry({ id: 11, t: new Date().toISOString(), img: null, imp: 2, prob: 2, score: 4,
    priority: 'P4', key: 'p4', cat: null, resp: null, surface: 'Carriageway',
    scoredBy: 'survey, unconfirmed', type: 'Pothole', note: '',
    lat: 53.0, lon: -1.1, acc: 8, fixAge: 0 });
  S.items = await allEntries(); render();
  addWords(S.items[0]);
});
await page.waitForTimeout(1200);
ok(calls.length === 0, 'no lookup is attempted with no key: ' + calls.length + ' calls');
ok(/53\.00000, -1\.10000/.test(await page.textContent('.item')),
   'and the entry keeps its coordinates, which is what it was always going to export');

// --- paste a key and the lookups come back, on any host ---
await page.fill('#w3wKey', 'MYOWNKEY');
await page.dispatchEvent('#w3wKey', 'change');
ok(/Using the key you pasted/.test(await page.textContent('#w3wState')),
   'a pasted key is used and named as yours');
await page.evaluate(async () => {
  const it = S.items[0]; delete it.w3w;
  addWords(it);
});
await page.waitForFunction(() => /filled\.count\.soap/.test(document.body.textContent),
  null, { timeout: 10000 });
ok(calls.length === 1, 'exactly one lookup was made');
ok(/key=MYOWNKEY/.test(calls[0]), 'with the pasted key, not the built-in one: ' +
   calls[0].replace(/coordinates=[^&]*/, 'coordinates=…'));
ok(!calls[0].includes('GNB4B5O7'), 'and the built-in key never left the page');

// --- clearing the field is a decision and stays one ---
await page.fill('#w3wKey', '');
await page.dispatchEvent('#w3wKey', 'change');
ok(/Lookups are off/.test(await page.textContent('#w3wState')),
   'an emptied field turns lookups off rather than reverting');
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => typeof w3wKey === 'function');
ok(await page.evaluate(() => w3wKey()) === '', 'and it survives a reload');

// --- on the site the key belongs to, nothing changed ---
const own = await page.evaluate(() => {
  const was = W3W_HOSTS.slice();
  W3W_HOSTS.length = 0; W3W_HOSTS.push(location.hostname);   // stand in for the real host
  try { localStorage.removeItem('deflog.w3w'); } catch (e) {}
  const k = w3wKey();
  W3W_HOSTS.length = 0; was.forEach(h => W3W_HOSTS.push(h));
  return k;
});
ok(own === 'GNB4B5O7', 'on its own site the built-in key is used exactly as before');

// --- and the diagnostics screen says which, without printing it ---
await page.goto(B, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => typeof diagLines === 'function');
const diag = await page.evaluate(() => diagLines());
ok(/what3words/.test(diag), 'diagnostics reports the key state');
ok(!diag.includes('GNB4B5O7'), 'and does not print the key itself');

console.log(fails.length ? '\n' + fails.length + ' FAILED' : '\nall passed');
await browser.close();
process.exit(fails.length ? 1 : 0);
