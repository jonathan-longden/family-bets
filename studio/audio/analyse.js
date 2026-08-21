/* Take One — listening to the take before touching it.

   Everything the studio does automatically comes from this file: how loud the
   voice is, how loud the room is, where the tone sits against a normal voice
   curve, whether the s's are spitting, what notes were sung and in what key,
   and whether this is singing at all or just someone talking. process.js turns
   that report into settings; nothing here changes a sample. */

import { getFFT, hann, Biquad, dbToLin, linToDb, clamp, rms, peakOf } from './dsp.js';

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export const hzToMidi = (hz, a4 = 440) => 69 + 12 * Math.log2(Math.max(1e-6, hz) / a4);
export const midiToHz = (m, a4 = 440) => a4 * Math.pow(2, (m - 69) / 12);
export const centsBetween = (a, b) => 1200 * Math.log2(Math.max(1e-6, a) / Math.max(1e-6, b));

export function noteLabel(midi) {
  const m = Math.round(midi);
  return NOTE_NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
}

/* ───────────────────────── levels ───────────────────────── */

export function frameLevels(x, sr, hopMs = 20) {
  const hop = Math.max(64, Math.round(sr * hopMs / 1000));
  const win = hop * 2;
  const n = Math.max(1, Math.floor((x.length - win) / hop) + 1);
  const db = new Float32Array(n);
  for (let i = 0; i < n; i++) db[i] = linToDb(rms(x, i * hop, i * hop + win));
  return { hop, win, db };
}

/* The noise floor is the level the quiet bits sit at: sort the frames and
   look near the bottom, but not at the very bottom, which is usually a
   digital-silence gap rather than the sound of the room. */
export function noiseFloorDb(levels) {
  return levelPercentile(levels, 0.05, -90);
}

/* Where the voice itself sits. The distance between this and the floor is
   what tells the cleaner how much work there is to do. */
export function voiceLevelDb(levels) {
  return levelPercentile(levels, 0.9, -60);
}

function levelPercentile(levels, p, fallback) {
  const sorted = Float32Array.from(levels.db).filter(v => isFinite(v)).sort();
  if (!sorted.length) return fallback;
  return sorted[clamp(Math.floor(sorted.length * p), 0, sorted.length - 1)];
}

/* An average magnitude spectrum of the quietest frames — the fingerprint of
   the room, the laptop fan and the preamp, which the cleaner subtracts. */
export function noiseSpectrum(x, sr, fftSize = 1024) {
  const hop = fftSize / 2;
  const w = hann(fftSize);
  const fft = getFFT(fftSize);
  const re = new Float64Array(fftSize), im = new Float64Array(fftSize);
  const bins = fftSize / 2 + 1;

  const frames = [];
  for (let p = 0; p + fftSize <= x.length; p += hop) {
    frames.push({ p, e: rms(x, p, p + fftSize) });
  }
  if (!frames.length) return { mag: new Float32Array(bins).fill(1e-6), frames: 0 };

  frames.sort((a, b) => a.e - b.e);
  const lo = Math.floor(frames.length * 0.05);
  const hi = Math.max(lo + 1, Math.floor(frames.length * 0.25));
  const use = frames.slice(lo, hi);

  const mag = new Float32Array(bins);
  for (const f of use) {
    re.fill(0); im.fill(0);
    for (let i = 0; i < fftSize; i++) re[i] = x[f.p + i] * w[i];
    fft.forward(re, im);
    for (let k = 0; k < bins; k++) mag[k] += Math.hypot(re[k], im[k]);
  }
  for (let k = 0; k < bins; k++) mag[k] = Math.max(1e-9, mag[k] / use.length);
  return { mag, frames: use.length };
}

/* Average spectrum of the loud frames: what the voice itself sounds like. */
export function voiceSpectrum(x, sr, fftSize = 2048) {
  const hop = fftSize / 2;
  const w = hann(fftSize);
  const fft = getFFT(fftSize);
  const re = new Float64Array(fftSize), im = new Float64Array(fftSize);
  const bins = fftSize / 2 + 1;

  const frames = [];
  for (let p = 0; p + fftSize <= x.length; p += hop) frames.push({ p, e: rms(x, p, p + fftSize) });
  if (!frames.length) return new Float32Array(bins).fill(1e-9);
  frames.sort((a, b) => b.e - a.e);
  const use = frames.slice(0, Math.max(1, Math.floor(frames.length * 0.35)));

  const mag = new Float32Array(bins);
  for (const f of use) {
    re.fill(0); im.fill(0);
    for (let i = 0; i < fftSize; i++) re[i] = x[f.p + i] * w[i];
    fft.forward(re, im);
    for (let k = 0; k < bins; k++) mag[k] += re[k] * re[k] + im[k] * im[k];
  }
  for (let k = 0; k < bins; k++) mag[k] = Math.max(1e-12, mag[k] / use.length);
  return mag;
}

