#!/usr/bin/env python3
"""Bound only this command's process group; retain partial logs on failure."""
import argparse
import json
import os
from pathlib import Path
import signal
import subprocess
import time


def process_rss(root):
    result = subprocess.run(['ps', '-axo', 'pid=,ppid=,rss='],
                            capture_output=True, text=True, check=True)
    rows = [tuple(map(int, row.split())) for row in result.stdout.splitlines()]
    selected = {root}
    while True:
        more = {pid for pid, parent, _ in rows if parent in selected}
        if more <= selected:
            break
        selected |= more
    return sum(rss for pid, _, rss in rows if pid in selected) * 1024


def execute(command, cwd, output, name, env=None, seconds=120, rss_mib=512):
    output = Path(output)
    # Fail before launching if the environment cannot monitor resources.
    process_rss(os.getpid())
    started = time.monotonic()
    peak = 0
    reason = None
    with (output / (name + '.stdout.txt')).open('wb') as stdout, \
            (output / (name + '.stderr.txt')).open('wb') as stderr:
        child = subprocess.Popen(command, cwd=cwd, env=env, stdout=stdout,
                                 stderr=stderr, start_new_session=True)
        try:
            while child.poll() is None:
                peak = max(peak, process_rss(child.pid))
                if peak > rss_mib * 1024 * 1024:
                    reason = 'RSS limit exceeded'
                    break
                if time.monotonic() - started > seconds:
                    reason = 'wall timeout'
                    break
                time.sleep(.2)
        except Exception as error:
            reason = 'resource monitor failed: ' + type(error).__name__
        finally:
            if reason:
                # This new process group belongs only to the command we started.
                try:
                    os.killpg(child.pid, signal.SIGTERM)
                    child.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    os.killpg(child.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
            code = child.wait()
    return {'name': name, 'command': command, 'pid': child.pid, 'exit_code': code,
            'status': 'passed' if code == 0 and not reason else 'partial/failed',
            'stop_reason': reason, 'elapsed_seconds': round(time.monotonic()-started, 3),
            'sampled_process_tree_rss_peak_bytes': peak,
            'rss_limit_bytes': rss_mib * 1024 * 1024,
            'note': 'RSS is sampled sum of this command process tree; not parser nodes or exact OS peak'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--seconds', type=float, default=120)
    parser.add_argument('--rss-mib', type=int, default=512)
    parser.add_argument('command', nargs=argparse.REMAINDER)
    args = parser.parse_args()
    if args.seconds <= 0 or args.rss_mib <= 0:
        parser.error('Limits must be positive')
    if args.output.exists():
        parser.error('Use a new output directory; evidence is never overwritten')
    command = args.command[1:] if args.command[:1] == ['--'] else args.command
    if not command:
        parser.error('A command is required')
    args.output.mkdir(parents=True)
    record = execute(command, Path.cwd(), args.output, 'workloads',
                     seconds=args.seconds, rss_mib=args.rss_mib)
    (args.output / 'summary.json').write_text(json.dumps(record, indent=2))
    print(json.dumps(record), flush=True)
    return 0 if record['status'] == 'passed' else 1


if __name__ == '__main__':
    raise SystemExit(main())
