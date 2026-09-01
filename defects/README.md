# Defect Log

A screening tool for highway defects. It opens on the camera, watches the road
while you drive or walk it, and writes down what it finds with the coordinates
and the time already attached — rather than a clipboard, a memory and a folder
of photographs to be matched up afterwards.

It runs on a phone, installs to the home screen, and works with no signal.
Nothing leaves the device: there is no account, no upload and no server —
which also means nothing is backed up for you, so export at the end of a
round.

## The shape of it

There is one screen: the road. The viewfinder is the app, not a tab inside it,
and it comes up looking at the road the moment the app opens — no start screen,
nothing to dismiss.

- **One round button** starts and stops the survey. That tap is also the
  gesture a browser demands before it will give a page the whole screen and
  lock it to landscape, so both are taken with it rather than hidden behind a
  control nobody would find with a phone on a windscreen mount.
- **It is landscape, whatever the phone thinks.** The manifest declares it, the
  orientation lock is asked for on load, and the first touch anywhere is spent
  on full screen and the lock rather than waiting for the record button. When
  all of that is refused and the viewport still comes up portrait, **the app
  turns itself** — see below. There is no portrait layout to fall back to.
- **A strip of readouts along the top** — whether the camera is live, how good
  the fix is, how much room is left, and what the model is doing — each with a
  bar under it saying whether the number above is good, marginal or bad. From a
  driving seat the colour gets read and the number does not, so the colour has
  to be the honest part: nothing is green that a person should be checking. A
  fix two minutes old reads worse than one that is merely wide, because a stale
  fix is confident about where you *were*.
- **Space left is counted in finds**, not megabytes. Nobody knows what 340 MB
  buys them; everybody knows what six thousand more photographs means.
- **A tag and a surface** sit under it. Both belong to the run rather than to any
  one defect — a road name, a job number, the round you are on — so they are set
  once and ride along on everything logged until they are changed. The tag
  survives a reload and travels in the log, the CSV and the GeoJSON.
- **A rail of round buttons down the right edge**, where a thumb already is:
  the menu, the record button, and the log with its count on it. The menu
  reaches the map, diagnostics, full screen and stopping the camera.
- **The log and the map come up over the road**, not instead of it. Closing one
  is a single tap and the camera never stopped, which is the difference between
  a layer and a tab.

There is no shutter. Nothing is photographed by hand any more: the survey takes
the picture when it finds something, and a person's job is to open the entry
afterwards and either sign it off or put it right.

## What it does

- **Ties the photograph to a place.** The camera and the location are watched
  together, and the fix that was live when the find was written down is what
  gets saved — with its accuracy and its age. A defect logged from a van at ±40 m,
  or tagged with a fix that was two minutes stale, is recorded as exactly
  that and flagged in the log. That is the gap most footage has.
- **Scores it against the matrix, not against a memory.** The 5×5 laminated
  card is on the confirm screen: impact down the side, probability across the
  top, tap the cell. The risk factor, the category and the response time come
  straight out of it.
- **Proposes a score, and shows its working.** A pothole detection model runs
  on the phone and finds the defect. From the outline's
  share of the frame and the surface you are on, the app proposes a cell and
  writes the entry with it. Open the entry to confirm it and the proposal is
  pre-selected with, in words, what it was based on and how sure the model was
  that the thing is a pothole at all. One tap on any other cell overrules it,
  and the entry records whether the score was an accepted proposal or yours.
- **Never estimates depth from a picture.** It never did and it still doesn't.
- **Keeps hundreds of defects.** Entries live in IndexedDB with the
  photographs held as files rather than as text, so a full day of finds fits
  and the app tells you how much room is left.
- **Exports three ways**, from the menu rather than from under the log: CSV for
  the data and the coordinates, opened straight into a spreadsheet; JSON when
  you need the photographs to travel with it; GeoJSON to drop the located
  defects onto someone else's map.

## Turning the app instead of the phone

A web page cannot make a phone rotate. The orientation lock needs full screen,
full screen needs a gesture, and a phone locked to portrait in its own settings
overrules all of it. So when the viewport comes up portrait anyway, the app is
turned rather than the phone: one CSS transform on the element everything sits
inside.

That one element does the whole job because a transform makes it the containing
block for the `position: fixed` layers inside it — the viewfinder, the menu, the
sheets and the photo viewer all turn together and keep stacking in the order
they already had. The right way up it carries no transform at all, so nothing
about the normal case changes.

**The picture does not turn with it.** The camera already hands over a frame the
right way up for how the phone is being held — the browser orients it — so
turning it again along with everything else spins it away from the world. Rotate
a screenshot of that until the buttons read correctly and the ceiling ends up at
the bottom. So inside the turned wrapper the video cancels its parent's rotation
and is sized to the physical screen rather than to the turned box it sits in.
The chrome turns; the road does not.

Two things this deliberately does not touch:

- **What the model sees.** The video element is measured in its own pixels, so
  the frame handed to the model is the camera's, turned or not. A CSS transform
  cannot reach it.
- **Sizes written in `vh` and `vw`.** Inside the turn those still measure the
  phone's real screen, not the turned container — a menu capped at `100vh` ran
  off the side of a 412-tall box. Anything that has to fit the turned app is
  written in percentages, which resolve against the containing block and so are
  right both ways round.

## Recording

Tap the round button. The model starts watching the picture about once a
second, and anything it finds is photographed, scored and written to the log
without being asked. A clock counts the run and a tally counts what has been
logged. Mount the phone, drive or walk the road, and read the log afterwards.

Some things about it are worth knowing before trusting it:

- **Set the surface before you set off.** Every find is recorded against it,
  and it changes the score — the same hole on a footway is a trip rather than a
  jolt. It is one setting, shared with the confirm screen: set it in the menu,
  or tap the chip on the glass to flip it mid-run.
- **Entries are marked unconfirmed.** Nobody looked at them. They are saved as
  `survey, unconfirmed` and read that way in the log and the CSV, so they never
  pass for a category an inspector stood over. Treat them as a list of places
  to go and look.
- **It needs a strong opinion.** A find has to clear a higher confidence bar
  than the model's own floor before it is written down, because nothing is
  checking it at the time.
- **The same hole is not logged fifty times.** One pothole stays in shot for
  many frames and, from a vehicle, many metres. A find within twenty metres of
  the last one logged is taken to be the same defect. With no GPS fix there is
  no distance to compare, so it falls back to time alone — cruder, and the app
  says so when it starts without a fix.
- **It stops when the app does.** A web page cannot hold the camera once it is
  not the app on screen; the browser suspends it. So the survey runs with the
  app open and the phone mounted, and ends rather than pretending to watch.
- **Full screen needs a tap, and any tap will do.** Browsers only grant it off
  a gesture, so the first touch anywhere is spent on it. The viewfinder fills
  the screen without it, so a browser that refuses is not an error worth
  interrupting a run over.
- **The model is already there.** It used to be fetched on the first record
  tap, which put a several-megabyte download between someone parking at the top
  of a road and starting. It is now fetched the moment the app opens, and a chip
  by the camera state says whether it is loading, ready, or would not come.

## The frame the model is shown

The model is handed a 640 by 640 square, stretched, because that is what it was
trained on — and because a phone-shaped frame turned out to break the boxes
coming back from it. On a 1920 by 1080 frame a returned box measured 3145 by
5234: bigger than the picture, and wrong by 1.6 across and 4.8 down. A single
wrong scale is wrong by the same factor both ways, so two different factors
means width and height are being scaled by each other's axis — invisible while
the input is square and ruinous the moment it is not.

The square also puts the boxes, the shadow test and the share of the frame in
one coordinate space, which removes a rescaling step that used to sit between
them.

One thing to know if you compare old entries with new: the share of the frame
is now measured against that square rather than against the camera's own
dimensions. Stretching preserves proportions, so a defect covers the same
fraction either way — but a box measured in one space and divided by the other
does not, which is what the older numbers were.

## Which way up the model is being shown the road

The app turns itself when the viewport is portrait: `#app` rotates **+90°** so
the chrome reads landscape, and `.live video` is counter-rotated **−90°** so the
preview looks upright.

Neither of those touches the video element's own pixels — and `squareFrame()`
draws exactly those. **So in forced-landscape the operator is looking at an
upright road and the model is being handed the same road a quarter turn over.**
Nothing on screen said so, and the CSS carried a comment claiming the opposite.

