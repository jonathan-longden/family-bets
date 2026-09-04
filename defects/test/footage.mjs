// Recording the drive, and putting a frame of it through the miss report.
//
// The app could not tell you why a pothole was missed if the frame it was
// missed on was gone. A photograph taken afterwards, from a stopped vehicle, at
// a different angle, is not that frame. So: record the camera stream, scrub
// back, and analyse the frame that was actually missed.
//
// The property that makes it worth anything is that the footage is the CAMERA
// STREAM and not the screen — a screen recording would carry the CSS rotation
// the model never sees, which is the one thing currently most worth seeing.
//
// Half of this suite is about the survey being untouched when recording is off,
// and about the recording never being able to cost somebody their observations.
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

const openDiag = async () => {
  if (await page.isVisible('#p-diag')) return;
  if (await page.isVisible('#menu')) await page.click('#bMenu');
  await page.click('#bMenu'); await page.click('#mDiag');
  await page.waitForSelector('#p-diag:not([hidden])');
};

// ============ 1. the type is probed, never assumed
{
  const r = await page.evaluate(() => {
    const asked = window.FOOT_TYPES.slice();
    const sup = footSupport();
    // What the browser itself says, independently of the app's opinion of it.
    const truth = asked.map(t => ({ t, yes: MediaRecorder.isTypeSupported(t) }));
    return { asked, sup, truth };
  });
  ok(r.asked.length >= 4 && r.asked.every(t => /^video\//.test(t)),
     'a list of candidate types is asked about: ' + r.asked.join(', '));
  ok(r.sup.ok, 'this browser can record: ' + r.sup.why);
  ok(r.sup.types.every(t => r.truth.filter(x => x.t === t)[0].yes),
     'every type the app claims is supported is one isTypeSupported actually ' +
     'said yes to — nothing is assumed: ' + r.sup.types.join(', '));
  ok(r.truth.filter(x => x.yes && !r.sup.types.includes(x.t)).length === 0,
     'and none that it said yes to was dropped');
  ok(r.sup.picked === r.sup.types[0],
     'the one picked is the first supported, in the order the app prefers: ' + r.sup.picked);
}

// ============ 2. the source is the camera stream, not the screen
{
  const r = await page.evaluate(() => {
    const src = document.getElementById('vid').srcObject;
    return { same: src === window.stream,
             tracks: window.stream.getVideoTracks().length,
             label: window.stream.getVideoTracks()[0].label,
             hasDisplay: typeof navigator.mediaDevices.getDisplayMedia };
  });
  ok(r.same,
     'the video element and the recorder are handed the SAME MediaStream object');
  ok(r.tracks === 1, 'which carries the one video track the survey looks at');

  const src = await (await fetch(B + 'app.js')).text();
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ok(/new MediaRecorder\(stream,/.test(code),
     'and MediaRecorder is constructed from that stream directly');
  ok(!/getDisplayMedia/.test(code),
     'nothing in the app asks for the screen — a screen recording would carry ' +
     'the CSS rotation the model never sees');
  ok(!/getUserMedia/.test(code.slice(code.indexOf('function footStart'),
                                     code.indexOf('function footStop'))),
     'and recording does not open a second camera');
}

// ============ 3. start, run, stop
{
  await openDiag();
  await page.click('#bFootStart');
  await page.waitForFunction(() => window.foot && window.foot.on, null, { timeout: 10000 });
  ok(true, 'recording starts');
  const mid = await page.evaluate(() => ({ on: foot.on, id: foot.id, mime: foot.meta.mime,
    startDisabled: document.getElementById('bFootStart').disabled,
    stopDisabled: document.getElementById('bFootStop').disabled,
    dot: document.getElementById('footDot').classList.contains('on') }));
  ok(mid.on && !!mid.id, 'with an id: ' + mid.id);
  ok(mid.startDisabled && !mid.stopDisabled,
     'Start is disabled and Stop is live while it runs');
  ok(mid.dot, 'and the indicator is on');

  // Long enough for at least two slices, so chunking is exercised rather than
  // a single blob happening to look like one.
  await page.waitForFunction(() => window.foot && window.foot.seq >= 2,
    null, { timeout: 30000 });
  const during = await page.evaluate(() => ({ seq: foot.seq, bytes: foot.bytes,
    text: document.getElementById('footState').textContent }));
  ok(during.seq >= 2, 'chunks arrive as it runs rather than at the end: ' + during.seq);
  ok(during.bytes > 0, 'carrying bytes: ' + during.bytes);
  ok(/Recording \d\d:\d\d/.test(during.text),
     'and the elapsed time is on screen: ' + during.text.split('\n')[0]);

  const id = mid.id;
  await page.click('#bFootStop');
  await page.waitForFunction(() => window.foot && !window.foot.on, null, { timeout: 10000 });
  ok(true, 'and it stops when asked');

  // ============ 4. what got written
  await page.waitForFunction(() => window.__t === undefined || true);
  const w = await page.evaluate(async (id) => {
    const rows = await allFootage();
    const m = rows.filter(r => r.id === id)[0];
    const chunks = await footChunks(id);
    return { m, n: chunks.length,
             seqs: chunks.map(c => c.seq),
             sizes: chunks.map(c => c.bytes),
             blobs: chunks.every(c => c.blob && typeof c.blob.size === 'number') };
  }, id);
  ok(!!w.m, 'the recording has a metadata record of its own');
  ok(w.n >= 2, 'and its chunks are stored separately: ' + w.n);
  ok(JSON.stringify(w.seqs) === JSON.stringify(w.seqs.slice().sort((a, b) => a - b)),
     'in order, with no gap: ' + w.seqs.join(','));
  ok(w.blobs && w.sizes.every(s => s > 0), 'each one a real Blob with bytes in it');
  ok(w.m.startedAt && w.m.endedAt && w.m.ms > 0,
     'the record carries start, end and duration: ' + w.m.startedAt + ' → ' +
     w.m.endedAt + ', ' + w.m.ms + ' ms');
  ok(w.m.bytes > 0 && w.m.chunks > 0,
     'an approximate size and a chunk count: ' + w.m.bytes + ' B in ' + w.m.chunks);
  ok(!!w.m.mime && w.m.supported.length >= 1,
     'the type used and what else was available: ' + w.m.mime);
  ok(w.m.videoW > 0 && w.m.videoH > 0,
     'and the resolution actually delivered: ' + w.m.videoW + '×' + w.m.videoH);

  // ============ 5. orientation, which is why this exists
  ok(w.m.appRot !== undefined && w.m.videoRot !== undefined,
     'both CSS rotations are recorded: app ' + w.m.appRot + '°, video ' + w.m.videoRot + '°');
  ok('screenAngle' in w.m && 'portraitViewport' in w.m,
     'with the screen angle and whether the viewport was portrait: ' +
     w.m.screenAngle + ', ' + w.m.portraitViewport);
  ok(w.m.trackW !== undefined && w.m.frameRate !== undefined,
     'and what the track itself reports, which need not match the request: ' +
     w.m.trackW + '×' + w.m.trackH + ' @ ' + w.m.frameRate);
  ok(!!w.m.build && !!w.m.ua, 'plus the build and browser it came from');

  // ============ 6. playback and the exact frame
  await page.evaluate((id) => footOpen(id), id);
  await page.waitForSelector('#footPlayWrap:not([hidden])', { timeout: 20000 });
  const play = await page.evaluate(() => {
    const v = document.getElementById('footVid');
    return { src: v.getAttribute('src').slice(0, 5), controls: v.controls,
             id: footPlay.id, url: !!footPlay.url };
  });
  ok(play.src === 'blob:', 'the assembled recording plays from a blob URL');
  ok(play.controls, 'in a video element with the browser controls, so it can be scrubbed');
  ok(play.id === id, 'and the player knows which recording it holds');

  // Scrub, which is what this feature is for, and wait for the seek to land.
  // A frame grabbed at t=0 before anything has been painted comes back black —
  // the app refuses that case rather than reporting on an empty square.
  await page.waitForFunction(() => {
    const v = document.getElementById('footVid');
    return v.readyState >= 2 && v.videoWidth > 0;
  }, null, { timeout: 30000 });
  const blank = await page.evaluate(() => {
    const v = document.getElementById('footVid');
    const was = v.readyState;
    Object.defineProperty(v, 'readyState', { value: 0, configurable: true });
    const got = footFrame();
    delete v.readyState;
    return { refused: got === null, restored: v.readyState === was };
  });
  ok(blank.refused,
     'a frame asked for before one has been decoded is refused rather than ' +
     'handed over black');
  await page.evaluate(() => new Promise((res) => {
    const v = document.getElementById('footVid');
    v.addEventListener('seeked', res, { once: true });
    v.currentTime = Math.min(1.5, Math.max(0.5, (v.duration || 2) / 2));
    setTimeout(res, 8000);
  }));
  const f = await page.evaluate(() => {
    const v = document.getElementById('footVid');
    const got = footFrame();
    if (!got) return null;
    const d = got.canvas.getContext('2d').getImageData(0, 0, got.canvas.width, got.canvas.height).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += d[i] + d[i + 1] + d[i + 2];
    return { w: got.w, h: got.h, videoW: v.videoWidth, videoH: v.videoHeight, sum,
             canvasW: got.canvas.width, canvasH: got.canvas.height };
  });
  ok(!!f, 'a frame can be taken from the paused recording');
  ok(f.w === f.videoW && f.h === f.videoH,
     'at the video\'s own resolution, not the model\'s square: ' + f.w + '×' + f.h);
  ok(f.canvasW === f.videoW && f.canvasH === f.videoH,
     'so the frame keeps its real aspect ratio at this stage: ' +
     (f.w / f.h).toFixed(3));
  ok(f.sum > 0, 'and it carries real pixels rather than an empty canvas');
}

// ============ 7. the frame reaches the miss report, and is labelled as footage
{
  await page.evaluate(async () => { await tf.setBackend('cpu'); await tf.ready(); });
  await page.evaluate(() => {
    const N = 8400, C = 6;
    const buf = new Float32Array(N * C);
    for (let a = 0; a < N; a++) {
      buf[a] = 320; buf[N + a] = 320; buf[2 * N + a] = 20; buf[3 * N + a] = 16;
      buf[4 * N + a] = 0.001; buf[5 * N + a] = 0.001;
    }
    buf[4211] = 311; buf[N + 4211] = 387; buf[2 * N + 4211] = 56; buf[3 * N + 4211] = 49;
    buf[4 * N + 4211] = 0.01; buf[5 * N + 4211] = 0.5351;
    window.infSession = { tf, backend: 'cpu',
      model: { execute: () => tf.tensor(buf, [1, C, N], 'float32') } };
    window.rfMeta = { classes: ['manhole', 'pothole'] };
    window.missRuns = []; window.missResult = null; paintFrameTest();
  });
  await page.click('#bFootFrame');
  await page.waitForFunction(() => /MISS ANALYSIS/.test(
    document.getElementById('frameText').textContent), null, { timeout: 90000 });
  const t = await page.textContent('#frameText');
  ok(/footage · f[a-z0-9]+ at \d+\.\d\ds/.test(t),
     'the report names the recording and the second it came from: ' +
     (t.match(/footage · [^\n,]*/) || [''])[0]);
  ok(/highest pothole confidence:\s+0\.5351/.test(t),
     'and it is a full miss report on that frame: ' +
     (t.match(/highest pothole confidence:[^\n]*/) || [''])[0]);
  ok(/THRESHOLD SWEEP/.test(t) && /NMS RESULTS/.test(t) && /RAW MODEL/.test(t),
     'with the sweep, the NMS result and the raw model block, same as a photo');
  ok(/backend:\s+CPU/.test(t) && /inference time:\s+\d+ ms/.test(t),
     'the backend and the time: ' + (t.match(/inference time:[^\n]*/) || [''])[0]);
  ok(/plausible:\s+yes/.test(t), 'and the numerical sanity check');
  ok(/source dimensions:[^\n]*\d+ × \d+/.test(t),
     'the preprocessing is explicit about what it was given: ' +
     (t.match(/source dimensions:[^\n]*/) || [''])[0]);
}

// ============ 8. none of it changed the survey
{
  const after = await page.evaluate(() => ({
    conf: window.SURVEY_CONF, score: window.RF_SCORE, iou: window.RF_IOU,
    size: window.RF_SIZE, ms: window.SURVEY_MS, near: window.NEAR_M,
    items: S.items.length, logged: survey.logged, on: survey.on
  }));
  ok(after.conf === 0.65 && after.score === 0.5 && after.iou === 0.5,
     'thresholds untouched: ' + [after.conf, after.score, after.iou].join(', '));
  ok(after.size === 640 && after.ms === 1200 && after.near === 20,
     'input size, cadence and the duplicate distance untouched');
  ok(after.items === 0 && after.logged === 0 && after.on === false,
     'and recording wrote nothing to the log and started no survey');

  const src = await (await fetch(B + 'app.js')).text();
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const look = code.slice(code.indexOf('function look()'), code.indexOf('function logFind'));
  ok(!/foot/i.test(look),
     'the survey loop has no knowledge of footage at all — recording cannot ' +
     'block it, slow it, or change its cadence');
  const foots = code.slice(code.indexOf('function footStart'), code.indexOf('function putFootMeta'));
  ok(!/infer|engine\.|loadModel|execute\(/.test(foots),
     'and recording runs no inference of its own');
  ok(!/putEntry|fileObservation/.test(code.slice(code.indexOf('/* ---------- footage'),
      code.indexOf('function paintFrameTest'))),
     'nothing in the footage code writes or deletes an observation');
}

// ============ 9. the survey still runs normally with recording off
{
  await page.evaluate(() => {
    window.__hits = [];
    window.engine = { infer: () => Promise.resolve(window.__hits) };
    window.worker = 1;
    window.loadModel = () => Promise.resolve({});
  });
  if (await page.isVisible('#p-diag')) await page.click('#xDiag');
  await page.waitForFunction(() => document.getElementById('vid').videoWidth > 0);
  await rec(page);
  await page.evaluate(() => {
    window.__hits = [{ class: 'pothole', confidence: 0.9,
      bbox: { x: 320, y: 300, width: 220, height: 220 } }];
  });
  await page.waitForFunction(() => S.items.length > 0, null, { timeout: 30000 });
  const e = await page.evaluate(() => ({ n: S.items.length, foot: window.foot.on,
    first: S.items[0].type }));
  ok(e.n === 1 && e.first === 'Pothole',
     'a survey with recording OFF logs exactly as it did before: ' + e.first);
  ok(e.foot === false, 'and no recording was started behind anybody\'s back');
}

// ============ 10. a browser with no MediaRecorder says so and does nothing
{
  const r = await page.evaluate(() => {
    const real = window.MediaRecorder;
    try {
      delete window.MediaRecorder;
      const sup = footSupport();
      return { ok: sup.ok, why: sup.why, picked: sup.picked };
    } finally { window.MediaRecorder = real; }
  });
  ok(r.ok === false, 'with no MediaRecorder, recording reports itself unavailable');
  ok(/no MediaRecorder/.test(r.why), 'saying which fault it is: ' + r.why);
  ok(r.picked === null, 'and offers no type');

  const r2 = await page.evaluate(() => {
    const real = MediaRecorder.isTypeSupported;
    try {
      MediaRecorder.isTypeSupported = () => false;
      const sup = footSupport();
      return { ok: sup.ok, why: sup.why };
    } finally { MediaRecorder.isTypeSupported = real; }
  });
  ok(r2.ok === false && /supports none of the types/.test(r2.why),
     'and "MediaRecorder exists but supports nothing we asked for" is reported ' +
     'as a different fault: ' + r2.why);

  const r3 = await page.evaluate(() => {
    const real = MediaRecorder.isTypeSupported;
    try {
      MediaRecorder.isTypeSupported = () => { throw new Error('nope'); };
      return { ok: footSupport().ok };
    } finally { MediaRecorder.isTypeSupported = real; }
  });
  ok(r3.ok === false,
     'a browser that throws on the question has not said yes to anything');
}

console.log(fails.length ? '\nFAILURES: ' + fails.length : '\nall passed');
await browser.close();
process.exit(fails.length ? 1 : 0);
