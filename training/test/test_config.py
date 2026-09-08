"""dataset.yaml, and the class order the shipped decoder depends on."""
import unittest

import harness
from dlkit import config


class YamlTest(unittest.TestCase):
    def read(self, text):
        with harness.Dataset() as d:
            d.write('dataset.yaml', text)
            return config.read_yaml(d.path('dataset.yaml'))

    def test_the_shipped_shape_reads(self):
        cfg, errs = self.read(harness.DEFAULT_YAML)
        self.assertEqual(errs, [])
        self.assertEqual(cfg['train'], 'images/train')
        self.assertEqual(cfg['names'], {0: 'manhole', 1: 'pothole'})

    def test_comments_and_blank_lines_are_ignored(self):
        cfg, errs = self.read('# a note\n\npath: .\n\nnames:\n  0: manhole\n'
                              '  1: pothole  # the one that matters\n')
        self.assertEqual(errs, [])
        self.assertEqual(cfg['names'][1], 'pothole')

    def test_an_inline_names_list_is_refused(self):
        _c, errs = self.read('path: .\nnames: [manhole, pothole]\n')
        self.assertIn('block of', errs[0])

    def test_a_non_integer_class_key(self):
        _c, errs = self.read('names:\n  first: manhole\n')
        self.assertIn('not an integer', errs[0])

    def test_a_missing_file_is_reported(self):
        cfg, errs = config.read_yaml('/nowhere/dataset.yaml')
        self.assertIsNone(cfg)
        self.assertIn('does not exist', errs[0])


class ClassOrderTest(unittest.TestCase):
    def test_the_order_the_app_needs_passes(self):
        self.assertEqual(config.check_names({0: 'manhole', 1: 'pothole'}), [])

    def test_swapping_them_is_caught(self):
        errs = config.check_names({0: 'pothole', 1: 'manhole'})
        self.assertEqual(len(errs), 2)
        self.assertIn('decoder', errs[0])

    def test_a_missing_class_is_caught(self):
        errs = config.check_names({0: 'manhole'})
        self.assertIn("found None", errs[0])

    def test_an_extra_class_is_caught(self):
        errs = config.check_names({0: 'manhole', 1: 'pothole', 2: 'crack'})
        self.assertIn('extra class ids [2]', errs[0])

    def test_a_renamed_class_is_caught(self):
        errs = config.check_names({0: 'manhole', 1: 'hole'})
        self.assertIn("'hole'", errs[0])


class RootTest(unittest.TestCase):
    def test_an_explicit_root_wins(self):
        self.assertTrue(config.root('/tmp/x').endswith('/tmp/x'))

    def test_the_environment_is_consulted(self):
        import os
        old = os.environ.get('DEFECTLOG_DATASET')
        os.environ['DEFECTLOG_DATASET'] = '/tmp/from-env'
        try:
            self.assertEqual(config.root(), '/tmp/from-env')
        finally:
            if old is None:
                del os.environ['DEFECTLOG_DATASET']
            else:
                os.environ['DEFECTLOG_DATASET'] = old

    def test_the_default_is_the_dataset_beside_the_tools(self):
        import os
        old = os.environ.pop('DEFECTLOG_DATASET', None)
        try:
            self.assertTrue(config.root().endswith('/training/dataset'))
        finally:
            if old is not None:
                os.environ['DEFECTLOG_DATASET'] = old


if __name__ == '__main__':
    unittest.main()