The diagnostics screen now reads both rotations out of the DOM and prints them:

```
ORIENTATION
  source     1920×1080 (camera)
  camera     1920×1080 — landscape as the browser hands it over
  screen     portrait-primary, angle 0
  viewport   portrait
  app turned 90°   video turned -90° (on screen only)
  fed to model  the raw camera frame, turned 0°
  >> WHAT YOU SEE IS TURNED -90° BY CSS. WHAT THE MODEL GOT IS TURNED 0°.
     They are 90° apart. The preview is not evidence of what the model was shown.
```

### Four ways up

One button runs the same frame at 0°, 90°, 180° and 270° and prints the best
score for each. It answers one question and answers it decisively: **is the
model failing on this road, or on this road sideways?** If 0° wins, orientation
is ruled out. If it does not, the frame is reaching the model a quarter turn
from upright and no amount of retraining is the right response.

It is four inferences, so it is slow, which is why it is a separate button
rather than something every test does.

**The survey loop is untouched.** This release measures the problem; it does not
rotate anything.

## Where the time goes

A single "inference: 21353 ms" is not a finding — it cannot tell a slow graph
from a model being rebuilt on every press. The report splits it:

```
TIME         preprocess    18 ms   (draw to 640² and make a bitmap)
             execute       21200 ms   (the graph itself)
             read+decode   153 ms   (readback, boxes, scores, NMS)
             encode        41 ms   (the JPEG for the screen)
             whole test    21412 ms
model loads  1 initialise for 3 inferences  — loaded once and reused
```

The split matters for a second reason: on the CPU backend `execute` is
synchronous and its figure is the real cost, but on WebGL `execute` only
enqueues kernels and the cost lands later at the `dataSync` inside the decode.
One combined number would hide which of those was happening.

`model loads` is the first question a twenty-second inference raises. If it
stays at 1 while `inferences` climbs, the model is loaded once and reused, and
the time above is genuinely the graph running.

## What the survey runs on

Measured on this phone, on a photograph that already had a known answer:

| | warmed inference | detections | best | raw range |
|---|---|---|---|---|
| **WASM** | **533 ms** | 1 | pothole 0.7236 | 0 – 637.0227 |
| CPU | 17,692 ms | 1 | pothole 0.7236 | 0 – 637.0227 |
| WebGL | 174 ms | **20** | "manhole **407894400**" | −27024638 – 407894400 |

Three things follow from that table, and the survey is built on all three.

**WebGL is not slow, it is wrong**, and wrong in the most dangerous way
available: it answered a frame containing one pothole with *twenty* detections —
the library's own cap — at a confidence of four hundred million. A survey that
trusted it would have written down twenty phantom defects from one look. It is
therefore **not in the production list at all**, and there is no setting that
puts it there.

**CPU is not a slow backend, it is an unusable one.** At one look per ten metres,
17.7 s a frame is a survey speed of 1.25 mph — slower than walking. It stays as
the fallback because a phone that cannot do WASM should still be able to survey
a road badly rather than not at all, and because it is provably correct.

**WASM and CPU agree exactly** — not just the winning detection but the whole
output range, `0` to `637.0227` on both. That is what made the switch safe.

So the order is **WASM, then CPU**:

```
SURVEY_BACKENDS = ['wasm', 'cpu']
```

### Nothing here is a second implementation

The preprocessing, the decoder, the NMS parameters and the weight loader are the
same functions the benchmark used, called from a different place. That is
deliberate: **a production path that is not the measured path has not been
measured.**

### Initialising is not the test

A backend is not trusted because it started. Each one is brought up, given the
weights, and shown a picture before it is allowed near a road — and the picture
is a gradient with an edge in it, **not flat grey**, because a flat frame makes
every score and box zero and zeros cannot tell a working backend from one that
returns zeros. If the range that comes back is not plausible, that backend is
disposed of and the next is tried.

The same check runs on **every frame of the survey**, not once at startup and
then trusted forever. A backend that was sane at eight o'clock and is not at
half past is dropped mid-run, the fallback is brought up on the next look, and
the diagnostics record what it produced when it went bad.

### "No model" was three different faults wearing one label

Three things have to happen before there is a model: 2.4 MB of TensorFlow.js off
this origin, the weights off Roboflow, and a backend that will run them. They
fail for different reasons and they are fixed by different people — and the
gauge said the same two words for all three, so the only way to tell them apart
was to open Diagnostics. Standing at a van looking at a phone, that is too much
to ask. The gauge now names the half:

| | what actually failed |
|---|---|
| **No runtime** | the 2.4 MB did not arrive from this site |
| **No weights** | the model did not come back from Roboflow — signal, or the key |
| **No backend** | both WASM and CPU were tried and neither would run it |

The reason still lives in Diagnostics. This is the difference between "it's
broken" and "the signal is".

### A service worker cannot fix the load that installs it

The vendored runtime used to go through the same network-first path as the app's
own code: a four-second timeout and `cache: 'reload'`, so all 2.4 MB was
re-fetched on **every** page load, and if any one of the five scripts took longer
than four seconds there was nothing cached to fall back on. The app said "No
model" and meant "this file was slow". Sending `/vendor/` down a cache-first path
instead fixed that — pinned filenames cannot change, so asking again can only
cost time.

And the fix arrived one load late. The page that fetches the new worker is still
being served by the old one, so *that* load still went through the old timeout
and still failed. Reproduced in `swupgrade.mjs`: the load that installs the fix
dies, the load after it succeeds. Telling somebody to open the app twice is not
a fix.

So a script that fails is asked for again, once, after the new worker takes
charge — `controllerchange`, which is a real event rather than a guess, capped at
a second and a half so a page with no worker does not sit waiting for one. Only
the file that failed is re-requested: re-running the chain would execute the
builds that already loaded a second time, and TensorFlow.js refuses to register
the same kernel twice.

A consequence of allowing a second attempt at all: the chain now records which
scripts have **run**, not which have been fetched, and skips those. Signal coming
back and a worker taking charge both start another attempt, and re-executing a
build that already loaded makes TensorFlow.js throw on the second registration of
a kernel it already has — which would turn a recoverable failure into a permanent
one. This was found by the regression suite, not by reasoning about it.

Diagnostics say when this happened, because it is worth seeing rather than
papering over:

```
runtime      loaded — asked twice for tf-core.min.js. The first request was
             answered by a service worker on its way out; that is the load a
             deploy lands on.
```

### It cannot pretend to be keeping up

At 30 mph a 533 ms inference covers five metres and the survey is fine. The same
533 ms at 70 mph covers nineteen, and one look is no longer one look at a stretch
of road. So the warning is computed from the speed actually being reported
rather than from a fixed threshold:

```
Slow inference — survey coverage reduced (53 m passes per look, not 10)
```

That replaces "Watching" rather than sitting beside it. A survey that quietly
claims coverage it is not achieving is the failure this whole application exists
to avoid.

### What it shows while running

Small and dim, on the glass, for whoever is not driving — and in full in
diagnostics:

```
Backend   WASM
Inference 533 ms
Last GPS  53.12345, -1.10001 ±8 m, 2 s ago
Speed     30 mph
Distance  7 m since last look
Next look 3 m
```

### The SDK is gone from the inference path

This is the part worth writing down. The survey used to infer through the
Roboflow SDK, and it cannot use WASM through it: **the SDK bundles TensorFlow.js
inside its worker and keeps it module-scoped — inside that worker `self.tf` is
undefined — so `tfjs-backend-wasm` has nothing to register itself against.**

So `loadModel()` now brings up the app's own TensorFlow.js and picks a backend,
and `engine` is an object with the same one-method shape the SDK's
`InferenceEngine` had: `infer(worker, image)` returning a list of detections.
Nothing downstream — `look()`, the real-frame test, the self-test, the
diagnostics — had to learn anything new.

A side effect worth having: **the six-megabyte SDK is no longer fetched to look
at a road.** Startup pulls 2.4 MB of TensorFlow.js instead.

## Which backend could run this, and how fast

The survey takes about twenty-one seconds a frame, and the timing split says
that is genuinely the graph running rather than the model being reloaded. So the
next question is not "why is it slow" but "is anything else on this phone faster
at the same work" — and that is a measurement, not an argument.

