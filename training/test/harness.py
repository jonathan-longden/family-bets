"""Building a throwaway dataset on disk, so the checks are tested against real
files rather than against a mock of the filesystem.

The images are real PNGs, written here with zlib and struct: a test that runs
only where Pillow happens to be installed is a test that does not run.
"""
import os
import shutil
import struct
import sys
import tempfile
import zlib

# The toolkit lives beside the tests rather than on the path, so every test
# module imports this one first and gets the import for free.
TOOLS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                     'tools')
if TOOLS not in sys.path:
    sys.path.insert(0, TOOLS)

TRAIN, VAL, TEST = 'train', 'val', 'test'

DEFAULT_YAML = """path: .
train: images/train
val: images/val
test: images/test

names:
  0: manhole
  1: pothole
"""

SESSION_HEADER = ('session_id,split,protected,road,location,captured_on,'
                  'camera,source_id,notes\n')
SOURCE_HEADER = ('source_id,kind,name,url,licence,commercial_use,obtained_on,'
                 'evidence,notes\n')
DEFAULT_SOURCES = (SOURCE_HEADER +
                   'own,own-capture,Ours,,owner,yes,2026-01-01,we took them,\n'
                   'web,external-dataset,Somewhere,http://x,unknown,unknown,'
                   '2026-01-01,none,\n')


def png(path, w=32, h=24, tint=0):
    """A real PNG of a flat-ish colour. tint changes the bytes, so two images
    with different tints are genuinely different files."""
    raw = b''
    for y in range(h):
        raw += b'\x00'
        for x in range(w):
            raw += bytes(((x * 7 + tint) % 256, (y * 5 + tint) % 256,
                          (tint * 3) % 256))

    def chunk(kind, data):
        return (struct.pack('>I', len(data)) + kind + data
                + struct.pack('>I', zlib.crc32(kind + data) & 0xFFFFFFFF))

    body = (b'\x89PNG\r\n\x1a\n'
            + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(raw))
            + chunk(b'IEND', b''))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'wb') as f:
        f.write(body)


class Dataset(object):
    """A dataset in a temporary directory. Use as a context manager."""

    def __init__(self, yaml=DEFAULT_YAML, sources=DEFAULT_SOURCES):
        self.root = tempfile.mkdtemp(prefix='dlkit-test-')
        self.write('dataset.yaml', yaml)
        self.write('sources.csv', sources)
        self.sessions = []
        for s in (TRAIN, VAL, TEST):
            os.makedirs(os.path.join(self.root, 'images', s), exist_ok=True)
            os.makedirs(os.path.join(self.root, 'labels', s), exist_ok=True)
        os.makedirs(os.path.join(self.root, 'incoming'), exist_ok=True)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        shutil.rmtree(self.root, ignore_errors=True)

    # ---- files
    def path(self, *parts):
        return os.path.join(self.root, *parts)

    def write(self, rel, text):
        p = self.path(rel)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, 'w', encoding='utf-8') as f:
            f.write(text)
        return p

    # ---- registers
    def session(self, sid, split=TRAIN, protected='no', source='own',
                notes=''):
        self.sessions.append('%s,%s,%s,road,place,2026-01-01,phone,%s,%s'
                             % (sid, split, protected, source, notes))
        self.write('sessions.csv',
                   SESSION_HEADER + '\n'.join(self.sessions) + '\n')
        return sid

    def raw_sessions(self, text):
        self.write('sessions.csv', text)

    # ---- content
    def image(self, split, stem, boxes='1 0.5 0.5 0.2 0.2\n', tint=None,
              ext='.png', label=True):
        """One image and, unless told otherwise, its label. boxes=None means an
        empty label file — a hard negative."""
        if tint is None:
            tint = (abs(hash(stem)) % 200) + 1
        png(self.path('images', split, stem + ext), tint=tint)
        if label:
            self.write(os.path.join('labels', split, stem + '.txt'),
                       boxes or '')
        return self.path('images', split, stem + ext)
