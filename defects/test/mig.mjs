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

// a 1x1 jpeg, standing in for what the prototype wrote
const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+iiigD//2Q==';

// seed the old key exactly as the prototype left it, then load the app
await page.goto(B);
await page.evaluate(j => {
  localStorage.setItem('deflog', JSON.stringify([{
    id: 1755000000000, t: '2025-08-12T09:14:00.000Z', img: j,
    imp: 4, prob: 4, score: 16, cat: 'Category 1', resp: '1 working day', key: 'k1',
    surface: 'Carriageway', depth: 52, wide: true, type: 'Pothole',
    note: 'brought over from the old build', lat: 53.4, lon: -2.2, acc: 9
  }]));
}, JPEG);
await page.reload({ waitUntil: 'networkidle' });
await openLog(page);
await page.waitForFunction(() => document.getElementById('cnt').textContent === '1', null, { timeout: 5000 });
ok(true, 'the old entry is carried across');
const det = await page.textContent('.item .det');
ok(det.includes('52mm at deepest point (gauged)'), 'a depth gauged under the old build survives');
ok(det.includes('brought over from the old build'), 'its notes came with it');
ok(det.includes('53.40000, -2.20000'), 'its coordinates came with it');
ok((await page.getAttribute('.item .thumb img', 'src') || '').startsWith('blob:'), 'its photo became a blob');
ok(await page.evaluate(() => localStorage.getItem('deflog') === null), 'the old key is cleared once it is safe');
await page.reload({ waitUntil: 'networkidle' });
await openLog(page);
ok(await page.textContent('#cnt') === '1', 'and it is not imported twice');

// --- offline ---
await page.goto(B, { waitUntil: 'networkidle' });
await page.evaluate(() => navigator.serviceWorker.ready);
ok(await page.evaluate(() => !!navigator.serviceWorker.controller ||
   navigator.serviceWorker.getRegistration().then(r => !!r)), 'service worker registered');
await ctx.setOffline(true);
await page.reload({ waitUntil: 'domcontentloaded' });
ok(await page.evaluate(() => document.title) === 'Defect Log' &&
   await page.isVisible('#bRec'), 'the app loads with the network off');
await openLog(page);
ok(await page.textContent('#cnt') === '1', 'and the log is still there');
ok(await menuHas(page,'#bCsv'), 'and it can still export');
await ctx.setOffline(false);

await page.screenshot({ path: 'first.png' });
await browser.close();
console.log(fails.length ? '\n' + fails.length + ' FAILED' : '\nall passed');
process.exit(fails.length ? 1 : 0);
