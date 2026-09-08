"""The YOLO label parser: what it accepts, and what it says about the rest."""
import unittest

import harness                                   # noqa: F401  (sets sys.path)
from dlkit import labels


class ParseTest(unittest.TestCase):
    def parse(self, text, classes=2):
        with harness.Dataset() as d:
            p = d.write('labels/train/x.txt', text)
            return labels.parse(p, classes)

    def test_a_good_file_parses(self):
        boxes, bad = self.parse('1 0.5 0.5 0.2 0.1\n0 0.25 0.75 0.1 0.1\n')
        self.assertEqual(bad, [])
        self.assertEqual([b.cls for b in boxes], [1, 0])
        self.assertAlmostEqual(boxes[0].area, 0.02)

    def test_an_empty_file_is_a_hard_negative_not_an_error(self):
        boxes, bad = self.parse('')
        self.assertEqual((boxes, bad), ([], []))

    def test_blank_lines_are_ignored(self):
        boxes, bad = self.parse('\n1 0.5 0.5 0.2 0.1\n\n')
        self.assertEqual(len(boxes), 1)
        self.assertEqual(bad, [])

    def test_wrong_field_count(self):
        _b, bad = self.parse('1 0.5 0.5 0.2\n')
        self.assertIn('4 fields', bad[0])

    def test_class_must_be_an_integer(self):
        _b, bad = self.parse('pothole 0.5 0.5 0.2 0.1\n')
        self.assertIn('not an integer', bad[0])

    def test_a_float_class_is_rejected(self):
        # "1.0" is what a converter that forgot to cast writes. int() refuses
        # it, so it lands in the same bucket as any other non-integer.
        _b, bad = self.parse('1.0 0.5 0.5 0.2 0.1\n')
        self.assertIn('not an integer', bad[0])

    def test_a_zero_padded_class_is_rejected(self):
        # int('01') is 1, so a careless reader accepts this and hides a tool
        # writing a format we did not ask for.
        _b, bad = self.parse('01 0.5 0.5 0.2 0.1\n')
        self.assertIn('plain integer', bad[0])

    def test_class_id_out_of_range(self):
        _b, bad = self.parse('7 0.5 0.5 0.2 0.1\n')
        self.assertIn('outside 0..1', bad[0])

    def test_negative_class_id(self):
        _b, bad = self.parse('-1 0.5 0.5 0.2 0.1\n')
        self.assertIn('outside 0..1', bad[0])

    def test_zero_area(self):
        _b, bad = self.parse('1 0.5 0.5 0 0.1\n')
        self.assertIn('zero or negative', bad[0])

    def test_negative_size(self):
        _b, bad = self.parse('1 0.5 0.5 -0.2 0.1\n')
        self.assertIn('zero or negative', bad[0])

    def test_a_box_of_about_one_pixel(self):
        _b, bad = self.parse('1 0.5 0.5 0.0005 0.0005\n')
        self.assertIn('nothing to learn from', bad[0])

    def test_box_running_off_the_left_edge(self):
        _b, bad = self.parse('1 0.02 0.5 0.2 0.1\n')
        self.assertIn('outside the image', bad[0])

    def test_box_running_off_the_bottom(self):
        _b, bad = self.parse('1 0.5 0.98 0.2 0.2\n')
        self.assertIn('outside the image', bad[0])

    def test_a_box_flush_to_the_edge_is_fine(self):
        boxes, bad = self.parse('1 0.1 0.1 0.2 0.2\n')
        self.assertEqual(bad, [])
        self.assertEqual(len(boxes), 1)

    def test_nan(self):
        _b, bad = self.parse('1 nan 0.5 0.2 0.1\n')
        self.assertIn('NaN', bad[0])

    def test_non_numeric_coordinates(self):
        _b, bad = self.parse('1 left 0.5 0.2 0.1\n')
        self.assertIn('not all numbers', bad[0])

    def test_one_bad_line_does_not_lose_the_good_ones(self):
        boxes, bad = self.parse('1 0.5 0.5 0.2 0.1\nrubbish\n0 0.4 0.4 0.1 0.1\n')
        self.assertEqual(len(boxes), 2)
        self.assertEqual(len(bad), 1)
        self.assertIn('line 2', bad[0])


class GeometryTest(unittest.TestCase):
    def test_iou_of_a_box_with_itself_is_one(self):
        b = labels.Box(1, 0.5, 0.5, 0.2, 0.2, 1)
        self.assertAlmostEqual(labels.iou(b, b), 1.0)

    def test_disjoint_boxes_score_zero(self):
        a = labels.Box(1, 0.1, 0.1, 0.1, 0.1, 1)
        b = labels.Box(1, 0.9, 0.9, 0.1, 0.1, 2)
        self.assertEqual(labels.iou(a, b), 0.0)

    def test_half_overlap(self):
        a = labels.Box(1, 0.25, 0.5, 0.5, 0.5, 1)
        b = labels.Box(1, 0.50, 0.5, 0.5, 0.5, 2)
        # intersection 0.25x0.5, union 0.5x0.5 x2 - that = 0.375
        self.assertAlmostEqual(labels.iou(a, b), 0.125 / 0.375)

    def test_pixel_coordinates(self):
        b = labels.Box(1, 0.5, 0.5, 0.5, 0.5, 1)
        self.assertEqual(b.xyxy(640, 640), (160.0, 160.0, 480.0, 480.0))


if __name__ == '__main__':
    unittest.main()
