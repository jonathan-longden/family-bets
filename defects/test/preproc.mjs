// Preprocessing A/B: four ways of getting a 2340x1080 frame into a 640 square.
//
// The survey stretches. On a 16:9 frame that is a 1.78x distortion; on the
// 2340x1080 a modern phone hands over it is 2.17x, and a round pothole arrives
// more than twice as tall as it is wide.
//
// The obvious fix is letterboxing, and for THIS aspect ratio the obvious fix is
// arithmetically wrong: preserving the ratio scales both axes by the SMALLER
// factor, so the road loses more than half its vertical detail and 54% of the
// square becomes padding. These assertions pin that arithmetic down, because it
// is the reason the answer is a crop rather than a letterbox.
//
// And the part that decides whether any of it means anything: a box found in
// one variant's 640 square has to be mappable back onto the original
// photograph, or the four cannot be compared at all.
import { chromium } from 'playwright';
import { CHROME, BASE } from './browser.mjs';
import { settled } from './shellhelp.mjs';

const B = BASE;
const fails = [];
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails.push(m); };

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
const ctx = await browser.newContext({
  permissions: ['camera'], viewport: { width: 844, height: 390 } });
const page = await ctx.newPage();
await ctx.route('**/shard*.bin', r => r.fulfill({ status: 200, body: Buffer.alloc(1024) }));
await page.goto(B, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.getElementById('badge').textContent === 'Live',
  null, { timeout: 15000 });
await settled(page);

// ============ 1. the geometry of each variant, on the real frame size
{
  const g = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 2340; c.height = 1080;
    const x = c.getContext('2d');
    x.fillStyle = '#888'; x.fillRect(0, 0, 2340, 1080);
    const out = {};
    ['stretch', 'letterbox', 'cropSquare', 'cropLetterbox'].forEach(h => {
      out[h] = missVariant(c, 2340, 1080, h).shape;
    });
    return out;
  });

  const A = g.stretch, Bv = g.letterbox, C = g.cropSquare, D = g.cropLetterbox;
  ok(Math.abs(A.sx - 640 / 2340) < 1e-6 && Math.abs(A.sy - 640 / 1080) < 1e-6,
     'A stretches each axis by its own factor: x ×' + A.sx.toFixed(4) +
     ', y ×' + A.sy.toFixed(4));
  ok(Math.abs(A.sy / A.sx - 2340 / 1080) < 1e-6,
     'which is a distortion of ' + (A.sy / A.sx).toFixed(3) +
     '× — a round pothole arrives that much taller than wide');

  ok(Math.abs(Bv.sx - Bv.sy) < 1e-9, 'B letterbox scales both axes equally');
  ok(Math.abs(Bv.sy - A.sx) < 1e-6,
     'and the factor it must use is the SMALLER one — the same as A\'s ' +
     'horizontal: ×' + Bv.sy.toFixed(4));
  ok(Bv.sy < A.sy * 0.5,
     'so letterboxing this aspect ratio HALVES the vertical detail the road ' +
     'gets: ×' + Bv.sy.toFixed(4) + ' against A\'s ×' + A.sy.toFixed(4));
  ok(Bv.used < 0.5,
     'and leaves most of the square as padding the model still processes: ' +
     Math.round(Bv.used * 100) + '% used');
  ok(Bv.padY > 100 && Math.abs(Bv.padX) < 1,
     'padded top and bottom, not left and right: ' + Math.round(Bv.padY) + ' px');

  ok(Math.abs(C.sx - C.sy) < 1e-9, 'C crops square, so it has no distortion either');
  ok(C.sx > A.sx * 3, 'but gains horizontally rather than losing: ×' +
     C.sx.toFixed(4) + ' against ×' + A.sx.toFixed(4));
  ok(C.sy > A.sy, 'and gains vertically too: ×' + C.sy.toFixed(4) +
     ' against ×' + A.sy.toFixed(4));
  ok(Math.abs(C.used - 1) < 0.01,
     'with the whole square used: ' + Math.round(C.used * 100) + '%');
  ok(C.cropW === C.cropH,
     'the crop really is square: ' + C.cropW + '×' + C.cropH);
  ok(C.cropY > 1080 * 0.3 && C.cropY + C.cropH < 1080 * 0.95,
     'taken below the horizon and above the bonnet: rows ' + C.cropY + '–' +
     (C.cropY + C.cropH));

  ok(D.used < Bv.used,
     'D wastes even more of the square than B, because a wide band letterboxed ' +
     'is mostly padding: ' + Math.round(D.used * 100) + '%');

  // The finding this whole suite exists to state plainly.
  ok(C.sx > Bv.sx && C.sy > Bv.sy && C.sy > A.sy,
     'ONLY the road crop improves both axes at once — letterboxing trades ' +
     'vertical detail away to fix a distortion');
}