*Benchmark a photo* draws **one picture, once**, and runs it through WebGL, WASM
and CPU in turn. Same picture, same preprocessing, same weights, same decoder,
same NMS parameters. Drawing per backend would be comparing three different
pictures and calling the difference a backend.

**Use the photograph you already have an answer for.** The known result —
`pothole 0.7236, manhole 0.0047` — was measured on a file, and running that same
file through every backend is the only way to tell a faster backend from a
differently-wrong one. There is a camera button too, for a quick look.

### What it separates, and why each split earns its place

A single number per backend cannot answer the question, so five things are timed
apart from each other:

| reported as | what it is |
|---|---|
| `backend init` | choosing the backend and bringing it up. Once per session. |
| `model load` | fetching and building the 229 tensors. Once per session. |
| `preprocess_ms` | drawing to 640², normalising, NCHW. Every frame. |
| `execute_ms` | the graph. Every frame, and the number that matters. |
| `read_decode_ms` | readback, boxes, scores, NMS. Every frame. |

`backend init` and `model load` are excluded from the inference figures, because
**the survey loads the model once and reuses it** — charging every frame for a
cost paid once would misrepresent what a survey actually experiences.

Each backend runs **three passes**. The first is cold: it pays for kernel and
shader compilation and for whatever the backend defers until something asks. The
rest are warmed. Both are reported, and every individual pass is shown rather
than an average alone:

```
  execute_ms       118   (warmed; first pass 402)
  all passes       402, 121, 115 ms
```

Reporting only the first would libel a backend. Reporting only the warmed ones
would hide a cost that is real the first time a phone looks at a road.

### Three things the report is careful about

**SIMD, threads and the thread count are asked, not assumed.** SIMD and threading
come from the runtime's own `WASM_HAS_SIMD_SUPPORT` and
`WASM_HAS_MULTITHREAD_SUPPORT`. The thread count comes from
`tf.wasm.getThreadsCount()`, which **throws** before the WASM backend is up
rather than guessing — so it is asked after initialisation, and when WASM never
initialised the report says that instead of printing a zero. The core count is
shown separately and labelled as what the browser claims the phone has, which is
not what WASM uses.

Threads additionally need the page cross-origin isolated, which needs COOP and
COEP headers GitHub Pages does not send — so a "no" there is a fact about the
hosting, not about the phone, and the report says which.

**Fast and wrong does not win.** The ranking is *fastest usable*, and usable
means the same numerical sanity check the app already applies. WebGL has returned
`min -1834411, max 2634395904` on this phone twice, including with full precision
forced. A backend that returns garbage fast has not won anything.

**A faster backend that answers differently is a different model.** The report
ends with a comparison against CPU, because CPU is what produced the result this
whole exercise is measured against:

```
DO THEY AGREE?  (CPU is the reference — it is what produced 0.7236)
  cpu        pothole 0.7236, 1 detection
  wasm       pothole 0.7236, 1 detection — AGREES with CPU (within 0)
  webgl      output failed the sanity check — not comparable
```

A backend that is numerically sane but returns a different class, a different
count, or a confidence more than 0.01 away is marked **DIFFERS** and the reader
is told why that disqualifies it.

Everything each backend allocated is given back before the next one starts —
three backends each holding a copy of a 229-tensor model is how a phone runs out
of memory halfway down a road — and the outstanding tensor count is printed so
that is checkable rather than merely claimed.

### What this does not do

**It does not change what the survey runs on.** The survey still infers through
the Roboflow SDK, on whatever backend the SDK's own fallback picked. The
benchmark loads its own copy of TensorFlow.js and puts it away again.

That is a constraint rather than a preference: **the WebGL → WASM → CPU chain
cannot be delivered inside the SDK as it stands.** The SDK bundles TensorFlow.js
inside its worker and keeps it module-scoped and minified — inside that worker
`self.tf` is undefined — so `tfjs-backend-wasm` has nothing to register itself
against. Adding WASM to the survey means replacing the SDK's inference path,
which is a larger change and should be decided on the numbers this button
produces rather than before them.

## "The source image could not be decoded" — which end it came from

The diagnostics screen said this, under a heading that read REAL FRAME and above
a line that read `Camera: live, 1920x1080`:

```
Could not run it: The model failed while running.
(The source image could not be decoded.)
```

Every part of that pointed at the camera, and the camera was fine.

Those words are Chromium's, not this app's, and they are thrown by exactly one
thing: `createImageBitmap` handed a **Blob** whose bytes it cannot read. Probed
in the browser rather than reasoned about — every other way of failing gives
different words:

| what was tried | what Chromium says |
|---|---|
| `createImageBitmap(blob)`, bytes not an image | **The source image could not be decoded.** |
| `createImageBitmap(canvas)`, width 0 | The image source's width is 0. |
| `createImageBitmap(video)`, no frame yet | The image source is not usable. |
| `drawImage` from a closed ImageBitmap | The image source is detached |
| video → 640² canvas → `createImageBitmap` | *(no error)* |

This app calls `createImageBitmap` on a Blob in exactly one place: the **Test a
photo** handler. The camera path never does — it draws the video onto a 640²
canvas and converts *the canvas*, which is a different overload with different
failure modes. So the message came from a photograph the browser could not read,
almost certainly an **HEIC** — the format an iPhone saves by default and one no
browser decodes.

Two separate faults made that unreadable:

**It blamed the model for something the model never saw.** Any failure in the
test was funnelled through `whyLocal`, which prefixes "The model failed while
running". The model had not been asked anything. A failure before inference now
says so in those words — *the picture never reached the model* — names the file,
its type and its size, and for an HEIC says to export it as JPEG.

**Nothing said what had actually been handed over.** The report now checks the
source before the model is asked anything, and prints it:

```
SOURCE  (checked before the model was asked anything)
  given as   HTMLVideoElement
  readyState 4 — enough to play through
  video      1920×1080, playing
  drawn onto 640×640 canvas
  handed to model as ImageBitmap 640×640
  frame      brightness 45 to 93 — there is a picture here
```

`readyState` is the line that earns its place. **A video element that has stopped
producing frames still reports the size of the last one it managed**, so
`videoWidth` on its own is not evidence that there is a picture to draw — which
is why the old check, `if (!stream || !v.videoWidth)`, would wave a stalled
camera straight through. A source that cannot produce a frame is now refused
before anything is drawn, and says which `readyState` it was in.

The brightness line is reported and never acted on. A flat frame might be a lens
cap, a dark road, or a video element that quietly stopped, and this cannot tell
those apart — so it says what it sees and leaves the conclusion alone.

**Nothing about the camera path changed**, because nothing about it was wrong.
It still goes video → 640² canvas → `ImageBitmap` → `CVImage` → the same worker,
the same model and the same decoder as the survey.

## When the library hands back something that is not a list

The real-frame test failed with this, and the message is worth reading twice:

```
Could not run it: The model failed while running. (raw.forEach is not a function)
```

That names the method that was missing and nothing at all about the object that
was missing it — and the object was the whole answer.

`engine.infer` is documented as resolving with a list of detections. It does not
always. Inside the library, a failed worker request is caught and **returned**
rather than rethrown:

```js
return new Promise((accept, reject) => { ... })
  .then((c) => c)
  .catch((c) => {
    if (c === "Model initialization failed") throw new Error("Model initialization failed");
    return c;                     // <- the rejection becomes a fulfilled value
  })
```

So a worker that died mid-inference arrives looking exactly like a success. The
app's `takeDiag` then had a guard that let it straight through:

```js
if (!preds || !preds.length) return preds || [];    // a non-list falls out here
```

A truthy object with no `length` was returned unchanged; a string error message
has a `length`, so it did not even take that branch. Either way the next thing
done to it was `raw.forEach`, and **the worker's actual complaint was discarded
and replaced by a type error three frames downstream.**

The fix is not a `try`/`catch`. `takeDiag` now asks what it has been handed, and
says so:

```
raw type     string(35 chars) — what engine.infer returned
```
```
Could not run it: The model failed while running. (the model returned
string(35 chars) where a list of detections was expected — Error: inference
failed in worker 0)
```

`runtimeType` names the thing rather than guessing at it: `Array(n)`,
`Float32Array(50400)`, `Tensor(1×6×8400)` (recognised by having a `shape` and a
`dataSync`, since this file has no copy of tfjs to ask), `Error`,
`Object{status, res}` with its keys, `null`. Anything that is not a list stops
the run and reports itself. `null` is treated as a nil answer, because that is
what it is.

