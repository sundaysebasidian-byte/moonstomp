"""Real owned subprocess controls; no external programs or unrelated processes."""
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import Mock, patch

import stage_process
from stage_process import run_command


class StageProcess(unittest.TestCase):
    def execute(self, code, timeout=5):
        return run_command([sys.executable, '-u', '-c', code], cwd=Path.cwd(),
                           env=dict(os.environ), timeout=timeout)

    def test_success_preserves_binary_stdout_stderr(self):
        result = self.execute('import os; os.write(1,b"out\\xff"); os.write(2,b"err\\xfe")')
        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stdout, b'out\xff')
        self.assertEqual(result.stderr, b'err\xfe')

    def test_nonzero_exit_keeps_return_code(self):
        result = self.execute('import sys; print("failed"); sys.exit(7)')
        self.assertEqual(result.returncode, 7)
        self.assertEqual(result.stdout, b'failed\n')

    def test_missing_executable_does_not_become_success(self):
        with self.assertRaises(FileNotFoundError):
            run_command(['/nonexistent/moonstomp-owned-test-command'], cwd=Path.cwd(),
                        env=dict(os.environ), timeout=5)

    def test_cleanup_deadline_is_bounded_and_explicit(self):
        child = Mock()
        child.communicate.side_effect = [
            subprocess.TimeoutExpired(['fixture'], 1, output=b'first', stderr=b'first-error'),
            subprocess.TimeoutExpired(['fixture'], 5, output=b'latest', stderr=b'latest-error'),
        ]
        with patch.object(stage_process.subprocess, 'Popen', return_value=child), \
                patch.object(stage_process, '_kill_owned') as kill:
            with self.assertRaises(subprocess.TimeoutExpired) as caught:
                run_command(['fixture'], cwd=Path.cwd(), env={}, timeout=1)
        kill.assert_called_once_with(child)
        self.assertEqual(child.communicate.call_args_list[-1].kwargs['timeout'], 5)
        self.assertFalse(caught.exception.cleanup_complete)
        self.assertEqual(caught.exception.cleanup_error, 'cleanup deadline exceeded')
        self.assertEqual(caught.exception.output, b'latest')
        self.assertEqual(caught.exception.stderr, b'latest-error')
        child.stdout.close.assert_called_once()
        child.stderr.close.assert_called_once()
        child.poll.assert_called_once()

    def test_cleanup_failure_preserves_initial_output_and_failure_state(self):
        child = Mock()
        child.communicate.side_effect = subprocess.TimeoutExpired(['fixture'], 1, output=b'partial')
        with patch.object(stage_process.subprocess, 'Popen', return_value=child), \
                patch.object(stage_process, '_kill_owned', side_effect=PermissionError('test denial')):
            with self.assertRaises(subprocess.TimeoutExpired) as caught:
                run_command(['fixture'], cwd=Path.cwd(), env={}, timeout=1)
        self.assertFalse(caught.exception.cleanup_complete)
        self.assertEqual(caught.exception.cleanup_error, 'test denial')
        self.assertEqual(caught.exception.output, b'partial')
        child.stdout.close.assert_called_once()
        child.stderr.close.assert_called_once()

    def test_interrupted_verifier_retires_only_its_child(self):
        child = Mock()
        child.communicate.side_effect = KeyboardInterrupt
        with patch.object(stage_process.subprocess, 'Popen', return_value=child), \
                patch.object(stage_process, '_kill_owned') as kill:
            with self.assertRaises(KeyboardInterrupt):
                run_command(['fixture'], cwd=Path.cwd(), env={}, timeout=1)
        kill.assert_called_once_with(child)
        child.wait.assert_called_once_with(timeout=5)
        child.stdout.close.assert_called_once()
        child.stderr.close.assert_called_once()

    @unittest.skipUnless(os.name == 'posix', 'POSIX process-group boundary')
    def test_detached_pipe_holder_marks_incomplete_but_reaps_direct_child(self):
        with tempfile.TemporaryDirectory() as temp:
            ready = Path(temp) / 'owned-detached.pid'
            descendant = (
                'import os,time; from pathlib import Path; '
                f'Path({str(ready)!r}).write_text(str(os.getpid())); '
                'print("detached ready",flush=True); time.sleep(30)')
            parent = (
                'import subprocess,sys,time; '
                f'subprocess.Popen([sys.executable,"-u","-c",{descendant!r}],start_new_session=True); '
                'time.sleep(30)')
            launched = []
            real_popen = subprocess.Popen
            def capture(*args, **kwargs):
                child = real_popen(*args, **kwargs)
                launched.append(child)
                return child
            try:
                with patch.object(stage_process.subprocess, 'Popen', side_effect=capture):
                    with self.assertRaises(subprocess.TimeoutExpired) as caught:
                        self.execute(parent)
                error = caught.exception
                self.assertIn(b'detached ready', error.output)
                self.assertFalse(error.cleanup_complete)
                self.assertEqual(error.cleanup_error, 'cleanup deadline exceeded')
                self.assertEqual(launched[0].returncode, -signal.SIGKILL)
                with self.assertRaises(ChildProcessError):
                    os.waitpid(launched[0].pid, os.WNOHANG)
                # The helper must not claim to control an explicitly detached
                # process. The test alone cleans its own separately recorded PID.
                os.kill(int(ready.read_text()), 0)
            finally:
                if ready.exists():
                    try: os.kill(int(ready.read_text()), signal.SIGKILL)
                    except ProcessLookupError: pass

    @unittest.skipUnless(os.name == 'posix', 'POSIX process-group guarantee')
    def test_timeout_retires_descendants_even_after_leader_exit(self):
        for leader_exits in [False, True]:
            with self.subTest(leader_exits=leader_exits), tempfile.TemporaryDirectory() as temp:
                ready = Path(temp) / 'descendant.json'
                descendant = (
                    'import json,os,socket,time,signal; from pathlib import Path; '
                    'signal.signal(signal.SIGTERM,signal.SIG_IGN); '
                    's=socket.socket(); s.bind(("127.0.0.1",0)); s.listen(); '
                    f'Path({str(ready)!r}).write_text(json.dumps({{"pid":os.getpid(),"port":s.getsockname()[1]}})); '
                    'print("descendant ready",flush=True); time.sleep(30)')
                parent = (
                    'import subprocess,sys,time; '
                    f'subprocess.Popen([sys.executable,"-u","-c",{descendant!r}]); '
                    'print("leader ready",flush=True); '
                    + ('sys.exit(0)' if leader_exits else 'time.sleep(30)'))
                # A separately owned live process is a negative control. It must
                # survive the timed-out command group's cleanup.
                sentinel = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(30)'],
                                            start_new_session=True)
                descendant_stopped = False
                try:
                    started = time.monotonic()
                    with self.assertRaises(subprocess.TimeoutExpired) as caught:
                        self.execute(parent)
                    self.assertLess(time.monotonic() - started, 12)
                    error = caught.exception
                    self.assertIn(b'leader ready', error.output)
                    self.assertIn(b'descendant ready', error.output)
                    self.assertEqual(error.cleanup_scope, 'owned-posix-process-group')
                    self.assertTrue(error.cleanup_complete)
                    self.assertIsNone(error.cleanup_error)
                    self.assertIsNone(sentinel.poll())
                    identity = json.loads(ready.read_text())
                    # Port ownership is an observable running-process check and
                    # avoids treating an already-dead orphan zombie as active.
                    deadline = time.monotonic() + 2
                    while True:
                        with socket.socket() as probe:
                            if probe.connect_ex(('127.0.0.1', identity['port'])) != 0:
                                descendant_stopped = True
                                break
                        if time.monotonic() >= deadline:
                            self.fail('descendant still accepts connections after timeout')
                        time.sleep(0.01)
                finally:
                    sentinel.kill(); sentinel.wait(timeout=5)
                    # Cleanup an exact process created by this test on assertion
                    # failure too; no process-name search or unrelated kill.
                    if ready.exists() and not descendant_stopped:
                        pid = json.loads(ready.read_text())['pid']
                        try: os.kill(pid, signal.SIGKILL)
                        except ProcessLookupError: pass


if __name__ == '__main__':
    unittest.main()
