"""The command line, end to end: exit codes and what it prints.

These run dl.py's own main() rather than a subprocess, so a traceback in a
subcommand fails the test instead of hiding inside a non-zero exit code.
"""
import io
import json
import os
import sys
import unittest
from contextlib import redirect_stdout

import harness

sys.path.insert(0, harness.TOOLS)
import dl                                          # noqa: E402


def run(*argv):
    buf = io.StringIO()
    with redirect_stdout(buf):
        rc = dl.main(list(argv))
    return rc, buf.getvalue()


def clean(d):
    d.session('lane-a', harness.TRAIN)
    d.session('lane-b', harness.VAL)
    d.session('gold', harness.TEST, protected='yes')
    d.image(harness.TRAIN, 'lane-a__0001')
    d.image(harness.TRAIN, 'lane-a__0002', boxes=None)
    d.image(harness.VAL, 'lane-b__0001')
    d.image(harness.TEST, 'gold__0001', boxes='1 0.3 0.3 0.2 0.2\n')
    d.image(harness.TEST, 'gold__0002', boxes=None)


class ValidateTest(unittest.TestCase):
    def test_a_clean_dataset_exits_zero(self):
        with harness.Dataset() as d:
            clean(d)
            rc, out = run('--root', d.root, '--no-near', 'validate')
            self.assertEqual(rc, 0)
            self.assertIn('0 error(s)', out)

    def test_a_leaking_dataset_exits_one(self):
        with harness.Dataset() as d:
            clean(d)
            d.image(harness.TEST, 'lane-a__0009')
            rc, out = run('--root', d.root, '--no-near', 'validate')
            self.assertEqual(rc, 1)
            self.assertIn('leakage', out)


class ReportTest(unittest.TestCase):
    def test_the_report_counts_what_is_there(self):
        with harness.Dataset() as d:
            clean(d)
            rc, out = run('--root', d.root, '--no-near', 'report')
            self.assertEqual(rc, 0)
            self.assertIn('DEFECT LOG DATASET REPORT', out)
            self.assertIn('PROTECTED', out)
            self.assertIn('HARD NEGATIVES', out)
            self.assertIn('total               5', out)

    def test_it_can_write_the_report_to_a_file(self):
        with harness.Dataset() as d:
            clean(d)
            p = d.path('report.txt')
            rc, _o = run('--root', d.root, '--no-near', 'report', '--out', p)
            self.assertEqual(rc, 0)
            with open(p) as f:
                self.assertIn('ANNOTATIONS', f.read())


class EvaluateTest(unittest.TestCase):
    def preds(self, d, name, boxes):
        p = d.path(name)
        with open(p, 'w') as f:
            json.dump({'model': name, 'predictions': boxes}, f)
        return p

    def test_it_scores_against_the_test_split(self):
        with harness.Dataset() as d:
            clean(d)
            p = self.preds(d, 'v1.json', {
                'gold__0001': [{'cls': 1, 'conf': 0.9, 'cx': 0.3, 'cy': 0.3,
                                'w': 0.2, 'h': 0.2}],
                'gold__0002': []})
            rc, out = run('--root', d.root, '--no-near', 'evaluate', p)
            self.assertEqual(rc, 0)
            self.assertIn('POTHOLE', out)
            self.assertIn('production bar', out)

    def test_comparing_two_models_names_the_winner_by_the_rule(self):
        with harness.Dataset() as d:
            clean(d)
            base = self.preds(d, 'v1.json', {'gold__0001': [], 'gold__0002': []})
            cand = self.preds(d, 'v2.json', {
                'gold__0001': [{'cls': 1, 'conf': 0.9, 'cx': 0.3, 'cy': 0.3,
                                'w': 0.2, 'h': 0.2}],
                'gold__0002': []})
            rc, out = run('--root', d.root, '--no-near', 'compare', base, cand)
            self.assertEqual(rc, 0)
            self.assertIn('this one does.', out)
            self.assertIn('+1.000', out)

    def test_a_candidate_that_adds_false_positives_does_not_qualify(self):
        with harness.Dataset() as d:
            clean(d)
            hit = {'cls': 1, 'conf': 0.9, 'cx': 0.3, 'cy': 0.3,
                   'w': 0.2, 'h': 0.2}
            base = self.preds(d, 'v1.json',
                              {'gold__0001': [hit], 'gold__0002': []})
            cand = self.preds(d, 'v2.json',
                              {'gold__0001': [hit], 'gold__0002': [hit]})
            rc, out = run('--root', d.root, '--no-near', 'compare', base, cand)
            self.assertEqual(rc, 0)
            self.assertIn('this one does not.', out)


class BuildTest(unittest.TestCase):
    def test_build_refuses_and_says_why(self):
        with harness.Dataset() as d:
            clean(d)
            d.image(harness.TEST, 'lane-a__0009')       # leak
            rc, out = run('--root', d.root, '--no-near', 'build',
                          '--out', d.path('out'))
            self.assertEqual(rc, 1)
            self.assertIn('FAILED', out)

    def test_build_reports_what_it_made(self):
        with harness.Dataset() as d:
            clean(d)
            rc, out = run('--root', d.root, '--no-near', 'build',
                          '--out', d.path('out'))
            self.assertEqual(rc, 0)
            self.assertIn('built 5 image(s)', out)
            self.assertIn('0=manhole, 1=pothole', out)


class IngestTest(unittest.TestCase):
    def test_a_dry_run_changes_nothing(self):
        with harness.Dataset() as d:
            clean(d)
            harness.png(d.path('incoming', 'IMG_1.png'))
            d.write('incoming/IMG_1.txt', '1 0.5 0.5 0.2 0.2\n')
            rc, out = run('--root', d.root, '--no-near', 'ingest', 'lane-a',
                          '--dry-run')
            self.assertEqual(rc, 0)
            self.assertIn('would move', out)
            self.assertTrue(os.path.exists(d.path('incoming', 'IMG_1.png')))

    def test_it_moves_and_the_result_still_validates(self):
        with harness.Dataset() as d:
            clean(d)
            harness.png(d.path('incoming', 'IMG_1.png'), tint=123)
            d.write('incoming/IMG_1.txt', '1 0.5 0.5 0.2 0.2\n')
            rc, _o = run('--root', d.root, '--no-near', 'ingest', 'lane-a')
            self.assertEqual(rc, 0)
            rc2, out2 = run('--root', d.root, '--no-near', 'validate')
            self.assertEqual(rc2, 0, out2)


if __name__ == '__main__':
    unittest.main()