export function bandDb(power, sr, fftSize, lo, hi) {
  const k0 = Math.max(1, Math.round(lo * fftSize / sr));
  const k1 = Math.min(power.length - 1, Math.round(hi * fftSize / sr));
  let s = 0;
  for (let k = k0; k <= k1; k++) s += power[k];
  return 10 * Math.log10(Math.max(1e-12, s / Math.max(1, k1 - k0 + 1)));
}

/* ───────────────────────── loudness (ITU-R BS.1770) ─────────────────────────
   The number streaming services and broadcasters actually normalise to, so
   "professional level" can mean something instead of "as loud as possible". */

export function integratedLufs(x, sr) {
  const y = Float32Array.from(x);
  new Biquad().highshelfQ(sr, 1681.97, 3.99984, 0.7071752).process(y);
  new Biquad().highpass(sr, 38.13547, 0.5003271).process(y);

  const block = Math.round(sr * 0.4);
  const step = Math.round(block / 4);
  if (y.length < block) return { lufs: -70, blocks: 0 };

  const z = [];
  for (let p = 0; p + block <= y.length; p += step) {
    let s = 0;
    for (let i = p; i < p + block; i++) s += y[i] * y[i];
    z.push(s / block);
  }
  const loud = v => -0.691 + 10 * Math.log10(Math.max(1e-12, v));

  let kept = z.filter(v => loud(v) > -70);
  if (!kept.length) return { lufs: -70, blocks: z.length };
  const relative = loud(kept.reduce((a, b) => a + b, 0) / kept.length) - 10;
  const final = kept.filter(v => loud(v) > relative);
  const use = final.length ? final : kept;
  return { lufs: loud(use.reduce((a, b) => a + b, 0) / use.length), blocks: z.length };
}

/* Peaks between the samples are what clip a converter or an MP3 encoder, so
   look at a four-times-upsampled copy rather than the samples themselves. */
const TP_FIR = (() => {
  const taps = 33, phases = 4, h = [];
  for (let p = 1; p < phases; p++) {
    const arr = new Float64Array(taps);
    let sum = 0;
    for (let i = 0; i < taps; i++) {
      const t = i - (taps - 1) / 2 - p / phases;
      const s = Math.abs(t) < 1e-9 ? 1 : Math.sin(Math.PI * t) / (Math.PI * t);
      arr[i] = s * (0.54 - 0.46 * Math.cos(2 * Math.PI * i / (taps - 1)));
      sum += arr[i];
    }
    for (let i = 0; i < taps; i++) arr[i] /= sum;     // unity at DC
    h.push(arr);
  }
  return h;
})();

export function truePeakDb(x) {
  const taps = TP_FIR[0].length, half = (taps - 1) >> 1;
  let p = peakOf(x);
  for (let i = 0; i < x.length; i++) {
    for (let ph = 0; ph < TP_FIR.length; ph++) {
      const h = TP_FIR[ph];
      let s = 0;
      for (let k = 0; k < taps; k++) {
        const j = i + k - half;
        if (j >= 0 && j < x.length) s += x[j] * h[k];
      }
      const a = Math.abs(s);
      if (a > p) p = a;
    }
  }
  return linToDb(p);
}

/* Full-rate true peak on a long take is slow and the answer barely moves, so
   only the loudest stretches get looked at closely. */
export function truePeakDbFast(x, sr) {
  const win = Math.round(sr * 0.05);
  let best = [];
  for (let p = 0; p < x.length; p += win) {
    best.push({ p, e: peakOf(x.subarray(p, Math.min(x.length, p + win))) });
  }
  best.sort((a, b) => b.e - a.e);
  best = best.slice(0, 20);
  let db = -120;
  for (const b of best) {
    db = Math.max(db, truePeakDb(x.subarray(Math.max(0, b.p - 64), Math.min(x.length, b.p + win + 64))));
  }
  return db;
}

/* ───────────────────────── pitch (YIN) ─────────────────────────
   The difference function comes out of an FFT autocorrelation, which is what
   makes tracking a three-minute take take a moment rather than a minute. */

