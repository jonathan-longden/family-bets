// Several photographs in one pass, and the table across them.
//
// One image answers "which stage dropped this pothole". The decision actually
// in front of us — is 0.65 too high, or does the model need replacing — cannot
// be made from one image, so a batch keeps its runs side by side. This suite
// checks the table across them, the threshold sweep under each one, and that
// running eight pictures through still changes nothing about the survey.
import { chromium } from 'playwright';
import { CHROME, BASE, FIXTURES } from './browser.mjs';
import { settled } from './shellhelp.mjs';
import { join } from 'path';
import { mkdtempSync, copyFileSync } from 'fs';
import { tmpdir } from 'os';

const B = BASE;
const fails = [];
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails.push(m); };

// Three names for the same picture. The pixels are not what varies here — the
// model's answer is, one per call, so each row of the table has its own story.
const dir = mkdtempSync(join(tmpdir(), 'missbatch-'));
const names = ['road-one.png', 'road-two.png', 'road-three.png'];
const paths = names.map(n => {
  const p = join(dir, n);
  copyFileSync(join(FIXTURES, 'pothole-fixture.png'), p);
  return p;
});

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
await page.waitForFunction(() => !!(window.tf && window.benchTf), null, { timeout: 90000 });
await page.evaluate(async () => { await tf.setBackend('cpu'); await tf.ready(); });

// A graph that answers differently each time it is called, so three images
// produce three different rows rather than the same row three times.
//   1  a confident pothole, over the bar
//   2  a pothole under the bar
//   3  nothing at all
await page.evaluate(() => {
  const N = 8400, C = 6;
  const frame = (rows) => {
    const buf = new Float32Array(N * C);
    for (let a = 0; a < N; a++) {
      buf[a] = 320; buf[N + a] = 320; buf[2 * N + a] = 20; buf[3 * N + a] = 16;
      buf[4 * N + a] = 0.001; buf[5 * N + a] = 0.001;
    }
    rows.forEach(r => {
      const a = r.anchor;
      buf[a] = r.x; buf[N + a] = r.y; buf[2 * N + a] = r.w; buf[3 * N + a] = r.h;
      buf[4 * N + a] = r.manhole; buf[5 * N + a] = r.pothole;
    });
    return buf;
  };
  const queue = [
    frame([{ anchor: 4211, x: 311, y: 387, w: 56, h: 49, manhole: 0.01, pothole: 0.88 }]),
    frame([{ anchor: 4211, x: 311, y: 387, w: 56, h: 49, manhole: 0.01, pothole: 0.5351 }]),
    frame([])
  ];
  let n = 0;
  window.infSession = { tf, backend: 'cpu',
    model: { execute: () => tf.tensor(queue[Math.min(n++, queue.length - 1)],
                                      [1, C, N], 'float32') } };
  window.rfMeta = { classes: ['manhole', 'pothole'] };
});

const before = await page.evaluate(() => ({
  conf: window.SURVEY_CONF, score: window.RF_SCORE, iou: window.RF_IOU,
  max: window.RF_MAXBOX, size: window.RF_SIZE, items: S.items.length,
  logged: survey.logged, on: survey.on
}));

if (await page.isVisible('#menu')) await page.click('#bMenu');
await page.click('#bMenu'); await page.click('#mDiag');
await page.waitForSelector('#p-diag:not([hidden])');

// One pick, three files.
await page.setInputFiles('#missFile', paths);
await page.waitForFunction(() => window.missRuns && window.missRuns.length === 3,
  null, { timeout: 120000 });
const t = await page.textContent('#frameText');

// ---------------- the table across the batch
ok(/ACROSS ALL 3 PHOTOGRAPHS/.test(t),
   'three pictures in one pick produce one table across them');
ok(names.every(n => t.includes(n.replace('.png', ''))),
   'with a row per photograph, named: ' +
   names.filter(n => t.includes(n.replace('.png', ''))).join(', '));
ok((t.match(/UNKNOWN/g) || []).length >= 3,
   'and "was there really a pothole?" left as UNKNOWN in every row — the app ' +
   'has no ground truth and does not invent one');
ok(/real\?\s+UNKNOWN in every row on purpose/.test(t),
   'and says so, rather than leaving a reader to assume the column is a finding');

ok(/road-one[^\n]*0\.88/.test(t), 'the confident frame carries its confidence: ' +
   (t.match(/road-one[^\n]*/) || [''])[0].replace(/\s+/g, ' '));
ok(/road-two[^\n]*0\.5351/.test(t), 'the under-the-bar frame carries its own: ' +
   (t.match(/road-two[^\n]*/) || [''])[0].replace(/\s+/g, ' '));
ok(/road-three[^\n]*none/.test(t), 'and the empty frame says none rather than 0: ' +
   (t.match(/road-three[^\n]*/) || [''])[0].replace(/\s+/g, ' '));

const row = (n) => (t.match(new RegExp('  ' + n + '[^\\n]*')) || [''])[0];
ok(/-\s*$/.test(row('road-one')), 'the confident frame is typed as one that would be logged');
ok(/B\s*$/.test(row('road-two')), 'the under-the-bar frame is typed B');
ok(/A\s*$/.test(row('road-three')), 'and the empty one A');

