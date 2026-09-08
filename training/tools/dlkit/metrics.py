"""Scoring a model against the gold test set.

Deliberately a pure function over two files — the ground-truth labels and a
predictions JSON — with no model, no framework and no GPU anywhere near it.
That is what makes baseline-versus-V2 an honest comparison: both models are
reduced to the same artefact (a list of boxes with confidences) and scored by
the same code, on a machine that has never seen either of them.

Matching is the standard greedy one: predictions sorted by confidence, each
taking the best unclaimed ground-truth box of its own class above the IoU
threshold. Everything left over is a false positive; every ground-truth box
nobody claimed is a miss.

The headline number is RECALL AT 0.65, because 0.65 is the bar the survey
actually applies and a model that is wonderful at 0.30 changes nothing in the
field. Precision matters just as much in the other direction: this pipeline
exists partly because the survey logs manholes and shadows.
"""
import json

DEFAULT_IOU = 0.5
PRODUCTION_CONF = 0.65
SWEEP = (0.25, 0.35, 0.45, 0.50, 0.55, 0.60, 0.65, 0.70, 0.75, 0.85)


def _bounds(b):
    return (b['cx'] - b['w'] / 2, b['cy'] - b['h'] / 2,
            b['cx'] + b['w'] / 2, b['cy'] + b['h'] / 2)


def iou(a, b):
    ax0, ay0, ax1, ay1 = _bounds(a)
    bx0, by0, bx1, by1 = _bounds(b)
    ix = max(0.0, min(ax1, bx1) - max(ax0, bx0))
    iy = max(0.0, min(ay1, by1) - max(ay0, by0))
    inter = ix * iy
    union = a['w'] * a['h'] + b['w'] * b['h'] - inter
    return inter / union if union > 0 else 0.0


def load_predictions(path):
    with open(path, encoding='utf-8') as f:
        doc = json.load(f)
    if 'predictions' not in doc:
        raise ValueError('%s has no "predictions" object' % path)
    return doc


def truth_from_labels(boxes_by_stem):
    """dlkit.labels.Box objects to the plain dicts this module scores."""
    return {stem: [{'cls': b.cls, 'cx': b.cx, 'cy': b.cy,
                    'w': b.w, 'h': b.h} for b in boxes]
            for stem, boxes in boxes_by_stem.items()}


def score(truth, preds, cls, conf, iou_thresh=DEFAULT_IOU):
    """One class, one confidence bar.

    Images present in truth but absent from preds count as images the model
    was shown and found nothing in — a silent miss, not a skipped file. A
    prediction for an image that is not in the test set is an error worth
    raising rather than quietly ignoring.
    """
    unknown = sorted(set(preds) - set(truth))
    if unknown:
        raise ValueError('predictions cover %d image(s) not in the test set, '
                         'first is %r' % (len(unknown), unknown[0]))

    tp = fp = fn = 0
    per_image_fp = {}
    missed = []
    for stem, gts in sorted(truth.items()):
        gt = [g for g in gts if g['cls'] == cls]
        got = sorted((p for p in preds.get(stem, [])
                      if p['cls'] == cls and p.get('conf', 0) >= conf),
                     key=lambda p: -p.get('conf', 0))
        claimed = set()
        image_fp = 0
        for p in got:
            best, best_i = -1, 0.0
            for i, g in enumerate(gt):
                if i in claimed:
                    continue
                v = iou(p, g)
                if v > best_i:
                    best, best_i = i, v
            if best >= 0 and best_i >= iou_thresh:
                claimed.add(best)
                tp += 1
            else:
                fp += 1
                image_fp += 1
        if image_fp:
            per_image_fp[stem] = image_fp
        for i, g in enumerate(gt):
            if i not in claimed:
                fn += 1
                missed.append((stem, g))

    images = len(truth)
    return {
        'class': cls, 'conf': conf, 'iou': iou_thresh,
        'images': images,
        'tp': tp, 'fp': fp, 'fn': fn,
        'precision': tp / (tp + fp) if (tp + fp) else None,
        'recall': tp / (tp + fn) if (tp + fn) else None,
        'fp_per_image': fp / images if images else None,
        'images_with_fp': len(per_image_fp),
        'missed': missed,
        'truth_boxes': tp + fn,
    }


def detection_rate(truth, preds, cls, conf):
    """The blunt field question: of the pictures that contain one, in how many
    did the model find at least one? Not the same as recall — it forgives
    finding one pothole out of three, which is what the survey does too,
    because one logged defect brings a crew to the road."""
    have = [s for s, gts in truth.items() if any(g['cls'] == cls for g in gts)]
    if not have:
        return None
    hit = 0
    for stem in have:
        if any(p['cls'] == cls and p.get('conf', 0) >= conf
               for p in preds.get(stem, [])):
            hit += 1
    return {'images_with_class': len(have), 'images_detected': hit,
            'rate': hit / len(have)}


def sweep(truth, preds, cls, thresholds=SWEEP, iou_thresh=DEFAULT_IOU):
    rows = []
    for t in thresholds:
        s = score(truth, preds, cls, t, iou_thresh)
        d = detection_rate(truth, preds, cls, t)
        s['detection_rate'] = d['rate'] if d else None
        rows.append(s)
    return rows


def compare(truth, a_preds, b_preds, cls, conf=PRODUCTION_CONF,
            iou_thresh=DEFAULT_IOU):
    """Baseline against candidate, on identical ground truth.

    Also returns the two sets of images each model missed, because 'V2 gains
    four points of recall' is a claim, and 'V2 finds these three the baseline
    missed and loses this one' is evidence.
    """
    a = score(truth, a_preds, cls, conf, iou_thresh)
    b = score(truth, b_preds, cls, conf, iou_thresh)
    a_miss = {s for s, _g in a['missed']}
    b_miss = {s for s, _g in b['missed']}
    return {
        'conf': conf, 'iou': iou_thresh, 'class': cls,
        'baseline': a, 'candidate': b,
        'fixed': sorted(a_miss - b_miss),
        'regressed': sorted(b_miss - a_miss),
        'still_missed': sorted(a_miss & b_miss),
        'delta': {
            'recall': _delta(a['recall'], b['recall']),
            'precision': _delta(a['precision'], b['precision']),
            'fp_per_image': _delta(a['fp_per_image'], b['fp_per_image']),
        },
    }


def _delta(a, b):
    return None if a is None or b is None else b - a
