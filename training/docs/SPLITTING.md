# Splitting: the rule that decides whether any of the numbers mean anything

## The failure this prevents

A survey drive records a frame every second or so. A pothole stays in view for
several of them. Those frames are not independent pictures — they are the same
pothole from six inches further back.

Split those at random and near-copies land in both train and test. The model
memorises the answer, the test score comes out high, and the first unfamiliar
road proves it learned nothing. The score does not merely flatter: it points
the wrong way, because the model that memorises hardest wins.

Nothing else in this pipeline would catch it. A trainer will train happily. A
metric will report happily. Only the split can prevent it.

## The rule

**Split by session. Never by image.**

A session is one recording: one drive, one street, one inspection visit. It is
the unit that goes into `train`, `val` or `test` — all of it, or none of it.

Where you can, go wider than a session:

- **Never split one road** across train and test, even across two visits on
  different days. The same road in different light is still the same road.
- **Prefer whole areas** in the test set — an estate, a village, a stretch of
  A-road that training has never seen.
- **Two seasons of the same road** are two sessions, and both belong to
  whichever split the road belongs to.

## How it is enforced

Every image is named `<session>__<frame>.<ext>`, so the session is a property
of the file rather than of a list somebody has to keep in step. `dl.py
validate` then proves the rule mechanically:

- `leakage` — a file whose session is registered to a different split
- `duplicate-image` — identical bytes in two splits
- `near-duplicate` — two images that *look* the same across splits (Pillow)
- `unregistered-session` — a file from a session nobody wrote down
- `filename` — a file whose session cannot be known at all

All errors. `dl.py build` refuses to produce a training set while any of them
stand.

## Registering a session

One row in `dataset/sessions.csv`:

```
session_id,split,protected,road,location,captured_on,camera,source_id,notes
lane-a614-2026-09-04,test,yes,A614 north of Ollerton,Notts,2026-09-04,pixel-mount,own-dashcam-2026,wet; rural; dusk
```

- `session_id` — lower-case letters, digits and hyphens. **No underscores**:
  the double underscore is the filename separator, and a session with one in
  it makes the filename ambiguous. Include the date; you will have more than
  one visit to the same road.
- `split` — `train`, `val`, `test`, or `hold`. `hold` is a real state, not an
  error: it means the images are registered but nobody has decided where they
  belong yet, and deciding needs to know what else is in the set.
- `protected` — `yes` only for gold test sessions. A protected session outside
  `test` is an error.
- `source_id` — must exist in `sources.csv`. See [LICENSING.md](LICENSING.md).

## Rough proportions

With a few thousand images, aim for about 70 / 15 / 15 by **session**, not by
image — sessions differ in length, so the image counts will not land neatly
and that is fine.

Two things matter more than the ratio:

1. **`val` must be a different road from `train`.** It is what early stopping
   listens to. A `val` set that shares roads with training says "keep going"
   long after the model stopped generalising.
2. **`test` must be roads seen by neither.** See below.

## The gold test set

`test` is not a spare slice of data. It is the instrument that decides whether
V2 replaces V1, and it only works while it stays clean:

- Sessions marked `protected=yes`.
- Roads that appear nowhere in `train` or `val`.
- Labels reviewed by a human, box by box — never produced by the current model
  and accepted.
- Hard negatives included in proportion. A test set of nothing but potholes
  cannot measure false positives, which is half of what we are trying to fix.
- Not looked at while tuning. Every time you train against it, it becomes a
  validation set and stops being able to answer the only question it exists
  for.

Aim for at least 150–200 images with something in them and a similar number of
negatives before you trust a comparison. Below about 50 potholes, a two-point
difference in recall is one image changing its mind.

## Growing the set later

New sessions are added; existing ones do not move. If you have to move a
session between splits — it happens, usually when you realise two sessions are
the same road — change `sessions.csv` and re-ingest, and record it in the
notes. Never move the files and leave the register behind: the validator will
catch the disagreement, but the reason for it will be lost.
