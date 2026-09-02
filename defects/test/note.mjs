import { chromium } from 'playwright';
import { CHROME } from './browser.mjs';
import { toCamera, openLog, openMap, rec } from './shellhelp.mjs';
const B = 'http://127.0.0.1:8777/defects/';
const fails = [];
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails.push(m); };
const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
const live = p => p.waitForFunction(
  () => document.getElementById('badge').textContent === 'Live', null, { timeout: 20000 });

// --- location allowed: the primer is not in the way of a working camera ---
let ctx = await browser.newContext({
  permissions: ['camera', 'geolocation'],
  geolocation: { latitude: 52.998568, longitude: -1.14434, accuracy: 23 },
  viewport: { width: 412, height: 915 } });
let page = await ctx.newPage();
await page.goto(B, { waitUntil: 'domcontentloaded' });
await live(page);
ok(!(await page.isVisible('#camNote')), 'primer is gone once the camera is live');
await page.waitForFunction(() => document.getElementById('mLat').textContent !== '—');
ok(!(await page.isVisible('#camNote')), 'and stays gone with a fix');
await page.click('#bMenu'); await page.click('#bStop');   // it lives in the menu now
ok(await page.isVisible('#camNote'), 'primer returns when the camera stops');
ok((await page.textContent('#camNote')).includes('Before you start'), 'and it is the primer, not a stale error');
ok(await page.isDisabled('#bRec'), 'there is nothing to record with the camera off');
await page.click('#bStart');
await live(page);
ok(!(await page.isDisabled('#bRec')), 'and recording is possible again once it is back');

// --- location refused: the space says something useful instead ---
await ctx.close();
ctx = await browser.newContext({ permissions: ['camera'], viewport: { width: 412, height: 915 } });
page = await ctx.newPage();
await ctx.setGeolocation(null);
await page.goto(B, { waitUntil: 'domcontentloaded' });
await live(page);
await page.waitForFunction(() => document.getElementById('recTxt').textContent === 'GPS denied', null, { timeout: 25000 });
/* A refused location must not put a card over the road: the camera still
   works and the survey still runs, it just cannot say where. So it is said on
   the glass and the picture stays. */
ok(!(await page.isVisible('#camGate')), 'a refused location does not blank the viewfinder');
ok(await page.isVisible('#hudToast'), 'it is said over the picture instead');
ok((await page.textContent('#hudToast')).includes('no coordinates'),
   'and says what it means for the finds');
ok(!(await page.isVisible('#gpsBox')), 'the empty coordinate readout is not left behind');

await browser.close();
console.log(fails.length ? '\n' + fails.length + ' FAILED' : '\nall passed');
process.exit(fails.length ? 1 : 0);
