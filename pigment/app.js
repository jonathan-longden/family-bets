/* Pigment — colour by number.

   No build step and no dependencies: the pictures are drawn by pictures.js
   into a grid of numbers, this file paints that grid onto a canvas and keeps
   track of which squares have been filled in. Everything — progress, the
   pictures made from photos, the sound — stays on the device. */
(() => {
  'use strict';

  const PICTURES = self.PigmentPictures;

  const CELL_EMPTY = '#eef0f4';      // a square still waiting for its colour
  const GRID = '#cfd5e4';            // shows through the gap between squares
  const MAT = '#232a44';             // the board around the picture
  const NUMBER_INK = '#8e97ad';
  const MAX_CUSTOM = 24;

  // ------------------------------------------------------------- storage

  const store = {
    get(key) { try { return localStorage.getItem(key); } catch (e) { return null; } },
    set(key, value) { try { localStorage.setItem(key, value); return true; } catch (e) { return false; } },
    remove(key) { try { localStorage.removeItem(key); } catch (e) { /* nothing to do */ } },
  };

  const KEY_CUSTOM = 'pigment.custom';
  const KEY_SOUND = 'pigment.sound';
  const progressKey = (id) => 'pigment.progress.' + id;

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

  // Progress is one bit per square, so a picture costs a couple of hundred
  // bytes however long it took to colour in.
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
      if (ctx.currentTime - this.lastBlip < 0.045) return;   // a fast drag would blur
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

  function loadCustom() {
    const raw = store.get(KEY_CUSTOM);
    if (!raw) return [];
    try {
      const list = JSON.parse(raw);
      return list.map(item => ({
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
      id: p.id, name: p.name, number: p.number, blurb: p.blurb, cols: p.cols, rows: p.rows,
      palette: p.palette, cells: toBase64(p.cells),
    }));
    return store.set(KEY_CUSTOM, JSON.stringify(packed));
  }

  const allPuzzles = () => custom.concat(builtIn);
  const puzzleById = (id) => allPuzzles().find(p => p.id === id);

  function loadProgress(puzzle) {
    const raw = store.get(progressKey(puzzle.id));
    const filled = new Uint8Array(puzzle.cells.length);
    if (raw) {
      try {
        const bits = unpackBits(fromBase64(raw), puzzle.cells.length);
        // A square that carries no number (the paper) is never "filled".
        for (let i = 0; i < filled.length; i++) filled[i] = puzzle.cells[i] && bits[i] ? 1 : 0;
      } catch (e) { /* a corrupt save just starts the picture again */ }
    }
    return filled;
  }

  function countFilled(puzzle, filled) {
    let done = 0, total = 0;
    for (let i = 0; i < puzzle.cells.length; i++) {
      if (!puzzle.cells[i]) continue;
      total++;
      if (filled[i]) done++;
    }
    return { done, total };
  }

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

  /* A thumbnail of a picture nobody has touched would be a blank grey
     rectangle, which is no way to choose one. Squares still to do are shown
     as a washed-out version of the colour they are waiting for: enough to
     recognise the picture, and it comes up to full strength as you fill it. */
  function thumbnail(puzzle, filled) {
    const scale = 4;
    const el = document.createElement('canvas');
    el.width = puzzle.cols * scale;
    el.height = puzzle.rows * scale;
    const c = el.getContext('2d');
    c.fillStyle = '#ffffff';
    c.fillRect(0, 0, el.width, el.height);
    for (let y = 0; y < puzzle.rows; y++) {
      for (let x = 0; x < puzzle.cols; x++) {
        const i = y * puzzle.cols + x;
        const n = puzzle.cells[i];
        if (!n) continue;
        const hex = puzzle.palette[n - 1].hex;
        c.fillStyle = filled[i] ? hex : mix(hex, '#ffffff', 0.76);
        c.fillRect(x * scale, y * scale, scale, scale);
      }
    }
    return el;
  }

  function renderGallery() {
    cardsEl.textContent = '';
    for (const puzzle of allPuzzles()) {
      const filled = loadProgress(puzzle);
      const { done, total } = countFilled(puzzle, filled);
      const percent = total ? Math.round(done / total * 100) : 0;

      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'card';
      card.appendChild(thumbnail(puzzle, filled));

      const name = document.createElement('div');
      name.className = 'card-name';
      name.textContent = puzzle.name;
      card.appendChild(name);

      const meta = document.createElement('div');
      meta.className = 'card-meta';
      if (done === 0) {
        meta.textContent = puzzle.blurb;
      } else if (done === total) {
        meta.innerHTML = '<span class="card-done">✓ Finished</span>';
      } else {
        const bar = document.createElement('div');
        bar.className = 'card-bar';
        const fill = document.createElement('span');
        fill.style.width = percent + '%';
        bar.appendChild(fill);
        meta.appendChild(bar);
        const label = document.createElement('span');
        label.textContent = percent + '%';
        meta.appendChild(label);
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
          store.remove(progressKey(puzzle.id));
          saveCustom();
          renderGallery();
        });
        card.appendChild(del);
      }
    }
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

    const filled = loadProgress(puzzle);
    const counts = new Uint32Array(puzzle.palette.length + 1);
    for (let i = 0; i < puzzle.cells.length; i++) {
      const n = puzzle.cells[i];
      if (n && !filled[i]) counts[n]++;
    }

    state = {
      puzzle,
      filled,
      left: counts,                       // squares still to fill, per colour
      active: 0,
      view: { scale: 1, x: 0, y: 0 },
      hint: null,
      wrong: null,
      finished: false,
      saveTimer: 0,
    };

    const { done, total } = countFilled(puzzle, filled);
    state.done = done;
    state.total = total;
    state.finished = done === total;

    gallery.hidden = true;
    paintView.hidden = false;
    doneEl.hidden = !state.finished;
    backBtn.hidden = false;
    titleEl.textContent = puzzle.name;
    canvas.setAttribute('aria-label',
      puzzle.name + ': ' + puzzle.cols + ' by ' + puzzle.rows + ' numbered squares in '
      + puzzle.palette.length + ' colours');

    resizeCanvas();
    fitView();
    chooseColour(nextUnfinished(0) || 1, true);
    updateProgress();
    renderPalette();
    requestDraw();
  }

  function nextUnfinished(from) {
    const n = state.puzzle.palette.length;
    for (let step = 1; step <= n; step++) {
      const candidate = ((from - 1 + step) % n) + 1;
      if (state.left[candidate] > 0) return candidate;
    }
    return 0;
  }

  function chooseColour(colour, quiet) {
    state.active = colour;
    const swatch = state.puzzle.palette[colour - 1];
    subtitleEl.textContent = swatch
      ? swatch.name + ' — ' + state.left[colour] + ' left'
      : 'Finished';
    renderPalette();
    if (!quiet) requestDraw();
  }

  function renderPalette() {
    paletteEl.textContent = '';
    state.puzzle.palette.forEach((swatch, index) => {
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

      button.addEventListener('click', () => {
        chooseColour(colour);
        requestDraw();
      });
      paletteEl.appendChild(button);
    });

    const chosen = paletteEl.querySelector('[aria-checked="true"]');
    if (chosen && chosen.scrollIntoView) {
      chosen.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }

  function updateProgress() {
    const percent = state.total ? state.done / state.total * 100 : 0;
    progressFill.style.width = percent + '%';
  }

  function scheduleSave() {
    clearTimeout(state.saveTimer);
    const current = state;
    state.saveTimer = setTimeout(() => {
      store.set(progressKey(current.puzzle.id), toBase64(packBits(current.filled)));
    }, 350);
  }

  // ---------------------------------------------------------- the canvas

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

  const viewport = () => state.viewport || { width: board.clientWidth, height: board.clientHeight };

  function fitScale() {
    const { width, height } = viewport();
    const { cols, rows } = state.puzzle;
    return Math.min(width / cols, height / rows);
  }

  function fitView() {
    const scale = fitScale();
    const { width, height } = viewport();
    state.view.scale = scale;
    state.view.x = (width - state.puzzle.cols * scale) / 2;
    state.view.y = (height - state.puzzle.rows * scale) / 2;
  }

  function clampView() {
    const { width, height } = viewport();
    const view = state.view;
    const pictureWidth = state.puzzle.cols * view.scale;
    const pictureHeight = state.puzzle.rows * view.scale;
    view.x = pictureWidth <= width
      ? (width - pictureWidth) / 2
      : Math.min(0, Math.max(width - pictureWidth, view.x));
    view.y = pictureHeight <= height
      ? (height - pictureHeight) / 2
      : Math.min(0, Math.max(height - pictureHeight, view.y));
  }

  function zoomTo(scale, originX, originY) {
    const view = state.view;
    const min = fitScale() * 0.95;
    const next = Math.max(min, Math.min(64, scale));
    const cellX = (originX - view.x) / view.scale;
    const cellY = (originY - view.y) / view.scale;
    view.scale = next;
    view.x = originX - cellX * next;
    view.y = originY - cellY * next;
    clampView();
    requestDraw();
  }

  function draw() {
    if (!state) return;
    const { puzzle, filled, view } = state;
    const { width, height } = viewport();
    const scale = view.scale;

    ctx.fillStyle = MAT;
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = GRID;
    ctx.fillRect(view.x, view.y, puzzle.cols * scale, puzzle.rows * scale);

    const firstX = Math.max(0, Math.floor(-view.x / scale));
    const lastX = Math.min(puzzle.cols - 1, Math.ceil((width - view.x) / scale));
    const firstY = Math.max(0, Math.floor(-view.y / scale));
    const lastY = Math.min(puzzle.rows - 1, Math.ceil((height - view.y) / scale));

    const showNumbers = scale >= 11 && !state.finished;
    const gap = state.finished || scale < 6 ? 0 : Math.min(1, scale * 0.05);
    /* Squares waiting for the colour in hand are tinted with it. A pale
       colour tints to something indistinguishable from a blank square,
       though, so anything without enough contrast of its own gets a neutral
       wash instead — the point is to show which squares are next, not to
       preview the shade. */
    const activeHex = state.active ? puzzle.palette[state.active - 1].hex : null;
    let activeTint = CELL_EMPTY;
    let activeInk = NUMBER_INK;
    if (activeHex) {
      activeTint = mix(CELL_EMPTY, activeHex, 0.34);
      if (Math.abs(luminance(activeTint) - luminance(CELL_EMPTY)) < 0.05) {
        activeTint = mix(CELL_EMPTY, '#8794b4', 0.32);
      }
      activeInk = mix(activeHex, '#101425', 0.55);
      if (luminance(activeInk) > 0.5) activeInk = '#3d4761';
    }

    if (showNumbers) {
      ctx.font = '600 ' + Math.min(scale * 0.58, 22).toFixed(1) + 'px ui-rounded, "SF Pro Rounded", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
    }

    for (let y = firstY; y <= lastY; y++) {
      for (let x = firstX; x <= lastX; x++) {
        const i = y * puzzle.cols + x;
        const n = puzzle.cells[i];
        const px = view.x + x * scale;
        const py = view.y + y * scale;

        if (!n) {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(px, py, scale + 0.5, scale + 0.5);
          continue;
        }

        if (filled[i]) {
          ctx.fillStyle = puzzle.palette[n - 1].hex;
          ctx.fillRect(px, py, scale + 0.5, scale + 0.5);
          continue;
        }

        const isActive = n === state.active;
        ctx.fillStyle = isActive ? activeTint : CELL_EMPTY;
        ctx.fillRect(px + gap, py + gap, scale - gap * 2, scale - gap * 2);

        if (showNumbers) {
          ctx.fillStyle = isActive ? activeInk : NUMBER_INK;
          ctx.fillText(String(n), px + scale / 2, py + scale / 2 + scale * 0.03);
        }
      }
    }

    const now = performance.now();

    if (state.wrong && now < state.wrong.until) {
      ring(state.wrong.index, '#e8433f', 1 - (state.wrong.until - now) / 600);
    } else {
      state.wrong = null;
    }

    if (state.hint && now < state.hint.until) {
      const age = 1 - (state.hint.until - now) / 1600;
      ring(state.hint.index, '#111528', (age * 3) % 1);
      requestAnimationFrame(draw);
    } else if (state.hint) {
      state.hint = null;
    }

    function ring(index, colour, phase) {
      const x = index % puzzle.cols;
      const y = Math.floor(index / puzzle.cols);
      const size = scale * (1 + phase * 1.6);
      const cx = view.x + (x + 0.5) * scale;
      const cy = view.y + (y + 0.5) * scale;
      ctx.strokeStyle = colour;
      ctx.globalAlpha = Math.max(0, 1 - phase);
      ctx.lineWidth = Math.max(2, scale * 0.16);
      ctx.strokeRect(cx - size / 2, cy - size / 2, size, size);
      ctx.globalAlpha = 1;
    }
  }

  // ------------------------------------------------------------ painting

  function cellFromPoint(clientX, clientY) {
    const rect = canvasRect();
    const view = state.view;
    const x = Math.floor((clientX - rect.left - view.x) / view.scale);
    const y = Math.floor((clientY - rect.top - view.y) / view.scale);
    if (x < 0 || y < 0 || x >= state.puzzle.cols || y >= state.puzzle.rows) return -1;
    return y * state.puzzle.cols + x;
  }

  function fillCell(index, fromTap) {
    if (index < 0 || state.finished) return false;
    const n = state.puzzle.cells[index];
    if (!n || state.filled[index]) return false;

    if (n !== state.active) {
      // Only a deliberate tap gets told off; dragging across the picture is
      // meant to skim over everything that isn't the colour in hand.
      if (fromTap) {
        state.wrong = { index, until: performance.now() + 600 };
        toast('That square is number ' + n, 1100);
        requestDraw();
      }
      return false;
    }

    state.filled[index] = 1;
    state.left[n]--;
    state.done++;
    sound.blip();

    if (state.left[n] === 0) finishColour(n);
    else {
      const swatch = state.puzzle.palette[n - 1];
      subtitleEl.textContent = swatch.name + ' — ' + state.left[n] + ' left';
      const chip = paletteEl.querySelector('[data-colour="' + n + '"] .swatch-left');
      if (chip) chip.textContent = String(state.left[n]);
    }

    updateProgress();
    scheduleSave();
    if (state.done === state.total) finishPicture();
    return true;
  }

  function finishColour(colour) {
    const name = state.puzzle.palette[colour - 1].name;
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
    const { name } = state.puzzle;
    doneText.textContent = name + ' — all ' + state.total + ' squares filled in.';
    doneEl.hidden = false;
    subtitleEl.textContent = 'Finished';
    store.set(progressKey(state.puzzle.id), toBase64(packBits(state.filled)));
    requestDraw();
  }

  // Fill every square the drag passed over, not just the ones a pointer
  // event happened to land on — a fast swipe reports very few positions.
  function paintAlong(fromX, fromY, toX, toY) {
    const step = state.view.scale * 0.4;
    const distance = Math.hypot(toX - fromX, toY - fromY);
    const steps = Math.max(1, Math.ceil(distance / Math.max(1, step)));
    let painted = false;
    for (let s = 0; s <= steps; s++) {
      const f = s / steps;
      painted = fillCell(cellFromPoint(fromX + (toX - fromX) * f, fromY + (toY - fromY) * f), false) || painted;
    }
    return painted;
  }

  const pointers = new Map();
  let gesture = null;
  let stroke = null;
  let lastTap = 0;
  // Two quick taps only mean "zoom" if they land in the same place; tapping
  // your way along a row of squares is not a double tap.
  let lastTapAt = null;

  /* These live on the canvas rather than on the board around it. The finished
     panel sits inside the board, and a stroke that captured the pointer there
     would swallow the taps meant for its buttons. */
  canvas.addEventListener('pointerdown', (event) => {
    if (!state) return;
    canvas.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointers.size === 1) {
      stroke = {
        x: event.clientX, y: event.clientY,
        startX: event.clientX, startY: event.clientY,
        at: performance.now(), moved: false, painted: false,
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
      const min = fitScale() * 0.95;
      const scale = Math.max(min, Math.min(64, gesture.scale * (distance / Math.max(1, gesture.distance))));

      // Zoom about the point between the fingers, and let that point drag
      // the picture with it, so pinch and pan are the same gesture.
      const cellX = (gesture.midX - rect.left - gesture.viewX) / gesture.scale;
      const cellY = (gesture.midY - rect.top - gesture.viewY) / gesture.scale;
      view.scale = scale;
      view.x = (midX - rect.left) - cellX * scale;
      view.y = (midY - rect.top) - cellY * scale;
      clampView();
      requestDraw();
      return;
    }

    if (!stroke) return;
    if (Math.hypot(event.clientX - stroke.startX, event.clientY - stroke.startY) > 6) stroke.moved = true;
    if (stroke.moved && paintAlong(stroke.x, stroke.y, event.clientX, event.clientY)) {
      stroke.painted = true;
      requestDraw();
    }
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
          if (fillCell(cellFromPoint(event.clientX, event.clientY), true)) requestDraw();
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
    const factor = Math.exp(-event.deltaY * 0.0016);
    zoomTo(state.view.scale * factor, event.clientX - rect.left, event.clientY - rect.top);
  }, { passive: false });

  // --------------------------------------------------------------- tools

  $('hintBtn').addEventListener('click', () => {
    if (!state || state.finished) return;
    if (!state.left[state.active]) {
      const next = nextUnfinished(state.active);
      if (next) chooseColour(next);
    }

    const { puzzle, view } = state;
    const { width, height } = viewport();
    const centreX = (width / 2 - view.x) / view.scale;
    const centreY = (height / 2 - view.y) / view.scale;

    let best = -1, bestDistance = Infinity;
    for (let i = 0; i < puzzle.cells.length; i++) {
      if (puzzle.cells[i] !== state.active || state.filled[i]) continue;
      const dx = (i % puzzle.cols) + 0.5 - centreX;
      const dy = Math.floor(i / puzzle.cols) + 0.5 - centreY;
      const distance = dx * dx + dy * dy;
      if (distance < bestDistance) { bestDistance = distance; best = i; }
    }
    if (best < 0) return;

    // Bring it into view if the hint is somewhere off the screen.
    const x = (best % puzzle.cols + 0.5) * view.scale + view.x;
    const y = (Math.floor(best / puzzle.cols) + 0.5) * view.scale + view.y;
    if (x < 0 || y < 0 || x > width || y > height) {
      view.x = width / 2 - (best % puzzle.cols + 0.5) * view.scale;
      view.y = height / 2 - (Math.floor(best / puzzle.cols) + 0.5) * view.scale;
      clampView();
    }

    state.hint = { index: best, until: performance.now() + 1600 };
    requestDraw();
  });

  $('fitBtn').addEventListener('click', () => {
    if (!state) return;
    fitView();
    requestDraw();
  });

  $('resetBtn').addEventListener('click', () => {
    if (!state) return;
    if (!confirm('Start ' + state.puzzle.name + ' again from blank?')) return;
    store.remove(progressKey(state.puzzle.id));
    openPuzzle(state.puzzle.id);
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

  // Saving the finished picture: rendered afresh at a size worth keeping,
  // rather than screenshotting whatever the board happens to be showing.
  $('saveBtn').addEventListener('click', () => {
    if (!state) return;
    const { puzzle } = state;
    const scale = Math.max(4, Math.round(1600 / Math.max(puzzle.cols, puzzle.rows)));
    const out = document.createElement('canvas');
    out.width = puzzle.cols * scale;
    out.height = puzzle.rows * scale;
    const c = out.getContext('2d');
    c.fillStyle = '#ffffff';
    c.fillRect(0, 0, out.width, out.height);
    for (let y = 0; y < puzzle.rows; y++) {
      for (let x = 0; x < puzzle.cols; x++) {
        const n = puzzle.cells[y * puzzle.cols + x];
        if (!n) continue;
        c.fillStyle = puzzle.palette[n - 1].hex;
        c.fillRect(x * scale, y * scale, scale, scale);
      }
    }
    out.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const name = 'pigment-' + puzzle.id + '.png';
      if ('download' in link) {
        link.href = url;
        link.download = name;
        document.body.appendChild(link);
        link.click();
        link.remove();
        toast('Saved as ' + name, 2600);
      } else {
        self.open(url, '_blank');
        toast('Press and hold the picture to save it', 2600);
      }
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    }, 'image/png');
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

  /* k-means over the squares themselves. The picture is already tiny by the
     time this runs — a few thousand cells — so a handful of passes settles
     and the whole thing takes a few milliseconds. */
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

    // colours too rare to be worth a number of their own
    const floor = Math.max(3, Math.round(count * 0.004));
    let counts = tally();
    for (let c = 0; c < centres.length; c++) {
      if (!alive[c] || counts[c] >= floor) continue;
      const { best } = nearestAlive(c);
      if (best >= 0) { absorb(c, best); counts = tally(); }
    }

    // colours a person could not tell apart on the swatch
    const TOO_CLOSE = 26 * 26;
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

  // Single stray squares are miserable to colour and add nothing, so a
  // square outvoted by all four of its neighbours joins them.
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
    if (ratio > 1) rows = Math.max(16, Math.round(longest / ratio));
    else cols = Math.max(16, Math.round(longest * ratio));

    /* Halve the photo repeatedly before the final draw. Going straight from a
       12-megapixel photo to 44 squares makes some browsers point-sample it,
       which turns a face into confetti; stepping down averages instead. */
    let width = source.width, height = source.height;
    let canvasStep = document.createElement('canvas');
    canvasStep.width = width;
    canvasStep.height = height;
    let stepCtx = canvasStep.getContext('2d');
    stepCtx.drawImage(source, 0, 0, width, height);
    while (width > cols * 2 && height > rows * 2) {
      width = Math.max(cols, Math.round(width / 2));
      height = Math.max(rows, Math.round(height / 2));
      const next = document.createElement('canvas');
      next.width = width;
      next.height = height;
      const nextCtx = next.getContext('2d');
      nextCtx.imageSmoothingEnabled = true;
      nextCtx.imageSmoothingQuality = 'high';
      nextCtx.drawImage(canvasStep, 0, 0, width, height);
      canvasStep = next;
      stepCtx = nextCtx;
    }

    const small = document.createElement('canvas');
    small.width = cols;
    small.height = rows;
    const smallCtx = small.getContext('2d');
    smallCtx.imageSmoothingEnabled = true;
    smallCtx.imageSmoothingQuality = 'high';
    smallCtx.drawImage(canvasStep, 0, 0, cols, rows);

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

    const nextNumber = custom.reduce((highest, p) => Math.max(highest, p.number || 0), 0) + 1;
    return {
      id: 'photo-' + Date.now().toString(36),
      name: 'Photo ' + nextNumber,
      number: nextNumber,
      blurb: cols + ' × ' + rows + ', ' + palette.length + ' colours',
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
      custom.unshift(puzzle);
      if (custom.length > MAX_CUSTOM) {
        const dropped = custom.pop();
        store.remove(progressKey(dropped.id));
      }
      if (!saveCustom()) {
        custom.shift();
        makeStatus.textContent = 'There is no room left on this device to keep another picture.';
        return;
      }
      makeStatus.textContent = '';
      renderGallery();
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
    // Hold the zoom level relative to a fitted picture, so turning the phone
    // keeps you where you were rather than throwing you back out.
    const ratio = before.fit ? before.scale / before.fit : 1;
    state.view.scale = fitScale() * ratio;
    clampView();
    requestDraw();
  });
  observer.observe(board);

  document.addEventListener('keydown', (event) => {
    if (!state) return;
    if (event.key === 'Escape') { openGallery(); return; }
    const number = Number(event.key);
    if (number >= 1 && number <= 9 && number <= state.puzzle.palette.length) {
      chooseColour(number);
      requestDraw();
    }
  });

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => { /* offline is best-effort */ });
    });
  }
})();
