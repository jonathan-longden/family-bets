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
2. Once per worker, run **the same picture through the graph the other way
   round** and record the range that comes back. The library feeds a YOLOv8
   export channels-first, `[1,3,640,640]`; a tfjs graph converted from PyTorch
   usually wants channels-last, `[1,640,640,3]`. A graph that quietly accepts
   the wrong one — no error, a tensor of the right shape, numbers that mean
   nothing — is exactly the failure being chased, and a range inside 0..1 on one
   of the two names it outright. A refusal is recorded as a refusal, which is
   equally an answer.
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
