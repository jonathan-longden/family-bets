/* Take One — the pile of signal-processing parts everything else is built out
   of: biquad filters, an FFT, windows, envelopes and unit conversions.

   Plain functions over Float32Array with no dependencies, so the identical
   code runs inside the worker that renders a take and on the page that draws
   the meters. Nothing here knows what a voice is; that lives in analyse.js. */

export const dbToLin = db => Math.pow(10, db / 20);
export const linToDb = v => 20 * Math.log10(Math.max(1e-12, v));
export const clamp = (n, lo, hi) => (n < lo ? lo : n > hi ? hi : n);
export const lerp = (a, b, t) => a + (b - a) * t;

/* Time constant for a one-pole follower: the coefficient that gets you 63% of
   the way to a new value in `ms` milliseconds. */
export const poleCoef = (ms, sr) => (ms <= 0 ? 0 : Math.exp(-1 / (Math.max(1e-4, ms) * 0.001 * sr)));

export function rms(x, from = 0, to = x.length) {
  let s = 0;
  for (let i = from; i < to; i++) s += x[i] * x[i];
  return Math.sqrt(s / Math.max(1, to - from));
}

export function peakOf(x) {
  let p = 0;
  for (let i = 0; i < x.length; i++) { const a = Math.abs(x[i]); if (a > p) p = a; }
  return p;
}

export function copyOf(x) { return Float32Array.from(x); }

export function removeDc(x) {
  let sum = 0;
  for (let i = 0; i < x.length; i++) sum += x[i];
  const mean = sum / Math.max(1, x.length);
  if (Math.abs(mean) < 1e-7) return x;
  for (let i = 0; i < x.length; i++) x[i] -= mean;
  return x;
}

/* ───────────────────────── biquads ─────────────────────────
   Robert Bristow-Johnson's cookbook coefficients, run as a transposed
   direct form II so the state is two numbers and updating coefficients
   mid-stream (which the de-esser does, every 32 samples) doesn't thump. */

export class Biquad {
  constructor() { this.b0 = 1; this.b1 = 0; this.b2 = 0; this.a1 = 0; this.a2 = 0; this.z1 = 0; this.z2 = 0; }

  reset() { this.z1 = 0; this.z2 = 0; return this; }

  set(b0, b1, b2, a0, a1, a2) {
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0;
    this.a1 = a1 / a0; this.a2 = a2 / a0;
    return this;
  }

  lowpass(sr, f, q = Math.SQRT1_2) {
    const w = 2 * Math.PI * clamp(f, 10, sr * 0.49) / sr, c = Math.cos(w), al = Math.sin(w) / (2 * q);
    return this.set((1 - c) / 2, 1 - c, (1 - c) / 2, 1 + al, -2 * c, 1 - al);
  }

  highpass(sr, f, q = Math.SQRT1_2) {
    const w = 2 * Math.PI * clamp(f, 10, sr * 0.49) / sr, c = Math.cos(w), al = Math.sin(w) / (2 * q);
    return this.set((1 + c) / 2, -(1 + c), (1 + c) / 2, 1 + al, -2 * c, 1 - al);
  }

  bandpass(sr, f, q = 1) {
    const w = 2 * Math.PI * clamp(f, 10, sr * 0.49) / sr, c = Math.cos(w), al = Math.sin(w) / (2 * q);
    return this.set(al, 0, -al, 1 + al, -2 * c, 1 - al);
  }

  peaking(sr, f, q, gainDb) {
    const A = Math.pow(10, gainDb / 40);
    const w = 2 * Math.PI * clamp(f, 10, sr * 0.49) / sr, c = Math.cos(w), al = Math.sin(w) / (2 * q);
    return this.set(1 + al * A, -2 * c, 1 - al * A, 1 + al / A, -2 * c, 1 - al / A);
  }

  lowshelf(sr, f, gainDb, s = 0.9) {
    const A = Math.pow(10, gainDb / 40);
    const w = 2 * Math.PI * clamp(f, 10, sr * 0.49) / sr, c = Math.cos(w), sn = Math.sin(w);
    const al = sn / 2 * Math.sqrt((A + 1 / A) * (1 / s - 1) + 2), t = 2 * Math.sqrt(A) * al;
    return this.set(
      A * ((A + 1) - (A - 1) * c + t), 2 * A * ((A - 1) - (A + 1) * c), A * ((A + 1) - (A - 1) * c - t),
      (A + 1) + (A - 1) * c + t, -2 * ((A - 1) + (A + 1) * c), (A + 1) + (A - 1) * c - t);
  }