export function pitchTrack(x, sr, opts = {}) {
  const frame = opts.frame || 2048;
  const hop = opts.hop || 512;
  const minHz = opts.minHz || 60;
  const maxHz = opts.maxHz || 1200;
  const thresh = opts.threshold || 0.15;

  const n = 1 << Math.ceil(Math.log2(frame * 2));
  const fft = getFFT(n);
  const re = new Float64Array(n), im = new Float64Array(n);
  const cum = new Float64Array(frame + 1);
  const d = new Float64Array((frame >> 1) + 1);
  const dp = new Float64Array((frame >> 1) + 1);

  const tauMin = Math.max(2, Math.floor(sr / maxHz));
  const tauMax = Math.min(frame >> 1, Math.floor(sr / minHz));

  const count = Math.max(0, Math.floor((x.length - frame) / hop) + 1);
  const f0 = new Float32Array(count);
  const conf = new Float32Array(count);
  const level = new Float32Array(count);

  for (let f = 0; f < count; f++) {
    const p = f * hop;
    re.fill(0); im.fill(0);
    for (let i = 0; i < frame; i++) re[i] = x[p + i];
    level[f] = linToDb(rms(x, p, p + frame));

    cum[0] = 0;
    for (let i = 0; i < frame; i++) cum[i + 1] = cum[i] + re[i] * re[i];
    if (cum[frame] < 1e-10) { f0[f] = 0; conf[f] = 0; continue; }

    fft.forward(re, im);
    for (let i = 0; i < n; i++) { re[i] = re[i] * re[i] + im[i] * im[i]; im[i] = 0; }
    fft.inverse(re, im);                       // re[tau] is now the autocorrelation

    let running = 0;
    dp[0] = 1;
    for (let tau = 1; tau <= tauMax; tau++) {
      d[tau] = cum[frame - tau] + (cum[frame] - cum[tau]) - 2 * re[tau];
      if (d[tau] < 0) d[tau] = 0;
      running += d[tau];
      dp[tau] = running > 0 ? d[tau] * tau / running : 1;
    }

    let best = -1;
    for (let tau = tauMin; tau <= tauMax; tau++) {
      if (dp[tau] < thresh) {
        while (tau + 1 <= tauMax && dp[tau + 1] < dp[tau]) tau++;
        best = tau;
        break;
      }
    }
    if (best < 0) {
      let lo = Infinity;
      for (let tau = tauMin; tau <= tauMax; tau++) if (dp[tau] < lo) { lo = dp[tau]; best = tau; }
    }
    if (best <= tauMin || best >= tauMax) { f0[f] = 0; conf[f] = 0; continue; }

    // parabolic interpolation around the dip for sub-sample period accuracy
    const a = dp[best - 1], b = dp[best], c = dp[best + 1];
    const denom = a + c - 2 * b;
    const shift = denom !== 0 ? 0.5 * (a - c) / denom : 0;
    const tau = best + clamp(shift, -1, 1);

    f0[f] = sr / tau;
    conf[f] = clamp(1 - b, 0, 1);
  }

  fixOctaves(f0, conf);
  return { hop, frame, sr, f0, conf, level, count };
}

/* YIN sometimes lands an octave out for a frame or two. If a frame is half or
   double what both its neighbours say, it's the frame that's wrong. */
function fixOctaves(f0, conf) {
  for (let i = 1; i < f0.length - 1; i++) {
    const a = f0[i - 1], b = f0[i], c = f0[i + 1];
    if (!a || !b || !c) continue;
    const ref = (a + c) / 2;
    for (const mult of [2, 0.5]) {
      if (Math.abs(centsBetween(b * mult, ref)) < 60 && Math.abs(centsBetween(b, ref)) > 500) {
        f0[i] = b * mult;
        conf[i] *= 0.9;
        break;
      }
    }
  }
}

/* One frame, one answer — what the live tuner on the record screen runs on
   while you sing into it. Same YIN as the take gets, just not in bulk. */
export function detectPitch(frame, sr, opts = {}) {
  const t = pitchTrack(frame, sr, { ...opts, frame: frame.length, hop: frame.length });
  return { hz: t.f0[0] || 0, conf: t.conf[0] || 0, levelDb: t.level[0] };
}

/* ───────────────────────── what kind of take is this ───────────────────────── */

