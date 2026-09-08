#!/usr/bin/env python3
"""dl.py — the one command for the Defect Log dataset.

    ./dl.py validate                 every check; exit 1 on any error
    ./dl.py report                   what is in the dataset
    ./dl.py ingest <session>         move labelled images out of incoming/
    ./dl.py build                    a training-ready copy, or refuse
    ./dl.py evaluate <preds.json>    score one model on the gold test set
    ./dl.py compare <base> <cand>    baseline against candidate, same truth

The dataset it works on is training/dataset by default, or wherever
DEFECTLOG_DATASET points, or --root. Standard library only.
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from dlkit import (build as build_mod, config, ingest as ingest_mod, labels,
                   metrics, report, sessions, validate)


def _validate(args):
    r = validate.validate(args.root, near=not args.no_near)
    for f in r.findings:
        if args.quiet and f.level == validate.INFO:
            continue
        print('%-5s %-20s %s' % (f.level, f.code, f.message))
    print('')
    print('%d error(s), %d warning(s), %d note(s)'
          % (len(r.errors), len(r.of(validate.WARN)),
             len(r.of(validate.INFO))))
    return 1 if r.errors else 0


def _report(args):
    r = validate.validate(args.root, near=not args.no_near)
    text = report.text(r)
    print(text)
    if args.out:
        with open(args.out, 'w', encoding='utf-8') as f:
            f.write(text + '\n')
        print('\nwritten to ' + args.out)
    return 0


def _ingest(args):
    root = config.root(args.root)
    moves, problems = ingest_mod.plan(root, args.session, args.split)
    for p in problems:
        print('PROBLEM  ' + p)
    if not moves:
        print('nothing to ingest')
        return 1 if problems else 0
    for isrc, idst, _ls, _ld in moves:
        print('%s  ->  %s' % (os.path.basename(isrc),
                              os.path.relpath(idst, root)))
    if args.dry_run:
        print('\n%d file(s) would move. Run without --dry-run to do it.'
              % len(moves))
        return 0
    if problems and not args.force:
        print('\nrefusing to move anything while there are problems above. '
              '--force to ingest the rest anyway.')
        return 1
    n = ingest_mod.apply(moves, copy=args.copy)
    print('\n%d image(s) and their labels %s'
          % (n, 'copied' if args.copy else 'moved'))
    return 0


def _build(args):
    try:
        info = build_mod.build(args.root, args.out, commercial=args.commercial,
                               pothole_only=args.pothole_only, link=args.link,
                               near=not args.no_near)
    except (ValueError, IOError) as e:
        print('FAILED: %s' % e)
        return 1
    print('built %d image(s) into %s' % (info['total'], info['out']))
    for s in sessions.SPLITS:
        print('  %-6s %5d' % (s, info['kept'][s]))
    print('  classes: ' + ', '.join('%d=%s' % (i, n)
                                    for i, n in sorted(info['names'].items())))
    if info['blocked_sessions']:
        print('  excluded for licence: ' + ', '.join(info['blocked_sessions']))
    if info['became_negatives']:
        print('  %d image(s) became hard negatives when manhole was dropped'
              % info['became_negatives'])
    if info['warnings']:
        print('  %d warning(s) from validation — build allowed, but read them'
              % info['warnings'])
    return 0


def _truth(root, split='test'):
    """Ground truth for one split, keyed by filename stem."""
    P = config.paths(config.root(root))
    idir = os.path.join(P['images'], split)
    ldir = os.path.join(P['labels'], split)
    cfg, _e = config.read_yaml(P['yaml'])
    n = max(len((cfg or {}).get('names') or config.REQUIRED_NAMES), 1)
    out = {}
    if not os.path.isdir(idir):
        return out
    from dlkit import dupes
    for p in dupes.image_files(idir):
        stem = os.path.splitext(os.path.basename(p))[0]
        lp = labels.label_path(p, idir, ldir)
        boxes, _bad = labels.parse(lp, n) if os.path.exists(lp) else ([], [])
        out[stem] = boxes
    return metrics.truth_from_labels(out)


def _print_sweep(rows, name):
    print('  %-6s %7s %8s %9s %8s %8s %10s'
          % ('conf', 'found', 'missed', 'false+', 'recall', 'prec.', 'det.rate'))
    for s in rows:
        mark = '  <- production bar' if abs(s['conf'] - 0.65) < 1e-9 else ''
        print('  %-6.2f %7d %8d %9d %8s %8s %9s%s'
              % (s['conf'], s['tp'], s['fn'], s['fp'],
                 '  -  ' if s['recall'] is None else '%5.3f' % s['recall'],
                 '  -  ' if s['precision'] is None else '%5.3f' % s['precision'],
                 '  -  ' if s['detection_rate'] is None
                 else '%5.3f' % s['detection_rate'], mark))


def _evaluate(args):
    truth = _truth(args.root, args.split)
    if not truth:
        print('the %s split has no images — there is nothing to score against'
              % args.split)
        return 1
    doc = metrics.load_predictions(args.predictions)
    preds = doc['predictions']
    print('MODEL       %s' % doc.get('model', '(unnamed)'))
    print('TEST SET    %s split, %d image(s), IoU %.2f'
          % (args.split, len(truth), args.iou))
    for cls, label in ((1, 'pothole'), (0, 'manhole')):
        rows = metrics.sweep(truth, preds, cls, iou_thresh=args.iou)
        boxes = rows[0]['truth_boxes']
        if not boxes:
            continue
        print('\n%s — %d annotated box(es)' % (label.upper(), boxes))
        _print_sweep(rows, label)
        at = metrics.score(truth, preds, cls, metrics.PRODUCTION_CONF, args.iou)
        print('  at the production bar: %d false positive(s) over %d image(s) '
              '= %.3f per image, in %d image(s)'
              % (at['fp'], at['images'], at['fp_per_image'] or 0,
                 at['images_with_fp']))
        if at['missed']:
            print('  missed at 0.65: ' +
                  ', '.join(sorted({s for s, _g in at['missed']}))[:400])
    return 0


def _compare(args):
    truth = _truth(args.root, args.split)
    if not truth:
        print('the %s split has no images — there is nothing to compare on'
              % args.split)
        return 1
    a = metrics.load_predictions(args.baseline)
    b = metrics.load_predictions(args.candidate)
    c = metrics.compare(truth, a['predictions'], b['predictions'],
                        cls=1, conf=args.conf, iou_thresh=args.iou)
    A, B = c['baseline'], c['candidate']
    print('POTHOLE, at conf %.2f and IoU %.2f, on %d held-out image(s)'
          % (args.conf, args.iou, A['images']))
    print('')
    print('  %-18s %12s %12s %10s'
          % ('', a.get('model', 'baseline'), b.get('model', 'candidate'),
             'change'))
    def row(name, key, fmt='%.3f'):
        av, bv = A[key], B[key]
        d = c['delta'].get(key)
        print('  %-18s %12s %12s %10s'
              % (name,
                 '  -  ' if av is None else fmt % av,
                 '  -  ' if bv is None else fmt % bv,
                 '  -  ' if d is None else ('%+.3f' % d)))
    row('recall', 'recall')
    row('precision', 'precision')
    row('false+ per image', 'fp_per_image')
    print('  %-18s %12d %12d %+10d'
          % ('potholes missed', A['fn'], B['fn'], B['fn'] - A['fn']))
    print('')
    print('  fixed by the candidate (%d): %s'
          % (len(c['fixed']), ', '.join(c['fixed'])[:300] or 'none'))
    print('  regressed (%d): %s'
          % (len(c['regressed']), ', '.join(c['regressed'])[:300] or 'none'))
    print('  still missed by both (%d): %s'
          % (len(c['still_missed']),
             ', '.join(c['still_missed'])[:300] or 'none'))
    print('')
    better = ((c['delta']['recall'] or 0) > 0
              and (c['delta']['fp_per_image'] or 0) <= 0)
    print('  A candidate replaces the baseline only if recall goes UP and '
          'false positives per image do NOT: ' +
          ('this one does.' if better else 'this one does not.'))
    if args.out:
        with open(args.out, 'w', encoding='utf-8') as f:
            json.dump(c, f, indent=2, default=str)
        print('  written to ' + args.out)
    return 0


def main(argv=None):
    p = argparse.ArgumentParser(prog='dl.py', description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('--root', help='dataset directory (default: '
                                  'training/dataset or $DEFECTLOG_DATASET)')
    p.add_argument('--no-near', action='store_true',
                   help='skip the near-duplicate check (it reads every pixel)')
    sub = p.add_subparsers(dest='cmd')

    v = sub.add_parser('validate', help='every check; exit 1 on any error')
    v.add_argument('--quiet', action='store_true', help='errors and warnings only')
    v.set_defaults(fn=_validate)

    r = sub.add_parser('report', help='what is in the dataset')
    r.add_argument('--out', help='also write the report here')
    r.set_defaults(fn=_report)

    i = sub.add_parser('ingest', help='move labelled images out of incoming/')
    i.add_argument('session')
    i.add_argument('--split', choices=sessions.SPLITS,
                   help='the split you EXPECT; refuses if the register '
                        'disagrees. It cannot override the register.')
    i.add_argument('--copy', action='store_true', help='copy instead of move')
    i.add_argument('--dry-run', action='store_true')
    i.add_argument('--force', action='store_true')
    i.set_defaults(fn=_ingest)

    b = sub.add_parser('build', help='a training-ready copy, or refuse')
    b.add_argument('--out')
    b.add_argument('--commercial', action='store_true',
                   help='exclude any session whose source is not cleared for '
                        'commercial use')
    b.add_argument('--pothole-only', action='store_true',
                   help='drop the manhole class; manhole images become hard '
                        'negatives')
    b.add_argument('--link', action='store_true',
                   help='symlink images instead of copying them')
    b.set_defaults(fn=_build)

    e = sub.add_parser('evaluate', help='score one model on the gold test set')
    e.add_argument('predictions')
    e.add_argument('--split', default='test')
    e.add_argument('--iou', type=float, default=metrics.DEFAULT_IOU)
    e.set_defaults(fn=_evaluate)

    c = sub.add_parser('compare', help='baseline against candidate')
    c.add_argument('baseline')
    c.add_argument('candidate')
    c.add_argument('--split', default='test')
    c.add_argument('--conf', type=float, default=metrics.PRODUCTION_CONF)
    c.add_argument('--iou', type=float, default=metrics.DEFAULT_IOU)
    c.add_argument('--out')
    c.set_defaults(fn=_compare)

    args = p.parse_args(argv)
    if not getattr(args, 'fn', None):
        p.print_help()
        return 2
    return args.fn(args)


if __name__ == '__main__':
    sys.exit(main())
