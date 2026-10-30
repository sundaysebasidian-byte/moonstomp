"""Offline bootstrap guard tests: synthetic text archives, no SDK install/network."""
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import sys
import tarfile
import tempfile
import unittest
from unittest import mock

spec = importlib.util.spec_from_file_location('ci_sdk', Path(__file__).with_name('install-ci-sdk.py'))
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)


def archive(name, tools=False):
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode='w:gz') as bundle:
        item = tarfile.TarInfo(name)
        item.size = 7
        bundle.addfile(item, io.BytesIO(b'fixture'))
        if tools:
            for tool in installer.TOOLS:
                executable = tarfile.TarInfo('bin/' + tool)
                executable.size = 7
                executable.mode = 0o664
                bundle.addfile(executable, io.BytesIO(b'fixture'))
    return buf.getvalue()


class BootstrapGuards(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='moonstomp-bootstrap-unit-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.dest = self.root / 'fake-destination'
        self.payloads = {'sdk': archive('fixture.txt', tools=True), 'core': archive('core/fixture.txt')}
        self.lock = {}
        for part, payload in self.payloads.items():
            self.lock[part+'_url'] = 'https://cli.moonbitlang.com/' + part
            self.lock[part+'_sha256'] = hashlib.sha256(payload).hexdigest()

    def invoke(self):
        (self.root/'toolchain.lock.json').write_text(json.dumps(self.lock))
        def response(url, **_):
            data = io.BytesIO(self.payloads[url.rsplit('/', 1)[-1]])
            data.url = url
            return data
        with mock.patch.object(installer, 'ROOT', self.root), \
             mock.patch.object(sys, 'argv', ['bootstrap', '--dest', str(self.dest)]), \
             mock.patch.object(installer.platform, 'system', return_value='Linux'), \
             mock.patch.object(installer.platform, 'machine', return_value='x86_64'), \
             mock.patch.object(installer.urllib.request, 'urlopen', side_effect=response) as fetch, \
             mock.patch.object(installer.subprocess, 'run') as bundle:
            self.fetch = fetch
            self.bundle = bundle
            installer.main()

    def test_checksum_mismatch_has_no_destination(self):
        self.lock['sdk_sha256'] = '0'*64
        with self.assertRaisesRegex(RuntimeError, 'checksum mismatch'):
            self.invoke()
        self.assertFalse(self.dest.exists())
        self.bundle.assert_not_called()

    def test_existing_destination_preserved(self):
        self.dest.mkdir()
        (self.dest/'keep').write_text('preserve')
        with self.assertRaises(SystemExit):
            self.invoke()
        self.fetch.assert_not_called()
        self.assertEqual((self.dest/'keep').read_text(), 'preserve')

    def test_non_https_url_rejected(self):
        self.lock['sdk_url'] = 'http://cli.moonbitlang.com/sdk'
        with self.assertRaisesRegex(RuntimeError, 'official HTTPS'):
            self.invoke()
        self.fetch.assert_not_called()
        self.assertFalse(self.dest.exists())

    def test_path_traversal_rejected(self):
        self.payloads['sdk'] = archive('../escape.txt')
        self.lock['sdk_sha256'] = hashlib.sha256(self.payloads['sdk']).hexdigest()
        with self.assertRaises(tarfile.FilterError):
            self.invoke()
        self.assertFalse((self.root/'escape.txt').exists())
        self.bundle.assert_not_called()

    def test_synthetic_positive_and_bundle_environment(self):
        self.invoke()
        self.assertEqual((self.dest/'fixture.txt').read_bytes(), b'fixture')
        self.assertEqual((self.dest/'lib/core/fixture.txt').read_bytes(), b'fixture')
        for tool in installer.TOOLS:
            self.assertEqual((self.dest/'bin'/tool).stat().st_mode & 0o111, 0o111)
        self.bundle.assert_called_once()
        args, kw = self.bundle.call_args
        self.assertEqual(args[0], [str(self.dest/'bin/moon'), 'bundle', '--all'])
        self.assertEqual(kw['env']['MOON_HOME'], str(self.dest))
        self.assertEqual(kw['cwd'], self.dest/'lib/core')


if __name__ == '__main__':
    unittest.main()
