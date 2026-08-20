/* Pigment — colour by number.

   No build step and no dependencies. pictures.js draws each picture onto a
   grid of colour numbers, regions.js turns that grid into outlined areas
   with a number in each, and this file draws those areas, works out which
   one a finger landed on, and remembers what has been filled in.

   Everything — progress, the pictures made from photos, the sound — stays on
   the device. */
(() => {
  'use strict';

  const PICTURES = self.PigmentPictures;
  const REGIONS = self.PigmentRegions;

  const PAPER = '#ffffff';           // an area still waiting for its colour
  const OUTLINE = '#3a4260';         // the line around every area
  const NUMBER_INK = '#7d879f';
  const MAT = '#232a44';             // the board around the picture
  const MAX_CUSTOM = 24;

  // How the grid is cut into areas. Anything smaller than this, or too thin
  // to hold its own number, is given to a neighbour instead.
  const SHAPE = { minArea: 12, minRoom: 1.6, simplify: 0.9, smoothing: 2 };

  // ------------------------------------------------------------- storage

  const store = {
    get(key) { try { return localStorage.getItem(key); } catch (e) { return null; } },
    set(key, value) { try { localStorage.setItem(key, value); return true; } catch (e) { return false; } },
    remove(key) { try { localStorage.removeItem(key); } catch (e) { /* nothing to do */ } },
  };

  const KEY_CUSTOM = 'pigment.custom';
  const KEY_SOUND = 'pigment.sound';
  // Progress is kept per area. The name carries the shape of the picture, so
  // a picture that is redrawn one day starts again rather than restoring
  // half-filled nonsense from an older set of areas.
  const progressKey = (id) => 'pigment.areas.' + id;

  function toBase64(bytes) {
    let out = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      out += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(out);
  }

  function fromBase64(text) {
    const binary = atob(text);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  }

  // One bit per area, so a picture costs a few dozen bytes however long it
  // took to colour in.
  function packBits(flags) {
    const out = new Uint8Array(Math.ceil(flags.length / 8));
    for (let i = 0; i < flags.length; i++) if (flags[i]) out[i >> 3] |= 1 << (i & 7);
    return out;
  }

  function unpackBits(bytes, length) {
    const out = new Uint8Array(length);
    for (let i = 0; i < length; i++) out[i] = (bytes[i >> 3] >> (i & 7)) & 1;
    return out;
  }

  // --------------------------------------------------------------- colour

  function hexToRgb(hex) {
    return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
  }

  const toHex = (r, g, b) => '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');

  function mix(hexA, hexB, amount) {
    const a = hexToRgb(hexA), b = hexToRgb(hexB);
    return toHex(a[0] + (b[0] - a[0]) * amount, a[1] + (b[1] - a[1]) * amount, a[2] + (b[2] - a[2]) * amount);
  }

  const luminance = (hex) => {
    const [r, g, b] = hexToRgb(hex);
    return (r * 0.299 + g * 0.587 + b * 0.114) / 255;
  };

  /* Areas waiting for the colour in hand are tinted with it. A pale colour
     tints to something indistinguishable from blank paper, so anything
     without enough contrast of its own gets a neutral wash instead: the
     point is to show which areas are next, not to preview the shade. */
  function waitingTint(hex) {
    const tint = mix(PAPER, hex, 0.3);
    if (Math.abs(luminance(tint) - luminance(PAPER)) < 0.05) return mix(PAPER, '#8794b4', 0.26);
    return tint;
  }

  // --------------------------------------------------------------- sound

  const sound = {
    on: store.get(KEY_SOUND) !== '0',
    ctx: null,
    step: 0,
    lastBlip: -1,

    resume() {
      if (!this.on) return null;
      if (!this.ctx) {
        const Ctx = self.AudioContext || self.webkitAudioContext;
        if (!Ctx) return null;
        this.ctx = new Ctx();
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return this.ctx;
    },

    note(freq, when, length, gain, type) {
      const ctx = this.ctx;
      const osc = ctx.createOscillator();
      const amp = ctx.createGain();
      osc.type = type || 'triangle';
      osc.frequency.value = freq;
      amp.gain.setValueAtTime(0.0001, when);
      amp.gain.exponentialRampToValueAtTime(gain, when + 0.012);
      amp.gain.exponentialRampToValueAtTime(0.0001, when + length);
      osc.connect(amp).connect(ctx.destination);
      osc.start(when);
      osc.stop(when + length + 0.02);
    },

    // A pentatonic run, so filling a stretch of sky sounds like something
    // rather than a stuck key.
    blip() {
      const ctx = this.resume();
      if (!ctx) return;
      if (ctx.currentTime - this.lastBlip < 0.045) return;
      this.lastBlip = ctx.currentTime;
      const scale = [523.25, 587.33, 698.46, 783.99, 880.0];
      this.note(scale[this.step % scale.length], ctx.currentTime, 0.09, 0.07);
      this.step++;
    },

    chime() {
      const ctx = this.resume();
      if (!ctx) return;
      this.step = 0;
      this.note(783.99, ctx.currentTime, 0.16, 0.08);
      this.note(1174.66, ctx.currentTime + 0.09, 0.24, 0.07);
    },

    fanfare() {
      const ctx = this.resume();
      if (!ctx) return;
      [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
        this.note(freq, ctx.currentTime + i * 0.11, 0.34, 0.08, 'sine');
      });
    },
  };

  // -------------------------------------------------------------- puzzles

  let builtIn = [];
  let custom = [];
  const prepared = new Map();        // picture id -> areas, worked out once

  function loadCustom() {
    const raw = store.get(KEY_CUSTOM);
    if (!raw) return [];
    try {
      return JSON.parse(raw).map(item => ({
        id: item.id,
        name: item.name,
        number: item.number || 0,
        blurb: item.blurb || 'From your photos',
        cols: item.cols,
        rows: item.rows,
        palette: item.palette,
        cells: fromBase64(item.cells),
        custom: true,
      }));
    } catch (e) {
      return [];
    }
  }

  function saveCustom() {
    const packed = custom.map(p => ({
      id: p.id, name: p.name, number: p.number, blurb: p.blurb,
      cols: p.cols, rows: p.rows, palette: p.palette, cells: toBase64(p.cells),
    }));
    return store.set(KEY_CUSTOM, JSON.stringify(packed));
  }

  const allPuzzles = () => custom.concat(builtIn);
  const puzzleById = (id) => allPuzzles().find(p => p.id === id);

  /* Working out the areas takes a moment, so it happens once per picture and
     is then kept for the rest of the session. */
  function prepare(puzzle) {
    const known = prepared.get(puzzle.id);
    if (known) return known;
    const shape = REGIONS.prepare(puzzle, SHAPE);
    shape.id = puzzle.id;
    shape.name = puzzle.name;
    shape.blurb = puzzle.blurb;
    shape.custom = puzzle.custom;
    for (const region of shape.regions) region.path = new Path2D(REGIONS.ringsToPath(region.rings));
    prepared.set(puzzle.id, shape);
    return shape;
  }

  function loadProgress(shape) {
    const filled = new Uint8Array(shape.regions.length);
    const raw = store.get(progressKey(shape.id));
    if (raw) {
      try {
        const bits = unpackBits(fromBase64(raw), shape.regions.length);
        filled.set(bits);
      } catch (e) { /* a corrupt save just starts the picture again */ }
    }
    return filled;
  }

  const countFilled = (filled) => filled.reduce((total, value) => total + value, 0);

  // ----------------------------------------------------------------- DOM

  const $ = (id) => document.getElementById(id);
  const gallery = $('gallery');
  const paintView = $('paint');
  const board = $('board');
  const canvas = $('canvas');
  const ctx = canvas.getContext('2d');
  const paletteEl = $('palette');
  const titleEl = $('title');
  const subtitleEl = $('subtitle');
  const backBtn = $('backBtn');
  const soundBtn = $('soundBtn');
  const progressFill = $('progressFill');
  const toastEl = $('toast');
  const doneEl = $('done');
  const doneText = $('doneText');
  const cardsEl = $('cards');
  const makeStatus = $('makeStatus');

  let toastTimer = 0;

  function toast(message, ms) {
    toastEl.textContent = message;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.hidden = true; }, ms || 1800);
  }

  // ------------------------------------------------------------- gallery

  /* Before a picture has been opened its areas aren't worked out yet, so the
     card shows a washed-out version of the finished picture straight from
     the grid — enough to tell the pictures apart, and it comes up to full
     strength as the real thing is filled in. */
  function thumbnail(puzzle) {
    const scale = 3;
    const el = document.createElement('canvas');
    el.width = puzzle.cols * scale;
    el.height = puzzle.rows * scale;
    const c = el.getContext('2d');
    c.fillStyle = PAPER;
    c.fillRect(0, 0, el.width, el.height);

    const shape = prepared.get(puzzle.id);
    if (!shape) {
      for (let y = 0; y < puzzle.rows; y++) {
        for (let x = 0; x < puzzle.cols; x++) {
          const n = puzzle.cells[y * puzzle.cols + x];
          if (!n) continue;
          c.fillStyle = mix(puzzle.palette[n - 1].hex, PAPER, 0.76);
          c.fillRect(x * scale, y * scale, scale, scale);
        }
      }
      return el;
    }

    const filled = state && state.shape.id === puzzle.id ? state.filled : loadProgress(shape);
    c.setTransform(scale, 0, 0, scale, 0, 0);
    for (const region of shape.regions) {
      const hex = shape.palette[region.colour - 1].hex;
      c.fillStyle = filled[region.id] ? hex : mix(hex, PAPER, 0.76);
      c.fill(region.path, 'evenodd');
      c.lineWidth = 1 / scale;
      c.strokeStyle = c.fillStyle;
      c.stroke(region.path);
    }
    return el;
  }

  function progressOf(puzzle) {
    const shape = prepared.get(puzzle.id);
    if (shape) {
      const filled = state && state.shape.id === puzzle.id ? state.filled : loadProgress(shape);
      return { done: countFilled(filled), total: shape.regions.length };
    }
    // without the areas, the saved bits still say how much is done
    const raw = store.get(progressKey(puzzle.id));
    if (!raw) return { done: 0, total: 0 };
    try {
      const bytes = fromBase64(raw);
      let done = 0;
      for (const byte of bytes) {
        for (let bit = 0; bit < 8; bit++) if (byte & (1 << bit)) done++;
      }
      return { done, total: 0, partial: true };
    } catch (e) {
      return { done: 0, total: 0 };
    }
  }

  let galleryQueue = 0;

  function renderGallery() {
    cardsEl.textContent = '';
    const puzzles = allPuzzles();

    for (const puzzle of puzzles) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'card';
      card.dataset.picture = puzzle.id;
      card.appendChild(thumbnail(puzzle));

      const name = document.createElement('div');
      name.className = 'card-name';
      name.textContent = puzzle.name;
      card.appendChild(name);

      const meta = document.createElement('div');
      meta.className = 'card-meta';
      const { done, total } = progressOf(puzzle);
      if (!done) {
        meta.textContent = puzzle.blurb;
      } else if (total && done === total) {
        meta.innerHTML = '<span class="card-done">✓ Finished</span>';
      } else {
        const percent = total ? Math.round(done / total * 100) : 0;
        const bar = document.createElement('div');
        bar.className = 'card-bar';
        const fill = document.createElement('span');
        fill.style.width = percent + '%';
        bar.appendChild(fill);
        meta.appendChild(bar);
        const written = document.createElement('span');
        written.textContent = total ? percent + '%' : 'Started';
        meta.appendChild(written);
      }
      card.appendChild(meta);
      card.addEventListener('click', () => openPuzzle(puzzle.id));
      cardsEl.appendChild(card);

      if (puzzle.custom) {
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'card-del';
        del.setAttribute('aria-label', 'Delete ' + puzzle.name);
        del.textContent = '×';
        del.addEventListener('click', (event) => {
          event.stopPropagation();
          if (!confirm('Delete ' + puzzle.name + '?')) return;
          custom = custom.filter(p => p.id !== puzzle.id);
          prepared.delete(puzzle.id);
          store.remove(progressKey(puzzle.id));
          saveCustom();
          renderGallery();
        });
        card.appendChild(del);
      }
    }

    /* Cut the areas for one picture at a time in the background, refreshing
       each card as its picture becomes exact. Doing the lot up front would
       hold the gallery up for a second on a phone. */
    const pending = puzzles.filter(p => !prepared.has(p.id));
    const run = ++galleryQueue;
    const step = (index) => {
      if (run !== galleryQueue || index >= pending.length) return;
      setTimeout(() => {
        if (run !== galleryQueue) return;
        const puzzle = pending[index];
        prepare(puzzle);
        const card = cardsEl.querySelector('[data-picture="' + puzzle.id + '"]');
        if (card) {
          const canvasEl = card.querySelector('canvas');
          if (canvasEl) card.replaceChild(thumbnail(puzzle), canvasEl);
          const meta = card.querySelector('.card-meta');
          const { done, total } = progressOf(puzzle);
          if (meta && done && total) {
            const percent = Math.round(done / total * 100);
            if (done === total) meta.innerHTML = '<span class="card-done">✓ Finished</span>';
            else {
              meta.innerHTML = '<div class="card-bar"><span style="width:' + percent + '%"></span></div>' +
                '<span>' + percent + '%</span>';
            }
          }
        }
        step(index + 1);
      }, 16);
    };
    step(0);
  }

  function openGallery() {
    state = null;
    paintView.hidden = true;
    gallery.hidden = false;
    backBtn.hidden = true;
    titleEl.textContent = 'Pigment';
    subtitleEl.textContent = 'Colour by number';
    renderGallery();
  }

  // --------------------------------------------------------------- state

  let state = null;

  function openPuzzle(id) {
    const puzzle = puzzleById(id);
    if (!puzzle) return;

    const shape = prepare(puzzle);
    const filled = loadProgress(shape);
    const left = new Uint32Array(shape.palette.length + 1);
    for (const region of shape.regions) if (!filled[region.id]) left[region.colour]++;

    state = {
      shape,
      filled,
      left,                          // areas still to fill, per colour
      active: 0,
      done: countFilled(filled),
      total: shape.regions.length,
      view: { scale: 1, x: 0, y: 0 },
      cache: document.createElement('canvas'),
      cacheScale: 0,
      cacheTimer: 0,
      hint: null,
      finished: false,
      saveTimer: 0,
    };
    state.finished = state.done === state.total;

    gallery.hidden = true;
    paintView.hidden = false;
    doneEl.hidden = !state.finished;
    backBtn.hidden = false;
    titleEl.textContent = puzzle.name;
    canvas.setAttribute('aria-label',
      puzzle.name + ': ' + state.total + ' outlined areas in ' + shape.palette.length + ' colours');

    resizeCanvas();
    fitView();
    chooseColour(nextUnfinished(0) || 1, true);
    updateProgress();
    renderPalette();
    renderCache();
    requestDraw();
  }

  function nextUnfinished(from) {
    const n = state.shape.palette.length;
    for (let step = 1; step <= n; step++) {
      const candidate = ((from - 1 + step) % n) + 1;
      if (state.left[candidate] > 0) return candidate;
    }
    return 0;
  }

  function chooseColour(colour, quiet) {
    state.active = colour;
    const swatch = state.shape.palette[colour - 1];
    subtitleEl.textContent = swatch
      ? swatch.name + ' — ' + state.left[colour] + (state.left[colour] === 1 ? ' area left' : ' areas left')
      : 'Finished';
    renderPalette();
    if (!quiet) { renderCache(); requestDraw(); }
  }

  function renderPalette() {
    paletteEl.textContent = '';
    state.shape.palette.forEach((swatch, index) => {
      const colour = index + 1;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'swatch';
      button.setAttribute('role', 'radio');
      button.setAttribute('aria-checked', String(colour === state.active));
      button.setAttribute('aria-label', swatch.name + ', number ' + colour);
      button.dataset.colour = String(colour);
      button.dataset.done = String(state.left[colour] === 0);

      const chip = document.createElement('div');
      chip.className = 'swatch-chip';
      chip.style.background = swatch.hex;
      button.appendChild(chip);

      const num = document.createElement('div');
      num.className = 'swatch-num';
      num.textContent = String(colour);
      button.appendChild(num);

      const left = document.createElement('div');
      left.className = 'swatch-left';
      left.textContent = String(state.left[colour]);
      button.appendChild(left);

      button.addEventListener('click', () => chooseColour(colour));
      paletteEl.appendChild(button);
    });

    const chosen = paletteEl.querySelector('[aria-checked="true"]');
    if (chosen && chosen.scrollIntoView) chosen.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  function updateProgress() {
    progressFill.style.width = (state.total ? state.done / state.total * 100 : 0) + '%';
  }

  function scheduleSave() {
    clearTimeout(state.saveTimer);
    const current = state;
    state.saveTimer = setTimeout(() => {
      store.set(progressKey(current.shape.id), toBase64(packBits(current.filled)));
    }, 350);
  }

  // ---------------------------------------------------------- the canvas

  /* The picture is drawn once into an off-screen canvas and then simply
     copied onto the visible one, so dragging a finger across it doesn't mean
     re-drawing a thousand outlines sixty times a second. Filling an area
     repaints that area alone; only a real change of zoom rebuilds the lot. */

  const colourOf = (region) => {
    if (state.filled[region.id]) return state.shape.palette[region.colour - 1].hex;
    if (region.colour === state.active && !state.finished) {
      return waitingTint(state.shape.palette[region.colour - 1].hex);
    }
    return PAPER;
  };

  function cacheScaleFor(scale) {
    const dpr = Math.min(self.devicePixelRatio || 1, 3);
    const { cols, rows } = state.shape;
    const most = Math.sqrt(11e6 / Math.max(1, cols * rows));   // keep it under ~11 megapixels
    return Math.max(2, Math.min(most, scale * dpr));
  }

  function paintRegion(c, region, withNumber) {
    const s = state.cacheScale;
    c.fillStyle = colourOf(region);
    c.fill(region.path, 'evenodd');
    // a hairline of the same colour seals the join with its neighbours
    c.strokeStyle = c.fillStyle;
    c.lineWidth = 0.7 / s;
    c.stroke(region.path);

    c.strokeStyle = OUTLINE;
    c.lineWidth = Math.max(0.05, 1.1 / s);
    c.lineJoin = 'round';
    c.stroke(region.path);

    if (!withNumber || state.filled[region.id] || state.finished) return;
    const size = Math.min(region.label.room * 1.15, 34 / s);
    if (size * s < 7) return;                                  // too small to read
    c.fillStyle = region.colour === state.active ? mix(OUTLINE, '#000000', 0.25) : NUMBER_INK;
    c.font = '600 ' + size.toFixed(2) + 'px ui-rounded, "SF Pro Rounded", system-ui, sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(String(region.colour), region.label.x, region.label.y);
  }

  function renderCache() {
    if (!state) return;
    const { cols, rows } = state.shape;
    const s = cacheScaleFor(state.view.scale);
    state.cacheScale = s;
    state.cache.width = Math.max(1, Math.ceil(cols * s));
    state.cache.height = Math.max(1, Math.ceil(rows * s));

    const c = state.cache.getContext('2d');
    c.setTransform(s, 0, 0, s, 0, 0);
    c.fillStyle = PAPER;
    c.fillRect(0, 0, cols, rows);
    for (const region of state.shape.regions) paintRegion(c, region, true);
  }

  function scheduleCache() {
    if (!state) return;
    clearTimeout(state.cacheTimer);
    const current = state;
    current.cacheTimer = setTimeout(() => {
      if (state !== current) return;
      const wanted = cacheScaleFor(current.view.scale);
      if (Math.abs(wanted - current.cacheScale) / current.cacheScale > 0.15) {
        renderCache();
        requestDraw();
      }
    }, 160);
  }

  let drawQueued = false;

  function requestDraw() {
    if (drawQueued) return;
    drawQueued = true;
    requestAnimationFrame(() => { drawQueued = false; draw(); });
  }

  const canvasRect = () => canvas.getBoundingClientRect();

  function resizeCanvas() {
    const rect = canvasRect();
    const dpr = Math.min(self.devicePixelRatio || 1, 3);
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (state) state.viewport = { width: rect.width, height: rect.height };
  }

  const viewport = () => (state && state.viewport) || { width: board.clientWidth, height: board.clientHeight };

  function fitScale() {
    const { width, height } = viewport();
    const { cols, rows } = state.shape;
    return Math.min(width / cols, height / rows);
  }

  function fitView() {
    const scale = fitScale();
    const { width, height } = viewport();
    state.view.scale = scale;
    state.view.x = (width - state.shape.cols * scale) / 2;
    state.view.y = (height - state.shape.rows * scale) / 2;
  }

  function clampView() {
    const { width, height } = viewport();
    const view = state.view;
    const pictureWidth = state.shape.cols * view.scale;
    const pictureHeight = state.shape.rows * view.scale;
    view.x = pictureWidth <= width
      ? (width - pictureWidth) / 2
      : Math.min(0, Math.max(width - pictureWidth, view.x));
    view.y = pictureHeight <= height
      ? (height - pictureHeight) / 2
      : Math.min(0, Math.max(height - pictureHeight, view.y));
  }

  function zoomTo(scale, originX, originY) {
    const view = state.view;
    const next = Math.max(fitScale() * 0.95, Math.min(80, scale));
    const cellX = (originX - view.x) / view.scale;
    const cellY = (originY - view.y) / view.scale;
    view.scale = next;
    view.x = originX - cellX * next;
    view.y = originY - cellY * next;
    clampView();
    scheduleCache();
    requestDraw();
  }

  function draw() {
    if (!state) return;
    const { view, shape } = state;
    const { width, height } = viewport();

    ctx.fillStyle = MAT;
    ctx.fillRect(0, 0, width, height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(state.cache, view.x, view.y, shape.cols * view.scale, shape.rows * view.scale);

    if (state.hint) {
      const now = performance.now();
      if (now < state.hint.until) {
        const region = shape.regions[state.hint.id];
        const phase = ((1 - (state.hint.until - now) / 1800) * 3) % 1;
        ctx.save();
        ctx.translate(view.x, view.y);
        ctx.scale(view.scale, view.scale);
        ctx.strokeStyle = '#12172b';
        ctx.globalAlpha = Math.max(0, 1 - phase) * 0.9;
        ctx.lineWidth = (2 + phase * 8) / view.scale;
        ctx.lineJoin = 'round';
        ctx.stroke(region.path);
        ctx.restore();
        requestAnimationFrame(draw);
      } else {
        state.hint = null;
      }
    }
  }

  // ------------------------------------------------------------ painting

  function regionAt(clientX, clientY) {
    const rect = canvasRect();
    const view = state.view;
    const x = Math.floor((clientX - rect.left - view.x) / view.scale);
    const y = Math.floor((clientY - rect.top - view.y) / view.scale);
    if (x < 0 || y < 0 || x >= state.shape.cols || y >= state.shape.rows) return -1;
    const id = state.shape.labels[y * state.shape.cols + x];
    return id === undefined ? -1 : id;
  }

  function fillRegion(id, fromTap) {
    if (id < 0 || state.finished) return false;
    const region = state.shape.regions[id];
    if (!region || state.filled[id]) return false;

    if (region.colour !== state.active) {
      // Only a deliberate tap gets told off; dragging is meant to skim over
      // everything that isn't the colour in hand.
      if (fromTap) {
        toast('That area is number ' + region.colour, 1200);
        state.hint = { id, until: performance.now() + 700 };
        requestDraw();
      }
      return false;
    }

    state.filled[id] = 1;
    state.left[region.colour]--;
    state.done++;
    sound.blip();

    const c = state.cache.getContext('2d');
    c.setTransform(state.cacheScale, 0, 0, state.cacheScale, 0, 0);
    paintRegion(c, region, false);
    // its neighbours share the outline that was just painted over
    for (const other of neighboursOf(region)) paintRegion(c, other, true);

    if (state.left[region.colour] === 0) finishColour(region.colour);
    else {
      const swatch = state.shape.palette[region.colour - 1];
      const left = state.left[region.colour];
      subtitleEl.textContent = swatch.name + ' — ' + left + (left === 1 ? ' area left' : ' areas left');
      const chip = paletteEl.querySelector('[data-colour="' + region.colour + '"] .swatch-left');
      if (chip) chip.textContent = String(left);
    }

    updateProgress();
    scheduleSave();
    if (state.done === state.total) finishPicture();
    return true;
  }

  /* Which areas touch this one. Worked out once per area, the first time it
     is filled in, by walking its outline and looking at what is on the other
     side of the line. */
  function neighboursOf(region) {
    if (region.neighbours) return region.neighbours.map(id => state.shape.regions[id]);
    const { cols, rows, labels } = state.shape;
    const found = new Set();
    for (let y = region.bbox.y0; y <= region.bbox.y1; y++) {
      for (let x = region.bbox.x0; x <= region.bbox.x1; x++) {
        if (labels[y * cols + x] !== region.id) continue;
        if (x > 0) found.add(labels[y * cols + x - 1]);
        if (x < cols - 1) found.add(labels[y * cols + x + 1]);
        if (y > 0) found.add(labels[(y - 1) * cols + x]);
        if (y < rows - 1) found.add(labels[(y + 1) * cols + x]);
      }
    }
    found.delete(region.id);
    found.delete(-1);
    region.neighbours = [...found];
    return region.neighbours.map(id => state.shape.regions[id]);
  }

  function finishColour(colour) {
    const name = state.shape.palette[colour - 1].name;
    const next = nextUnfinished(colour);
    if (!next) return;                 // the picture itself is done
    sound.chime();
    const remaining = state.left.reduce((count, left) => count + (left > 0 ? 1 : 0), 0);
    toast(name + ' done — ' + remaining + (remaining === 1 ? ' colour left' : ' colours left'));
    chooseColour(next);
  }

  function finishPicture() {
    state.finished = true;
    sound.fanfare();
    doneText.textContent = state.shape.name + ' — all ' + state.total + ' areas filled in.';
    doneEl.hidden = false;
    subtitleEl.textContent = 'Finished';
    store.set(progressKey(state.shape.id), toBase64(packBits(state.filled)));
    renderCache();
    requestDraw();
  }

  // Fill everything the drag passed over, not only where a pointer event
  // happened to land — a fast swipe reports very few positions.
  function paintAlong(fromX, fromY, toX, toY) {
    const step = Math.max(2, state.view.scale * 0.7);
    const distance = Math.hypot(toX - fromX, toY - fromY);
    const steps = Math.max(1, Math.ceil(distance / step));
    let painted = false;
    for (let s = 0; s <= steps; s++) {
      const f = s / steps;
      painted = fillRegion(regionAt(fromX + (toX - fromX) * f, fromY + (toY - fromY) * f), false) || painted;
    }
    return painted;
  }

  const pointers = new Map();
  let gesture = null;
  let stroke = null;
  let lastTap = 0;
  // Two quick taps only mean "zoom" if they land in the same place; tapping
  // your way along a row of areas is not a double tap.
  let lastTapAt = null;

  /* These live on the canvas rather than the board around it: the finished
     panel sits inside the board, and a stroke that captured the pointer
     there would swallow the taps meant for its buttons. */
  canvas.addEventListener('pointerdown', (event) => {
    if (!state) return;
    canvas.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointers.size === 1) {
      stroke = {
        x: event.clientX, y: event.clientY,
        startX: event.clientX, startY: event.clientY,
        at: performance.now(), moved: false,
      };
    } else {
      stroke = null;                    // a second finger means zoom, not paint
      const [a, b] = [...pointers.values()];
      gesture = {
        distance: Math.hypot(a.x - b.x, a.y - b.y),
        scale: state.view.scale,
        midX: (a.x + b.x) / 2, midY: (a.y + b.y) / 2,
        viewX: state.view.x, viewY: state.view.y,
      };
    }
  });

  canvas.addEventListener('pointermove', (event) => {
    if (!state || !pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointers.size >= 2 && gesture) {
      const [a, b] = [...pointers.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      const midX = (a.x + b.x) / 2, midY = (a.y + b.y) / 2;
      const rect = canvasRect();
      const view = state.view;
      const scale = Math.max(fitScale() * 0.95, Math.min(80, gesture.scale * (distance / Math.max(1, gesture.distance))));

      // Zoom about the point between the fingers, and let that point drag the
      // picture with it, so pinch and pan are the same gesture.
      const cellX = (gesture.midX - rect.left - gesture.viewX) / gesture.scale;
      const cellY = (gesture.midY - rect.top - gesture.viewY) / gesture.scale;
      view.scale = scale;
      view.x = (midX - rect.left) - cellX * scale;
      view.y = (midY - rect.top) - cellY * scale;
      clampView();
      scheduleCache();
      requestDraw();
      return;
    }

    if (!stroke) return;
    if (Math.hypot(event.clientX - stroke.startX, event.clientY - stroke.startY) > 6) stroke.moved = true;
    if (stroke.moved && paintAlong(stroke.x, stroke.y, event.clientX, event.clientY)) requestDraw();
    stroke.x = event.clientX;
    stroke.y = event.clientY;
  });

  function endPointer(event) {
    if (!state) return;
    pointers.delete(event.pointerId);
    if (pointers.size < 2) gesture = null;

    if (stroke && pointers.size === 0) {
      const quick = performance.now() - stroke.at < 300;
      if (!stroke.moved && quick) {
        const now = performance.now();
        const nearLastTap = lastTapAt &&
          Math.hypot(event.clientX - lastTapAt.x, event.clientY - lastTapAt.y) < 28;
        if (now - lastTap < 320 && nearLastTap) {
          const rect = canvasRect();
          const target = state.view.scale > fitScale() * 1.6 ? fitScale() : fitScale() * 3;
          zoomTo(target, event.clientX - rect.left, event.clientY - rect.top);
          lastTap = 0;
          lastTapAt = null;
        } else {
          lastTap = now;
          lastTapAt = { x: event.clientX, y: event.clientY };
          if (fillRegion(regionAt(event.clientX, event.clientY), true)) requestDraw();
        }
      }
      stroke = null;
    }
  }

  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);

  canvas.addEventListener('wheel', (event) => {
    if (!state) return;
    event.preventDefault();
    const rect = canvasRect();
    zoomTo(state.view.scale * Math.exp(-event.deltaY * 0.0016),
      event.clientX - rect.left, event.clientY - rect.top);
  }, { passive: false });

  // --------------------------------------------------------------- tools

  $('hintBtn').addEventListener('click', () => {
    if (!state || state.finished) return;
    if (!state.left[state.active]) {
      const next = nextUnfinished(state.active);
      if (next) chooseColour(next);
    }

    const { view, shape } = state;
    const { width, height } = viewport();
    const centreX = (width / 2 - view.x) / view.scale;
    const centreY = (height / 2 - view.y) / view.scale;

    let best = null, bestDistance = Infinity;
    for (const region of shape.regions) {
      if (region.colour !== state.active || state.filled[region.id]) continue;
      const dx = region.label.x - centreX, dy = region.label.y - centreY;
      const distance = dx * dx + dy * dy;
      if (distance < bestDistance) { bestDistance = distance; best = region; }
    }
    if (!best) return;

    // bring it into view if the hint is off the screen
    const x = best.label.x * view.scale + view.x;
    const y = best.label.y * view.scale + view.y;
    if (x < 0 || y < 0 || x > width || y > height) {
      view.x = width / 2 - best.label.x * view.scale;
      view.y = height / 2 - best.label.y * view.scale;
      clampView();
    }

    state.hint = { id: best.id, until: performance.now() + 1800 };
    requestDraw();
  });

  $('fitBtn').addEventListener('click', () => {
    if (!state) return;
    fitView();
    scheduleCache();
    requestDraw();
  });

  $('resetBtn').addEventListener('click', () => {
    if (!state) return;
    if (!confirm('Start ' + state.shape.name + ' again from blank?')) return;
    store.remove(progressKey(state.shape.id));
    openPuzzle(state.shape.id);
    toast('Blank again');
  });

  backBtn.addEventListener('click', openGallery);
  $('doneBackBtn').addEventListener('click', openGallery);

  soundBtn.addEventListener('click', () => {
    sound.on = !sound.on;
    store.set(KEY_SOUND, sound.on ? '1' : '0');
    soundBtn.setAttribute('aria-pressed', String(sound.on));
    soundBtn.setAttribute('aria-label', sound.on ? 'Sound on' : 'Sound off');
    if (sound.on) sound.blip();
  });

  soundBtn.setAttribute('aria-pressed', String(sound.on));

  // ------------------------------------------------------------- saving

  function download(blob, name, message) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    if ('download' in link) {
      link.href = url;
      link.download = name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      toast(message || ('Saved as ' + name), 2600);
    } else {
      self.open(url, '_blank');
      toast('Press and hold to save it', 2600);
    }
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  /* The same outlines the screen is drawing, written out as vector paths.
     An SVG can be blown up to any size without going soft, which is what
     makes it worth having next to the picture itself. */
  function toSVG(options) {
    const o = Object.assign({ coloured: false, numbers: true }, options || {});
    const { cols, rows, palette, regions } = state.shape;
    const stroke = 0.08;
    const out = ['<?xml version="1.0" encoding="UTF-8"?>',
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + cols + ' ' + rows + '" ' +
      'width="' + cols * 12 + '" height="' + rows * 12 + '">',
      '<title>' + state.shape.name.replace(/[<&>]/g, '') + '</title>',
      '<rect width="' + cols + '" height="' + rows + '" fill="#ffffff"/>'];

    for (const region of regions) {
      const d = REGIONS.ringsToPath(region.rings);
      const fill = o.coloured || state.filled[region.id] ? palette[region.colour - 1].hex : '#ffffff';
      out.push('<path d="' + d + '" fill="' + fill + '" fill-rule="evenodd" stroke="' + fill +
        '" stroke-width="' + stroke + '"/>');
    }
    if (!o.coloured) {
      for (const region of regions) {
        out.push('<path d="' + REGIONS.ringsToPath(region.rings) + '" fill="none" fill-rule="evenodd" ' +
          'stroke="' + OUTLINE + '" stroke-width="' + stroke + '" stroke-linejoin="round"/>');
      }
    }
    if (o.numbers) {
      out.push('<g font-family="system-ui, sans-serif" fill="' + NUMBER_INK + '" text-anchor="middle">');
      for (const region of regions) {
        if (o.coloured || state.filled[region.id]) continue;
        const size = Math.min(region.label.room * 1.15, 3.4);
        if (size < 0.9) continue;
        out.push('<text x="' + region.label.x.toFixed(2) + '" y="' + region.label.y.toFixed(2) +
          '" font-size="' + size.toFixed(2) + '" dominant-baseline="central">' + region.colour + '</text>');
      }
      out.push('</g>');
    }
    out.push('</svg>');
    return out.join('\n');
  }

  $('saveBtn').addEventListener('click', () => {
    if (!state) return;
    const { cols, rows, palette, regions } = state.shape;
    const scale = Math.max(6, Math.round(1800 / Math.max(cols, rows)));
    const out = document.createElement('canvas');
    out.width = cols * scale;
    out.height = rows * scale;
    const c = out.getContext('2d');
    c.setTransform(scale, 0, 0, scale, 0, 0);
    c.fillStyle = PAPER;
    c.fillRect(0, 0, cols, rows);
    for (const region of regions) {
      c.fillStyle = state.filled[region.id] ? palette[region.colour - 1].hex : PAPER;
      c.fill(region.path, 'evenodd');
      c.strokeStyle = c.fillStyle;
      c.lineWidth = 0.7 / scale;
      c.stroke(region.path);
    }
    out.toBlob((blob) => {
      if (blob) download(blob, 'pigment-' + state.shape.id + '.png');
    }, 'image/png');
  });

  $('svgBtn').addEventListener('click', () => {
    if (!state) return;
    const coloured = state.finished;
    download(new Blob([toSVG({ coloured })], { type: 'image/svg+xml' }),
      'pigment-' + state.shape.id + (coloured ? '' : '-outlines') + '.svg');
  });

  /* Printing hands the numbered outlines to a printer — or to whatever the
     browser's print dialogue offers instead, which is where "save as PDF"
     lives on every platform that has it. */
  $('printBtn').addEventListener('click', () => {
    if (!state) return;
    const sheet = self.open('', '_blank');
    if (!sheet) { toast('Allow pop-ups to print this picture', 2600); return; }
    sheet.document.write('<!DOCTYPE html><html><head><meta charset="utf-8">' +
      '<title>' + state.shape.name + ' — colour by number</title>' +
      '<style>@page{margin:12mm}body{margin:0;font-family:system-ui,sans-serif}' +
      'h1{font-size:16pt;margin:0 0 2mm}p{font-size:9pt;color:#555;margin:0 0 4mm}' +
      'svg{width:100%;height:auto}ul{list-style:none;padding:0;display:flex;flex-wrap:wrap;gap:3mm;font-size:8pt}' +
      'li{display:flex;align-items:center;gap:1.5mm}i{width:4mm;height:4mm;border:0.3mm solid #888;display:block}' +
      '</style></head><body>' +
      '<h1>' + state.shape.name + '</h1><p>Colour by number</p>' + toSVG({ coloured: false }) +
      '<ul>' + state.shape.palette.map((swatch, i) =>
        '<li><i style="background:' + swatch.hex + '"></i>' + (i + 1) + ' ' + swatch.name + '</li>').join('') +
      '</ul></body></html>');
    sheet.document.close();
    sheet.focus();
    setTimeout(() => sheet.print(), 300);
  });

  // ------------------------------------------------- a photo into a picture

  const NAMED = [
    ['Red', '#e03131'], ['Orange', '#f76707'], ['Amber', '#f2a33c'], ['Yellow', '#f6e05e'],
    ['Lime', '#94d82d'], ['Green', '#2f9e44'], ['Teal', '#0ca678'], ['Cyan', '#22b8cf'],
    ['Blue', '#1c7ed6'], ['Indigo', '#4c6ef5'], ['Violet', '#7950f2'], ['Purple', '#ae3ec9'],
    ['Pink', '#e64980'], ['Brown', '#8a5a2b'], ['Sand', '#d9c8a9'], ['Black', '#1a1a1a'],
    ['Grey', '#868e96'], ['White', '#f8f9fa'],
  ];

  function colourName(hex) {
    const [r, g, b] = hexToRgb(hex);
    let best = 'Grey', bestDistance = Infinity;
    for (const [name, sample] of NAMED) {
      const [sr, sg, sb] = hexToRgb(sample);
      const distance = (r - sr) ** 2 * 0.9 + (g - sg) ** 2 + (b - sb) ** 2 * 0.7;
      if (distance < bestDistance) { bestDistance = distance; best = name; }
    }
    const light = luminance(hex);
    if (best !== 'Black' && best !== 'White' && light < 0.22) return 'Dark ' + best.toLowerCase();
    if (best !== 'White' && best !== 'Black' && light > 0.82) return 'Pale ' + best.toLowerCase();
    return best;
  }

  /* k-means over the squares themselves. The picture is already small by the
     time this runs, so a handful of passes settles in a few milliseconds. */
  function quantise(pixels, count, k) {
    let seed = 0x9e3779b9;
    const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

    // k-means++: spread the starting colours out instead of picking at random,
    // which is what stops a photo of grass coming back as eight greens.
    const centres = [];
    const first = Math.floor(random() * count) * 3;
    centres.push([pixels[first], pixels[first + 1], pixels[first + 2]]);
    const nearest = new Float64Array(count).fill(Infinity);
    while (centres.length < k) {
      const centre = centres[centres.length - 1];
      let total = 0;
      for (let i = 0; i < count; i++) {
        const dr = pixels[i * 3] - centre[0], dg = pixels[i * 3 + 1] - centre[1], db = pixels[i * 3 + 2] - centre[2];
        const distance = dr * dr + dg * dg + db * db;
        if (distance < nearest[i]) nearest[i] = distance;
        total += nearest[i];
      }
      if (total <= 0) break;
      let target = random() * total, pick = count - 1;
      for (let i = 0; i < count; i++) {
        target -= nearest[i];
        if (target <= 0) { pick = i; break; }
      }
      centres.push([pixels[pick * 3], pixels[pick * 3 + 1], pixels[pick * 3 + 2]]);
    }

    const assignment = new Uint8Array(count);
    for (let pass = 0; pass < 14; pass++) {
      let moved = false;
      for (let i = 0; i < count; i++) {
        let best = 0, bestDistance = Infinity;
        for (let c = 0; c < centres.length; c++) {
          const dr = pixels[i * 3] - centres[c][0];
          const dg = pixels[i * 3 + 1] - centres[c][1];
          const db = pixels[i * 3 + 2] - centres[c][2];
          const distance = dr * dr + dg * dg + db * db;
          if (distance < bestDistance) { bestDistance = distance; best = c; }
        }
        if (assignment[i] !== best) { assignment[i] = best; moved = true; }
      }
      if (!moved && pass > 0) break;

      const sums = centres.map(() => [0, 0, 0, 0]);
      for (let i = 0; i < count; i++) {
        const s = sums[assignment[i]];
        s[0] += pixels[i * 3]; s[1] += pixels[i * 3 + 1]; s[2] += pixels[i * 3 + 2]; s[3]++;
      }
      sums.forEach((s, c) => {
        if (s[3]) centres[c] = [s[0] / s[3], s[1] / s[3], s[2] / s[3]];
      });
    }

    return { centres, assignment };
  }

  /* The number of colours asked for is a ceiling, not a quota. A photo of a
     red door and a blue sky should not come back as four reds and four blues,
     and nobody wants a swatch worth three squares, so colours that sit almost
     on top of each other — or that barely appear — are folded together. */
  function merge(centres, assignment, count) {
    const alive = centres.map(() => true);
    const tally = () => {
      const counts = new Array(centres.length).fill(0);
      for (let i = 0; i < count; i++) counts[assignment[i]]++;
      return counts;
    };

    const distance = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

    const absorb = (from, into) => {
      const counts = tally();
      const weightFrom = counts[from], weightInto = counts[into];
      const total = weightFrom + weightInto || 1;
      centres[into] = [0, 1, 2].map(k => (centres[into][k] * weightInto + centres[from][k] * weightFrom) / total);
      alive[from] = false;
      for (let i = 0; i < count; i++) if (assignment[i] === from) assignment[i] = into;
    };

    const nearestAlive = (index) => {
      let best = -1, bestDistance = Infinity;
      for (let c = 0; c < centres.length; c++) {
        if (c === index || !alive[c]) continue;
        const d = distance(centres[index], centres[c]);
        if (d < bestDistance) { bestDistance = d; best = c; }
      }
      return { best, bestDistance };
    };

    // a colour has to be worth a number of its own, but the eyes in a
    // portrait are a very small part of it, so the bar is set low
    const floor = Math.max(3, Math.round(count * 0.0015));
    let counts = tally();
    for (let c = 0; c < centres.length; c++) {
      if (!alive[c] || counts[c] >= floor) continue;
      const { best } = nearestAlive(c);
      if (best >= 0) { absorb(c, best); counts = tally(); }
    }

    /* Roughly the point at which two flat colours stop being tellable apart
       on a swatch. Set any higher and the shading that makes a photograph
       worth colouring in — a face's light and shade, a sky's depth — is
       flattened into one number. */
    const TOO_CLOSE = 16 * 16;
    for (;;) {
      if (alive.filter(Boolean).length <= 2) break;
      let pair = null, pairDistance = Infinity;
      for (let a = 0; a < centres.length; a++) {
        if (!alive[a]) continue;
        for (let b = a + 1; b < centres.length; b++) {
          if (!alive[b]) continue;
          const d = distance(centres[a], centres[b]);
          if (d < pairDistance) { pairDistance = d; pair = [a, b]; }
        }
      }
      if (!pair || pairDistance > TOO_CLOSE) break;
      absorb(pair[1], pair[0]);
    }

    return { centres, assignment };
  }

  // Single stray squares add nothing but noise to the outlines, so a square
  // outvoted by all four of its neighbours joins them.
  function despeckle(cells, cols, rows) {
    const out = cells.slice();
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const i = y * cols + x;
        const neighbours = [];
        if (x > 0) neighbours.push(cells[i - 1]);
        if (x < cols - 1) neighbours.push(cells[i + 1]);
        if (y > 0) neighbours.push(cells[i - cols]);
        if (y < rows - 1) neighbours.push(cells[i + cols]);
        if (neighbours.length < 3) continue;
        if (neighbours.some(n => n === cells[i])) continue;
        const tally = new Map();
        for (const n of neighbours) tally.set(n, (tally.get(n) || 0) + 1);
        let best = cells[i], bestCount = 1;
        for (const [value, times] of tally) if (times > bestCount) { best = value; bestCount = times; }
        if (bestCount >= 3) out[i] = best;
      }
    }
    return out;
  }

  async function photoToPuzzle(file, colours, longest) {
    const source = await loadImage(file);
    const ratio = source.width / source.height;
    let cols = longest, rows = longest;
    if (ratio > 1) rows = Math.max(40, Math.round(longest / ratio));
    else cols = Math.max(40, Math.round(longest * ratio));

    /* Halve the photo repeatedly before the final draw. Going straight from a
       12-megapixel photo to 120 squares makes some browsers point-sample it,
       which turns a face into confetti; stepping down averages instead. */
    let width = source.width, height = source.height;
    let step = document.createElement('canvas');
    step.width = width;
    step.height = height;
    step.getContext('2d').drawImage(source, 0, 0, width, height);
    while (width > cols * 2 && height > rows * 2) {
      width = Math.max(cols, Math.round(width / 2));
      height = Math.max(rows, Math.round(height / 2));
      const next = document.createElement('canvas');
      next.width = width;
      next.height = height;
      const nextCtx = next.getContext('2d');
      nextCtx.imageSmoothingEnabled = true;
      nextCtx.imageSmoothingQuality = 'high';
      nextCtx.drawImage(step, 0, 0, width, height);
      step = next;
    }

    const small = document.createElement('canvas');
    small.width = cols;
    small.height = rows;
    const smallCtx = small.getContext('2d');
    smallCtx.imageSmoothingEnabled = true;
    smallCtx.imageSmoothingQuality = 'high';
    smallCtx.drawImage(step, 0, 0, cols, rows);

    const data = smallCtx.getImageData(0, 0, cols, rows).data;
    const count = cols * rows;
    const pixels = new Float64Array(count * 3);
    for (let i = 0; i < count; i++) {
      pixels[i * 3] = data[i * 4];
      pixels[i * 3 + 1] = data[i * 4 + 1];
      pixels[i * 3 + 2] = data[i * 4 + 2];
    }

    const quantised = quantise(pixels, count, colours);
    const { centres, assignment } = merge(quantised.centres, quantised.assignment, count);
    const tidied = despeckle(assignment, cols, rows);

    // Number the colours by how much of the picture they cover, so number 1
    // is always the one there is most of.
    const used = new Map();
    for (let i = 0; i < count; i++) used.set(tidied[i], (used.get(tidied[i]) || 0) + 1);
    const order = [...used.entries()].sort((a, b) => b[1] - a[1]).map(entry => entry[0]);
    const lookup = new Map();
    const palette = order.map((centre, index) => {
      lookup.set(centre, index + 1);
      const [r, g, b] = centres[centre];
      const hex = toHex(r, g, b);
      return { hex, name: colourName(hex) };
    });

    const cells = new Uint8Array(count);
    for (let i = 0; i < count; i++) cells[i] = lookup.get(tidied[i]);

    const number = custom.reduce((highest, p) => Math.max(highest, p.number || 0), 0) + 1;
    return {
      id: 'photo-' + Date.now().toString(36),
      name: 'Photo ' + number,
      number,
      blurb: palette.length + ' colours',
      cols, rows, palette, cells,
      custom: true,
    };
  }

  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => { resolve(image); setTimeout(() => URL.revokeObjectURL(url), 1000); };
      image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file could not be opened as a picture')); };
      image.src = url;
    });
  }

  $('photo').addEventListener('change', async (event) => {
    const file = event.target.files && event.target.files[0];
    event.target.value = '';
    if (!file) return;

    makeStatus.textContent = 'Working out the colours…';
    try {
      const colours = Number($('photoColours').value);
      const longest = Number($('photoSize').value);
      const puzzle = await photoToPuzzle(file, colours, longest);
      makeStatus.textContent = 'Drawing the outlines…';
      await new Promise(resolve => setTimeout(resolve, 16));
      const shape = prepare(puzzle);
      puzzle.blurb = shape.regions.length + ' areas, ' + shape.palette.length + ' colours';

      custom.unshift(puzzle);
      if (custom.length > MAX_CUSTOM) {
        const dropped = custom.pop();
        prepared.delete(dropped.id);
        store.remove(progressKey(dropped.id));
      }
      if (!saveCustom()) {
        custom.shift();
        prepared.delete(puzzle.id);
        makeStatus.textContent = 'There is no room left on this device to keep another picture.';
        return;
      }
      makeStatus.textContent = '';
      openPuzzle(puzzle.id);
    } catch (error) {
      makeStatus.textContent = error && error.message ? error.message : 'That photo could not be used.';
    }
  });

  // ---------------------------------------------------------------- start

  builtIn = PICTURES.list();
  custom = loadCustom();
  openGallery();

  const observer = new ResizeObserver(() => {
    if (!state) return;
    const before = { scale: state.view.scale, fit: fitScale() };
    resizeCanvas();
    // Hold the zoom relative to a fitted picture, so turning the phone keeps
    // you where you were rather than throwing you back out.
    state.view.scale = fitScale() * (before.fit ? before.scale / before.fit : 1);
    clampView();
    scheduleCache();
    requestDraw();
  });
  observer.observe(board);

  document.addEventListener('keydown', (event) => {
    if (!state) return;
    if (event.key === 'Escape') { openGallery(); return; }
    const number = Number(event.key);
    if (number >= 1 && number <= 9 && number <= state.shape.palette.length) chooseColour(number);
  });

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => { /* offline is best-effort */ });
    });
  }
})();