**A quiet empty list would have been the wrong fix.** It would turn a broken
worker into "nothing found", which is the failure this whole application is
built to avoid.

## The real-frame test

The diagnostics screen used to describe the model in the abstract: what Roboflow
says it is, what shape it returns, what it makes of a flat grey square. None of
that answers the only question that matters — point it at a pothole and does it
see one.

**Diagnostics now opens on a real-frame test.** A live preview of the camera
already running, a *Test the camera* button, and a *Test a photo* button that
takes a picture from the phone. Either one puts the frame through
`squareFrame` → `CVImage` → `engine.infer` → `usableFind` → the shadow test:
**the survey's own code, not a parallel path.** A diagnostic that exercises
different code from the thing being diagnosed is worse than none.

The picture is shown, not stored. It is never written to the database and never
leaves the device.

### What it reports, and why each line is there

```
REAL FRAME  (camera)
when         2026-08-28T10:17:18.459Z
backend      cpu  (forced — WebGL would not answer sensibly)
inference    412 ms   (whole test 460 ms, including drawing and encoding)
raw output   1×6×8400, min 0, max 636.4215
sane?        yes — box values in pixels for a 640 model, scores in 0..1

BEST ANCHOR  (the highest the model scored anywhere in the frame,
              before NMS and before any threshold)
             pothole  0.83  box x 320 y 360 w 180 h 150
             library keeps ≥ 0.5, the survey keeps ≥ 0.65

DETECTIONS   1 came back from the library
  #1  pothole  0.83  box x 320 y 360 w 180 h 150

THROUGH THE SURVEY'S OWN FILTERS
  #1  pothole 0.83 KEPT — the survey would log this

WOULD LOG    1 pothole
```

**The best-anchor line is the one that was missing.** Without it, "0 detections"
is two completely different findings wearing the same words: *the model saw
nothing*, or *the model saw it at 0.42 and the library's own 0.5 gate dropped it
before anything in this repository could look*. It is taken from the raw scores
before NMS and before any threshold, so it reports what the model actually
thinks regardless of what the pipeline then does about it.

**The filter trace is the second.** "The model found it and the shadow test
threw it away" and "the model never found it" used to look identical from
outside. Now each detection says which gate it died at, by name.

### The thresholds it prints

These are the library's own defaults, not the app's, and they were invisible
until now:

| | Value | Whose |
| --- | --- | --- |
| `scoreThreshold` | 0.5 | the library — drops detections before the app sees them |
| `iouThreshold` | 0.5 | the library — NMS overlap |
| `maxNumBoxes` | **20** | the library — the cap on returned detections |
| `SURVEY_CONF` | 0.65 | this app, applied on top |

That `maxNumBoxes: 20` is also the explanation for a symptom that went unexplained
for a long time: every broken run reported **exactly 20 results**. It was the cap
being hit, not a coincidence — when the output was noise, every anchor scored
above 0.5 and NMS returned as many as it was allowed to.

## Not knowing means not knowing

A find is believed only once every part of it has been checked: a class the app
has a type for, a box with a real position and a real size, and a share of the
frame that is a fraction between nought and one. Anything failing that is
dropped, not repaired, and if a frame produces results but none of them survive,
the app says so and writes down nothing.

This is here because of what happened without it. A survey returned twenty
results a frame carrying scores of 1.004 — and once 5,323,169.5, which is not a
confidence — and no measurable boxes. The share came out as not-a-number, every
comparison against not-a-number is false, and the band lookup ended with "return
the largest band". So an unmeasurable nothing scored impact 5, probability 4,
gained a point for being one of several, and was written into the log as an
**Emergency requiring attention within two hours**. Five of them, including a
photograph of the inside of a van.

The failure was not the model's. The app turned "I could not measure this" into
the most serious category it has, silently, in a tool whose output is a response
time. Every entry now carries the box it was measured from, so a wrong one can
be taken apart afterwards rather than guessed at.

### Why the numbers came back wrong

The library ships a decoder per architecture. `YOLOv11` is a subclass of
`YOLOv8` that overrides only the **input** side: YOLOv8 feeds the model
`[1, 3, 640, 640]` (channels first), YOLOv11 feeds `[1, 640, 640, 3]` (channels
last). It inherits YOLOv8's **output** handling unchanged — and that handling
transposes the result on the assumption of a channels-first output, which is the
one that goes with a channels-first input.

Running the library's own decoder arithmetic over both layouts settles what that
costs:

| Output layout | Decoder reads | Scores |
| --- | --- | --- |
| `[1, 6, 8400]` channels-first | 8400 boxes × 2 classes | 0.0025 – 0.83, all inside 0–1 |
| `[1, 8400, 6]` channels-last | **6 boxes × 8396 classes** | up to **599**, mostly outside 0–1 |

Read the wrong way round, the four box numbers of each row become the "boxes"
and everything after them becomes 8,396 "class scores" to take a maximum over —
so the score is really a pixel coordinate, which is why confidences came back in
the hundreds. The boxes still look plausible, because raw pixel coordinates
divided by 640 land in a believable range. That is why it was believed: a
detection with a sensible-looking outline and a nonsense confidence.

An entry logged that way is in the log at the top of this README's cautionary
tale: a living room, scored Category 2, on a 28-day clock.

So the model is a **yolov8n**, not a yolo11n — the change is about the library,
not the data. Both were fine-tuned from COCO on the same 17,497-image, two-class
version; only the architecture differs, and yolov8 is the one whose input and
output layouts the decoder agrees on.

The version still carries the yolo11n model too, which is why the app names the
yolov8n one exactly rather than asking for whatever is deployed on version 1.

The transcribed arithmetic is kept as a test so this stays a finding rather than
a memory.

It is a short run — 50 epochs rather than the default 300 — deliberately.
Epochs do not change how a model's output is laid out, so a long run would have
proved nothing about decoding that a short one does not. Now that the path is
proven, a longer run is worth having and costs only time.

### What shape the tensor came back in

The channels-last explanation above was checked in the field and is **not what
is happening**. The app reported: twenty results, confidences from 2,678,873 to
89,622,600, boxes to match, and — from the diagnostic — *"Roboflow calls it
yolov8n, decoded by YOLOv8"*. So the architecture and the decoder now agree, the
frame is the 640 square it should be, and the numbers are still nonsense. Twenty
results also rules the earlier theory out: read channels-last, the decoder finds
six candidates at most, and it found twenty.

Which leaves one thing still invisible — the shape of the tensor itself. That is
decided inside the library's worker and never comes out. So the vendored copy
now says: the raw output shape, how many outputs the graph returned, the shape
after the library's transpose, the box and class counts derived from it, and the
first eight raw values. It appends one record to the results, the app strips it
before anything else looks, and it goes on screen and into the export under
`lastUnusableOutput.tensor`.

`vendor/PATCHES.md` says exactly what was changed and how to re-apply it; the
patch itself is `scratchpad/patchsdk.py`. It adds a diagnostic and alters no
decoding.

### What the tensor turned out to be

Reported from the field: **output `1×6×8400`, transposed to `1×8400×6`, read as
8400 boxes × 2 classes.** Every one of those is correct — 4 box numbers plus 2
classes across 8,400 anchors is exactly a two-class YOLOv8 head, and the
decoder's reading of it is exactly right. The shape was never the problem.

The first eight values were:

```
33.4581, -7160, 33.4581, -7160, 33.4581, -7160, 33.4581, -7160
```

Laid out as the decoder reads them, that is anchor nought:

| channel | value |
| --- | --- |
| cx | 33.4581 |
| cy | −7160 |
| w | 33.4581 |
| h | −7160 |
| class 0 | 33.4581 |
| class 1 | −7160 |

Six channels collapsing to two alternating values is not a misread. It is what
the graph emitted. Which is why the box came back with its width equal to its x
and its height equal to its y — those really are the same number.

So the fault is upstream of the decoding, and two possibilities look identical
from inside a phone: the exported graph is broken, or what the library hands it
is. The app now separates them by running the model once on a **flat grey
square** — no edges, no texture, nothing to find. A working detector answers
that with low confidences and nothing worth reporting. Confidences in the
millions on a picture of nothing mean the output does not depend on the input at
all, and the fault is not in this app. The verdict shows on the model chip and
travels in the export under `model.selfTest`.

### The model is not the problem

