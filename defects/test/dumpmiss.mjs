// Prints one miss-analysis report. Not an assertion suite — a way to read what
// the tool actually says, so assertions can be written against the real text.
import { chromium } from 'playwright';
import { CHROME, BASE, FIXTURES } from './browser.mjs';
import { settled } from './shellhelp.mjs';
import { join } from 'path';

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
const ctx = await browser.newContext({
  permissions: ['camera', 'geolocation'],
  geolocation: { latitude: 53, longitude: -1.1, accuracy: 8 },
  viewport: { width: 844, height: 390 } });
const page = await ctx.newPage();
await ctx.route('**/shard*.bin', r => r.fulfill({ status: 200, body: Buffer.alloc(1024) }));
await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.getElementById('badge').textContent === 'Live',
  null, { timeout: 15000 });
await settled(page);
await page.waitForFunction(() => !!(window.tf && window.benchTf), null, { timeout: 90000 });
await page.evaluate(async () => { await tf.setBackend('cpu'); await tf.ready(); });

await page.evaluate(() => {
  const N = 8400, C = 6;
  const buf = new Float32Array(N * C);
  for (let a = 0; a < N; a++) {
    buf[a] = 320; buf[N + a] = 320; buf[2 * N + a] = 20; buf[3 * N + a] = 16;
    buf[4 * N + a] = 0.001; buf[5 * N + a] = 0.001;
  }
  const put = (a, x, y, w, h, man, pot) => {
    buf[a] = x; buf[N + a] = y; buf[2 * N + a] = w; buf[3 * N + a] = h;
    buf[4 * N + a] = man; buf[5 * N + a] = pot;
  };
  put(4211, 311, 387, 56, 49, 0.02, 0.5351);
  put(100, 100, 100, 30, 24, 0.01, 0.42);
  put(300, 500, 420, 60, 50, 0.77, 0.08);
  window.infSession = { tf, backend: 'cpu',
    model: { execute: () => tf.tensor(buf, [1, C, N], 'float32') } };
  window.rfMeta = { classes: ['manhole', 'pothole'] };
});

if (await page.isVisible('#menu')) await page.click('#bMenu');
await page.click('#bMenu'); await page.click('#mDiag');
await page.waitForSelector('#p-diag:not([hidden])');
await page.setInputFiles('#missFile', join(FIXTURES, 'pothole-fixture.png'));
await page.waitForFunction(() => /MISS ANALYSIS/.test(
  document.getElementById('frameText').textContent), null, { timeout: 90000 });
console.log(await page.textContent('#frameText'));
await browser.close();