export function summarisePitch(track, floorDb, voiceDb) {
  const { f0, conf, level, hop, sr } = track;
  /* Loud enough to be the voice rather than the room — but a take recorded
     wall to wall with no gap in it has no "room" to measure, so the bar can
     never end up above the voice itself. */
  const minLevel = voiceDb == null ? floorDb + 10 : Math.min(floorDb + 8, voiceDb - 22);
  const voiced = [];
  for (let i = 0; i < f0.length; i++) {
    if (f0[i] > 0 && conf[i] > 0.55 && level[i] > minLevel) voiced.push(i);
  }
  const ratio = f0.length ? voiced.length / f0.length : 0;
  if (voiced.length < 4) {
    return { voicedRatio: ratio, medianHz: 0, rangeSemitones: 0, steadiness: 0, held: 0, offCents: 0, voiced };
  }

  const hz = voiced.map(i => f0[i]).sort((a, b) => a - b);
  const medianHz = hz[hz.length >> 1];
  const lo = hz[Math.floor(hz.length * 0.05)], hi = hz[Math.floor(hz.length * 0.95)];
  const rangeSemitones = Math.abs(centsBetween(hi, lo)) / 100;

  /* How much of the singing sits still: frames whose pitch stays inside a
     quarter tone for at least a tenth of a second. Speech almost never does;
     a held note is nothing but. */
  const frameMs = hop / sr * 1000;
  const need = Math.max(2, Math.round(120 / frameMs));
  let held = 0, run = 1;
  for (let k = 1; k < voiced.length; k++) {
    const cont = voiced[k] === voiced[k - 1] + 1 &&
      Math.abs(centsBetween(f0[voiced[k]], f0[voiced[k - 1]])) < 35;
    if (cont) { run++; } else { if (run >= need) held += run; run = 1; }
  }
  if (run >= need) held += run;

  let offSum = 0;
  for (const i of voiced) {
    const m = hzToMidi(f0[i]);
    offSum += Math.abs((m - Math.round(m)) * 100);
  }

  return {
    voicedRatio: ratio,
    medianHz,
    rangeSemitones,
    held: held / voiced.length,
    steadiness: held / voiced.length,
    offCents: offSum / voiced.length,
    voiced,
  };
}

const KRUMHANSL_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KRUMHANSL_MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

const MAJOR_MASK = [0, 2, 4, 5, 7, 9, 11];
const MINOR_MASK = [0, 2, 3, 5, 7, 8, 10];

export function detectKey(track, summary, a4 = 440) {
  const hist = new Float64Array(12);
  for (const i of summary.voiced) {
    const m = hzToMidi(track.f0[i], a4);
    const pc = ((Math.round(m) % 12) + 12) % 12;
    hist[pc] += track.conf[i];
  }
  const total = hist.reduce((a, b) => a + b, 0);
  if (total < 4) return { tonic: 0, mode: 'chromatic', name: 'chromatic', confidence: 0, mask: null };
  for (let i = 0; i < 12; i++) hist[i] /= total;

  const corr = (profile, rot) => {
    let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
    for (let i = 0; i < 12; i++) {
      const a = hist[(i + rot) % 12], b = profile[i];
      sx += a; sy += b; sxx += a * a; syy += b * b; sxy += a * b;
    }
    const num = 12 * sxy - sx * sy;
    const den = Math.sqrt((12 * sxx - sx * sx) * (12 * syy - sy * sy));
    return den > 0 ? num / den : 0;
  };

  let best = { score: -2, tonic: 0, mode: 'major' };
  for (let rot = 0; rot < 12; rot++) {
    const maj = corr(KRUMHANSL_MAJOR, rot);
    const min = corr(KRUMHANSL_MINOR, rot);
    if (maj > best.score) best = { score: maj, tonic: rot, mode: 'major' };
    if (min > best.score) best = { score: min, tonic: rot, mode: 'minor' };
  }

  const mask = (best.mode === 'major' ? MAJOR_MASK : MINOR_MASK).map(d => (d + best.tonic) % 12);
  return {
    tonic: best.tonic,
    mode: best.mode,
    name: NOTE_NAMES[best.tonic] + ' ' + best.mode,
    confidence: clamp(best.score, 0, 1),
    mask,
  };
}

export function scaleMask(tonic, mode) {
  if (mode === 'chromatic') return null;
  const base = mode === 'minor' ? MINOR_MASK : MAJOR_MASK;
  return base.map(d => (d + tonic) % 12);
}

/* ───────────────────────── mains hum ─────────────────────────
   A cheap USB mic near a laptop charger picks up 50 or 60 Hz and its
   harmonics. A steady tone that narrow is easy to see and easy to notch. */