It was possible to settle this rather than argue about it. The diagnostics
screen reports the address the weights are served from; that bucket is public,
so the whole graph — `model.json` and three shards — can be pulled down and run
away from the phone with plain TensorFlow.js.

Shown a flat grey square, off the phone, it answers:

```
shape [1,6,8400]   min 0.0000   max 637.6417   mean 149.86
first 8: 13.7809, 18.2834, 24.1905, 30.3092, 34.6762, 40.5797, 47.6760, 57.5951
```

Box coordinates in pixels for a 640 model, exactly as they should be, and they
move when the picture changes. The same graph on the phone answers the same
picture with a maximum of 2,161,938,688.

So the export is sound, the weights are sound, the quantisation is sound, and
the training is sound. **The fault is what the browser is running it on.** The
usual reason is half-precision render targets: float16 stops at 65504, and this
head reaches 640 with far larger intermediates.

That also gives the app something it never had — a **known right answer**. It
now warms the model up, reads the range, and if it is not a reading of anything,
asks for full precision and rebuilds the backend; failing that, drops to the CPU
backend, which is slow and correct. Correct and slow beats fast and wrong in a
tool whose output is a response time.

It reads under **PRECISION** on the diagnostics screen, every attempt with what
it returned, and the chip says *precision forced* once if it had to intervene.

### Which way round the picture goes in

One thing was still untested rather than unknown. The library feeds a YOLOv8
export channels-first, `[1, 3, 640, 640]`. A tfjs graph converted from PyTorch
usually wants channels-last, `[1, 640, 640, 3]`. A graph handed the wrong one can
throw — or it can quietly return a tensor of exactly the right shape full of
numbers that mean nothing, which is indistinguishable from a broken model until
you look.

So the vendored library now runs the same picture through the graph **both ways
round**, once, and **uses whichever answers sensibly**. Three outcomes and each
is an answer:

- the other layout **refused** — the layout is right. This is what actually
  happened: the graph requires `[1,3,640,640]` and says so. Nothing changes.
- the other layout came back **in range** — the layout was the whole fault, and
  the app now feeds it that way round. The chip says *layout corrected* once.
- **both** came back in the millions — the graph is broken whatever you feed it,
  and the chip says *model answers nonsense*.

The test only has to separate a reading from a non-reading, so it is crude on
purpose: a raw YOLO head holds box values in pixels and class scores near 0..1,
so anything past ten thousand is not a reading of anything.

It reads on the diagnostics screen as three lines under **INPUT LAYOUT** —
what the library assumed, the other way round, and which one is being used.

### Diagnostics

All of that used to live only in the JSON export — which is hidden until
something has been logged. So the one screen that says why nothing *can* be
logged was locked behind logging something. It has its own entry in the menu
now, always reachable, with nothing in the log and no signal.

It is text on the glass rather than a file: a phone is a poor place to find a
downloaded `.json` and a bad place to read one. **Copy** puts it on the
clipboard; **Save as text** writes a `.txt` for when the browser refuses to
copy. It carries the build, what Roboflow says the model is, which decoder that
picks, the self-test verdict in words, the tensor shape, and the raw values.

It also carries the address the weights are served from, so the graph can be
pulled apart off the phone — and nothing about where anyone has been. That
address is a link to the owner's own model, which is why it is on a screen they
choose to open and share rather than in the corner of every screenshot.

### What model this actually is

The library picks its decoder from one field in the model's metadata, inside a
worker with no way to see in. That made every decoding fix a guess checked
against a screenshot. It does not have to be: the metadata is a plain GET, so
when something has already gone wrong the app fetches the same document and
says what the library will have made of it — the model type Roboflow reports and
the decoder class that type selects. It goes on screen and into the JSON export
under `model.roboflow`.

The dispatch table is copied out of the library's own bundle, which is not ideal
but beats guessing. One thing it makes visible: there is a case for `yolov11`
and none for `yolo11`, so a model whose type is spelled without the `v` is
refused outright rather than mis-decoded — worth being able to read rather than
infer.

Nothing is asked for while the app is working. A run that logs cleanly spends no
request on this.

### When it says the output is unusable

It also says what came back: how many results, which keys they carried, the
range of the confidences, and how many had a box that could be measured. The
same summary, the frame size, and one result verbatim go into the JSON export
under `lastUnusableOutput`, alongside the model id and the build.

That is there because the shape the library builds is fixed — class, confidence,
bbox — so when the numbers inside it are wrong, it is the model's output layout
that does not match what the library expects. Which model to try instead is a
guess, and every guess otherwise costs a deploy and a drive. The ranges say
which.

## Shadows

Tree shadows across a carriageway are what this model gets wrong, and it is
easy to see why: a dark irregular patch on tarmac is the thing it was trained
to find. Raising the confidence bar does not help, because the model is as sure
about the shadow as it is about the hole.

What separates them is not darkness, it is texture. **A shadow is the road with
the light turned down** — the same chippings, the same grain, scaled. A hole
breaks the surface: a rim, broken edges, loose material. So each find is
measured against the road immediately around it, and a patch that is
substantially darker but grained exactly like its surroundings is thrown out. A
long thin band, the shape a tree or a pole throws, is thrown out on shape alone.

On synthetic road, a dimmed patch scores 1.00 against its surroundings, a
broken-up hole scores 9.99, and a shallow worn hollow — the hardest real case —
scores 2.59, against a cut-off of 1.18. The margin is wide, but it is a filter
and not a cure, and it cuts both ways: **a real hole in deep shade looks smooth
and can be waved through as a shadow.** That is a miss, and the survey says on
screen when it has thrown something out as a shadow rather than doing it
quietly.

## Ironwork

The model knows two things: potholes and manholes. The second matters because
of what it is **not** — a sound cover is part of the road, not a defect. Its
value is negative: knowing a dark round thing is a cover is what stops it being
written down as a hole, which is what the previous single-class model did every
time.

So ironwork is recognised and passed over. A survey does not log it — one that
wrote down every manhole it drove over would bury the finds that matter — and
says so on screen when it does, so a cover you know is rocking does not simply
vanish without comment. Whether a cover is sunken, proud, rocking or cracked is
decided on site and is not in the photograph, so a defective one is a job for a
person standing over it, not for this.

## Confirming an entry

Everything the survey writes down is a machine's opinion, and the log says so:
`survey, unconfirmed`, a dashed border, and one orange **Confirm** button. That
opens the photograph, the matrix with the proposed cell already selected, what
the model said at the time, and what was recorded about the fix. Accept the
cell and the entry reads `app proposal, accepted`; tap a different one and it
reads `inspector`. Either way it stops being unconfirmed, and the GeoJSON
export carries `confirmed: true` so an asset system can filter on it before
anything starts a statutory clock.

Confirming is the only way an entry becomes a person's judgement. That is
deliberate: there is no longer a path that produces a signed-off score without
someone having looked at the photograph.

## Putting an entry right

The model has one class, so everything it finds is offered as a pothole. An
inspection cover, a gully grate or a worn joint is a real defect in the wrong
words — deleting it loses a defect, so entries can be amended instead. **Amend**
sets the type and the surface, marks the entry as amended, and where the score
was the app's proposal rather than yours, moving it between surfaces re-scores
it. A score you chose is yours and is left alone.

Four things can be done with an entry, in rising order of finality: confirm it,
amend it, mark it as not a defect (which keeps it as a correction), or remove it
outright.

## Teaching it

The app cannot teach the model. A model learns by being retrained on labelled
examples, and nothing in a web page can do that.

What it can do is keep the evidence. Any entry can be marked **Not a defect**:
it leaves the log — a thing you have said is not a defect must never read as
one — and is kept as a correction with its photograph. Corrections travel in
the JSON export, under `notDefects`, which is exactly what a retraining run
needs: examples of what the model called a pothole and a person did not.

Feeding them back is a job for Roboflow, not for this app: upload them to the
project as negative examples, train a new version, and change the model id in
`app.js`.

> The JSON export changed shape for this. It used to be a bare array of
> entries; it is now `{ "defects": [...], "notDefects": [...] }`. CSV is
> unchanged and still carries the defects only.

## What the photograph can and cannot tell you

This is the part to understand before trusting a proposed score.

The model is good at one thing: finding a pothole in a photograph and drawing
round it. It correctly finds nothing when you point the camera at your
dashboard.

