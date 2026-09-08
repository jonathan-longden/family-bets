"""Every finding the validator can produce, each provoked by a real dataset on
disk.

The leakage checks are the point of this file. A missing label is caught by
the trainer eventually; a session that appears in both train and test is not
caught by anything else, ever, and produces a model that scores well and finds
nothing on a road it has not seen.
"""
import unittest

import harness
from dlkit import validate


def codes(result, level=None):
    return sorted(f.code for f in result.findings
                  if level is None or f.level == level)


def find(result, code):
    return [f for f in result.findings if f.code == code]


class LeakageTest(unittest.TestCase):
    def test_a_session_in_two_splits_is_an_error(self):
        with harness.Dataset() as d:
            d.session('lane-a', harness.TRAIN)
            d.image(harness.TRAIN, 'lane-a__0001')
            d.image(harness.TEST, 'lane-a__0002')     # same session, other split
            r = validate.validate(d.root, near=False)
            hits = find(r, 'leakage')
            self.assertEqual(len(hits), 1)
            self.assertEqual(hits[0].level, validate.ERROR)
            self.assertIn('lane-a', hits[0].message)

    def test_sessions_in_their_own_splits_are_fine(self):
        with harness.Dataset() as d:
            d.session('lane-a', harness.TRAIN)
            d.session('lane-b', harness.TEST, protected='yes')
            d.image(harness.TRAIN, 'lane-a__0001')
            d.image(harness.TEST, 'lane-b__0001')
            r = validate.validate(d.root, near=False)
            self.assertEqual(find(r, 'leakage'), [])
            self.assertEqual([f.message for f in r.errors], [])

    def test_the_same_file_in_two_splits_is_leakage(self):
        with harness.Dataset() as d:
            d.session('lane-a', harness.TRAIN)
            d.session('lane-b', harness.TEST)
            d.image(harness.TRAIN, 'lane-a__0001', tint=42)
            d.image(harness.TEST, 'lane-b__0001', tint=42)   # identical bytes
            r = validate.validate(d.root, near=False)
            hits = find(r, 'duplicate-image')
            self.assertEqual(len(hits), 1)
            self.assertEqual(hits[0].level, validate.ERROR)
            self.assertIn('different splits', hits[0].message)

    def test_the_same_file_twice_inside_one_split_is_only_a_warning(self):
        with harness.Dataset() as d:
            d.session('lane-a', harness.TRAIN)
            d.image(harness.TRAIN, 'lane-a__0001', tint=42)
            d.image(harness.TRAIN, 'lane-a__0002', tint=42)
            r = validate.validate(d.root, near=False)
            hits = find(r, 'duplicate-image')
            self.assertEqual(len(hits), 1)
            self.assertEqual(hits[0].level, validate.WARN)

    def test_a_protected_session_outside_test_is_an_error(self):
        with harness.Dataset() as d:
            d.session('gold-a', harness.TRAIN, protected='yes')
            d.image(harness.TRAIN, 'gold-a__0001')
            r = validate.validate(d.root, near=False)
            hits = find(r, 'gold-test')
            self.assertEqual(len(hits), 1)
            self.assertIn('held out means test', hits[0].message)


class NamingTest(unittest.TestCase):
    def test_a_file_not_named_to_the_convention(self):
        with harness.Dataset() as d:
            d.session('lane-a', harness.TRAIN)
            d.image(harness.TRAIN, 'IMG_4021')
            r = validate.validate(d.root, near=False)
            self.assertEqual(len(find(r, 'filename')), 1)

    def test_a_file_from_a_session_nobody_registered(self):
        with harness.Dataset() as d:
            d.session('lane-a', harness.TRAIN)
            d.image(harness.TRAIN, 'lane-z__0001')
            r = validate.validate(d.root, near=False)
            hits = find(r, 'unregistered-session')
            self.assertEqual(len(hits), 1)
            self.assertIn('lane-z', hits[0].message)

    def test_the_same_stem_in_two_places(self):
        with harness.Dataset() as d:
            d.session('lane-a', harness.TRAIN)
            d.image(harness.TRAIN, 'lane-a__0001', tint=1)
            # same stem, different extension and different pixels
            d.image(harness.TRAIN, 'lane-a__0001', tint=9, ext='.jpg')
            r = validate.validate(d.root, near=False)
            self.assertEqual(len(find(r, 'duplicate-filename')), 1)


