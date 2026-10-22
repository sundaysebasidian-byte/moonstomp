"""Selection guards for backend audits; default full gate remains JS+Wasm GC."""
import argparse
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('downstream', Path(__file__).with_name('downstream.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class Targets(unittest.TestCase):
    def test_explicit_backend_order_preserved(self):
        self.assertEqual(module.parse_targets('js,wasm,native'), ['js', 'wasm', 'native'])

    def test_invalid_or_duplicate_targets_rejected(self):
        for value in ['', 'js,js', 'wasm,', 'llvm', 'js;native', 'js, wasm']:
            with self.subTest(value=value), self.assertRaises(argparse.ArgumentTypeError):
                module.parse_targets(value)

    def test_default_keeps_both_original_gates(self):
        parser = argparse.ArgumentParser()
        parser.add_argument('--targets', type=module.parse_targets, default='js,wasm-gc')
        self.assertEqual(parser.parse_args([]).targets, ['js', 'wasm-gc'])


if __name__ == '__main__':
    unittest.main()