What no single photograph can give you is **scale**. A small hole photographed
from close up fills the frame exactly like a large one photographed from
further back. The app's size band is therefore a proxy, and it is only worth
anything under the assumption printed on screen every time: that you are
standing over the defect with the phone pointed down, which is how these
photographs actually get taken. Photograph one from a van window and the
proposal is meaningless.

And a photograph says nothing at all about **depth**, the speed limit, the
traffic, the footfall, or whether the defect sits in the wheel track or the
gutter. Those are half of what probability means on the matrix. The app fills
that half from the surface type and the number of defects it can see, which is
a starting point and not a judgement.

So: the proposal exists to save you the tapping, not to make the decision. The
category it lands on drives a two-hour or one-working-day obligation, and the
app is explicit on the confirm screen that the cell wants checking before it is
signed off.

Detection runs on the phone. The model is downloaded once, as the app opens,
and kept — so the first opening needs a signal and none of the ones after it
do. The chip by the camera state says where that got to. Until it has loaded
somewhere with a signal, recording says the model is unavailable and logs
nothing.

This is the second attempt. The obvious approach — post the photograph to the
hosted inference API — works from a terminal and cannot work from a web page:
the service answers, and the browser will not hand a page a reply from a
service that has not agreed to be read by one. That is not a bug to work
around. Running the model here instead means the only thing crossing the
network is the weights, once.

One thing was lost in the move. Running on the phone rules out segmentation —
the library carries detection architectures only — so the defect arrives as a
box round it rather than an outline. A box is generous around an irregular
hole, so the size band reads slightly high. The app says so on screen.

When a check fails, the panel says what went wrong: the service refused it
(with the status and whatever the server itself said), it timed out, or the
request never completed. That last one arrives as a bare error the browser will
not explain, so the app asks again with the reply waived — a request nothing
can be read out of. If that one comes back, the service is reachable and the
problem is that it will not let a web page read its answer; if it does not,
there is no route to the service at all. Two different problems that look
identical until something separates them. They are different problems with different fixes, and a screen that
collapses them into "the service did not answer" leaves you guessing at one the
server already explained.

## Priority is the app's; category is a person's

The survey used to write a statutory response category on every find. It worked
it out from the defect's share of a 640-pixel square, which is a function of how
far away the camera was at least as much as of how big the hole is — and then
printed *Emergency, 2 hours* or *Category 2, 28 calendar days* beside it. Those
words are the categories a highway authority works to, and in practice they key
on **depth and plan dimensions**, neither of which this app measures. It no
longer writes them.

What it writes on its own is a **priority**:

| Risk factor | Priority | Meaning |
| --- | --- | --- |
| 16 and over | P1 | Look at first |
| 9–15 | P2 | Look at soon |
| 6–8 | P3 | Look at later |
| Under 6 | P4 | Lowest |

There is no time attached to any of them, because attaching one would be
inventing a legal obligation out of a box on a screen. The thresholds are the
same numbers the risk matrix is coloured by, reused so a survey find and a
scored find sort together. They are the app's own ordering of its own finds and
they are not taken from any standard — if they are wrong, they are wrong about
the order of a work list rather than about a duty. The export says as much on
every row.

A **statutory category** is created in exactly one place: the confirm screen,
where someone is looking at the photograph and choosing a cell. It is written
with `catBy` and `catAt` beside it, naming who assigned it and when, and
`statutoryOf()` is what decides whether an entry has one — it looks for that
name, not for a filled-in field.

That last part is what makes old data safe. Entries written by earlier builds
carry a category the survey chose for itself and nobody ever read. The fields
are kept, because deleting them would lose what the app said at the time, but
they no longer read as a classification anywhere: not in the log, not on the
map, not in any export. Their score still yields a priority, so nothing sorts
differently and nothing disappears.

On screen the two never look alike. A priority is shown in the app's own orange
with the words *app priority* beside it and *not classified — no response time*
under it; a category is shown with its response time and who assigned it. The
map key shows both palettes and labels which is which. In the exports,
`app_priority` is always filled and `statutory_category` is empty except where a
person put something there — `category` and `response_time` keep their old names
so an existing import does not lose a column, and hold the same nothing.

## The matrix

The matrix is what a person uses on the confirm screen. Risk factor is
impact × probability, and the category follows the number:

| Risk factor | Category | Response |
| --- | --- | --- |
| 25 | Emergency | 2 hours |
| 16–20 | Category 1 | 1 working day |
| 9–15 | Category 2 | 28 calendar days |
| 6–8 | Category 3 | 90 calendar days |
| Under 6 | Below threshold | No response category |

### How a cell gets proposed

The defect's share of the frame picks a band, and the surface adjusts it:

| Share of frame | | Carriageway | Footway / cycleway |
| --- | --- | --- | --- |
| under 2% | barely registers | 1 × 1 | 1 × 1 |
| 2–6% | small | 2 × 2 | 3 × 3 |
| 6–15% | moderate | 3 × 3 | 4 × 4 |
| 15–30% | large | 4 × 4 | 5 × 5 |
| over 30% | very large | 5 × 4 | 5 × 5 |

A footway counts for more because the same hole is a trip rather than a jolt,
and pedestrians use the whole width rather than two wheel tracks. Three or more
defects in one frame add a point of probability, on the grounds that a cluster
is harder to steer around. Everything else — depth, speed, volume — is yours.

## What gets recorded

Time, coordinates, GPS accuracy and fix age, defect type, surface, impact,
probability, risk factor, the app's priority, the statutory category and
response time where a person assigned one along with who assigned it and when,
whether the score was yours, an app proposal you accepted, or an unconfirmed
survey find, what the model saw (its confidence, the share of the frame, how
many defects), your notes, and the photograph.

Depth and "wider than a tyre" are no longer collected, and the Cat 1
escalation test that stood on them has gone with them. Entries saved before
that change keep their gauged depth, still show it in the log, and still export
it — the CSV carries those two columns for as long as any entry has one.

## Where the defect is, as opposed to where the phone was

The app used to write down the last GPS fix at the moment the row was written.
Three things were wrong with that and all three are fixed.

**The fix could be five seconds old.** `maximumAge: 5000` let the browser hand
back a cached position, and at 30 mph a vehicle covers 13.4 metres a second — so
the recorded point could be sixty-seven metres behind the camera with nothing to
say it was. One second is asked for now. The trade is worth stating: with
`enableHighAccuracy` the receiver is already running, so `maximumAge` governs
whether a cached fix may be reused rather than how often the chip is woken — the
battery cost is small but not nothing. It buys nothing about how *good* a fix is,
only about how *current*; a ±10 m fix from five seconds ago is wrong about where
you are as well as vague about where you were. The 15-second timeout stays, because
shortening it turns a slow cold start under trees into an error rather than a fix.

**The timestamp was the write time.** Inference, the shadow test and encoding a
JPEG take a second or more on a mid-range phone, during which the vehicle moves
and `watchPosition` very likely replaces the fix. The frame is the observation,
so it is stamped when it is taken, and the fix is *copied* at that moment rather
than referenced — a later update cannot change what a frame was taken against.
`t` and `captured_at` are the frame; `stored_at` is the write, kept separately
because the gap between them is itself worth being able to see.

**Nothing recorded which way the vehicle was pointing.** `coords.heading` and
`coords.speed` are free, already in the payload, and were being thrown away.
Heading is what separates the two carriageways of a dual carriageway: without it
there is no way to tell a defect seen going north from a different defect seen
going south at the same coordinates.

A phone reports a heading only while it is moving, and some devices never report
a speed at all. **What comes back for those is `null`, and it stays `null`.** A
survey that filled in a plausible zero would be claiming the vehicle was pointing
north and standing still, which is a statement about the world rather than an
absence of one. (`+null` is `0` in JavaScript, so this had to be rejected before
the coercion rather than after it — the test suite caught that as a fabricated
due-north heading and a camera lead of zero metres.)

### The estimated defect position

The defect is on the road *ahead*, not under the vehicle. Every entry now carries
two positions and never confuses them:

| Field | What it is |
| --- | --- |
| `lat`, `lon`, `acc` | Where the vehicle was. Measured, unmodified, same names as before. |
| `heading_deg`, `speed_mps` | What the device reported, or null. |
| `estimated_defect_lat/lon` | The fix projected forward along the heading. |
| `position_confidence_m` | How wrong that could be. |
| `camera_lead_m` | The lead it was worked out with. |
| `position_note` | When there is no estimate, why not. |

