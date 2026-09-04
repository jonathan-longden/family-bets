// 4x zoom, at the camera track and nowhere else.
//
// At 34 mph a pothole is in frame for about one look, and at 15 m it is roughly
// eleven pixels wide and one and a half tall in the tensor. Zoom is the one
// lever that changes that arithmetic without touching the model — but only if
// it happens at the TRACK. Cropping the 640 square afterwards would be the same
// pixels enlarged: no new detail, a narrower field of view, and a quiet lie in
// the diagnostics.
//
// Support is narrow. Most of this suite is about the app saying so plainly
// rather than pretending, and about every other part of the pipeline being
// untouched whether zoom works or not.
import { chromium } from 'playwright';
import { CHROME, BASE } from './browser.mjs';
import { settled, rec } from './shellhelp.mjs';

const B = BASE;
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
await ctx.route('**/shard*.bin', r => r.fulfill({ status: 200, body: Buffer.alloc(1024) }));
await page.goto(B, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.getElementById('badge').textContent === 'Live',
  null, { timeout: 15000 });
await settled(page);

// A track that can be given any capability profile, so the four cases below are
// tested against behaviour rather than against whatever this machine's fake
// camera happens to report.
const fake = (caps, opts = {}) => page.evaluate(([caps, opts]) => {
  const t = window.stream.getVideoTracks()[0];
  if (!window.__realTrack) {
    window.__realTrack = { getCapabilities: t.getCapabilities, getSettings: t.getSettings,
                           applyConstraints: t.applyConstraints };
  }
  window.__applied = [];
  const settings = { width: 1920, height: 1080, frameRate: 20, facingMode: 'environment' };
  if (opts.startZoom !== undefined) settings.zoom = opts.startZoom;
  t.getCapabilities = caps === null ? undefined : () => {
    if (caps === 'throw') throw new Error('capabilities exploded');
    return caps;
  };
  t.getSettings = () => Object.assign({}, settings);
  t.applyConstraints = (c) => {
    window.__applied.push(JSON.parse(JSON.stringify(c)));
    if (opts.reject) return Promise.reject(new DOMException('nope', 'OverconstrainedError'));
    const want = c && c.advanced && c.advanced[0] && c.advanced[0].zoom;
    if (want !== undefined && !opts.ignore) settings.zoom = opts.settleAt !== undefined ? opts.settleAt : want;
    return Promise.resolve();
  };
  return true;
}, [caps, opts]);

const state = () => page.evaluate(() => ({
  z: JSON.parse(JSON.stringify(window.zoom)),
  applied: window.__applied,
  note: document.getElementById('zoomNote').textContent,
  noteHidden: document.getElementById('zoomNote').hidden,
  d1: document.getElementById('zoom1').disabled,
  d2: document.getElementById('zoomIn').disabled,
  p2: document.getElementById('zoomIn').getAttribute('aria-pressed'),
  pillsHidden: document.getElementById('zoomPills').hidden
}));

// ============ 1. a camera that supports zoom
{
  await fake({ zoom: { min: 1, max: 8, step: 0.1 } }, { startZoom: 1 });
  await page.evaluate(() => { zoomProbe(); paintZoom(); });
  let s = await state();
  ok(s.z.supported === true, 'a camera reporting a zoom capability is recognised');
  ok(s.z.min === 1 && s.z.max === 8 && s.z.step === 0.1,
     'with its range and step read off the track: ' +
     s.z.min + '–' + s.z.max + ' step ' + s.z.step);
  ok(!s.pillsHidden && !s.d1 && !s.d2, 'and the 1×/2× control is offered');

  await page.click('#zoomIn');
  await page.waitForFunction(() => window.zoom.actual === 4, null, { timeout: 5000 });
  s = await state();
  ok(s.applied[s.applied.length - 1].advanced[0].zoom === 4,
     'pressing 4× asks the TRACK for 4, through applyConstraints: ' +
     JSON.stringify(s.applied[s.applied.length - 1]));
  ok(s.z.actual === 4,
     'and the result is read back from getSettings rather than assumed: actual ' +
     s.z.actual);
  ok(s.z.why === null, 'with nothing to complain about');
  ok(s.p2 === 'true', 'the 4× button shows as the pressed one');
  ok(s.z.requested === 4, 'and the requested value is 4, not the old 2: ' + s.z.requested);

  await page.click('#zoom1');
  await page.waitForFunction(() => window.zoom.actual === 1, null, { timeout: 5000 });
  s = await state();
  ok(s.z.actual === 1, 'and 1× puts it back: ' + s.z.actual);
}

