#!/usr/bin/env python3
"""Python 3.9 identity fallback and safe legacy broker extraction controls."""
import importlib.util
import io
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch
import downstream

spec = importlib.util.spec_from_file_location('broker_runner', Path(__file__).with_name('broker-run.py'))
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


class Compatibility(unittest.TestCase):
    def test_actual_manifest_identity_without_tomllib(self):
        with patch.object(downstream, 'tomllib', None):
            self.assertEqual(downstream.manifest_identity((downstream.ROOT / 'moon.mod').read_text()),
                             ('sundaysebasidian-byte/moonstomp', '0.1.2'))

    def test_literal_prefix_and_comments(self):
        with patch.object(downstream, 'tomllib', None):
            self.assertEqual(downstream.manifest_identity('name = "a/b" # comment\nversion="1.2.3"\n[other]\nname="not-root"'), ('a/b', '1.2.3'))
            for text in ['name="a"', 'name="a"\nname="b"\nversion="1"', 'name=7\nversion="1"', 'name=""\nversion="1"', "name='a'\nversion=\"1\""]:
                with self.assertRaises((RuntimeError, ValueError)):
                    downstream.manifest_identity(text)

    def test_safe_archive_extraction(self):
        with tempfile.TemporaryDirectory() as temp:
            data = io.BytesIO()
            with tarfile.open(fileobj=data, mode='w') as archive:
                member = tarfile.TarInfo('broker/test.txt'); member.size = 2
                archive.addfile(member, io.BytesIO(b'ok'))
            data.seek(0)
            with tarfile.open(fileobj=data) as archive:
                runner.extract_archive(archive, Path(temp))
            self.assertEqual((Path(temp) / 'broker/test.txt').read_bytes(), b'ok')

    def test_archive_rejects_traversal_links_and_devices(self):
        for name, kind in [('../outside', tarfile.REGTYPE), ('/absolute', tarfile.REGTYPE), ('link', tarfile.SYMTYPE), ('hardlink', tarfile.LNKTYPE), ('device', tarfile.CHRTYPE)]:
            data = io.BytesIO()
            with tarfile.open(fileobj=data, mode='w') as archive:
                member = tarfile.TarInfo(name); member.type = kind; member.linkname = '../outside'
                archive.addfile(member)
            data.seek(0)
            with tempfile.TemporaryDirectory() as temp, tarfile.open(fileobj=data) as archive:
                with self.assertRaisesRegex(RuntimeError, 'unsafe broker archive member'):
                    runner.extract_archive(archive, Path(temp))
                self.assertEqual(list(Path(temp).iterdir()), [])


if __name__ == '__main__':
    unittest.main()
