"""Image dimensions without a decoder.

Pillow is not a dependency of this pipeline on purpose: every check that can
run on a bare Python install is a check somebody will actually run. Width and
height live in the file header of every format we accept, so reading them
needs no decoder at all — and width and height are all the validator needs,
because YOLO labels are normalised.

Returns (width, height) or None when the file is not a format we can read.
"""
import struct


def _jpeg(f):
    """Walk the marker segments to the first SOF, which carries the size.

    A JPEG is a chain of 0xFF-prefixed markers. Most carry a two-byte length
    and are skipped; the frame headers (SOF0..SOF15, minus the four that are
    not frame headers) carry height then width as big-endian shorts.
    """
    if f.read(2) != b'\xff\xd8':
        return None
    while True:
        b = f.read(1)
        if not b:
            return None
        if b != b'\xff':
            continue
        # Fill bytes: any run of 0xFF before a marker is padding.
        while b == b'\xff':
            b = f.read(1)
            if not b:
                return None
        m = b[0]
        if m in (0xD8, 0x01) or 0xD0 <= m <= 0xD7:
            continue                      # no payload
        if m == 0xD9:
            return None                   # end of image, no frame found
        head = f.read(2)
        if len(head) != 2:
            return None
        seg = struct.unpack('>H', head)[0] - 2
        if seg < 0:
            return None
        if m in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7,
                 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
            body = f.read(5)
            if len(body) != 5:
                return None
            h, w = struct.unpack('>HH', body[1:5])
            return (w, h)
        f.seek(seg, 1)


def _png(f):
    f.seek(0)
    if f.read(8) != b'\x89PNG\r\n\x1a\n':
        return None
    f.seek(16)
    body = f.read(8)
    if len(body) != 8:
        return None
    w, h = struct.unpack('>II', body)
    return (w, h)


def _webp(f):
    """The three WebP flavours store the size in three different places."""
    f.seek(0)
    head = f.read(30)
    if len(head) < 30 or head[0:4] != b'RIFF' or head[8:12] != b'WEBP':
        return None
    kind = head[12:16]
    if kind == b'VP8 ':
        w, h = struct.unpack('<HH', head[26:30])
        return (w & 0x3FFF, h & 0x3FFF)
    if kind == b'VP8L':
        bits = struct.unpack('<I', head[21:25])[0]
        return ((bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1)
    if kind == b'VP8X':
        w = head[24] | head[25] << 8 | head[26] << 16
        h = head[27] | head[28] << 8 | head[29] << 16
        return (w + 1, h + 1)
    return None


def size(path):
    try:
        with open(path, 'rb') as f:
            head = f.read(12)
            f.seek(0)
            if head[0:2] == b'\xff\xd8':
                return _jpeg(f)
            if head[0:8] == b'\x89PNG\r\n\x1a\n':
                return _png(f)
            if head[0:4] == b'RIFF' and head[8:12] == b'WEBP':
                return _webp(f)
    except OSError:
        return None
    return None
