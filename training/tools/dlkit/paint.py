"""Finding survey marking paint in a frame.

The September inspection photographs are marked up: nearly every defect has a
yellow, orange or white bracket sprayed round it. That paint is perfectly
correlated with the thing we want the model to find, so a model trained on
these learns to find paint. It is the single most dangerous property of the
only photographs we currently have.

So paint gets measured rather than eyeballed. Marking paint is highly
saturated yellow or orange; wet tarmac and shadow have almost no saturation,
and road lining is white — high value, low saturation — so all three separate
cleanly.

Two things DO share the hue band and must be handled by looking rather than by
thresholding: autumn foliage along the top of a frame, and the surveyor's
orange overalls. `road_fraction` ignores the upper part of the frame for the
first; the second is why every proposed crop is reviewed by eye as well.
"""
import colorsys

HUE_LO, HUE_HI = 10, 70       # orange through yellow, in degrees
MIN_SAT = 0.45
LIGHT_LO, LIGHT_HI = 0.30, 0.85
SKY_FRACTION = 0.45           # above this much of the height is hedge and sky


def _is_paint(r, g, b):
    hu, li, sa = colorsys.rgb_to_hls(r / 255.0, g / 255.0, b / 255.0)
    return (sa > MIN_SAT and LIGHT_LO < li < LIGHT_HI
            and HUE_LO <= hu * 360 <= HUE_HI)


def fraction(im, skip_top=0.0, step=6):
    """What fraction of the sampled pixels look like marking paint.

    `im` is a PIL Image. Sampled at 1/step resolution because paint blobs are
    large and a full-resolution scan of a 3264x1836 frame buys nothing.
    """
    W, H = im.size
    small = im.convert('RGB').resize((max(W // step, 1), max(H // step, 1)))
    w, h = small.size
    y0 = int(h * skip_top)
    px = small.load()
    hits = 0
    for y in range(y0, h):
        for x in range(w):
            if _is_paint(*px[x, y]):
                hits += 1
    total = w * (h - y0)
    return hits / total if total else 0.0


def road_fraction(im):
    """Paint on the road, ignoring the hedge and sky along the top."""
    return fraction(im, skip_top=SKY_FRACTION)
