"""Scoring, and the baseline-versus-candidate comparison.

These numbers are the whole reason for the gold test set, so they are tested
against hand-worked cases rather than against whatever the code happens to
produce.
"""
import unittest

import harness                                   # noqa: F401
from dlkit import metrics


def box(cx, cy, w=0.2, h=0.2, cls=1, conf=None):
    b = {'cls': cls, 'cx': cx, 'cy': cy, 'w': w, 'h': h}
    if conf is not None:
        b['conf'] = conf
    return b


class ScoreTest(unittest.TestCase):
    def setUp(self):
        # three images: two hold a pothole, one is a hard negative
        self.truth = {
            'a__0001': [box(0.3, 0.3)],
            'a__0002': [box(0.7, 0.7)],
            'a__0003': [],
        }

    def test_a_perfect_model(self):
        preds = {'a__0001': [box(0.3, 0.3, conf=0.9)],
                 'a__0002': [box(0.7, 0.7, conf=0.8)],
                 'a__0003': []}
        s = metrics.score(self.truth, preds, cls=1, conf=0.65)
        self.assertEqual((s['tp'], s['fp'], s['fn']), (2, 0, 0))
        self.assertEqual(s['recall'], 1.0)
        self.assertEqual(s['precision'], 1.0)
        self.assertEqual(s['fp_per_image'], 0.0)

    def test_a_detection_below_the_bar_is_a_miss(self):
        preds = {'a__0001': [box(0.3, 0.3, conf=0.55)],
                 'a__0002': [box(0.7, 0.7, conf=0.80)]}
        s = metrics.score(self.truth, preds, cls=1, conf=0.65)
        self.assertEqual((s['tp'], s['fn']), (1, 1))
        self.assertEqual(s['missed'][0][0], 'a__0001')
        # ... and is found again once the bar comes down
        s2 = metrics.score(self.truth, preds, cls=1, conf=0.50)
        self.assertEqual((s2['tp'], s2['fn']), (2, 0))

    def test_a_box_in_the_wrong_place_is_a_false_positive_and_a_miss(self):
        preds = {'a__0001': [box(0.9, 0.9, conf=0.9)]}
        s = metrics.score(self.truth, preds, cls=1, conf=0.65)
        self.assertEqual((s['tp'], s['fp'], s['fn']), (0, 1, 2))

    def test_a_detection_on_a_hard_negative_counts_against_the_model(self):
        preds = {'a__0003': [box(0.5, 0.5, conf=0.9)]}
        s = metrics.score(self.truth, preds, cls=1, conf=0.65)
        self.assertEqual(s['fp'], 1)
        self.assertEqual(s['images_with_fp'], 1)
        self.assertAlmostEqual(s['fp_per_image'], 1.0 / 3)

    def test_two_boxes_cannot_both_claim_one_pothole(self):
        preds = {'a__0001': [box(0.3, 0.3, conf=0.9),
                             box(0.31, 0.31, conf=0.8)]}
        s = metrics.score(self.truth, preds, cls=1, conf=0.65)
        self.assertEqual((s['tp'], s['fp']), (1, 1))

    def test_the_more_confident_box_gets_the_match(self):
        # both overlap enough; greedy by confidence means the 0.9 claims it
        preds = {'a__0001': [box(0.34, 0.30, conf=0.9),
                             box(0.30, 0.30, conf=0.7)]}
        s = metrics.score(self.truth, preds, cls=1, conf=0.65)
        self.assertEqual((s['tp'], s['fp']), (1, 1))

    def test_a_manhole_prediction_does_not_satisfy_a_pothole(self):
        preds = {'a__0001': [box(0.3, 0.3, cls=0, conf=0.9)]}
        s = metrics.score(self.truth, preds, cls=1, conf=0.65)
        self.assertEqual((s['tp'], s['fp'], s['fn']), (0, 0, 2))

    def test_an_image_the_model_said_nothing_about_is_still_scored(self):
        s = metrics.score(self.truth, {}, cls=1, conf=0.65)
        self.assertEqual(s['fn'], 2)
        self.assertEqual(s['images'], 3)

    def test_predicting_on_an_image_outside_the_test_set_is_refused(self):
        with self.assertRaises(ValueError) as e:
            metrics.score(self.truth, {'somewhere__0001': []}, cls=1, conf=0.65)
        self.assertIn('not in the test set', str(e.exception))

    def test_a_loose_box_fails_the_iou_bar(self):
        preds = {'a__0001': [box(0.3, 0.3, w=0.6, h=0.6, conf=0.9)]}
        s = metrics.score(self.truth, preds, cls=1, conf=0.65)
        self.assertEqual((s['tp'], s['fp']), (0, 1))