The estimate is made only when there is a fix, a heading, and a frame taken
within three seconds of it. Missing any of those means **no estimate** rather
than a worse one, and the reason travels with the entry so the log can say why.

### The camera lead, which is not calibrated

How far ahead the camera looks depends on the mount angle, the height and the
lens — somewhere between about five and fifteen metres for a phone on a
windscreen. **Nobody has measured it for this setup.** Eight metres is a guess.

It is a field at the bottom of the log rather than a constant buried in the
source, precisely so that somebody can calibrate it: drive a defect whose
position you know, compare it against what the app recorded, set this to what
closes the gap, and write down which vehicle it was measured in. Until then the
whole of the lead is added to the error bar — a metre of lead buys a metre of
doubt.

The radius is the sum of three separate ignorances rather than a statistical
combination of them: the fix's own accuracy, the whole of the camera lead, and
half the distance travelled between the fix and the frame (or the lead again, if
the speed is unknown). Adding them gives a number larger than a careful treatment
would. That is the right direction to be wrong in — the radius is a promise that
the defect is probably inside it, and one that is too generous costs somebody a
longer look, while one that is too tight sends them to the wrong place.

**None of this is claimed to be accurate.** It has not been tested against a
defect whose real position is known. What it does is stop the app implying a
precision it never had: the log labels every position as *estimated defect
position* or *vehicle position, not the defect's*, and the map draws the
confidence radius as a circle under the pin, so a pin sitting confidently on the
wrong side of a road reads as a best guess with a radius rather than as a survey
mark.

The GeoJSON geometry is the estimated position, because that is what anything
with a map in it will drive somebody to; the vehicle position rides alongside in
`vehicle_lat` / `vehicle_lon` with `position_source` saying which is which.

## An observation is not a defect

Every row in this app used to be a sighting, and a sighting was treated as a
thing. Drive the same road twice and you had two defects; drive it fifty times
and you had fifty. Nothing downstream of that works — you cannot say a defect is
getting worse, or that a repair happened, or how sure you are that it exists,
because there is nothing for those to be properties of.

There are two stores now.

An **observation** is one detection event: a frame, a box, a position, a
photograph, a timestamp. It never changes after it is written. A **defect** is
the thing in the road that observations are of, and it does change — it gains
observations, its position estimate improves, its status moves on.

The object store names are historical and deliberately left alone: `defects`
holds observations, because renaming an object store means copying every
photograph in it and there is no version of that worth the risk. The code says
*observation* everywhere it means one.

Ids are UUIDs rather than timestamps. Two phones surveying the same round
produce colliding millisecond ids, and the day anything is combined the
collision is silent.

### What decides that two observations are of one defect

Same type; within `max(20 m, the two error bars added)` capped at 80 m; and
pointing the same way where both headings are known. More generous than the
within-a-run duplicate radius, because this is mostly asking about a later pass
on a different day where the two fixes are independent rather than nearly
identical. An observation with no position becomes its own defect rather than
being attached to whichever one happened to be nearest in the list.

A defect's position is the accuracy-weighted mean of its observations —
`1/r²`, so a ±6 m observation moves it far more than a ±40 m one — and the
combined radius shrinks as evidence accumulates but **never below the best
single observation**, because averaging vague positions cannot manufacture a
precise one.

### Provisional, confirmed, verified

| Status | What it means |
| --- | --- |
| `provisional` | Seen on one pass. Not yet claimed to exist. |
| `confirmed` | Seen on two or more independent passes. |
| `verified` | A person has looked at it and signed it off. |

A **pass** is one press of the record button — one survey run, with its own id.
That is the only version of "independent" this app can honestly measure: fifty
frames of one hole on one drive is one opinion; three drives on three days is
evidence.

Remove one of a defect's two observations and it goes back to `provisional`. The
runs are rebuilt from the observations that are actually left, so a defect cannot
keep claiming two passes once the evidence for one of them has been deleted.
Losing the status is the point — it is a claim about how much is known, and less
is known now. Remove the last observation and the defect goes with it: nothing is
left in the store with no evidence behind it.

### Migrating what was already there

Every existing entry becomes **one observation of one provisional defect**.

It would be possible to cluster them retrospectively — they have positions — and
it would be wrong. Those positions are the *vehicle's*, recorded with no heading,
from fixes that were allowed to be five seconds old. Merging two of them would be
a guess presented as a finding, and unmerging it afterwards is not something the
app can offer. One each, provisional, and any real grouping comes from passes
made after this build.

The runs behind them were never recorded, so their pass count is **null, not
one**. Not knowing has to mean not knowing.

The upgrade transaction only creates the store; giving the existing rows their
defects happens afterwards in ordinary code, where a failure can be reported
rather than aborting the upgrade and leaving the database on the old version with
no explanation. A partial migration is simply retried on the next load, and rows
that already have both ids are left alone — so it is a no-op on every load after
the first.

### In the exports

CSV and GeoJSON gain `observation_id`, `defect_id`, `defect_status`,
`defect_observation_count`, `independent_pass_count` and `run_id`. The JSON
export keeps `defects` as the observation list, for compatibility, and carries
the defects themselves beside it as `physicalDefects`.

### What this deliberately is not

It does not cluster retrospectively, it does not merge defects, and it does not
run in the background. Anything cleverer belongs on a server with every device's
observations in front of it, and building it here would mean building it twice.

## Telling one defect from the one before it

The old check compared the current vehicle position against the vehicle position
of **the single most recent find**. Two things were wrong with that. One slot,
so driving past a defect, logging something else twenty-five metres on and
coming back logged the first one again. And vehicle-to-vehicle rather than
defect-to-defect, so it was really asking *have I moved* rather than *is this
the same hole*.

A ring of the last thirty finds replaces it, compared on the estimated defect
position where there is one. A candidate has to match on **all three** of these
before it is called the same defect:

- **Position**, within `max(15 m, 2 × the worse of the two error bars)`. A fixed
  radius is either too tight for a poor fix or too loose for a good one. Past
  60 m the fixes are too vague to separate anything, and position is abandoned
  rather than trusted — it falls back to the crude time rule instead, because a
  threshold wide enough to cover a bad fix is wide enough to swallow every real
  neighbour on the street.
- **Heading**, within ±45° where both are known. The same coordinates seen
  travelling the other way is the other carriageway, which is a different asset
  with a different crew going to it.
- **Time**, either within a minute or the vehicle has not travelled 30 m — so a
  hole that stays in shot keeps suppressing, and one left behind stops.

A test that *cannot* be applied — no heading on one side, no position on either
— abstains rather than voting either way. Suppressing a real defect is the more
expensive mistake of the two, so the tie goes to logging it.

### Standing still

A vehicle stopped with a pothole in shot will photograph it as many times as it
is asked to. Below **1 m/s** nothing new is coming into frame, so nothing is
looked for: it saves the battery and stops a queue at a junction becoming forty
rows.

Only when the speed is actually known. A device that does not report one is not
standing still — it is a device that does not report a speed, and treating the
two the same would silently stop the survey on hardware that works perfectly
well.

### One look every ten metres, not every 1.2 seconds

A fixed cadence means a survey at 40 mph looks every 21 metres and the same
survey at a red light looks every 21 centimetres. The interval that matters to a
survey is a *distance*, so coverage does not change with the traffic.

Speed converts one into the other, and it is not always reported — so this
refines the old behaviour rather than replacing it. **With no speed the fixed
1.2 s interval stands.** With one, the delay is `10 m ÷ speed`, clamped between
0.7 s (below which the phone cannot finish one inference before the next is due)
and 4 s (above which a crawl stops being a survey). Stopped, it idles at the
ceiling — waking to check, not staring.

### The screen staying awake

A survey ends when the screen sleeps, because the browser suspends the page and
the camera with it. The Screen Wake Lock API is asked for when a survey starts
and released when it stops.

It is asked for and **never waited on**. Safari came to it late and some Android
browsers still refuse, so every path treats failure as normal: a browser with no
`navigator.wakeLock` at all surveys and logs exactly as it would with one, and
says once that the phone's own screen timeout needs setting long enough for the
run. A lock the system takes back — a call arrives, the battery saver comes on —
is recorded rather than treated as an error, and asked for again when the app is
back in front. Diagnostics reports which of those happened, and the cadence the
survey is actually running at.

## Three-word addresses

