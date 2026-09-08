#!/usr/bin/env python3
"""Train the V2 pothole detector. NOT RUN YET — this is the recipe, ready.

Run it where there is a GPU (Colab, Kaggle, a local NVIDIA box). It expects a
built dataset, not the working one:

    tools/dl.py build --commercial --out /tmp/v2set
    python3 train_v2.py --data /tmp/v2set/dataset.yaml --name v2-2026-09

Why these settings:

  yolov8n        the baseline is a YOLOv8n and the phone budget has not
                 changed. Comparing a nano against a small would tell us the
                 model got bigger, not that the data got better.
  imgsz 640      the app feeds the model a 640 square. Training at anything
                 else trains for a resolution the product will never see.
  rect False     the app stretches a 2340x1080 frame into that square, so the
                 model must learn on the same distortion. This is the single
                 setting most likely to be wrong by accident.
  fliplr 0.5     a pothole is not handed; mirroring is free data.
  flipud 0       the road is always at the bottom. An upside-down road is a
                 picture the product will never be shown.
  degrees 5      a phone on a windscreen mount is nearly level, not arbitrary.
  mosaic         on for most of training, off for the last epochs, which is
                 the standard fix for mosaic teaching the model that objects
                 come in quarter-frames.

Nothing here is deployed by running it. Deployment is a separate decision that
follows docs/EVALUATION.md and needs the gold test set to say yes first.
"""
import argparse
import sys

DEFAULTS = dict(
    model='yolov8n.pt',
    epochs=150,
    imgsz=640,
    batch=16,
    patience=30,
    rect=False,
    fliplr=0.5,
    flipud=0.0,
    degrees=5.0,
    translate=0.1,
    scale=0.5,
    shear=0.0,
    perspective=0.0,
    hsv_h=0.015,
    hsv_s=0.7,
    hsv_v=0.4,          # exposure swing matters: sun, shadow, dusk
    mosaic=1.0,
    close_mosaic=15,
    seed=0,             # a run nobody can repeat is an anecdote
)


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('--data', required=True, help='path to a BUILT dataset.yaml')
    p.add_argument('--name', required=True, help='run name, e.g. v2-2026-09')
    p.add_argument('--project', default='runs/defectlog')
    p.add_argument('--device', default=None)
    for k, v in DEFAULTS.items():
        p.add_argument('--' + k, type=type(v), default=v)
    a = p.parse_args(argv)

    try:
        from ultralytics import YOLO
    except ImportError:
        print('ultralytics is not installed here, and this machine has no GPU '
              'anyway.\n\nRun this where the GPU is:\n'
              '  pip install ultralytics\n'
              '  python3 train_v2.py --data <built>/dataset.yaml --name v2-...')
        return 2

    kw = {k: getattr(a, k) for k in DEFAULTS if k != 'model'}
    model = YOLO(a.model)
    model.train(data=a.data, project=a.project, name=a.name,
                device=a.device, **kw)
    print('\nTrained. Nothing is deployed by this script.\n'
          'Next: produce predictions on the GOLD TEST SET and compare:\n'
          '  tools/predict_ultralytics.py %s/%s/weights/best.pt '
          '--name %s --out preds-%s.json\n'
          '  tools/dl.py compare preds-baseline.json preds-%s.json'
          % (a.project, a.name, a.name, a.name, a.name))
    return 0


if __name__ == '__main__':
    sys.exit(main())