class PairingTest(unittest.TestCase):
    def test_an_image_with_no_label(self):
        with harness.Dataset() as d:
            d.session('lane-a', harness.TRAIN)
            d.image(harness.TRAIN, 'lane-a__0001', label=False)
            r = validate.validate(d.root, near=False)
            hits = find(r, 'missing-label')
            self.assertEqual(len(hits), 1)
            self.assertIn('EMPTY', hits[0].message)

    def test_an_empty_label_is_not_a_missing_label(self):
        with harness.Dataset() as d:
            d.session('lane-a', harness.TRAIN)
            d.image(harness.TRAIN, 'lane-a__0001', boxes=None)
            r = validate.validate(d.root, near=False)
            self.assertEqual(find(r, 'missing-label'), [])
            self.assertEqual(r.stats['negatives'], 1)

    def test_a_label_with_no_image(self):
        with harness.Dataset() as d:
            d.session('lane-a', harness.TRAIN)
            d.image(harness.TRAIN, 'lane-a__0001')
            d.write('labels/train/lane-a__0002.txt', '1 0.5 0.5 0.1 0.1\n')
            r = validate.validate(d.root, near=False)
            hits = find(r, 'orphan-label')
            self.assertEqual(len(hits), 1)
            self.assertIn('lane-a__0002', hits[0].message)

    def test_a_broken_label_line_is_reported_with_its_file(self):
        with harness.Dataset() as d:
            d.session('lane-a', harness.TRAIN)
            d.image(harness.TRAIN, 'lane-a__0001', boxes='1 0.5 0.5 0 0.2\n')
            r = validate.validate(d.root, near=False)
            hits = find(r, 'label-format')
            self.assertEqual(len(hits), 1)
            self.assertIn('lane-a__0001.txt', hits[0].message)


class ConfigTest(unittest.TestCase):
    def test_swapping_the_class_order_is_an_error(self):
        swapped = harness.DEFAULT_YAML.replace(
            '  0: manhole\n  1: pothole\n', '  0: pothole\n  1: manhole\n')
        with harness.Dataset(yaml=swapped) as d:
            d.session('lane-a', harness.TRAIN)
            d.image(harness.TRAIN, 'lane-a__0001')
            r = validate.validate(d.root, near=False)
            hits = find(r, 'class-names')
            self.assertEqual(len(hits), 2)
            self.assertTrue(any("decoder" in h.message for h in hits))

    def test_adding_a_third_class_is_an_error(self):
        extra = harness.DEFAULT_YAML + '  2: crack\n'
        with harness.Dataset(yaml=extra) as d:
            d.session('lane-a', harness.TRAIN)
            d.image(harness.TRAIN, 'lane-a__0001')
            r = validate.validate(d.root, near=False)
            self.assertTrue(any('extra class ids' in f.message
                                for f in find(r, 'class-names')))

    def test_a_drifted_sessions_header_is_caught(self):
        with harness.Dataset() as d:
            d.raw_sessions('session_id,split\nlane-a,train\n')
            d.image(harness.TRAIN, 'lane-a__0001')
            r = validate.validate(d.root, near=False)
            self.assertTrue(any('header is' in f.message
                                for f in find(r, 'sessions-csv')))

    def test_a_split_that_is_not_a_split(self):
        with harness.Dataset() as d:
            d.raw_sessions(harness.SESSION_HEADER +
                           'lane-a,training,no,r,p,2026-01-01,phone,own,\n')
            d.image(harness.TRAIN, 'lane-a__0001')
            r = validate.validate(d.root, near=False)
            self.assertTrue(any("'training'" in f.message
                                for f in find(r, 'sessions-csv')))


class ProvenanceTest(unittest.TestCase):
    def test_a_session_citing_a_source_that_does_not_exist(self):
        with harness.Dataset() as d:
            d.session('lane-a', harness.TRAIN, source='mystery')
            d.image(harness.TRAIN, 'lane-a__0001')
            r = validate.validate(d.root, near=False)
            hits = find(r, 'provenance')
            self.assertEqual(len(hits), 1)
            self.assertIn('mystery', hits[0].message)

    def test_a_source_not_cleared_for_commercial_use_warns(self):
        with harness.Dataset() as d:
            d.session('lane-a', harness.TRAIN, source='web')
            d.image(harness.TRAIN, 'lane-a__0001')
            r = validate.validate(d.root, near=False)
            hits = find(r, 'licence')
            self.assertEqual(len(hits), 1)
            self.assertEqual(hits[0].level, validate.WARN)
            self.assertIn('commercial build will refuse it', hits[0].message)


