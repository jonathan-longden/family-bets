"""Finding the same picture twice, and saying so honestly when we cannot."""
import unittest

import harness
from dlkit import dupes


class ExactTest(unittest.TestCase):
    def test_identical_files_group_together(self):
        with harness.Dataset() as d:
            a = d.image(harness.TRAIN, 'lane-a__0001', tint=7)
            b = d.image(harness.TRAIN, 'lane-a__0002', tint=7)
            d.image(harness.TRAIN, 'lane-a__0003', tint=9)
            groups = dupes.exact_groups(dupes.image_files(
                d.path('images', 'train')))
            self.assertEqual(len(groups), 1)
            self.assertEqual(sorted(list(groups.values())[0]), sorted([a, b]))

    def test_different_files_do_not(self):
        with harness.Dataset() as d:
            d.image(harness.TRAIN, 'lane-a__0001', tint=1)
            d.image(harness.TRAIN, 'lane-a__0002', tint=2)
            self.assertEqual(dupes.exact_groups(dupes.image_files(
                d.path('images', 'train'))), {})

    def test_image_files_finds_the_extensions_we_accept_and_no_others(self):
        with harness.Dataset() as d:
            harness.png(d.path('images', 'train', 'a.png'))
            harness.png(d.path('images', 'train', 'b.JPG'))
            d.write('images/train/notes.txt', 'hello')
            got = [f.rsplit('/', 1)[-1]
                   for f in dupes.image_files(d.path('images', 'train'))]
            self.assertEqual(sorted(got), ['a.png', 'b.JPG'])


class NearTest(unittest.TestCase):
    def test_it_reports_not_checked_rather_than_nothing_found(self):
        """The distinction that matters: without Pillow the answer is None,
        never an empty list, so a caller cannot mistake 'could not look' for
        'looked and found nothing'."""
        if dupes.HAVE_PIL:
            self.skipTest('Pillow is installed, so the check really runs')
        with harness.Dataset() as d:
            d.image(harness.TRAIN, 'lane-a__0001')
            self.assertIsNone(dupes.near_pairs(
                dupes.image_files(d.path('images', 'train'))))

    def test_hamming_distance(self):
        self.assertEqual(dupes.distance(0b1011, 0b1011), 0)
        self.assertEqual(dupes.distance(0b1011, 0b1000), 2)


if __name__ == '__main__':
    unittest.main()
