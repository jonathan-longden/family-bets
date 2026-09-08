# Hard negatives, and the mistake loop

## What a hard negative is

An image with **no boxes at all** — an empty `.txt` beside it — containing
something the model is likely to call a pothole.

Not a picture of a field. A picture of a manhole. A dappled shadow under a
tree. A completed patch. A puddle. The things that are hard to tell apart from
the thing we want, which is why "hard".

They are the half of the problem the current survey actually suffers from. It
finds potholes; it also logs manholes, patches and shadow, and every one of
those costs somebody a trip to a road that is fine.

## Why an empty file, rather than leaving it out

YOLO learns from what is *not* boxed in an image it is shown. An image the
model never sees teaches it nothing. An image it sees with nothing boxed
teaches it that this dark round shape is not the thing.

So: the file is there, the label is there, the label is empty. `dl.py
validate` treats a *missing* label as an error and an *empty* one as a hard
negative, precisely so the two cannot be confused.

## The loop

```
  the survey logs something that is not a pothole
                 │
                 ▼
  the observation and its evidence photo are already in the app
                 │
                 ▼
  export the frame to  dataset/incoming/
                 │
                 ▼
  a human looks at it and decides
                 │
       ┌─────────┴──────────┐
       ▼                    ▼
  not a pothole         it IS a pothole,
       │                the app was right
       ▼                    │
  empty .txt                ▼
  = hard negative       leave it; nothing to learn
       │
       ▼
  ingest into train  ──────►  V2 training
```

And the mirror image, which matters just as much:

```
  the survey drives past a pothole and says nothing
                 │
                 ▼
  the frame is in the local footage recording
                 │
                 ▼
  export it to  dataset/incoming/
                 │
                 ▼
  a human draws the box the model failed to draw
                 │
                 ▼
  ingest into train  ──────►  a PRIORITY training example
```

A missed pothole is worth more than an easy one. It is, by definition, an
example of exactly what the model cannot currently do.

## Where they go

**`train`, mostly.** That is where they change the model.

Keep a proportionate share in `test` as well — a gold set of nothing but
potholes cannot measure false positives, and false positives are half of what
V2 has to improve. Roughly match the ratio you expect on a real road: most
frames contain nothing.

Never move an image from `test` into `train` because V2 got it wrong. That
converts the instrument into training data and the comparison stops meaning
anything.

## Recording why

Put the reason in the session notes — `manholes`, `dappled shade`,
`completed patches`, `wet marks`. It costs nothing and it is the only way to
answer "which confusion did V2 actually fix?" rather than "the number went
up".

Grouping them by confusion also makes the collection tractable: a session of
twenty gully gratings is one afternoon's work and closes one whole category.

## What not to do

- **Do not add a hard negative because V2 got it wrong on the test set.** Fix
  it with new data from a different road, or accept the score.
- **Do not fill the set with easy negatives.** Empty road is worth having, but
  a thousand frames of clean tarmac teach far less than fifty manholes.
- **Do not label a hard negative "as a pothole with low confidence".** There
  is no such thing in this format. It is boxed or it is not.

## On automating the collection

The app could do the export step itself — save the frame behind every
detection, and every near-miss, straight into a local pipeline directory.

That is not built. It changes what the app does with camera frames, so it is a
decision to be asked for rather than assumed.
