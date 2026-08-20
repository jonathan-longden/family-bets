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
     authored on a grid of about 32 by 40 units; drawing them four times
     finer is what turns a staircase of squares into a curve. */
  const DETAIL = 4;

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

  // --------------------------------------------------------- the pictures

  const PICTURES = [];

  const picture = (def) => { PICTURES.push(def); };

  picture({
    id: 'balloon',
    name: 'Up and Away',
    blurb: 'A balloon over the hills',
    cols: 32, rows: 40,
    palette: [
      { hex: '#bfe6ff', name: 'Sky' },
      { hex: '#ddf2ff', name: 'Pale sky' },
      { hex: '#ffffff', name: 'Cloud' },
      { hex: '#cadff2', name: 'Cloud shade' },
      { hex: '#ffd23f', name: 'Sunshine' },
      { hex: '#ffeaa8', name: 'Sun glow' },
      { hex: '#e8433f', name: 'Red' },
      { hex: '#a82b2f', name: 'Deep red' },
      { hex: '#ff8a3d', name: 'Orange' },
      { hex: '#cf6220', name: 'Deep orange' },
      { hex: '#fbeacb', name: 'Cream' },
      { hex: '#dcc59a', name: 'Cream shade' },
      { hex: '#3fb07a', name: 'Green' },
      { hex: '#2a8a5f', name: 'Mid green' },
      { hex: '#1a6144', name: 'Deep green' },
      { hex: '#a9703a', name: 'Basket' },
      { hex: '#6d4522', name: 'Basket shade' },
      { hex: '#3b2a1d', name: 'Rope' },
    ],
    draw(g, c) {
      const [sky, pale, cloud, cloudShade, sun, glow, red, deepRed, orange, deepOrange,
        cream, creamShade, green, midGreen, deepGreen, basket, basketShade, rope] = c;

      g.fill(sky);
      g.band(18, 30, pale);

      // hills, back to front
      g.ellipse(27, 32, 14, 6, midGreen);
      g.ellipse(5, 33, 15, 6, green);
      g.band(34, 39, midGreen);
      g.ellipse(16, 41, 15, 6, green);
      g.ellipse(3, 39, 7, 3, deepGreen);
      g.ellipse(29, 38, 6, 3, deepGreen);

      // a row of trees along the far hill
      for (const [tx, ty, size] of [[6, 29, 1.5], [9, 28.5, 1.2], [22, 28.5, 1.3], [25, 29, 1.6], [28, 29.5, 1.2]]) {
        g.poly([[tx, ty - size * 2], [tx + size, ty + size], [tx - size, ty + size]], deepGreen);
        g.rect(tx - 0.3, ty + size - 0.2, 0.6, 1, rope);
      }

      // sun with a halo
      g.disc(26.5, 6.5, 4.6, glow);
      g.disc(26.5, 6.5, 3.2, sun);

      // clouds, each with its own underside
      const puff = (x, y, w, h) => {
        g.ellipse(x, y + h * 0.35, w, h * 0.75, cloudShade);
        g.ellipse(x, y, w, h, cloud);
        g.ellipse(x - w * 0.45, y + h * 0.25, w * 0.55, h * 0.7, cloud);
        g.ellipse(x + w * 0.45, y + h * 0.3, w * 0.5, h * 0.6, cloud);
      };
      puff(6, 7.5, 3.6, 1.9);
      puff(24, 19.5, 3.2, 1.6);
      puff(4.5, 23.5, 2.8, 1.4);

      /* The envelope: five gores striped down it, and everything right of
         the middle a shade darker, so it reads as round rather than flat. */
      const stripes = [red, cream, orange, cream, red];
      const shaded = { [red]: deepRed, [cream]: creamShade, [orange]: deepOrange };
      g.ellipseEach(16, 15, 9.5, 11, (x, y, dx) => {
        const stripe = stripes[Math.min(stripes.length - 1, Math.floor((dx + 1) / 2 * stripes.length))];
        g.poke(x, y, dx > 0.2 ? shaded[stripe] : stripe);
      });

      // the taper down to the basket, striped the same way
      g.poly([[8, 22], [24, 22], [19, 29], [13, 29]], cream);
      g.poly([[16, 22], [24, 22], [19, 29], [16, 29]], creamShade);
      g.poly([[10, 22], [13.5, 22], [15, 29], [13, 29]], red);
      g.poly([[18.5, 22], [22, 22], [19, 29], [17, 29]], deepRed);

      // rigging and basket
      g.line(13, 28.5, 12.6, 32, rope, 0.5);
      g.line(19, 28.5, 19.4, 32, rope, 0.5);
      g.rect(12.5, 32, 7, 4.5, basket);
      g.rect(16, 32, 3.5, 4.5, basketShade);
      g.rect(12.5, 33.2, 7, 0.9, rope);
      g.rect(12.5, 35, 7, 0.9, rope);

      // a second balloon, far off
      g.ellipse(4, 15, 1.9, 2.2, red);
      g.ellipse(4.7, 15, 1.2, 2.1, cream);
      g.rect(3.6, 17.4, 0.9, 0.8, basket);

      g.stamp(2, 20, ['b b', ' b '], { b: rope });
      g.stamp(28, 23, ['b b'], { b: rope });
      g.stamp(21, 12, ['b b'], { b: rope });
    },
  });

  picture({
    id: 'rocket',
    name: 'Blast Off',
    blurb: 'A rocket, a ringed planet',
    cols: 32, rows: 40,
    palette: [
      { hex: '#141a3a', name: 'Deep space' },
      { hex: '#2a3370', name: 'Nebula' },
      { hex: '#3f4a9c', name: 'Bright nebula' },
      { hex: '#fff6c9', name: 'Starlight' },
      { hex: '#e9edff', name: 'Hull' },
      { hex: '#b9c2e0', name: 'Hull shade' },
      { hex: '#8b94b8', name: 'Steel' },
      { hex: '#e8433f', name: 'Red' },
      { hex: '#a82b2f', name: 'Deep red' },
      { hex: '#35e7ff', name: 'Window' },
      { hex: '#1b8fb0', name: 'Window shade' },
      { hex: '#fff4b8', name: 'White hot' },
      { hex: '#ffd23f', name: 'Flame' },
      { hex: '#ff8a3d', name: 'Ember' },
      { hex: '#b46bff', name: 'Planet' },
      { hex: '#7a45c9', name: 'Planet shade' },
      { hex: '#5a34a0', name: 'Ring' },
    ],
    draw(g, c) {
      const [space, nebula, bright, star, hull, hullShade, steel, red, deepRed,
        window_, windowShade, hot, flame, ember, planet, planetShade, ring] = c;

      g.fill(space);
      g.ellipse(26, 31, 11, 8, nebula);
      g.ellipse(27, 32, 6, 4, bright);
      g.ellipse(6, 9, 10, 8, nebula);
      g.ellipse(5.5, 8, 6, 4.5, bright);
      g.speckle(30, star, 20260820, (x, y, at) => at === space);
      g.speckle(14, star, 77712, (x, y, at) => at === nebula || at === bright);

      // planet, its ring, and a moon
      g.ring(6.5, 8, 7.4, 3, 1.3, ring);
      g.disc(6.5, 8, 4.2, planet);
      g.ellipseEach(6.5, 8, 4.2, 4.2, (x, y, dx, dy) => {
        if (dx + dy * 0.4 > 0.28) g.poke(x, y, planetShade);
      });
      g.ellipse(5, 6.5, 1.4, 1, ring);
      g.ellipse(8.2, 9.6, 1, 0.8, ring);
      g.disc(27, 12, 1.6, steel);
      g.ellipse(27.6, 12.3, 0.9, 0.9, hullShade);

      /* The rocket is drawn down the left and folded across, so the shading
         is put on afterwards — a fold would mirror the lit side too. */
      g.poly([[16, 4], [12, 13], [16, 13]], red);
      g.poly([[12, 13], [11, 27], [16, 27], [16, 13]], hull);
      g.poly([[11, 19.5], [6.8, 29], [11, 29]], red);
      g.poly([[11, 22], [8.6, 29], [11, 29]], deepRed);
      g.rect(11, 27, 5, 2, steel);
      g.rect(11, 16.6, 5, 1.1, steel);
      g.rect(11, 23.5, 5, 0.9, steel);
      g.disc(16, 20, 3, steel);
      g.disc(16, 20, 2.2, window_);
      g.poly([[12, 29], [10, 35], [16, 38.5], [16, 29]], ember);
      g.poly([[13.4, 29], [12.2, 33], [16, 35.5], [16, 29]], flame);
      g.poly([[14.6, 29], [14, 31.5], [16, 33], [16, 29]], hot);
      g.mirror([space, nebula, bright, star, planet, planetShade, ring, steel, hullShade]);

      // one side of the rocket in shadow
      g.ellipseEach(16, 20, 2.2, 2.2, (x, y, dx, dy) => {
        if (dx + dy * 0.5 > 0.3) g.poke(x, y, windowShade);
      });
      g.poly([[18.4, 13], [21, 13], [20.6, 27], [18.4, 27]], hullShade);
      g.poly([[16, 4.6], [19.2, 11.6], [16, 11.6]], deepRed);
    },
  });

  picture({
    id: 'butterfly',
    name: 'Painted Lady',
    blurb: 'Wings, spot for spot',
    cols: 40, rows: 32,
    palette: [
      { hex: '#fdf6e6', name: 'Paper' },
      { hex: '#f7e3bd', name: 'Paper shade' },
      { hex: '#f6a01f', name: 'Amber' },
      { hex: '#d97f10', name: 'Deep amber' },
      { hex: '#e8622a', name: 'Rust' },
      { hex: '#b6431a', name: 'Deep rust' },
      { hex: '#2b2431', name: 'Ink' },
      { hex: '#ffffff', name: 'White' },
      { hex: '#7bc8e8', name: 'Sky blue' },
      { hex: '#a8d84f', name: 'Leaf' },
      { hex: '#6f9c2f', name: 'Deep leaf' },
      { hex: '#e8759f', name: 'Blossom' },
      { hex: '#6b4a2f', name: 'Body' },
      { hex: '#4a3120', name: 'Body shade' },
    ],
    draw(g, c) {
      const [paper, paperShade, amber, deepAmber, rust, deepRust, ink, white, blue,
        leaf, deepLeaf, blossom, body, bodyShade] = c;

      g.fill(paper);
      g.ellipse(20, 16, 18, 15, paperShade);
      g.ellipse(20, 15, 16.5, 13.5, paper);

      // upper wing, then lower, drawn on the left and folded across
      g.poly([[19, 6], [6, 2], [1, 9], [4, 16], [19, 15]], amber);
      g.poly([[19, 11], [5, 13.5], [4, 16], [19, 15]], deepAmber);
      g.poly([[19, 16], [7, 18], [3, 25], [10, 30], [19, 25]], rust);
      g.poly([[19, 21], [6.5, 24], [10, 30], [19, 25]], deepRust);

      // the dark edging, and the pale scallops set into it
      g.line(6, 2, 1, 9, ink, 1.5);
      g.line(1, 9, 4, 16, ink, 1.5);
      g.line(6, 2, 19, 6, ink, 1.5);
      g.line(3, 25, 10, 30, ink, 1.5);
      g.line(7, 18, 3, 25, ink, 1.5);
      g.line(10, 30, 19, 25, ink, 1.5);
      g.disc(3.6, 5.6, 0.85, white);
      g.disc(1.9, 9.4, 0.85, white);
      g.disc(3.2, 13.2, 0.8, white);
      g.disc(9.5, 3.2, 0.8, white);
      g.disc(14, 4.4, 0.8, white);
      g.disc(4.6, 22.6, 0.85, white);
      g.disc(7.4, 27.6, 0.85, white);
      g.disc(12.6, 28.6, 0.8, white);

      // spots
      g.disc(6.2, 6.6, 1.7, ink);
      g.disc(6.2, 6.6, 0.95, white);
      g.disc(9.6, 11.6, 1.9, ink);
      g.disc(9.6, 11.6, 1.15, blue);
      g.disc(14.4, 9.6, 1.4, ink);
      g.disc(14.4, 9.6, 0.75, white);
      g.disc(7.4, 22.4, 1.7, ink);
      g.disc(7.4, 22.4, 0.95, white);
      g.disc(12.4, 26, 1.5, ink);
      g.disc(12.4, 26, 0.85, blue);
      g.disc(15.4, 20.4, 1.3, ink);

      g.mirror([paper, paperShade]);

      // body, head, antennae
      g.ellipse(20, 16, 1.7, 11, body);
      g.ellipse(20.8, 16, 0.9, 10.4, bodyShade);
      g.disc(20, 4.6, 2.1, body);
      g.ellipse(20.7, 4.6, 1.2, 1.8, bodyShade);
      g.line(19, 4, 14.6, 0.6, ink, 0.55);
      g.line(21, 4, 25.4, 0.6, ink, 0.55);
      g.disc(14.4, 0.6, 0.9, ink);
      g.disc(25.6, 0.6, 0.9, ink);
      g.disc(19.2, 3.6, 0.55, white);
      g.disc(20.8, 3.6, 0.55, white);

      // a sprig either side, with a flower on it
      const sprig = (x0, y0, x1, y1, flip) => {
        g.line(x0, y0, x1, y1, deepLeaf, 0.7);
        g.ellipse(x0 + (x1 - x0) * 0.35, y0 + (y1 - y0) * 0.35 - 0.8 * flip, 1.9, 1, leaf);
        g.ellipse(x0 + (x1 - x0) * 0.7, y0 + (y1 - y0) * 0.7 + 0.9 * flip, 1.7, 0.95, leaf);
        g.disc(x1, y1, 1.5, blossom);
        g.disc(x1, y1, 0.6, white);
      };
      sprig(0.5, 31.4, 6, 28.4, 1);
      sprig(39.5, 31.4, 34, 28.4, -1);
    },
  });

  picture({
    id: 'spaniel',
    name: 'Good Dog',
    blurb: 'A springer spaniel, ears and all',
    cols: 32, rows: 36,
    palette: [
      { hex: '#ffe9a8', name: 'Sunny' },
      { hex: '#ffd166', name: 'Gold' },
      { hex: '#f0b93f', name: 'Deep gold' },
      { hex: '#ffffff', name: 'White' },
      { hex: '#e8dbcd', name: 'Shadow' },
      { hex: '#cbb9a4', name: 'Deep shadow' },
      { hex: '#a05a2c', name: 'Liver' },
      { hex: '#7a3f1c', name: 'Dark liver' },
      { hex: '#54290f', name: 'Deepest liver' },
      { hex: '#2b2028', name: 'Ink' },
      { hex: '#ff9db1', name: 'Tongue' },
      { hex: '#e0788f', name: 'Deep tongue' },
      { hex: '#7ec4a8', name: 'Collar' },
      { hex: '#4e9e83', name: 'Collar shade' },
    ],
    draw(g, c) {
      const [sunny, gold, deepGold, white, shadow, deepShadow, liver, dark, deepest,
        ink, tongue, deepTongue, collar, collarShade] = c;

      g.fill(sunny);
      g.disc(16, 17, 15, deepGold);
      g.disc(16, 17, 14, gold);

      // ears behind the head, each with a highlight down it
      g.ellipse(5, 21, 5.6, 11, deepest);
      g.ellipse(5.2, 20.4, 4.6, 9.8, dark);
      g.ellipse(5.4, 19, 2.6, 6.4, liver);

      // head, and the liver cap over it
      g.ellipse(16, 16, 9, 9.5, white);
      g.poly([[6.5, 9], [16, 6.5], [16, 13], [8, 13.5]], liver);
      g.poly([[6.5, 9], [11.4, 7.8], [11.4, 13.5], [8, 13.5]], dark);
      g.ellipse(9.5, 17.5, 3.4, 4.4, shadow);

      // eye
      g.disc(11, 16.5, 2.1, ink);
      g.disc(11.8, 15.7, 0.6, white);
      g.disc(10.4, 17.4, 0.35, white);

      // muzzle
      g.ellipse(16, 22, 6.5, 5.5, white);
      g.ellipse(16, 25, 5, 3.4, shadow);
      g.ellipse(13, 24.6, 2.6, 2.2, deepShadow);
      g.disc(12.6, 22.4, 0.45, liver);
      g.disc(13.8, 23.6, 0.4, liver);
      g.disc(11.8, 23.8, 0.35, liver);

      g.mirror([sunny, gold, deepGold]);

      // nose, mouth and tongue on the centre line
      g.ellipse(16, 20.4, 2.9, 2.1, ink);
      g.stamp(15, 19, ['w', ' '], { w: shadow });
      g.stamp(17, 19, ['w'], { w: shadow });
      g.line(16, 22, 16, 24, ink, 0.5);
      g.line(16, 24, 13.4, 25.2, ink, 0.5);
      g.line(16, 24, 18.6, 25.2, ink, 0.5);
      g.ellipse(16, 27.2, 2.4, 2.3, tongue);
      g.ellipse(16, 28.2, 1.6, 1.3, deepTongue);

      // collar and tag
      g.poly([[5.5, 30], [26.5, 30], [24, 34.5], [8, 34.5]], collar);
      g.poly([[5.5, 32.4], [26.5, 32.4], [24, 34.5], [8, 34.5]], collarShade);
      g.disc(16, 33.4, 1.8, deepGold);
      g.disc(16, 33.4, 1.1, gold);
    },
  });

  picture({
    id: 'sailboat',
    name: 'Evening Sail',
    blurb: 'A boat, a sun going down',
    cols: 40, rows: 32,
    palette: [
      { hex: '#e2557a', name: 'Rose' },
      { hex: '#ff8b5e', name: 'Coral' },
      { hex: '#ffc46b', name: 'Sunset' },
      { hex: '#ffe9a0', name: 'Glow' },
      { hex: '#fff6d8', name: 'Sun' },
      { hex: '#ffd9b0', name: 'Cloud' },
      { hex: '#f0a98a', name: 'Cloud shade' },
      { hex: '#fff3d1', name: 'Sail' },
      { hex: '#e6d0a8', name: 'Sail shade' },
      { hex: '#2f5d8a', name: 'Sea' },
      { hex: '#1c3c63', name: 'Deep sea' },
      { hex: '#12293f', name: 'Night sea' },
      { hex: '#f7b733', name: 'Reflection' },
      { hex: '#7a3b2e', name: 'Hull' },
      { hex: '#4d2118', name: 'Hull shade' },
      { hex: '#3a2118', name: 'Mast' },
    ],
    draw(g, c) {
      const [rose, coral, sunset, glow, sun, cloud, cloudShade, sail, sailShade,
        sea, deepSea, nightSea, reflect, hull, hullShade, mast] = c;

      g.band(0, 4, rose);
      g.band(5, 10, coral);
      g.band(11, 18, sunset);
      g.ellipse(27, 19, 8, 5, glow);
      g.disc(27, 19, 5.4, sun);

      // streaks of cloud across the sky
      const streak = (x, y, w, h) => {
        g.ellipse(x, y + h * 0.5, w, h * 0.7, cloudShade);
        g.ellipse(x, y, w, h, cloud);
        g.ellipse(x - w * 0.5, y + h * 0.2, w * 0.5, h * 0.6, cloud);
      };
      streak(9, 3.5, 6, 1.1);
      streak(30, 6.5, 5.5, 1);
      streak(6, 9.5, 4.5, 0.9);
      streak(33, 13, 4, 0.8);

      g.band(19, 24, sea);
      g.band(25, 28, deepSea);
      g.band(29, 31, nightSea);

      // the sun's path, breaking up as it comes towards you
      g.ellipse(27, 19.6, 4.6, 0.9, reflect);
      g.ellipse(26, 21.4, 3.4, 0.7, reflect);
      g.ellipse(29, 22.6, 2.4, 0.6, reflect);
      g.ellipse(25.5, 24, 2.8, 0.6, reflect);
      g.ellipse(30, 25.6, 2.2, 0.6, reflect);
      g.ellipse(26.5, 27.4, 2.6, 0.6, reflect);
      g.ellipse(31, 29.4, 2, 0.55, reflect);

      // mast, boom and sails
      g.line(14, 3.4, 14, 19, mast, 0.55);
      g.poly([[13.2, 4.6], [13.2, 18], [4, 18]], sail);
      g.poly([[13.2, 12], [13.2, 18], [7, 18]], sailShade);
      g.poly([[14.8, 7], [14.8, 18], [21, 18]], sail);
      g.poly([[14.8, 13.5], [14.8, 18], [18.6, 18]], sailShade);
      g.line(13.2, 4.6, 4, 18, mast, 0.45);
      g.line(14.8, 7, 21, 18, mast, 0.45);
      g.rect(3.6, 17.6, 18, 0.7, mast);
      g.poly([[14, 2], [17.5, 3], [14, 4]], rose);

      // hull
      g.poly([[3, 18.6], [23, 18.6], [19, 24], [7, 24]], hull);
      g.poly([[4.5, 21.4], [21.4, 21.4], [19, 24], [7, 24]], hullShade);
      g.rect(3.2, 18.6, 19.8, 1.1, mast);

      // gulls
      g.stamp(30, 5, ['g g', ' g '], { g: mast });
      g.stamp(34, 8, ['g g'], { g: mast });
      g.stamp(5, 2, ['g g'], { g: mast });
      g.stamp(24, 3, ['g g'], { g: mast });
    },
  });

  picture({
    id: 'cupcake',
    name: 'Sprinkles',
    blurb: 'A cupcake with a cherry on top',
    cols: 32, rows: 40,
    palette: [
      { hex: '#ffeaf3', name: 'Icing pink' },
      { hex: '#ffd0e2', name: 'Blush' },
      { hex: '#f7b3ce', name: 'Deep blush' },
      { hex: '#f7f2ff', name: 'Frosting' },
      { hex: '#ddd4f0', name: 'Frosting shade' },
      { hex: '#ffb3d1', name: 'Rose' },
      { hex: '#e888ad', name: 'Deep rose' },
      { hex: '#e04f7a', name: 'Cherry' },
      { hex: '#b02f56', name: 'Deep cherry' },
      { hex: '#2f9e6e', name: 'Stalk' },
      { hex: '#d99a52', name: 'Sponge' },
      { hex: '#a9702f', name: 'Crust' },
      { hex: '#7ec8e8', name: 'Blue' },
      { hex: '#ffd23f', name: 'Yellow' },
      { hex: '#b46bff', name: 'Violet' },
      { hex: '#6fd39b', name: 'Mint' },
    ],
    draw(g, c) {
      const [bg, blush, deepBlush, frosting, frostingShade, rose, deepRose, cherry,
        deepCherry, stalk, sponge, crust, blue, yellow, violet, mint] = c;

      g.fill(bg);
      g.disc(16, 21, 14.5, deepBlush);
      g.disc(16, 20.5, 13.5, blush);

      // wrapper, pleated and shaded down one side
      g.poly([[7, 24], [25, 24], [22, 37], [10, 37]], sponge);
      g.poly([[16, 24], [25, 24], [22, 37], [16, 37]], crust);
      for (let x = 8.5; x < 25; x += 2.6) {
        g.line(x, 24.4, x - (x - 16) * 0.2, 37, x > 16 ? sponge : crust, 0.55);
      }
      g.rect(6.8, 23, 18.4, 1.6, crust);
      g.rect(6.8, 23, 9.2, 1.6, sponge);

      // frosting: three swirls, each shaded underneath
      const swirl = (x, y, rx, ry, top, under) => {
        g.ellipse(x, y, rx, ry, under);
        g.ellipse(x, y - ry * 0.3, rx * 0.95, ry * 0.8, top);
      };
      swirl(16, 21.4, 9.2, 4.6, frosting, frostingShade);
      swirl(11.6, 18.6, 4.8, 4, rose, deepRose);
      swirl(20.4, 18.6, 4.8, 4, frosting, frostingShade);
      swirl(16, 16, 6.8, 4.6, rose, deepRose);
      swirl(16, 12, 4.8, 3.6, frosting, frostingShade);
      swirl(16, 8.8, 3, 2.5, rose, deepRose);

      // cherry
      g.disc(16, 5.6, 2.8, cherry);
      g.ellipseEach(16, 5.6, 2.8, 2.8, (x, y, dx, dy) => {
        if (dx + dy * 0.5 > 0.35) g.poke(x, y, deepCherry);
      });
      g.disc(15.1, 4.6, 0.7, bg);
      g.line(16, 3.4, 19.4, 0.8, stalk, 0.6);
      g.ellipse(21, 0.9, 2, 1.1, stalk);

      // sprinkles, placed by hand so none lands off the frosting
      const dots = [
        [9.5, 21.5, blue], [13, 23, yellow], [18.5, 22.4, violet], [22, 21, mint],
        [11, 17, blue], [19.6, 16.4, yellow], [14, 13.6, violet], [18, 12.6, mint],
        [15, 10.4, blue], [21.4, 18.6, violet], [7.6, 22, mint], [24, 22.4, blue],
        [12.4, 19.6, yellow], [17.2, 19.2, blue], [13.6, 16.2, mint], [20, 21.6, yellow],
      ];
      for (const [x, y, colour] of dots) g.ellipse(x, y, 0.9, 0.55, colour);
    },
  });

  // ------------------------------------------------------------- assembly

  /* Turn a definition into the thing the app colours in: a flat array of
     numbers plus the palette they point at. Colours that end up unused are
     dropped, so a picture never shows a swatch with nothing to fill. */
  function build(def, detail) {
    const g = grid(def.cols, def.rows, detail || DETAIL);
    const indexes = def.palette.map((_, k) => k + 1);
    def.draw(g, indexes);

    const used = new Set(g.cells);
    const remap = new Uint8Array(def.palette.length + 1);
    const palette = [];
    def.palette.forEach((swatch, k) => {
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
    grid,
    list: (detail) => PICTURES.map(def => build(def, detail)),
    build,
    definitions: PICTURES,
  };

  if (typeof module === 'object' && module.exports) module.exports = api;
  else self.PigmentPictures = api;
})();