class DetectionRateTest(unittest.TestCase):
    def test_finding_one_of_two_potholes_still_counts_as_finding_the_image(self):
        truth = {'a__0001': [box(0.3, 0.3), box(0.7, 0.7)],
                 'a__0002': [box(0.5, 0.5)],
                 'a__0003': []}
        preds = {'a__0001': [box(0.3, 0.3, conf=0.9)]}
        s = metrics.score(truth, preds, cls=1, conf=0.65)
        self.assertEqual(s['recall'], 1 / 3)          # one box of three
        d = metrics.detection_rate(truth, preds, cls=1, conf=0.65)
        self.assertEqual(d['images_with_class'], 2)
        self.assertEqual(d['images_detected'], 1)
        self.assertEqual(d['rate'], 0.5)              # one image of two

    def test_no_images_of_the_class_at_all(self):
        self.assertIsNone(metrics.detection_rate({'a__0001': []}, {},
                                                 cls=1, conf=0.65))


class SweepTest(unittest.TestCase):
    def test_recall_never_rises_as_the_bar_rises(self):
        truth = {'a__%04d' % i: [box(0.3, 0.3)] for i in range(1, 6)}
        preds = {'a__%04d' % i: [box(0.3, 0.3, conf=0.4 + i * 0.1)]
                 for i in range(1, 6)}
        rows = metrics.sweep(truth, preds, cls=1)
        recalls = [r['recall'] for r in rows]
        self.assertEqual(recalls, sorted(recalls, reverse=True))
        self.assertIn(0.65, [r['conf'] for r in rows])


class CompareTest(unittest.TestCase):
    def test_it_names_what_was_fixed_and_what_regressed(self):
        truth = {'g__0001': [box(0.3, 0.3)],
                 'g__0002': [box(0.5, 0.5)],
                 'g__0003': [box(0.7, 0.7)]}
        base = {'g__0001': [box(0.3, 0.3, conf=0.9)],
                'g__0002': [box(0.5, 0.5, conf=0.9)]}          # misses 0003
        cand = {'g__0001': [box(0.3, 0.3, conf=0.9)],
                'g__0003': [box(0.7, 0.7, conf=0.9)]}          # misses 0002
        c = metrics.compare(truth, base, cand, cls=1)
        self.assertEqual(c['fixed'], ['g__0003'])
        self.assertEqual(c['regressed'], ['g__0002'])
        self.assertEqual(c['still_missed'], [])
        self.assertEqual(c['delta']['recall'], 0.0)

    def test_a_candidate_that_buys_recall_with_false_positives_shows_both(self):
        truth = {'g__0001': [box(0.3, 0.3)], 'g__0002': []}
        base = {}
        cand = {'g__0001': [box(0.3, 0.3, conf=0.9)],
                'g__0002': [box(0.5, 0.5, conf=0.9)]}
        c = metrics.compare(truth, base, cand, cls=1)
        self.assertEqual(c['delta']['recall'], 1.0)
        self.assertEqual(c['delta']['fp_per_image'], 0.5)


if __name__ == '__main__':
    unittest.main()
