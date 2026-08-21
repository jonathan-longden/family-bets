/* Take One — the studio chain.

   One pass down this file turns a raw microphone recording into a finished
   one: the room subtracted out, the tone put where a voice belongs, the s's
   held down, the level evened, the pitch nudged onto the notes that were
   meant, a little space around it, and the whole thing brought up to the
   loudness a streaming service or a broadcaster expects.

   Every stage is a plain function over a Float32Array. `autoSettings` is the
   part that decides — it reads the report from analyse.js and picks numbers
   the way an engineer would, which is what makes the app automatic. Every
   number it picks can be overridden by hand afterwards. */

import {
  Biquad, butterworthLowpass, runChain, getFFT, hann, dbToLin, linToDb,
  clamp, lerp, poleCoef, rms, peakOf, removeDc, convolve, makeRandom, applyGain,
} from './dsp.js';
import { hzToMidi, midiToHz, integratedLufs, truePeakDbFast, scaleMask, NOTE_NAMES } from './analyse.js';

/* ───────────────────────── deciding what to do ───────────────────────── */

/* How hard to tune, as three answers rather than a slider nobody should have
   to find. Locked is the default and does what the words say: every note put
   on the note, nothing left flat, no deadband and no half measures. Natural
   corrects the drift and leaves the performance — the scoops, the slides, the
   singer. Off is off. */
export const TUNE_MODES = {
  locked: {
    label: 'Locked to the note',
    blurb: 'Every note pinned. Nothing left flat.',
    strength: 100, speedMs: 10, deadband: 0, maxCents: 200, minConf: 0.5,
  },
  natural: {
    label: 'Natural',
    blurb: 'The drift corrected, the slides and the scoops left where you sang them.',
    strength: 72, speedMs: 90, deadband: 5, maxCents: 140, minConf: 0.62,
  },
  off: {
    label: 'Off',
    blurb: 'Your pitch, untouched.',
    strength: 0, speedMs: 90, deadband: 5, maxCents: 140, minConf: 0.62,
  },
};

export const TARGETS = {
  streaming: { label: 'Streaming (−14 LUFS)', lufs: -14, ceiling: -1 },
  podcast: { label: 'Podcast (−16 LUFS)', lufs: -16, ceiling: -1 },
  broadcast: { label: 'Broadcast (−23 LUFS)', lufs: -23, ceiling: -2 },
  loud: { label: 'Loud (−10 LUFS)', lufs: -10, ceiling: -1 },
};

