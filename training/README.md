# Defect Log — V2 detector data pipeline

Everything needed to collect, label, check and build a real-world pothole
dataset, and to score a future V2 detector against the one in production —
without touching the one in production.

**Nothing here changes the app.** The shipped YOLOv8n stays the baseline, the
survey bar stays at 0.65, preprocessing stays as it is, and the inference
backend stays WASM-with-a-CPU-fallback. This directory produces datasets and
numbers. Deciding to deploy anything is a separate decision made later, on the
evidence this produces.

---

## Where things are

```
training/
  README.md              this file
  train_v2.py            the V2 training recipe. Not run yet.
  train_v2_colab.ipynb   the same recipe as a Colab notebook
  docs/
    CAPTURE.md           what to photograph, and what makes an image useful
    LABELLING.md         what gets a box and what does not
    SPLITTING.md         the leakage rule, and why it decides everything
    EVALUATION.md        baseline vs V2, on the gold test set
    HARD_NEGATIVES.md    turning the model's own mistakes into training data
    LICENSING.md         where every image came from and what we may do with it
  dataset/
    dataset.yaml         class names and split paths
    sessions.csv         every recording session, and its split   (committed)
    sources.csv          every source, and its licence            (committed)
    incoming/            unlabelled images waiting for a human    (not committed)
    images/{train,val,test}/                                      (not committed)
    labels/{train,val,test}/                                      (not committed)
  tools/
    dl.py                the one command
    predict_ultralytics.py   a .pt to a predictions file
    dlkit/               the toolkit dl.py is built from
  test/
    run.sh               123 tests, standard library only
```

### The pixels are not in git, on purpose

`.github/workflows/pages.yml` publishes this repository as-is, so anything
committed here is a public download. Road photographs carry number plates and
faces. So `images/`, `labels/` and `incoming/` are gitignored and the dataset
lives wherever you keep it:

```bash
export DEFECTLOG_DATASET=~/defectlog-dataset     # or pass --root
```

What *is* committed is the register — `sessions.csv` and `sources.csv` — which
is the part that needs reviewing in a diff: which session went into which
split, and what we are allowed to do with each source. If you decide the
photographs should be in the repository after all, remove the `training/`
block from `.gitignore`; the tooling does not care either way.

---

## The one command

```bash
cd training
./tools/dl.py validate      # every check; exit 1 on any error
./tools/dl.py report        # what is in the dataset
./tools/dl.py ingest <session>
./tools/dl.py build --commercial
./tools/dl.py evaluate preds-v2.json
./tools/dl.py compare preds-baseline.json preds-v2.json
```

Standard library only. `pip install Pillow` adds one extra check (near
duplicate images) and nothing else.

---

## Adding a pothole image

1. **Put the photograph in `dataset/incoming/`.** Any filename; the camera's
   own is fine. Nothing is renamed yet.
2. **Register the session** in `dataset/sessions.csv` if it is new — one row
   per drive, street or visit. See [docs/SPLITTING.md](docs/SPLITTING.md) for
   what counts as a session and how to choose its split.
3. **Label it** — see [docs/LABELLING.md](docs/LABELLING.md). The label is a
   `.txt` beside the image in `incoming/`, same stem. **An image with no
   potholes needs an empty `.txt`, not a missing one**: that is how a hard
   negative is expressed, and it is the most valuable kind of file here after
   the potholes themselves.
4. **Ingest it:**
   ```bash
   ./tools/dl.py ingest lane-a614-2026-09-04 --dry-run
   ./tools/dl.py ingest lane-a614-2026-09-04
   ```
   This moves image and label into the split the register says, renaming to
   `<session>__<frame>.<ext>` so the session becomes a property of the file.
5. **Check it:** `./tools/dl.py validate`.

The renaming in step 4 is the whole trick. Once the session is in the
filename, the validator can prove no session appears in two splits — which is
the one mistake nothing else in the pipeline would ever catch.

---

## Labelling

Full rules in [docs/LABELLING.md](docs/LABELLING.md). In short: one tight box
round the dark, broken opening of each pothole, class `1`; manholes and drain
covers get class `0`; everything else that merely *looks* like a pothole gets
no box at all, which makes the image a hard negative.

