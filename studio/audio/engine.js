/* What the worker actually does.

   Analysing and rendering a take is seconds of solid arithmetic, and doing it
   on the page would freeze the meters, the waveform and the buttons for the
   whole of it. It belongs in a worker — but a browser too old for module
   workers still has to work, so the logic lives here as a plain factory and
   worker.js is four lines of wrapper around it.

   The engine holds on to the take it last worked on, so pulling a slider only
   costs a render rather than another analysis pass. */

import { analyseVoice, pitchTrack } from './analyse.js';
import { autoSettings, render } from './process.js';
import { peaksOf } from './wav.js';



/* The report is full of arrays the page has no use for — a noise spectrum, a
   pitch estimate every eleven milliseconds. Only the parts worth showing get
   sent across. */
function summarise(report) {
  const t = report.track;
  const step = Math.max(1, Math.round(t.count / 900));
  const contour = [];
  for (let i = 0; i < t.count; i += step) {
    contour.push(t.conf[i] > 0.55 ? t.f0[i] : 0);
  }
  return {
    duration: report.duration,
    sampleRate: report.sampleRate,
    peakDb: report.peakDb,
    truePeakDb: report.truePeakDb,
    lufs: report.lufs,
    clippedFraction: report.clippedFraction,
    noiseFloorDb: report.noiseFloorDb,
    voiceLevelDb: report.voiceLevelDb,
    snrDb: report.snrDb,
    bands: report.bands,
    shape: report.shape,
    hum: report.hum,
    material: report.material,
    sungScore: report.sungScore,
    key: report.key,
    pitch: {
      voicedRatio: report.pitch.voicedRatio,
      medianHz: report.pitch.medianHz,
      rangeSemitones: report.pitch.rangeSemitones,
      steadiness: report.pitch.steadiness,
      offCents: report.pitch.offCents,
    },
    contour: Float32Array.from(contour),
    contourHopSeconds: t.hop * step / t.sr,
  };
}

/* The pitch of the finished take, so the waveform can show the notes moving
   onto the grid rather than just claiming they did. Coarser than the tracking
   pass that drives the tuning — this one is only ever looked at. */
function contourOf(x, sr) {
  const t = pitchTrack(x, sr, { hop: 1024 });
  const out = new Float32Array(t.count);
  for (let i = 0; i < t.count; i++) out[i] = t.conf[i] > 0.55 ? t.f0[i] : 0;
  return { contour: out, hopSeconds: t.hop / sr };
}

export function createEngine(post) {
  let current = null;   // { id, samples, sampleRate, report }
  let backing = null;   // { id, channels } — already lined up with the take

  return function handle(msg) {
    try {
      if (msg.type === 'prepare') {
        const samples = new Float32Array(msg.samples);
        const report = analyseVoice(samples, msg.sampleRate, { a4: msg.a4 || 440 });
        current = { id: msg.id, samples, sampleRate: msg.sampleRate, report };
        const settings = autoSettings(report, { targetName: msg.targetName, tuneMode: msg.tuneMode });
        const peaks = peaksOf(samples, 1200);
        post({ type: 'ready', id: msg.id, report: summarise(report), settings, peaks }, [peaks.buffer]);
        return;
      }

      /* A backing arrives lined up: sample zero of it is sample zero of the
         take, padded or trimmed on the page where the alignment is known. */
      if (msg.type === 'backing') {
        backing = msg.channels && msg.channels.length
          ? { id: msg.id, channels: msg.channels.map(c => new Float32Array(c)) }
          : null;
        post({ type: 'backing-ready', id: msg.id, has: !!backing });
        return;
      }

      if (msg.type === 'render') {
        if (!current || current.id !== msg.id) {
          post({ type: 'need-samples', id: msg.id });
          return;
        }
        const useBacking = backing && backing.id === msg.id ? backing.channels : null;
        const out = render(current.samples, current.sampleRate, msg.settings, current.report,
          (p, what) => post({ type: 'progress', id: msg.id, p, what }), useBacking);
        const peaks = peaksOf(out.channels[0], 1200);
        const { contour, hopSeconds } = contourOf(out.channels[0], out.sampleRate);
        post({
          type: 'done', id: msg.id, token: msg.token,
          channels: out.channels, sampleRate: out.sampleRate,
          lufs: out.lufs, truePeakDb: out.truePeakDb, notes: out.notes, peaks,
          vocalLufs: out.vocalLufs, backingGain: out.backingGain, normaliseGain: out.normaliseGain,
          contour, contourHopSeconds: hopSeconds,
        }, [...out.channels.map(c => c.buffer), peaks.buffer, contour.buffer]);
        return;
      }

      if (msg.type === 'auto') {
        if (!current || current.id !== msg.id) { post({ type: 'need-samples', id: msg.id }); return; }
        post({
          type: 'settings', id: msg.id,
          settings: autoSettings(current.report, { targetName: msg.targetName, tuneMode: msg.tuneMode }),
        });
        return;
      }

      if (msg.type === 'forget') {
        if (current && current.id === msg.id) current = null;
        if (backing && backing.id === msg.id) backing = null;
        return;
      }
    } catch (err) {
      post({ type: 'error', id: msg.id, message: String((err && err.message) || err) });
    }
  };
}
