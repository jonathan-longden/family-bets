"""Building a training-ready copy: what it refuses, and what it changes."""
import os
import unittest

import harness
from dlkit import build, validate


def clean(d):
    d.session('lane-a', harness.TRAIN)
    d.session('lane-b', harness.VAL)
    d.session('gold', harness.TEST, protected='yes')
    d.image(harness.TRAIN, 'lane-a__0001', boxes='1 0.5 0.5 0.2 0.2\n')
    d.image(harness.TRAIN, 'lane-a__0002', boxes='0 0.4 0.4 0.2 0.2\n')
    d.image(harness.TRAIN, 'lane-a__0003', boxes=None)
    d.image(harness.VAL, 'lane-b__0001')
    d.image(harness.TEST, 'gold__0001')


class RefusalTest(unittest.TestCase):
    def test_it_refuses_to_build_a_leaking_dataset(self):
        with harness.Dataset() as d:
            d.session('lane-a', harness.TRAIN)
            d.image(harness.TRAIN, 'lane-a__0001')
            d.image(harness.TEST, 'lane-a__0002')     # leak
            with self.assertRaises(ValueError) as e:
                build.build(d.root, out=os.path.join(d.root, '..', 'out1'),
                            near=False)
            self.assertIn('refusing to build', str(e.exception))

    def test_it_refuses_to_overwrite_an_existing_output(self):
        with harness.Dataset() as d:
            clean(d)
            out = d.path('out')
            os.makedirs(out)
            with self.assertRaises(IOError):
                build.build(d.root, out=out, near=False)


class ContentTest(unittest.TestCase):
    def test_a_plain_build_carries_everything_across(self):
        with harness.Dataset() as d:
            clean(d)
            out = d.path('out')
            info = build.build(d.root, out=out, near=False)
            self.assertEqual(info['kept'], {'train': 3, 'val': 1, 'test': 1})
            self.assertTrue(os.path.exists(os.path.join(out, 'dataset.yaml')))
            self.assertTrue(os.path.exists(os.path.join(out, 'sessions.csv')))
            self.assertTrue(os.path.exists(
                os.path.join(out, 'images', 'train', 'lane-a__0001.png')))
            with open(os.path.join(out, 'labels', 'train',
                                   'lane-a__0003.txt')) as f:
                self.assertEqual(f.read(), '')      # the negative stays empty

    def test_the_built_copy_validates_on_its_own(self):
        with harness.Dataset() as d:
            clean(d)
            out = d.path('out')
            build.build(d.root, out=out, near=False)
            r = validate.validate(out, near=False)
            self.assertEqual([str(f) for f in r.errors], [])

    def test_pothole_only_moves_pothole_to_class_zero(self):
        with harness.Dataset() as d:
            clean(d)
            out = d.path('out')
            info = build.build(d.root, out=out, pothole_only=True, near=False)
            with open(os.path.join(out, 'labels', 'train',
                                   'lane-a__0001.txt')) as f:
                self.assertTrue(f.read().startswith('0 '))
            self.assertEqual(info['names'], {0: 'pothole'})

    def test_pothole_only_turns_a_manhole_image_into_a_hard_negative(self):
        with harness.Dataset() as d:
            clean(d)
            out = d.path('out')
            info = build.build(d.root, out=out, pothole_only=True, near=False)
            with open(os.path.join(out, 'labels', 'train',
                                   'lane-a__0002.txt')) as f:
                self.assertEqual(f.read(), '')
            self.assertEqual(info['became_negatives'], 1)
            # and the image is still there — it is the negative
            self.assertTrue(os.path.exists(
                os.path.join(out, 'images', 'train', 'lane-a__0002.png')))

    def test_a_commercial_build_drops_sessions_that_are_not_cleared(self):
        with harness.Dataset() as d:
            clean(d)
            d.session('web-a', harness.TRAIN, source='web')
            d.image(harness.TRAIN, 'web-a__0001')
            out = d.path('out')
            info = build.build(d.root, out=out, commercial=True, near=False)
            self.assertEqual(info['blocked_sessions'], ['web-a'])
            self.assertFalse(os.path.exists(
                os.path.join(out, 'images', 'train', 'web-a__0001.png')))
            self.assertTrue(os.path.exists(
                os.path.join(out, 'images', 'train', 'lane-a__0001.png')))

    def test_without_the_commercial_flag_nothing_is_dropped(self):
        with harness.Dataset() as d:
            clean(d)
            d.session('web-a', harness.TRAIN, source='web')
            d.image(harness.TRAIN, 'web-a__0001')
            out = d.path('out')
            info = build.build(d.root, out=out, near=False)
            self.assertEqual(info['blocked_sessions'], [])
            self.assertEqual(info['kept']['train'], 4)


if __name__ == '__main__':
    unittest.main()
