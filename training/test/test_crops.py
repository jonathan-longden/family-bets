"""Cutting clean regions out of paint-marked photographs.

The check that matters is the paint one. A region chosen by eye from a
thumbnail is a guess; re-scanning the pixels that actually came out is the
only thing that proves the marking did not come with them.
"""
import os
import unittest

import harness
from dlkit import crops, paint

try:
    from PIL import Image
    HAVE_PIL = True
except ImportError:
    HAVE_PIL = False

HEADER = ('crop_id,source_image,x0,y0,x1,y1,kind,confuser,note\n')
GOOD = HEADER + 'a-01,src.png,0.0,0.0,0.5,0.5,negative,manhole,a note\n'


def spec(d, text):
    return d.write('crops.csv', text)


class SpecTest(unittest.TestCase):
    def read(self, text):
        with harness.Dataset() as d:
            return crops.read_spec(spec(d, text))

    def test_a_good_spec_reads(self):
        rows, errs = self.read(GOOD)
        self.assertEqual(errs, [])
        self.assertEqual(rows[0]['_box'], [0.0, 0.0, 0.5, 0.5])

    def test_a_drifted_header_is_caught(self):
        _r, errs = self.read('crop_id,source_image\na-01,src.png\n')
        self.assertIn('header is', errs[0])

    def test_a_repeated_crop_id(self):
        _r, errs = self.read(GOOD + 'a-01,src.png,0.5,0.5,0.9,0.9,negative,x,\n')
        self.assertIn('appears twice', errs[0])

    def test_coordinates_must_be_fractions(self):
        _r, errs = self.read(HEADER + 'a-01,src.png,0,0,1400,900,negative,x,\n')
        self.assertIn('fractions of the image', errs[0])

    def test_an_inside_out_box_is_caught(self):
        _r, errs = self.read(HEADER + 'a-01,src.png,0.8,0.1,0.2,0.9,negative,x,\n')
        self.assertIn('above and left', errs[0])

    def test_kind_must_be_positive_or_negative(self):
        _r, errs = self.read(HEADER + 'a-01,src.png,0,0,0.5,0.5,maybe,x,\n')
        self.assertIn("'maybe'", errs[0])

    def test_a_missing_spec_is_reported_not_thrown(self):
        rows, errs = crops.read_spec('/nowhere/crops.csv')
        self.assertEqual(rows, [])
        self.assertIn('does not exist', errs[0])


def painted_png(path, w=400, h=300, paint_box=None):
    """A grey frame, optionally with a patch of survey yellow in it."""
    im = Image.new('RGB', (w, h), (110, 110, 112))
    if paint_box:
        for y in range(paint_box[1], paint_box[3]):
            for x in range(paint_box[0], paint_box[2]):
                im.putpixel((x, y), (240, 205, 20))      # marking yellow
    im.save(path)


