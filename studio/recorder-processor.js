/* The tap on the microphone.

   An audio worklet runs on the audio thread, so it sees every sample even
   when the page is busy drawing a waveform or the phone is thinking about
   something else. It hands them over in blocks of a few thousand rather than
   the 128 it's given, because a message per block would be its own kind of
   busy. */

class TakeRecorder extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chunk = new Float32Array(4096);
    this.n = 0;
    this.on = false;
    this.port.onmessage = e => {
      if (e.data === 'start') { this.n = 0; this.on = true; }
      else if (e.data === 'stop') { this.on = false; this.flush(); this.port.postMessage('stopped'); }
    };
  }

  flush() {
    if (!this.n) return;
    const out = this.chunk.slice(0, this.n);
    this.n = 0;
    this.port.postMessage(out, [out.buffer]);
  }

  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (this.on && ch) {
      for (let i = 0; i < ch.length; i++) {
        this.chunk[this.n++] = ch[i];
        if (this.n === this.chunk.length) this.flush();
      }
    }
    return true;
  }
}

registerProcessor('take-recorder', TakeRecorder);