export function autoSettings(report, wish = {}) {
  const sung = report.material === 'sung' || report.material === 'melodic';
  const s = report.shape;

  /* Cleaning: how much room there is to take out. A take with 45 dB between
     the voice and the room barely needs touching; one at 15 dB needs a lot,
     and will show it. */
  const snr = report.snrDb;
  const cleanup = clamp(Math.round(100 * (1 - (snr - 14) / 34)), 0, 92);

  /* The high pass goes under the lowest note that was actually sung, never
     into it. */
  const lowestHz = report.pitch.medianHz
    ? report.pitch.medianHz * Math.pow(2, -report.pitch.rangeSemitones / 24)
    : 110;
  const hp = clamp(Math.round((sung ? lowestHz * 0.78 : 92) + clamp(s.rumbleExcess, 0, 10) * 3), 55, 165);

  const eq = {
    hp,
    mud: -clamp(s.mudExcess, 0, 6.5),
    box: -clamp(s.boxExcess, 0, 4.5),
    presence: clamp(s.presenceDeficit, 0, 5.5),
    air: clamp(s.airDeficit, 0, 4.5),
  };

  const deEss = clamp(Math.round(clamp(s.sibilanceExcess + 2, 0, 12) / 12 * 100), 0, 100);

  /* Crest factor — the gap between the peaks and the average — says how much
     the level moves about, which is exactly what a compressor is for. */
  const crest = report.peakDb - report.lufs;
  const compression = clamp(Math.round((crest - 9) / 14 * 100), 15, 95);

  /* Anything with notes in it gets tuned, and gets tuned properly. Only a
     take that is plainly somebody talking is left alone — pitch correction on
     speech is what makes people sound like robots — and even that is overruled
     if the setting says to tune everything. */
  let tuneMode = wish.tuneMode && wish.tuneMode !== 'auto'
    ? wish.tuneMode
    : (report.hasNotes && report.material !== 'spoken' ? 'locked' : 'off');
  if (!TUNE_MODES[tuneMode]) tuneMode = 'locked';
  if (tuneMode !== 'off' && !report.hasNotes) tuneMode = 'off';
  const tuning = TUNE_MODES[tuneMode];

  /* Snapping to a key only helps while the key is right. Hard tuning to the
     wrong scale is worse than not tuning at all, so a shaky reading falls back
     to the nearest note of any kind. */
  const keyOk = report.key.confidence > 0.55 && report.key.mode !== 'chromatic';

  const target = TARGETS[wish.targetName || (sung ? 'streaming' : 'podcast')];

  return {
    version: 1,
    auto: true,
    material: report.material,
    hum: !!report.hum,
    humHz: report.hum ? report.hum.hz : 50,
    cleanup,
    gate: clamp(cleanup + (sung ? -10 : 5), 0, 90),
    eq,
    warmth: sung ? 12 : 20,
    presence: Math.round(eq.presence / 5.5 * 100),
    deEss,
    compression,
    tuneMode,
    tune: tuning.strength,
    tuneSpeed: tuning.speedMs,
    tuneDeadband: tuning.deadband,
    tuneMaxCents: tuning.maxCents,
    tuneMinConf: tuning.minConf,
    keyMode: keyOk ? report.key.mode : 'chromatic',
    keyTonic: keyOk ? report.key.tonic : 0,
    a4: report.a4 || 440,
    double: sung ? 22 : 0,
    space: sung ? 26 : 4,
    spaceSize: sung ? 45 : 25,
    saturation: sung ? 22 : 14,
    backingOn: true,
    backingDb: 0,          // a trim on top of the automatic balance
    duck: sung ? 22 : 45,  // music gets out of the way of a talker more than a singer
    targetName: wish.targetName || (sung ? 'streaming' : 'podcast'),
    targetLufs: target.lufs,
    ceilingDb: target.ceiling,
    ...wish.overrides,
  };
}

/* ───────────────────────── cleaning ─────────────────────────
   Spectral subtraction: every 21 ms slice of the take is compared with the
   fingerprint of the room taken from its own quiet moments, and each
   frequency is turned down by however much of it is room rather than voice.
   Turned down, not off — an aggressive subtraction leaves the warbling
   "musical noise" that gives away a cleaned-up recording, so there's a floor
   under it and the gains are smoothed across both frequency and time. */

export function denoise(x, sr, noiseMag, amount) {
  if (amount <= 0.01) return x;
  const N = 1024, hop = N / 4, bins = N / 2 + 1;
  const w = hann(N);
  const fft = getFFT(N);
  const re = new Float64Array(N), im = new Float64Array(N);
  const g = new Float64Array(bins), gs = new Float64Array(bins).fill(1), gf = new Float64Array(bins);

  const over = lerp(1.0, 2.8, amount);
  const floorG = lerp(1, 0.05, amount);
  const out = new Float32Array(x.length + N);
  const norm = 1 / 1.5;                   // hann squared, three-quarter overlap

  for (let p = 0; p + N <= x.length; p += hop) {
    for (let i = 0; i < N; i++) { re[i] = x[p + i] * w[i]; im[i] = 0; }
    fft.forward(re, im);

    for (let k = 0; k < bins; k++) {
      const mag = Math.hypot(re[k], im[k]);
      const snr = mag / (noiseMag[k] * over + 1e-9);
      g[k] = clamp(snr > 1 ? (snr - 1) / snr : 0, floorG, 1);
    }
    gf[0] = g[0];
    gf[bins - 1] = g[bins - 1];
    for (let k = 1; k < bins - 1; k++) gf[k] = (g[k - 1] + g[k] + g[k + 1]) / 3;
    for (let k = 0; k < bins; k++) {
      gs[k] = 0.55 * gs[k] + 0.45 * gf[k];
      const gain = gs[k];
      re[k] *= gain; im[k] *= gain;
      if (k > 0 && k < N / 2) { re[N - k] *= gain; im[N - k] *= gain; }
    }

    fft.inverse(re, im);
    for (let i = 0; i < N; i++) out[p + i] += re[i] * w[i] * norm;
  }
  return out.subarray(0, x.length);
}

/* A gate that leans rather than slams: below the threshold the signal is
   pushed down by a ratio and no further than `rangeDb`, so breaths stay in
   the take instead of being chopped out of it. */
