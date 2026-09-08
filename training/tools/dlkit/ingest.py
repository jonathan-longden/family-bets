"""Moving reviewed images out of incoming/ and into a split.

Intake is deliberately two steps. Images land in incoming/ named however the
camera named them; a human labels them and decides which session they belong
to; only then does this move them, renaming to <session>__<frame> so the
session becomes a property of the file. Nothing about that can be automated
without automating the judgement, which is the part that has to stay human.
"""
import os
import shutil

from . import config, dupes, sessions


def plan(ds_root, session_id, split=None, ext_order=('.jpg', '.jpeg', '.png', '.webp')):
    """(moves, problems). A move is (image_src, image_dst, label_src, label_dst).

    `split` is an assertion, not an override: pass it to say which split you
    expect this session to land in, and be told if the register disagrees.
    Where a session goes is decided in sessions.csv and nowhere else, so that
    a diff of the register is a complete record of how the set was divided.

    Frame numbers are assigned in sorted filename order, which for a phone is
    capture order, so the numbering carries the sequence rather than losing it.
    """
    P = config.paths(ds_root)
    sess, errs = sessions.read_sessions(P['sessions'])
    problems = list(errs)
    if session_id not in sess:
        return [], problems + ['session %r is not in sessions.csv — register '
                               'it before ingesting' % session_id]
    split = split or sess[session_id]['split']
    if split == 'hold':
        return [], problems + ['session %r is on hold. Decide where it goes '
                               'and set its split in sessions.csv — the '
                               'register decides, not the command line.'
                               % session_id]
    if split != sess[session_id]['split']:
        return [], problems + ['session %r is registered as %s but you said '
                               '%s — change sessions.csv if the register is '
                               'wrong, not the files'
                               % (session_id, sess[session_id]['split'], split)]

    srcs = sorted(dupes.image_files(P['incoming'], ext_order))
    if not srcs:
        return [], problems + ['incoming/ has no images']

    idir = os.path.join(P['images'], split)
    ldir = os.path.join(P['labels'], split)
    existing = len([n for n in (os.listdir(idir) if os.path.isdir(idir) else [])
                    if sessions.session_of(n) == session_id])

    moves = []
    for n, src in enumerate(srcs, start=existing + 1):
        ext = os.path.splitext(src)[1].lower()
        stem = '%s__%04d' % (session_id, n)
        lsrc = os.path.splitext(src)[0] + '.txt'
        if not os.path.exists(lsrc):
            problems.append('%s has no label file beside it. Label it first — '
                            'an empty .txt if it is a hard negative.'
                            % os.path.basename(src))
            continue
        moves.append((src, os.path.join(idir, stem + ext),
                      lsrc, os.path.join(ldir, stem + '.txt')))
    return moves, problems


def apply(moves, copy=False):
    op = shutil.copy2 if copy else shutil.move
    for isrc, idst, lsrc, ldst in moves:
        for d in (idst, ldst):
            os.makedirs(os.path.dirname(d), exist_ok=True)
        if os.path.exists(idst) or os.path.exists(ldst):
            raise IOError('%s already exists — refusing to overwrite'
                          % (idst if os.path.exists(idst) else ldst))
        op(isrc, idst)
        op(lsrc, ldst)
    return len(moves)
