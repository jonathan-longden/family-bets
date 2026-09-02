import { chromium } from 'playwright';
import { CHROME } from './browser.mjs';
import { toCamera, openLog, openMap, rec } from './shellhelp.mjs';
import { settled } from './shellhelp.mjs';
import { openMenu, menuHas } from './shellhelp.mjs';

const B = 'http://127.0.0.1:8777/defects/';
const fails = [];
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails.push(m); };

// the camera is the app now: it comes up on its own, and only a refusal needs a tap
async function ensureLive(page) {
  if (await page.isVisible('#bStart')) await page.click('#bStart');
  await page.waitForFunction(() => document.getElementById('badge').textContent === 'Live',
    null, { timeout: 20000 });
}
// Capture is gone, so the survey is the only thing that writes an entry. This
// drives one real find through the loop rather than faking a row into the store.
async function surveyOne(page) {
  await toCamera(page);
  await settled(page);
  await page.evaluate(() => {
    window.__hits = [{ class: 'pothole', confidence: 0.9,
                       bbox: { x: 260, y: 240, width: 300, height: 260 } }];
    window.engine = { infer: () => Promise.resolve(window.__hits) };
    window.worker = 1;
    window.loadModel = () => Promise.resolve({});
  });
  await page.waitForFunction(() => document.getElementById('vid').videoWidth > 0);
  const before = await page.evaluate(() => S.items.length);
  await page.click('#bRec');
  await page.waitForFunction(n => S.items.length > n, before, { timeout: 20000 });
  await page.evaluate(() => { window.__hits = []; });
  await page.click('#bRec');
}
const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
         '--allow-file-access-from-files'],
});
const ctx = await browser.newContext({
  permissions: ['camera', 'geolocation'],
  geolocation: { latitude: 53.48012, longitude: -2.24261, accuracy: 8 },
  viewport: { width: 412, height: 915 },
});
await ctx.route('https://detect.roboflow.com/**', route => route.fulfill({
  status: 200, contentType: 'application/json',
  body: JSON.stringify({ image: { width: 640, height: 640 }, predictions: [] }) }));
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', e => errs.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });

await page.goto(B, { waitUntil: 'networkidle' });

// --- the app opens on the road, and stopping shows only what can be used ---
await page.waitForFunction(() => document.getElementById('badge').textContent === 'Live',
  null, { timeout: 20000 });
ok(!(await page.isVisible('#camGate')), 'no gate needed once it is up on its own');
ok(!(await page.isDisabled('#bRec')), 'recording is offered straight away');
await page.click('#bMenu'); await page.click('#bStop');
ok(await page.isVisible('#bStart'), 'stopping offers the start button again');
ok(await page.isDisabled('#bRec'), 'and takes recording away');
ok(!(await page.isVisible('#gpsBox')), 'and the gps readout with it');
await openLog(page);
ok(await page.isVisible('#empty'), 'empty log says so');
ok(!(await menuHas(page,'#bCsv')), 'csv export hidden over an empty log');
ok(!(await menuHas(page,'#bJson')), 'json export hidden over an empty log');
ok(!(await page.isVisible('#bClear')), 'clear hidden over an empty log');
await toCamera(page);
await ensureLive(page);

// --- camera + gps ---
ok(await page.textContent('#badge') === 'Live', 'camera opens');
await page.click('#bMenu');
await page.waitForFunction(() => document.getElementById('mLat').textContent !== '\u2014', null, { timeout: 8000 });
ok((await page.textContent('#mLat')).startsWith('53.480'), 'gps fix shown: ' + await page.textContent('#mLat'));
ok((await page.textContent('#mAcc')).includes('\u00b1'), 'accuracy shown: ' + await page.textContent('#mAcc'));
await page.click('#bMenu');

// --- a find, logged by the survey ---
await surveyOne(page);
await openLog(page);
ok(await page.textContent('#cnt') === '1', 'one entry logged');
ok(/survey, unconfirmed/.test(await page.textContent('.item .det')), 'and marked as nobody\'s judgement');

// --- confirming it ---
await page.click('.del.go');
await page.waitForSelector('#p-score:not([hidden])');
ok((await page.getAttribute('#prev', 'src') || '').startsWith('blob:'), 'the photograph is a blob url');
ok((await page.textContent('#fixNote')).includes('53.480'), 'location note states the coordinates');
ok(await page.getAttribute('#fixNote', 'class') === 'fixnote ok', 'good fix marked ok');

await page.click('.cell[data-i="4"][data-p="4"]');
ok(await page.textContent('#vScore') === '16', 'score 16');
ok(await page.textContent('#vCat') === 'Category 1', 'category 1 at 16');
await page.click('#segFoot');
ok(await page.getAttribute('#segFoot', 'aria-pressed') === 'true', 'surface can be switched');
await page.click('#segCar');
await page.click('.cell[data-i="4"][data-p="4"]');
await page.fill('#fNote', 'Oxford Rd, northbound lane 1, by the "bus" stop & shelter <test>');
await page.click('#bSave');
await page.waitForSelector('#p-log:not([hidden])', { timeout: 5000 });
const det = await page.textContent('.item .det');
ok(det.includes('inspector'), 'records who scored it');
ok(det.includes('53.48012'), 'coordinates recorded');
ok((await page.innerHTML('.item .det')).includes('&lt;test&gt;'), 'notes are escaped');
ok(await page.getAttribute('.item', 'class') === 'item k1', 'cat 1 stripe');