@unittest.skipUnless(HAVE_PIL, 'needs Pillow')
class CutTest(unittest.TestCase):
    def setUp(self):
        self.d = harness.Dataset()
        self.src = self.d.path('incoming')
        os.makedirs(self.src, exist_ok=True)

    def tearDown(self):
        self.d.__exit__()

    def cut(self, text):
        rows, errs = crops.read_spec(spec(self.d, text))
        self.assertEqual(errs, [])
        return crops.cut(rows, self.src)

    def test_a_clean_region_passes(self):
        # paint in the right half; the crop takes the left
        painted_png(os.path.join(self.src, 'src.png'), paint_box=(300, 0, 380, 60))
        c = self.cut(HEADER + 'a-01,src.png,0.0,0.0,0.5,1.0,negative,shade,\n')[0]
        self.assertEqual(c.paint, 0.0)
        self.assertEqual(c.problems, [])

    def test_paint_inside_the_crop_refuses_it(self):
        painted_png(os.path.join(self.src, 'src.png'), paint_box=(20, 20, 160, 160))
        c = self.cut(HEADER + 'a-01,src.png,0.0,0.0,0.6,1.0,negative,shade,\n')[0]
        self.assertGreater(c.paint, crops.MAX_PAINT)
        self.assertIn('survey paint still in the crop', c.problems[0])

    def test_a_tight_crop_is_refused_for_scale(self):
        # walking-distance photographs: a tight crop arrives far larger than a
        # driving camera would ever see the feature
        painted_png(os.path.join(self.src, 'src.png'))
        c = self.cut(HEADER + 'a-01,src.png,0.1,0.1,0.25,0.9,negative,x,\n')[0]
        self.assertIn('driving camera', c.problems[0])

    def test_a_missing_source_is_reported_per_crop(self):
        c = self.cut(HEADER + 'a-01,gone.png,0.0,0.0,0.5,1.0,negative,x,\n')[0]
        self.assertIn('not in incoming/', c.problems[0])
        self.assertIsNone(c.box)

    def test_writing_gives_a_negative_an_empty_label(self):
        painted_png(os.path.join(self.src, 'src.png'))
        cuts = self.cut(HEADER + 'a-01,src.png,0.0,0.0,0.6,1.0,negative,x,\n')
        out = crops.write(cuts, self.src, self.src, 'crop-test')
        self.assertEqual(len(out), 1)
        self.assertTrue(os.path.exists(self.d.path('incoming', 'crop-test__a-01.jpg')))
        with open(self.d.path('incoming', 'crop-test__a-01.txt')) as f:
            self.assertEqual(f.read(), '')

    def test_a_positive_gets_no_label_because_it_needs_a_human(self):
        painted_png(os.path.join(self.src, 'src.png'))
        cuts = self.cut(HEADER + 'a-01,src.png,0.0,0.0,0.6,1.0,positive,,\n')
        crops.write(cuts, self.src, self.src, 'crop-test')
        self.assertTrue(os.path.exists(self.d.path('incoming', 'crop-test__a-01.jpg')))
        self.assertFalse(os.path.exists(self.d.path('incoming', 'crop-test__a-01.txt')))

    def test_a_refused_crop_is_never_written(self):
        painted_png(os.path.join(self.src, 'src.png'), paint_box=(20, 20, 160, 160))
        cuts = self.cut(HEADER + 'a-01,src.png,0.0,0.0,0.6,1.0,negative,x,\n')
        self.assertEqual(crops.write(cuts, self.src, self.src, 'crop-test'), [])

    def test_the_written_name_carries_the_session(self):
        painted_png(os.path.join(self.src, 'src.png'))
        cuts = self.cut(HEADER + 'a-01,src.png,0.0,0.0,0.6,1.0,negative,x,\n')
        out = crops.write(cuts, self.src, self.src, 'crop-insp-2026-09')
        from dlkit import sessions
        self.assertEqual(sessions.session_of(out[0][0]), 'crop-insp-2026-09')


@unittest.skipUnless(HAVE_PIL, 'needs Pillow')
class PaintTest(unittest.TestCase):
    def test_marking_yellow_is_found(self):
        im = Image.new('RGB', (100, 100), (240, 205, 20))
        self.assertGreater(paint.fraction(im), 0.9)

    def test_tarmac_is_not(self):
        im = Image.new('RGB', (100, 100), (105, 105, 108))
        self.assertEqual(paint.fraction(im), 0.0)

    def test_white_lining_is_not(self):
        im = Image.new('RGB', (100, 100), (238, 238, 236))
        self.assertEqual(paint.fraction(im), 0.0)

    def test_deep_shadow_is_not(self):
        im = Image.new('RGB', (100, 100), (28, 28, 30))
        self.assertEqual(paint.fraction(im), 0.0)

    def test_the_top_of_the_frame_can_be_skipped(self):
        # autumn foliage along the top shares the hue band with marking paint
        im = Image.new('RGB', (100, 100), (105, 105, 108))
        for y in range(0, 40):
            for x in range(100):
                im.putpixel((x, y), (200, 140, 40))
        self.assertGreater(paint.fraction(im), 0.3)
        self.assertEqual(paint.road_fraction(im), 0.0)


if __name__ == '__main__':
    unittest.main()
