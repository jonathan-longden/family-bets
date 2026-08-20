# Take One

A voice studio that finishes the take for you. Record something — or drop in
a recording you already have — and it comes back sounding like it was made in
a room with money spent on it: the room noise gone, the tone put where a voice
belongs, the level even, the s's under control, the notes on the notes, and
the loudness set to what a streaming service or a broadcaster expects.

It runs on Android and on a computer, from the same page. Install it to the
home screen or the taskbar and it works with the network off. Nothing is ever
uploaded: the recording, the processing and the finished file all stay on the
device.

## What it does

- **Listens first.** Before anything is changed, the take is measured: how
  loud the voice is, how far down the room is, where the tone sits against a
  normal voice curve, how much the s's spit, whether there's mains hum in it,
  which notes were sung, in what key, and how far off they were. Every setting
  that follows comes out of those numbers.
- **Knows singing from speaking.** Held notes and a wide range mean singing,
  and singing gets tuned. Talking doesn't — automatic pitch correction on
  speech is what makes people sound like robots — so a spoken take gets the
  cleaning, the tone and the level and is left alone otherwise.
- **Takes the room out.** The quiet moments of your own recording are a
  fingerprint of the room, the laptop fan and the preamp. Every frequency is
  turned down by however much of it is room rather than voice — turned down,
  not off, because an aggressive subtraction leaves the warbling that gives a
  cleaned-up recording away.
- **Puts the tone right.** A high pass under the lowest note you actually
  sang, the mud at 260 Hz and the boxiness at 500 pulled back by however much
  is there, presence at 3 kHz and air on top put where a voice belongs.
- **Holds down the s's.** Only the loudest few per cent of the sibilant band
  gets caught, and the band is split so that putting it back together with the
  de-esser idle gives you exactly the signal that went in.
- **Evens the level.** Two compressors — one slow for the shape of the
  performance, one quick for the peaks — set from the take's own crest factor.
- **Tunes it.** The voice is cut into grains, one per glottal pulse, and laid
  back down at the spacing the right note asks for. The grains themselves
  aren't stretched, so the formants survive and it still sounds like you
  rather than like a chipmunk. Only the slow part of the error is corrected,
  so vibrato and slides live through it.
- **Knows the key.** The notes you sang are matched against the classic
  key profiles, and the tuning snaps inside that key rather than to every
  semitone there is — much kinder to a performance. If the key isn't clear it
  says so and snaps to the nearest note instead. You can override it.
- **Sings to a backing.** Add a track — any audio file — and it plays while
  you record, so you have something to sing to. The take is lined up against
  it automatically, round-trip latency included: the app knows when it started
  the music, when the microphone started listening, and what the headphones
  and the input are adding on top, so your voice lands where you actually sang
  it rather than a tenth of a second late. The music is then balanced four
  decibels under the finished voice — measured, not guessed — and ducks out of
  the way while you're singing. What you export is the mix.
- **Finishes it.** A double either side of the middle, a room, a little tape
  drive, then the whole thing brought to a release loudness (−14 LUFS for
  streaming by default, −16 for podcasts, −23 for broadcast) with a look-ahead
  limiter under the ceiling. Loudness is measured properly, to ITU-R BS.1770,
  and the peaks are true peaks.
- **Shows its working.** Every decision is on screen — "room taken out 37%",
  "tuned to G major, moved 15 cents on average", "−14.0 LUFS, peaks at
  −1.2 dB" — and the waveform draws the pitch of the take before and after, so
  you can see the notes move onto the grid.
- **Lets you overrule all of it.** Twelve sliders, a key picker and a loudness
  target. Anything you touch turns gold and stays where you put it; everything
  else carries on deciding for itself. One button puts it all back.
- **A/B, honestly.** Switch between the raw take and the finished one while it
  plays. The levels are matched by default, because otherwise the louder one
  wins every time and tells you nothing.
- **A tuner while you sing.** The note and how many cents off it, live, before
  you've committed to anything.
- **Monitoring.** Hear the tone chain while you record — headphones only, or
  the microphone hears itself and the room wins. Tuning isn't in the monitor:
  pitch correction has to see a whole note before it knows what to do with it,
  so it belongs to the take.
- **Keeps the master.** Takes are stored as 24-bit WAV, and export gives you
  24-bit WAV of either version. On a phone, Share puts it straight into a
  message or another app.

## Using it

