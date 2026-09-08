"""Every check we can make on the dataset without a GPU or a human.

The findings are levelled rather than fatal-or-nothing:

  ERROR   would produce a wrong model or a dishonest score. Blocks a build.
  WARN    probably wrong, or right but worth seeing. Does not block.
  INFO    fact worth stating.

The checks that matter most are not the label-format ones — a trainer will
shout about those anyway. They are the leakage checks: a session in two
splits, a file in two splits, the same picture under two names. Those produce
a model that scores beautifully and finds nothing, and nothing else in the
pipeline will catch them.
"""
import os

from . import config, dupes, imagesize, labels, sessions

ERROR, WARN, INFO = 'ERROR', 'WARN', 'INFO'


class Finding(object):
    __slots__ = ('level', 'code', 'message')

    def __init__(self, level, code, message):
        self.level, self.code, self.message = level, code, message

    def __repr__(self):
        return '%-5s %-22s %s' % (self.level, self.code, self.message)


class Result(object):
    def __init__(self):
        self.findings = []
        self.stats = {}

    def add(self, level, code, message):
        self.findings.append(Finding(level, code, message))

    def of(self, level):
        return [f for f in self.findings if f.level == level]

    @property
    def errors(self):
        return self.of(ERROR)

    @property
    def ok(self):
        return not self.errors


def _rel(root, p):
    return os.path.relpath(p, root)


