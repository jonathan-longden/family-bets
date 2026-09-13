"""Rescuing usable regions out of paint-marked photographs.

The inspection photographs all carry survey paint, and paint is perfectly
correlated with the defects in them. Whole frames are therefore unusable in
both directions: as positives the model learns to find paint, and as hard
negatives it learns that a painted pothole is background — which is worse.

What IS usable is the parts of those frames containing no defect and no paint:
a gully grating, a stretch of dappled shade, a wet surface, leaves in the
channel. Cutting those out gives real hard negatives of exactly the confusions
the survey suffers from.

Two rules the cutting has to respect:

  CROP WIDE, NOT TIGHT.  These are walking-distance photographs, so a feature
  cropped tightly arrives five times larger than a driving camera would ever
  see it. A crop about a third to a half of the frame width, downscaled into
  the 640 square, puts a manhole at roughly the apparent size it has at ten
  metres. A tight crop teaches "big manhole"; the product sees small ones.

  CHECK THE CUT, NOT THE INTENTION.  A crop is only clean if the pixels that
  came out are clean, so every crop is re-scanned for paint after it is made
  and refused if any is found. A region chosen by eye from a thumbnail is a
  guess; the scan is the check.
"""
import csv
import os

from . import paint

FIELDS = ['crop_id', 'source_image', 'x0', 'y0', 'x1', 'y1', 'kind',
          'confuser', 'note']
KINDS = ('negative', 'positive')

# A crop with more paint than this is rejected. Not zero: a single stray pixel
# on a JPEG edge is compression, not a marking.
MAX_PAINT = 0.0008
# Below this the crop is too tight to stand in for a driving view.
MIN_WIDTH_FRACTION = 0.25


class Cut(object):
    __slots__ = ('row', 'box', 'size', 'paint', 'problems')

    def __init__(self, row, box, size, paint_frac, problems):
        self.row, self.box, self.size = row, box, size
        self.paint, self.problems = paint_frac, problems


def read_spec(path):
    """(rows, errors) from the crop specification."""
    if not os.path.exists(path):
        return [], ['crops.csv does not exist at ' + path]
    with open(path, newline='', encoding='utf-8') as f:
        r = csv.DictReader(f)
        if list(r.fieldnames or []) != FIELDS:
            return [], ['crops.csv header is %s, expected %s'
                        % (list(r.fieldnames or []), FIELDS)]
        rows = [dict(x) for x in r]
    out, errs, seen = [], [], set()
    for i, row in enumerate(rows, start=2):
        cid = (row.get('crop_id') or '').strip()
        where = 'crops.csv line %d' % i
        if not cid:
            errs.append('%s: crop_id is empty' % where)
            continue
        if cid in seen:
            errs.append('%s: crop_id %r appears twice' % (where, cid))
            continue
        seen.add(cid)
        if row.get('kind') not in KINDS:
            errs.append('%s: kind %r is not one of %s'
                        % (where, row.get('kind'), ', '.join(KINDS)))
            continue
        try:
            vals = [float(row[k]) for k in ('x0', 'y0', 'x1', 'y1')]
        except (ValueError, KeyError):
            errs.append('%s: coordinates are not four numbers' % where)
            continue
        if not all(0.0 <= v <= 1.0 for v in vals):
            errs.append('%s: coordinates must be fractions of the image, '
                        '0 to 1' % where)
            continue
        if vals[0] >= vals[2] or vals[1] >= vals[3]:
            errs.append('%s: x0,y0 must be above and left of x1,y1' % where)
            continue
        row['_box'] = vals
        out.append(row)
    return out, errs


def cut(spec_rows, src_dir, max_paint=MAX_PAINT):
    """Make every crop in memory and check it. Nothing is written here.

    Returns [Cut]; a Cut with problems is one that must not be used.
    """
    try:
        from PIL import Image
    except ImportError:
        raise RuntimeError('cutting crops needs Pillow: pip install Pillow')

    cuts = []
    for row in spec_rows:
        problems = []
        src = os.path.join(src_dir, row['source_image'])
        if not os.path.exists(src):
            cuts.append(Cut(row, None, None, None,
                            ['source image %s is not in incoming/'
                             % row['source_image']]))
            continue
        with Image.open(src) as im:
            W, H = im.size
            x0, y0, x1, y1 = row['_box']
            box = (int(x0 * W), int(y0 * H), int(x1 * W), int(y1 * H))
            piece = im.crop(box).convert('RGB')
            frac = paint.fraction(piece)

        if (x1 - x0) < MIN_WIDTH_FRACTION:
            problems.append('crop is %.0f%% of the frame width; below %.0f%% '
                            'it arrives far larger than a driving camera '
                            'would see it'
                            % ((x1 - x0) * 100, MIN_WIDTH_FRACTION * 100))
        if frac > max_paint:
            problems.append('survey paint still in the crop (%.4f%% of '
                            'pixels) — move the box off the marking'
                            % (frac * 100))
        cuts.append(Cut(row, box, piece.size, frac, problems))
    return cuts


def write(cuts, src_dir, out_dir, session, longest=1600, quality=90):
    """Write the clean crops as <session>__<crop_id>.jpg, plus an EMPTY label
    for every negative.

    The empty label is an assertion that there is no defect in the crop. It is
    written here because it is checkable — the paint scan and a human looking
    at the crop are the check — but it is still a labelling judgement, which
    is why the caller has to ask for it explicitly.
    """
    from PIL import Image

    written = []
    for c in cuts:
        if c.problems:
            continue
        with Image.open(os.path.join(src_dir, c.row['source_image'])) as im:
            piece = im.crop(c.box).convert('RGB')
        piece.thumbnail((longest, longest), Image.LANCZOS)
        stem = '%s__%s' % (session, c.row['crop_id'])
        path = os.path.join(out_dir, stem + '.jpg')
        os.makedirs(out_dir, exist_ok=True)
        piece.save(path, quality=quality)
        if c.row['kind'] == 'negative':
            with open(os.path.join(out_dir, stem + '.txt'), 'w') as f:
                f.write('')
        written.append((path, c.row['kind']))
    return written
