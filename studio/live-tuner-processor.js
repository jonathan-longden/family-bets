/* Take One — pitch correction while you're still singing.

   The take gets tuned properly afterwards, with the whole performance in front
   of it. This is the other job: hearing yourself in tune *now*, in your
   headphones, while you sing — which means deciding what note you're on from
   the last few hundredths of a second and committing to it.

   Same idea as the offline tuner (one grain per glottal pulse, laid back down
   at the spacing the right note asks for, so the formants survive), rebuilt to
   run on the audio thread with nothing but what's already arrived:

   - pitch from a YIN on a quarter-rate copy, cheap enough for a phone
   - pitch marks placed on the pulses as they come in
   - grains overlapped into a ring buffer a fixed 36 ms behind the input

   That 36 ms is the price. It's the room a grain needs to exist in — you can't
   lay down two periods of a note before two periods have happened — and it's
   inside what singers put up with from a set of in-ears. The recording is
   never this signal: takes are captured dry and tuned afterwards at full
   quality, so nothing here can spoil one. */

const MIN_HZ = 75;
const MAX_HZ = 1000;

/* Just enough biquad for two lowpasses. */
class Filt {
  constructor() { this.b0 = 1; this.b1 = 0; this.b2 = 0; this.a1 = 0; this.a2 = 0; this.z1 = 0; this.z2 = 0; }
  lowpass(sr, f, q) {
    const w = 2 * Math.PI * Math.min(f, sr * 0.45) / sr, c = Math.cos(w), al = Math.sin(w) / (2 * q);
    const a0 = 1 + al;
    this.b0 = (1 - c) / 2 / a0; this.b1 = (1 - c) / a0; this.b2 = this.b0;
    this.a1 = -2 * c / a0; this.a2 = (1 - al) / a0;
    return this;
  }
  tick(x) {
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }
}

class LiveTuner extends AudioWorkletProcessor {
  constructor() {
    super();
    const sr = sampleRate;
    this.sr = sr;

    this.N = 16384;                       // a third of a second of everything
    this.wrap = this.N - 1;
    this.in = new Float32Array(this.N);   // what came in
    this.lpBuf = new Float32Array(this.N);// the same, lowpassed, for finding pulses
    this.acc = new Float32Array(this.N);  // grains, overlapped
    this.wsum = new Float32Array(this.N); // and how much window landed on each sample
    /* Far enough behind the input that a whole grain always exists: two of the
       longest period we'll track, plus a block. You can't lay down two periods
       of a note until two periods have happened. */
    this.delay = Math.max(Math.round(sr * 0.036), 2 * Math.ceil(sr / MIN_HZ) + 160);

    /* Both pointers count the same thing — position in the incoming audio —
       and the read pointer simply starts a delay's worth behind, which is what
       makes the whole thing work: everything the synthesis needs is already in
       the buffer by the time it's asked for. The first 36 ms come out silent
       while the pipeline fills. */
    this.write = 0;
    this.read = -this.delay;

    this.markLp = [new Filt().lowpass(sr, 900, 0.54), new Filt().lowpass(sr, 900, 1.31)];
    this.detLp = [new Filt().lowpass(sr, 1600, 0.54), new Filt().lowpass(sr, 1600, 1.31)];

    // quarter-rate copy: enough of the voice to find a fundamental in, at a
    // quarter of the arithmetic
    this.dec = Math.max(1, Math.round(sr / 11025));
    this.dsRate = sr / this.dec;
    this.DS = 1024; this.dsWrap = this.DS - 1;
    this.ds = new Float32Array(this.DS);
    this.dsWrite = 0;
    this.decCount = 0;

    this.W = 384;                         // YIN window, about 35 ms
    this.half = this.W >> 1;
    this.tauMin = Math.max(2, Math.floor(this.dsRate / MAX_HZ));
    this.tauMax = Math.min(this.half - 1, Math.floor(this.dsRate / MIN_HZ));
    this.diff = new Float32Array(this.tauMax + 2);
    this.cmnd = new Float32Array(this.tauMax + 2);
    this.hop = Math.round(sr * 0.010);
    this.nextDetect = 0;

    this.f0 = 0;
    this.conf = 0;

    this.marks = new Float64Array(64);
    this.markT = new Float32Array(64);
    this.markCount = 0;                   // total ever placed; index = count & 63
    this.lastMark = -1;

    this.outMark = -1;
    this.smoothErr = 0;
    this.wet = 0;

    this.grain = new Float32Array(4096);  // hann, rebuilt when the length changes
    this.grainLen = 0;

    // settings, replaced from the page
    this.on = true;
    this.strength = 1;
    this.speedMs = 10;
    this.maxCents = 200;
    this.minConf = 0.5;
    this.a4 = 440;
    this.scale = null;                    // null means every note

    this.port.onmessage = e => {
      const d = e.data || {};
      if (d.type !== 'settings') return;
      if (d.on !== undefined) this.on = !!d.on;
      if (d.strength !== undefined) this.strength = Math.max(0, Math.min(1, d.strength));
      if (d.speedMs !== undefined) this.speedMs = Math.max(1, d.speedMs);
      if (d.maxCents !== undefined) this.maxCents = d.maxCents;
      if (d.minConf !== undefined) this.minConf = d.minConf;
      if (d.a4 !== undefined) this.a4 = d.a4;
      if (d.scale !== undefined) this.scale = d.scale && d.scale.length ? Int8Array.from(d.scale) : null;
    };
    this.port.postMessage({ type: 'latency', seconds: this.delay / sr });
  }