export function detectHum(power, sr, fftSize) {
  const at = f => {
    const k = Math.round(f * fftSize / sr);
    if (k < 2 || k > power.length - 3) return null;
    const peak = Math.max(power[k - 1], power[k], power[k + 1]);
    let around = 0, n = 0;
    for (let j = k - 8; j <= k + 8; j++) {
      if (j < 1 || j >= power.length || Math.abs(j - k) <= 2) continue;
      around += power[j]; n++;
    }
    return n ? 10 * Math.log10(peak / Math.max(1e-12, around / n)) : null;
  };

  let best = null;
  for (const base of [50, 60]) {
    let score = 0, seen = 0;
    for (let h = 1; h <= 4; h++) {
      const v = at(base * h);
      if (v != null) { score += Math.max(0, v); seen++; }
    }
    const avg = seen ? score / seen : 0;
    if (!best || avg > best.excessDb) best = { hz: base, excessDb: avg };
  }
  return best && best.excessDb > 9 ? best : null;
}

/* ───────────────────────── the report ───────────────────────── */

export function analyseVoice(x, sr, opts = {}) {
  const a4 = opts.a4 || 440;
  const levels = frameLevels(x, sr);
  const floorDb = noiseFloorDb(levels);
  const voiceDb = voiceLevelDb(levels);
  const noise = noiseSpectrum(x, sr, 1024);
  const spec = voiceSpectrum(x, sr, 2048);

  const track = pitchTrack(x, sr, { minHz: opts.minHz || 60, maxHz: opts.maxHz || 1200 });
  const pitch = summarisePitch(track, floorDb, voiceDb);
  const key = detectKey(track, pitch, a4);

  const loud = integratedLufs(x, sr);
  const tp = truePeakDbFast(x, sr);
  const pk = peakOf(x);

  let clipped = 0;
  for (let i = 0; i < x.length; i++) if (Math.abs(x[i]) >= 0.9995) clipped++;

  const B = (lo, hi) => bandDb(spec, sr, 2048, lo, hi);
  const bands = {
    rumble: B(20, 80),
    low: B(80, 160),
    mud: B(180, 400),
    box: B(400, 800),
    mid: B(800, 2500),
    presence: B(2500, 5000),
    sibilance: B(5500, 9000),
    air: B(10000, Math.min(16000, sr / 2 - 500)),
  };

  /* A voice that sits right has its body a few dB above its presence and its
     s's below that again. Distances, not absolutes, so the mic's own level
     doesn't come into it. */
  const ref = bands.mid;
  const shape = {
    rumbleExcess: bands.rumble - ref + 6,
    mudExcess: bands.mud - ref - 2,
    boxExcess: bands.box - ref - 1,
    presenceDeficit: (ref - 8) - bands.presence,
    sibilanceExcess: bands.sibilance - (ref - 10),
    airDeficit: (ref - 20) - bands.air,
  };

  const snrDb = voiceDb - floorDb;
  const hum = detectHum(spec, sr, 2048);

  /* Singing holds notes and roams over a wider range than talking does.

     Three answers, not two. A held ballad is obviously sung and obviously
     wants tuning; a flat piece of narration obviously doesn't. In between sits
     everything sung fast — a busy melody, a rap, a line thrown away — which
     has notes in it even though it never sits still, and calling that "speech"
     is how a singer ends up with a take that was barely tuned at all. It gets
     tuned like singing; only the clearly spoken is left alone. */
  const sungScore =
    (pitch.steadiness > 0.45 ? 1 : pitch.steadiness / 0.45) * 0.55 +
    clamp(pitch.rangeSemitones / 9, 0, 1) * 0.25 +
    clamp(pitch.voicedRatio / 0.6, 0, 1) * 0.20;
  const material = sungScore > 0.55 ? 'sung' : sungScore > 0.28 ? 'melodic' : 'spoken';
  const hasNotes = pitch.voicedRatio > 0.12 && pitch.medianHz > 0;

  return {
    sampleRate: sr,
    samples: x.length,
    duration: x.length / sr,
    peak: pk,
    peakDb: linToDb(pk),
    truePeakDb: tp,
    lufs: loud.lufs,
    clippedFraction: clipped / Math.max(1, x.length),
    noiseFloorDb: floorDb,
    voiceLevelDb: voiceDb,
    snrDb,
    noise,
    spectrum: spec,
    bands,
    shape,
    hum,
    track,
    pitch,
    key,
    material,
    hasNotes,
    sungScore,
    a4,
  };
}
