"""The session register: what a picture is of, where it came from, and which
split it is allowed to be in.

A session is one recording — one drive, one street, one inspection visit. It
is the unit of splitting, because frames within a session look alike and
splitting them at random puts near-copies of a training image into the test
set. A model that has effectively seen the answer scores well and helps
nobody.

Every image file is named  <session_id>__<frame_id>.<ext>  so the session of a
picture is a property of the picture, not of a list somebody has to keep in
step. That is what makes the leakage check possible at all: the validator can
work out the session of every file on disk and prove no session straddles two
splits.
"""
import csv
import os
import re

SPLITS = ('train', 'val', 'test')
# 'hold' is where an ingested session waits until somebody decides its split.
# It is a real state, not an error: deciding takes knowing what else is in the
# set, and that decision should not be forced at intake.
ALL_SPLITS = SPLITS + ('hold',)

SESSION_RE = re.compile(r'^[a-z0-9][a-z0-9-]*$')
STEM_RE = re.compile(r'^([a-z0-9][a-z0-9-]*)__([A-Za-z0-9][A-Za-z0-9._-]*)$')

SESSION_FIELDS = ['session_id', 'split', 'protected', 'road', 'location',
                  'captured_on', 'camera', 'source_id', 'notes']
SOURCE_FIELDS = ['source_id', 'kind', 'name', 'url', 'licence',
                 'commercial_use', 'obtained_on', 'evidence', 'notes']

SOURCE_KINDS = ('own-capture', 'external-dataset', 'third-party-supplied')
COMMERCIAL = ('yes', 'no', 'unknown')


def session_of(name):
    """The session a filename belongs to, or None if it is not named to the
    convention. Takes a bare filename or a path."""
    stem = os.path.splitext(os.path.basename(name))[0]
    m = STEM_RE.match(stem)
    return m.group(1) if m else None


def read_csv(path, fields):
    """Rows as dicts, with the header checked. A CSV whose columns have
    drifted is worse than a missing one, because everything downstream keeps
    working on the wrong field."""
    if not os.path.exists(path):
        return [], ['%s does not exist' % os.path.basename(path)]
    with open(path, newline='', encoding='utf-8') as f:
        r = csv.DictReader(f)
        got = list(r.fieldnames or [])
        if got != fields:
            return [], ['%s header is %s, expected %s'
                        % (os.path.basename(path), got, fields)]
        rows = [dict(x) for x in r]
    return rows, []


def read_sessions(path):
    rows, errs = read_csv(path, SESSION_FIELDS)
    out, seen = {}, set()
    for i, row in enumerate(rows, start=2):
        sid = (row.get('session_id') or '').strip()
        where = 'sessions.csv line %d' % i
        if not SESSION_RE.match(sid):
            errs.append('%s: session_id %r is not lower-case letters, digits '
                        'and hyphens' % (where, sid))
            continue
        if sid in seen:
            errs.append('%s: session_id %r appears twice' % (where, sid))
            continue
        seen.add(sid)
        split = (row.get('split') or '').strip()
        if split not in ALL_SPLITS:
            errs.append('%s: split %r is not one of %s'
                        % (where, split, ', '.join(ALL_SPLITS)))
            continue
        prot = (row.get('protected') or '').strip().lower()
        if prot not in ('yes', 'no'):
            errs.append('%s: protected %r is not yes or no' % (where, prot))
            continue
        row['session_id'] = sid
        row['split'] = split
        row['protected'] = prot
        out[sid] = row
    return out, errs


def read_sources(path):
    rows, errs = read_csv(path, SOURCE_FIELDS)
    out, seen = {}, set()
    for i, row in enumerate(rows, start=2):
        sid = (row.get('source_id') or '').strip()
        where = 'sources.csv line %d' % i
        if not sid:
            errs.append('%s: source_id is empty' % where)
            continue
        if sid in seen:
            errs.append('%s: source_id %r appears twice' % (where, sid))
            continue
        seen.add(sid)
        kind = (row.get('kind') or '').strip()
        if kind not in SOURCE_KINDS:
            errs.append('%s: kind %r is not one of %s'
                        % (where, kind, ', '.join(SOURCE_KINDS)))
            continue
        com = (row.get('commercial_use') or '').strip().lower()
        if com not in COMMERCIAL:
            errs.append('%s: commercial_use %r is not one of %s'
                        % (where, com, ', '.join(COMMERCIAL)))
            continue
        row['source_id'] = sid
        row['kind'] = kind
        row['commercial_use'] = com
        out[sid] = row
    return out, errs
