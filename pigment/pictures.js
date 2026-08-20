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

  // ------------------------------------------------------------ the grid

  function grid(cols, rows) {
    const cells = new Uint8Array(cols * rows);

    const g = {
      cols, rows, cells,

      set(x, y, i) {
        x = Math.round(x); y = Math.round(y);
        if (x >= 0 && y >= 0 && x < cols && y < rows) cells[y * cols + x] = i;
        return g;
      },

      get(x, y) {
        if (x < 0 || y < 0 || x >= cols || y >= rows) return -1;
        return cells[y * cols + x];
      },

      fill(i) { cells.fill(i); return g; },

      rect(x, y, w, h, i) {
        for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) g.set(xx, yy, i);
        return g;
      },

      band(y0, y1, i) { return g.rect(0, y0, cols, y1 - y0 + 1, i); },

      // Fractional centres and radii are allowed — cells are sampled at their
      // middle, so a circle can sit between two columns and still look round.
      ellipseEach(cx, cy, rx, ry, fn) {
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
        return g.ellipseEach(cx, cy, rx, ry, (x, y) => g.set(x, y, i));
      },

      disc(cx, cy, r, i) { return g.ellipse(cx, cy, r, r, i); },

      ring(cx, cy, rx, ry, thickness, i) {
        return g.ellipseEach(cx, cy, rx, ry, (x, y, dx, dy) => {
          const inner = 1 - thickness / Math.min(rx, ry);
          if (dx * dx + dy * dy >= inner * inner) g.set(x, y, i);
        });
      },

      // Even-odd scanline fill, sampling at cell centres.
      poly(pts, i) {
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
            for (let x = from; x <= to; x++) g.set(x, y, i);
          }
        }
        return g;
      },

      line(x0, y0, x1, y1, i, thickness) {
        const t = thickness || 1;
        const steps = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 2) + 1;
        for (let s = 0; s <= steps; s++) {
          const f = s / steps, x = x0 + (x1 - x0) * f, y = y0 + (y1 - y0) * f;
          if (t <= 1) g.set(x, y, i);
          else g.disc(x + 0.5, y + 0.5, t / 2, i);
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
          const x = Math.floor(rnd() * cols), y = Math.floor(rnd() * rows);
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
      { hex: '#e8f6ff', name: 'Pale sky' },
      { hex: '#ffffff', name: 'Cloud' },
      { hex: '#ffd23f', name: 'Sunshine' },
      { hex: '#e8433f', name: 'Red' },
      { hex: '#ff8a3d', name: 'Orange' },
      { hex: '#fbeacb', name: 'Cream' },
      { hex: '#2f9e6e', name: 'Green' },
      { hex: '#1d6f4e', name: 'Deep green' },
      { hex: '#8a5a2b', name: 'Basket' },
      { hex: '#3b2a1d', name: 'Rope' },
    ],
    draw(g, c) {
      const [sky, pale, cloud, sun, red, orange, cream, green, deep, basket, rope] = c;

      g.fill(sky);
      g.band(20, 29, pale);

      // hills
      g.ellipse(6, 34, 16, 7, green);
      g.ellipse(27, 33, 13, 6, deep);
      g.band(35, 39, green);
      g.ellipse(16, 40, 13, 5, deep);

      g.disc(26.5, 6.5, 3.5, sun);
      g.ellipse(6, 8, 4, 2, cloud);
      g.ellipse(8, 7, 2.5, 2, cloud);
      g.ellipse(24, 20, 3.5, 1.8, cloud);
      g.ellipse(4, 24, 3, 1.6, cloud);

      // envelope: a teardrop striped down its gores
      const stripes = [red, cream, orange, cream, red];
      g.ellipseEach(16, 15, 9.5, 11, (x, y, dx) => {
        g.set(x, y, stripes[Math.min(stripes.length - 1, Math.floor((dx + 1) / 2 * stripes.length))]);
      });
      g.poly([[8, 22], [24, 22], [19, 29], [13, 29]], cream);
      g.poly([[10, 22], [13.5, 22], [15, 29], [13, 29]], red);
      g.poly([[18.5, 22], [22, 22], [19, 29], [17, 29]], red);

      // basket and its rigging
      g.line(13, 29, 12.5, 32, rope);
      g.line(19, 29, 19.5, 32, rope);
      g.rect(13, 32, 6, 4, basket);
      g.rect(13, 33, 6, 1, rope);
      g.rect(13, 35, 6, 1, rope);

      // two birds, out over the empty sky rather than across the balloon
      g.stamp(2, 20, ['b b', ' b '], { b: rope });
      g.stamp(27, 23, ['b b'], { b: rope });
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
      { hex: '#fff6c9', name: 'Starlight' },
      { hex: '#e9edff', name: 'Hull' },
      { hex: '#9aa4c8', name: 'Steel' },
      { hex: '#e8433f', name: 'Red' },
      { hex: '#35e7ff', name: 'Window' },
      { hex: '#ffd23f', name: 'Flame' },
      { hex: '#ff8a3d', name: 'Ember' },
      { hex: '#b46bff', name: 'Planet' },
      { hex: '#6a3fb5', name: 'Ring' },
    ],
    draw(g, c) {
      const [space, nebula, star, hull, steel, red, window_, flame, ember, planet, ring] = c;

      /* Everything behind the rocket is painted first, because the fold below
         leaves these colours alone — otherwise the right-hand side of the sky
         would come out as a mirror image of the left. */
      g.fill(space);
      g.ellipse(26, 31, 11, 8, nebula);
      g.ellipse(6, 9, 10, 8, nebula);
      g.speckle(38, star, 20260820, (x, y, at) => at === space || at === nebula);

      /* Planet up in the top-left corner: its ring has to clear the rocket's
         nose, and there is only room for a ring on one side of the picture. */
      g.ring(6.5, 8, 7.4, 3, 1.3, ring);
      g.disc(6.5, 8, 4.2, planet);
      g.ellipse(5, 6.5, 1.4, 1, ring);
      g.ellipse(8.5, 9.5, 1.1, 0.8, ring);

      // the rocket itself: left half only, then folded across the middle
      g.poly([[16, 5], [12, 13], [16, 13]], red);          // nose
      g.poly([[12, 13], [11, 27], [16, 27], [16, 13]], hull);
      g.poly([[11, 20], [7, 29], [11, 29]], red);          // fin
      g.rect(11, 27, 5, 2, steel);
      g.rect(11, 17, 5, 1, steel);
      g.disc(16, 17.5, 2.6, steel);
      g.disc(16, 17.5, 1.8, window_);
      g.poly([[12, 29], [10, 35], [16, 38], [16, 29]], ember);
      g.poly([[13.5, 29], [12.5, 33], [16, 35], [16, 29]], flame);
      g.mirror([space, nebula, star, planet, ring]);

      g.stamp(4, 30, [' s ', 'sSs', ' s '], { s: star, S: star });
    },
  });

  picture({
    id: 'butterfly',
    name: 'Painted Lady',
    blurb: 'Wings, spot for spot',
    cols: 40, rows: 32,
    palette: [
      { hex: '#fdf6e6', name: 'Paper' },
      { hex: '#f6a01f', name: 'Amber' },
      { hex: '#e8622a', name: 'Rust' },
      { hex: '#2b2431', name: 'Ink' },
      { hex: '#ffffff', name: 'White' },
      { hex: '#7bc8e8', name: 'Sky blue' },
      { hex: '#a8d84f', name: 'Leaf' },
      { hex: '#6b4a2f', name: 'Body' },
    ],
    draw(g, c) {
      const [paper, amber, rust, ink, white, blue, leaf, body] = c;

      g.fill(paper);

      // upper and lower wing on the left, then folded across the middle
      g.poly([[19, 6], [6, 2], [1, 9], [4, 16], [19, 15]], amber);
      g.poly([[19, 16], [7, 18], [3, 25], [10, 30], [19, 25]], rust);

      // wing edging and the pale spots that make it a painted lady
      g.poly([[19, 6], [6, 2], [1, 9], [4, 16], [19, 15]].map(([x, y]) => [x, y]), amber);
      g.line(6, 2, 1, 9, ink, 1.6);
      g.line(1, 9, 4, 16, ink, 1.6);
      g.line(6, 2, 19, 6, ink, 1.6);
      g.line(3, 25, 10, 30, ink, 1.6);
      g.line(7, 18, 3, 25, ink, 1.6);
      g.line(10, 30, 19, 25, ink, 1.6);

      g.disc(5.5, 6, 1.6, ink);
      g.disc(5.5, 6, 0.9, white);
      g.disc(9, 12, 1.8, ink);
      g.disc(9, 12, 1.1, blue);
      g.disc(14, 10, 1.3, ink);
      g.disc(6.5, 23, 1.6, ink);
      g.disc(6.5, 23, 0.9, white);
      g.disc(12, 26, 1.4, ink);
      g.disc(12, 26, 0.8, blue);
      g.disc(15, 20, 1.2, ink);

      g.mirror();

      // body, head and antennae down the centre line
      g.ellipse(20, 16, 1.6, 11, body);
      g.disc(20, 4.5, 2, body);
      g.line(19, 4, 15, 0, ink);
      g.line(21, 4, 25, 0, ink);
      g.disc(15, 0.5, 0.9, ink);
      g.disc(25, 0.5, 0.9, ink);
      g.stamp(18, 3, ['w w'], { w: white });

      // a sprig of leaves in the corner so the paper is not just empty
      g.line(2, 31, 9, 27, leaf, 1.4);
      g.ellipse(5, 28, 2, 1, leaf);
      g.ellipse(9, 26, 1.8, 1, leaf);
      g.line(38, 31, 32, 28, leaf, 1.4);
      g.ellipse(34, 28, 1.8, 1, leaf);
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
      { hex: '#ffffff', name: 'White' },
      { hex: '#e6d3c0', name: 'Shadow' },
      { hex: '#8a4a28', name: 'Liver' },
      { hex: '#5c2f18', name: 'Dark liver' },
      { hex: '#2b2028', name: 'Ink' },
      { hex: '#ff9db1', name: 'Tongue' },
      { hex: '#7ec4a8', name: 'Collar' },
    ],
    draw(g, c) {
      const [sunny, gold, white, shadow, liver, dark, ink, tongue, collar] = c;

      g.fill(sunny);
      g.disc(16, 17, 14.5, gold);

      /* Ears first: the head is drawn on top of them, so the long liver ears
         end up hanging behind the face the way a springer's do. */
      g.ellipse(5, 21, 5.6, 11, dark);
      g.ellipse(5.5, 20, 3.6, 8.4, liver);

      // head, with the liver cap that stops at the eyebrows
      g.ellipse(16, 16, 9, 9.5, white);
      g.poly([[6.5, 9], [16, 6.5], [16, 13], [8, 13.5]], liver);

      // eye, set into the white below the cap
      g.disc(11, 16.5, 1.9, ink);
      g.disc(11.6, 15.9, 0.8, white);

      // muzzle
      g.ellipse(16, 22, 6.5, 5.5, white);
      g.ellipse(16, 25, 5, 3.4, shadow);

      g.mirror();

      // nose, mouth and tongue sit on the centre line, after the fold
      g.ellipse(16, 20.5, 2.8, 2, ink);
      g.stamp(14, 19, [' ww '], { w: white });
      g.line(16, 22, 16, 24, ink);
      g.line(16, 24, 13.5, 25, ink);
      g.line(16, 24, 18.5, 25, ink);
      g.ellipse(16, 27, 2.4, 2.2, tongue);

      // collar under the chin
      g.poly([[6, 30], [26, 30], [24, 34], [8, 34]], collar);
      g.disc(16, 33, 1.6, gold);
    },
  });

  picture({
    id: 'sailboat',
    name: 'Evening Sail',
    blurb: 'A boat, a sun going down',
    cols: 40, rows: 32,
    palette: [
      { hex: '#ffc46b', name: 'Sunset' },
      { hex: '#ff8b5e', name: 'Coral' },
      { hex: '#e2557a', name: 'Rose' },
      { hex: '#ffe9a0', name: 'Glow' },
      { hex: '#fff3d1', name: 'Sail' },
      { hex: '#2f5d8a', name: 'Sea' },
      { hex: '#1c3c63', name: 'Deep sea' },
      { hex: '#f7b733', name: 'Reflection' },
      { hex: '#7a3b2e', name: 'Hull' },
      { hex: '#3a2118', name: 'Mast' },
    ],
    draw(g, c) {
      const [sunset, coral, rose, glow, sail, sea, deep, reflect, hull, mast] = c;

      g.band(0, 5, rose);
      g.band(6, 11, coral);
      g.band(12, 18, sunset);
      g.disc(27, 17, 6, glow);
      g.band(19, 25, sea);
      g.band(26, 31, deep);

      // the sun's path across the water, breaking up as it comes towards you
      g.rect(25, 19, 5, 2, reflect);
      g.rect(24, 22, 3, 1, reflect);
      g.rect(29, 22, 3, 1, reflect);
      g.rect(26, 24, 4, 1, reflect);
      g.rect(23, 27, 3, 1, reflect);
      g.rect(30, 28, 4, 1, reflect);

      // sails and mast
      g.line(14, 4, 14, 19, mast, 1.2);
      g.poly([[13, 5], [13, 18], [4, 18]], sail);
      g.poly([[15, 7], [15, 18], [21, 18]], sail);
      g.line(13, 5, 4, 18, mast);
      g.line(15, 7, 21, 18, mast);

      // hull sitting in the water
      g.poly([[3, 19], [23, 19], [19, 24], [7, 24]], hull);
      g.poly([[5, 19], [21, 19], [20.5, 21], [5.5, 21]], mast);

      // three gulls
      g.stamp(30, 6, ['g g', ' g '], { g: mast });
      g.stamp(34, 9, ['g g'], { g: mast });
      g.stamp(5, 3, ['g g'], { g: mast });
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
      { hex: '#f7f2ff', name: 'Frosting' },
      { hex: '#ffb3d1', name: 'Rose' },
      { hex: '#e04f7a', name: 'Cherry' },
      { hex: '#2f9e6e', name: 'Stalk' },
      { hex: '#c98a4b', name: 'Sponge' },
      { hex: '#8a5a2b', name: 'Crust' },
      { hex: '#7bc8e8', name: 'Blue' },
      { hex: '#ffd23f', name: 'Yellow' },
      { hex: '#b46bff', name: 'Violet' },
    ],
    draw(g, c) {
      const [bg, blush, frosting, rose, cherry, stalk, sponge, crust, blue, yellow, violet] = c;

      g.fill(bg);
      g.disc(16, 21, 14, blush);

      // wrapper: a tapered tub with pleats
      g.poly([[7, 24], [25, 24], [22, 37], [10, 37]], sponge);
      for (let x = 8; x < 25; x += 3) g.line(x + 0.5, 24, x + 0.5 - (x - 16) * 0.18, 37, crust);
      g.rect(7, 23, 18, 2, crust);

      // frosting: three swirls, each smaller than the one below
      g.ellipse(16, 22, 9, 4.5, frosting);
      g.ellipse(12, 19, 4.5, 4, rose);
      g.ellipse(20, 19, 4.5, 4, frosting);
      g.ellipse(16, 16.5, 6.5, 4.5, rose);
      g.ellipse(16, 12.5, 4.5, 3.5, frosting);
      g.ellipse(16, 9.5, 2.8, 2.4, rose);

      // cherry
      g.disc(16, 6, 2.6, cherry);
      g.stamp(15, 4, ['w', ' '], { w: frosting });
      g.line(16, 4, 19, 1, stalk);
      g.ellipse(20.5, 1, 1.8, 1, stalk);

      // sprinkles, laid on by hand so none of them lands off the frosting
      const dots = [
        [10, 21, blue], [13, 23, yellow], [18, 22, violet], [22, 21, yellow],
        [11, 17, blue], [19, 16, blue], [14, 14, violet], [18, 13, yellow],
        [15, 11, blue], [21, 18, violet], [8, 22, violet], [24, 22, blue],
      ];
      for (const [x, y, i] of dots) { g.set(x, y, i); g.set(x + 1, y, i); }
    },
  });

  // ------------------------------------------------------------- assembly

  /* Turn a definition into the thing the app colours in: a flat array of
     numbers plus the palette they point at. Colours that end up unused are
     dropped, so a picture never shows a swatch with nothing to fill. */
  function build(def) {
    const g = grid(def.cols, def.rows);
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
      cols: def.cols,
      rows: def.rows,
      palette,
      cells,
    };
  }

  const api = {
    PAPER,
    grid,
    list: () => PICTURES.map(build),
    build,
    definitions: PICTURES,
  };

  if (typeof module === 'object' && module.exports) module.exports = api;
  else self.PigmentPictures = api;
})();
