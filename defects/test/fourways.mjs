// Four ways up: is the instrument sound, and which way up is the frame?
//
// Neither question needs the weights, and both have to be settled before any
// four-inference result is worth reading. A rotation test whose rotation loses
// pixels would produce a difference between angles that is the test's own doing.
//
// The fixture is the 640x640 square from a real frame test on a gravel lane —
// which is to say, the exact pixels the model was handed. testFrame saves
// sq.canvas.toBlob(..., 'image/jpeg', 0.8), so a 640x640 JPEG with no EXIF is
// the model's input, not a camera file.
import { chromium } from 'playwright';
import { CHROME, BASE, FIXTURES } from './browser.mjs';
import { settled } from './shellhelp.mjs';
import { readFileSync } from 'fs';
import { join } from 'path';

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

const b64 = readFileSync(join(FIXTURES, 'gravel-lane-640.jpg')).toString('base64');
const r = await page.evaluate(async (b64) => {
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  const bmp = await createImageBitmap(new Blob([u8], { type: 'image/jpeg' }));

  // Sky is bright and blue; tarmac and gravel are neither. Which band holds it
  // says which way is up, without asking the model anything.
  const band = (d, y0, y1, S) => {
    let lum = 0, blue = 0, n = 0;
    for (let y = y0; y < y1; y++) for (let x = 0; x < S; x++) {
      const o = (y * S + x) * 4, R = d[o], G = d[o + 1], Bl = d[o + 2];
      lum += 0.299 * R + 0.587 * G + 0.114 * Bl;
      blue += Bl - (R + G) / 2;
      n++;
    }
    return { lum: lum / n, blue: blue / n };
  };

  const rows = [];
  for (const deg of [0, 90, 180, 270]) {
    const sq = deg ? rotatedFrame(bmp, bmp.width, bmp.height, deg)
                   : squareFrame(bmp, bmp.width, bmp.height);
    const S = sq.canvas.width;
    const d = sq.ctx.getImageData(0, 0, S, S).data;
    let sum = 0, opaque = 0;
    for (let i = 0; i < d.length; i += 4) {
      sum += d[i] + d[i + 1] + d[i + 2];
      if (d[i + 3] === 255) opaque++;
    }
    const cut = Math.round(S * 0.2);
    rows.push({ deg, size: S, sum, opaque, total: S * S,
                top: band(d, 0, cut, S), bottom: band(d, S - cut, S, S) });
  }
  return { srcW: bmp.width, srcH: bmp.height, rows };
}, b64);

// ---------------- the fixture is the model's own input square
ok(r.srcW === 640 && r.srcH === 640,
   'the fixture is the 640 square the model is handed, not a camera file: ' +
   r.srcW + '×' + r.srcH);

// ---------------- the instrument: a quarter turn must lose nothing
{
  const sums = r.rows.map(x => x.sum);
  ok(new Set(sums).size === 1,
     'all four rotations carry an identical pixel sum, so a quarter turn of a ' +
     'square onto itself loses no pixel and invents none: ' + sums[0]);
  ok(r.rows.every(x => x.opaque === x.total),
     'and every canvas is fully covered — no transparent corner to darken a ' +
     'band and fake a difference between angles');
  ok(r.rows.every(x => x.size === 640),
     'each rotation is still the 640 square the survey builds');
}

// ---------------- which way up this frame actually is
{
  const at = (deg) => r.rows.filter(x => x.deg === deg)[0];
  const lift = (x) => ({ lum: x.top.lum - x.bottom.lum, blue: x.top.blue - x.bottom.blue });
  const z = lift(at(0)), a90 = lift(at(90)), a180 = lift(at(180)), a270 = lift(at(270));

  ok(z.lum < 0 && z.blue < 0,
     'at 0° the bright blue band is at the BOTTOM of the frame — the sky is ' +
     'under the road: top-bottom luminance ' + z.lum.toFixed(1) +
     ', blueness ' + z.blue.toFixed(1));
  ok(a270.blue > a180.blue && a270.blue > z.blue && a270.blue > a90.blue,
     'and 270° is the turn that puts the sky at the top most strongly: ' +
     'blueness lift 270° ' + a270.blue.toFixed(1) + ' vs 180° ' +
     a180.blue.toFixed(1) + ', 90° ' + a90.blue.toFixed(1) +
     ', 0° ' + z.blue.toFixed(1));
  ok(a270.lum > 0 && a270.blue > 8,
     'by a clear margin rather than a hair: ' + a270.lum.toFixed(1) +
     ' brighter and ' + a270.blue.toFixed(1) + ' bluer at the top');

  // 180° also reads as sky-at-top, which is why one number is not enough: the
  // original bottom band holds some sky too. The blueness separates them.
  ok(a180.blue > 0 && a180.blue < a270.blue,
     '180° reads weakly the same way, which is why the margin matters and not ' +
     'just the sign: ' + a180.blue.toFixed(1) + ' against ' + a270.blue.toFixed(1));
}

// ---------------- nothing in the survey path turns anything
//
// Asserting today's behaviour on purpose. If a rotation is ever added to the
// capture path, this fails and somebody has to say so deliberately.
{
  const src = await (await fetch(B + 'app.js')).text();
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const look = code.slice(code.indexOf('function look()'), code.indexOf('function logFind'));
  const square = code.slice(code.indexOf('function squareFrame'), code.indexOf('function fitToSource'));

  ok(!/rotate|rotatedFrame/.test(look),
     'look() — the survey capture — does not rotate anything');
  ok(!/rotate/.test(square),
     'and squareFrame has no rotation in it either: the model input ' +
     'orientation is whatever the camera track hands over');
  ok(/drawImage\(v, 0, 0/.test(look),
     'the frame is read straight off the video element, whose CSS transform ' +
     'drawImage ignores — so the counter-rotation that makes the screen look ' +
     'upright cannot reach the pixels');
  ok(/appRot: cssRotation/.test(code) && /videoRot: cssRotation/.test(code),
     'the app records both CSS rotations out of the DOM, so the gap between ' +
     'what the operator sees and what the model gets is measured, not assumed');

  // The instrument's reach, which is a limit on this test rather than a fault.
  const spin = code.slice(code.indexOf('function runSpin'), code.indexOf('function runSpin') + 900);
  ok(/testFrame\(v, v\.videoWidth/.test(spin),
     'four-ways-up runs on the LIVE camera only — it cannot be pointed at a ' +
     'stored square, so this fixture cannot be put through the real weights ' +
     'by the button that exists');
}

console.log('');
console.log('deg   pixel-sum     top lum  top blue   bot lum  bot blue');
for (const x of r.rows) {
  console.log(String(x.deg).padStart(3) + '   ' + String(x.sum).padEnd(13) +
    x.top.lum.toFixed(1).padStart(7) + x.top.blue.toFixed(1).padStart(10) +
    x.bottom.lum.toFixed(1).padStart(10) + x.bottom.blue.toFixed(1).padStart(10));
}
console.log(fails.length ? '\nFAILURES: ' + fails.length : '\nall passed');
await browser.close();
process.exit(fails.length ? 1 : 0);