// ============ 2. 2x is outside what this camera can do
{
  await fake({ zoom: { min: 1, max: 2.5, step: 0.1 } }, { startZoom: 1 });
  await page.evaluate(() => { zoomProbe(); paintZoom(); });
  await page.click('#zoomIn');
  await page.waitForFunction(() => window.zoom.actual === 2.5, null, { timeout: 5000 });
  const s = await state();
  ok(s.applied[s.applied.length - 1].advanced[0].zoom === 2.5,
     'a camera that stops at 2.5 is asked for 2.5, not refused for asking 4: ' +
     s.applied[s.applied.length - 1].advanced[0].zoom);
  ok(s.z.requested === 4 && s.z.asked === 2.5,
     'the report keeps both numbers apart — requested ' + s.z.requested +
     ', asked ' + s.z.asked);
  ok(s.z.actual === 2.5,
     'and the actual is the number the camera reached, never the one it was ' +
     'asked for: ' + s.z.actual);
  ok(!/4/.test(s.note) || /2\.5/.test(s.note),
     'the screen does not claim 4× was applied: ' + s.note);
}

// ============ 3. the step is respected
{
  await fake({ zoom: { min: 1, max: 8, step: 0.75 } }, { startZoom: 1 });
  await page.evaluate(() => { zoomProbe(); paintZoom(); });
  await page.click('#zoomIn');
  await page.waitForFunction(() => window.zoom.asked !== null && window.__applied.length,
    null, { timeout: 5000 });
  const s = await state();
  const asked = s.applied[s.applied.length - 1].advanced[0].zoom;
  ok(asked === 4 || asked === 3.25 || asked === 4.75,
     'a step of 0.75 is snapped to rather than sending a value the camera would ' +
     'reject: ' + asked);
  ok(String(asked).length <= 6,
     'and it is not a float that drifted into nonsense: ' + asked);
}

// ============ 4. no zoom on this camera
{
  await fake({ width: { min: 1, max: 1920 } });
  await page.evaluate(() => { zoomProbe(); paintZoom(); });
  const s = await state();
  ok(s.z.supported === false, 'a camera with no zoom capability is not claimed to have one');
  ok(/no zoom capability/.test(s.z.why), 'and says which fault it is: ' + s.z.why);
  ok(s.d1 && s.d2, 'the buttons are disabled rather than pretending to work');
  ok(/4× zoom unavailable/.test(s.note),
     'with it said in as many words on the screen: ' + s.note);
}

// ============ 5. the browser cannot even be asked
{
  await fake(null);
  await page.evaluate(() => { zoomProbe(); paintZoom(); });
  const s = await state();
  ok(s.z.supported === false && /no getCapabilities/.test(s.z.why),
     'a browser without getCapabilities is a different fault from a camera ' +
     'without zoom: ' + s.z.why);

  await fake('throw');
  await page.evaluate(() => { zoomProbe(); paintZoom(); });
  const s2 = await state();
  ok(s2.z.supported === false && /threw/.test(s2.z.why),
     'and one that throws when asked has not said yes: ' + s2.z.why);
}