export function expander(x, sr, opts) {
  const { thrDb, ratio = 2.5, rangeDb = 16, attackMs = 3, holdMs = 90, releaseMs = 180 } = opts;
  const atk = poleCoef(1, sr), rel = poleCoef(40, sr);
  const gOpen = poleCoef(attackMs, sr), gClose = poleCoef(releaseMs, sr);
  const hold = Math.round(holdMs * sr / 1000);
  let env = 0, gain = 1, held = 0;

  for (let i = 0; i < x.length; i++) {
    const a = Math.abs(x[i]);
    env = a > env ? atk * env + (1 - atk) * a : rel * env + (1 - rel) * a;
    const db = linToDb(env);
    let want = 1;
    if (db < thrDb) want = dbToLin(Math.max(-rangeDb, (db - thrDb) * (ratio - 1)));
    if (want >= gain) { held = hold; gain = gOpen * gain + (1 - gOpen) * want; }
    else if (held > 0) { held--; }
    else { gain = gClose * gain + (1 - gClose) * want; }
    x[i] *= gain;
  }
  return x;
}

/* ───────────────────────── tone ───────────────────────── */

export function equalise(x, sr, st) {
  const chain = [];
  if (st.hum) {
    for (let h = 1; h <= 4; h++) {
      const f = st.humHz * h;
      if (f < sr / 2 - 100) chain.push(new Biquad().notch(sr, f, 34));
    }
  }
  chain.push(...[0.54119610, 1.30656296].map(q => new Biquad().highpass(sr, st.eq.hp, q)));
  if (Math.abs(st.eq.mud) > 0.2) chain.push(new Biquad().peaking(sr, 260, 1.1, st.eq.mud));
  if (Math.abs(st.eq.box) > 0.2) chain.push(new Biquad().peaking(sr, 520, 1.3, st.eq.box));
  if (st.presence > 1) chain.push(new Biquad().peaking(sr, 3200, 0.85, clamp(st.presence / 100 * 5.5, 0, 6)));
  if (st.eq.air > 0.2) chain.push(new Biquad().highshelf(sr, 10500, st.eq.air));
  if (Math.abs(st.warmth) > 1) {
    chain.push(new Biquad().lowshelf(sr, 210, st.warmth / 100 * 4));
    if (st.warmth < 0) chain.push(new Biquad().highshelf(sr, 6500, -st.warmth / 100 * 2.5));
  }
  runChain(chain, x);
  return x;
}

/* De-esser. The band above the crossover is the take minus a Butterworth low
   pass of itself, so putting the two back together with the gain at one is
   bit-for-bit the signal that went in — no phase shift smeared across the
   whole voice for the sake of a few s's. */
export function deEsser(x, sr, opts) {
  const { fc = 6200, amount, ratio = 4 } = opts;
  if (amount <= 1) return x;

  const low = Float32Array.from(x);
  runChain(butterworthLowpass(sr, fc), low);
  const high = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) high[i] = x[i] - low[i];

  const atk = poleCoef(0.6, sr), rel = poleCoef(35, sr);
  const env = new Float32Array(x.length);
  let e = 0;
  for (let i = 0; i < x.length; i++) {
    const a = Math.abs(high[i]);
    e = a > e ? atk * e + (1 - atk) * a : rel * e + (1 - rel) * a;
    env[i] = e;
  }

  /* Only the loudest few per cent of the sibilant band should ever be caught,
     otherwise every consonant goes dull. */
  const sample = [];
  for (let i = 0; i < env.length; i += 37) if (env[i] > 1e-5) sample.push(env[i]);
  if (!sample.length) return x;
  sample.sort((a, b) => a - b);
  const p97 = sample[Math.min(sample.length - 1, Math.floor(sample.length * 0.97))];
  const thrDb = linToDb(p97) - lerp(2, 9, amount / 100);
  const maxCut = lerp(2, 12, amount / 100);

  const gAtk = poleCoef(0.5, sr), gRel = poleCoef(45, sr);
  let gain = 1;
  for (let i = 0; i < x.length; i++) {
    const over = linToDb(env[i]) - thrDb;
    const want = over > 0 ? dbToLin(Math.max(-maxCut, -over * (1 - 1 / ratio))) : 1;
    const c = want < gain ? gAtk : gRel;
    gain = c * gain + (1 - c) * want;
    x[i] = low[i] + high[i] * gain;
  }
  return x;
}

