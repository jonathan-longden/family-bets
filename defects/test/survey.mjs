import { chromium } from 'playwright';
import { CHROME } from './browser.mjs';
import { toCamera, openLog, openMap, rec } from './shellhelp.mjs';
import { settled } from './shellhelp.mjs';
import { openMenu, menuHas } from './shellhelp.mjs';
const B = 'http://127.0.0.1:8777/defects/';
const fails = [];
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails.push(m); };
const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
const ctx = await browser.newContext({
  permissions: ['camera', 'geolocation'],
  geolocation: { latitude: 53.0, longitude: -1.1, accuracy: 8 },
  viewport: { width: 844, height: 390 } });          // landscape, phone-sized
const page = await ctx.newPage();
page.on('dialog', d => d.accept());
await page.goto(B, { waitUntil: 'domcontentloaded' });
// read out of app.js rather than hard-coded: this line had to be edited on
// every build bump, which makes it a test that only ever cries wolf
const wantBuild = (await (await fetch(B + 'app.js')).text())
  .match(/var BUILD = '([^']+)'/)[1];
ok(await page.textContent('#build') === wantBuild,
   'the screen shows the build that is in app.js: ' + wantBuild);

// --- the camera comes up without being asked ---
await page.waitForFunction(() => document.getElementById('badge').textContent === 'Live', null, { timeout: 15000 });
ok(true, 'camera starts on its own');
ok(!(await page.isVisible('#camGate')), 'no gate in the way once it is live');
ok(await page.isVisible('#bRec') && !(await page.isDisabled('#bRec')),
   'the record button is ready');

// --- stub the model so the loop can be driven without the network ---
await settled(page);
await page.evaluate(() => {
  window.__hits = [];                              // what the next look will "see"
  window.engine = { infer: () => Promise.resolve(window.__hits) };
  window.worker = 1;
  window.loadModel = () => Promise.resolve({});
});
await page.waitForFunction(() => document.getElementById('vid').videoWidth > 0);

const hit = (conf = 0.9) => [{ class: 'pothole', confidence: conf,
  bbox: { x: 100, y: 100, width: 128, height: 128 } }];   // 4% of the photograph

await rec(page);
ok(await page.getAttribute('#bRec', 'aria-pressed') === 'true', 'the button reads as recording');
const box = await page.locator('#vid').boundingBox();
ok(box.width >= 840 && box.height >= 388, 'the viewfinder fills the viewport: ' + JSON.stringify(box));
ok(await page.isVisible('#hudState'), 'the survey says what it is doing');
ok(/^\d\d:\d\d$/.test(await page.textContent('#recTime')), 'and how long it has been running');

// --- a find gets written down on its own ---
await page.evaluate(h => { window.__hits = h; }, hit());
await page.waitForFunction(() => document.getElementById('hudCount').textContent === '1 logged', null, { timeout: 15000 });
ok(true, 'a defect is logged with nobody asking');
// A 128px box is 4% of the photograph — the "small" band. Share is the fraction
// of the PHOTOGRAPH under every preprocessing this app has shipped, which is why
// this number has survived a letterbox and a crop and come back unchanged.
ok(/Logged pothole — P4, lowest \(90% sure\)/.test(await page.textContent('#hudToast')),
   'scored by the same rules as a deliberate capture: ' + await page.textContent('#hudToast'));
ok(/Not classified/.test(await page.textContent('#hudToast')),
   'and that nothing has been classified');

// --- the same defect is not logged fifty times ---
await new Promise(r => setTimeout(r, 5000));
ok(await page.textContent('#hudCount') === '1 logged',
   'the same defect in later frames is not logged again (' + await page.textContent('#hudCount') + ')');
ok(/Same defect/.test(await page.textContent('#hudState')), 'and it says why');

// --- move down the road: a new one is logged ---
await ctx.setGeolocation({ latitude: 53.0009, longitude: -1.1, accuracy: 8 });  // ~100m
await page.waitForFunction(() => document.getElementById('hudCount').textContent === '2 logged', null, { timeout: 20000 });
ok(true, 'a defect 100m down the road is logged as a new one');

// --- a big one down the road scores accordingly ---
await page.evaluate(() => { window.__hits = [{ class: 'pothole', confidence: 0.9,
  bbox: { x: 300, y: 280, width: 350, height: 320 } }]; });   // 27% → very large
await ctx.setGeolocation({ latitude: 53.0018, longitude: -1.1, accuracy: 8 });
await page.waitForFunction(() => document.getElementById('hudCount').textContent === '3 logged', null, { timeout: 20000 });
ok(/Logged pothole — P1/.test(await page.textContent('#hudToast')),
   'a large find gets the top app priority, not a statutory category: ' +
   await page.textContent('#hudToast'));
ok(!/hours|working day|calendar days|Category|Emergency/.test(await page.textContent('#hudToast')),
   'and no statutory language reaches the screen');

// --- below the survey threshold, nothing is logged ---
await page.evaluate(h => { window.__hits = h; }, hit(0.45));
await ctx.setGeolocation({ latitude: 53.0020, longitude: -1.1, accuracy: 8 });
await new Promise(r => setTimeout(r, 4000));
ok(await page.textContent('#hudCount') === '3 logged', 'an unsure find is not logged unattended');

// --- a find the shadow test throws out is not logged ---
await page.evaluate(() => {
  window.__realReject = window.rejectReason;
  window.rejectReason = () => 'darker than the road around it but grained exactly like it — a shadow, not a hole';
  window.__hits = [{ class: 'pothole', confidence: 0.95, bbox: { x: 400, y: 300, width: 500, height: 400 } }];
});
await ctx.setGeolocation({ latitude: 53.0040, longitude: -1.1, accuracy: 8 });
await page.waitForFunction(() => /Shadow, not a defect/.test(document.getElementById('hudState').textContent),
  null, { timeout: 15000 });
