/* Neon Chomp — a modern maze-chase arcade game.
   No build step, no dependencies: everything is drawn to a canvas and every
   sound is synthesised with WebAudio, so the whole thing works offline. */
(() => {
  'use strict';

  // ------------------------------------------------------------------ maze

  const MAZE = [
    '############################',
    '#............##............#',
    '#.####.#####.##.#####.####.#',
    '#o####.#####.##.#####.####o#',
    '#.####.#####.##.#####.####.#',
    '#..........................#',
    '#.####.##.########.##.####.#',
    '#.####.##.########.##.####.#',
    '#......##....##....##......#',
    '######.##### ## #####.######',
    '     #.##### ## #####.#     ',
    '     #.##          ##.#     ',
    '     #.## ###--### ##.#     ',
    '######.## #      # ##.######',
    '      .   #      #   .      ',
    '######.## #      # ##.######',
    '     #.## ######## ##.#     ',
    '     #.##          ##.#     ',
    '     #.## ######## ##.#     ',
    '######.## ######## ##.######',
    '#............##............#',
    '#.####.#####.##.#####.####.#',
    '#.####.#####.##.#####.####.#',
    '#o..##.......  .......##..o#',
    '###.##.##.########.##.##.###',
    '###.##.##.########.##.##.###',
    '#......##....##....##......#',
    '#.##########.##.##########.#',
    '#.##########.##.##########.#',
    '#..........................#',
    '############################',
  ];

  const COLS = 28;
  const ROWS = MAZE.length;
  const TILE = 16;
  const W = COLS * TILE;
  const H = ROWS * TILE;

  const WALL = 1, DOOR = 2, PATH = 0;
  const PELLET = 1, POWER = 2;

  const TUNNEL_ROW = 14;
  const HOUSE_DOOR = { x: 13, y: 11 };   // tile just above the gate
  const HOUSE_MID = { x: 13, y: 14 };    // middle of the ghost house
  const PLAYER_HOME = { x: 13, y: 23 };

  /** Static tile kinds: WALL / DOOR / PATH. */
  const tiles = MAZE.map((row) => [...row].map((ch) =>
    ch === '#' ? WALL : ch === '-' ? DOOR : PATH));

  /** Pellet layout for a fresh level. */
  const pelletTemplate = MAZE.map((row) => [...row].map((ch) =>
    ch === '.' ? PELLET : ch === 'o' ? POWER : 0));

  const TOTAL_PELLETS = pelletTemplate.flat().filter(Boolean).length;

  const wrapCol = (c) => ((c % COLS) + COLS) % COLS;
  const tileAt = (c, r) => (r < 0 || r >= ROWS) ? WALL : tiles[r][wrapCol(c)];

  /** Corridor cells the player can actually stand in (excludes sealed voids). */
  const reachable = (() => {
    const seen = MAZE.map((row) => [...row].map(() => false));
    const stack = [[PLAYER_HOME.x, PLAYER_HOME.y]];
    while (stack.length) {
      const [c0, r] = stack.pop();
      const c = wrapCol(c0);
      if (r < 0 || r >= ROWS || seen[r][c] || tiles[r][c] !== PATH) continue;
      seen[r][c] = true;
      stack.push([c + 1, r], [c - 1, r], [c, r + 1], [c, r - 1]);
    }
    return seen;
  })();

  const isCorridor = (c, r) => r >= 0 && r < ROWS && reachable[r][wrapCol(c)];

  // ------------------------------------------------------------ directions

  const DIRS = {
    up: { x: 0, y: -1 },
    left: { x: -1, y: 0 },
    down: { x: 0, y: 1 },
    right: { x: 1, y: 0 },
  };
  const DIR_ORDER = ['up', 'left', 'down', 'right'];  // classic tie-break order
  const OPPOSITE = { up: 'down', down: 'up', left: 'right', right: 'left' };
  const ANGLE = { right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2 };

  // -------------------------------------------------------------- tuneables

  const BASE_SPEED = 9.4;        // player tiles per second at level 1
  const GHOST_SPEED = 8.5;
  const FRIGHT_SPEED = 5.4;
  const EYES_SPEED = 17;
  const DASH_TIME = 0.32;
  const DASH_COOL = 4.5;
  const DASH_BOOST = 2.05;
  const CHAIN_WINDOW = 1.35;     // seconds to keep a pellet chain alive
  const CHAIN_STEP = 8;          // pellets per extra multiplier
  const CHAIN_MAX = 5;
  const EXTRA_LIFE_AT = 10000;
  const GHOST_POINTS = [200, 400, 800, 1600];
  const FRUIT = [
    { icon: '🍒', points: 100 },
    { icon: '🍓', points: 300 },
    { icon: '🍊', points: 500 },
    { icon: '🍎', points: 700 },
    { icon: '🍈', points: 1000 },
    { icon: '🍇', points: 2000 },
    { icon: '🍌', points: 3000 },
    { icon: '⭐', points: 5000 },
  ];
  const MODE_PLAN = [
    { mode: 'scatter', time: 7 }, { mode: 'chase', time: 20 },
    { mode: 'scatter', time: 7 }, { mode: 'chase', time: 20 },
    { mode: 'scatter', time: 5 }, { mode: 'chase', time: 20 },
    { mode: 'scatter', time: 5 }, { mode: 'chase', time: Infinity },
  ];

  // `home` is where a ghost waits inside the house — Blinky only ever sees it
  // after being eaten, since it starts the level already out on the board.
  const GHOST_SPECS = [
    { id: 'blinky', color: '#ff3b5c', glow: '#ff7aa0', scatter: { x: 25, y: -2 }, start: { x: 13, y: 11 }, home: { x: 13, y: 14 }, release: 0, startOutside: true },
    { id: 'pinky', color: '#ff7ee6', glow: '#ffb3f0', scatter: { x: 2, y: -2 }, start: { x: 13, y: 14 }, home: { x: 13, y: 14 }, release: 1.5 },
    { id: 'inky', color: '#3ce0ff', glow: '#9df2ff', scatter: { x: 26, y: 32 }, start: { x: 11.6, y: 14 }, home: { x: 11.6, y: 14 }, release: 6 },
    { id: 'clyde', color: '#ffab3d', glow: '#ffd08a', scatter: { x: 1, y: 32 }, start: { x: 15.4, y: 14 }, home: { x: 15.4, y: 14 }, release: 11 },
  ];
  const RELEASE_DOTS = { blinky: 0, pinky: 0, inky: 14, clyde: 44 };

  // --------------------------------------------------------------- helpers

  const clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;
  const rand = (a, b) => a + Math.random() * (b - a);
  const cellX = (e) => wrapCol(Math.round(e.x));
  const cellY = (e) => Math.round(e.y);

  function wrapEntity(e) {
    if (e.x < -0.5) e.x += COLS;
    else if (e.x >= COLS - 0.5) e.x -= COLS;
  }

  /** Can this entity occupy the given tile? */
  function passable(e, c, r) {
    const t = tileAt(c, r);
    if (t === WALL) return false;
    if (t === DOOR) return e.kind === 'ghost' && (e.state === 'leaving' || e.state === 'entering');
    return true;
  }

  const EPS = 1e-6;

  /**
   * Move an entity `dist` tiles along its heading. Whenever it is standing on
   * a tile centre `onCentre` decides what happens next (turn, or refuse to
   * walk into a wall by returning false).
   *
   * The centre test has to tolerate float drift: landing a billionth of a tile
   * short of a centre still counts as being on it, otherwise the entity skips
   * the decision and sails through the wall behind it.
   */
  function advance(e, dist, onCentre) {
    let guard = 0;
    while (dist > EPS && guard++ < 32) {
      const heading = DIRS[e.dir];
      const axis = heading.x !== 0 ? 'x' : 'y';
      const sign = heading.x || heading.y;
      const centre = Math.round(e[axis]);

      if (Math.abs(e[axis] - centre) < EPS) {
        e[axis] = centre;
        wrapEntity(e);
        if (onCentre(e) === false) return;
      }

      // onCentre may have turned us, so re-read the heading before moving
      const d = DIRS[e.dir];
      const moveAxis = d.x !== 0 ? 'x' : 'y';
      const moveSign = d.x || d.y;
      let toCentre = (Math.round(e[moveAxis]) - e[moveAxis]) * moveSign;
      if (toCentre < EPS) toCentre += 1;

      const move = Math.min(dist, toCentre);
      e[moveAxis] += move * moveSign;
      dist -= move;
      if (move >= toCentre - EPS) e[moveAxis] = Math.round(e[moveAxis]);
      wrapEntity(e);
    }
  }

  // ----------------------------------------------------------------- audio

  const Sound = (() => {
    let ac = null;
    let master = null;
    let siren = null;
    let muted = localStorage.getItem('neonChomp.muted') === '1';

    function ensure() {
      if (!ac) {
        const Ctor = window.AudioContext || window.webkitAudioContext;
        if (!Ctor) return null;
        ac = new Ctor();
        master = ac.createGain();
        master.gain.value = muted ? 0 : 0.32;
        master.connect(ac.destination);
      }
      if (ac.state === 'suspended') ac.resume();
      return ac;
    }

    function tone({ freq, to, dur = 0.12, type = 'square', vol = 0.3, delay = 0 }) {
      if (muted || !ensure()) return;
      const t0 = ac.currentTime + delay;
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t0);
      if (to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t0 + dur);
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(gain).connect(master);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    }

    function noise({ dur = 0.25, vol = 0.25, freq = 900 }) {
      if (muted || !ensure()) return;
      const t0 = ac.currentTime;
      const frames = Math.floor(ac.sampleRate * dur);
      const buf = ac.createBuffer(1, frames, ac.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
      const src = ac.createBufferSource();
      src.buffer = buf;
      const filter = ac.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(freq, t0);
      filter.frequency.exponentialRampToValueAtTime(freq * 3, t0 + dur);
      const gain = ac.createGain();
      gain.gain.setValueAtTime(vol, t0);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      src.connect(filter).connect(gain).connect(master);
      src.start(t0);
    }

    let blipHigh = false;
    return {
      get muted() { return muted; },
      unlock: ensure,
      toggleMute() {
        muted = !muted;
        localStorage.setItem('neonChomp.muted', muted ? '1' : '0');
        if (master) master.gain.value = muted ? 0 : 0.32;
        if (muted) this.stopSiren();
        return muted;
      },
      pellet() {
        blipHigh = !blipHigh;
        tone({ freq: blipHigh ? 494 : 392, dur: 0.055, type: 'square', vol: 0.14 });
      },
      power() {
        tone({ freq: 180, to: 720, dur: 0.34, type: 'sawtooth', vol: 0.22 });
        tone({ freq: 90, to: 360, dur: 0.34, type: 'square', vol: 0.12 });
      },
      eatGhost(step) {
        const base = 300 * Math.pow(1.28, step);
        tone({ freq: base, to: base * 2.6, dur: 0.18, type: 'triangle', vol: 0.3 });
        tone({ freq: base * 2, to: base * 4, dur: 0.2, type: 'sine', vol: 0.18, delay: 0.05 });
      },
      fruit() {
        [523, 659, 784, 1046].forEach((f, i) =>
          tone({ freq: f, dur: 0.1, type: 'triangle', vol: 0.24, delay: i * 0.06 }));
      },
      dash() { noise({ dur: 0.28, vol: 0.2, freq: 700 }); },
      death() {
        tone({ freq: 640, to: 70, dur: 1.1, type: 'sawtooth', vol: 0.28 });
        tone({ freq: 320, to: 40, dur: 1.2, type: 'square', vol: 0.16, delay: 0.06 });
      },
      levelUp() {
        [392, 523, 659, 880, 1046].forEach((f, i) =>
          tone({ freq: f, dur: 0.16, type: 'triangle', vol: 0.26, delay: i * 0.09 }));
      },
      gameOver() {
        [440, 349, 262, 196].forEach((f, i) =>
          tone({ freq: f, dur: 0.34, type: 'sawtooth', vol: 0.22, delay: i * 0.18 }));
      },
      extraLife() {
        [784, 988, 1318].forEach((f, i) =>
          tone({ freq: f, dur: 0.14, type: 'sine', vol: 0.28, delay: i * 0.08 }));
      },
      startSiren() {
        if (muted || siren || !ensure()) return;
        const osc = ac.createOscillator();
        const lfo = ac.createOscillator();
        const lfoGain = ac.createGain();
        const gain = ac.createGain();
        const filter = ac.createBiquadFilter();
        osc.type = 'sawtooth';
        osc.frequency.value = 150;
        lfo.type = 'sine';
        lfo.frequency.value = 4;
        lfoGain.gain.value = 34;
        filter.type = 'lowpass';
        filter.frequency.value = 700;
        gain.gain.value = 0.05;
        lfo.connect(lfoGain).connect(osc.frequency);
        osc.connect(filter).connect(gain).connect(master);
        osc.start();
        lfo.start();
        siren = { osc, lfo, gain };
      },
      tuneSiren(baseFreq, wobble, vol) {
        if (!siren || !ac) return;
        const t = ac.currentTime;
        siren.osc.frequency.setTargetAtTime(baseFreq, t, 0.15);
        siren.lfo.frequency.setTargetAtTime(wobble, t, 0.15);
        siren.gain.gain.setTargetAtTime(vol, t, 0.15);
      },
      stopSiren() {
        if (!siren) return;
        try { siren.osc.stop(); siren.lfo.stop(); } catch (e) { /* already stopped */ }
        siren = null;
      },
    };
  })();

  // ------------------------------------------------------------------ dom

  const $ = (id) => document.getElementById(id);
  const canvas = $('game');
  const ctx = canvas.getContext('2d');
  const stage = $('stage');
  const stageHost = $('stageHost');
  const overlay = $('overlay');
  const panelTitle = $('panelTitle');
  const panelText = $('panelText');
  const panelBtn = $('panelBtn');
  const panelHint = $('panelHint');
  const scoreEl = $('score');
  const bestEl = $('best');
  const levelEl = $('level');
  const livesEl = $('lives');
  const chainFill = $('chainFill');
  const chainMult = $('chainMult');
  const dashFill = $('dashFill');
  const dashMeter = $('dashMeter');
  const dashBtn = $('dashBtn');
  const pauseBtn = $('pauseBtn');
  const muteBtn = $('muteBtn');
  const flashEl = $('flash');

  // ----------------------------------------------------------------- state

  const game = {
    phase: 'menu',       // menu | ready | play | dying | clear | over
    paused: false,
    score: 0,
    best: Number(localStorage.getItem('neonChomp.best') || 0),
    level: 1,
    lives: 3,
    pellets: null,
    pelletsLeft: 0,
    pelletsEaten: 0,
    modeIndex: 0,
    modeTimer: 0,
    frightTimer: 0,
    ghostStreak: 0,
    chain: 0,
    chainTimer: 0,
    phaseTimer: 0,
    elapsed: 0,
    nextLife: EXTRA_LIFE_AT,
    fruit: null,
    fruitSpawned: 0,
    shake: 0,
    time: 0,
  };

  const player = {
    kind: 'player',
    x: PLAYER_HOME.x, y: PLAYER_HOME.y,
    dir: 'left', want: null, blocked: false,
    mouth: 0, dashTime: 0, dashCool: 0, trail: [],
    deathT: 0,
  };

  const ghosts = GHOST_SPECS.map((spec) => ({
    kind: 'ghost',
    spec,
    id: spec.id,
    x: spec.start.x, y: spec.start.y,
    dir: 'left',
    state: spec.startOutside ? 'active' : 'house',   // house | leaving | active | eyes | entering
    frightened: false,
    exitPhase: null,
    releaseAt: spec.release,
    bob: Math.random() * Math.PI * 2,
    eyesTimer: 0,
  }));

  const particles = [];
  const popups = [];

  // ------------------------------------------------------------ level flow

  function resetLevel(fullReset) {
    game.pellets = pelletTemplate.map((row) => [...row]);
    game.pelletsLeft = TOTAL_PELLETS;
    game.pelletsEaten = 0;
    game.fruit = null;
    game.fruitSpawned = 0;
    if (fullReset) {
      game.score = 0;
      game.level = 1;
      game.lives = 3;
      game.nextLife = EXTRA_LIFE_AT;
    }
    buildMazeArt();
    resetActors();
  }

  function resetActors() {
    player.x = PLAYER_HOME.x;
    player.y = PLAYER_HOME.y;
    player.dir = 'left';
    player.want = null;
    player.blocked = false;
    player.mouth = 0;
    player.dashTime = 0;
    player.dashCool = 0;
    player.deathT = 0;
    player.trail.length = 0;

    ghosts.forEach((g) => {
      g.x = g.spec.start.x;
      g.y = g.spec.start.y;
      g.dir = g.id === 'blinky' ? 'left' : 'up';
      g.state = g.spec.startOutside ? 'active' : 'house';
      g.frightened = false;
      g.exitPhase = null;
      g.releaseAt = g.spec.release;
      g.eyesTimer = 0;
    });

    game.modeIndex = 0;
    game.modeTimer = 0;
    game.frightTimer = 0;
    game.ghostStreak = 0;
    game.chain = 0;
    game.chainTimer = 0;
    game.elapsed = 0;
    particles.length = 0;
    popups.length = 0;
  }

  function setPhase(phase, timer = 0) {
    game.phase = phase;
    game.phaseTimer = timer;
    if (phase === 'play') Sound.startSiren();
    else Sound.stopSiren();
  }

  function startGame() {
    resetLevel(true);
    setPhase('ready', 2.1);
    hideOverlay();
    syncHud(true);
  }

  function nextLevel() {
    game.level++;
    resetLevel(false);
    setPhase('ready', 2.1);
    Sound.levelUp();
    syncHud(true);
  }

  function loseLife() {
    game.lives--;
    Sound.stopSiren();
    Sound.death();
    setPhase('dying', 1.9);
    player.deathT = 0;
    game.shake = 10;
  }

  function gameOver() {
    setPhase('over');
    if (game.score > game.best) {
      game.best = game.score;
      localStorage.setItem('neonChomp.best', String(game.best));
    }
    Sound.gameOver();
    showOverlay({
      title: 'Game over',
      text: `You scored ${game.score.toLocaleString()} on level ${game.level}.` +
        (game.score >= game.best ? ' A new best!' : ` Best: ${game.best.toLocaleString()}.`),
      button: 'Play again',
      hint: 'Arrows / WASD to move · Space to dash · P to pause',
      action: startGame,
    });
    syncHud(true);
  }

  // --------------------------------------------------------------- scoring

  function addScore(points, at) {
    game.score += points;
    if (game.score >= game.nextLife) {
      game.nextLife += EXTRA_LIFE_AT;
      game.lives++;
      Sound.extraLife();
      popups.push({ x: player.x, y: player.y - 1, text: '1UP', life: 1.4, max: 1.4, color: '#7dff9b' });
    }
    if (at) popups.push({ x: at.x, y: at.y, text: `+${points}`, life: 0.85, max: 0.85, color: '#fff' });
    scoreEl.classList.remove('bump');
    void scoreEl.offsetWidth;
    scoreEl.classList.add('bump');
  }

  const chainMultiplier = () =>
    clamp(1 + Math.floor(game.chain / CHAIN_STEP), 1, CHAIN_MAX);

  // ---------------------------------------------------------------- update

  function levelSpeed() {
    return Math.min(1.32, 1 + (game.level - 1) * 0.05);
  }

  function frightDuration() {
    return Math.max(1.6, 7.2 - (game.level - 1) * 0.6);
  }

  function currentMode() {
    return MODE_PLAN[Math.min(game.modeIndex, MODE_PLAN.length - 1)].mode;
  }

  function ghostTarget(g) {
    if (g.state === 'eyes' || g.state === 'entering') return HOUSE_DOOR;
    if (currentMode() === 'scatter') return g.spec.scatter;

    const pc = { x: Math.round(player.x), y: Math.round(player.y) };
    const pd = DIRS[player.dir];
    switch (g.id) {
      case 'blinky':
        return pc;
      case 'pinky':
        return { x: pc.x + pd.x * 4, y: pc.y + pd.y * 4 };
      case 'inky': {
        const pivot = { x: pc.x + pd.x * 2, y: pc.y + pd.y * 2 };
        const blinky = ghosts[0];
        return { x: pivot.x * 2 - Math.round(blinky.x), y: pivot.y * 2 - Math.round(blinky.y) };
      }
      default: {
        const far = Math.hypot(pc.x - g.x, pc.y - g.y) > 8;
        return far ? pc : g.spec.scatter;
      }
    }
  }

  function ghostSpeed(g) {
    const lvl = levelSpeed();
    if (g.state === 'eyes' || g.state === 'entering') return EYES_SPEED;
    if (g.frightened) return FRIGHT_SPEED * lvl;
    let s = GHOST_SPEED * lvl;
    if (g.id === 'blinky') {
      if (game.pelletsLeft < 10) s *= 1.14;
      else if (game.pelletsLeft < 24) s *= 1.07;
    }
    if (cellY(g) === TUNNEL_ROW) {
      const c = cellX(g);
      if (c <= 5 || c >= 22) s *= 0.55;
    }
    return s;
  }

  function ghostChoose(g) {
    const c = cellX(g);
    const r = cellY(g);

    if (g.state === 'eyes' && c === HOUSE_DOOR.x && r === HOUSE_DOOR.y) {
      g.state = 'entering';
      return false;
    }

    const options = DIR_ORDER.filter((d) =>
      d !== OPPOSITE[g.dir] && passable(g, c + DIRS[d].x, r + DIRS[d].y));

    if (!options.length) {
      g.dir = OPPOSITE[g.dir];
      return true;
    }

    if (g.frightened && g.state === 'active') {
      g.dir = options[(Math.random() * options.length) | 0];
      return true;
    }

    const target = ghostTarget(g);
    let best = Infinity;
    let pick = options[0];
    for (const d of options) {
      const nx = c + DIRS[d].x;
      const ny = r + DIRS[d].y;
      const dist = (nx - target.x) ** 2 + (ny - target.y) ** 2;
      if (dist < best - 1e-9) { best = dist; pick = d; }
    }
    g.dir = pick;
    return true;
  }

  function moveTowards(g, tx, ty, dist) {
    const dx = tx - g.x;
    const dy = ty - g.y;
    const len = Math.hypot(dx, dy);
    if (len <= dist) { g.x = tx; g.y = ty; return true; }
    g.x += (dx / len) * dist;
    g.y += (dy / len) * dist;
    return false;
  }

  function updateGhost(g, dt) {
    switch (g.state) {
      case 'house': {
        g.bob += dt * 3.4;
        g.y = g.spec.home.y + Math.sin(g.bob) * 0.28;
        g.dir = Math.sin(g.bob) > 0 ? 'down' : 'up';
        const dotsOk = game.pelletsEaten >= RELEASE_DOTS[g.id];
        if ((game.elapsed >= g.releaseAt && dotsOk) || game.elapsed >= g.releaseAt + 6) {
          g.state = 'leaving';
          g.exitPhase = 'align';
        }
        break;
      }
      case 'leaving': {
        // Two one-way phases: slide under the gate, then rise through it. The
        // phase has to be remembered — deciding it from the position each
        // frame makes the ghost bounce around the gate forever.
        const step = EYES_SPEED * 0.55 * dt;
        if (g.exitPhase !== 'rise') {
          g.dir = g.x > HOUSE_MID.x + 0.02 ? 'left'
            : g.x < HOUSE_MID.x - 0.02 ? 'right' : 'up';
          if (moveTowards(g, HOUSE_MID.x, HOUSE_MID.y, step)) g.exitPhase = 'rise';
        } else {
          g.dir = 'up';
          if (moveTowards(g, HOUSE_DOOR.x, HOUSE_DOOR.y, step)) {
            g.state = 'active';
            g.exitPhase = null;
            g.dir = 'left';
          }
        }
        break;
      }
      case 'entering': {
        g.dir = 'down';
        const step = EYES_SPEED * 0.6 * dt;
        if (moveTowards(g, g.spec.home.x, HOUSE_MID.y, step)) {
          g.state = 'house';
          g.frightened = false;
          g.releaseAt = game.elapsed + 0.8;
          g.bob = 0;
        }
        break;
      }
      case 'eyes':
        g.eyesTimer += dt;
        if (g.eyesTimer > 12) {           // safety net: never strand the eyes
          g.x = HOUSE_DOOR.x;
          g.y = HOUSE_DOOR.y;
          g.state = 'entering';
          break;
        }
        advance(g, ghostSpeed(g) * dt, ghostChoose);
        break;
      default:
        advance(g, ghostSpeed(g) * dt, ghostChoose);
    }
  }

  function startFright() {
    game.frightTimer = frightDuration();
    game.ghostStreak = 0;
    ghosts.forEach((g) => {
      if (g.state === 'active') {
        g.frightened = true;
        g.dir = OPPOSITE[g.dir];
      }
    });
  }

  function reverseGhosts() {
    ghosts.forEach((g) => {
      if (g.state === 'active') g.dir = OPPOSITE[g.dir];
    });
  }

  function eatPelletAt(c, r) {
    const kind = game.pellets[r][c];
    if (!kind) return;
    game.pellets[r][c] = 0;
    game.pelletsLeft--;
    game.pelletsEaten++;
    game.chain++;
    game.chainTimer = CHAIN_WINDOW;

    const mult = chainMultiplier();
    if (kind === POWER) {
      addScore(50 * mult, null);
      startFright();
      Sound.power();
      flashEl.classList.remove('on');
      void flashEl.offsetWidth;
      flashEl.classList.add('on');
      game.shake = 6;
      burst(c, r, '#8ecbff', 26, 5.5);
    } else {
      addScore(10 * mult, null);
      Sound.pellet();
      if (mult > 1 && Math.random() < 0.3) burst(c, r, '#ffe6b0', 2, 1.6);
    }

    if ((game.pelletsEaten === 70 || game.pelletsEaten === 170) && !game.fruit) {
      const spec = FRUIT[Math.min(game.level - 1, FRUIT.length - 1)];
      game.fruit = { x: 13.5, y: 17, life: 9.5, spec };
      game.fruitSpawned++;
    }

    if (game.pelletsLeft <= 0) {
      Sound.stopSiren();
      setPhase('clear', 2.4);
      game.chain = 0;
    }
  }

  function playerAtCentre(p) {
    const c = cellX(p);
    const r = cellY(p);
    if (p.want && p.want !== p.dir && passable(p, c + DIRS[p.want].x, r + DIRS[p.want].y)) {
      p.dir = p.want;
    }
    const d = DIRS[p.dir];
    if (!passable(p, c + d.x, r + d.y)) {
      p.blocked = true;
      return false;
    }
    p.blocked = false;
    return true;
  }

  function updatePlayer(dt) {
    if (player.blocked && player.want) {
      const c = cellX(player);
      const r = cellY(player);
      const d = DIRS[player.want];
      if (passable(player, c + d.x, r + d.y)) {
        player.dir = player.want;
        player.blocked = false;
      }
    }

    let speed = BASE_SPEED * levelSpeed();
    if (player.dashTime > 0) {
      speed *= DASH_BOOST;
      player.dashTime -= dt;
      player.trail.push({ x: player.x, y: player.y, life: 0.28 });
    } else if (player.dashCool > 0) {
      player.dashCool = Math.max(0, player.dashCool - dt);
    }

    if (!player.blocked) {
      advance(player, speed * dt, playerAtCentre);
      player.mouth += dt * (player.dashTime > 0 ? 22 : 13);
    }

    // pellets are eaten from whichever tile the mouth is over
    const c = cellX(player);
    const r = cellY(player);
    if (game.pellets[r] && game.pellets[r][c]) {
      const near = Math.hypot(player.x - Math.round(player.x), player.y - Math.round(player.y));
      if (near < 0.45) eatPelletAt(c, r);
    }

    if (game.fruit) {
      game.fruit.life -= dt;
      if (game.fruit.life <= 0) game.fruit = null;
      else if (Math.hypot(player.x - game.fruit.x, player.y - game.fruit.y) < 0.8) {
        addScore(game.fruit.spec.points, { x: game.fruit.x, y: game.fruit.y });
        Sound.fruit();
        burst(game.fruit.x, game.fruit.y, '#ff8ad4', 22, 4.5);
        game.fruit = null;
      }
    }
  }

  function tryDash() {
    if (game.phase !== 'play' || game.paused) return;
    if (player.dashTime > 0 || player.dashCool > 0) return;
    player.dashTime = DASH_TIME;
    player.dashCool = DASH_COOL + DASH_TIME;
    Sound.dash();
    burst(player.x, player.y, '#35e7ff', 14, 4);
  }

  function checkCollisions() {
    for (const g of ghosts) {
      if (g.state === 'eyes' || g.state === 'entering' || g.state === 'house') continue;
      if (Math.hypot(g.x - player.x, g.y - player.y) > 0.62) continue;

      if (g.frightened) {
        const points = GHOST_POINTS[Math.min(game.ghostStreak, GHOST_POINTS.length - 1)];
        addScore(points, { x: g.x, y: g.y });
        Sound.eatGhost(game.ghostStreak);
        game.ghostStreak++;
        g.frightened = false;
        g.state = 'eyes';
        g.eyesTimer = 0;
        game.shake = 7;
        burst(g.x, g.y, g.spec.color, 24, 5);
      } else if (game.phase === 'play') {
        loseLife();
        return;
      }
    }
  }

  function updateModes(dt) {
    if (game.frightTimer > 0) {
      game.frightTimer -= dt;
      if (game.frightTimer <= 0) {
        game.frightTimer = 0;
        ghosts.forEach((g) => { g.frightened = false; });
      }
      return;   // mode clock pauses while the ghosts are running scared
    }
    const plan = MODE_PLAN[Math.min(game.modeIndex, MODE_PLAN.length - 1)];
    game.modeTimer += dt;
    if (game.modeTimer >= plan.time) {
      game.modeTimer = 0;
      game.modeIndex++;
      reverseGhosts();
    }
  }

  function updateChain(dt) {
    if (game.chainTimer > 0) {
      game.chainTimer -= dt;
      if (game.chainTimer <= 0) {
        game.chainTimer = 0;
        game.chain = 0;
      }
    }
  }

  function step(dt) {
    game.time += dt;
    game.shake = Math.max(0, game.shake - dt * 26);
    updateParticles(dt);

    switch (game.phase) {
      case 'ready':
        game.phaseTimer -= dt;
        if (game.phaseTimer <= 0) setPhase('play');
        break;

      case 'play': {
        game.elapsed += dt;
        updateModes(dt);
        updateChain(dt);
        updatePlayer(dt);
        ghosts.forEach((g) => updateGhost(g, dt));
        checkCollisions();
        tuneSiren();
        break;
      }

      case 'dying':
        game.phaseTimer -= dt;
        player.deathT += dt;
        if (game.phaseTimer <= 0) {
          if (game.lives <= 0) gameOver();
          else { resetActors(); setPhase('ready', 1.6); }
        }
        break;

      case 'clear':
        game.phaseTimer -= dt;
        if (game.phaseTimer <= 0) nextLevel();
        break;

      default:
        break;
    }
  }

  function tuneSiren() {
    const progress = 1 - game.pelletsLeft / TOTAL_PELLETS;
    if (game.frightTimer > 0) Sound.tuneSiren(90, 11, 0.06);
    else if (ghosts.some((g) => g.state === 'eyes')) Sound.tuneSiren(320, 16, 0.045);
    else Sound.tuneSiren(130 + progress * 90, 3.5 + progress * 4, 0.05);
  }

  // ------------------------------------------------------------- particles

  function burst(x, y, color, count, speed) {
    for (let i = 0; i < count; i++) {
      const a = rand(0, Math.PI * 2);
      const s = rand(speed * 0.3, speed);
      particles.push({
        x, y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: rand(0.25, 0.6),
        max: 0.6,
        color,
        size: rand(1, 2.6),
      });
    }
  }

  function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt;
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 1 - 3 * dt;
      p.vy *= 1 - 3 * dt;
    }
    for (let i = popups.length - 1; i >= 0; i--) {
      popups[i].life -= dt;
      if (popups[i].life <= 0) popups.splice(i, 1);
    }
    for (let i = player.trail.length - 1; i >= 0; i--) {
      player.trail[i].life -= dt;
      if (player.trail[i].life <= 0) player.trail.splice(i, 1);
    }
  }

  // ---------------------------------------------------------------- render

  let mazeArt = null;
  let artScale = 1;

  function levelHue() {
    return (198 + (game.level - 1) * 47) % 360;
  }

  /** Pre-render the maze outline: it only changes on level or resize. */
  function buildMazeArt() {
    const scale = artScale;
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(W * scale));
    cv.height = Math.max(1, Math.round(H * scale));
    const g = cv.getContext('2d');
    g.setTransform(scale, 0, 0, scale, 0, 0);

    const hue = levelHue();
    const inset = 3.6;
    const solid = (c, r) => tileAt(c, r) !== PATH;   // walls and the gate

    g.beginPath();
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (!solid(c, r)) continue;
        const x = c * TILE;
        const y = r * TILE;
        const wLeft = solid(c - 1, r);
        const wRight = solid(c + 1, r);
        const wUp = solid(c, r - 1);
        const wDown = solid(c, r + 1);

        if (isCorridor(c, r - 1)) {
          g.moveTo(x + (wLeft ? 0 : inset), y + inset);
          g.lineTo(x + TILE - (wRight ? 0 : inset), y + inset);
        }
        if (isCorridor(c, r + 1)) {
          g.moveTo(x + (wLeft ? 0 : inset), y + TILE - inset);
          g.lineTo(x + TILE - (wRight ? 0 : inset), y + TILE - inset);
        }
        if (isCorridor(c - 1, r)) {
          g.moveTo(x + inset, y + (wUp ? 0 : inset));
          g.lineTo(x + inset, y + TILE - (wDown ? 0 : inset));
        }
        if (isCorridor(c + 1, r)) {
          g.moveTo(x + TILE - inset, y + (wUp ? 0 : inset));
          g.lineTo(x + TILE - inset, y + TILE - (wDown ? 0 : inset));
        }
      }
    }

    // Round every corner where a corridor pokes into the wall.
    const HALF = Math.PI / 2;
    for (let r = 0; r <= ROWS; r++) {
      for (let c = 0; c <= COLS; c++) {
        const px = c * TILE;
        const py = r * TILE;
        const nw = isCorridor(c - 1, r - 1), ne = isCorridor(c, r - 1);
        const sw = isCorridor(c - 1, r), se = isCorridor(c, r);
        const quads = [
          [nw, !ne && !sw, 0],              // arc sweeps the SE quadrant
          [ne, !nw && !se, HALF],           // ... the SW quadrant
          [se, !ne && !sw, Math.PI],        // ... the NW quadrant
          [sw, !nw && !se, HALF * 3],       // ... the NE quadrant
        ];
        for (const [openCell, cornerFree, from] of quads) {
          if (!openCell || !cornerFree) continue;
          g.moveTo(px + Math.cos(from) * inset, py + Math.sin(from) * inset);
          g.arc(px, py, inset, from, from + HALF);
        }
      }
    }

    g.lineJoin = 'round';
    g.lineCap = 'round';
    g.strokeStyle = `hsl(${hue} 95% 58%)`;
    g.shadowColor = `hsl(${hue} 100% 60%)`;
    g.shadowBlur = 9;
    g.lineWidth = 2.4;
    g.stroke();
    g.stroke();
    g.shadowBlur = 0;
    g.strokeStyle = `hsla(${(hue + 30) % 360} 100% 88% / 0.75)`;
    g.lineWidth = 1;
    g.stroke();

    // the ghost house gate
    g.beginPath();
    g.moveTo(13 * TILE, 12 * TILE + inset);
    g.lineTo(15 * TILE, 12 * TILE + inset);
    g.lineWidth = 2.6;
    g.strokeStyle = '#ff8ad4';
    g.shadowColor = '#ff8ad4';
    g.shadowBlur = 8;
    g.stroke();

    mazeArt = cv;
  }

  function drawPellets(g) {
    const pulse = 0.5 + 0.5 * Math.sin(game.time * 5.5);
    g.save();
    g.fillStyle = '#ffe9bd';
    for (let r = 0; r < ROWS; r++) {
      const row = game.pellets[r];
      for (let c = 0; c < COLS; c++) {
        if (row[c] !== PELLET) continue;
        g.fillRect(c * TILE + TILE / 2 - 1.4, r * TILE + TILE / 2 - 1.4, 2.8, 2.8);
      }
    }
    g.fillStyle = '#bfe6ff';
    g.shadowColor = '#7ec8ff';
    g.shadowBlur = 10 + pulse * 8;
    for (let r = 0; r < ROWS; r++) {
      const row = game.pellets[r];
      for (let c = 0; c < COLS; c++) {
        if (row[c] !== POWER) continue;
        g.beginPath();
        g.arc(c * TILE + TILE / 2, r * TILE + TILE / 2, 3.4 + pulse * 1.6, 0, Math.PI * 2);
        g.fill();
      }
    }
    g.restore();
  }

  function drawFruit(g) {
    if (!game.fruit) return;
    const f = game.fruit;
    const blink = f.life < 2.5 && Math.floor(f.life * 6) % 2 === 0;
    if (blink) return;
    const x = f.x * TILE + TILE / 2;
    const y = f.y * TILE + TILE / 2;
    g.save();
    g.translate(x, y);
    g.scale(1, 1 + Math.sin(game.time * 4) * 0.06);
    g.font = '17px serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.shadowColor = '#ff8ad4';
    g.shadowBlur = 14;
    g.fillText(f.spec.icon, 0, 0);
    g.restore();
  }

  function drawPlayer(g) {
    const dying = game.phase === 'dying';
    const px = player.x * TILE + TILE / 2;
    const py = player.y * TILE + TILE / 2;
    const radius = TILE * 0.46;

    // dash after-images
    for (const t of player.trail) {
      const a = t.life / 0.28;
      g.save();
      g.globalAlpha = a * 0.35;
      g.fillStyle = '#35e7ff';
      g.beginPath();
      g.arc(t.x * TILE + TILE / 2, t.y * TILE + TILE / 2, radius * a, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }

    if (dying && player.deathT > 1.5) return;

    let mouth;
    if (dying) {
      mouth = clamp(player.deathT / 1.5, 0, 1) * Math.PI;
    } else if (game.phase === 'ready') {
      mouth = 0.28 * Math.PI;
    } else {
      mouth = (0.06 + 0.5 * (1 - Math.abs(Math.sin(player.mouth)))) * 0.62 * Math.PI;
      if (player.blocked) mouth = 0.12 * Math.PI;
    }

    const angle = ANGLE[player.dir];
    const grad = g.createRadialGradient(px - radius * 0.3, py - radius * 0.4, 1, px, py, radius);
    grad.addColorStop(0, '#fff6c9');
    grad.addColorStop(0.55, '#ffd23f');
    grad.addColorStop(1, '#ffa62b');

    g.save();
    if (dying) g.globalAlpha = clamp(1 - player.deathT / 1.7, 0, 1);
    g.shadowColor = player.dashTime > 0 ? '#35e7ff' : '#ffb43c';
    g.shadowBlur = player.dashTime > 0 ? 22 : 14;
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(px, py);
    g.arc(px, py, radius, angle + mouth, angle - mouth + Math.PI * 2);
    g.closePath();
    g.fill();
    g.restore();
  }

  function ghostBody(g, x, y, r) {
    g.beginPath();
    g.arc(x, y - r * 0.08, r, Math.PI, 0);
    g.lineTo(x + r, y + r * 0.8);
    const humps = 3;
    const w = (2 * r) / humps;
    for (let i = 0; i < humps; i++) {
      const x0 = x + r - i * w;
      g.quadraticCurveTo(x0 - w * 0.5, y + r * 0.8 + (i % 2 === 0 ? r * 0.42 : -r * 0.18), x0 - w, y + r * 0.8);
    }
    g.closePath();
  }

  function drawGhost(g, gh) {
    const x = gh.x * TILE + TILE / 2;
    const y = gh.y * TILE + TILE / 2;
    const r = TILE * 0.46;
    const eyesOnly = gh.state === 'eyes' || gh.state === 'entering';
    const flashing = gh.frightened && game.frightTimer < 2 && Math.floor(game.frightTimer * 6) % 2 === 0;

    g.save();
    if (!eyesOnly) {
      const body = gh.frightened ? (flashing ? '#ffffff' : '#3550ff') : gh.spec.color;
      const glow = gh.frightened ? (flashing ? '#ffffff' : '#6f86ff') : gh.spec.glow;
      const grad = g.createLinearGradient(x, y - r, x, y + r);
      grad.addColorStop(0, glow);
      grad.addColorStop(0.45, body);
      grad.addColorStop(1, body);
      g.shadowColor = glow;
      g.shadowBlur = 12;
      g.fillStyle = grad;
      ghostBody(g, x, y, r);
      g.fill();
      g.shadowBlur = 0;
    }

    if (gh.frightened && !eyesOnly) {
      // scared face
      g.fillStyle = flashing ? '#ff3b5c' : '#bcd0ff';
      g.beginPath();
      g.arc(x - r * 0.34, y - r * 0.12, r * 0.15, 0, Math.PI * 2);
      g.arc(x + r * 0.34, y - r * 0.12, r * 0.15, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = flashing ? '#ff3b5c' : '#bcd0ff';
      g.lineWidth = 1.4;
      g.beginPath();
      const zy = y + r * 0.42;
      for (let i = 0; i <= 6; i++) {
        const zx = x - r * 0.6 + (i * r * 1.2) / 6;
        if (i === 0) g.moveTo(zx, zy);
        else g.lineTo(zx, zy + (i % 2 ? -r * 0.16 : r * 0.16));
      }
      g.stroke();
    } else {
      const d = DIRS[gh.dir] || DIRS.left;
      const ex = d.x * r * 0.18;
      const ey = d.y * r * 0.2;
      g.fillStyle = '#ffffff';
      if (eyesOnly) { g.shadowColor = '#9fd6ff'; g.shadowBlur = 10; }
      g.beginPath();
      g.ellipse(x - r * 0.32 + ex * 0.5, y - r * 0.14 + ey * 0.5, r * 0.28, r * 0.34, 0, 0, Math.PI * 2);
      g.ellipse(x + r * 0.32 + ex * 0.5, y - r * 0.14 + ey * 0.5, r * 0.28, r * 0.34, 0, 0, Math.PI * 2);
      g.fill();
      g.shadowBlur = 0;
      g.fillStyle = '#1a1f4a';
      g.beginPath();
      g.arc(x - r * 0.32 + ex, y - r * 0.14 + ey, r * 0.15, 0, Math.PI * 2);
      g.arc(x + r * 0.32 + ex, y - r * 0.14 + ey, r * 0.15, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
  }

  function drawParticles(g) {
    for (const p of particles) {
      const a = clamp(p.life / p.max, 0, 1);
      g.globalAlpha = a;
      g.fillStyle = p.color;
      g.fillRect(p.x * TILE + TILE / 2 - p.size / 2, p.y * TILE + TILE / 2 - p.size / 2, p.size, p.size);
    }
    g.globalAlpha = 1;
  }

  function drawPopups(g) {
    g.save();
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = '700 11px ui-rounded, system-ui, sans-serif';
    for (const p of popups) {
      const t = 1 - p.life / p.max;
      g.globalAlpha = clamp(1 - t * t, 0, 1);
      g.fillStyle = p.color;
      g.shadowColor = p.color;
      g.shadowBlur = 8;
      g.fillText(p.text, p.x * TILE + TILE / 2, p.y * TILE + TILE / 2 - t * 14);
    }
    g.restore();
  }

  function drawBanner(g, text, sub) {
    g.save();
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const cx = W / 2;
    const cy = 17 * TILE + 8;
    g.font = '700 20px ui-rounded, system-ui, sans-serif';
    g.fillStyle = '#ffd23f';
    g.shadowColor = '#ff9a3c';
    g.shadowBlur = 16;
    g.fillText(text, cx, cy);
    if (sub) {
      g.font = '600 11px ui-rounded, system-ui, sans-serif';
      g.fillStyle = '#c6cdf5';
      g.shadowBlur = 0;
      g.fillText(sub, cx, cy + 20);
    }
    g.restore();
  }

  function render() {
    const g = ctx;
    g.save();
    g.clearRect(0, 0, W, H);

    if (game.shake > 0.2) {
      g.translate(rand(-game.shake, game.shake) * 0.35, rand(-game.shake, game.shake) * 0.35);
    }

    // backdrop
    const bg = g.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#070a1c');
    bg.addColorStop(1, '#0a0618');
    g.fillStyle = bg;
    g.fillRect(-20, -20, W + 40, H + 40);

    if (mazeArt) {
      const clearing = game.phase === 'clear';
      g.save();
      if (clearing) {
        const on = Math.floor(game.phaseTimer * 6) % 2 === 0;
        g.globalAlpha = on ? 1 : 0.35;
        g.filter = on ? 'brightness(1.9)' : 'none';
      }
      g.drawImage(mazeArt, 0, 0, W, H);
      g.restore();
    }

    if (game.phase !== 'clear') drawPellets(g);
    drawFruit(g);
    drawParticles(g);

    if (game.phase !== 'clear') {
      ghosts.forEach((gh) => {
        if (game.phase === 'dying' && gh.state !== 'eyes') return;
        drawGhost(g, gh);
      });
    }
    if (game.phase !== 'clear') drawPlayer(g);
    drawPopups(g);

    if (game.phase === 'ready') {
      drawBanner(g, game.phaseTimer > 1.1 ? `Level ${game.level}` : 'Ready!',
        game.phaseTimer > 1.1 ? 'Chain your pellets' : null);
    } else if (game.phase === 'clear') {
      drawBanner(g, 'Maze cleared', `Level ${game.level + 1} coming up`);
    } else if (game.phase === 'dying') {
      drawBanner(g, 'Caught!', game.lives > 0 ? `${game.lives} left` : null);
    }

    g.restore();
  }

  // ------------------------------------------------------------------- hud

  let hudCache = {};

  function syncHud(force) {
    if (force || hudCache.score !== game.score) {
      scoreEl.textContent = game.score.toLocaleString();
      hudCache.score = game.score;
    }
    const best = Math.max(game.best, game.score);
    if (force || hudCache.best !== best) {
      bestEl.textContent = best.toLocaleString();
      hudCache.best = best;
    }
    if (force || hudCache.level !== game.level) {
      levelEl.textContent = String(game.level);
      hudCache.level = game.level;
    }
    if (force || hudCache.lives !== game.lives) {
      livesEl.innerHTML = '';
      for (let i = 0; i < Math.min(game.lives, 6); i++) {
        const s = document.createElement('span');
        s.className = 'life';
        livesEl.appendChild(s);
      }
      hudCache.lives = game.lives;
    }

    const mult = chainMultiplier();
    chainFill.style.transform = `scaleX(${(game.chainTimer / CHAIN_WINDOW).toFixed(3)})`;
    if (hudCache.mult !== mult) {
      chainMult.textContent = `x${mult}`;
      hudCache.mult = mult;
    }

    const ready = player.dashCool <= 0 && player.dashTime <= 0;
    const dashPct = ready ? 1 : 1 - player.dashCool / (DASH_COOL + DASH_TIME);
    dashFill.style.transform = `scaleX(${dashPct.toFixed(3)})`;
    if (hudCache.dashReady !== ready) {
      dashMeter.classList.toggle('ready', ready);
      dashBtn.disabled = !ready;
      hudCache.dashReady = ready;
    }
  }

  function showOverlay({ title, text, button, hint, action }) {
    panelTitle.textContent = title;
    panelText.textContent = text;
    panelBtn.textContent = button;
    panelHint.textContent = hint || '';
    panelBtn.onclick = () => { Sound.unlock(); action(); };
    overlay.hidden = false;
    panelBtn.focus({ preventScroll: true });
  }

  function hideOverlay() {
    overlay.hidden = true;
  }

  function togglePause(force) {
    const wants = force !== undefined ? force : !game.paused;
    if (wants === game.paused) return;
    if (wants && !['play', 'ready'].includes(game.phase)) return;
    game.paused = wants;
    pauseBtn.textContent = wants ? 'Resume' : 'Pause';
    if (wants) {
      Sound.stopSiren();
      showOverlay({
        title: 'Paused',
        text: 'Take your time. The ghosts are holding their breath.',
        button: 'Resume',
        hint: 'P or Esc also resumes',
        action: () => togglePause(false),
      });
    } else {
      hideOverlay();
      if (game.phase === 'play') Sound.startSiren();
    }
  }

  // ---------------------------------------------------------------- inputs

  function setWant(dir) {
    if (game.paused) return;
    if (game.phase === 'menu' || game.phase === 'over') return;
    player.want = dir;
    if (game.phase !== 'play') return;

    if (dir === OPPOSITE[player.dir]) {
      player.dir = dir;
      player.blocked = false;
      return;
    }
    // small grace window so a turn taken a hair late still lands
    const c = cellX(player);
    const r = cellY(player);
    const off = Math.abs(player.x - Math.round(player.x)) + Math.abs(player.y - Math.round(player.y));
    const d = DIRS[dir];
    if (off > 0 && off <= 0.32 && passable(player, c + d.x, r + d.y)) {
      player.x = Math.round(player.x);
      player.y = Math.round(player.y);
      wrapEntity(player);
      player.dir = dir;
      player.blocked = false;
    }
  }

  const KEYS = {
    ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
    w: 'up', a: 'left', s: 'down', d: 'right',
    W: 'up', A: 'left', S: 'down', D: 'right',
  };

  window.addEventListener('keydown', (e) => {
    const dir = KEYS[e.key];
    if (dir) {
      e.preventDefault();
      Sound.unlock();
      setWant(dir);
      return;
    }
    if (e.key === ' ' || e.code === 'Space') {
      e.preventDefault();
      Sound.unlock();
      if (game.phase === 'menu' || game.phase === 'over') panelBtn.click();
      else tryDash();
    } else if (e.key === 'p' || e.key === 'P' || e.key === 'Escape') {
      e.preventDefault();
      togglePause();
    } else if (e.key === 'm' || e.key === 'M') {
      setMuteLabel(Sound.toggleMute());
      if (!Sound.muted && game.phase === 'play' && !game.paused) Sound.startSiren();
    } else if (e.key === 'Enter') {
      if (game.phase === 'menu' || game.phase === 'over') panelBtn.click();
    }
  }, { passive: false });

  // swipe
  let touchStart = null;
  canvas.addEventListener('touchstart', (e) => {
    Sound.unlock();
    const t = e.changedTouches[0];
    touchStart = { x: t.clientX, y: t.clientY, t: performance.now() };
  }, { passive: true });

  canvas.addEventListener('touchend', (e) => {
    if (!touchStart) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touchStart.x;
    const dy = t.clientY - touchStart.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 24) {
      if (performance.now() - touchStart.t < 300) tryDash();
    } else if (Math.abs(dx) > Math.abs(dy)) {
      setWant(dx > 0 ? 'right' : 'left');
    } else {
      setWant(dy > 0 ? 'down' : 'up');
    }
    touchStart = null;
  }, { passive: true });

  document.querySelectorAll('.dbtn').forEach((btn) => {
    const fire = (e) => {
      e.preventDefault();
      Sound.unlock();
      setWant(btn.dataset.dir);
    };
    btn.addEventListener('touchstart', fire, { passive: false });
    btn.addEventListener('mousedown', fire);
  });

  dashBtn.addEventListener('click', () => { Sound.unlock(); tryDash(); });
  pauseBtn.addEventListener('click', () => togglePause());

  function setMuteLabel(muted) {
    muteBtn.textContent = muted ? 'Sound off' : 'Sound on';
    muteBtn.setAttribute('aria-pressed', muted ? 'true' : 'false');
  }

  muteBtn.addEventListener('click', () => {
    Sound.unlock();
    const muted = Sound.toggleMute();
    setMuteLabel(muted);
    if (!muted && game.phase === 'play' && !game.paused) Sound.startSiren();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) togglePause(true);
  });

  // ---------------------------------------------------------------- layout

  function layout() {
    const styles = getComputedStyle(stageHost);
    const availW = stageHost.clientWidth -
      parseFloat(styles.paddingLeft) - parseFloat(styles.paddingRight);
    const top = stageHost.getBoundingClientRect().top;

    // Measure the chrome under the board rather than guessing at it, so the
    // maze grows into whatever room the phone actually has.
    const toolbar = document.querySelector('.toolbar');
    const pad = document.getElementById('touchControls');
    const padH = getComputedStyle(pad).display === 'none' ? 0 : pad.offsetHeight;
    const appPad = parseFloat(getComputedStyle(document.querySelector('.app')).paddingBottom) || 12;
    const gaps = 10 * (padH ? 3 : 2);
    const availH = window.innerHeight - top - toolbar.offsetHeight - padH - gaps - appPad;
    const scale = clamp(Math.min(availW / W, availH / H), 0.42, 1.35);

    stage.style.width = `${Math.round(W * scale)}px`;
    stage.style.height = `${Math.round(H * scale)}px`;

    const dpr = clamp(window.devicePixelRatio || 1, 1, 2.5);
    const backing = scale * dpr;
    canvas.width = Math.round(W * backing);
    canvas.height = Math.round(H * backing);
    ctx.setTransform(backing, 0, 0, backing, 0, 0);
    ctx.imageSmoothingEnabled = true;

    if (Math.abs(backing - artScale) > 0.01 || !mazeArt) {
      artScale = backing;
      buildMazeArt();
    }
  }

  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(layout, 120);
  });
  window.addEventListener('orientationchange', () => setTimeout(layout, 250));

  // ------------------------------------------------------------------ loop

  let last = performance.now();
  const MAX_STEP = 1 / 120;

  function frame(now) {
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.25) dt = 0.25;

    if (!game.paused) {
      let remaining = dt;
      while (remaining > 0) {
        const slice = Math.min(remaining, MAX_STEP);
        step(slice);
        remaining -= slice;
      }
    }

    render();
    syncHud(false);
    requestAnimationFrame(frame);
  }

  // ------------------------------------------------------------------ boot

  game.pellets = pelletTemplate.map((row) => [...row]);
  game.pelletsLeft = TOTAL_PELLETS;
  setMuteLabel(Sound.muted);
  layout();
  syncHud(true);
  showOverlay({
    title: 'Neon Chomp',
    text: 'Clear every pellet, chain them for a bigger multiplier, and dash out of trouble.',
    button: 'Play',
    hint: 'Arrows / WASD to move · Space to dash · P to pause',
    action: startGame,
  });
  requestAnimationFrame(frame);

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => { /* offline is best-effort */ });
    });
  }
})();