/* ───────────────────────── level ───────────────────────── */

export function compress(x, sr, opts) {
  const { thrDb, ratio, attackMs, releaseMs, kneeDb = 6, makeupDb = 0 } = opts;
  const atk = poleCoef(attackMs, sr), rel = poleCoef(releaseMs, sr);
  const makeup = dbToLin(makeupDb);
  let env = 0, worst = 0;

  for (let i = 0; i < x.length; i++) {
    const a = Math.abs(x[i]);
    env = a > env ? atk * env + (1 - atk) * a : rel * env + (1 - rel) * a;
    const over = linToDb(env) - thrDb;
    let gr = 0;
    if (over >= kneeDb / 2) gr = -over * (1 - 1 / ratio);
    else if (over > -kneeDb / 2) {
      const t = over + kneeDb / 2;
      gr = -(1 - 1 / ratio) * t * t / (2 * kneeDb);
    }
    if (gr < worst) worst = gr;
    x[i] *= dbToLin(gr) * makeup;
  }
  return { x, maxReductionDb: -worst };
}

/* A touch of tape: soft saturation adds the harmonics that make a voice
   sound present on a small speaker, and quietly stops it poking through the
   limiter later. */
export function saturate(x, amount) {
  if (amount <= 0.5) return x;
  const drive = 1 + amount / 100 * 2.2;
  const comp = Math.tanh(drive) / drive;
  for (let i = 0; i < x.length; i++) x[i] = Math.tanh(x[i] * drive) / drive / comp * 0.995;
  return x;
}

/* ───────────────────────── pitch ─────────────────────────
   Time-domain PSOLA: cut the voice into grains, one per glottal pulse, then
   lay them back down at the spacing the corrected pitch asks for. Because the
   grains themselves aren't stretched, the formants — the part of the sound
   that says whose voice it is — come through untouched. Which is the
   difference between tuning someone and turning them into a chipmunk. */

function polarityOf(x) {
  let s = 0;
  for (let i = 0; i < x.length; i += 7) { const v = x[i]; s += v * v * v; }
  return s >= 0 ? 1 : -1;
}

function f0Reader(track) {
  const { f0, conf, hop, frame } = track;
  const offset = frame / 2;
  return t => {
    const f = (t - offset) / hop;
    const i = Math.floor(f);
    if (i < 0) return { hz: f0[0] || 0, conf: conf[0] || 0 };
    if (i >= f0.length - 1) return { hz: f0[f0.length - 1] || 0, conf: conf[conf.length - 1] || 0 };
    const a = f0[i], b = f0[i + 1], u = f - i;
    const c = conf[i] * (1 - u) + conf[i + 1] * u;
    if (!a || !b) return { hz: a || b || 0, conf: c };
    return { hz: a * (1 - u) + b * u, conf: c };
  };
}

function snapMidi(midi, mask) {
  if (!mask) return Math.round(midi);
  let best = Math.round(midi), bestD = Infinity;
  for (let cand = Math.floor(midi) - 1; cand <= Math.ceil(midi) + 1; cand++) {
    const pc = ((cand % 12) + 12) % 12;
    if (!mask.includes(pc)) continue;
    const d = Math.abs(cand - midi);
    if (d < bestD) { bestD = d; best = cand; }
  }
  return best;
}

