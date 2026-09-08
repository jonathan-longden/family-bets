"""Producing a training-ready copy of the dataset.

Three things happen here that should not happen at training time:

  1. The dataset is validated and the build REFUSES on any error. A trainer
     will happily train on a leaking split; this is where that gets stopped.
  2. Non-commercial material can be excluded, so a commercial release can be
     built from the same repository as an experiment without anyone having to
     remember which sessions were which.
  3. The two-class set can be collapsed to pothole-only, turning every manhole
     box into nothing and every manhole-only image into a hard negative. That
     is the decision the brief wanted kept open, made here rather than by
     re-labelling thousands of files.

The output is a self-contained directory with its own dataset.yaml, so it can
be zipped and dropped into Colab.
"""
import os
import shutil

from . import config, sessions, validate

POTHOLE_ONLY_NAMES = {0: 'pothole'}


def build(ds_root=None, out=None, commercial=False, pothole_only=False,
          link=False, near=True):
    ds_root = config.root(ds_root)
    P = config.paths(ds_root)
    result = validate.validate(ds_root, near=near)
    if result.errors:
        raise ValueError('refusing to build: %d error(s) in the dataset. Run '
                         '"dl.py validate" and fix them first.'
                         % len(result.errors))
    out = os.path.abspath(out or os.path.join(ds_root, '..', 'build'))
    if os.path.exists(out):
        raise IOError('%s already exists — delete it or choose another '
                      'output directory' % out)

    sess = result.stats['sessions']
    srcs = result.stats['sources']
    blocked = set()
    if commercial:
        blocked = {sid for sid, row in sess.items()
                   if srcs.get(row['source_id'], {}).get('commercial_use')
                   != 'yes'}

    names = POTHOLE_ONLY_NAMES if pothole_only else result.stats['names']
    # In a pothole-only set the surviving class must land on id 0, because
    # that is what a one-class YOLO head emits.
    remap = {1: 0} if pothole_only else {i: i for i in names}

    kept = {s: 0 for s in sessions.SPLITS}
    dropped_sessions, negatives_made = set(), 0

    for split in sessions.SPLITS:
        idir = os.path.join(P['images'], split)
        ldir = os.path.join(P['labels'], split)
        oi = os.path.join(out, 'images', split)
        ol = os.path.join(out, 'labels', split)
        os.makedirs(oi, exist_ok=True)
        os.makedirs(ol, exist_ok=True)
        for p in result.stats['per_split'][split]['images']:
            sid = sessions.session_of(os.path.basename(p))
            if sid in blocked:
                dropped_sessions.add(sid)
                continue
            stem = os.path.splitext(os.path.basename(p))[0]
            dst = os.path.join(oi, os.path.basename(p))
            if link:
                os.symlink(os.path.abspath(p), dst)
            else:
                shutil.copy2(p, dst)
            boxes = result.stats['per_split'][split]['boxes'].get(p, [])
            out_lines = []
            for b in boxes:
                if b.cls not in remap:
                    continue
                out_lines.append('%d %.6f %.6f %.6f %.6f'
                                 % (remap[b.cls], b.cx, b.cy, b.w, b.h))
            if boxes and not out_lines:
                negatives_made += 1
            with open(os.path.join(ol, stem + '.txt'), 'w',
                      encoding='utf-8') as f:
                f.write('\n'.join(out_lines) + ('\n' if out_lines else ''))
            kept[split] += 1

    with open(os.path.join(out, 'dataset.yaml'), 'w', encoding='utf-8') as f:
        f.write('# Built by training/tools/dl.py build. Do not edit by hand.\n')
        f.write('# commercial-only: %s   pothole-only: %s\n'
                % (commercial, pothole_only))
        f.write('path: .\ntrain: images/train\nval: images/val\n'
                'test: images/test\n\nnames:\n')
        for i in sorted(names):
            f.write('  %d: %s\n' % (i, names[i]))

    for name in ('sessions.csv', 'sources.csv'):
        src = os.path.join(ds_root, name)
        if os.path.exists(src):
            shutil.copy2(src, os.path.join(out, name))

    return {'out': out, 'kept': kept, 'total': sum(kept.values()),
            'blocked_sessions': sorted(dropped_sessions),
            'became_negatives': negatives_made,
            'names': names, 'warnings': len(result.of(validate.WARN))}
