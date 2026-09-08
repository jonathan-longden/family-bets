"""Finding the same picture twice.

Two levels, because they cost very different amounts and catch different
mistakes:

  EXACT      a content hash. Always available, and catches the mistake that
             actually happens — the same file ingested twice under two names,
             which quietly puts a test image into the training set.

  NEAR       a perceptual hash over a tiny greyscale copy. Catches consecutive
             frames of the same pothole, which is the leakage the session rule
             exists to prevent and this is the check that proves the session
             rule worked. It needs Pillow, because it needs the pixels, and
             Pillow is optional: everything else here runs on a bare Python.
"""
import hashlib
import os

try:
    from PIL import Image
    HAVE_PIL = True
except Exception:                       # pragma: no cover - environment
    HAVE_PIL = False

NEAR_BITS = 64          # 8x9 difference hash
NEAR_MAX_DISTANCE = 6   # hand-set: below this, two road frames are the same view


def sha256(path, chunk=1 << 20):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for block in iter(lambda: f.read(chunk), b''):
            h.update(block)
    return h.hexdigest()


def exact_groups(paths):
    """{digest: [paths]} for digests with more than one file."""
    by = {}
    for p in paths:
        by.setdefault(sha256(p), []).append(p)
    return {d: sorted(v) for d, v in by.items() if len(v) > 1}


def dhash(path):
    """Difference hash: is each pixel brighter than the one to its right?

    Insensitive to exposure and to rescaling, which is what we want — the same
    pothole a tenth of a second later is the same picture for our purposes
    even though not one byte matches.
    """
    if not HAVE_PIL:
        return None
    with Image.open(path) as im:
        small = im.convert('L').resize((9, 8), Image.BILINEAR)
        px = list(small.getdata())
    bits = 0
    for row in range(8):
        base = row * 9
        for col in range(8):
            bits = (bits << 1) | (1 if px[base + col] > px[base + col + 1] else 0)
    return bits


def distance(a, b):
    return bin(a ^ b).count('1')


def near_pairs(paths, max_distance=NEAR_MAX_DISTANCE):
    """[(a, b, distance)] for pairs closer than the threshold, or None when
    Pillow is missing — None means 'not checked', which must not be reported
    as 'nothing found'."""
    if not HAVE_PIL:
        return None
    hashes = []
    for p in paths:
        try:
            h = dhash(p)
        except Exception:
            continue
        if h is not None:
            hashes.append((p, h))
    out = []
    for i in range(len(hashes)):
        for j in range(i + 1, len(hashes)):
            d = distance(hashes[i][1], hashes[j][1])
            if d <= max_distance:
                out.append((hashes[i][0], hashes[j][0], d))
    return sorted(out, key=lambda t: t[2])


def image_files(root, exts=('.jpg', '.jpeg', '.png', '.webp')):
    out = []
    for dirpath, _dirs, names in os.walk(root):
        for n in sorted(names):
            if os.path.splitext(n)[1].lower() in exts:
                out.append(os.path.join(dirpath, n))
    return sorted(out)