class ShapeTest(unittest.TestCase):
    def test_an_empty_training_set_is_an_error(self):
        with harness.Dataset() as d:
            d.session('lane-a', harness.TEST)
            d.image(harness.TEST, 'lane-a__0001')
            r = validate.validate(d.root, near=False)
            self.assertTrue(any('training set has no images' in f.message
                                for f in find(r, 'empty-split')))

    def test_a_set_with_no_hard_negatives_warns(self):
        with harness.Dataset() as d:
            d.session('lane-a', harness.TRAIN)
            d.image(harness.TRAIN, 'lane-a__0001')
            r = validate.validate(d.root, near=False)
            self.assertEqual(len(find(r, 'no-hard-negatives')), 1)

    def test_hard_negatives_silence_that_warning(self):
        with harness.Dataset() as d:
            d.session('lane-a', harness.TRAIN)
            d.image(harness.TRAIN, 'lane-a__0001')
            d.image(harness.TRAIN, 'lane-a__0002', boxes=None)
            r = validate.validate(d.root, near=False)
            self.assertEqual(find(r, 'no-hard-negatives'), [])

    def test_ten_to_one_between_classes_warns(self):
        with harness.Dataset() as d:
            d.session('lane-a', harness.TRAIN)
            many = ''.join('1 %.3f 0.5 0.05 0.05\n' % (0.05 + i * 0.05)
                           for i in range(15))
            d.image(harness.TRAIN, 'lane-a__0001', boxes=many)
            d.image(harness.TRAIN, 'lane-a__0002', boxes='0 0.5 0.5 0.1 0.1\n')
            r = validate.validate(d.root, near=False)
            hits = find(r, 'class-imbalance')
            self.assertEqual(len(hits), 1)
            self.assertIn('pothole=15', hits[0].message)

    def test_the_counts_in_the_stats_are_right(self):
        with harness.Dataset() as d:
            d.session('lane-a', harness.TRAIN)
            d.session('gold', harness.TEST, protected='yes')
            d.image(harness.TRAIN, 'lane-a__0001',
                    boxes='1 0.5 0.5 0.1 0.1\n1 0.2 0.2 0.1 0.1\n')
            d.image(harness.TRAIN, 'lane-a__0002', boxes='0 0.5 0.5 0.1 0.1\n')
            d.image(harness.TRAIN, 'lane-a__0003', boxes=None)
            d.image(harness.TEST, 'gold__0001', boxes='1 0.5 0.5 0.1 0.1\n')
            r = validate.validate(d.root, near=False)
            self.assertEqual(r.stats['counts'],
                             {'train': 3, 'val': 0, 'test': 1})
            self.assertEqual(r.stats['boxes'], {0: 1, 1: 3})
            self.assertEqual(r.stats['negatives'], 1)

    def test_sessions_on_hold_are_noted_not_failed(self):
        with harness.Dataset() as d:
            d.session('lane-a', harness.TRAIN)
            d.session('later', 'hold')
            d.image(harness.TRAIN, 'lane-a__0001')
            r = validate.validate(d.root, near=False)
            hits = find(r, 'hold')
            self.assertEqual(len(hits), 1)
            self.assertEqual(hits[0].level, validate.INFO)


class CleanTest(unittest.TestCase):
    def test_a_correct_dataset_produces_no_errors_at_all(self):
        with harness.Dataset() as d:
            d.session('lane-a', harness.TRAIN)
            d.session('lane-b', harness.VAL)
            d.session('gold', harness.TEST, protected='yes')
            d.image(harness.TRAIN, 'lane-a__0001')
            d.image(harness.TRAIN, 'lane-a__0002', boxes='0 0.4 0.4 0.1 0.1\n')
            d.image(harness.TRAIN, 'lane-a__0003', boxes=None)
            d.image(harness.VAL, 'lane-b__0001')
            d.image(harness.TEST, 'gold__0001')
            r = validate.validate(d.root, near=False)
            self.assertEqual([str(f) for f in r.errors], [])
            self.assertTrue(r.ok)


if __name__ == '__main__':
    unittest.main()