1. Open the page and allow the microphone.
2. Press the big button, sing or talk, press it again.
3. Wait a few seconds. The finished take opens by itself.
4. Play it, compare it with the raw one, pull a slider if you disagree.
5. **Export WAV** (or **Share**).

To sing to something, add a **backing track** on the record screen first
(**Add**, then pick a file — it's kept as the file you added, so a four-minute
song costs four megabytes rather than eighty). Press ▶ to hear it on its own,
or just press record and sing along. **Wear headphones**: through speakers the
backing goes into the take with you and can never be taken out again.

Afterwards the take gets a **Backing** panel: whether the music is in the mix,
its balance, how far it ducks under your voice, and **Line it up** for the last
few milliseconds if it feels early or late. Switching to **Raw** plays your
unprocessed voice against the same music, so the comparison stays in context.
The exported WAV is the mix — turn *in the mix* off if you want the voice on
its own.

Drag an audio file onto the page — or use *choose one* — to run something you
recorded elsewhere through the same chain. Anything the browser can decode
works: WAV, MP3, M4A, FLAC where supported. Stereo files are folded to mono
first; this is a voice studio, not a mastering suite.

On a computer: <kbd>space</kbd> plays, <kbd>R</kbd> records, <kbd>A</kbd>
swaps between raw and finished, the arrow keys jump five seconds, and
<kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>S</kbd> exports.

## Getting the best out of it

- **Get close to the microphone.** Two hand-spans away, slightly off to one
  side so the p's don't hit it. Every dB more voice is a dB less room the
  cleaner has to guess at.
- **Aim for −12 dB peaks.** The ring turns red when you're too loud, and a
  clipped recording can't be fixed by anything downstream. Quiet is fine —
  the loudness stage will bring it up.
- **Leave a second of silence at the top.** The cleaner learns the room from
  the parts where you're not singing, and giving it a clear look at nothing is
  the single biggest thing you can do for the result.
- **Turn the browser's own clean-up off** — it is off by default, in Setup.
  Phone browsers ship noise suppression, echo cancellation and automatic gain
  that fight with a studio chain and can't be undone once they're recorded.
- **Wear headphones if you monitor.** Speakers plus a microphone is a
  feedback loop with a bad temper.

## What's under it

No build step, no bundler, no server, no account, and nothing from a CDN.

| | |
|---|---|
| `index.html`, `styles.css`, `app.js` | the page, the meters, the waveform, the takes |
| `audio/dsp.js` | biquads, FFT, convolution, windows |
| `audio/analyse.js` | levels, BS.1770 loudness, true peak, noise profile, YIN pitch tracking, key detection, hum detection |
| `audio/process.js` | the chain, and `autoSettings` — the part that decides |
| `audio/engine.js`, `audio/worker.js` | all of that, off the main thread |
| `audio/monitor.js` | the same tone chain built out of Web Audio nodes, live |
| `audio/wav.js` | WAV in and out, and the waveform peaks |
| `recorder-processor.js` | the audio worklet that catches every sample |
| `sw.js` | the service worker that makes it work offline |

Takes live in IndexedDB on the device: the raw take as 24-bit WAV and the
finished one as 16-bit, so opening a take from the list plays immediately
instead of re-rendering it. Backing tracks are kept as the file you added and
decoded when they're needed. Settings live in local storage. Deleting a take
deletes both halves of it; deleting a backing track leaves every take that used
it alone.

Rendering a take is real arithmetic — roughly a second per six seconds of
audio on a laptop, slower on a phone — so it happens in a worker with a
progress bar rather than freezing the page.

## Hosting it

It's a static site. Copy the folder anywhere that serves files over HTTPS
(GitHub Pages, Firebase Hosting, anything) and add it to the home screen.
HTTPS is not optional: browsers won't hand over a microphone without it,
`localhost` excepted.

## What it can't do

- It tunes one voice at a time. A recording of a band, or two people singing
  at once, has no single pitch to track and will come out sounding strange.
- Pitch correction moves a note by up to two semitones. It is not a
  transposer, and it won't rescue a note that was sung a third out.
- Live monitoring gives you the tone chain, not the tuning.
- Very long takes are limited by memory rather than by anything clever: an
  hour-long recording will make a phone unhappy.
- A backing added to a take *afterwards* starts from the top of the track,
  because there's nothing to line it up against — **Line it up** moves it by up
  to 400 ms, not by verses. If you want to sing over the second chorus, record
  to the backing rather than attaching it later.