// --- confirming without a score is refused ---
await page.evaluate(async () => {
  const e = { id: nextId(), t: new Date().toISOString(), img: null,
    imp: 0, prob: 0, score: 0, cat: 'Below threshold', resp: 'No response category', key: 'k0',
    surface: 'Carriageway', scoredBy: 'survey, unconfirmed', type: 'Pothole', note: '',
    lat: null, lon: null, acc: null, fixAge: null };
  await putEntry(e); S.items.unshift(e); render();
});
await page.click('.del.go');
await page.waitForSelector('#p-score:not([hidden])');
page.once('dialog', d => d.accept());
await page.click('#bSave');
ok(await page.isVisible('#p-score'), 'an unscored confirm is refused');
await page.click('#xScore');
page.once('dialog', d => d.accept());
await page.click('.item .del.remove');
await page.waitForFunction(() => document.getElementById('cnt').textContent === '1');

// --- persistence across a reload: the whole point ---
await page.reload({ waitUntil: 'networkidle' });
await openLog(page);
ok(await page.textContent('#cnt') === '1', 'entry survives reload');
ok((await page.getAttribute('.item .thumb img', 'src') || '').startsWith('blob:'), 'photo survives reload');

// --- lightbox ---
await page.click('.item .thumb');
ok(await page.isVisible('#lb'), 'full size opens');
await page.click('#lbClose');
ok(!(await page.isVisible('#lb')), 'full size closes');

// --- exports ---
ok(await menuHas(page,'#bCsv') && await page.isVisible('#bClear'), 'export and clear appear once there is something to export');
const csvP = page.waitForEvent('download');
await openMenu(page); await page.click('#bCsv');
const d1 = await csvP;
const text = (await import('fs')).readFileSync(await d1.path(), 'utf8');
ok(text.charCodeAt(0) === 0xFEFF, 'csv has a BOM');
ok(text.split('\r\n')[0].includes('gps_fix_age_s'), 'csv header has fix age');
ok(text.includes('""bus""'), 'csv quotes escaped');
ok(text.includes('inspector'), 'csv carries who scored it');

const jsonP = page.waitForEvent('download');
await openMenu(page); await page.click('#bJson');
const d2 = await jsonP;
const parsed = JSON.parse((await import('fs')).readFileSync(await d2.path(), 'utf8'));
ok(Array.isArray(parsed.defects) && Array.isArray(parsed.notDefects),
   'json carries defects and corrections as two lists');
ok(parsed.defects.length === 1, 'the defect list has the entry');
ok(typeof parsed.defects[0].img === 'string' && parsed.defects[0].img.startsWith('data:image/jpeg;base64,'),
   'json carries the photo as a data url');
ok(parsed.defects[0].lat.toFixed(5) === '53.48012', 'json carries coordinates');

// --- a big log: what used to blow the localStorage quota ---
// Twelve real photographs in the store, which is the thing localStorage could
// not hold. Driving twelve survey finds would only prove the dedupe works.
await page.evaluate(async () => {
  const c = document.createElement('canvas'); c.width = 1280; c.height = 720;
  const x = c.getContext('2d');
  for (let i = 0; i < 12; i++) {
    x.fillStyle = 'hsl(' + (i * 30) + ',60%,40%)'; x.fillRect(0, 0, 1280, 720);
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.9));
    const e = { id: nextId() + i, t: new Date().toISOString(), img: blob,
      imp: 3, prob: 3, score: 9, cat: 'Category 2', resp: '28 calendar days', key: 'k2',
      surface: 'Carriageway', scoredBy: 'survey, unconfirmed', type: 'Pothole', note: '',
      lat: 53.48, lon: -2.24, acc: 7, fixAge: 1 };
    await putEntry(e); S.items.unshift(e);
  }
  render();
});
await openLog(page);
ok(await page.textContent('#cnt') === '13', 'thirteen entries held: ' + await page.textContent('#cnt'));
await page.reload({ waitUntil: 'networkidle' });
await openLog(page);
ok(await page.textContent('#cnt') === '13', 'thirteen entries survive a reload');
ok((await page.textContent('#saveNote')).includes('Using'), 'storage use reported');

// --- delete confirms ---
page.once('dialog', d => d.dismiss());
await page.click('.item .del.remove');
ok(await page.textContent('#cnt') === '13', 'a dismissed delete keeps the entry');
page.once('dialog', d => d.accept());
await page.click('.item .del.remove');
await page.waitForFunction(() => document.getElementById('cnt').textContent === '12');
ok(true, 'a confirmed delete removes it');

// --- stopping puts it back and drops the fix ---
await toCamera(page);
await ensureLive(page);
await page.click('#bMenu'); await page.click('#bStop');
ok(await page.isVisible('#bStart') && await page.isDisabled('#bRec'), 'stop restores the start button');
ok(!(await page.isVisible('#gpsBox')), 'gps readout goes with the camera');
ok(await page.evaluate(() => S.gps === null), 'the last fix is dropped, not left to tag the next find');

// the detection model cannot be fetched from this sandbox; the app reports that
// itself and the suite is about the shell, storage and export, not detection
const noise = errs.filter(e => !e.includes('Failed to load resource') &&
                               !/loading model|model metadata/i.test(e));
ok(noise.length === 0, 'no page errors' + (noise.length ? ': ' + noise.join(' | ') : ''));
await page.screenshot({ path: 'log.png', fullPage: false });
await toCamera(page);
await page.screenshot({ path: 'cap.png' });

await browser.close();
console.log(fails.length ? '\n' + fails.length + ' FAILED' : '\nall passed');
process.exit(fails.length ? 1 : 0);
