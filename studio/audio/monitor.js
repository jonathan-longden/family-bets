/* Hearing yourself while you record.

   This is the take chain rebuilt out of the browser's own audio nodes so it
   can run live: the same high pass, the same tone moves, a de-esser split
   across a crossover and a compressor holding the level. Tuning isn't in here
   — pitch correction needs to see a whole note before it knows what to do
   with it, so it belongs to the take, not to the monitor.

   Use headphones. Monitoring through speakers puts the microphone back in the
   room with itself, and the room will win. */

export function createMonitor(ctx, settings) {
  const input = ctx.createGain();
  const output = ctx.createGain();

  const hp1 = ctx.createBiquadFilter(), hp2 = ctx.createBiquadFilter();
  hp1.type = hp2.type = 'highpass';
  hp1.Q.value = 0.54; hp2.Q.value = 1.31;

  const mud = ctx.createBiquadFilter(); mud.type = 'peaking'; mud.frequency.value = 260; mud.Q.value = 1.1;
  const box = ctx.createBiquadFilter(); box.type = 'peaking'; box.frequency.value = 520; box.Q.value = 1.3;
  const pres = ctx.createBiquadFilter(); pres.type = 'peaking'; pres.frequency.value = 3200; pres.Q.value = 0.85;
  const air = ctx.createBiquadFilter(); air.type = 'highshelf'; air.frequency.value = 10500;
  const warm = ctx.createBiquadFilter(); warm.type = 'lowshelf'; warm.frequency.value = 210;

  // de-esser: everything under the crossover straight through, everything
  // over it through a fast compressor, then back together
  const split = ctx.createGain();
  const lowA = ctx.createBiquadFilter(), lowB = ctx.createBiquadFilter();
  lowA.type = lowB.type = 'lowpass'; lowA.Q.value = 0.54; lowB.Q.value = 1.31;
  const hiA = ctx.createBiquadFilter(), hiB = ctx.createBiquadFilter();
  hiA.type = hiB.type = 'highpass'; hiA.Q.value = 0.54; hiB.Q.value = 1.31;
  const ess = ctx.createDynamicsCompressor();
  ess.ratio.value = 4; ess.attack.value = 0.001; ess.release.value = 0.05; ess.knee.value = 3;
  const merge = ctx.createGain();

  const comp = ctx.createDynamicsCompressor();
  const drive = ctx.createWaveShaper();

  const dry = ctx.createGain(), wet = ctx.createGain();
  const verb = ctx.createConvolver();

  input.connect(hp1); hp1.connect(hp2); hp2.connect(mud); mud.connect(box);
  box.connect(pres); pres.connect(air); air.connect(warm); warm.connect(split);
  split.connect(lowA); lowA.connect(lowB); lowB.connect(merge);
  split.connect(hiA); hiA.connect(hiB); hiB.connect(ess); ess.connect(merge);
  merge.connect(comp); comp.connect(drive);
  drive.connect(dry); dry.connect(output);
  drive.connect(verb); verb.connect(wet); wet.connect(output);

  function shaper(amount) {
    const n = 1024, curve = new Float32Array(n);
    const d = 1 + amount / 100 * 2.2;
    const norm = Math.tanh(d) / d;
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * d) / d / norm * 0.995;
    }
    return curve;
  }

  /* A short synthetic room, made the same way the render makes one. */
  function impulse(sizePct) {
    const sr = ctx.sampleRate;
    const decay = 0.45 + (sizePct / 100) * 2.15;
    const len = Math.max(64, Math.round(sr * (decay + 0.04)));
    const buf = ctx.createBuffer(2, len, sr);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.2) * Math.exp(-6.9 * (i / sr) / decay);
      }
    }
    return buf;
  }

  let lastSize = -1;

  function update(st) {
    const t = ctx.currentTime, at = (p, v) => p.setTargetAtTime(v, t, 0.02);
    at(hp1.frequency, st.eq.hp); at(hp2.frequency, st.eq.hp);
    at(mud.gain, st.eq.mud); at(box.gain, st.eq.box);
    at(pres.gain, Math.min(6, st.presence / 100 * 5.5));
    at(air.gain, st.eq.air);
    at(warm.gain, st.warmth / 100 * 4);

    const fc = 6200;
    for (const f of [lowA, lowB, hiA, hiB]) at(f.frequency, fc);
    at(ess.threshold, st.deEss > 1 ? -34 + (100 - st.deEss) / 100 * 14 : 0);

    const a = st.compression / 100;
    at(comp.threshold, -10 - a * 18);
    at(comp.ratio, 1.6 + a * 3);
    at(comp.attack, 0.012);
    at(comp.release, 0.22);
    at(output.gain, Math.pow(10, (a * 5) / 20));

    drive.curve = shaper(st.saturation);
    drive.oversample = '2x';

    if (st.space > 1) {
      if (st.spaceSize !== lastSize) { verb.buffer = impulse(st.spaceSize); lastSize = st.spaceSize; }
      at(wet.gain, st.space / 100 * 0.35);
    } else {
      at(wet.gain, 0);
    }
    at(dry.gain, 1);
  }

  update(settings);

  return {
    input, output, update,
    dispose() {
      try { input.disconnect(); output.disconnect(); } catch { /* already gone */ }
    },
  };
}