export function tune(x, sr, track, opts) {
  const strength = clamp(opts.strength, 0, 1);
  if (strength <= 0.01) return { x, movedCents: 0, notes: 0 };

  const mask = opts.mask || null;
  const a4 = opts.a4 || 440;
  const maxCents = opts.maxCents || 140;
  const deadband = opts.deadband == null ? 7 : opts.deadband;
  const minConf = opts.minConf == null ? 0.62 : opts.minConf;

  const read = f0Reader(track);
  const pol = polarityOf(x);
  const lp = Float32Array.from(x);
  runChain(butterworthLowpass(sr, 900), lp);

  /* 1. Pitch marks: one per period, sitting on the loudest point of each
        glottal pulse so every grain is cut at the same place in the cycle. */
  const marks = [];
  let t = 0;
  while (t < x.length - 2) {
    const { hz, conf } = read(t);
    if (!hz || conf < minConf) { t += Math.round(sr * 0.004); continue; }
    const T = sr / hz;
    const first = !marks.length || t - marks[marks.length - 1].t > 2 * T;
    const lo = Math.round(t);
    const hi = Math.min(x.length - 1, Math.round(t + T * (first ? 1 : 0.5)));
    if (hi <= lo) break;
    let bi = lo, bv = -Infinity;
    for (let i = lo; i <= hi; i++) { const v = lp[i] * pol; if (v > bv) { bv = v; bi = i; } }
    marks.push({ t: bi, T, hz });
    t = bi + Math.max(2, Math.round(T * 0.75));
  }
  if (marks.length < 4) return { x, movedCents: 0, notes: 0 };

  /* 2. Voiced stretches, so unvoiced sound is never rebuilt out of grains. */
  const voiced = new Uint8Array(x.length);
  for (let i = 0; i < x.length; i += 32) {
    const r = read(i);
    const on = r.hz > 0 && r.conf >= minConf ? 1 : 0;
    for (let j = i; j < Math.min(x.length, i + 32); j++) voiced[j] = on;
  }

  const out = new Float32Array(x.length);
  const wsum = new Float32Array(x.length);

  let mi = 0;
  let tOut = marks[0].t;
  let smoothedErr = 0;
  let moved = 0, movedN = 0, corrections = 0, lastNote = null;

  while (tOut < x.length) {
    while (mi < marks.length - 1 && Math.abs(marks[mi + 1].t - tOut) < Math.abs(marks[mi].t - tOut)) mi++;
    const m = marks[mi];
    const here = read(tOut);

    if (!here.hz || here.conf < minConf) {
      /* Unvoiced: hand back to the original signal and pick up again at the
         next mark that has a pitch under it. */
      let jump = tOut + Math.round(sr * 0.004);
      while (jump < x.length) {
        const r = read(jump);
        if (r.hz && r.conf >= minConf) break;
        jump += Math.round(sr * 0.004);
      }
      tOut = jump;
      smoothedErr = 0;
      while (mi < marks.length - 1 && marks[mi].t < tOut) mi++;
      continue;
    }

    const midi = hzToMidi(here.hz, a4);
    const target = snapMidi(midi, mask);
    let errCents = (target - midi) * 100;
    if (Math.abs(errCents) < deadband) errCents = 0;
    else errCents -= Math.sign(errCents) * deadband;
    errCents = clamp(errCents, -maxCents, maxCents);

    const T = sr / here.hz;
    const c = poleCoef(opts.speedMs || 60, sr / T);      // one pole per period
    smoothedErr = c * smoothedErr + (1 - c) * errCents;
    const applied = smoothedErr * strength;
    const ratio = Math.pow(2, applied / 1200);

    if (Math.abs(applied) > 1) { moved += Math.abs(applied); movedN++; }
    if (target !== lastNote) { corrections++; lastNote = target; }

    const L = Math.max(16, Math.round(2 * m.T));
    const w = hann(L);
    const half = L >> 1;
    const srcStart = m.t - half, dstStart = Math.round(tOut) - half;
    for (let j = 0; j < L; j++) {
      const si = srcStart + j, di = dstStart + j;
      if (si < 0 || si >= x.length || di < 0 || di >= x.length) continue;
      if (!voiced[di]) continue;
      out[di] += x[si] * w[j];
      wsum[di] += w[j];
    }

    tOut += Math.max(2, T / ratio);
  }

  /* 3. Normalise by how much window landed on each sample — with the grain
        spacing changed, the overlaps no longer add to exactly one. */
  const res = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) {
    if (!voiced[i] || wsum[i] < 0.28) { res[i] = x[i]; continue; }
    res[i] = out[i] / wsum[i];
  }

  /* 4. Short crossfades wherever the tuned signal takes over from the
        original, so the joins don't click. */
  const fade = Math.max(8, Math.round(sr * 0.004));
  for (let i = 1; i < x.length; i++) {
    const wasOn = voiced[i - 1] && wsum[i - 1] >= 0.28;
    const isOn = voiced[i] && wsum[i] >= 0.28;
    if (wasOn === isOn) continue;
    for (let j = 0; j < fade; j++) {
      const k = i + (isOn ? j : j - fade);
      if (k < 0 || k >= x.length) continue;
      const u = (j + 0.5) / fade;
      const a = isOn ? 1 - u : u;
      res[k] = x[k] * a + res[k] * (1 - a);
    }
  }

  return { x: res, movedCents: movedN ? moved / movedN : 0, notes: corrections };
}

