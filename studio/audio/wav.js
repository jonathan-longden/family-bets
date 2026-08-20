/* WAV in and out.

   Takes are kept as WAV rather than as whatever the browser's own recorder
   produces: it's the format every editor, every DAW and every phone can open,
   it doesn't lose anything, and reading it back gives the exact samples that
   went in — which matters when the whole point is to process them again. */

export function encodeWav(channels, sampleRate, bits = 24) {
  const chans = channels.length;
  const frames = channels[0].length;
  const bytesPer = bits / 8;
  const dataBytes = frames * chans * bytesPer;
  const buf = new ArrayBuffer(44 + dataBytes);
  const v = new DataView(buf);

  const str = (off, s) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); };
  str(0, 'RIFF');
  v.setUint32(4, 36 + dataBytes, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);                       // PCM
  v.setUint16(22, chans, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * chans * bytesPer, true);
  v.setUint16(32, chans * bytesPer, true);
  v.setUint16(34, bits, true);
  str(36, 'data');
  v.setUint32(40, dataBytes, true);

  let off = 44;
  if (bits === 16) {
    for (let i = 0; i < frames; i++) {
      for (let c = 0; c < chans; c++) {
        const s = Math.max(-1, Math.min(1, channels[c][i]));
        v.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
        off += 2;
      }
    }
  } else {
    for (let i = 0; i < frames; i++) {
      for (let c = 0; c < chans; c++) {
        const s = Math.max(-1, Math.min(1, channels[c][i]));
        const n = Math.round(s < 0 ? s * 0x800000 : s * 0x7FFFFF);
        v.setUint8(off, n & 0xFF);
        v.setUint8(off + 1, (n >> 8) & 0xFF);
        v.setUint8(off + 2, (n >> 16) & 0xFF);
        off += 3;
      }
    }
  }
  return buf;
}

export function wavBlob(channels, sampleRate, bits = 24) {
  return new Blob([encodeWav(channels, sampleRate, bits)], { type: 'audio/wav' });
}

/* Enough of a RIFF parser to read back what we wrote, plus the 16-bit and
   float files other apps produce. Used instead of decodeAudioData when the
   samples are wanted without an audio context awake. */
export function decodeWav(buffer) {
  const v = new DataView(buffer);
  if (v.getUint32(0, false) !== 0x52494646 || v.getUint32(8, false) !== 0x57415645) return null;

  let off = 12, fmt = null, dataOff = 0, dataLen = 0;
  while (off + 8 <= v.byteLength) {
    const id = v.getUint32(off, false), size = v.getUint32(off + 4, true);
    if (id === 0x666d7420) {
      fmt = {
        format: v.getUint16(off + 8, true),
        channels: v.getUint16(off + 10, true),
        sampleRate: v.getUint32(off + 12, true),
        bits: v.getUint16(off + 22, true),
      };
    } else if (id === 0x64617461) {
      dataOff = off + 8; dataLen = size;
    }
    off += 8 + size + (size & 1);
  }
  if (!fmt || !dataOff) return null;

  const bytesPer = fmt.bits / 8;
  const frames = Math.floor(dataLen / (bytesPer * fmt.channels));
  const out = [];
  for (let c = 0; c < fmt.channels; c++) out.push(new Float32Array(frames));

  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < fmt.channels; c++) {
      const p = dataOff + (i * fmt.channels + c) * bytesPer;
      let s = 0;
      if (fmt.format === 3 && fmt.bits === 32) s = v.getFloat32(p, true);
      else if (fmt.bits === 16) s = v.getInt16(p, true) / 0x8000;
      else if (fmt.bits === 24) {
        const n = v.getUint8(p) | (v.getUint8(p + 1) << 8) | (v.getInt8(p + 2) << 16);
        s = n / 0x800000;
      } else if (fmt.bits === 32) s = v.getInt32(p, true) / 0x80000000;
      else if (fmt.bits === 8) s = (v.getUint8(p) - 128) / 128;
      out[c][i] = s;
    }
  }
  return { channels: out, sampleRate: fmt.sampleRate };
}

/* Min and max per pixel column: what the waveform is drawn from, worked out
   once next to the samples rather than every time the canvas is redrawn. */
export function peaksOf(x, buckets = 1200) {
  const out = new Float32Array(buckets * 2);
  const per = x.length / buckets;
  for (let b = 0; b < buckets; b++) {
    const from = Math.floor(b * per), to = Math.min(x.length, Math.floor((b + 1) * per));
    let lo = 0, hi = 0;
    for (let i = from; i < to; i++) {
      const v = x[i];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    out[b * 2] = lo; out[b * 2 + 1] = hi;
  }
  return out;
}
