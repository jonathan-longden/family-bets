# Tests for the dataset pipeline

```bash
./run.sh              # everything
./run.sh validate cli # just those
```

Standard library only — `unittest`, no pytest, no virtualenv, no install. A
dataset check that needs a setup step before it can be trusted is a check
nobody runs.

## What is covered

| module | what it holds |
|---|---|
| `test_labels` | the YOLO parser: every malformed line it must reject, and the geometry |
| `test_sessions` | the filename convention, and both registers |
| `test_config` | `dataset.yaml`, and the class order the app's decoder depends on |
| `test_validate` | every finding the validator can produce, each provoked by a real dataset on disk |
| `test_dupes` | exact duplicates, and reporting *not checked* rather than *nothing found* |
| `test_metrics` | recall, precision, false positives per image, detection rate, baseline vs candidate |
| `test_build` | what a build refuses, and what `--commercial` and `--pothole-only` change |
| `test_ingest` | intake, renaming, and the guards that stop a half-labelled batch |
| `test_cli` | `dl.py` end to end: exit codes and output |

## How the fixtures work

`harness.py` builds a real dataset in a temporary directory — real PNGs,
written with `zlib` and `struct`, so `imagesize` reads a genuine header rather
than a mock. Tests that only run where Pillow happens to be installed are
tests that do not run, so nothing here needs it.

```python
with harness.Dataset() as d:
    d.session('lane-a', harness.TRAIN)
    d.image(harness.TRAIN, 'lane-a__0001')
    d.image(harness.TRAIN, 'lane-a__0002', boxes=None)   # a hard negative
    r = validate.validate(d.root, near=False)
```

## The tests that matter most

The leakage ones in `test_validate`. A missing label is caught by the trainer
eventually; a session in both train and test is caught by nothing else, ever,
and produces a model that scores well and finds nothing on a road it has not
seen.