def validate(ds_root=None, near=True):
    ds_root = config.root(ds_root)
    P = config.paths(ds_root)
    r = Result()

    # ---- the configuration itself
    cfg, errs = config.read_yaml(P['yaml'])
    for e in errs:
        r.add(ERROR, 'dataset-yaml', e)
    names = cfg['names'] if cfg else dict(config.REQUIRED_NAMES)
    for e in config.check_names(names):
        r.add(ERROR, 'class-names', e)
    num_classes = max(len(names), 1)

    sess, errs = sessions.read_sessions(P['sessions'])
    for e in errs:
        r.add(ERROR, 'sessions-csv', e)
    srcs, errs = sessions.read_sources(P['sources'])
    for e in errs:
        r.add(ERROR, 'sources-csv', e)

    # ---- provenance and licence, per session
    for sid, row in sorted(sess.items()):
        src = row.get('source_id', '').strip()
        if not src:
            r.add(ERROR, 'provenance', 'session %s has no source_id' % sid)
        elif src not in srcs:
            r.add(ERROR, 'provenance',
                  'session %s cites source %r, which is not in sources.csv'
                  % (sid, src))
        else:
            com = srcs[src]['commercial_use']
            if com != 'yes':
                r.add(WARN, 'licence',
                      'session %s comes from source %s whose commercial_use '
                      'is %r — a commercial build will refuse it'
                      % (sid, src, com))
        if row['protected'] == 'yes' and row['split'] != 'test':
            r.add(ERROR, 'gold-test',
                  'session %s is protected but sits in %s — protected means '
                  'held out, and held out means test' % (sid, row['split']))

    # ---- the files on disk
    per_split, stems, all_images = {}, {}, []
    for split in sessions.SPLITS:
        idir = os.path.join(P['images'], split)
        ldir = os.path.join(P['labels'], split)
        imgs = dupes.image_files(idir) if os.path.isdir(idir) else []
        per_split[split] = {'images': imgs, 'boxes': {}, 'negatives': 0,
                            'counts': {i: 0 for i in names}}
        all_images.extend(imgs)

        for p in imgs:
            base = os.path.basename(p)
            stem = os.path.splitext(base)[0]
            sid = sessions.session_of(base)

            if sid is None:
                r.add(ERROR, 'filename',
                      '%s is not named <session>__<frame>.<ext>, so its '
                      'session cannot be known' % _rel(ds_root, p))
            elif sid not in sess:
                r.add(ERROR, 'unregistered-session',
                      '%s belongs to session %r, which is not in sessions.csv'
                      % (_rel(ds_root, p), sid))
            elif sess[sid]['split'] != split:
                r.add(ERROR, 'leakage',
                      '%s is in %s but session %s is registered as %s — a '
                      'session must live in exactly one split'
                      % (_rel(ds_root, p), split, sid, sess[sid]['split']))

            stems.setdefault(stem, []).append(p)

            if imagesize.size(p) is None:
                r.add(WARN, 'unreadable-image',
                      '%s: cannot read the size from the header — is it a '
                      'real JPEG/PNG/WebP?' % _rel(ds_root, p))

            lp = labels.label_path(p, idir, ldir)
            if not os.path.exists(lp):
                r.add(ERROR, 'missing-label',
                      '%s has no label file. An image with no potholes needs '
                      'an EMPTY %s, not a missing one'
                      % (_rel(ds_root, p), _rel(ds_root, lp)))
                continue
            boxes, bad = labels.parse(lp, num_classes)
            for b in bad:
                r.add(ERROR, 'label-format', '%s %s' % (_rel(ds_root, lp), b))
            per_split[split]['boxes'][p] = boxes
            if not boxes:
                per_split[split]['negatives'] += 1
            for b in boxes:
                per_split[split]['counts'][b.cls] = \
                    per_split[split]['counts'].get(b.cls, 0) + 1

        # ---- labels with no image
        if os.path.isdir(ldir):
            for dirpath, _d, fnames in os.walk(ldir):
                for n in sorted(fnames):
                    if not n.endswith('.txt'):
                        continue
                    lp = os.path.join(dirpath, n)
                    rel = os.path.relpath(lp, ldir)[:-4]
                    if not any(os.path.exists(os.path.join(idir, rel + e))
                               for e in ('.jpg', '.jpeg', '.png', '.webp')):
                        r.add(ERROR, 'orphan-label',
                              '%s has no image beside it' % _rel(ds_root, lp))

    # ---- one name, one picture
    for stem, ps in sorted(stems.items()):
        if len(ps) > 1:
            r.add(ERROR, 'duplicate-filename',
                  '%s appears %d times: %s'
                  % (stem, len(ps),
                     ', '.join(_rel(ds_root, p) for p in ps)))

    # ---- the same pixels twice
    split_of = {}
    for split in sessions.SPLITS:
        for p in per_split[split]['images']:
            split_of[p] = split
    for digest, group in sorted(dupes.exact_groups(all_images).items()):
        across = len({split_of[p] for p in group}) > 1
        r.add(ERROR if across else WARN, 'duplicate-image',
              'identical file content in %s%s'
              % (', '.join(_rel(ds_root, p) for p in group),
                 ' — and they are in different splits, which is leakage'
                 if across else ''))

    if near:
        pairs = dupes.near_pairs(all_images)
        if pairs is None:
            r.add(INFO, 'near-duplicates',
                  'not checked: Pillow is not installed, so the pixels cannot '
                  'be read. pip install Pillow to enable this check.')
        else:
            for a, b, d in pairs:
                across = split_of[a] != split_of[b]
                r.add(ERROR if across else INFO, 'near-duplicate',
                      '%s and %s look like the same view (distance %d)%s'
                      % (_rel(ds_root, a), _rel(ds_root, b), d,
                         ' — across splits, which is leakage' if across else ''))

    # ---- the shape of the set
    counts = {s: len(per_split[s]['images']) for s in sessions.SPLITS}
    if counts['train'] == 0:
        r.add(ERROR, 'empty-split', 'the training set has no images')
    for s in ('val', 'test'):
        if counts[s] == 0:
            r.add(WARN, 'empty-split', 'the %s set has no images' % s)

    total_boxes = {i: 0 for i in names}
    negatives = 0
    for s in sessions.SPLITS:
        negatives += per_split[s]['negatives']
        for i, n in per_split[s]['counts'].items():
            total_boxes[i] = total_boxes.get(i, 0) + n

    if negatives == 0 and sum(counts.values()) > 0:
        r.add(WARN, 'no-hard-negatives',
              'not one image has an empty label file. Without hard negatives '
              'the model never learns what a manhole, a shadow or a patch is '
              'NOT, and false positives are what the survey suffers from.')

    live = [n for n in total_boxes.values() if n]
    if len(live) > 1 and min(live) * 10 < max(live):
        r.add(WARN, 'class-imbalance',
              'class counts are %s — more than 10:1, so the rare class will '
              'be under-learned'
              % ', '.join('%s=%d' % (names.get(i, i), n)
                          for i, n in sorted(total_boxes.items())))

    if os.path.isdir(P['incoming']):
        waiting = dupes.image_files(P['incoming'])
        if waiting:
            r.add(INFO, 'incoming',
                  '%d image(s) waiting in incoming/ — run "dl.py ingest" once '
                  'they are labelled' % len(waiting))

    held = sorted(s for s, row in sess.items() if row['split'] == 'hold')
    if held:
        r.add(INFO, 'hold',
              '%d session(s) registered but not yet assigned to a split: %s'
              % (len(held), ', '.join(held)))

    r.stats = {'names': names, 'counts': counts, 'boxes': total_boxes,
               'negatives': negatives, 'sessions': sess, 'sources': srcs,
               'per_split': per_split, 'root': ds_root}
    return r