/* ───────────────────────── space ───────────────────────── */

function makeIR(sr, sizePct, seed) {
  const decay = lerp(0.45, 2.6, sizePct / 100);
  const len = Math.max(64, Math.round(sr * (decay + 0.05)));
  const pre = Math.round(sr * lerp(0.010, 0.035, sizePct / 100));
  const rnd = makeRandom(seed);
  const ir = new Float32Array(len + pre);
  const k = 6.9 / decay;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    ir[i + pre] = (rnd() * 2 - 1) * Math.exp(-k * t);
  }
  // a few early reflections give the tail somewhere to have happened
  for (const [ms, g] of [[7, 0.5], [11, -0.38], [19, 0.3], [29, -0.22]]) {
    const i = pre + Math.round(sr * ms / 1000);
    if (i < ir.length) ir[i] += g;
  }
  runChain(butterworthLowpass(sr, lerp(4200, 7600, sizePct / 100)), ir);
  new Biquad().highpass(sr, 320).process(ir);
  let e = 0;
  for (let i = 0; i < ir.length; i++) e += ir[i] * ir[i];
  applyGain(ir, 1 / Math.sqrt(Math.max(1e-9, e)));
  return ir;
}

/* Two slow, slightly different delays either side of the middle: the oldest
   trick there is for making one voice sound like it means it. */
export function doubler(x, sr, amount) {
  const depth = amount / 100;
  const max = Math.round(sr * 0.045);
  const l = new Float32Array(x.length), r = new Float32Array(x.length);
  const voices = [
    { base: 0.017, rate: 0.11, dev: 0.0022, out: l, phase: 0 },
    { base: 0.023, rate: 0.13, dev: 0.0029, out: r, phase: 1.7 },
  ];
  for (const v of voices) {
    for (let i = 0; i < x.length; i++) {
      const mod = v.base + v.dev * Math.sin(2 * Math.PI * v.rate * i / sr + v.phase);
      const d = mod * sr;
      const i0 = i - Math.floor(d), frac = d - Math.floor(d);
      const a = i0 >= 0 && i0 < x.length ? x[i0] : 0;
      const b = i0 - 1 >= 0 && i0 - 1 < x.length ? x[i0 - 1] : 0;
      v.out[i] = a * (1 - frac) + b * frac;
    }
  }
  applyGain(l, depth * 0.6); applyGain(r, depth * 0.6);
  return { l, r, max };
}

/* ───────────────────────── the last stage ───────────────────────── */

/* Look-ahead brickwall: the loudest sample in the next three milliseconds
   decides the gain now, so nothing ever gets over the ceiling and nothing
   audibly ducks to keep it there. */
export function limit(chans, sr, ceilingDb, lookaheadMs = 3, releaseMs = 70) {
  const ceiling = dbToLin(ceilingDb);
  const la = Math.max(4, Math.round(sr * lookaheadMs / 1000));
  const n = chans[0].length;

  const mono = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let m = 0;
    for (const c of chans) m = Math.max(m, Math.abs(c[i]));
    mono[i] = m;
  }

  // sliding window maximum, monotonic deque, O(n)
  const need = new Float32Array(n);
  const dq = new Int32Array(n + 1);
  let head = 0, tail = 0;
  for (let i = 0; i < n + la; i++) {
    if (i < n) {
      while (tail > head && mono[dq[tail - 1]] <= mono[i]) tail--;
      dq[tail++] = i;
    }
    const out = i - la;
    if (out >= 0) {
      while (tail > head && dq[head] < out) head++;
      need[out] = tail > head ? mono[dq[head]] : 0;
    }
  }

  const rel = poleCoef(releaseMs, sr);
  const delay = chans.map(() => new Float32Array(la));
  let gain = 1, minGain = 1;
  const out = chans.map(() => new Float32Array(n));

  for (let i = 0; i < n; i++) {
    const want = need[i] > ceiling ? ceiling / need[i] : 1;
    gain = want < gain ? want : rel * gain + (1 - rel) * want;
    if (gain < minGain) minGain = gain;
    for (let c = 0; c < chans.length; c++) {
      const d = delay[c];
      const held = d[i % la];
      d[i % la] = chans[c][i];
      out[c][i] = clamp(held * gain, -ceiling, ceiling);
    }
  }
  return { chans: out, maxReductionDb: -linToDb(minGain) };
}