A what3words key ships with the app, so every located entry picks up a
three-word address as it is logged. It is looked up once, when the entry is
written, because the address of a fixed point never changes.

**The address is shown in place of the coordinates**, in the log and in the map
popup, because it is the thing a person reads out on a radio or types into a
van's satnav — six decimal places of latitude is not. The coordinates are still
what is stored and what every export carries; they are simply not the useful
thing to put on screen. Accuracy stays alongside it either way, because how well
the fix is known is not a detail. An entry logged before the lookup could run,
or with no signal, still shows its coordinates.

### The key is not a secret, and cannot be made one here

That key is readable by anyone who opens the source. That is not a slip; it is
what putting a key in a static site means. A page with no server behind it has
nowhere to keep a secret that the page itself can still use, so any key the app
can spend is a key it has handed to whoever is reading it. Obfuscating it would
make it slower to find, which is not the same as protecting it.

**The protection has to be at what3words' end.** Their dashboard restricts a key
to a list of referring domains. Restricted, a copy of this key is worth nothing
anywhere else, and that — not anything in this repository — is what stops it
being spent by a stranger. It has to be set there. Until it is, the key is
billable by anybody who finds it.

What the app can do is narrower, and it does it: **the built-in key is used only
on the site it belongs to.** `W3W_HOSTS` in `app.js` lists the hostname the key
is for. A fork, a preview deployment, a copy someone runs from their own Pages
account or a developer running it on localhost gets no key at all rather than
this one — so none of them spends this account's quota by default. They are not
locked out of what3words; they are asked to paste their own key, which is kept
on the device and works everywhere. The log says which of the three states it is
in, and so does the Diagnostics screen, without printing the key.

This is a mitigation, not a fix. The fix is a backend: the lookup moves behind
it, the key lives in server configuration, and it stops being in the page at
all. That is deliberately not built yet.

The field in the log stays for the same reason it always did — paste a different
key over it to bill another account, or clear it to stop the lookups and keep
coordinates only. An emptied field is treated as a decision and stays empty; it
does not quietly revert to the built-in key on the next load.

The lookup needs a signal, which coordinates do not, so it is never allowed to
hold up or fail a save: the entry is written first and the words are added
afterwards if they arrive.

## The map

**Map** in the menu puts every located defect on one. Pins carry a statutory
category's colour where a person assigned one, and the app's own priority colour
— orange, deliberately not the statutory palette — where nobody has. A survey
find nobody has confirmed is drawn hollow rather than filled: a map that showed a
guess and a judgement as the same mark would be worse than no map. Tap one for
what it is, its type, surface, coordinates, three-word address where there is
one, and when it was logged.

Leaflet is vendored, so the map is part of the app and runs with no signal. Its
tiles are not: they come from OpenStreetMap as you pan, and are cached as they
arrive. Ground you have already looked at stays available offline; ground you
have not comes up blank until there is a signal. The app says so on the screen
rather than leaving you to wonder why a map is empty in a lay-by.

## Storage and export

### Two ways this could have lost a day's work

**Map tiles used to share the app's cache, uncapped.** A deploy deletes every
cache but the current one, so a new build threw away a county's worth of tiles
somebody had driven to collect — and with no cap at all, panning around long
enough grows the cache until the origin hits its storage quota, at which point
the browser is entitled to evict the whole origin, defect database included. A
map's convenience must not be able to take the log with it. Tiles now live in
their own cache, which survives deploys and holds about 600 of them (roughly
6–18 MB at OpenStreetMap's tile sizes). Over that, the oldest go first —
`cache.keys()` answers in insertion order, so the front of the list is the
ground looked at longest ago. Trimming happens off the response path, so a tile
that has already been handed back never waits for housekeeping.

**The JSON export used to build the whole file in memory, twice.** Every
photograph was read to a base64 data URL, all of them at once, and then
`JSON.stringify` built one more string containing all of them again. A 200 kB
JPEG is about 270 kB as base64, so four hundred entries is over 100 MB of
JavaScript string held twice on a phone — and it does not fail politely: the tab
is killed and the export is gone.

It is now written a row at a time. Photographs are read one at a time, so only
one is on the heap at once, and the pieces of the document are handed to a Blob
as they are made: once a few megabytes have gathered they collapse into a Blob,
which the browser holds outside the JavaScript heap and spills to disk, and that
Blob becomes the first piece of the next batch. **Peak memory is one chunk plus
one photograph, whatever the size of the log.** The file that comes out is
unchanged.

It is a stream in the sense that matters — nothing whole is ever resident — but
it is **not a streaming download**: the file is finished before the browser is
asked to save it, because a page cannot hand a save dialogue something it is
still writing. A log large enough to fill the device's free space would still
fail, and that is a disk limit rather than a memory one. Above about 250 MB of
encoded photographs the export asks first, and offers the same records without
the images — every measurement kept, a few hundred kilobytes instead of a few
hundred megabytes. Rows written that way carry `imgOmitted: true` so nothing has
to guess why a picture is missing.

CSV and GeoJSON carry no photographs and were never at risk; they are unchanged.

Everything is on the one device, in that browser. Clearing the browser's site
data takes the log with it, and there is no copy anywhere else.

- **CSV** carries the data and the coordinates. It is written with a byte
  order mark so a road name with an accent in it survives being double-clicked
  into Excel.
- **JSON** carries the same fields plus the photographs, embedded, so one file
  is the whole round.
- **GeoJSON** is for handing to an asset management system — Causeway Alloy
  takes it, so does anything else with a map in it. Only entries with a location
  can go in one, and the app says how many that leaves out before you export.

  Every feature carries `confirmed`. **Filter on it before any of this reaches a
  system that starts a response clock**: a defect record commits somebody to a
  working day, and an unconfirmed survey find is a machine's guess that nobody
  has stood over. Photographs are not in a GeoJSON; the JSON export has those.

  On the two things that are easy to get wrong here: coordinates are written
  longitude first, as the spec requires — the other way round puts every defect
  in the sea off Somalia without complaining — and properties are flat scalars,
  because a nested object is what makes a GIS import quietly drop a column.

The detection model was trained for this app: `yolo11n` over 17,497 images
forked from `pothole-model-for-zed-cameras/pothole-fine-tuning-ghl9u`, two
classes, `pothole` and `manhole`. The architecture was picked for the decoder
rather than for accuracy — the browser library ships a yolov11 decoder, and the
public model that came before it returned confidences of 1.004 and 5,323,169.5
because its head was one the library could not read. It is loaded by model id
rather than by project and version, so there is no question which model of the
several on a version is being asked for. The library is vendored at
`vendor/inference.es.js` rather than pulled from a CDN so that the app depends
on nothing but itself. It is six megabytes and is deliberately not precached:
the first visit should not pay for it before the camera opens.

The publishable workspace key is in the page source. It is meant to live in
client code and can do nothing but load models and run them.

An earlier build of this app kept its entries — photographs included — in
`localStorage`, which holds about five megabytes in total. Around the third or
fourth capture the write failed, the failure was swallowed, and the log looked
right until the app was next opened. Anything that build left behind is
imported the first time this one runs.

## Running it

A static page with no build step — open `index.html`, or host the folder
anywhere. It is part of the same site as [Family Bets](../), so if that is on
GitHub Pages this is already live at `/defects/`.

Two things need a secure address, which means https or `localhost`, not a file
opened off the phone: the camera and the location. Hosted, both work; opened
as a file, neither does, and the app says so rather than appearing to be
broken.

A service worker caches the app on first visit, so add it to the home screen
and it runs in a lay-by with no bars.

It goes to the network before the cache, so a deploy lands on the next load
rather than whenever the cache happens to turn over. Two things are needed for
that to be true and both were missing at first: the worker has to ask the
network with the browser's own cache bypassed, and it has to hand back a copy
the browser is not allowed to keep — otherwise the reply's `max-age` lets the
browser answer the load after next by itself, without the network and without
the worker, which never gets asked and never learns there is a new build.

The build is printed in the footer. If a fix is meant to be there and the
footer still shows the old one, that is the answer.

## What it is not

It is a screening aid. It detects a defect and proposes a score; it does not
measure anything, and it does not decide. A survey run is a list of places
worth looking at, not a set of findings. The photograph is what it sees, and a
photograph does not contain depth, scale, or how the road is used. Every entry
is still one you confirmed — the app records which scores were its own
proposals so that a later reader can tell the difference.
