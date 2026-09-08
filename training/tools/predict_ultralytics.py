#!/usr/bin/env python3
"""Turn a trained .pt into a predictions file dl.py can score.

This is the only script in the pipeline that needs a framework, and it is
deliberately the only one: everything downstream — recall, precision, false
positives per image, baseline against candidate — works on the JSON this
writes, so the scoring never depends on which machine or which version of
ultralytics produced it.

    pip install ultralytics
    ./predict_ultralytics.py runs/v2/weights/best.pt --name v2-2026-09 \
        --out preds-v2.json

Run it wherever the GPU is; copy the JSON back. Confidence is deliberately
collected right down to 0.05 rather than at 0.65: dl.py applies the bar, and a
predictions file cut at 0.65 cannot answer "would a lower bar have caught it?"
— which is the question the miss analysis in the app keeps raising.
"""
import argparse
import datetime
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dlkit import config, dupes                    # noqa: E402

COLLECT_FROM = 0.05


def main(argv=None):
    p = argparse.ArgumentParser()
    p.add_argument('weights')
    p.add_argument('--root', help='dataset directory')
    p.add_argument('--split', default='test')
    p.add_argument('--out', default='predictions.json')
    p.add_argument('--name', help='what to call this model in reports')
    p.add_argument('--imgsz', type=int, default=640,
                   help='must match what the app feeds the model: 640')
    p.add_argument('--conf', type=float, default=COLLECT_FROM)
    p.add_argument('--pothole-only', action='store_true',
                   help='the weights come from a one-class build, so class 0 '
                        'means pothole; write it back as class 1 so the '
                        'scores compare against a two-class baseline')
    a = p.parse_args(argv)

    try:
        from ultralytics import YOLO
    except ImportError:
        print('ultralytics is not installed here. This script is meant to run '
              'wherever the GPU is:\n  pip install ultralytics')
        return 2

    P = config.paths(config.root(a.root))
    idir = os.path.join(P['images'], a.split)
    images = dupes.image_files(idir)
    if not images:
        print('no images in ' + idir)
        return 1

    model = YOLO(a.weights)
    out = {}
    for path in images:
        stem = os.path.splitext(os.path.basename(path))[0]
        res = model.predict(path, imgsz=a.imgsz, conf=a.conf, verbose=False)[0]
        rows = []
        for b in res.boxes:
            cls = int(b.cls.item())
            if a.pothole_only:
                cls = 1 if cls == 0 else cls
            cx, cy, w, h = (float(v) for v in b.xywhn[0])
            rows.append({'cls': cls, 'conf': round(float(b.conf.item()), 6),
                         'cx': round(cx, 6), 'cy': round(cy, 6),
                         'w': round(w, 6), 'h': round(h, 6)})
        out[stem] = rows

    doc = {
        'model': a.name or os.path.basename(a.weights),
        'weights': os.path.abspath(a.weights),
        'split': a.split,
        'imgsz': a.imgsz,
        'collected_from_conf': a.conf,
        'created': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'predictions': out,
    }
    with open(a.out, 'w', encoding='utf-8') as f:
        json.dump(doc, f, indent=1)
    boxes = sum(len(v) for v in out.values())
    print('%d image(s), %d box(es) above %.2f -> %s'
          % (len(out), boxes, a.conf, a.out))
    print('now: ./dl.py evaluate %s   (or compare against the baseline)' % a.out)
    return 0


if __name__ == '__main__':
    sys.exit(main())
