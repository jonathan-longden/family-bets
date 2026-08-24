# Local patches to the vendored SDK

`inference.es.js` is `inferencejs@1.3.0` with one deliberate change. It is not a
fork: the change adds a diagnostic and alters nothing about how anything is
decoded.

## Why

The library decodes the model's output tensor inside a web worker, and reports
only the finished detections. When those detections are nonsense — confidences
of 89,622,600 on boxes to match — there is no way from outside to tell whether
the tensor came back in an unexpected shape, whether the model has more than one
output, or whether the numbers were already wrong at source. Every fix without
that was a guess checked against a screenshot, and one of those guesses put a
living room in the log as a Category 2.

## What changed

Three edits inside the base64-embedded worker, in `YOLOv8.infer` (which
`YOLOv11` also inherits):

1. Before the tensor is disposed, record the raw output shape, how many outputs
   `execute()` returned, the shape after the library's transpose, the box and
   class counts it derived from that, and the first eight raw values.
2. Once per worker, run **the same picture through the graph both ways round**
   and use whichever answers in a plausible range from then on. The library
   assumes one layout per architecture: channels-first `[1,3,640,640]` for
   YOLOv8, channels-last `[1,640,640,3]` for YOLOv11. A graph handed the wrong
   one can throw — or can quietly return a tensor of exactly the right shape
   full of numbers that mean nothing.

   The test is deliberately crude, because it only has to separate a reading
   from a non-reading: a raw YOLO head holds box values in pixels and class
   scores near 0..1, so anything past ten thousand is not a reading of
   anything. If both layouts pass that, the first is kept and nothing is
   claimed. If neither does, the native one is kept and the app says so.

   This is the one patch that changes behaviour rather than only reporting, so
   it is deliberately conservative: it never overrides a layout that worked, it
   is skipped entirely for models the library runs asynchronously, and every
   failure inside it is caught and falls back to the library's own choice.
3. Append one extra element to the returned array carrying all of it, marked
   `__diag: true`.

It has to be an array element rather than a property on the array, because the
worker returns its result through `postMessage` and a structured clone keeps
only an array's indexed entries.

`app.js` strips that element in `takeDiag()` the moment the results arrive, so
nothing downstream — the usable-find checks, the shadow test, the log — ever
sees it.

## Re-applying it

`scratchpad/patchsdk.py` performs both edits against a clean `inferencejs@1.3.0`
and re-embeds the worker. Run it again after any upgrade, and check the two
anchors still match — they are exact source strings and an upgrade may move
them.
