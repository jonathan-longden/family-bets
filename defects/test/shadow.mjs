import { chromium } from 'playwright';
import { CHROME } from './browser.mjs';
const B = 'http://127.0.0.1:8777/defects/';
const fails = [];
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails.push(m); };
const browser = await chromium.launch({ executablePath: CHROME });
const page = await (await browser.newContext()).newPage();
await page.goto(B, { waitUntil: 'domcontentloaded' });

// Paint tarmac, then either dim a patch (shadow) or break it up (hole),
// and ask the discriminator which it is looking at.
const judge = await page.evaluate(() => {
  const W = 400, H = 300, BOX = { x: 200, y: 150, w: 120, h: 100 };
  function canvas(fill) {
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d', { willReadFrequently: true });
    const im = g.createImageData(W, H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const inBox = Math.abs(x - BOX.x) < BOX.w / 2 && Math.abs(y - BOX.y) < BOX.h / 2;
      let v = fill(x, y, inBox);
      im.data[i] = im.data[i+1] = im.data[i+2] = Math.max(0, Math.min(255, v));
      im.data[i+3] = 255;
    }
    g.putImageData(im, 0, 0);
    return { g, W, H };
  }
  // tarmac: mid grey with fine chipping grain
  const grain = (x, y) => 118 + ((x * 7919 + y * 104729) % 37) - 18;
  const out = {};

  // a shadow: the same grain with the light turned down
  let c = canvas((x, y, inBox) => inBox ? grain(x, y) * 0.42 : grain(x, y));
  out.shadow = textureRatio(c.g, W, H, BOX);
  out.shadowReject = rejectReason(c.g, W, H, BOX);

  // a hole: darker and broken up — rim, edges, loose material
  c = canvas((x, y, inBox) => inBox
    ? grain(x, y) * 0.42 + ((x * 31 + y * 17) % 5 === 0 ? 95 : 0) - ((x + y) % 3) * 22
    : grain(x, y));
  out.hole = textureRatio(c.g, W, H, BOX);
  out.holeReject = rejectReason(c.g, W, H, BOX);

  // a band across the road, the shape a tree throws
  out.bandReject = rejectReason(c.g, W, H, { x: 200, y: 150, w: 340, h: 30 });

  // a soft-edged shadow, the kind a tree actually throws
  c = canvas((x, y, inBox) => {
    const d = Math.max(Math.abs(x - BOX.x) / (BOX.w / 2), Math.abs(y - BOX.y) / (BOX.h / 2));
    const dim = d < 0.8 ? 0.42 : d < 1 ? 0.42 + (d - 0.8) * 2.9 : 1;
    return grain(x, y) * Math.min(1, dim);
  });
  out.soft = textureRatio(c.g, W, H, BOX);
  out.softReject = rejectReason(c.g, W, H, BOX);

  // a shallow, worn hollow — much less broken up than a fresh pothole
  c = canvas((x, y, inBox) => inBox
    ? grain(x, y) * 0.60 + ((x * 13 + y * 29) % 11 === 0 ? 34 : 0) - ((x + y) % 5) * 6
    : grain(x, y));
  out.shallow = textureRatio(c.g, W, H, BOX);
  out.shallowReject = rejectReason(c.g, W, H, BOX);

  // plain road, no dark patch at all
  c = canvas((x, y) => grain(x, y));
  out.plain = textureRatio(c.g, W, H, BOX);
  out.plainReject = rejectReason(c.g, W, H, BOX);
  return out;
});

console.log('   shadow ratio ' + judge.shadow.ratio.toFixed(3) +
            ' | hole ratio ' + judge.hole.ratio.toFixed(3) +
            ' | plain ratio ' + judge.plain.ratio.toFixed(3));
ok(judge.shadow.darker, 'the shadow patch is measured as darker');
ok(judge.shadow.ratio < 1.18, 'a dimmed copy of the road grades as shadow-like');
ok(judge.hole.ratio > 1.18, 'a broken-up patch grades as rougher than the road');
ok(judge.hole.ratio > judge.shadow.ratio * 1.3, 'and the two are well apart, not a knife edge');
ok(/shadow, not a hole/.test(judge.shadowReject || ''), 'the shadow is thrown out, with a reason');
ok(judge.holeReject === null, 'the hole survives');
ok(/band far longer than it is wide/.test(judge.bandReject || ''), 'a long thin band is thrown out on shape');
ok(judge.plainReject === null, 'plain road with no dark patch is not called a shadow');
console.log('   soft-edged shadow ' + judge.soft.ratio.toFixed(3) +
            ' | shallow hollow ' + judge.shallow.ratio.toFixed(3) + '  (threshold 1.18)');
ok(/shadow, not a hole/.test(judge.softReject || ''), 'a soft-edged shadow is still thrown out');
ok(judge.shallowReject === null, 'a shallow worn hollow still survives');

await browser.close();
console.log(fails.length ? '\n' + fails.length + ' FAILED' : '\nall passed');
process.exit(fails.length ? 1 : 0);