/* ───────────────────────── backing ─────────────────────────
   The backing arrives already lined up with the take — sample zero of one is
   sample zero of the other — so all that happens here is balance: how loud the
   music sits under the voice, and how far it steps back while the voice is
   actually singing.

   The balance is set from the loudness of both, not from a fader position, so
   a quiet phone recording and a mastered instrumental still end up in the
   right relationship to each other. */
export function mixBacking(chans, sr, backing, opts) {
  const { trimDb = 0, duck = 30, vocalLufs } = opts;
  const bl = integratedLufs(backing[0], sr).lufs;

  /* Four decibels under the voice is where a demo mix wants the music: close
     enough to carry it, far enough that every word survives. */
  const wanted = (isFinite(vocalLufs) ? vocalLufs : -16) - 4;
  const gain = dbToLin(clamp(wanted - bl, -40, 24) + trimDb);

  const n = chans[0].length;
  const duckDb = duck / 100 * 12;
  const atk = poleCoef(12, sr), rel = poleCoef(320, sr);

  /* Sidechain: the voice's own envelope decides how far the music drops. */
  const lead = chans[0];
  let env = 0;
  const thrDb = (isFinite(vocalLufs) ? vocalLufs : -16) - 12;

  for (let i = 0; i < n; i++) {
    const a = Math.abs(lead[i]);
    env = a > env ? atk * env + (1 - atk) * a : rel * env + (1 - rel) * a;
    const over = linToDb(env) - thrDb;
    const g = gain * dbToLin(-duckDb * clamp(over / 10, 0, 1));
    for (let c = 0; c < chans.length; c++) {
      const src = backing[Math.min(c, backing.length - 1)];
      if (src) chans[c][i] += src[i] * g;
    }
  }
  return { gain, backingLufs: bl };
}

/* ───────────────────────── the whole pass ───────────────────────── */

