# Labelling

## Format

Standard YOLO. One `.txt` per image, same stem, one line per box:

```
<class> <cx> <cy> <w> <h>
```

All four numbers normalised 0–1 against the image, centre-based. Classes:

| id | name | what it is |
|---|---|---|
| `0` | manhole | manhole covers, drain covers, gully gratings, inspection chambers |
| `1` | pothole | the defect |

**The order is fixed by the shipped app**, which decodes channel 4 of the head
as manhole and channel 5 as pothole. Do not renumber them.

Any tool that writes this works: LabelImg, Label Studio, CVAT, Roboflow's
editor. Point it at `dataset/incoming/` and let it write `.txt` beside each
image.

## An empty file is not a missing file

An image with no potholes gets a `.txt` **containing nothing**. That is how
YOLO expresses "there is nothing here", and it is what makes the image a hard
negative — the most valuable kind of file in this set after the potholes.

A missing `.txt` is an error, and `dl.py validate` will say so, because a tool
that silently treats missing as empty cannot tell "no defect" from "nobody got
round to it".

## What gets a box

**Label a pothole when** the surface has failed through: a depression with
broken edges, exposed aggregate or a hole, deep enough that a wheel would drop
into it.

**Do not label:**

| Not a pothole | Why it matters |
|---|---|
| Manhole and drain covers | class `0`, not `1` |
| Completed repairs and patches — including tar-band and square hot-patch | dark, rectangular, whole. The model logs these today. |
| Cracking, crazing and alligatoring with no material lost | it will become a pothole; it is not one yet |
| Shadows, wet marks, oil stains, puddles on sound surface | dark ≠ hole |
| Leaves, grit piles, debris | |
| Road markings, arrows, worn white line | |
| Rough but intact surface, coarse chippings, old surface dressing | |
| Kerb and gully channels | |

Everything in that table belongs in the dataset — as an **unlabelled image**,
which is exactly what a hard negative is. See
[HARD_NEGATIVES.md](HARD_NEGATIVES.md).

## How tight

Tight to the **visible extent of the failed surface**: the broken edge where
sound material stops.

- Include the broken lip; exclude the sound road around it.
- Include water standing in the hole — a wet pothole is a pothole, and the
  water is the part the model can see.
- Exclude the shadow the hole casts onto sound surface beside it.
- No padding "to be safe". A loose box teaches a loose box, and the app scores
  priority from the box's share of the frame — an inflated box inflates the
  priority.

Aim within a few pixels at 640. If you cannot tell where the edge is, see
"ambiguous" below.

## Multiple potholes

**One box each**, always — never one box round a cluster.

Where a stretch has broken up into a run of connected holes (common at a
carriageway edge, and several of the September inspection photographs look
exactly like this), the judgement is:

- Separated by sound material a wheel would ride over → separate boxes.
- One continuous failed area with no sound surface between → one box round the
  whole failure.

Boxes may overlap where the potholes do. Do not merge two clear holes because
they are close together.

## Partly visible

- **Cut by the frame edge:** label the visible part, box flush to the edge.
  This case matters — a pothole entering the bottom of the frame is what the
  survey sees first.
- **Under a car, a wheel, a person:** label what you can see, if what you can
  see is unambiguously a pothole. If the car hides most of it, leave the image
  out rather than guess.
- **Far away, a few pixels across:** if you cannot tell it is a pothole at full
  zoom, neither can the model. Do not label it. A speck labelled as a defect
  teaches the model that specks are defects, and every distant shadow becomes
  a detection.

## Ambiguous cases

The default is **leave it out of the gold test set**, and be generous with the
training set only when you are sure.

- Genuinely cannot tell → do not label it, and do not put the image in `test`.
  A wrong label in `test` corrupts the measurement, not just a training step.
- A patch that has itself begun to fail → label the failure, not the patch.
- A worn, shallow depression with no broken edge → not a pothole. It is a
  depression.
- Two people disagree → write the case in `sessions.csv` notes and pick one
  rule for the whole set. Consistency beats correctness here: a rule applied
  everywhere is learnable; a rule applied half the time is noise.

## Do not auto-label

Do not run the current model over images and accept its boxes.

The model's mistakes are the reason this dataset exists. Using it as the
labeller teaches V2 to make the same ones, and — worse — makes the gold test
set agree with V1 by construction, so the comparison always says "no change".

Using it to *pre-fill* boxes a human then checks box by box is acceptable for
`train`. It is not acceptable for `test`. Record it in the session notes when
you do, so a later reader knows which labels were reviewed from scratch.
