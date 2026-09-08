"""The register itself: filenames, headers and the fields we depend on."""
import unittest

import harness
from dlkit import sessions


class FilenameTest(unittest.TestCase):
    def test_it_reads_the_session_out_of_a_filename(self):
        self.assertEqual(sessions.session_of('lane-a__0001.jpg'), 'lane-a')

    def test_it_works_on_a_full_path(self):
        self.assertEqual(
            sessions.session_of('/x/images/test/gold-a614__0012.png'),
            'gold-a614')

    def test_a_single_underscore_is_not_the_separator(self):
        # otherwise a camera's own IMG_0001 would look like session "IMG"
        self.assertIsNone(sessions.session_of('IMG_0001.jpg'))

    def test_a_bare_name_has_no_session(self):
        self.assertIsNone(sessions.session_of('pothole.jpg'))

    def test_capitals_are_not_a_session(self):
        self.assertIsNone(sessions.session_of('Lane-A__0001.jpg'))

    def test_underscores_inside_the_frame_part_are_allowed(self):
        self.assertEqual(sessions.session_of('lane-a__0001_crop.jpg'), 'lane-a')


class RegisterTest(unittest.TestCase):
    def read(self, text):
        with harness.Dataset() as d:
            d.raw_sessions(text)
            return sessions.read_sessions(d.path('sessions.csv'))

    def test_a_good_register_reads(self):
        got, errs = self.read(harness.SESSION_HEADER +
                              'lane-a,train,no,r,p,2026-01-01,phone,own,\n')
        self.assertEqual(errs, [])
        self.assertEqual(got['lane-a']['split'], 'train')

    def test_a_repeated_session_id(self):
        _g, errs = self.read(harness.SESSION_HEADER +
                             'lane-a,train,no,r,p,2026-01-01,phone,own,\n'
                             'lane-a,test,no,r,p,2026-01-01,phone,own,\n')
        self.assertIn('appears twice', errs[0])

    def test_a_session_id_with_an_underscore_is_refused(self):
        # it would make the filename convention ambiguous
        _g, errs = self.read(harness.SESSION_HEADER +
                             'lane_a,train,no,r,p,2026-01-01,phone,own,\n')
        self.assertIn('lower-case letters', errs[0])

    def test_protected_must_be_yes_or_no(self):
        _g, errs = self.read(harness.SESSION_HEADER +
                             'lane-a,train,maybe,r,p,2026-01-01,phone,own,\n')
        self.assertIn('not yes or no', errs[0])

    def test_a_missing_file_is_reported_not_thrown(self):
        got, errs = sessions.read_sessions('/nowhere/sessions.csv')
        self.assertEqual(got, {})
        self.assertIn('does not exist', errs[0])


class SourceTest(unittest.TestCase):
    def test_the_shipped_seed_sources_read_cleanly(self):
        with harness.Dataset() as d:
            got, errs = sessions.read_sources(d.path('sources.csv'))
            self.assertEqual(errs, [])
            self.assertEqual(got['own']['commercial_use'], 'yes')
            self.assertEqual(got['web']['commercial_use'], 'unknown')

    def test_an_unknown_kind_is_refused(self):
        with harness.Dataset() as d:
            d.write('sources.csv', harness.SOURCE_HEADER +
                    'x,scraped,Name,,lic,yes,2026-01-01,none,\n')
            _g, errs = sessions.read_sources(d.path('sources.csv'))
            self.assertIn("'scraped'", errs[0])

    def test_commercial_use_must_be_one_of_three_answers(self):
        with harness.Dataset() as d:
            d.write('sources.csv', harness.SOURCE_HEADER +
                    'x,own-capture,Name,,lic,probably,2026-01-01,none,\n')
            _g, errs = sessions.read_sources(d.path('sources.csv'))
            self.assertIn("'probably'", errs[0])


if __name__ == '__main__':
    unittest.main()