Any tool that writes YOLO `.txt` works — LabelImg, Label Studio, CVAT,
Roboflow's editor. The format is `class cx cy w h`, normalised, centre-based.

**Do not label with the current model and accept the result.** The model's
mistakes are the reason this dataset exists; using it as the labeller trains
V2 to make the same ones. The gold test set in particular is human-reviewed or
it is worthless.

---

## Validation

`./tools/dl.py validate` checks, and exits 1 on any error:

| Check | Level |
|---|---|
| A session appearing in more than one split | ERROR |
| An identical file in two splits | ERROR |
| Two images that look like the same view, across splits (needs Pillow) | ERROR |
| A protected session sitting outside `test` | ERROR |
| A file not named `<session>__<frame>` | ERROR |
| A file whose session is not registered | ERROR |
| An image with no label file | ERROR |
| A label file with no image | ERROR |
| Bad YOLO syntax, class id out of range, zero-area or out-of-bounds boxes | ERROR |
| The same filename stem twice | ERROR |
| Class names or order not matching what the app decodes | ERROR |
| A session citing a source that is not in `sources.csv` | ERROR |
| An empty training set | ERROR |
| A source not cleared for commercial use | WARN |
| An empty val or test set | WARN |
| No hard negatives at all | WARN |
| Class counts worse than 10:1 | WARN |
| An identical file twice within one split | WARN |
| An image whose header will not read | WARN |
| Near-duplicates inside one split, sessions on hold, images in `incoming/` | INFO |

`./tools/dl.py report` prints the counts: total, per split, per class,
how many hard negatives, every session with its split and protection, and
every source with its licence position.

---

## Train, validation and test

Split by **session**, never by image. Details and the reasoning are in
[docs/SPLITTING.md](docs/SPLITTING.md); the short version is that consecutive
frames of the same pothole are near-copies, so a random split puts the answer
in the training set and the test score becomes fiction.

`test` is a **gold set**: sessions marked `protected=yes`, on roads that never
appear in training, human-labelled, and left alone. It is the only thing that
can honestly compare V1 and V2, and it stops being able to do that the moment
anything trains on it.

---

## Training V2, later

```bash
./tools/dl.py validate                                   # must be clean
./tools/dl.py build --commercial --out /tmp/v2set        # refuses if not
# copy /tmp/v2set to Colab / Kaggle / the GPU box
python3 train_v2.py --data /tmp/v2set/dataset.yaml --name v2-2026-09
```

Or open `train_v2_colab.ipynb` in Colab, which is the same recipe with the
upload, the GPU check and the predictions step already written.

`build` runs the full validation first and **refuses on any error**, so a
leaking dataset cannot become a training run. `--commercial` drops any session
whose source is not cleared for commercial use. `--pothole-only` collapses to
a single class, turning every manhole image into a hard negative — the
decision the two-class scheme deliberately leaves open.

`train_v2.py` carries the settings and the reason for each. The two that
matter most: `imgsz 640` and `rect False`, because the app stretches a
2340×1080 frame into a 640 square and a model trained on undistorted crops has
been trained for a picture the product never takes.

### The class order is not a preference

`app.js` decodes channel 4 of the head as **manhole** and channel 5 as
**pothole**. A V2 trained with those swapped loads cleanly, runs at full
speed, and calls every pothole a manhole. `dataset.yaml` fixes the order and
the validator fails if it changes.

---

## Comparing V2 against the baseline

Full protocol and the go/no-go rule in
[docs/EVALUATION.md](docs/EVALUATION.md).

```bash
./tools/dl.py compare preds-baseline.json preds-v2.json
```

Both models are reduced to the same artefact — a list of boxes with
confidences — and scored by the same code on the same held-out images.
Reported: pothole recall, precision, false positives per image, potholes
missed, detection rate at the production 0.65 bar and across a sweep, and by
name the images V2 fixed, the ones it regressed, and the ones both still miss.

The rule: **a candidate replaces the baseline only if recall goes up and false
positives per image do not.** A model that finds more potholes by shouting at
every shadow makes the survey worse, and the confidence number alone will not
tell you that.

---

## Tests

```bash
cd training/test && ./run.sh
```

123 tests over the parser, the register, the config, every validator finding,
duplicate detection, the metrics, the build and the command line. Standard
library, no install.