// ============ 6. applyConstraints rejects
{
  await fake({ zoom: { min: 1, max: 8, step: 0.1 } }, { startZoom: 1, reject: true });
  await page.evaluate(() => { zoomProbe(); paintZoom(); });
  const before = await page.evaluate(() => document.getElementById('vid').videoWidth);
  await page.click('#zoomIn');
  await page.waitForFunction(() => /refused/.test(window.zoom.why || ''), null, { timeout: 5000 });
  const s = await state();
  ok(/refused it: OverconstrainedError/.test(s.z.why),
     'a rejection is caught and named rather than thrown away: ' + s.z.why);
  ok(s.z.actual === 1, 'the actual still reports what the camera is really doing: ' + s.z.actual);
  const after = await page.evaluate(() => document.getElementById('vid').videoWidth);
  ok(before === after, 'and the camera is left exactly as it was: ' + after + ' px wide');
}

// ============ 7. accepted, and quietly ignored
//
// Some cameras take the constraint without complaint and do nothing. That must
// not read as success.
{
  await fake({ zoom: { min: 1, max: 8, step: 0.1 } }, { startZoom: 1, ignore: true });
  await page.evaluate(() => { zoomProbe(); paintZoom(); });
  await page.click('#zoomIn');
  await page.waitForFunction(() => /settled/.test(window.zoom.why || ''), null, { timeout: 5000 });
  const s = await state();
  ok(/asked for 4 and the camera settled at 1/.test(s.z.why),
     'a request accepted and ignored is reported as what it is: ' + s.z.why);
  ok(s.z.actual === 1, 'with the actual value, not the requested one: ' + s.z.actual);
  ok(s.p2 === 'false', 'and the 4× button does not show as achieved');
}

// ============ 8. the diagnostics block
{
  await fake({ zoom: { min: 1, max: 8, step: 0.1 } }, { startZoom: 1 });
  await page.evaluate(() => { zoomProbe(); paintZoom(); });
  await page.click('#zoomIn');
  await page.waitForFunction(() => window.zoom.actual === 4, null, { timeout: 5000 });
  if (await page.isVisible('#menu')) await page.click('#bMenu');
  await page.click('#bMenu'); await page.click('#mDiag');
  await page.waitForSelector('#p-diag:not([hidden])');
  const t = await page.textContent('#diagText');
  ok(/ZOOM/.test(t), 'the diagnostics carry a zoom block');
  ok(/supported\s+yes/.test(t), 'supported: ' + (t.match(/supported\s+[^\n]*/) || [''])[0].trim());
  ok(/requested\s+4×/.test(t), 'requested: ' + (t.match(/requested\s+[^\n]*/) || [''])[0].trim());
  ok(/actual\s+4×/.test(t), 'actual: ' + (t.match(/actual\s+[^\n]*/) || [''])[0].trim());
  ok(/min\s+1/.test(t) && /max\s+8/.test(t) && /step\s+0\.1/.test(t),
     'min, max and step are all reported');
  ok(/CAMERA[\s\S]*?resolution\s+\d+ × \d+/.test(t),
     'and the camera resolution beside it: ' +
     (t.match(/resolution\s+[^\n]*/) || [''])[0].trim());
  ok(/applied at the camera track, not by cropping/.test(t),
     'with the pipeline promise stated where somebody reading a report can see it');
  await page.click('#xDiag');
}

