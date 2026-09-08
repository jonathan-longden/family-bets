# Evaluating V2 against the baseline

## The principle

Both models are reduced to the same artefact — a list of boxes with
confidences, one file — and scored by the same code on the same held-out
images, on a machine that has never seen either of them.

No framework touches the scoring. `dlkit/metrics.py` is standard library, so
"V2 is better" cannot turn out to mean "V2 was measured by a different version
of a different library".

## The predictions file

```json
{
  "model": "v2-2026-09",
  "split": "test",
  "predictions": {
    "gold-a614__0001": [
      {"cls": 1, "conf": 0.7134, "cx": 0.512, "cy": 0.688, "w": 0.094, "h": 0.052}
    ],
    "gold-a614__0002": []
  }
}
```

Same normalised, centre-based geometry as a label, plus `conf`. An image with
an empty list is one the model looked at and found nothing in — not a skipped
file. A prediction for an image that is not in the test set is refused rather
than ignored.

**Collect down to conf 0.05, not 0.65.** The scorer applies the bar; a file
already cut at 0.65 cannot answer "would a lower bar have caught it?", which
is the question the app's own miss analysis keeps raising.

## Producing them

**V2, from a `.pt`:**

```bash
tools/predict_ultralytics.py runs/defectlog/v2-2026-09/weights/best.pt \
    --name v2-2026-09 --out preds-v2.json
```

**The baseline** is the harder half, and worth doing properly. The honest
comparison is against what is *deployed* — the same weights, on the same
`SURVEY_CONF`/NMS path, through the same stretch-to-640 preprocessing — not
against a `.pt` that resembles it.

Two routes:

1. **Run the shipped model over the test images in the browser** and dump the
   boxes to JSON. This measures the real pipeline including its preprocessing,
   which is the thing being replaced. It needs a small diagnostic addition to
   the app (a batch runner writing this JSON shape). **Not built — it touches
   the app, so it is a decision to ask for.**
2. **Score the source `.pt`** the deployed model was converted from, through
   `predict_ultralytics.py`. Quicker, and blind to anything the TFJS
   conversion or the preprocessing changed.

Route 1 is what the go/no-go should rest on. Route 2 is fine for an early
read. Whichever you use, say which in the report — the two are not
interchangeable.

## Reading the result

```bash
tools/dl.py evaluate preds-v2.json
tools/dl.py compare preds-baseline.json preds-v2.json
```

`evaluate` prints, per class, a sweep across confidence with the production
bar marked:

```
  conf     found   missed    false+   recall    prec.   det.rate
  0.55        41       12         9    0.774    0.820      0.891
  0.65        36       17         4    0.679    0.900      0.836   <- production bar
  0.75        28       25         1    0.528    0.966      0.673
```

- **recall** — of every annotated pothole, how many were found
- **precision** — of every box the model drew, how many were real
- **false+ / per image** — the cost of a wrong answer, in wasted trips
- **detection rate** — of the *images* containing a pothole, in how many was at
  least one found. Not the same as recall: it forgives finding one of three,
  which is what the survey does too, because one logged defect brings a crew
  to the road.

`compare` puts the two side by side at 0.65 and then names names:

```
  fixed by the candidate (7): gold-a614__0004, gold-estate__0011, ...
  regressed (2): gold-lane__0003, ...
  still missed by both (9): ...
```

Which images changed hands matters more than the aggregate. Seven fixed and
two regressed is a different result from five fixed and none, even when the
recall delta is identical.

## The go/no-go rule

> **A candidate replaces the baseline only if pothole recall goes UP and false
> positives per image do NOT.**

Both halves. A model that finds more potholes by calling every shadow a
pothole makes the survey worse: each false positive is a crew sent to a sound
road, and the app's own field evidence is that false positives are the
existing complaint.

`dl.py compare` states the verdict against this rule explicitly. It is not a
recommendation the tool makes; it is the rule stated in advance so it cannot
be adjusted after the numbers arrive.

## What not to optimise

- **Not the confidence number.** A model can be made more confident without
  being more right, and the 0.65 bar is a property of the app, not of the
  model. If V2 needs a different bar, that is a separate, argued change with
  its own before-and-after.
- **Not mAP alone.** It is a useful training signal and a poor product one: it
  averages over IoU thresholds and confidences nobody in the field will use.
  Report it if you like; decide on recall and false positives at 0.65.
- **Not the validation set.** It chose the epoch. It cannot also judge the
  result.

## Rules for the gold test set

1. **Train on it once and it is gone.** Not degraded — gone. It can no longer
   answer the question it exists for.
2. **Do not add images to it because V2 failed on them.** Fix those with new
   training data from a different road, or accept the score.
3. **Do not relabel it to agree with a model.** If a label is wrong, fix it
   because it is wrong, before you look at the scores, and re-run both models.
4. **Re-run the baseline every time.** Never compare a fresh V2 number against
   a baseline number from a previous month. The test set may have grown; the
   scorer may have changed. Both models, same day, same file.
5. **Keep the predictions files.** They are small, and they are the evidence
   behind the decision.

## Reporting a comparison

Record, alongside the numbers: the test set size and its session ids, which
route produced the baseline predictions, the IoU threshold, the dataset build
flags (`--commercial`, `--pothole-only`), and the training run name. A number
without those is not reproducible, and an irreproducible number cannot support
a deployment.
