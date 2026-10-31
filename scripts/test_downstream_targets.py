"""Selection guards for backend audits; default full gate remains JS+Wasm GC."""
import argparse
import importlib.util
from pathlib import Path
import unittest
import tempfile
import json
import sys
from unittest import mock

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


    def test_source_links_rejected_before_manifest_package_or_copy(self):
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            source = base / 'source'
            source.mkdir()
            outside = base / 'outside.txt'
            outside.write_text('synthetic-only')
            (source / '_build').mkdir()
            (source / '_build' / 'ignored').symlink_to(outside)
            module.validate_source_tree(source)
            for name, target in [('file', outside), ('directory', base), ('missing', base / 'absent')]:
                link = source / name
                link.symlink_to(target)
                with self.subTest(name=name), self.assertRaisesRegex(RuntimeError, 'source symlink'):
                    module.validate_source_tree(source)
                link.unlink()
            (source / 'moon.mod').symlink_to(outside)
            with mock.patch.object(module, 'ROOT', source), \
                 mock.patch.object(sys, 'argv', ['downstream', '--output', str(base / 'out')]), \
                 mock.patch.object(module.shutil, 'which', return_value='/fake/moon'), \
                 mock.patch.object(module, 'manifest_identity', side_effect=AssertionError('manifest read before guard')) as manifest, \
                 mock.patch.object(module.subprocess, 'run') as run, \
                 mock.patch.object(module.shutil, 'copyfile') as copy:
                self.assertEqual(module.main(), 1)
                manifest.assert_not_called()
                run.assert_not_called()
                copy.assert_not_called()
            self.assertEqual(outside.read_text(), 'synthetic-only')
            report = json.loads((base / 'out' / 'downstream.json').read_text())
            self.assertEqual(report['status'], 'FAILED')
            self.assertEqual(report['stages'], [])


if __name__ == '__main__':
    unittest.main()