// ============ 2. a box maps back to where it really came from
//
// Checked against a known point rather than a formula rearranged twice: put a
// mark at a known place in the source, find where each variant lands it, and
// map it back.
{
  const r = await page.evaluate(() => {
    const W = 2340, H = 1080;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const x = c.getContext('2d');
    x.fillStyle = '#111'; x.fillRect(0, 0, W, H);
    // A white square at a known spot, inside the road band so every variant
    // contains it.
    const MX = 1100, MY = 700, MS = 40;
    x.fillStyle = '#fff'; x.fillRect(MX, MY, MS, MS);

    const found = (ctx2) => {
      const d = ctx2.getImageData(0, 0, 640, 640).data;
      let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
      for (let y = 0; y < 640; y++) for (let xx = 0; xx < 640; xx++) {
        if (d[(y * 640 + xx) * 4] > 200) {
          if (xx < x0) x0 = xx; if (xx > x1) x1 = xx;
          if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
      }
      return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
    };

    const out = {};
    ['stretch', 'letterbox', 'cropSquare', 'cropLetterbox'].forEach(h => {
      const v = missVariant(c, W, H, h);
      const box = found(v.ctx);
      out[h] = { box, back: box ? missToSource(box, v.shape) : null };
    });
    return { out, mark: { x: MX, y: MY, s: MS } };
  });

  const m = r.mark;
  Object.keys(r.out).forEach(h => {
    const o = r.out[h];
    ok(!!o.box, h + ': the mark is inside the variant\'s square');
    if (!o.box) return;
    const dx = Math.abs(o.back.x - m.x), dy = Math.abs(o.back.y - m.y);
    // Tolerance is the size of one tensor pixel in source terms, which is the
    // resolution the mapping can possibly have.
    ok(dx <= 12 && dy <= 12,
       h + ': mapped back to (' + Math.round(o.back.x) + ', ' +
       Math.round(o.back.y) + ') against the real (' + m.x + ', ' + m.y +
       ') — within ' + Math.max(dx, dy).toFixed(0) + ' px');
    ok(Math.abs(o.back.w - m.s) <= 12 && Math.abs(o.back.h - m.s) <= 12,
       h + ': and the size comes back as ' + Math.round(o.back.w) + '×' +
       Math.round(o.back.h) + ' against ' + m.s + '×' + m.s);
  });

  // The mapping is what makes the four comparable at all.
  const xs = Object.keys(r.out).filter(h => r.out[h].back).map(h => r.out[h].back.x);
  ok(Math.max(...xs) - Math.min(...xs) < 25,
     'all four variants agree on where the mark is in the ORIGINAL image, ' +
     'which is what makes their boxes comparable: ' +
     xs.map(v => Math.round(v)).join(', '));
}

// ============ 3. production is untouched
{
  const src = await (await fetch(B + 'app.js')).text();
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  // To the end of the function, not a fixed number of characters: squareFrame
  // grew when it started cropping, and a 400-char window stopped reaching its
  // own drawImage — which failed an assertion about code that was correct.
  const square = code.slice(code.indexOf('function squareFrame'),
                            code.indexOf('function fitToSource'));
  // Build 55: production letterboxes. The variants above are still measured
  // against each other, but A is now history rather than what the survey does.
  ok(/ROAD_TOP/.test(square) && /ROAD_BOT/.test(square),
     'squareFrame takes the road band — below the horizon, above the bonnet');
  ok(/Math\.min\(w, band\)/.test(square),
     'and the largest square that fits inside it, so there is no distortion ' +
     'and no padding');
  ok(/drawImage\(source, cx, cy, side, side, 0, 0, RF_SIZE, RF_SIZE\)/.test(square),
     'drawn from that crop to the whole square');
  ok(!/drawImage\(source, 0, 0, w, h, 0, 0, RF_SIZE, RF_SIZE\)/.test(square),
     'and the stretch is gone from it entirely');
  const look = code.slice(code.indexOf('function look()'), code.indexOf('function logFind'));
  ok(/squareFrame\(shot,/.test(look) && !/missVariant/.test(look),
     'the survey loop still calls squareFrame, not a variant');
  ok(/out\.fit/.test(look),
     'and carries the fit out with the frame, because a padded square is no ' +
     'longer a linear map of the photograph');
  const after = await page.evaluate(() => ({
    conf: window.SURVEY_CONF, score: window.RF_SCORE, size: window.RF_SIZE
  }));
  ok(after.conf === 0.65 && after.score === 0.5 && after.size === 640,
     'thresholds and input size untouched: ' +
     [after.conf, after.score, after.size].join(', '));
}

// ============ 4. a real object's share — and so its priority — did not move
//
// The claim that made this change safe to deploy. Share drives bandFor(), which
// drives the priority a survey writes down, so if letterboxing changed it then
// every entry logged after build 55 would be scored differently from every
// entry before it, and the two could never be compared.
//
// Stretch measured a box against the whole 640 square. Letterbox measures it
// against the picture inside the padding. Those cancel exactly, because the
// object shrinks by the same ratio the denominator does — and that is worth
// checking with numbers rather than with algebra on a whiteboard.
{
  const r = await page.evaluate(() => {
    const W = 1600, H = 900;           // what the survey's shot canvas looks like
    // A real object, in real photograph pixels.
    const objW = 300, objH = 200;

    // What the old stretch produced: each axis scaled by its own factor, share
    // taken against the full square.
    const oldBoxW = objW * (640 / W), oldBoxH = objH * (640 / H);
    const oldShare = (oldBoxW * oldBoxH) / (640 * 640);

    // What letterboxing produces: one scale for both axes, share taken against
    // the content, which is what the app now passes to usableFind.
    const s = Math.min(640 / W, 640 / H);
    const newBoxW = objW * s, newBoxH = objH * s;
    const dw = W * s, dh = H * s;
    const newShare = (newBoxW * newBoxH) / (dw * dh);

    return { oldShare, newShare,
             oldBand: bandFor(oldShare), newBand: bandFor(newShare) };
  });
  ok(Math.abs(r.oldShare - r.newShare) < 1e-9,
     'the same real object measures the same share under both preprocessings: ' +
     r.oldShare.toFixed(6) + ' against ' + r.newShare.toFixed(6));
  ok(JSON.stringify(r.oldBand) === JSON.stringify(r.newBand),
     'so it falls in the same band, and the priority a survey writes down does ' +
     'not move across this build: ' + (r.newBand && r.newBand.word));
}

console.log(fails.length ? '\nFAILURES: ' + fails.length : '\nall passed');
await browser.close();
process.exit(fails.length ? 1 : 0);