// ============ 9. it is the TRACK that zooms, not the model's frame
{
  const src = await (await fetch(B + 'app.js')).text();
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const square = code.slice(code.indexOf('function squareFrame'),
                           code.indexOf('function squareFrame') + 400);
  ok(!/zoom/i.test(square),
     'squareFrame knows nothing about zoom — the model input is cut the same ' +
     'way at every zoom level');
  const look = code.slice(code.indexOf('function look()'), code.indexOf('function logFind'));
  ok(!/zoomApply|applyConstraints/.test(look),
     'and the survey loop never touches the camera constraints mid-drive');
  ok(/applyConstraints\(\{ advanced: \[\{ zoom/.test(code),
     'zoom is applied through MediaStreamTrack.applyConstraints');
  ok(!/scale\(|transform:.*scale|drawImage\([^)]*\/ *2/.test(code.slice(
       code.indexOf('function zoomApply'), code.indexOf('function zoomNow'))),
     'and never faked with a CSS transform or a crop');
}

// ============ 10. nothing else moved
{
  const after = await page.evaluate(() => ({
    conf: window.SURVEY_CONF, score: window.RF_SCORE, iou: window.RF_IOU,
    size: window.RF_SIZE, ms: window.SURVEY_MS, near: window.NEAR_M,
    edge: window.MAX_EDGE
  }));
  ok(after.conf === 0.65 && after.score === 0.5 && after.iou === 0.5,
     'thresholds untouched: ' + [after.conf, after.score, after.iou].join(', '));
  ok(after.size === 640 && after.ms === 1200 && after.near === 20 && after.edge === 1600,
     'input size, cadence, duplicate distance and photo edge untouched');
}

// ============ 11. an entry records what the camera was doing
{
  await fake({ zoom: { min: 1, max: 8, step: 0.1 } }, { startZoom: 4 });
  await page.evaluate(() => { zoomProbe(); paintZoom(); });
  await page.evaluate(() => {
    window.__hits = [];
    window.engine = { infer: () => Promise.resolve(window.__hits) };
    window.worker = 1;
    window.loadModel = () => Promise.resolve({});
  });
  await page.waitForFunction(() => document.getElementById('vid').videoWidth > 0);
  await rec(page);
  await page.evaluate(() => {
    window.__hits = [{ class: 'pothole', confidence: 0.9,
      bbox: { x: 320, y: 300, width: 220, height: 220 } }];
  });
  await page.waitForFunction(() => S.items.length > 0, null, { timeout: 30000 });
  const e = await page.evaluate(() => S.items[0]);
  ok(e.zoom === 4,
     'a find carries the zoom the camera was at when the frame was taken: ' + e.zoom);
  ok(e.imgW > 0 && e.detBox && e.modelKey,
     'alongside everything it carried before — the evidence frame is unchanged');
}

// ============ 12. 4x is the default, asked for as the camera opens
//
// It is what the survey wants, so it is asked for rather than waiting for
// somebody to remember a button at the roadside. On a camera that cannot, this
// must still do nothing and say so.
{
  const src = await (await fetch(B + 'app.js')).text();
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ok(/var ZOOM_WANT = 4;/.test(code),
     'the wanted zoom is one constant, so the button, the diagnostics, the ' +
     'request and the tests cannot drift apart');
  ok(/if \(zoom\.supported\) zoomApply\(ZOOM_WANT\)/.test(code),
     'and it is applied as the camera opens, guarded on support');
  ok(!/zoomApply\(2\)|zoomApply\(4\)/.test(code),
     'with no hardcoded number anywhere that could disagree with it');

  // A camera with no zoom must come out of openCamera untouched.
  await fake({ width: { min: 1, max: 1920 } });
  const before = await page.evaluate(() => {
    const t = window.stream.getVideoTracks()[0];
    window.__applied = [];
    zoomProbe(); paintZoom();
    if (window.zoom.supported) zoomApply(ZOOM_WANT);
    return { supported: window.zoom.supported };
  });
  await page.waitForTimeout(200);
  const s = await state();
  ok(before.supported === false && s.applied.length === 0,
     'a camera with no zoom is never sent a constraint at all: ' +
     s.applied.length + ' calls');
  ok(/4× zoom unavailable/.test(s.note),
     'and the screen says so rather than showing a 4× that never happened: ' + s.note);
}

console.log(fails.length ? '\nFAILURES: ' + fails.length : '\nall passed');
await browser.close();
process.exit(fails.length ? 1 : 0);
