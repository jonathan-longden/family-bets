"""Reading and checking one YOLO label file.

Format, per line:  <class> <cx> <cy> <w> <h>  — class an integer, the rest
normalised to the image, centre-based. An empty file is not a broken file: it
is how YOLO says "this picture contains nothing to find", which is exactly
what a hard negative is and the single most important kind of file in this
dataset after the potholes themselves.
"""
import os

# A box may sit against the frame edge, and float text will not round-trip
# exactly. Anything beyond this is a mistake rather than a rounding artefact.
EDGE_TOL = 1e-6
# Smaller than this and there is nothing for the model to learn from: at
# 640 px a side of 0.002 is about one pixel.
MIN_SIDE = 0.002


class Box(object):
    __slots__ = ('cls', 'cx', 'cy', 'w', 'h', 'line')

    def __init__(self, cls, cx, cy, w, h, line):
        self.cls, self.cx, self.cy = cls, cx, cy
        self.w, self.h, self.line = w, h, line

    @property
    def area(self):
        return self.w * self.h

    def bounds(self):
        return (self.cx - self.w / 2, self.cy - self.h / 2,
                self.cx + self.w / 2, self.cy + self.h / 2)

    def xyxy(self, W, H):
        x0, y0, x1, y1 = self.bounds()
        return (x0 * W, y0 * H, x1 * W, y1 * H)


def parse(path, num_classes):
    """(boxes, problems). Problems are strings naming the line; a file with
    problems still returns whatever boxes did parse, because a report of one
    bad line out of forty is more useful than a report of one bad file."""
    boxes, bad = [], []
    try:
        with open(path, encoding='utf-8') as f:
            raw = f.read()
    except OSError as e:
        return [], ['cannot be read: %s' % e]

    for n, line in enumerate(raw.splitlines(), start=1):
        text = line.strip()
        if not text:
            continue
        parts = text.split()
        if len(parts) != 5:
            bad.append('line %d has %d fields, expected 5' % (n, len(parts)))
            continue
        try:
            cls = int(parts[0])
        except ValueError:
            bad.append('line %d: class %r is not an integer' % (n, parts[0]))
            continue
        if parts[0] != str(cls):
            bad.append('line %d: class %r is not written as a plain integer'
                       % (n, parts[0]))
            continue
        if not 0 <= cls < num_classes:
            bad.append('line %d: class id %d is outside 0..%d'
                       % (n, cls, num_classes - 1))
            continue
        try:
            cx, cy, w, h = (float(p) for p in parts[1:])
        except ValueError:
            bad.append('line %d: %s are not all numbers'
                       % (n, ' '.join(parts[1:])))
            continue
        if any(v != v for v in (cx, cy, w, h)):      # NaN
            bad.append('line %d: contains NaN' % n)
            continue
        if w <= 0 or h <= 0:
            bad.append('line %d: zero or negative size %g x %g' % (n, w, h))
            continue
        if w < MIN_SIDE or h < MIN_SIDE:
            bad.append('line %d: box is %g x %g, smaller than the %g minimum '
                       '— about a pixel, nothing to learn from'
                       % (n, w, h, MIN_SIDE))
            continue
        b = Box(cls, cx, cy, w, h, n)
        x0, y0, x1, y1 = b.bounds()
        if (x0 < -EDGE_TOL or y0 < -EDGE_TOL
                or x1 > 1 + EDGE_TOL or y1 > 1 + EDGE_TOL):
            bad.append('line %d: box runs outside the image '
                       '(%.4f,%.4f)-(%.4f,%.4f)' % (n, x0, y0, x1, y1))
            continue
        boxes.append(b)
    return boxes, bad


def label_path(image_path, images_root, labels_root):
    """The label a given image should have. Same relative position, .txt."""
    rel = os.path.relpath(image_path, images_root)
    return os.path.join(labels_root, os.path.splitext(rel)[0] + '.txt')


def iou(a, b):
    """Intersection over union of two Boxes, in normalised space."""
    ax0, ay0, ax1, ay1 = a.bounds()
    bx0, by0, bx1, by1 = b.bounds()
    ix = max(0.0, min(ax1, bx1) - max(ax0, bx0))
    iy = max(0.0, min(ay1, by1) - max(ay0, by0))
    inter = ix * iy
    union = a.area + b.area - inter
    return inter / union if union > 0 else 0.0
