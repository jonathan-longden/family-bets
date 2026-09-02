import { chromium } from 'playwright';
import { CHROME } from './browser.mjs';
import { toCamera, openLog, openMap, rec } from './shellhelp.mjs';
import { settled } from './shellhelp.mjs';
import { openMenu, menuHas } from './shellhelp.mjs';
const B = 'http://127.0.0.1:8777/defects/';
const fails = [];
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails.push(m); };
// the camera comes up on its own now, so a start click is only sometimes needed
async function ensureLive(page) {
  if (await page.isVisible('#bStart')) await page.click('#bStart');
  await page.waitForFunction(() => document.getElementById('badge').textContent === 'Live',
    null, { timeout: 20000 });
}
const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
const ctx = await browser.newContext({ permissions: ['camera'], viewport: { width: 412, height: 915 } });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', e => errs.push(e.message));
page.on('dialog', d => d.accept());
await page.goto(B, { waitUntil: 'domcontentloaded' });
// read out of app.js rather than hard-coded: this line had to be edited on
// every build bump, which makes it a test that only ever cries wolf
const wantBuild = (await (await fetch(B + 'app.js')).text())
  .match(/var BUILD = '([^']+)'/)[1];
ok(await page.textContent('#build') === wantBuild,
   'the screen shows the build that is in app.js: ' + wantBuild);

// --- the vendored bundle is real and parses in a browser ---
const mod = await page.evaluate(async () => {
  try {
    const m = await import('./vendor/inference.es.js');
    return { ok: true, engine: typeof m.InferenceEngine, image: typeof m.CVImage,
             keys: Object.keys(m).length };
  } catch (e) { return { ok: false, err: String(e) }; }
});
ok(mod.ok, 'the vendored SDK imports in a browser' + (mod.ok ? '' : ': ' + mod.err));
ok(mod.engine === 'function', 'InferenceEngine is exported');
ok(mod.image === 'function', 'CVImage is exported');

// --- it can actually be constructed (spins up its worker) ---
const built = await page.evaluate(async () => {
  try {
    const m = await import('./vendor/inference.es.js');
    const e = new m.InferenceEngine();
    return { ok: true, hasStart: typeof e.startWorker === 'function', infer: typeof e.infer === 'function' };
  } catch (e) { return { ok: false, err: String(e) }; }
});
ok(built.ok && built.hasStart && built.infer,
   'the engine constructs and offers startWorker/infer' + (built.ok ? '' : ': ' + built.err));

// --- the proposal maths, driven directly, independent of the network ---
async function propose(share, count, footway) {
  return page.evaluate(([share, count, footway]) => {
    S.foot = footway;
    document.getElementById('segCar').setAttribute('aria-pressed', String(!footway));
    document.getElementById('segFoot').setAttribute('aria-pressed', String(footway));
    S.det = { conf: 0.87, share, count };
    paintProposal();
    return { score: document.getElementById('vScore').textContent,
             cat: document.getElementById('vCat').textContent,
             by: document.getElementById('vBy').textContent,
             scan: document.getElementById('scan').textContent };
  }, [share, count, footway]);
}
let r = await propose(0.04, 1, false);
ok(r.score === '4' && r.cat === 'Below threshold', 'small on a carriageway → 4, below threshold');
ok(/87% sure/.test(r.scan) && /small — 4% of the frame/.test(r.scan), 'and shows its working');
r = await propose(0.04, 1, true);
ok(r.score === '9' && r.cat === 'Category 2', 'same hole on a footway → 9, Category 2');
r = await propose(0.20, 1, false);
ok(r.score === '16' && r.cat === 'Category 1', 'large on a carriageway → 16, Category 1');
r = await propose(0.20, 3, false);
ok(r.score === '20' && /cluster/.test(r.scan), 'a cluster raises probability → 20');
r = await propose(0.005, 1, false);
ok(r.score === '1' && /barely registers/.test(r.scan), 'a speck proposes 1');
ok(/Proposed by the app/.test(r.by), 'marked as the app’s proposal');
const over = await page.evaluate(() => {
  document.querySelector('.cell[data-i="5"][data-p="5"]').click();
  return { score: document.getElementById('vScore').textContent,
           by: document.getElementById('vBy').textContent };
});
ok(over.score === '25' && /^Your score/.test(over.by), 'a tap still overrules it');

// --- the model cannot start from here (Roboflow is blocked), and it says so ---
await ensureLive(page);
await settled(page);
await page.waitForFunction(() => document.getElementById('vid').videoWidth > 0);
// the chip has already reported the boot fetch by now
ok(/No runtime|No weights|No model|Offline/.test(await page.textContent('#modelChip')),
   'the chip says the model could not be fetched on arrival');
await page.click('#bRec');
await page.waitForFunction(() => /unavailable/i.test(
  document.getElementById('hudState').textContent), null, { timeout: 90000 });
const t = await page.textContent('#hudToast');
ok(/Model unavailable/.test(await page.textContent('#hudState')),
   'and recording reports the same failure rather than watching nothing');
ok(!/would not load from this site/.test(t), 'and does not blame the vendored library, which loaded');
console.log('   \u2192 ' + t.replace(/\s+/g,' ').trim().slice(0, 170));
ok(await page.textContent('#hudCount') === '0 logged', 'and writes nothing down');
await page.click('#bRec');

// --- an accepted proposal is recorded as the app's, and reaches the CSV ---
// A survey find carries the app's score. Opening it and saving the cell
// untouched is accepting that proposal, and is recorded as exactly that.
await page.evaluate(async () => {
  const e = { id: nextId(), t: new Date().toISOString(), img: null,
    imp: 4, prob: 4, score: 16, cat: 'Category 1', resp: '1 working day', key: 'k1',
    surface: 'Carriageway', scoredBy: 'survey, unconfirmed',
    detConf: 0.87, detShare: 0.20, detCount: 1, type: 'Pothole', note: '',
    lat: 53, lon: -1.1, acc: 5, fixAge: 1 };
  await putEntry(e); S.items.unshift(e); render();
});
await openLog(page);
await page.click('.del.go');
await page.waitForSelector('#p-score:not([hidden])');
ok(await page.textContent('#vScore') === '16', 'a proposal is in place to accept');
await page.click('#bSave');
await page.waitForSelector('#p-log:not([hidden])');
const det = await page.textContent('.item .det');
ok(/app proposal, accepted/.test(det), 'an accepted proposal is recorded as the app\'s');
ok(/model 87% sure, 20% of frame/.test(det), 'along with what the model saw');
const dl = page.waitForEvent('download');
await openMenu(page); await page.click('#bCsv');
const csv = (await import('fs')).readFileSync(await (await dl).path(), 'utf8');
ok(/scored_by,model_confidence,model_share_of_frame,model_detections/.test(csv.split('\r\n')[0]),
   'the csv still carries the provenance columns');
ok(/app proposal, accepted/.test(csv), 'and the row says who scored it');

ok(errs.filter(e => !/inference|worker|loading model|model metadata/i.test(e)).length === 0,
   'no unrelated page errors' + (errs.length ? ': ' + errs.join(' | ').slice(0,200) : ''));
await browser.close();
console.log(fails.length ? '\n' + fails.length + ' FAILED' : '\nall passed');
process.exit(fails.length ? 1 : 0);