  /* ── pitch: YIN over the quarter-rate copy, difference function by hand.
     Small enough windows that the direct sum beats setting up an FFT. */
  detect() {
    const W = this.W, half = this.half, ds = this.ds, wrapD = this.dsWrap;
    const base = this.dsWrite - W;
    if (base < 0) return;

    let energy = 0;
    for (let j = 0; j < half; j++) { const v = ds[(base + j) & wrapD]; energy += v * v; }
    if (energy < 1e-7) { this.conf = 0; this.f0 = 0; return; }

    const d = this.diff, cm = this.cmnd;
    for (let tau = this.tauMin; tau <= this.tauMax; tau++) {
      let s = 0;
      for (let j = 0; j < half; j++) {
        const a = ds[(base + j) & wrapD] - ds[(base + j + tau) & wrapD];
        s += a * a;
      }
      d[tau] = s;
    }

    let running = 0, best = -1;
    for (let tau = this.tauMin; tau <= this.tauMax; tau++) {
      running += d[tau];
      cm[tau] = running > 0 ? d[tau] * (tau - this.tauMin + 1) / running : 1;
    }
    for (let tau = this.tauMin + 1; tau < this.tauMax; tau++) {
      if (cm[tau] < 0.13 && cm[tau] <= cm[tau + 1]) { best = tau; break; }
    }
    if (best < 0) {
      let lo = Infinity;
      for (let tau = this.tauMin + 1; tau < this.tauMax; tau++) if (cm[tau] < lo) { lo = cm[tau]; best = tau; }
    }
    if (best <= this.tauMin || best >= this.tauMax) { this.conf = 0; this.f0 = 0; return; }

    const a = cm[best - 1], b = cm[best], c = cm[best + 1];
    const den = a + c - 2 * b;
    const shift = den !== 0 ? 0.5 * (a - c) / den : 0;
    const tau = best + Math.max(-1, Math.min(1, shift));

    this.f0 = this.dsRate / tau;
    this.conf = Math.max(0, Math.min(1, 1 - b));
  }

  hann(len) {
    if (this.grainLen === len) return;
    for (let i = 0; i < len; i++) this.grain[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / len);
    this.grainLen = len;
  }

  snap(midi) {
    const s = this.scale;
    if (!s) return Math.round(midi);
    let best = Math.round(midi), dist = Infinity;
    for (let cand = Math.floor(midi) - 1; cand <= Math.ceil(midi) + 1; cand++) {
      const pc = ((cand % 12) + 12) % 12;
      let inScale = false;
      for (let i = 0; i < s.length; i++) if (s[i] === pc) { inScale = true; break; }
      if (!inScale) continue;
      const dd = Math.abs(cand - midi);
      if (dd < dist) { dist = dd; best = cand; }
    }
    return best;
  }

