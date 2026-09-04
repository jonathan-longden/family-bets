// The photograph, and which look it comes from.
//
// Two faults, reported together from a van: the picture was taken "either after
// or way before the defect".
//
// AFTER — the JPEG was drawn straight off the live <video> AFTER inference
// returned, while t, the fix and detBox all described the frame the model was
// actually shown. On WASM that is ~533 ms, seven metres at 30 mph; on the CPU
// fallback it is seventeen seconds. The photograph disagreed with everything
// filed beside it. It is now drawn at the same instant as the square that goes
// to the model.
//
// WAY BEFORE — a defect is first detected at the far end of what the camera can
// resolve, and the duplicate rule then suppressed every closer look at it, so
// the entry kept was always the most distant one available. A closer look now
// REPLACES the entry: same row, same defect, better photograph.
import { chromium } from 'playwright';
import { CHROME } from './browser.mjs';
import { settled, rec } from './shellhelp.mjs';
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
await page.goto(B, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.getElementById('badge').textContent === 'Live',
  null, { timeout: 15000 });
await settled(page);

// The model, stubbed — and instrumented so the ORDER of the two things that
// matter is recorded: drawing the photograph, and running inference.
await page.evaluate(() => {
  window.__order = [];
  const cx = document.getElementById('shot').getContext('2d');
  const orig = cx.drawImage.bind(cx);
  cx.drawImage = function () { window.__order.push('shot'); return orig.apply(null, arguments); };
  window.__hits = [];
  window.engine = {
    // Deliberately slow, the way a real backend is. If the photograph were
    // still grabbed afterwards, it would be 300 ms of road further on.
    infer: () => {
      window.__order.push('infer');
      return new Promise(r => setTimeout(() => r(window.__hits), 300));
    }
  };
  window.worker = 1;
  window.loadModel = () => Promise.resolve({});
});
await page.waitForFunction(() => document.getElementById('vid').videoWidth > 0);

// A box of `px` square in the 640 square. Bigger box = nearer the same defect.
const hit = (px) => [{ class: 'pothole', confidence: 0.9,
  bbox: { x: 100, y: 100, width: px, height: px } }];

const entry = () => page.evaluate(() => {
  const e = S.items[0];
  return e && { id: e.id, share: e.detShare, box: e.detBox, t: e.t,
                storedAt: e.storedAt, imgSize: e.img && e.img.size,
                defect_id: e.defect_id, scoredBy: e.scoredBy, priority: e.priority };
});

await rec(page);

// ============================ 1. the photograph is the frame that was inferred
{
  await page.evaluate(h => { window.__hits = h; }, hit(128));
  await page.waitForFunction(() => document.getElementById('hudCount').textContent === '1 logged',
    null, { timeout: 20000 });
  const order = await page.evaluate(() => window.__order.join(','));
  ok(/^shot,infer/.test(order),
     'the photograph is drawn before inference runs, not after it: ' + order.slice(0, 40));
  ok(!/infer,infer/.test(order),
     'and once per look — every inference has its own frame in front of it');
  const src = await (await fetch(B + 'app.js')).text();
  ok(!/c\.getContext\('2d'\)\.drawImage\(v,/.test(src.replace(/\/\*[\s\S]*?\*\//g, '')),
     'nothing grabs the live video again after inference');
}

// ================================ 2. a closer look replaces, it does not add
const first = await entry();
{
  // Share is measured against the PICTURE since build 55, not against the
  // padded square — so a stubbed 128px box in the 640 square now reads 0.071
  // where it read 0.040. That is an artefact of stubbing a fixed box: a real
  // object shrinks by exactly the padding ratio at the same time, and its share
  // is unchanged. preproc.mjs proves that invariance directly, which is what
  // keeps priority bands comparable across this build.
  ok(first && first.share > 0.03 && first.share < 0.05,
     'the first, distant look is on the row: share ' + (first && first.share));
  ok(first.id != null, 'and the row has an id the survey can find again');

  await page.evaluate(h => { window.__hits = h; }, hit(256));   // 16% — nearer
  await page.waitForFunction(
    () => /Closer look kept/.test(document.getElementById('hudToast').textContent),
    null, { timeout: 20000 });
  const now = await entry();
  ok(await page.textContent('#hudCount') === '1 logged',
     'still one entry, not two: ' + await page.textContent('#hudCount'));
  ok(now.id === first.id, 'the same row, kept: ' + now.id + ' vs ' + first.id);
  ok(now.share > first.share,
     'carrying the closer look: share ' + first.share + ' → ' + now.share);
  ok(now.box.w === 256, 'and the box that goes with it: ' + JSON.stringify(now.box));
  ok(now.t !== first.t, 'stamped when the closer frame was taken, not the first');
  ok(now.defect_id && now.defect_id === first.defect_id,
     'still an observation of the same defect: ' + now.defect_id);
  ok(now.priority !== first.priority,
     'and re-scored from the better look: ' + first.priority + ' → ' + now.priority);
}

// ================================= 3. a further-off look does not replace it
{
  const before = await entry();
  await page.evaluate(h => { window.__hits = h; }, hit(160));   // smaller again
  await page.waitForFunction(
    () => /not logged again/.test(document.getElementById('hudState').textContent),
    null, { timeout: 20000 });
  const after = await entry();
  ok(after.share === before.share,
     'a look from further away leaves the closer one alone: ' + after.share);
  ok(after.t === before.t, 'photograph and stamp both untouched');
  ok(await page.textContent('#hudCount') === '1 logged', 'and still one entry');
}

// ===================== 4. an entry a person has touched is never overwritten
{
  await page.evaluate(() => { S.items[0].scoredBy = 'someone who looked at it'; });
  const before = await entry();
  await page.evaluate(h => { window.__hits = h; }, hit(420));   // much nearer
  await page.waitForFunction(
    () => /already looked at, left alone/.test(document.getElementById('hudState').textContent),
    null, { timeout: 20000 });
  const after = await entry();
  ok(after.share === before.share,
     'a scored entry is not overwritten by a better photograph: ' + after.share);
  ok(after.scoredBy === 'someone who looked at it', 'and keeps what the person put on it');
  ok(await page.textContent('#hudCount') === '1 logged',
     'nor is a second row written instead');
}

// ================= 5. a different defect down the road is still its own row
{
  await page.evaluate(() => { S.items[0].scoredBy = 'survey, unconfirmed'; });
  await ctx.setGeolocation({ latitude: 53.0009, longitude: -1.1, accuracy: 8 });  // ~100 m
  await page.evaluate(h => { window.__hits = h; }, hit(128));
  await page.waitForFunction(() => document.getElementById('hudCount').textContent === '2 logged',
    null, { timeout: 25000 });
  ok(true, 'a defect down the road is still logged as a new one');
  const ids = await page.evaluate(() => S.items.map(e => e.id));
  ok(new Set(ids).size === ids.length, 'and no row was duplicated: ' + JSON.stringify(ids));
}

await ctx.close();
console.log(fails.length ? '\n' + fails.length + ' FAILED' : '\nall passed');
await browser.close();
process.exit(fails.length ? 1 : 0);