export function render(input, sr, st, report, onProgress = () => {}, backing = null) {
  const notes = [];
  const step = (p, what) => onProgress(p, what);

  let x = Float32Array.from(input);
  removeDc(x);
  step(0.05, 'cleaning up the room');

  if (st.cleanup > 1 && report.noise) {
    x = Float32Array.from(denoise(x, sr, report.noise.mag, st.cleanup / 100));
    notes.push({ key: 'clean', label: 'Room taken out', detail: Math.round(st.cleanup) + '%' });
  }
  if (st.hum) notes.push({ key: 'hum', label: 'Mains hum notched', detail: st.humHz + ' Hz' });

  step(0.22, 'shaping the tone');
  equalise(x, sr, st);

  if (st.gate > 1) {
    expander(x, sr, {
      thrDb: report.noiseFloorDb + lerp(4, 14, st.gate / 100),
      ratio: lerp(1.6, 3.2, st.gate / 100),
      rangeDb: lerp(6, 20, st.gate / 100),
    });
  }

  step(0.34, 'holding down the s sounds');
  if (st.deEss > 1) {
    const cut = deEsser(x, sr, { fc: 6200, amount: st.deEss });
    notes.push({ key: 'deess', label: 'Sibilance tamed', detail: 'up to ' + lerp(2, 12, st.deEss / 100).toFixed(1) + ' dB' });
    x = cut;
  }

  step(0.44, 'evening out the level');
  const crest = report.peakDb - report.lufs;
  const amount = st.compression / 100;
  const c1 = compress(x, sr, {
    thrDb: report.lufs + lerp(2, -6, amount),
    ratio: lerp(1.6, 3.4, amount),
    attackMs: 18, releaseMs: 240, kneeDb: 8,
    makeupDb: lerp(0, 4.5, amount),
  });
  const c2 = compress(c1.x, sr, {
    thrDb: report.lufs + lerp(9, 2, amount),
    ratio: lerp(2.5, 6, amount),
    attackMs: 4, releaseMs: 90, kneeDb: 4,
  });
  x = c2.x;
  notes.push({
    key: 'level', label: 'Level evened out',
    detail: (c1.maxReductionDb + c2.maxReductionDb).toFixed(1) + ' dB at the loudest',
  });

  step(0.6, 'putting the notes back where they belong');
  if (st.tune > 1 && report.track) {
    const mask = st.keyMode === 'chromatic' ? null : scaleMask(st.keyTonic, st.keyMode);
    const t = tune(x, sr, report.track, {
      strength: st.tune / 100,
      speedMs: st.tuneSpeed,
      deadband: st.tuneDeadband,
      maxCents: st.tuneMaxCents,
      minConf: st.tuneMinConf,
      mask, a4: st.a4,
    });
    x = t.x;
    const where = st.keyMode === 'chromatic' ? 'the nearest notes' : NOTE_NAMES[st.keyTonic] + ' ' + st.keyMode;
    notes.push({
      key: 'tune',
      label: (st.tuneMode === 'locked' ? 'Locked to ' : 'Tuned to ') + where,
      detail: t.movedCents >= 1
        ? 'moved ' + Math.round(t.movedCents) + ' cents on average, over ' + t.notes + ' notes'
        : 'you were already on it',
    });
  }

  step(0.78, 'adding a little air');
  saturate(x, st.saturation);

  let L = Float32Array.from(x), R = null;
  if (st.double > 1) {
    const d = doubler(x, sr, st.double);
    R = Float32Array.from(x);
    for (let i = 0; i < x.length; i++) { L[i] += d.l[i]; R[i] += d.r[i]; }
    notes.push({ key: 'double', label: 'Doubled', detail: st.double + '% wide' });
  }

  if (st.space > 1) {
    const wet = st.space / 100 * 0.45;
    const irL = makeIR(sr, st.spaceSize, 0x51ee11);
    const irR = makeIR(sr, st.spaceSize, 0x9a7c3f);
    const wl = convolve(x, irL, false), wr = convolve(x, irR, false);
    if (!R) R = Float32Array.from(L);
    for (let i = 0; i < x.length; i++) { L[i] += wl[i] * wet; R[i] += wr[i] * wet; }
    notes.push({ key: 'space', label: 'Room added', detail: st.space + '% ' + (st.spaceSize > 60 ? 'hall' : st.spaceSize > 30 ? 'room' : 'booth') });
  }

  let chans = R ? [L, R] : [L];
  const measure = ch => integratedLufs(ch[0], sr).lufs;

  /* The voice on its own, measured before anything joins it: the A/B between
     raw and finished is only a fair fight if both sides are the same loudness,
     and once there's music in the mix the mix's own number can't say that. */
  const vocalLufs = measure(chans);

  let backingGain = 0;
  if (backing && backing.length && st.backingOn) {
    step(0.86, 'balancing the backing');
    if (chans.length === 1 && backing.length > 1) chans = [chans[0], Float32Array.from(chans[0])];
    const mixed = mixBacking(chans, sr, backing, {
      trimDb: st.backingDb, duck: st.duck, vocalLufs,
    });
    backingGain = mixed.gain;
    notes.push({
      key: 'backing', label: 'Backing mixed in',
      detail: (st.backingDb ? (st.backingDb > 0 ? '+' : '') + st.backingDb.toFixed(1) + ' dB, ' : '') +
        'ducking ' + (st.duck / 100 * 12).toFixed(1) + ' dB under the voice',
    });
  }

  step(0.9, 'setting the loudness');

  /* Aim at the target, let the limiter have the last word, then check what
     came out and nudge once — a limiter always costs a little loudness. */
  let normalise = 1;
  for (let pass = 0; pass < 2; pass++) {
    const now = measure(chans);
    const g = dbToLin(clamp(st.targetLufs - now, -24, 24));
    normalise *= g;
    for (const c of chans) applyGain(c, g);
    chans = limit(chans, sr, st.ceilingDb).chans;
  }

  const outLufs = measure(chans);
  const outTp = truePeakDbFast(chans[0], sr);
  notes.push({
    key: 'loudness', label: 'Loudness set',
    detail: outLufs.toFixed(1) + ' LUFS, peaks at ' + outTp.toFixed(1) + ' dB',
  });

  step(1, 'done');
  return {
    channels: chans,
    sampleRate: sr,
    lufs: outLufs,
    truePeakDb: outTp,
    vocalLufs,
    /* What the backing and the raw voice need to be played at for a
       side-by-side with this mix to mean anything. */
    normaliseGain: normalise,
    backingGain: backingGain * normalise,
    notes,
  };
}