// ---------------- the aggregates the decision is made on
ok(/photographs tested:\s+3/.test(t), 'the count is stated: ' +
   (t.match(/photographs tested:[^\n]*/) || [''])[0]);
ok(/best pothole confidence:\s+0\.88/.test(t), 'best across the set: ' +
   (t.match(/best pothole confidence:[^\n]*/) || [''])[0]);
ok(/worst:\s+0\b/.test(t), 'worst across the set: ' +
   (t.match(/worst:[^\n]*/) || [''])[0]);
ok(/average:\s+0\.4717/.test(t), 'and the average, which is arithmetic not opinion: ' +
   (t.match(/average:[^\n]*/) || [''])[0]);
ok(/at or above 0\.65:\s+1/.test(t), 'one over the bar');
ok(/between 0\.4 and 0\.65:\s+1/.test(t), 'one between the sweep floor and the bar');
ok(/no useful candidate:\s+1/.test(t), 'and one with nothing at all');
ok(/most common outcome:\s+no single one — [AB-], [AB-], [AB-] tie at 1/.test(t),
   'a three-way tie is reported as a tie rather than as a winner that happened ' +
   'to sort first: ' + (t.match(/most common outcome:[^\n]*/) || [''])[0]);
ok(/No majority\. Read the type column/.test(t),
   'and the reading refuses to give one verdict over a split set');

// ---------------- the sweep, per image
const sweeps = t.match(/THRESHOLD SWEEP/g) || [];
ok(sweeps.length === 3, 'every image gets its own threshold sweep: ' + sweeps.length);
['0.40', '0.45', '0.50', '0.55', '0.60', '0.65'].forEach(b => {
  ok(new RegExp('^  ' + b.replace('.', '\\.'), 'm').test(t),
     'the sweep covers ' + b);
});
ok(/NMS was run from 0\.4 for this table/.test(t),
   'the sweep says NMS was re-run to get there, rather than quietly reporting ' +
   'zeros below the production score');
ok(/runs at 0\.5, so anything below that is discarded/.test(t),
   'and names the real floor of the production pipeline: ' +
   (t.match(/runs at [^\n]*/) || [''])[0]);
ok(/why a bar of 0\.40 alone would not change what gets logged/.test(t),
   'and draws the conclusion that follows from it');
ok(/Extra boxes at a lower bar are NOT known to be false positives/.test(t),
   'while refusing to call the extra boxes false positives without a person ' +
   'having looked at them');

// The confident frame should still be one detection all the way down, and the
// 0.5351 frame should appear at 0.50 and below but not at 0.55 and above.
const block = (name) => {
  const i = t.indexOf('photo \u00b7 ' + name);      // the detail heading, not the table row
  const j = t.indexOf('THRESHOLD SWEEP', i);
  return t.slice(j, t.indexOf('SURVEY THRESHOLD', j));
};
const two = block('road-two.png');
// "0.65 *" marks the production bar, so the count is not simply the second word.
const at = (b) => {
  const m = two.match(new RegExp('^  ' + b.replace('.', '\\.') + ' \\*?\\s+(\\d+)', 'm'));
  return m ? m[1] : null;
};
ok(at('0.50') === '1', 'the 0.5351 pothole is a detection at 0.50: ' + at('0.50'));
ok(at('0.55') === '0', 'and not at 0.55: ' + at('0.55'));
ok(at('0.65') === '0', 'nor at the production bar: ' + at('0.65'));
ok(/0\.50\s+1\s+0\s+\+1 pothole box/.test(two),
   'and the change column says what lowering the bar would actually buy here');

// ---------------- and none of it touched the survey
const after = await page.evaluate(() => ({
  conf: window.SURVEY_CONF, score: window.RF_SCORE, iou: window.RF_IOU,
  max: window.RF_MAXBOX, size: window.RF_SIZE, items: S.items.length,
  logged: survey.logged, on: survey.on, backend: tf.getBackend()
}));
ok(JSON.stringify(before) === JSON.stringify({
  conf: after.conf, score: after.score, iou: after.iou, max: after.max,
  size: after.size, items: after.items, logged: after.logged, on: after.on }),
   'three images through the tool and the survey is byte-identical: conf ' +
   after.conf + ', score ' + after.score + ', ' + after.items + ' items');
ok(after.backend === 'cpu', 'the borrowed backend is put back: ' + after.backend);

// A second pick is a new batch, not an ever-growing table.
await page.setInputFiles('#missFile', [paths[0]]);
await page.waitForFunction(() => window.missRuns && window.missRuns.length === 1,
  null, { timeout: 120000 });
const t2 = await page.textContent('#frameText');
ok(!/ACROSS ALL/.test(t2),
   'picking one photograph afterwards starts a fresh batch rather than adding ' +
   'a fourth row to the last one');

console.log(fails.length ? '\nFAILURES: ' + fails.length : '\nall passed');
await browser.close();
process.exit(fails.length ? 1 : 0);
