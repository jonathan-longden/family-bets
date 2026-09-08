"""Intake: incoming/ to a split, renamed so the session is in the filename."""
import os
import unittest

import harness
from dlkit import ingest


class PlanTest(unittest.TestCase):
    def setUp(self):
        self.d = harness.Dataset()
        self.d.session('lane-a', harness.TRAIN)
        self.d.session('later', 'hold')

    def tearDown(self):
        self.d.__exit__()

    def incoming(self, name, label='1 0.5 0.5 0.2 0.2\n'):
        harness.png(self.d.path('incoming', name))
        if label is not None:
            self.d.write(os.path.join('incoming',
                                      os.path.splitext(name)[0] + '.txt'),
                         label)

    def test_it_renames_to_the_convention_in_capture_order(self):
        self.incoming('IMG_0009.png')
        self.incoming('IMG_0010.png')
        moves, problems = ingest.plan(self.d.root, 'lane-a')
        self.assertEqual(problems, [])
        got = [os.path.basename(m[1]) for m in moves]
        self.assertEqual(got, ['lane-a__0001.png', 'lane-a__0002.png'])

    def test_it_continues_the_numbering_of_an_existing_session(self):
        self.d.image(harness.TRAIN, 'lane-a__0001')
        self.incoming('IMG_0011.png')
        moves, _p = ingest.plan(self.d.root, 'lane-a')
        self.assertEqual(os.path.basename(moves[0][1]), 'lane-a__0002.png')

    def test_an_unlabelled_image_is_a_problem_not_a_silent_skip(self):
        self.incoming('IMG_0009.png', label=None)
        moves, problems = ingest.plan(self.d.root, 'lane-a')
        self.assertEqual(moves, [])
        self.assertIn('has no label file', problems[0])

    def test_an_unregistered_session_is_refused(self):
        self.incoming('IMG_0009.png')
        moves, problems = ingest.plan(self.d.root, 'nowhere')
        self.assertEqual(moves, [])
        self.assertIn('not in sessions.csv', problems[0])

    def test_a_session_on_hold_sends_you_to_the_register(self):
        self.incoming('IMG_0009.png')
        moves, problems = ingest.plan(self.d.root, 'later')
        self.assertEqual(moves, [])
        self.assertIn('on hold', problems[0])
        self.assertIn('sessions.csv', problems[0])

    def test_split_cannot_rescue_a_session_on_hold(self):
        # the on-hold message must not advise something that then refuses
        self.incoming('IMG_0009.png')
        moves, problems = ingest.plan(self.d.root, 'later', split='train')
        self.assertEqual(moves, [])
        self.assertIn('sessions.csv', problems[0])

    def test_split_is_an_assertion_not_an_override(self):
        self.incoming('IMG_0009.png')
        moves, problems = ingest.plan(self.d.root, 'lane-a', split='test')
        self.assertEqual(moves, [])
        self.assertIn('change sessions.csv if the register is wrong',
                      problems[0])

    def test_asserting_the_right_split_is_allowed(self):
        self.incoming('IMG_0009.png')
        moves, problems = ingest.plan(self.d.root, 'lane-a', split='train')
        self.assertEqual(problems, [])
        self.assertEqual(len(moves), 1)

    def test_applying_a_plan_moves_both_files(self):
        self.incoming('IMG_0009.png')
        moves, _p = ingest.plan(self.d.root, 'lane-a')
        self.assertEqual(ingest.apply(moves), 1)
        self.assertTrue(os.path.exists(
            self.d.path('images', 'train', 'lane-a__0001.png')))
        self.assertTrue(os.path.exists(
            self.d.path('labels', 'train', 'lane-a__0001.txt')))
        self.assertFalse(os.path.exists(self.d.path('incoming', 'IMG_0009.png')))

    def test_it_will_not_overwrite(self):
        self.incoming('IMG_0009.png')
        self.d.image(harness.TRAIN, 'lane-a__0001')
        moves = [(self.d.path('incoming', 'IMG_0009.png'),
                  self.d.path('images', 'train', 'lane-a__0001.png'),
                  self.d.path('incoming', 'IMG_0009.txt'),
                  self.d.path('labels', 'train', 'lane-a__0001.txt'))]
        with self.assertRaises(IOError):
            ingest.apply(moves)


if __name__ == '__main__':
    unittest.main()
