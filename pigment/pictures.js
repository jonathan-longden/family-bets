/* Pigment — the built-in pictures.

   Every picture is drawn onto a grid of palette numbers by the code below
   rather than shipped as an image. A picture costs a few dozen lines instead
   of a download, which is what lets the whole app come in under the size of
   one photograph and work with no signal at all. */
(() => {
  'use strict';

  // Number 0 is the paper: it is never given a swatch and never needs
  // colouring in. Everything from 1 up is a colour with a number on it.
  const PAPER = 0;

  /* How many grid squares each drawing unit becomes. The pictures are
     authored on a grid of about 32 by 40 units; drawing them five times
     finer is what turns a staircase of squares into a curve, and gives the
     shading room to fall in bands rather than steps. */
  const DETAIL = 5;

  // ------------------------------------------------------------- colour

  const hexToRgb = (hex) =>
    [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];

  const toHex = (r, g, b) => '#' + [r, g, b]
    .map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');

  function blend(a, b, amount) {
    const x = hexToRgb(a), y = hexToRgb(b);
    return toHex(x[0] + (y[0] - x[0]) * amount, x[1] + (y[1] - x[1]) * amount, x[2] + (y[2] - x[2]) * amount);
  }

  /* A run of tones from one colour: darkest first, lightest last. Shadows
     lean towards a cold blue and highlights towards a warm white, the way
     they do in daylight — a ramp made by turning the brightness up and down
     alone comes out looking like plastic. */
  const SHADOW = '#1c2340';
  const HIGHLIGHT = '#fffaf0';

  function tones(hex, count, options) {
    const o = Object.assign({ dark: 0.46, light: 0.34 }, options || {});
    const out = [];
    for (let i = 0; i < count; i++) {
      const t = count === 1 ? 0.5 : i / (count - 1);
      out.push(t < 0.5
        ? blend(hex, SHADOW, (0.5 - t) * 2 * o.dark)
        : blend(hex, HIGHLIGHT, (t - 0.5) * 2 * o.light));
    }
    return out;
  }

  // Names for the swatches of a ramp, dark end to light end.
  const TONE_NAMES = {
    1: [''],
    2: ['Dark ', ''],
    3: ['Dark ', '', 'Light '],
    4: ['Darkest ', 'Dark ', '', 'Light '],
    5: ['Darkest ', 'Dark ', '', 'Light ', 'Palest '],
    6: ['Darkest ', 'Deep ', 'Dark ', '', 'Light ', 'Palest '],
    7: ['Darkest ', 'Deep ', 'Dark ', '', 'Light ', 'Lighter ', 'Palest '],
  };

  // ------------------------------------------------------------ the grid

  /* Pictures are drawn in whole units — the balloon is nine units across —
     but the grid underneath is `detail` times finer than that. Every
     coordinate is multiplied on the way in, so the same drawing code gives
     a coarse grid or a fine one, and curves come out smoother rather than
     bigger. Only `set` works in grid squares, because the things that use it
     (eyes, specks) are drawn square by square on purpose. */
  function grid(units, unitRows, detail) {
    const step = detail || 1;
    const cols = Math.round(units * step), rows = Math.round(unitRows * step);
    const cells = new Uint8Array(cols * rows);
    const u = (value) => value * step;

    const g = {
      cols, rows, cells, detail: step, units, unitRows,

      // one drawing unit, filled in as a block of grid squares
      set(x, y, i) {
        const x0 = Math.round(u(x)), y0 = Math.round(u(y));
        for (let dy = 0; dy < step; dy++) {
          for (let dx = 0; dx < step; dx++) {
            const xx = x0 + dx, yy = y0 + dy;
            if (xx >= 0 && yy >= 0 && xx < cols && yy < rows) cells[yy * cols + xx] = i;
          }
        }
        return g;
      },

      get(x, y) {
        const xx = Math.round(u(x)), yy = Math.round(u(y));
        if (xx < 0 || yy < 0 || xx >= cols || yy >= rows) return -1;
        return cells[yy * cols + xx];
      },

      // straight to a grid square, for the primitives below
      poke(x, y, i) {
        x = Math.round(x); y = Math.round(y);
        if (x >= 0 && y >= 0 && x < cols && y < rows) cells[y * cols + x] = i;
        return g;
      },

      fill(i) { cells.fill(i); return g; },

      rect(x, y, w, h, i) {
        const x0 = Math.round(u(x)), y0 = Math.round(u(y));
        const x1 = Math.round(u(x + w)), y1 = Math.round(u(y + h));
        for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) g.poke(xx, yy, i);
        return g;
      },

      band(y0, y1, i) { return g.rect(0, y0, units, y1 - y0 + 1, i); },

      // Fractional centres and radii are allowed — cells are sampled at their
      // middle, so a circle can sit between two columns and still look round.
      ellipseEach(cx, cy, rx, ry, fn) {
        cx = u(cx); cy = u(cy); rx = u(rx); ry = u(ry);
        const y0 = Math.max(0, Math.floor(cy - ry)), y1 = Math.min(rows - 1, Math.ceil(cy + ry));
        const x0 = Math.max(0, Math.floor(cx - rx)), x1 = Math.min(cols - 1, Math.ceil(cx + rx));
        for (let y = y0; y <= y1; y++) {
          for (let x = x0; x <= x1; x++) {
            const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry;
            if (dx * dx + dy * dy <= 1) fn(x, y, dx, dy);
          }
        }
        return g;
      },

      ellipse(cx, cy, rx, ry, i) {
        return g.ellipseEach(cx, cy, rx, ry, (x, y) => g.poke(x, y, i));
      },

      disc(cx, cy, r, i) { return g.ellipse(cx, cy, r, r, i); },

      ring(cx, cy, rx, ry, thickness, i) {
        const inner = 1 - thickness / Math.min(rx, ry);
        return g.ellipseEach(cx, cy, rx, ry, (x, y, dx, dy) => {
          if (dx * dx + dy * dy >= inner * inner) g.poke(x, y, i);
        });
      },

      // Even-odd scanline fill, sampling at cell centres.
      /* The shading primitives below all work the same way: walk the squares
         of a shape and let the caller decide which tone each one takes. */
      polyEach(points, fn) {
        const marker = 255;
        const before = Uint8Array.from(cells);
        g.poly(points, marker);
        for (let y = 0; y < rows; y++) {
          for (let x = 0; x < cols; x++) {
            const k = y * cols + x;
            if (cells[k] !== marker) continue;
            cells[k] = before[k];
            fn(x, y);
          }
        }
        return g;
      },

      rectEach(x, y, w, h, fn) {
        const x0 = Math.round(u(x)), y0 = Math.round(u(y));
        const x1 = Math.round(u(x + w)), y1 = Math.round(u(y + h));
        for (let yy = Math.max(0, y0); yy < Math.min(rows, y1); yy++) {
          for (let xx = Math.max(0, x0); xx < Math.min(cols, x1); xx++) fn(xx, yy);
        }
        return g;
      },

      /* Shade a shape as though it were round: the tone of a square comes
         from how square-on it faces the light, worked out from where it sits
         on the ball. This is what makes a balloon look inflated and a cherry
         look like fruit rather than a red circle.

         `texture` is handed the position in drawing units and returns
         something to add to the brightness, which is how a rock gets to be
         round *and* mottled. */
      sphere(cx, cy, rx, ry, ramp, options) {
        const o = Object.assign({ lx: -0.62, ly: -0.66, ambient: 0.42, spread: 0.72 }, options || {});
        return g.ellipseEach(cx, cy, rx, ry, (x, y, dx, dy) => {
          const flat = Math.min(1, dx * dx + dy * dy);
          const nz = Math.sqrt(1 - flat);
          let lit = o.ambient + o.spread * (dx * o.lx + dy * o.ly + nz * 0.55);
          if (o.texture) lit += o.texture((x + 0.5) / step, (y + 0.5) / step);
          if (lit < 0) return;                       // below zero means leave it alone
          g.poke(x, y, ramp[level(lit, ramp.length)]);
        });
      },

      /* The general case: fill a shape, deciding each square's brightness
         from where it is. Everything above is a special case of this one. */
      /* A brightness below zero leaves the square as it was, which is how a
         cloud gets a ragged edge instead of the outline of the ellipse it
         was drawn inside. */
      shadeEach(shape, ramp, brightness) {
        const paint = (x, y) => {
          const t = brightness((x + 0.5) / step, (y + 0.5) / step);
          if (t < 0) return;
          g.poke(x, y, ramp[level(t, ramp.length)]);
        };
        if (typeof shape === 'function') shape(paint);
        else g.polyEach(shape, paint);
        return g;
      },

      // Shade along a line: from (ax, ay) to (bx, by), dark end to light end.
      gradient(shape, ramp, ax, ay, bx, by, flip) {
        const dx = bx - ax, dy = by - ay;
        const length = dx * dx + dy * dy || 1;
        const paint = (x, y) => {
          const t = (((x + 0.5) / step - ax) * dx + ((y + 0.5) / step - ay) * dy) / length;
          g.poke(x, y, ramp[level(flip ? 1 - t : t, ramp.length)]);
        };
        if (typeof shape === 'function') shape(paint);
        else g.polyEach(shape, paint);
        return g;
      },

      poly(points, i) {
        const pts = points.map(([x, y]) => [u(x), u(y)]);
        let minY = Infinity, maxY = -Infinity;
        for (const p of pts) { if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1]; }
        const y0 = Math.max(0, Math.floor(minY)), y1 = Math.min(rows - 1, Math.ceil(maxY));
        for (let y = y0; y <= y1; y++) {
          const yc = y + 0.5, xs = [];
          for (let k = 0; k < pts.length; k++) {
            const a = pts[k], b = pts[(k + 1) % pts.length];
            if ((a[1] <= yc) !== (b[1] <= yc)) {
              xs.push(a[0] + (yc - a[1]) / (b[1] - a[1]) * (b[0] - a[0]));
            }
          }
          xs.sort((p, q) => p - q);
          for (let k = 0; k + 1 < xs.length; k += 2) {
            const from = Math.ceil(xs[k] - 0.5), to = Math.floor(xs[k + 1] - 0.5);
            for (let x = from; x <= to; x++) g.poke(x, y, i);
          }
        }
        return g;
      },

      line(x0, y0, x1, y1, i, thickness) {
        const t = thickness || 1;
        const steps = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * step * 2) + 1;
        for (let s = 0; s <= steps; s++) {
          const f = s / steps, x = x0 + (x1 - x0) * f, y = y0 + (y1 - y0) * f;
          g.disc(x + 0.5 / step, y + 0.5 / step, t / 2, i);
        }
        return g;
      },

      /* Text-art for the fiddly bits — eyes, beaks, sprinkles. Each string is
         a row, each character an index into `map`; a space leaves the cell
         alone so a sprite can be laid over what is already there. */
      stamp(x0, y0, art, map) {
        art.forEach((row, dy) => {
          for (let dx = 0; dx < row.length; dx++) {
            const ch = row[dx];
            if (ch === ' ') continue;
            g.set(x0 + dx, y0 + dy, map[ch]);
          }
        });
        return g;
      },

      /* Draw one half, get the other free. Everything symmetrical is drawn
         left of centre and folded across.

         `except` names the colours the fold should leave where they are —
         a background painted before the fold would otherwise have its right
         half replaced by a mirror image of its left. */
      mirror(except) {
        const skip = new Set(except || []);
        const half = Math.floor(cols / 2);
        for (let y = 0; y < rows; y++) {
          for (let x = 0; x < half; x++) {
            const v = cells[y * cols + x];
            if (skip.has(v)) continue;
            cells[y * cols + (cols - 1 - x)] = v;
          }
        }
        return g;
      },

      replace(from, to) {
        for (let k = 0; k < cells.length; k++) if (cells[k] === from) cells[k] = to;
        return g;
      },

      each(fn) {
        for (let y = 0; y < rows; y++) {
          for (let x = 0; x < cols; x++) {
            const out = fn(x, y, cells[y * cols + x]);
            if (out !== undefined) cells[y * cols + x] = out;
          }
        }
        return g;
      },

      // Speckle a few cells of `i` about, deterministically — the same
      // picture has to come out the same way on every device and every load.
      speckle(count, i, seed, region) {
        let s = seed >>> 0;
        const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
        for (let k = 0, guard = 0; k < count && guard < count * 40; guard++) {
          const x = Math.floor(rnd() * units), y = Math.floor(rnd() * unitRows);
          if (region && !region(x, y, g.get(x, y))) continue;
          g.set(x, y, i);
          k++;
        }
        return g;
      },
    };

    return g;
  }

  // Which tone of a ramp a brightness between 0 and 1 lands on.
  const level = (t, count) => Math.max(0, Math.min(count - 1, Math.round(t * (count - 1))));

  /* ------------------------------------------------------------- texture

     Flat tone bands look like cut paper. Real leather, rock, sand and cloth
     are mottled, and it's that mottling — as much as the shading — that
     makes a drawn surface read as a material.

     This is ordinary value noise: a fixed random number at every whole
     coordinate, smoothly blended in between, then summed at halving scales
     ("fractional Brownian motion") so the result has both broad patches and
     fine grain. It's a pure function of the seed, so a picture comes out
     identical every time it is built. */
  function noise(seed) {
    const at = (x, y) => {
      let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 1013904223)) | 0;
      h = Math.imul(h ^ (h >>> 13), 1274126177);
      return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
    };
    const ease = (t) => t * t * (3 - 2 * t);

    const value = (x, y) => {
      const xi = Math.floor(x), yi = Math.floor(y);
      const tx = ease(x - xi), ty = ease(y - yi);
      const top = at(xi, yi) + (at(xi + 1, yi) - at(xi, yi)) * tx;
      const bottom = at(xi, yi + 1) + (at(xi + 1, yi + 1) - at(xi, yi + 1)) * tx;
      return top + (bottom - top) * ty;
    };

    // octaves of noise, each half the size and half the strength
    const fbm = (x, y, octaves) => {
      let total = 0, amplitude = 1, weight = 0, scale = 1;
      for (let i = 0; i < (octaves || 3); i++) {
        total += value(x * scale, y * scale) * amplitude;
        weight += amplitude;
        amplitude *= 0.5;
        scale *= 2;
      }
      return total / weight;
    };

    // -1..1, for pushing a coordinate about rather than lighting it
    const warp = (x, y) => value(x, y) * 2 - 1;

    return { value, fbm, warp };
  }

  // --------------------------------------------------------- the pictures

  const PICTURES = [];

  const picture = (def) => { PICTURES.push(def); };

  /* A bird in the distance: two strokes, not a stamp. `stamp` works in whole
     drawing units, so at this resolution it would put down a pair of blocks
     the size of the balloon's basket. */
  const bird = (g, x, y, size, colour) => {
    g.line(x - size, y, x, y - size * 0.55, colour, 0.32);
    g.line(x, y - size * 0.55, x + size, y, colour, 0.32);
  };

  // Scattering rocks, grass and stars needs to land in the same place every
  // time: the picture has to come out identical on every device and reload.
  const rng = (seed) => {
    let s = seed >>> 0;
    return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  };

  picture({
    id: 'balloon',
    name: 'Up and Away',
    blurb: 'A balloon over the hills',
    cols: 32, rows: 40,
    palette: [
      { ramp: '#79c4f2', name: 'Sky', tones: 8 },
      { ramp: '#ffffff', name: 'Cloud', tones: 4, dark: 0.24 },
      { hex: '#ffe08a', name: 'Sun glow' },
      { hex: '#ffd23f', name: 'Sunshine' },
      { ramp: '#e8433f', name: 'Red', tones: 5 },
      { ramp: '#f7e3c0', name: 'Cream', tones: 4, dark: 0.34 },
      { ramp: '#ff8a3d', name: 'Orange', tones: 4 },
      { ramp: '#3fb07a', name: 'Green', tones: 7 },
      { ramp: '#9c6a34', name: 'Basket', tones: 4 },
      { hex: '#3b2a1d', name: 'Rope' },
    ],
    draw(g, c) {
      const [sky, cloud, glow, sun, red, cream, orange, green, basket, rope] = c;
      const random = rng(4021);

      // sky, darkest overhead and palest at the horizon
      g.gradient(paint => g.rectEach(0, 0, 32, 30, paint), sky, 0, 0, 0, 29);

      g.disc(26.5, 6.5, 4.8, glow);
      g.disc(26.5, 6.5, 3.2, sun);

      // clouds: each puff shaded as a ball, so they sit in the air
      const puff = (x, y, w, h) => {
        g.sphere(x, y, w, h, cloud, { ly: -0.5 });
        g.sphere(x - w * 0.55, y + h * 0.3, w * 0.55, h * 0.7, cloud, { ly: -0.5 });
        g.sphere(x + w * 0.5, y + h * 0.35, w * 0.5, h * 0.62, cloud, { ly: -0.5 });
      };
      puff(6, 7.5, 3.8, 2);
      puff(24, 19, 3.2, 1.7);
      puff(4.5, 23.5, 2.9, 1.5);

      // hills, back to front, each lit along its top
      g.gradient(paint => g.ellipseEach(27, 33, 15, 7, paint), green, 0, 40, 0, 26);
      g.gradient(paint => g.ellipseEach(4, 34, 16, 7, paint), green, 0, 41, 0, 27);
      g.gradient(paint => g.rectEach(0, 34, 32, 6, paint), green, 0, 41, 0, 32);
      g.gradient(paint => g.ellipseEach(16, 42, 16, 7, paint), green, 0, 45, 0, 34);

      // a row of trees along the far hill
      for (const [tx, ty, size] of [[6, 29.4, 1.6], [9, 28.8, 1.3], [12.5, 29.6, 1.1],
        [21, 28.8, 1.3], [24.5, 29.2, 1.7], [28, 29.8, 1.2]]) {
        g.poly([[tx, ty - size * 2.2], [tx + size, ty + size], [tx - size, ty + size]], green[1]);
        g.poly([[tx, ty - size * 2.2], [tx + size * 0.35, ty + size], [tx - size, ty + size]], green[2]);
        g.rect(tx - 0.28, ty + size - 0.2, 0.56, 1.1, rope);
      }

      /* The envelope: five gores of alternating colour, each shaded as part
         of one ball rather than on its own, which is what stops it looking
         like five flat stripes side by side. */
      const gores = [red, cream, orange, cream, red];
      const shade = (ramp, dx, dy) => {
        const nz = Math.sqrt(Math.max(0, 1 - dx * dx - dy * dy));
        return ramp[level(0.4 + 0.74 * (dx * -0.6 + dy * -0.5 + nz * 0.55), ramp.length)];
      };
      g.ellipseEach(16, 15, 9.5, 11, (x, y, dx, dy) => {
        g.poke(x, y, shade(gores[Math.min(4, Math.floor((dx + 1) / 2 * 5))], dx, dy));
      });

      // the taper down to the basket keeps the same gores
      g.polyEach([[8, 22], [24, 22], [19, 29], [13, 29]], (x, y) => {
        const dx = ((x + 0.5) / g.detail - 16) / 8;
        const dy = ((y + 0.5) / g.detail - 25) / 5;
        g.poke(x, y, shade(gores[Math.min(4, Math.floor((dx + 1) / 2 * 5))], dx * 0.8, dy * 0.4));
      });

      // rigging and basket
      g.line(13, 28.5, 12.6, 32, rope, 0.45);
      g.line(19, 28.5, 19.4, 32, rope, 0.45);
      g.gradient(paint => g.rectEach(12.5, 32, 7, 4.6, paint), basket, 19.5, 0, 12.5, 0);
      g.rect(12.5, 33.2, 7, 0.7, rope);
      g.rect(12.5, 35.1, 7, 0.7, rope);

      // a second balloon, far off
      g.sphere(4, 15, 2, 2.3, red);
      g.rect(3.6, 17.6, 0.9, 0.8, basket[1]);

      // grass tufts and stones on the near hill
      for (let i = 0; i < 26; i++) {
        const x = random() * 31 + 0.5, y = 34.5 + random() * 5;
        const tall = 0.7 + random() * 0.9;
        g.poly([[x, y - tall], [x + 0.45, y + 0.3], [x - 0.45, y + 0.3]], green[random() < 0.5 ? 1 : 5]);
      }
      for (let i = 0; i < 9; i++) {
        const x = random() * 30 + 1, y = 36 + random() * 3.4;
        g.sphere(x, y, 0.55 + random() * 0.4, 0.4 + random() * 0.3, basket);
      }

      // wild flowers dotted through the near grass
      for (let i = 0; i < 16; i++) {
        const x = random() * 30.5 + 0.7, y = 35 + random() * 4.2;
        g.disc(x, y, 0.34, [red[3], cream[3], orange[3]][Math.floor(random() * 3)]);
      }

      for (const [x, y, size] of [[2.5, 20, 0.9], [28, 23, 0.8], [21, 12, 0.7],
        [9, 24.5, 0.6], [24.5, 26, 0.55]]) {
        bird(g, x, y, size, rope);
      }
    },
  });

  picture({
    id: 'rocket',
    name: 'Blast Off',
    blurb: 'A rocket, a ringed planet',
    cols: 32, rows: 40,
    palette: [
      { ramp: '#1b2350', name: 'Space', tones: 5, dark: 0.55, light: 0.5 },
      { ramp: '#4a4bb0', name: 'Nebula', tones: 4 },
      { hex: '#fff6c9', name: 'Starlight' },
      { ramp: '#dfe6ff', name: 'Hull', tones: 5, dark: 0.4 },
      { ramp: '#e8433f', name: 'Red', tones: 4 },
      { ramp: '#35e7ff', name: 'Window', tones: 3 },
      { ramp: '#ffb02e', name: 'Flame', tones: 5, light: 0.5 },
      { ramp: '#b46bff', name: 'Planet', tones: 5 },
      { ramp: '#6a3fb5', name: 'Ring', tones: 3 },
    ],
    draw(g, c) {
      const [space, nebula, star, hull, red, window_, flame, planet, ring] = c;
      const random = rng(90210);

      /* Deep space, darkest at the corners. A straight top-to-bottom
         gradient leaves the bottom half flooded with the palest tone, which
         reads as fog rather than distance. */
      g.fill(space[0]);
      g.sphere(16, 19, 21, 25, space, { ambient: 0.35, spread: 0.55, lx: 0, ly: 0 });
      for (const [x, y, rx, ry] of [[26, 31, 10, 7], [6, 9, 9.5, 7.5], [17, 36, 7, 4.5]]) {
        g.sphere(x, y, rx, ry, nebula, { ambient: 0.42, spread: 0.42, lx: -0.2, ly: -0.3 });
      }

      // planet with a ring tilted across it, and a moon
      g.ring(6.5, 8, 7.6, 3.1, 1.3, ring[1]);
      g.ring(6.5, 8, 7.6, 3.1, 0.6, ring[2]);
      g.sphere(6.5, 8, 4.3, 4.3, planet);
      g.sphere(27, 12.5, 1.7, 1.7, hull);

      /* Drawn down the left and folded across, so the lighting is put on
         afterwards: a fold would mirror the lit side over as well. */
      g.poly([[16, 4], [12, 13], [16, 13]], red[2]);
      g.poly([[12, 13], [11, 27], [16, 27], [16, 13]], hull[3]);
      g.poly([[11, 19.5], [6.8, 29], [11, 29]], red[2]);
      g.rect(11, 27, 5, 2, hull[1]);
      g.rect(11, 16.6, 5, 1.1, hull[1]);
      g.rect(11, 23.5, 5, 0.9, hull[1]);
      g.disc(16, 20, 3, hull[1]);
      g.disc(16, 20, 2.2, window_[1]);
      g.mirror([...space, ...nebula, star, ...planet, ...ring, hull[0], hull[1], hull[2], hull[4]]);

      // the body as a cylinder: bright down one side, dark down the other
      g.gradient(paint => g.polyEach([[12, 13], [11, 29], [21, 29], [20, 13]], paint), hull, 21.5, 0, 12, 0);
      g.gradient(paint => g.polyEach([[16, 4], [12, 13], [20, 13]], paint), red, 21, 0, 12.5, 0);
      g.gradient(paint => g.polyEach([[11, 19.5], [6.8, 29], [11, 29]], paint), red, 6, 0, 11.5, 0);
      g.gradient(paint => g.polyEach([[21, 19.5], [25.2, 29], [21, 29]], paint), red, 26, 0, 20.5, 0);
      g.rect(11, 27, 10, 2, hull[1]);
      g.rect(11, 16.6, 10, 1.1, hull[1]);
      g.rect(11, 23.5, 10, 0.9, hull[1]);
      g.sphere(16, 20, 3, 3, hull, { lx: -0.5, ly: -0.6 });
      g.sphere(16, 20, 2.2, 2.2, window_, { lx: -0.6, ly: -0.7 });

      // exhaust, hottest in the middle
      g.gradient(paint => g.ellipseEach(16, 33, 4.2, 6, paint), flame, 16, 40, 16, 28);
      g.gradient(paint => g.ellipseEach(16, 32, 2.6, 4.4, paint), flame, 16, 38, 16, 27);
      g.poly([[10, 29], [22, 29], [21, 30.5], [11, 30.5]], flame[0]);

      // panel lines and bolts down the hull
      for (const y of [14.6, 21.6, 25.4]) g.rect(11.4, y, 9.2, 0.3, hull[1]);
      for (const [x, y] of [[12.2, 15.6], [19.6, 15.6], [12.2, 26.4], [19.6, 26.4]]) {
        g.disc(x, y, 0.36, hull[0]);
      }
      for (let i = 0; i < 6; i++) g.disc(12 + i * 0.5, 28, 0.22, hull[0]);

      // a few tumbling rocks
      for (const [x, y, r] of [[3.5, 21, 1.1], [29, 27, 0.9], [24.5, 17, 0.7], [6, 35, 0.8]]) {
        g.sphere(x, y, r, r * 0.82, hull, { ambient: 0.3, spread: 0.5 });
      }

      // stars: a scattering of dots and a few with points
      for (let i = 0; i < 70; i++) {
        const x = random() * 31.4 + 0.3, y = random() * 39 + 0.3;
        if (x > 9.5 && x < 22.5 && y > 3 && y < 38) continue;      // keep off the rocket
        g.disc(x, y, 0.26 + random() * 0.24, star);
      }
      for (const [x, y] of [[4, 30], [28, 22], [22, 6], [10, 36]]) {
        g.stamp(Math.round(x), Math.round(y), [' s ', 'sss', ' s '], { s: star });
      }
    },
  });

  picture({
    id: 'butterfly',
    name: 'Painted Lady',
    blurb: 'Wings, spot for spot',
    cols: 40, rows: 32,
    palette: [
      { ramp: '#fbf1dc', name: 'Paper', tones: 4, dark: 0.2 },
      { ramp: '#f6a01f', name: 'Amber', tones: 5 },
      { ramp: '#e8622a', name: 'Rust', tones: 5 },
      { hex: '#2b2431', name: 'Ink' },
      { hex: '#ffffff', name: 'White' },
      { ramp: '#7bc8e8', name: 'Sky blue', tones: 3 },
      { ramp: '#8cc63f', name: 'Leaf', tones: 4 },
      { ramp: '#e8759f', name: 'Blossom', tones: 4 },
      { ramp: '#6b4a2f', name: 'Body', tones: 4 },
    ],
    draw(g, c) {
      const [paper, amber, rust, ink, white, blue, leaf, blossom, body] = c;
      const random = rng(1177);

      // paper, with a soft pool of light behind the butterfly
      g.fill(paper[3]);
      g.sphere(20, 15, 19, 16, paper, { ambient: 0.55, spread: 0.45, lx: -0.3, ly: -0.4 });

      // upper wing and lower wing, shaded from the body outwards
      const upper = [[19, 6], [6, 2], [1, 9], [4, 16], [19, 15]];
      const lower = [[19, 16], [7, 18], [3, 25], [10, 30], [19, 25]];
      g.gradient(paint => g.polyEach(upper, paint), amber, 1, 9, 19, 10);
      g.gradient(paint => g.polyEach(lower, paint), rust, 2, 25, 19, 20);

      // the dark edging, with pale scallops set into it
      for (const [x0, y0, x1, y1] of [[6, 2, 1, 9], [1, 9, 4, 16], [6, 2, 19, 6],
        [3, 25, 10, 30], [7, 18, 3, 25], [10, 30, 19, 25]]) {
        g.line(x0, y0, x1, y1, ink, 1.5);
      }
      for (const [x, y] of [[3.6, 5.6], [1.9, 9.4], [3.2, 13.2], [9.5, 3.2], [14, 4.4],
        [4.6, 22.6], [7.4, 27.6], [12.6, 28.6]]) {
        g.disc(x, y, 0.85, white);
      }

      // spots, each an eye of ink with something bright inside
      for (const [x, y, r, inner, fill] of [
        [6.2, 6.6, 1.8, 1, white], [9.6, 11.6, 2, 1.2, blue], [14.4, 9.6, 1.5, 0.8, white],
        [7.4, 22.4, 1.8, 1, white], [12.4, 26, 1.6, 0.9, blue], [15.4, 20.4, 1.35, 0.7, white],
      ]) {
        g.disc(x, y, r, ink);
        if (fill === blue) g.sphere(x, y, inner, inner, blue);
        else g.disc(x, y, inner, white);
      }
      // freckles along the wing edges
      for (let i = 0; i < 22; i++) {
        const x = 2 + random() * 15, y = 3 + random() * 25;
        if (g.get(x, y) === ink || g.get(x, y) === paper[3]) continue;
        g.disc(x, y, 0.3 + random() * 0.22, random() < 0.4 ? ink : amber[4]);
      }

      g.mirror(paper);

      // body, head and antennae down the centre line
      g.sphere(20, 16, 1.8, 11, body, { lx: -0.7, ly: -0.1 });
      g.sphere(20, 4.6, 2.2, 2.2, body);
      g.line(19, 4, 14.6, 0.6, ink, 0.5);
      g.line(21, 4, 25.4, 0.6, ink, 0.5);
      g.disc(14.4, 0.6, 0.9, ink);
      g.disc(25.6, 0.6, 0.9, ink);
      g.disc(19.2, 3.7, 0.5, white);
      g.disc(20.8, 3.7, 0.5, white);
      for (let y = 8; y < 26; y += 2.4) g.rect(18.6, y, 2.8, 0.5, body[0]);

      // a sprig either side, with a flower on it
      const sprig = (x0, y0, x1, y1, flip) => {
        g.line(x0, y0, x1, y1, leaf[0], 0.6);
        for (const at of [0.3, 0.55, 0.8]) {
          const lx = x0 + (x1 - x0) * at, ly = y0 + (y1 - y0) * at + (at * 6 - 3) * 0.12 * flip;
          g.sphere(lx, ly - 0.7 * flip, 1.8, 0.95, leaf);
        }
        g.sphere(x1, y1, 1.6, 1.6, blossom);
        g.disc(x1, y1, 0.55, white);
      };
      sprig(0.5, 31.4, 6, 28, 1);
      sprig(39.5, 31.4, 34, 28, -1);
    },
  });

  picture({
    id: 'spaniel',
    name: 'Good Dog',
    blurb: 'A springer spaniel, ears and all',
    cols: 32, rows: 36,
    palette: [
      { ramp: '#ffd166', name: 'Gold', tones: 6 },
      { ramp: '#f5efe6', name: 'White', tones: 5, dark: 0.32 },
      { ramp: '#a05a2c', name: 'Liver', tones: 6 },
      { ramp: '#2b2028', name: 'Ink', tones: 3, light: 0.5 },
      { ramp: '#ff9db1', name: 'Tongue', tones: 3 },
      { ramp: '#7ec4a8', name: 'Collar', tones: 4 },
    ],
    draw(g, c) {
      const [gold, white, liver, ink, tongue, collar] = c;
      const random = rng(7788);
      // a spaniel's ears are the hairiest thing about it, so they get the
      // strongest mottle and the muzzle the softest
      const coat = noise(4141);
      const hairy = (amount) => (ux, uy) => coat.fbm(ux * 1.7, uy * 2.4, 3) * amount - amount / 2;

      // a warm pool of light behind the dog
      g.fill(gold[5]);
      g.sphere(16, 16, 15.5, 15.5, gold, { ambient: 0.5, spread: 0.5 });

      // ears behind the head, each rounded off down its length
      g.sphere(5, 21, 5.7, 11, liver, { lx: -0.75, ly: -0.2, texture: hairy(0.3) });
      // head and the liver cap over it
      g.sphere(16, 16, 9.2, 9.6, white, { lx: -0.55, ly: -0.6 });
      g.gradient(paint => g.polyEach([[6.4, 9], [16, 6.4], [16, 13], [7.9, 13.6]], paint),
        liver, 6, 14, 14, 7);

      // eye
      g.disc(11, 16.5, 2.2, ink[0]);
      g.disc(11.8, 15.7, 0.62, white[4]);
      g.disc(10.3, 17.4, 0.34, white[4]);

      // muzzle
      g.sphere(16, 22, 6.6, 5.6, white, { lx: -0.5, ly: -0.65, texture: hairy(0.1) });
      g.sphere(13.2, 24.6, 3.2, 2.6, white, { lx: -0.4, ly: -0.5, ambient: 0.3 });
      for (let i = 0; i < 14; i++) {
        const x = 10.6 + random() * 4.6, y = 22 + random() * 3.4;
        g.disc(x, y, 0.28 + random() * 0.16, liver[random() < 0.5 ? 1 : 2]);
      }

      g.mirror(gold);

      // nose, mouth and tongue on the centre line
      g.sphere(16, 20.4, 3, 2.2, ink, { lx: -0.5, ly: -0.85, ambient: 0.3, spread: 0.55 });
      g.line(16, 22, 16, 24, ink[0], 0.45);
      g.line(16, 24, 13.4, 25.2, ink[0], 0.45);
      g.line(16, 24, 18.6, 25.2, ink[0], 0.45);
      g.sphere(16, 27.2, 2.5, 2.4, tongue, { ly: -0.7 });

      // collar, its stitching, and the tag
      g.gradient(paint => g.polyEach([[5.5, 30], [26.5, 30], [24, 34.6], [8, 34.6]], paint),
        collar, 0, 35, 0, 29.5);
      for (let x = 7; x < 25.5; x += 1.9) g.rect(x, 31.4, 0.8, 0.4, collar[0]);
      g.sphere(16, 33.4, 1.9, 1.9, gold, { ambient: 0.45 });

      // the odd liver patch on the white, the way a springer is marked
      for (const [x, y, rx, ry] of [[13.4, 12.6, 1.5, 1.1], [18.6, 12.6, 1.5, 1.1],
        [9.6, 21.4, 1.7, 1.3], [22.4, 21.4, 1.7, 1.3], [16, 10.4, 1.2, 0.9]]) {
        g.sphere(x, y, rx, ry, liver, { ambient: 0.45, spread: 0.4 });
      }

      // collar, its stitching, and the tag
      g.gradient(paint => g.polyEach([[5.5, 30], [26.5, 30], [24, 34.6], [8, 34.6]], paint),
        collar, 0, 35, 0, 29.5);
      for (let x = 7; x < 25.5; x += 1.9) g.rect(x, 31.4, 0.8, 0.4, collar[0]);
      g.sphere(16, 33.4, 1.9, 1.9, gold, { ambient: 0.45 });

      // the odd liver patch on the white, the way a springer is marked
      for (const [x, y, rx, ry] of [[13.4, 12.6, 1.5, 1.1], [18.6, 12.6, 1.5, 1.1],
        [9.6, 21.4, 1.7, 1.3], [22.4, 21.4, 1.7, 1.3], [16, 10.4, 1.2, 0.9]]) {
        g.sphere(x, y, rx, ry, liver, { ambient: 0.45, spread: 0.4 });
      }

      // a wisp of hair off each ear tip
      for (const side of [-1, 1]) {
        for (const [at, size] of [[0.2, 0.9], [0.55, 1.1], [0.85, 0.8]]) {
          const x = 16 + side * (10.2 + at * 1.4);
          const y = 24 + at * 6;
          g.poly([[x + side * size * 2.2, y + size * 1.6], [x, y - size], [x, y + size]], liver[1]);
        }
      }
    },
  });

  picture({
    id: 'sailboat',
    name: 'Evening Sail',
    blurb: 'A boat, a sun going down',
    cols: 40, rows: 32,
    palette: [
      { ramp: '#f0736f', name: 'Sky', tones: 7, dark: 0.5, light: 0.45 },
      { hex: '#fff6d8', name: 'Sun' },
      { ramp: '#ffcf9c', name: 'Cloud', tones: 4 },
      { ramp: '#fff3d1', name: 'Sail', tones: 4, dark: 0.3 },
      { ramp: '#2f5d8a', name: 'Sea', tones: 6 },
      { ramp: '#f7b733', name: 'Reflection', tones: 3 },
      { ramp: '#7a3b2e', name: 'Hull', tones: 4 },
      { hex: '#3a2118', name: 'Mast' },
    ],
    draw(g, c) {
      const [sky, sun, cloud, sail, sea, reflect, hull, mast] = c;
      const random = rng(5150);
      const swell = noise(8181);

      // sky burning down towards the horizon, then the sea below it
      g.gradient(paint => g.rectEach(0, 0, 40, 19, paint), sky, 0, 0, 0, 18.5);
      g.sphere(27, 19, 7.5, 6, [sky[5], sky[6], cloud[3], sun], { ambient: 0.5, spread: 0.5, ly: 0.2 });
      g.disc(27, 19, 5.2, sun);
      /* Water was three flat bands. Shading it with a long, low noise gives
         the swell its own light and dark without drawing a single wave. */
      g.shadeEach(paint => g.rectEach(0, 19, 40, 13, paint), sea, (ux, uy) =>
        0.92 - (uy - 19) / 13 * 0.55 + swell.fbm(ux * 0.45, uy * 2.8, 3) * 0.5 - 0.25);

      // streaks of cloud
      const streak = (x, y, w, h) => {
        g.sphere(x, y, w, h, cloud, { ly: -0.55 });
        g.sphere(x - w * 0.55, y + h * 0.25, w * 0.5, h * 0.65, cloud, { ly: -0.55 });
        g.sphere(x + w * 0.5, y + h * 0.3, w * 0.45, h * 0.6, cloud, { ly: -0.55 });
      };
      streak(9, 3.5, 6, 1.2);
      streak(30, 6.5, 5.5, 1.1);
      streak(6, 9.5, 4.5, 0.95);
      streak(33, 13, 4, 0.85);

      // the sun's path, breaking up as it comes towards you
      let width = 4.8;
      for (let y = 19.4; y < 32; y += 1.7) {
        const wobble = (random() - 0.5) * 2.4;
        g.sphere(27 + wobble, y, width, 0.55, reflect, { ambient: 0.6, spread: 0.4 });
        if (random() < 0.6) g.sphere(27 + wobble * 2.4, y + 0.7, width * 0.4, 0.4, reflect);
        width = Math.max(1.4, width * 0.86);
      }

      // mast, boom and sails
      g.line(14, 3.4, 14, 19, mast, 0.5);
      g.gradient(paint => g.polyEach([[13.2, 4.6], [13.2, 18], [4, 18]], paint), sail, 4, 18, 13, 6);
      g.gradient(paint => g.polyEach([[14.8, 7], [14.8, 18], [21, 18]], paint), sail, 21, 18, 14.9, 8);
      g.line(13.2, 4.6, 4, 18, mast, 0.4);
      g.line(14.8, 7, 21, 18, mast, 0.4);
      g.rect(3.6, 17.6, 18, 0.6, mast);
      g.poly([[14, 2], [17.5, 3], [14, 4]], hull[1]);

      // hull, and its reflection in the water
      g.gradient(paint => g.polyEach([[3, 18.6], [23, 18.6], [19, 24], [7, 24]], paint),
        hull, 0, 25, 0, 18);
      g.rect(3.2, 18.6, 19.8, 1, mast);
      g.sphere(13, 24.8, 7, 0.7, sea, { ambient: 0.35, spread: 0.3 });

      // waves running across the water
      for (let i = 0; i < 30; i++) {
        const y = 19.5 + random() * 12;
        const x = random() * 38 + 1;
        if (Math.abs(x - 27) < 6 && y > 19) continue;          // clear of the sun's path
        const width = 0.9 + random() * 2.2;
        g.sphere(x, y, width, 0.35, sea, { ambient: 0.62, spread: 0.32 });
      }

      // rigging
      g.line(13.2, 4.6, 3.6, 17.8, mast, 0.28);
      g.line(14.8, 7, 21.4, 17.8, mast, 0.28);
      g.line(14, 3.6, 22.6, 17.8, mast, 0.24);

      // gulls
      for (const [x, y, size] of [[30, 5, 1.1], [34.5, 8, 0.85], [5, 2.4, 0.9], [24, 3.2, 0.7]]) {
        bird(g, x, y, size, mast);
      }
    },
  });

  picture({
    id: 'cupcake',
    name: 'Sprinkles',
    blurb: 'A cupcake with a cherry on top',
    cols: 32, rows: 40,
    palette: [
      { ramp: '#ffd0e2', name: 'Blush', tones: 5, dark: 0.25 },
      { ramp: '#f3ecff', name: 'Frosting', tones: 5, dark: 0.3 },
      { ramp: '#ffa8cb', name: 'Rose', tones: 5 },
      { ramp: '#e04f7a', name: 'Cherry', tones: 4 },
      { ramp: '#2f9e6e', name: 'Stalk', tones: 3 },
      { ramp: '#c98a4b', name: 'Wrapper', tones: 5 },
      { hex: '#7ec8e8', name: 'Blue' },
      { hex: '#ffd23f', name: 'Yellow' },
      { hex: '#b46bff', name: 'Violet' },
      { hex: '#6fd39b', name: 'Mint' },
    ],
    draw(g, c) {
      const [blush, frosting, rose, cherry, stalk, wrapper, blue, yellow, violet, mint] = c;
      const random = rng(31415);

      g.fill(blush[4]);
      g.sphere(16, 20, 14.5, 14.5, blush, { ambient: 0.55, spread: 0.45 });

      // wrapper: a tub with pleats, rounded across
      g.gradient(paint => g.polyEach([[7, 24], [25, 24], [22, 37], [10, 37]], paint),
        wrapper, 25.5, 0, 8, 0);
      for (let x = 8.4; x < 25; x += 2.4) {
        g.line(x, 24.4, x - (x - 16) * 0.2, 37, wrapper[x > 16 ? 1 : 4], 0.45);
      }
      g.gradient(paint => g.rectEach(6.8, 23, 18.4, 1.7, paint), wrapper, 25.5, 0, 7, 0);

      // frosting: swirls, each a ball of its own
      const swirl = (x, y, rx, ry, ramp) => {
        g.sphere(x, y, rx, ry, ramp, { lx: -0.55, ly: -0.75 });
      };
      swirl(16, 21.4, 9.3, 4.8, frosting);
      swirl(11.6, 18.6, 4.9, 4.1, rose);
      swirl(20.4, 18.6, 4.9, 4.1, frosting);
      swirl(16, 16, 6.9, 4.7, rose);
      swirl(16, 12, 4.9, 3.7, frosting);
      swirl(16, 8.8, 3.1, 2.6, rose);

      // cherry
      g.sphere(16, 5.6, 2.9, 2.9, cherry);
      g.disc(15, 4.5, 0.62, blush[4]);
      g.line(16, 3.4, 19.4, 0.8, stalk[0], 0.55);
      g.sphere(21, 0.9, 2, 1.1, stalk);

      // the plate it sits on
      g.gradient(paint => g.ellipseEach(16, 37.2, 13, 2.6, paint), blush, 0, 39.5, 0, 35);
      g.gradient(paint => g.ellipseEach(16, 36.6, 10.5, 1.7, paint), frosting, 0, 38.5, 0, 35);

      // sprinkles, scattered over the frosting only
      const colours = [blue, yellow, violet, mint];
      for (let i = 0, placed = 0; i < 600 && placed < 46; i++) {
        const x = 7 + random() * 18, y = 7 + random() * 17;
        const under = g.get(x, y);
        if (!frosting.includes(under) && !rose.includes(under)) continue;
        const tilt = random() < 0.5;
        g.ellipse(x, y, tilt ? 0.9 : 0.5, tilt ? 0.5 : 0.9, colours[Math.floor(random() * 4)]);
        placed++;
      }
    },
  });

  picture({
    id: 'desert',
    name: 'Long Ride Home',
    blurb: 'Mesas, cactus, a rider',
    cols: 40, rows: 32,
    palette: [
      { ramp: '#f0a35e', name: 'Sky', tones: 7, dark: 0.5, light: 0.4 },
      { hex: '#fff2c4', name: 'Sun' },
      { ramp: '#8f6d8f', name: 'Far mesa', tones: 4 },
      { ramp: '#a4623f', name: 'Mesa', tones: 5 },
      { ramp: '#d99a5e', name: 'Sand', tones: 6 },
      { ramp: '#4f8a52', name: 'Cactus', tones: 5 },
      { ramp: '#8a6a4a', name: 'Rock', tones: 4 },
      { hex: '#2a1d1a', name: 'Shadow' },
    ],
    draw(g, c) {
      const [sky, sun, far, mesa, sand, cactus, rock, shadow] = c;
      const random = rng(60614);
      const dust = noise(3030);

      // sky burning down to the horizon, with the sun sitting on it
      g.gradient(paint => g.rectEach(0, 0, 40, 19, paint), sky, 0, 0, 0, 18.5);
      g.sphere(29, 17.5, 8, 6.5, [sky[4], sky[5], sky[6], sun], { ambient: 0.5, spread: 0.5, ly: 0.3 });
      g.disc(29, 17.5, 4.4, sun);
      for (let i = 0; i < 5; i++) {
        const y = 3 + i * 2.6;
        g.sphere(8 + i * 5.5, y, 4.5 - i * 0.35, 0.55, sky, { ambient: 0.7, spread: 0.3 });
      }

      // buttes: far ones hazy, near ones warm
      const butte = (x, y, w, h, ramp) => {
        g.gradient(paint => g.polyEach([[x - w, y + h], [x - w * 0.82, y + h * 0.15],
          [x - w * 0.6, y], [x + w * 0.6, y], [x + w * 0.86, y + h * 0.2], [x + w, y + h]], paint),
          ramp, x + w, 0, x - w, 0);
        g.gradient(paint => g.polyEach([[x - w * 0.6, y], [x + w * 0.6, y],
          [x + w * 0.66, y + 1], [x - w * 0.66, y + 1]], paint), ramp, 0, y + 1.4, 0, y - 0.4);
      };
      const striate = (x, y, w, h, ramp, count) => {
        for (let i = 0; i < count; i++) {
          const at = x - w * 0.55 + (i + 0.5) * (w * 1.1 / count);
          g.gradient(paint => g.rectEach(at - 0.28, y + 1, 0.56, h - 1.4, paint),
            ramp, at + 0.6, 0, at - 0.6, 0);
        }
      };
      butte(6, 12.5, 4.2, 6.5, far);
      striate(6, 12.5, 4.2, 6.5, far, 3);
      butte(15, 14, 3.2, 5, far);
      striate(15, 14, 3.2, 5, far, 2);
      butte(34, 11.5, 5, 7.5, mesa);
      striate(34, 11.5, 5, 7.5, mesa, 4);
      butte(24, 15, 2.6, 4, mesa);
      striate(24, 15, 2.6, 4, mesa, 2);

      // the desert floor, lit towards the horizon and grained all over
      g.shadeEach(paint => g.rectEach(0, 19, 40, 13, paint), sand, (ux, uy) =>
        0.92 - (uy - 18.5) / 13.5 * 0.5 + dust.fbm(ux * 0.7, uy * 1.8, 4) * 0.2 - 0.1);
      for (let i = 0; i < 14; i++) {
        const y = 20 + random() * 11;
        g.sphere(random() * 40, y, 2 + random() * 5, 0.5 + random() * 0.5, sand,
          { ambient: 0.62, spread: 0.34 });
      }

      /* Saguaros. An arm leaves the trunk at the elbow, turns through a
         rounded corner and stands up parallel to it — drawn as a bar and a
         column it comes out as a capital letter H instead. */
      const saguaro = (x, base, height, arms) => {
        const w = height * 0.12;
        g.gradient(paint => g.rectEach(x - w, base - height, w * 2, height, paint),
          cactus, x + w, 0, x - w, 0);
        g.sphere(x, base - height, w, w, cactus);
        for (const [side, elbow, top] of arms) {
          const ax = x + side * (w + height * 0.13);
          const armWidth = w * 0.78;
          const elbowY = base - height * elbow;
          const topY = base - height * top;
          // the crook, from the side of the trunk out to the arm
          g.gradient(paint => g.rectEach(Math.min(x + side * w * 0.5, ax - side * armWidth),
            elbowY - armWidth, Math.abs(ax - x) + armWidth * 0.5, armWidth * 2, paint),
            cactus, 0, elbowY + armWidth * 2, 0, elbowY - armWidth);
          g.gradient(paint => g.rectEach(ax - armWidth, topY, armWidth * 2, elbowY - topY + armWidth, paint),
            cactus, ax + armWidth, 0, ax - armWidth, 0);
          g.sphere(ax, topY, armWidth, armWidth, cactus);
          g.sphere(ax, elbowY, armWidth, armWidth, cactus, { ambient: 0.42 });
        }
      };
      saguaro(8, 30, 11, [[-1, 0.5, 0.78], [1, 0.36, 0.62]]);
      saguaro(31, 27.5, 6.5, [[1, 0.45, 0.72]]);
      saguaro(20.5, 25.5, 4.2, [[1, 0.45, 0.7]]);

      // rocks and scrub
      for (let i = 0; i < 12; i++) {
        const x = random() * 39, y = 21 + random() * 10;
        g.sphere(x, y, 0.7 + random() * 1.3, 0.5 + random() * 0.8, rock,
          { ambient: 0.42, texture: (ux, uy) => dust.fbm(ux * 3.4, uy * 3.4, 2) * 0.18 - 0.09 });
      }
      for (let i = 0; i < 16; i++) {
        const x = random() * 39, y = 21 + random() * 10;
        g.sphere(x, y, 0.9 + random() * 0.8, 0.35 + random() * 0.3, cactus, { ambient: 0.4 });
      }

      // a rider coming across the flat, in silhouette against the light
      const rx = 14.5, ry = 22.2, k = 1.2;
      g.ellipse(rx, ry, 1.5 * k, 0.62 * k, shadow);                     // barrel
      g.ellipse(rx - 1.45 * k, ry - 0.25 * k, 0.5 * k, 0.5 * k, shadow); // chest
      g.ellipse(rx + 1.5 * k, ry - 0.1 * k, 0.42 * k, 0.5 * k, shadow);  // rump
      for (const [dx, lean] of [[-1.15, -0.12], [-0.8, 0.1], [0.95, -0.1], [1.3, 0.12]]) {
        g.poly([[rx + dx * k, ry], [rx + (dx + lean) * k, ry + 1.5 * k],
          [rx + (dx + lean + 0.2) * k, ry + 1.5 * k], [rx + (dx + 0.22) * k, ry]], shadow);
      }
      g.poly([[rx - 1.6 * k, ry - 0.4 * k], [rx - 2.5 * k, ry - 1.35 * k],
        [rx - 2.1 * k, ry - 1.45 * k], [rx - 1.3 * k, ry - 0.55 * k]], shadow);   // neck
      g.ellipse(rx - 2.45 * k, ry - 1.45 * k, 0.42 * k, 0.26 * k, shadow);        // head
      g.poly([[rx + 1.6 * k, ry - 0.2 * k], [rx + 2.2 * k, ry + 1.1 * k],
        [rx + 1.9 * k, ry + 1.15 * k], [rx + 1.35 * k, ry - 0.1 * k]], shadow);   // tail
      g.ellipse(rx - 0.15 * k, ry - 1.1 * k, 0.4 * k, 0.7 * k, shadow);          // rider
      g.disc(rx - 0.15 * k, ry - 1.95 * k, 0.36 * k, shadow);
      g.ellipse(rx - 0.15 * k, ry - 2.2 * k, 0.78 * k, 0.3 * k, shadow);          // hat
      for (const [x, y, size] of [[6, 4, 1.1], [9.8, 6, 0.85], [13.4, 3.6, 0.7]]) {
        bird(g, x, y, size, mesa[0]);
      }
    },
  });

  picture({
    id: 'teddy',
    name: 'Old Bear',
    blurb: 'A teddy with a ribbon',
    cols: 32, rows: 40,
    palette: [
      { ramp: '#ffe3ef', name: 'Wall', tones: 5, dark: 0.22 },
      { ramp: '#c98f52', name: 'Fur', tones: 7 },
      { ramp: '#f0dcb8', name: 'Muzzle', tones: 5, dark: 0.34 },
      { ramp: '#e0596f', name: 'Ribbon', tones: 4 },
      { ramp: '#f3a6b4', name: 'Pad', tones: 3 },
      { ramp: '#2a2028', name: 'Ink', tones: 3, light: 0.55 },
      { hex: '#fff8ef', name: 'Shine' },
    ],
    draw(g, c) {
      const [wall, fur, muzzle, ribbon, pad, ink, shine] = c;
      const random = rng(20260821);
      /* Plush is the difference between a bear and a brown balloon: a fine
         mottle over the shading, finer across than down so it reads as pile
         lying one way. */
      const pile = noise(6161);
      const fluff = (ux, uy) => pile.fbm(ux * 2.6, uy * 1.4, 3) * 0.26 - 0.13;

      g.fill(wall[4]);
      g.sphere(16, 18, 15.5, 17, wall, { ambient: 0.55, spread: 0.45 });

      // ears behind the head
      for (const side of [-1, 1]) {
        g.sphere(16 + side * 6.6, 8.6, 3.4, 3.4, fur, { texture: fluff });
        g.sphere(16 + side * 6.6, 8.9, 2, 2, muzzle, { ambient: 0.5, spread: 0.4, texture: fluff });
      }

      // arms and legs behind the body
      for (const side of [-1, 1]) {
        g.sphere(16 + side * 8.4, 24, 3.1, 4.6, fur, { lx: -0.6 * side, texture: fluff });
        g.sphere(16 + side * 8.9, 26.6, 1.7, 2, pad, { ambient: 0.5 });
        g.sphere(16 + side * 5.2, 33.6, 3.6, 3.4, fur, { lx: -0.6 * side, texture: fluff });
        g.sphere(16 + side * 5.6, 34.6, 2.1, 1.8, pad, { ambient: 0.5 });
        for (let i = 0; i < 3; i++) g.disc(16 + side * (4.4 + i * 1.1), 32.6, 0.42, pad[0]);
      }

      // body, then head on top
      g.sphere(16, 27, 7.4, 7.6, fur, { texture: fluff });
      g.sphere(16, 27.6, 4.6, 5, muzzle, { ambient: 0.5, spread: 0.42, texture: fluff });
      g.sphere(16, 13.5, 7.8, 7.2, fur, { texture: fluff });

      // face
      g.sphere(16, 17.4, 4.4, 3.4, muzzle, { ambient: 0.5, spread: 0.45, texture: fluff });
      g.sphere(16, 15.6, 1.9, 1.4, ink, { ly: -0.85, ambient: 0.35 });
      g.line(16, 16.8, 16, 18.2, ink[0], 0.4);
      g.line(16, 18.2, 14.4, 19, ink[0], 0.4);
      g.line(16, 18.2, 17.6, 19, ink[0], 0.4);
      for (const side of [-1, 1]) {
        g.disc(16 + side * 3.1, 11.8, 1.5, ink[0]);
        g.disc(16 + side * 3.1 + 0.5, 11.3, 0.45, shine);
      }

      // ribbon at the neck
      g.gradient(paint => g.rectEach(9.6, 20.4, 12.8, 1.8, paint), ribbon, 0, 22.6, 0, 20);
      for (const side of [-1, 1]) {
        g.sphere(16 + side * 3.4, 21.2, 2.6, 2, ribbon, { lx: -0.5 * side });
        g.poly([[16 + side * 2, 21.6], [16 + side * 5.4, 24.6], [16 + side * 2.6, 24.2]], ribbon[1]);
      }
      g.sphere(16, 21.2, 1.1, 1.1, ribbon, { ambient: 0.6 });

      // a worn patch and some stitching, the way an old bear goes
      g.sphere(11.4, 29.6, 2.2, 1.8, fur, { ambient: 0.3, spread: 0.35, texture: fluff });
      for (let i = 0; i < 5; i++) g.rect(9.8 + i * 0.8, 28.6 + i * 0.42, 0.5, 0.28, ink[1]);

      // dust in the light
      for (let i = 0; i < 18; i++) {
        const x = random() * 31, y = random() * 39;
        if (Math.hypot(x - 16, (y - 22) * 0.8) < 11) continue;
        g.disc(x, y, 0.3 + random() * 0.22, wall[random() < 0.5 ? 0 : 4]);
      }
    },
  });

  picture({
    id: 'lighthouse',
    name: 'Night Watch',
    blurb: 'A lighthouse over the rocks',
    cols: 32, rows: 40,
    palette: [
      { ramp: '#2c4a86', name: 'Sky', tones: 7, dark: 0.55, light: 0.45 },
      { hex: '#fff6c9', name: 'Star' },
      { ramp: '#e8e3f5', name: 'Moon', tones: 3 },
      { ramp: '#ffd66b', name: 'Beam', tones: 4, light: 0.55 },
      { ramp: '#f2f0ec', name: 'Tower', tones: 5, dark: 0.42 },
      { ramp: '#d4453f', name: 'Stripe', tones: 4 },
      { ramp: '#5a6b86', name: 'Rock', tones: 5 },
      { ramp: '#20567a', name: 'Sea', tones: 6 },
      { ramp: '#dbeaf5', name: 'Foam', tones: 3 },
    ],
    draw(g, c) {
      const [sky, star, moon, beam, tower, stripe, rock, sea, foam] = c;
      const random = rng(1857);
      const stone = noise(2626);

      // night sky, palest low down where the moon is
      g.gradient(paint => g.rectEach(0, 0, 32, 27, paint), sky, 0, 0, 0, 26);
      for (let i = 0; i < 40; i++) {
        const x = random() * 31.5, y = random() * 24;
        if (x > 11 && x < 21 && y > 6) continue;
        g.disc(x, y, 0.24 + random() * 0.22, star);
      }
      g.sphere(25.5, 5.5, 3.2, 3.2, moon, { lx: -0.5, ly: -0.5, ambient: 0.55, spread: 0.4 });

      // the beam sweeping out either side of the lantern
      g.poly([[16, 9.5], [32, 3], [32, 13]], beam[3]);
      g.poly([[16, 9.5], [32, 5.5], [32, 11]], beam[2]);
      g.poly([[16, 9.5], [0, 4], [0, 12]], beam[3]);
      g.poly([[16, 9.5], [0, 6.5], [0, 10.5]], beam[2]);

      // the sea, then the rock it all stands on
      g.gradient(paint => g.rectEach(0, 27, 32, 13, paint), sea, 0, 40, 0, 26.5);
      for (let i = 0; i < 22; i++) {
        const y = 27.5 + random() * 12;
        g.sphere(random() * 32, y, 1 + random() * 2.6, 0.4, sea, { ambient: 0.66, spread: 0.3 });
      }
      g.shadeEach(paint => g.polyEach([[2, 40], [5, 30], [10, 26.5], [21, 26.5], [26, 30], [30, 40]], paint),
        rock, (ux, uy) => 0.78 - (ux - 4) / 26 * 0.5 + stone.fbm(ux * 1.3, uy * 1.3, 4) * 0.42 - 0.21);
      for (let i = 0; i < 9; i++) {
        const x = 4 + random() * 24, y = 28 + random() * 10;
        g.sphere(x, y, 1 + random() * 1.6, 0.7 + random() * 1.1, rock, { ambient: 0.4 });
      }
      for (let i = 0; i < 12; i++) {
        const x = random() * 31, y = 26 + random() * 3;
        g.sphere(x, y, 1 + random() * 1.4, 0.35, foam, { ambient: 0.6, spread: 0.35 });
      }

      // tower: bands of white and red, rounded across
      const tw = (y) => 3.2 - (y - 11) * 0.075;
      for (let y = 11; y < 27; y += 2.4) {
        const w = tw(y);
        g.gradient(paint => g.polyEach([[16 - w, y], [16 + w, y], [16 + tw(y + 2.4), y + 2.4],
          [16 - tw(y + 2.4), y + 2.4]], paint),
          ((y - 11) / 2.4) % 2 ? stripe : tower, 16 + w, 0, 16 - w, 0);
      }

      // lantern room, its rail and its cap
      g.gradient(paint => g.rectEach(13.4, 7.6, 5.2, 3.4, paint), tower, 18.8, 0, 13.2, 0);
      g.sphere(16, 9.2, 1.9, 1.6, beam, { ambient: 0.62, spread: 0.4 });
      g.rect(12.8, 10.8, 6.4, 0.9, rock[1]);
      g.rect(12.4, 11.6, 7.2, 0.6, rock[0]);
      g.poly([[13.2, 7.6], [18.8, 7.6], [16, 4.6]], stripe[1]);
      g.rect(15.7, 3.2, 0.6, 1.6, rock[0]);
      g.disc(16, 3, 0.5, star);

      // door and windows down the tower
      g.rect(15, 24.6, 2, 2.4, rock[0]);
      for (const y of [14, 18, 21.5]) g.rect(15.4, y, 1.2, 1.2, sky[1]);
    },
  });

  picture({
    id: 'western',
    name: 'Hat and Boot',
    blurb: 'Left by the crate, out west',
    cols: 32, rows: 40,
    palette: [
      { ramp: '#8ec4e8', name: 'Sky', tones: 5 },
      { ramp: '#f4ead6', name: 'Cream', tones: 5, dark: 0.44, light: 0.3 },
      { ramp: '#a98098', name: 'Mesa', tones: 4, dark: 0.4, light: 0.4 },
      { ramp: '#d9a066', name: 'Sand', tones: 7, dark: 0.5, light: 0.42 },
      { ramp: '#8a5626', name: 'Leather', tones: 9, dark: 0.68, light: 0.55 },
      { ramp: '#a97b45', name: 'Wood', tones: 6, dark: 0.55, light: 0.45 },
      { ramp: '#b3324a', name: 'Bandana', tones: 5, dark: 0.5, light: 0.45 },
      { ramp: '#4f8f4a', name: 'Cactus', tones: 6, dark: 0.5, light: 0.45 },
      { ramp: '#96836f', name: 'Rock', tones: 5, dark: 0.5, light: 0.4 },
    ],
    draw(g, c) {
      const [sky, cream, mesa, sand, leather, wood, bandana, cactus, rock] = c;
      const random = rng(1889);
      const grain = noise(2211);
      const rough = noise(707);

      // ---------------------------------------------------------- distance
      g.gradient(paint => g.rectEach(0, 0, 32, 17, paint), sky, 0, 0, 0, 16.5);

      // clouds, their edges broken up so they aren't rows of bubbles
      const cloud = (cx, cy, w, h, seed) => {
        const puff = noise(seed);
        g.shadeEach(paint => g.ellipseEach(cx, cy, w, h, paint), cream, (ux, uy) => {
          const dx = (ux - cx) / w, dy = (uy - cy) / h;
          const edge = 1 - Math.min(1, dx * dx + dy * dy);
          const bite = puff.fbm(ux * 0.75 + dy, uy * 1.6, 3);
          if (edge < 0.95 * bite) return -1;                    // nibbled away
          return 0.36 + edge * 0.5 - dy * 0.45 + bite * 0.3;
        });
      };
      cloud(7, 4, 6, 1.9, 31);
      cloud(22, 2.6, 5.5, 1.6, 32);
      cloud(27, 7.5, 4, 1.2, 33);

      // buttes on the skyline, pale with distance
      const butte = (x, y, w, h) => {
        g.shadeEach(paint => g.polyEach([[x - w, y + h], [x - w * 0.85, y + h * 0.2],
          [x - w * 0.62, y], [x + w * 0.62, y], [x + w * 0.88, y + h * 0.25], [x + w, y + h]], paint),
          mesa, (ux) => 0.35 + (ux - (x - w)) / (2 * w) * 0.5 + rough.fbm(ux * 1.4, 0, 2) * 0.2);
      };
      butte(4, 11, 3.4, 4.4);
      butte(11, 12.4, 2.4, 3);
      butte(27, 10.4, 4.4, 5.2);
      butte(20.5, 13, 2, 2.6);

      // the flat, running back to the buttes
      g.shadeEach(paint => g.rectEach(0, 15.5, 32, 25, paint), sand, (ux, uy) => {
        const depth = Math.min(1, (uy - 15.5) / 22);
        return 0.86 - depth * 0.42 + grain.fbm(ux * 0.5, uy * 1.4, 4) * 0.16 - 0.08;
      });

      // a fence going off to the right, and scrub along the middle distance
      for (let i = 0; i < 7; i++) {
        const x = 17.5 + i * 2.4, y = 17.6 + i * 0.42;
        g.shadeEach(paint => g.rectEach(x, y - 1.5 - i * 0.1, 0.42 + i * 0.05, 1.8 + i * 0.14, paint),
          wood, (ux, uy) => 0.3 + grain.fbm(ux * 3, uy * 0.7, 2) * 0.5);
        if (i) {
          g.rect(x - 2.4, y - 1.15 - i * 0.1, 2.6, 0.22, wood[1]);
          g.rect(x - 2.4, y - 0.5 - i * 0.1, 2.6, 0.2, wood[1]);
        }
      }
      // low scrub, and it stays low: a bush the size of the hat reads as a
      // green cloud sitting on the sand
      for (let i = 0; i < 18; i++) {
        const y = 16.8 + random() * 4.4;
        const size = (0.22 + (y - 16.8) * 0.1) * (0.7 + random() * 0.7);
        g.sphere(random() * 32, y, size * 1.8, size * 0.8, cactus,
          { ambient: 0.32 + random() * 0.2, spread: 0.4 });
      }

      // ------------------------------------------------------- the crate
      const crateFront = [[17.6, 24.4], [30.5, 22.6], [30.5, 33.6], [17.6, 34.6]];
      g.shadeEach(paint => g.polyEach(crateFront, paint), wood, (ux, uy) =>
        0.34 + (30.5 - ux) / 13 * 0.22 + grain.fbm(ux * 0.5, uy * 6, 3) * 0.5 - 0.1);
      // the gaps between the boards
      for (const at of [0.26, 0.52, 0.78]) {
        const yLeft = 24.4 + (34.6 - 24.4) * at, yRight = 22.6 + (33.6 - 22.6) * at;
        g.poly([[17.6, yLeft], [30.5, yRight], [30.5, yRight + 0.3], [17.6, yLeft + 0.32]], wood[0]);
      }
      // the top of the crate, catching the light
      g.shadeEach(paint => g.polyEach([[17.6, 24.4], [30.5, 22.6], [31.8, 21], [19.6, 22.6]], paint),
        wood, (ux, uy) => 0.62 + grain.fbm(ux * 0.6, uy * 5, 3) * 0.4);
      g.poly([[17.6, 24.4], [17.6, 34.6], [16.9, 33.9], [16.9, 24.1]], wood[0]);

      // ------------------------------------------------------- the bandana
      const cloth = noise(4242);
      g.shadeEach(paint => g.polyEach([[21.4, 21.6], [26.4, 20.8], [28.6, 23],
        [27.4, 25.4], [23.4, 25.2], [21, 23.4]], paint), bandana, (ux, uy) =>
        0.34 + cloth.fbm(ux * 1.3, uy * 1.3, 3) * 0.8 - (uy - 21) * 0.04);
      // the corner hanging down the front of the crate
      g.shadeEach(paint => g.polyEach([[27.4, 25.4], [28.6, 23], [29.6, 26.6],
        [28.2, 29.8], [26.6, 27.2]], paint), bandana, (ux, uy) =>
        0.22 + cloth.fbm(ux * 1.6, uy * 1.6, 2) * 0.55);
      for (let i = 0; i < 18; i++) {
        const x = 20.5 + random() * 9, y = 20.8 + random() * 9;
        if (!bandana.includes(g.get(x, y))) continue;
        g.disc(x, y, 0.2 + random() * 0.12, cream[3]);
      }

      // ---------------------------------------------------------- the hat
      /* Brim first, in the dark tones: the top surface is then drawn a
         little higher up, so what is left showing along the front edge is
         the underside of the brim in shadow. */
      const hide = noise(9090);
      const hx = 13, hy = 31.4;
      const felt = (ux, uy) => hide.fbm(ux * 1.2, uy * 1.9, 3) * 0.18 - 0.09;

      /* A brim is a disc seen almost edge on, tilting up towards its rim, so
         it catches more light the further out you go — and the underside,
         which is only a sliver at the front, is in shadow the whole way. */
      g.shadeEach(paint => g.ellipseEach(hx, hy + 0.55, 10.9, 4.3, paint), leather,
        (ux, uy) => 0.06 + felt(ux, uy) * 0.4);
      g.shadeEach(paint => g.ellipseEach(hx, hy, 10.8, 4.2, paint), leather, (ux, uy) => {
        const dx = (ux - hx) / 10.8, dy = (uy - hy) / 4.2;
        const rim = dx * dx + dy * dy;
        const key = -dx * 0.2 - dy * 0.42;                  // light from the upper left
        const behind = uy < hy - 1 ? 0.2 : 0;               // the crown shades the far side
        return 0.5 + rim * 0.42 + key - behind + felt(ux, uy);
      });
      // the stitched edge, running round the brim
      for (let a = 0; a < Math.PI * 2; a += 0.06) {
        g.disc(hx + Math.cos(a) * 9.9, hy + Math.sin(a) * 3.8, 0.17, leather[1]);
      }

      /* The crown: not a dome. Squaring off the shape gives it the flat top
         and near-vertical sides a hat actually has, and the crease down the
         middle is the thing that makes it read as felt rather than a bowl. */
      g.shadeEach(paint => g.ellipseEach(hx, 27.4, 4.9, 4.9, paint), leather, (ux, uy) => {
        const dx = (ux - hx) / 4.9, dy = (uy - 27.4) / 4.9;
        if (Math.abs(dx) ** 2.3 + Math.abs(dy) ** 3.2 > 1) return -1;
        if (uy > hy - 0.3) return -1;                        // the brim takes over
        const nz = Math.sqrt(Math.max(0, 1 - dx * dx - dy * dy));
        const crease = Math.exp(-((ux - hx) ** 2) / 1.6) * (uy < 26.6 ? 0.42 : 0.16);
        const pinch = Math.exp(-((Math.abs(ux - hx) - 3.2) ** 2) / 0.5) * (uy < 25.6 ? 0.24 : 0);
        const lift = Math.exp(-((ux - hx + 2.1) ** 2) / 1.6) * (uy < 26 ? 0.09 : 0);
        return 0.5 + 0.46 * (dx * -0.5 + dy * -0.5 + nz * 0.62) - crease - pinch + lift + felt(ux, uy);
      });

      // the band round the base of the crown, and its buckle
      g.shadeEach(paint => g.ellipseEach(hx, 29.9, 4.85, 2, paint), leather, (ux, uy) => {
        if (uy < 29.2 || uy > hy - 0.35) return -1;
        return 0.1 + (ux - 8) / 10 * 0.16 + felt(ux, uy) * 0.5;
      });
      g.sphere(16.2, 29.9, 0.85, 0.62, cream, { ambient: 0.5 });

      // ---------------------------------------------------------- the boot
      /* Leather that pale shows its shape only through shading, so the boot
         gets a strong turn from its lit left edge round to the shadowed
         right, and darkens where it meets the ground. */
      const bootLight = (ux, uy) => 0.82 - Math.abs(ux - 4.2) / 5.4 * 0.62 - (uy - 25) * 0.028
        + hide.fbm(ux * 1.1, uy * 1.1, 3) * 0.13 - 0.065;
      // shaft, pulled in at the ankle
      g.shadeEach(paint => g.polyEach([[2.6, 25.6], [6.6, 24.8], [7.4, 31.6],
        [6.9, 33.4], [4.1, 33.9], [3.2, 31.8]], paint), cream, bootLight);
      // foot and toe
      g.shadeEach(paint => g.polyEach([[4.1, 33.9], [6.9, 33.4], [9.4, 35], [10.2, 36.4],
        [9.8, 37.2], [4.6, 37.4], [3.6, 35.8]], paint), cream, bootLight);
      // sole and heel
      g.shadeEach(paint => g.polyEach([[4.6, 37.4], [9.8, 37.2], [10, 38.1], [4.4, 38.4]], paint),
        leather, (ux) => 0.26 + (ux - 4) / 7 * 0.2);
      g.shadeEach(paint => g.polyEach([[3.6, 35.8], [4.6, 37.4], [4.4, 38.4], [3, 37]], paint),
        leather, (ux) => 0.2 + (ux - 3) / 3 * 0.16);
      // the scrolled stitching a cowboy boot carries up its shaft
      for (let i = 0; i < 4; i++) {
        const y = 26.6 + i * 1.7;
        g.line(3.1 + i * 0.12, y, 6.7 - i * 0.05, y - 0.55, cream[0], 0.2);
      }
      g.line(3.4, 30.6, 6.9, 30, cream[0], 0.26);
      g.line(2.9, 25.4, 6.7, 24.6, cream[1], 0.3);

      // --------------------------------------------------------- the plants
      // barrel cactus, ribbed and spined
      const barrel = (cx, cy, r) => {
        g.sphere(cx, cy, r, r * 1.05, cactus, { texture: (ux, uy) => rough.fbm(ux * 2, uy * 2, 2) * 0.1 - 0.05 });
        for (let i = -4; i <= 4; i++) {
          const lean = i / 4;
          for (let t = 0; t <= 1; t += 0.06) {
            const x = cx + lean * r * 0.95 * Math.sin(Math.PI * t * 0.5 + 0.4) + lean * 0.3;
            const y = cy - r * 1.0 + t * r * 2;
            if (Math.hypot((x - cx) / r, (y - cy) / (r * 1.05)) > 0.98) continue;
            g.disc(x, y, 0.16, cactus[1]);
            if (t > 0.1 && t < 0.95 && Math.abs(i) % 2 === 0) g.disc(x + lean * 0.35, y, 0.12, cream[4]);
          }
        }
        for (let i = 0; i < 5; i++) {
          g.sphere(cx - r * 0.5 + i * r * 0.25, cy - r * 0.95, 0.5, 0.34, bandana, { ambient: 0.55 });
        }
      };
      barrel(24.5, 34.6, 3.1);

      // prickly pear pads
      const pad = (cx, cy, rx, ry, tilt) => {
        g.shadeEach(paint => g.ellipseEach(cx, cy, rx, ry, paint), cactus, (ux, uy) => {
          const dx = (ux - cx) / rx, dy = (uy - cy) / ry;
          const nz = Math.sqrt(Math.max(0, 1 - dx * dx - dy * dy));
          return 0.42 + 0.45 * (dx * -0.5 + dy * -0.55 + nz * 0.5) + rough.fbm(ux * 1.6, uy * 1.6, 2) * 0.12;
        });
        for (let i = 0; i < 9; i++) {
          const a = i * 2.4 + tilt, d = 0.35 + (i % 3) * 0.22;
          g.disc(cx + Math.cos(a) * rx * d * 1.6, cy + Math.sin(a) * ry * d * 1.6, 0.16, cactus[0]);
        }
      };
      pad(29.6, 32.6, 1.9, 2.6, 0.4);
      pad(30.4, 29.2, 1.5, 2, 1.1);

      // ----------------------------------------------------- ground detail
      /* Rocks and tufts go on the ground, not on the hat: each one is only
         put down where the sand is still showing through. */
      const onSand = (x, y) => sand.includes(g.get(x, y));
      for (let i = 0, placed = 0; i < 200 && placed < 16; i++) {
        const x = random() * 32, y = 25 + random() * 14;
        if (!onSand(x, y) || !onSand(x - 1, y) || !onSand(x + 1, y)) continue;
        g.sphere(x, y, 0.5 + random() * 1.1, 0.35 + random() * 0.7, rock, {
          ambient: 0.36, texture: (ux, uy) => rough.fbm(ux * 3, uy * 3, 2) * 0.14 - 0.07,
        });
        placed++;
      }
      for (let i = 0, placed = 0; i < 300 && placed < 15; i++) {
        const x = random() * 32, y = 24 + random() * 15;
        if (!onSand(x, y) || !onSand(x, y - 1)) continue;
        const blades = 2 + Math.floor(random() * 3);
        for (let b = 0; b < blades; b++) {
          const lean = (random() - 0.5) * 1.4;
          const tall = 0.6 + random() * 1.2;
          g.poly([[x + lean, y - tall], [x + 0.3, y + 0.25], [x - 0.3, y + 0.25]],
            cactus[random() < 0.4 ? 0 : 1]);
        }
        placed++;
      }
      // the shadows the hat and crate throw on the sand
      for (const [cx, cy, rx, ry] of [[15, 35.4, 9.5, 1.5], [24.5, 36.4, 6, 1.1], [7, 38.4, 4, 0.8]]) {
        g.ellipseEach(cx, cy, rx, ry, (x, y, dx, dy) => {
          if (!onSand(x / g.detail, y / g.detail)) return;
          const depth = 1 - Math.min(1, dx * dx + dy * dy);
          g.poke(x, y, sand[level(0.34 - depth * 0.3, sand.length)]);
        });
      }
    },
  });

  picture({
    id: 'stadium',
    name: 'Under the Lights',
    blurb: 'Floodlights, and a full house',
    cols: 40, rows: 32,
    palette: [
      { ramp: '#1d2a52', name: 'Night', tones: 6, dark: 0.6, light: 0.5 },
      { ramp: '#ffe9a8', name: 'Glow', tones: 4, light: 0.6 },
      { hex: '#fffdf2', name: 'Lamp' },
      { ramp: '#3f8f47', name: 'Pitch', tones: 8, dark: 0.55, light: 0.5 },
      { ramp: '#f2f5ff', name: 'Line', tones: 3, dark: 0.35 },
      { ramp: '#4a5878', name: 'Stand', tones: 5, dark: 0.55 },
      { ramp: '#2b3550', name: 'Roof', tones: 4, dark: 0.5 },
      { ramp: '#8f9cc0', name: 'Steel', tones: 4 },
      { ramp: '#d13b3b', name: 'Home', tones: 3 },
      { hex: '#f0f0f5', name: 'Away' },
    ],
    draw(g, c) {
      const [night, glow, lamp, pitch, line, stand, roof, steel, home, away] = c;
      const random = rng(1886);
      const air = noise(5151);
      const turf = noise(9292);

      // ------------------------------------------------------------- sky
      g.shadeEach(paint => g.rectEach(0, 0, 40, 18, paint), night, (ux, uy) =>
        0.12 + uy / 18 * 0.5 + air.fbm(ux * 0.3, uy * 0.6, 3) * 0.16 - 0.08);
      for (let i = 0; i < 34; i++) {
        const x = random() * 40, y = random() * 9;
        g.disc(x, y, 0.24 + random() * 0.2, night[5]);
      }

      /* The four towers. Light spills upward into the night as a soft cone,
         so the beams are painted before the towers themselves and only where
         they lift the sky rather than replacing it. */
      const towers = [[3.5, 5.5, 1], [36.5, 5.5, 1], [9.5, 7.5, 0.72], [30.5, 7.5, 0.72]];
      for (const [tx, ty, scale] of towers) {
        g.shadeEach(paint => g.ellipseEach(tx, ty + 7 * scale, 7 * scale, 8 * scale, paint),
          night, (ux, uy) => {
            const fall = 1 - Math.min(1, Math.hypot((ux - tx) / (7 * scale), (uy - ty) / (9 * scale)));
            if (fall <= 0.08) return -1;
            return 0.36 + fall * 0.85 + air.fbm(ux * 0.8, uy * 0.8, 2) * 0.2 - 0.1;
          });
      }

      // ------------------------------------------------------- the ground
      // far stand, then the two sides, all curving away from the viewer
      g.shadeEach(paint => g.polyEach([[1, 17.5], [4, 12.2], [36, 12.2], [39, 17.5]], paint),
        stand, (ux, uy) => 0.3 + (17.5 - uy) / 6 * 0.5);
      g.shadeEach(paint => g.polyEach([[0.4, 12.6], [4, 9.4], [36, 9.4], [39.6, 12.6]], paint),
        roof, (ux, uy) => 0.36 + (12.6 - uy) / 3.6 * 0.5 + air.fbm(ux * 2, uy * 2, 2) * 0.2 - 0.1);

      /* The crowd. Drawn as thousands of individual specks it looks right
         and coloured in it isn't there at all: every speck is smaller than
         the smallest area worth giving a number to, so they all get merged
         back into the stand. Patches about a metre across survive, and from
         this far away a crowd is patches of colour anyway. */
      const faces = noise(3311);
      const flecks = noise(7733);
      g.polyEach([[2, 12.6], [38, 12.6], [37.2, 17.3], [2.8, 17.3]], (x, y) => {
        const ux = (x + 0.5) / g.detail, uy = (y + 0.5) / g.detail;
        // mostly dark, with colour coming through in flecks rather than slabs
        const patch = faces.fbm(ux * 2.2, uy * 2.8, 2);
        const fleck = flecks.fbm(ux * 1.5 + 40, uy * 2.1, 2);
        // a full house: colour on most of it, dark only in the gaps
        let shirt = stand[patch < 0.5 ? 2 : 3];
        if (fleck > 0.52) shirt = home[patch < 0.4 ? 0 : patch < 0.75 ? 1 : 2];
        else if (fleck < 0.34) shirt = patch < 0.5 ? away : stand[4];
        else if (patch < 0.28) shirt = stand[1];
        g.poke(x, y, shirt);
      });
      // the rail along the front of the stand
      g.rect(1.6, 17.1, 36.8, 0.5, steel[1]);

      // ------------------------------------------------------------ pitch
      /* The surround goes down first and covers the whole floor of the
         ground. Without it the corners either side of the pitch stay as bare
         paper, which is exactly what the first draft did. */
      g.shadeEach(paint => g.rectEach(0, 17.2, 40, 15, paint), stand, (ux, uy) =>
        0.12 + (uy - 17.2) / 15 * 0.3 + air.fbm(ux * 1.2, uy * 2.4, 3) * 0.24 - 0.12);

      const pitchShape = [[3, 30.8], [9.5, 18], [30.5, 18], [37, 30.8]];
      const pools = towers.map(([tx, , scale]) => [tx < 20 ? 12 + tx * 0.3 : 28 - (40 - tx) * 0.3, scale]);
      g.shadeEach(paint => g.polyEach(pitchShape, paint), pitch, (ux, uy) => {
        // how far across the pitch, allowing for the perspective
        const width = 6.5 + (uy - 18) / 12.8 * 27;
        const across = (ux - 20) / (width / 2);
        if (Math.abs(across) > 1.02) return -1;
        /* Mown stripes run away from the viewer, and each tower lays its own
           pool of light across the grass. Both have to stay well clear of the
           top of the ramp or the whole pitch clamps to one bright green. */
        const stripe = Math.floor((across + 1) * 4) % 2 ? 0.26 : 0;
        let lit = 0;
        for (const [px, scale] of pools) {
          lit += Math.exp(-((ux - px) ** 2) / (26 * scale)) * 0.26 * scale;
        }
        return 0.14 + lit + stripe + (uy - 18) / 12.8 * 0.14 + turf.fbm(ux * 1.4, uy * 3, 3) * 0.14 - 0.07;
      });

      /* Markings, drawn in the same perspective as the pitch: everything is
         measured across the pitch in halves, then widened with depth. */
      const at = (across, uy) => 20 + across * (6.5 + (uy - 18) / 12.8 * 27) / 2;
      const mark = (points) => g.poly(points.map(([across, uy]) => [at(across, uy), uy]), line[2]);
      const thickness = (uy) => 0.03 + (uy - 18) / 12.8 * 0.05;

      // touchlines and goal lines
      mark([[-1, 18], [1, 18], [1, 18.45], [-1, 18.45]]);
      mark([[-1, 30.4], [1, 30.4], [1, 30.8], [-1, 30.8]]);
      for (const side of [-1, 1]) {
        mark([[side * 0.985, 18], [side * 0.93, 18], [side * 0.93, 30.8], [side * 0.985, 30.8]]);
      }
      // halfway line and the centre circle
      mark([[-1, 24.2], [1, 24.2], [1, 24.2 + thickness(24.2) * 4], [-1, 24.2 + thickness(24.2) * 4]]);
      for (let a = 0; a < Math.PI * 2; a += 0.05) {
        const uy = 24.4 + Math.sin(a) * 2.1;
        g.disc(at(Math.cos(a) * 0.34, uy), uy, 0.16, line[2]);
      }
      g.disc(at(0, 24.4), 24.4, 0.24, line[2]);
      // the far penalty area and its six-yard box
      mark([[-0.56, 18.3], [0.56, 18.3], [0.56, 18.6], [-0.56, 18.6]]);
      mark([[-0.56, 18.3], [-0.5, 18.3], [-0.5, 20.5], [-0.56, 20.5]]);
      mark([[0.5, 18.3], [0.56, 18.3], [0.56, 20.5], [0.5, 20.5]]);
      mark([[-0.56, 20.3], [0.56, 20.3], [0.56, 20.6], [-0.56, 20.6]]);

      /* The goal. A net is mostly holes, so it is drawn as the mesh itself
         over the darker stand behind rather than as a white slab. */
      const goalLeft = at(-0.2, 18.2), goalRight = at(0.2, 18.2);
      g.shadeEach(paint => g.rectEach(goalLeft, 16.5, goalRight - goalLeft, 1.9, paint),
        stand, () => 0.06);
      for (let x = goalLeft + 0.3; x < goalRight; x += 0.62) g.rect(x, 16.5, 0.16, 1.9, line[0]);
      for (let y = 16.7; y < 18.4; y += 0.5) g.rect(goalLeft, y, goalRight - goalLeft, 0.14, line[0]);
      g.rect(goalLeft - 0.2, 16.4, 0.4, 2, line[2]);
      g.rect(goalRight - 0.2, 16.4, 0.4, 2, line[2]);
      g.rect(goalLeft - 0.2, 16.3, goalRight - goalLeft + 0.4, 0.36, line[2]);

      // ---------------------------------------------------------- players
      const player = (x, y, kit, size) => {
        g.ellipse(x, y + size * 0.16, size * 0.52, size * 0.15, pitch[1]);   // shadow first
        g.poly([[x - size * 0.3, y - size * 0.42], [x - size * 0.12, y],
          [x + size * 0.1, y], [x + size * 0.28, y - size * 0.42]], night[0]);
        g.ellipse(x, y - size * 0.5, size * 0.3, size * 0.2, line[2]);       // shorts
        g.ellipse(x, y - size * 0.92, size * 0.32, size * 0.42, kit);
        g.disc(x, y - size * 1.42, size * 0.22, glow[1]);
      };
      for (const [x, y, kit, size] of [
        [14.6, 26.8, home[1], 2.2], [18.6, 23.2, away, 1.75], [24.2, 28, home[1], 2.4],
        [27, 22.4, away, 1.6], [21, 30, home[1], 2.6], [11.8, 22, away, 1.5],
        [30, 25.6, away, 2], [24.8, 20.4, home[1], 1.4],
      ]) player(x, y, kit, size);
      g.disc(22.4, 29.2, 0.55, line[2]);
      g.disc(22.4, 29.2, 0.26, night[1]);

      // ---------------------------------------------------------- towers
      for (const [tx, ty, scale] of towers) {
        const w = 1.1 * scale;
        const base = 18.6 - (1 - scale) * 3;
        // the mast, tapering as it climbs
        g.shadeEach(paint => g.polyEach([[tx - w, base], [tx + w, base],
          [tx + w * 0.42, ty + 2.2 * scale], [tx - w * 0.42, ty + 2.2 * scale]], paint),
          steel, (ux) => 0.3 + (ux - tx + w) / (2 * w) * 0.45);
        // cross-bracing up the mast
        for (let i = 0; i < 7; i++) {
          const t0 = i / 7, t1 = (i + 1) / 7;
          const y0 = base + (ty + 2.2 * scale - base) * t0;
          const y1 = base + (ty + 2.2 * scale - base) * t1;
          const w0 = w - (w - w * 0.42) * t0, w1 = w - (w - w * 0.42) * t1;
          g.line(tx - w0 * (i % 2 ? -1 : 1), y0, tx + w1 * (i % 2 ? -1 : 1), y1, steel[0], 0.28 * scale);
        }
        // the bank of lamps, and the halo round it
        g.shadeEach(paint => g.ellipseEach(tx, ty, 4.6 * scale, 3.4 * scale, paint), glow, (ux, uy) => {
          const fall = 1 - Math.min(1, Math.hypot((ux - tx) / (4.6 * scale), (uy - ty) / (3.4 * scale)));
          if (fall <= 0.1) return -1;
          return fall * 1.4 - 0.2;
        });
        g.shadeEach(paint => g.rectEach(tx - 2.6 * scale, ty - 1.4 * scale, 5.2 * scale, 2.8 * scale, paint),
          steel, () => 0.2);
        for (let row = 0; row < 3; row++) {
          for (let col = 0; col < 5; col++) {
            g.disc(tx + (col - 2) * scale, ty + (row - 1) * 0.95 * scale, 0.42 * scale, lamp);
          }
        }
      }
    },
  });

  // ------------------------------------------------------------- assembly

  /* Turn a definition into the thing the app colours in: a flat array of
     numbers plus the palette they point at. Colours that end up unused are
     dropped, so a picture never shows a swatch with nothing to fill. */
  /* A picture's palette can hold single colours and ramps. A ramp is one
     colour written once and turned into a run of tones, and the drawing code
     is handed those tones as an array — so shading a shape is picking a ramp,
     not counting palette entries by hand. */
  function expandPalette(entries) {
    const palette = [];
    const handles = entries.map(entry => {
      if (!entry.ramp) {
        palette.push({ hex: entry.hex, name: entry.name });
        return palette.length;
      }
      const count = entry.tones || 4;
      const names = TONE_NAMES[count] || TONE_NAMES[5];
      const shades = tones(entry.ramp, count, entry);
      return shades.map((hex, i) => {
        const prefix = names[i] || '';
        palette.push({
          hex,
          name: prefix ? prefix + entry.name.toLowerCase() : entry.name,
        });
        return palette.length;
      });
    });
    return { palette, handles };
  }

  function build(def, detail) {
    const g = grid(def.cols, def.rows, detail || DETAIL);
    const { palette: fullPalette, handles } = expandPalette(def.palette);
    def.draw(g, handles);

    const used = new Set(g.cells);
    const remap = new Uint8Array(fullPalette.length + 1);
    const palette = [];
    fullPalette.forEach((swatch, k) => {
      if (!used.has(k + 1)) return;
      palette.push(swatch);
      remap[k + 1] = palette.length;
    });
    const cells = new Uint8Array(g.cells.length);
    for (let k = 0; k < cells.length; k++) cells[k] = g.cells[k] === PAPER ? PAPER : remap[g.cells[k]];

    return {
      id: def.id,
      name: def.name,
      blurb: def.blurb,
      cols: g.cols,
      rows: g.rows,
      palette,
      cells,
    };
  }

  const api = {
    PAPER,
    DETAIL,
    tones,
    noise,
    grid,
    list: (detail) => PICTURES.map(def => build(def, detail)),
    build,
    definitions: PICTURES,
  };

  if (typeof module === 'object' && module.exports) module.exports = api;
  else self.PigmentPictures = api;
})();
