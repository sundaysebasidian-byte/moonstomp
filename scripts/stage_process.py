"""Run one verification command; timeouts retire only its owned process group."""
import os
import signal
import subprocess


CLEANUP_SECONDS = 5


def _kill_owned(child):
    try:
        if os.name == 'posix':
            # start_new_session below makes this child's PID its process-group
            # ID. Never discover/kill processes by name or use the caller group.
            os.killpg(child.pid, signal.SIGKILL)
        else:
            child.kill()
    except ProcessLookupError:
        pass


def _close_pipes(child):
    for stream in (child.stdout, child.stderr):
        if stream is not None:
            stream.close()


def run_command(command, *, cwd, env, timeout):
    child = subprocess.Popen(command, cwd=cwd, env=env, stdout=subprocess.PIPE,
                             stderr=subprocess.PIPE, start_new_session=os.name == 'posix')
    try:
        stdout, stderr = child.communicate(timeout=timeout)
    except subprocess.TimeoutExpired as expired:
        # A descendant can still own the pipes even after the group leader has
        # exited. Kill the owned group, not merely a still-running leader.
        cleanup_complete = False
        cleanup_error = None
        stdout, stderr = expired.output or b'', expired.stderr or b''
        try:
            _kill_owned(child)
            stdout, stderr = child.communicate(timeout=CLEANUP_SECONDS)
            cleanup_complete = True
        except subprocess.TimeoutExpired as incomplete:
            stdout, stderr = incomplete.output or stdout, incomplete.stderr or stderr
            cleanup_error = 'cleanup deadline exceeded'
        except OSError as error:
            cleanup_error = str(error)
        finally:
            _close_pipes(child)
            # Pipe EOF can be withheld by a descendant that deliberately left
            # our group. Reap the direct child without extending the deadline.
            child.poll()
        failure = subprocess.TimeoutExpired(command, timeout, output=stdout, stderr=stderr)
        failure.cleanup_scope = 'owned-posix-process-group' if os.name == 'posix' else 'direct-child-only'
        failure.cleanup_complete = cleanup_complete
        failure.cleanup_error = cleanup_error
        raise failure from expired
    except BaseException:
        # Retire our command on Python exceptions, including KeyboardInterrupt.
        # External SIGTERM/SIGKILL of the verifier do not enter this handler.
        try:
            _kill_owned(child)
            child.wait(timeout=CLEANUP_SECONDS)
        finally:
            _close_pipes(child)
        raise
    return subprocess.CompletedProcess(command, child.returncode, stdout, stderr)