ok(true, 'a shadow is recognised and said so on the HUD');
await new Promise(r => setTimeout(r, 3000));
ok(await page.textContent('#hudCount') === '3 logged', 'and nothing was written down for it');
await page.evaluate(() => { window.rejectReason = window.__realReject; window.__hits = []; });

// --- ending puts the app back ---
await page.evaluate(() => { window.__hits = []; });
await page.click('#bRec');
ok(await page.getAttribute('#bRec', 'aria-pressed') === 'false', 'the button reads as stopped');
ok(!(await page.isVisible('#hudState')), 'and the running state goes with it');
ok(await page.textContent('#recTime') === 'Ready', 'the clock resets');

// --- what landed in the log ---
await openLog(page);
const det = await page.textContent('.item .det');
ok(/survey, unconfirmed/.test(det), 'entries are marked as unconfirmed survey finds');
ok(/model 90% sure/.test(det), 'with what the model saw');
ok(/53\.\d{5}, -1\.10000 \(±8m\)/.test(det), 'and where it was: ' +
   (det.match(/5[0-9.]+, -1\.\d+ \(±\d+m\)/) || ['none'])[0]);
const allCoords = await page.$$eval('.item .det', ns => ns.map(n => (n.textContent.match(/53\.\d{5}/) || [''])[0]));
ok(new Set(allCoords).size === 3, 'each find carries its own position: ' + allCoords.join(' '));
ok(await page.textContent('#cnt') === '3', 'all three are in the log');
const dl = page.waitForEvent('download');
await openMenu(page); await page.click('#bCsv');
const csv = (await import('fs')).readFileSync(await (await dl).path(), 'utf8');
ok((csv.match(/survey, unconfirmed/g) || []).length === 3, 'and all say so in the CSV');

// --- marking a mistake keeps it as a correction rather than binning it ---
await openLog(page);
const before = +(await page.textContent('#cnt'));
await page.click('.item .wrong');
await page.waitForFunction(n => document.getElementById('cnt').textContent === String(n - 1),
  before, { timeout: 10000 });
ok(true, 'a marked entry leaves the log');
// #cnt is updated synchronously by render(); #wrongCount is filled from
// allWrong(), an async read of the store. Waiting on the first and asserting on
// the second is a race, and it is the machine's load rather than the app that
// decides who wins — so wait for the thing being asserted.
await page.waitForFunction(
  () => /1 correction kept/.test(document.getElementById('wrongCount').textContent),
  null, { timeout: 10000 }).catch(() => {});
{
  const txt = (await page.textContent('#wrongCount') || '').trim();
  const hidden = await page.getAttribute('#wrongCount', 'hidden');
  const n = await page.evaluate(() => allWrong().then(w => w.length));
  ok(/1 correction kept/.test(txt),
     'and is kept as a correction: ' + JSON.stringify(txt.slice(0, 60)) +
     ' hidden=' + hidden + ' store=' + n);
}

// --- a slow, stale read must not paint over a fresh one ---
//
// quota() runs on every render and paints the corrections count from an async
// read of the store. Two renders close together leave two reads in flight, and
// nothing made them land in the order they were started — so an older answer
// could arrive last and put "0 corrections kept" on screen, hidden, while the
// store held one and the export carried it. Always possible; it became likely
// once a closer look started re-rendering the log mid-survey.
{
  await page.evaluate(() => {
    window.__realAllWrong = window.allWrong;
    let call = 0;
    window.allWrong = function () {
      call++;
      // first call: the OLD answer, and slow. second: the new one, immediately.
      if (call === 1) return new Promise(r => setTimeout(() => r([]), 500));
      return Promise.resolve([{ id: 'x' }]);
    };
    render();     // starts the slow, stale read
    render();     // starts the fresh one, which answers first
  });
  await page.waitForTimeout(900);        // well past the slow one landing
  const txt = (await page.textContent('#wrongCount') || '').trim();
  ok(/1 correction kept/.test(txt),
     'the stale read does not overwrite the fresh one: ' + JSON.stringify(txt.slice(0, 40)));
  ok(await page.getAttribute('#wrongCount', 'hidden') === null,
     'and it is not hidden by the answer that arrived late');
  await page.evaluate(() => { window.allWrong = window.__realAllWrong; render(); });
}
const dl2 = page.waitForEvent('download');
await openMenu(page); await page.click('#bJson');
const j = JSON.parse((await import('fs')).readFileSync(await (await dl2).path(), 'utf8'));
ok(Array.isArray(j.defects) && Array.isArray(j.notDefects), 'the export carries both lists');
ok(j.notDefects.length === 1, 'with the correction in it');
ok(typeof j.notDefects[0].img === 'string' && j.notDefects[0].img.startsWith('data:image/'),
   'and its photograph, which is what a retrain needs');
ok(j.notDefects[0].markedWrongAt, 'and when it was marked');
ok(j.defects.length === before - 1, 'and the defect list no longer contains it');

// --- entries survive, being real records ---
await page.reload({ waitUntil: 'domcontentloaded' });
await openLog(page);
ok(await page.textContent('#cnt') === '2', 'the remaining finds survive a reload');
ok(/1 correction kept/.test(await page.textContent('#wrongCount')), 'and so does the correction');

await browser.close();
console.log(fails.length ? '\n' + fails.length + ' FAILED' : '\nall passed');
process.exit(fails.length ? 1 : 0);