  highshelf(sr, f, gainDb, s = 0.9) {
    const A = Math.pow(10, gainDb / 40);
    const w = 2 * Math.PI * clamp(f, 10, sr * 0.49) / sr, c = Math.cos(w), sn = Math.sin(w);
    const al = sn / 2 * Math.sqrt((A + 1 / A) * (1 / s - 1) + 2), t = 2 * Math.sqrt(A) * al;
    return this.set(
      A * ((A + 1) + (A - 1) * c + t), -2 * A * ((A - 1) + (A + 1) * c), A * ((A + 1) + (A - 1) * c - t),
      (A + 1) - (A - 1) * c + t, 2 * ((A - 1) - (A + 1) * c), (A + 1) - (A - 1) * c - t);
  }

  /* Shelves the way the loudness spec writes them: Q instead of slope. */
  lowshelfQ(sr, f, gainDb, q) {
    const A = Math.pow(10, gainDb / 40);
    const w = 2 * Math.PI * clamp(f, 10, sr * 0.49) / sr, c = Math.cos(w);
    const al = Math.sin(w) / (2 * q), t = 2 * Math.sqrt(A) * al;
    return this.set(
      A * ((A + 1) - (A - 1) * c + t), 2 * A * ((A - 1) - (A + 1) * c), A * ((A + 1) - (A - 1) * c - t),
      (A + 1) + (A - 1) * c + t, -2 * ((A - 1) + (A + 1) * c), (A + 1) + (A - 1) * c - t);
  }

  highshelfQ(sr, f, gainDb, q) {
    const A = Math.pow(10, gainDb / 40);
    const w = 2 * Math.PI * clamp(f, 10, sr * 0.49) / sr, c = Math.cos(w);
    const al = Math.sin(w) / (2 * q), t = 2 * Math.sqrt(A) * al;
    return this.set(
      A * ((A + 1) + (A - 1) * c + t), -2 * A * ((A - 1) + (A + 1) * c), A * ((A + 1) + (A - 1) * c - t),
      (A + 1) - (A - 1) * c + t, 2 * ((A - 1) - (A + 1) * c), (A + 1) - (A - 1) * c - t);
  }

  notch(sr, f, q = 30) {
    const w = 2 * Math.PI * clamp(f, 10, sr * 0.49) / sr, c = Math.cos(w), al = Math.sin(w) / (2 * q);
    return this.set(1, -2 * c, 1, 1 + al, -2 * c, 1 - al);
  }

  tick(x) {
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }

  process(buf, out = buf) {
    for (let i = 0; i < buf.length; i++) out[i] = this.tick(buf[i]);
    return out;
  }
}

/* Two cascaded biquads make a fourth-order Butterworth, which is what a
   crossover wants: 24 dB an octave and no ripple. */
export const BUTTER_Q4 = [0.54119610, 1.30656296];

export function butterworthLowpass(sr, f) {
  return BUTTER_Q4.map(q => new Biquad().lowpass(sr, f, q));
}

export function butterworthHighpass(sr, f) {
  return BUTTER_Q4.map(q => new Biquad().highpass(sr, f, q));
}

export function runChain(chain, buf) {
  for (const f of chain) f.process(buf);
  return buf;
}

/* ───────────────────────── FFT ─────────────────────────
   Iterative radix-2, tables built once per size. Both halves of every
   transform live in caller-owned arrays so the hot loops never allocate. */

