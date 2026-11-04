#!/usr/bin/env python3
"""Verification-stage evidence must survive failure, timeout and launch errors."""
import json
import errno
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

import verify


class VerificationEvidence(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.out = Path(self.temp.name)
        self.report = {'stages': []}
        self.command = ['evidence-fixture']

    def run_stage(self, timeout=1):
        return verify.run_stage(self.report, self.out, 'fixture', self.command,
                                dict(os.environ), timeout)

    def assert_evidence(self, stdout, stderr, *, code, timed_out=False):
        self.assertEqual(len(self.report['stages']), 1)
        stage = self.report['stages'][0]
        self.assertEqual((self.out / stage['stdout']).read_bytes(), stdout)
        self.assertEqual((self.out / stage['stderr']).read_bytes(), stderr)
        self.assertEqual(stage['command'], self.command)
        self.assertEqual(stage['exit_code'], code)
        self.assertEqual(stage['timed_out'], timed_out)
        self.assertGreaterEqual(stage['seconds'], 0)
        self.assertGreater(stage['timeout_seconds'], 0)
        json.dumps(self.report)  # All recorded metadata must remain serializable.
        return stage

    def test_success_keeps_raw_logs_and_returns_trimmed_summary(self):
        result = subprocess.CompletedProcess(self.command, 0, b' result\n', b'warning\n')
        with patch.object(verify, 'run_command', return_value=result):
            self.assertEqual(self.run_stage(), 'result')
        self.assertEqual(self.assert_evidence(b' result\n', b'warning\n', code=0)['status'], 'PASSED')

    def test_binary_output_remains_byte_exact(self):
        result = subprocess.CompletedProcess(self.command, 0, b'non-UTF8: \xff\n', b'\x00\xfe')
        with patch.object(verify, 'run_command', return_value=result):
            self.assertEqual(self.run_stage(), 'non-UTF8: \ufffd')
        self.assert_evidence(result.stdout, result.stderr, code=0)

    def test_nonzero_exit_is_failure_with_logs(self):
        result = subprocess.CompletedProcess(self.command, 7, b'partial\n', b'failed\n')
        with patch.object(verify, 'run_command', return_value=result):
            with self.assertRaisesRegex(RuntimeError, 'exit 7'):
                self.run_stage()
        self.assertEqual(self.assert_evidence(result.stdout, result.stderr, code=7)['status'], 'FAILED')

    def test_timeout_preserves_partial_binary_logs_without_fabricating_exit_code(self):
        failure = subprocess.TimeoutExpired(self.command, 1, output=b'partial\xff\n', stderr=b'error\xfe\n')
        with patch.object(verify, 'run_command', side_effect=failure):
            with self.assertRaisesRegex(RuntimeError, 'fixture timed out after 1 seconds'):
                self.run_stage()
        self.assertEqual(self.assert_evidence(failure.output, failure.stderr, code=None, timed_out=True)['status'], 'FAILED')

    def test_timeout_before_output_still_creates_empty_logs(self):
        with patch.object(verify, 'run_command', side_effect=subprocess.TimeoutExpired(self.command, 1)):
            with self.assertRaises(RuntimeError):
                self.run_stage()
        self.assert_evidence(b'', b'', code=None, timed_out=True)

    def test_incomplete_timeout_cleanup_remains_explicitly_failed(self):
        failure = subprocess.TimeoutExpired(self.command, 1, output=b'partial')
        failure.cleanup_scope = 'owned-posix-process-group'
        failure.cleanup_complete = False
        failure.cleanup_error = 'cleanup deadline exceeded'
        with patch.object(verify, 'run_command', side_effect=failure):
            with self.assertRaises(RuntimeError):
                self.run_stage()
        stage = self.assert_evidence(b'partial', b'', code=None, timed_out=True)
        self.assertEqual(stage['status'], 'FAILED')
        self.assertEqual(stage['timeout_cleanup'], {
            'scope': 'owned-posix-process-group', 'complete': False,
            'error': 'cleanup deadline exceeded'})

    def test_missing_executable_records_launch_failure(self):
        failure = FileNotFoundError(2, 'No such file or directory', self.command[0])
        with patch.object(verify, 'run_command', side_effect=failure):
            with self.assertRaises(FileNotFoundError):
                self.run_stage()
        stage = self.assert_evidence(b'', b'', code=None)
        self.assertEqual(stage['status'], 'FAILED')
        self.assertEqual(stage['launch_error']['type'], 'FileNotFoundError')
        self.assertEqual(stage['launch_error']['errno'], 2)

    def test_real_timeout_keeps_flushed_output(self):
        self.command = [sys.executable, '-u', '-c',
                        'import sys,time; print("before timeout"); '
                        'print("stderr before timeout",file=sys.stderr); time.sleep(30)']
        with self.assertRaisesRegex(RuntimeError, 'timed out'):
            # Allow interpreter startup on a busy CI worker before timing out
            # the deliberate 30-second sleep; fast cases above use injection.
            self.run_stage(timeout=5)
        self.assert_evidence(b'before timeout\n', b'stderr before timeout\n', code=None, timed_out=True)

    def test_either_log_write_failure_cannot_leave_a_passed_stage(self):
        for suffix in ['.stdout.txt', '.stderr.txt']:
            with self.subTest(log=suffix):
                self.report = {'stages': []}
                result = subprocess.CompletedProcess(self.command, 0, b'passed\n', b'')
                real_write = Path.write_bytes
                def write(path, content):
                    if path.name.endswith(suffix):
                        raise OSError(errno.ENOSPC, 'No space left on device')
                    return real_write(path, content)
                with patch.object(verify, 'run_command', return_value=result), \
                        patch.object(Path, 'write_bytes', write):
                    with self.assertRaises(OSError):
                        self.run_stage()
                stage = self.report['stages'][0]
                self.assertEqual(stage['status'], 'FAILED')
                self.assertEqual(stage['exit_code'], 0)
                self.assertEqual(stage['evidence_error']['errno'], errno.ENOSPC)
                self.assertGreaterEqual(stage['seconds'], 0)

    def test_main_saves_final_failed_report_with_timeout_evidence(self):
        out = self.out / 'verification'
        failure = subprocess.TimeoutExpired(self.command, 180, output=b'partial\n', stderr=b'diagnostic\n')
        with patch.object(sys, 'argv', ['verify.py', '--output', str(out)]), \
                patch.object(verify.subprocess, 'check_output', return_value='fixture\n'), \
                patch.object(verify, 'run_command', side_effect=failure):
            self.assertEqual(verify.main(), 1)
        report = json.loads((out / 'verification.json').read_text())
        self.assertEqual(report['overall'], 'FAILED')
        stage = report['stages'][0]
        self.assertTrue(stage['timed_out'])
        self.assertIsNone(stage['exit_code'])
        self.assertIn('timed out', report['error'])
        self.assertEqual((out / stage['stdout']).read_bytes(), b'partial\n')
        self.assertEqual((out / stage['stderr']).read_bytes(), b'diagnostic\n')


if __name__ == '__main__':
    unittest.main()