  process(inputs, outputs) {
    const inp = inputs[0] && inputs[0][0];
    const out = outputs[0] && outputs[0][0];
    if (!out) return true;
    const n = out.length;

    // ── 1. take the block in, keeping the filtered and decimated copies
    for (let i = 0; i < n; i++) {
      const x = inp ? inp[i] : 0;
      const w = this.write & this.wrap;
      this.in[w] = x;
      this.lpBuf[w] = this.markLp[1].tick(this.markLp[0].tick(x));
      const det = this.detLp[1].tick(this.detLp[0].tick(x));
      if (++this.decCount >= this.dec) {
        this.decCount = 0;
        this.ds[this.dsWrite & this.dsWrap] = det;
        this.dsWrite++;
      }
      this.write++;
    }

    if (!this.on || this.strength <= 0.001) {
      // straight through, but still delayed, so switching it on and off in the
      // middle of a note doesn't jump
      this.passThrough(out, n);
      return true;
    }

    // ── 2. pitch, every ten milliseconds
    while (this.write >= this.nextDetect) {
      this.detect();
      this.nextDetect += this.hop;
    }

    const voiced = this.f0 > 0 && this.conf >= this.minConf;
    const T = voiced ? this.sr / this.f0 : 0;

    // ── 3. a mark on every pulse that has fully arrived
    if (voiced) {
      if (this.lastMark < 0 || this.write - this.lastMark > 4 * T) {
        this.lastMark = this.write - this.delay;         // start clean after a gap
        this.smoothErr = 0;
      }
      while (this.lastMark + T * 1.25 < this.write - 4) {
        const from = Math.round(this.lastMark + T * 0.75);
        const to = Math.round(this.lastMark + T * 1.25);
        let bi = from, bv = -Infinity;
        for (let i = from; i <= to; i++) {
          const v = this.lpBuf[i & this.wrap];
          if (v > bv) { bv = v; bi = i; }
        }
        this.lastMark = bi;
        this.marks[this.markCount & 63] = bi;
        this.markT[this.markCount & 63] = T;
        this.markCount++;
      }
    }

    // ── 4. lay grains down until there are enough of them to cover the block
    if (voiced && this.markCount > 2) {
      if (this.outMark < this.read) this.outMark = this.read;
      const horizon = this.read + n + T;

      while (this.outMark < horizon) {
        // the analysis mark nearest this point in time
        let bestPos = -1, bestT = T, bestD = Infinity;
        for (let k = 1; k <= Math.min(64, this.markCount); k++) {
          const idx = (this.markCount - k) & 63;
          const p = this.marks[idx];
          const dd = Math.abs(p - this.outMark);
          if (dd < bestD) { bestD = dd; bestPos = p; bestT = this.markT[idx]; }
        }
        if (bestPos < 0 || bestD > 4 * T) break;

        const len = Math.max(16, Math.min(4000, Math.round(2 * bestT)));
        this.hann(len);
        const halfLen = len >> 1;

        // don't reach for samples that haven't arrived
        if (bestPos + halfLen >= this.write) break;

        for (let j = 0; j < len; j++) {
          const src = (bestPos - halfLen + j);
          const dst = Math.round(this.outMark) - halfLen + j;
          if (src < 0 || dst < this.read) continue;
          const w = this.grain[j];
          this.acc[dst & this.wrap] += this.in[src & this.wrap] * w;
          this.wsum[dst & this.wrap] += w;
        }

        // how far off the note is, smoothed over its own periods so that a
        // vibrato isn't mistaken for being flat
        const midi = 69 + 12 * Math.log2(Math.max(1e-6, this.f0) / this.a4);
        const target = this.snap(midi);
        let err = (target - midi) * 100;
        if (err > this.maxCents) err = this.maxCents;
        if (err < -this.maxCents) err = -this.maxCents;
        const c = Math.exp(-T / (this.speedMs * 0.001 * this.sr));
        this.smoothErr = c * this.smoothErr + (1 - c) * err;
        const ratio = Math.pow(2, (this.smoothErr * this.strength) / 1200);

        this.outMark += Math.max(2, T / ratio);
      }
    }

    // ── 5. hand over the block, fading between the tuned signal and the dry
    const fade = Math.exp(-1 / (0.004 * this.sr));
    for (let i = 0; i < n; i++) {
      const idx = this.read & this.wrap;
      const w = this.wsum[idx];
      const dry = this.read >= 0 ? this.in[this.read & this.wrap] : 0;
      const tuned = w > 0.28 ? this.acc[idx] / w : dry;
      const want = w > 0.28 ? 1 : 0;
      this.wet = fade * this.wet + (1 - fade) * want;
      out[i] = tuned * this.wet + dry * (1 - this.wet);
      this.acc[idx] = 0;
      this.wsum[idx] = 0;
      this.read++;
    }

    return true;
  }

  passThrough(out, n) {
    for (let i = 0; i < n; i++) {
      const idx = this.read & this.wrap;
      out[i] = this.read >= 0 ? this.in[this.read & this.wrap] : 0;
      this.acc[idx] = 0;
      this.wsum[idx] = 0;
      this.read++;
    }
    this.outMark = -1;
    this.wet = 0;
  }
}

registerProcessor('live-tuner', LiveTuner);