export class FFT {
  constructor(n) {
    if ((n & (n - 1)) !== 0) throw new Error('FFT size must be a power of two');
    this.n = n;
    this.cos = new Float64Array(n / 2);
    this.sin = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) {
      this.cos[i] = Math.cos(2 * Math.PI * i / n);
      this.sin[i] = Math.sin(2 * Math.PI * i / n);
    }
  }

  forward(re, im) {
    const n = this.n;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        let t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1, step = n / size;
      for (let i = 0; i < n; i += size) {
        for (let j = i, k = 0; j < i + half; j++, k += step) {
          const l = j + half;
          const tre = re[l] * this.cos[k] + im[l] * this.sin[k];
          const tim = -re[l] * this.sin[k] + im[l] * this.cos[k];
          re[l] = re[j] - tre; im[l] = im[j] - tim;
          re[j] += tre; im[j] += tim;
        }
      }
    }
  }

  /* Conjugate, forward, conjugate, scale — the usual trick. */
  inverse(re, im) {
    this.forward(im, re);
    const n = this.n, inv = 1 / n;
    for (let i = 0; i < n; i++) { re[i] *= inv; im[i] *= inv; }
  }
}

const fftCache = new Map();
export function getFFT(n) {
  let f = fftCache.get(n);
  if (!f) { f = new FFT(n); fftCache.set(n, f); }
  return f;
}

/* ───────────────────────── windows ───────────────────────── */

const hannCache = new Map();
export function hann(n) {
  let w = hannCache.get(n);
  if (w) return w;
  w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / n);
  hannCache.set(n, w);
  return w;
}

/* ───────────────────────── convolution ─────────────────────────
   Overlap-add. The impulse is short (a couple of seconds at most) and the
   takes are minutes at most, so one FFT size for both sides is plenty. */

export function convolve(x, ir, tail = true) {
  /* One FFT big enough to swallow the whole impulse, and blocks of input as
     long as what's left over — a fixed small block against a two-second
     impulse would mean transforming mostly zeroes, over and over. */
  const n = 1 << Math.ceil(Math.log2(Math.max(2048, ir.length) * 2));
  const B = n - ir.length + 1;
  const fft = getFFT(n);
  const hRe = new Float64Array(n), hIm = new Float64Array(n);
  hRe.set(ir);
  fft.forward(hRe, hIm);

  const outLen = tail ? x.length + ir.length - 1 : x.length;
  const out = new Float32Array(outLen);
  const re = new Float64Array(n), im = new Float64Array(n);

  for (let pos = 0; pos < x.length; pos += B) {
    re.fill(0); im.fill(0);
    const len = Math.min(B, x.length - pos);
    for (let i = 0; i < len; i++) re[i] = x[pos + i];
    fft.forward(re, im);
    for (let i = 0; i < n; i++) {
      const rr = re[i] * hRe[i] - im[i] * hIm[i];
      const ii = re[i] * hIm[i] + im[i] * hRe[i];
      re[i] = rr; im[i] = ii;
    }
    fft.inverse(re, im);
    const stop = Math.min(n, outLen - pos);
    for (let i = 0; i < stop; i++) out[pos + i] += re[i];
  }
  return out;
}

/* ───────────────────────── odds and ends ───────────────────────── */

/* A short equal-power crossfade written straight into a buffer, used
   wherever one treatment hands over to another mid-signal. */
export function crossfadeInto(dst, src, start, len) {
  const n = Math.min(len, dst.length - start, src.length - start);
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const a = Math.cos(t * Math.PI / 2), b = Math.sin(t * Math.PI / 2);
    dst[start + i] = dst[start + i] * a + src[start + i] * b;
  }
}

export function mix(a, b, amount) {
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] * (1 - amount) + (b[i] || 0) * amount;
  return out;
}

export function applyGain(x, g) {
  for (let i = 0; i < x.length; i++) x[i] *= g;
  return x;
}

/* Linear resampling. Good enough for lining a backing track up with a take
   recorded at a different rate — the alternative is refusing to mix them. */
export function resampleLinear(x, fromRate, toRate) {
  if (fromRate === toRate) return x;
  const ratio = toRate / fromRate;
  const out = new Float32Array(Math.round(x.length * ratio));
  for (let i = 0; i < out.length; i++) {
    const pos = i / ratio;
    const i0 = Math.floor(pos), frac = pos - i0;
    const a = x[i0] || 0, b = x[i0 + 1] !== undefined ? x[i0 + 1] : a;
    out[i] = a + (b - a) * frac;
  }
  return out;
}

/* Fixed-seed noise: two renders of the same take must come out identical,
   so the reverb tail can't be built from Math.random(). */
export function makeRandom(seed = 0x2f6e2b1) {
  let s = seed >>> 0;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}
