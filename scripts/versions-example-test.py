#!/usr/bin/env python3
"""Run examples/versions on several backends and compare with its golden output.

The example drives offline 1.0 / 1.1 / 1.2 sessions (server frames are supplied by the
example, not by a broker) and prints six version-boundary rejections. Output must be
byte-identical to examples/versions/expected_output.txt on every backend.
"""
import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EXPECTED = ROOT / 'examples' / 'versions' / 'expected_output.txt'

def check(actual, expected):
    """Return problems; empty means acceptable."""
    problems = []
    if actual != expected:
        a, e = actual.splitlines(), expected.splitlines()
        for i in range(max(len(a), len(e))):
            x = a[i] if i < len(a) else '<missing>'
            y = e[i] if i < len(e) else '<missing>'
            if x != y:
                problems.append(f'line {i + 1}: got {x!r}, expected {y!r}')
                break
        else:
            problems.append('line endings or trailing bytes differ')
    if sum(1 for line in expected.splitlines() if line.startswith('rejected ')) != 6 or \
            sum(1 for line in expected.splitlines() if 'negotiated version' in line) != 3:
        problems.append('golden file lost a negotiated session or a rejection case')
    return problems

def self_test(expected):
    assert check(expected, expected) == []
    for bad in (expected[:-1], expected + 'x', expected.replace('1', '2', 1),
                expected.replace('\n', '\r\n', 1), expected.split('--- explicit')[0]):
        assert check(bad, expected), 'comparison accepted a mutated output'

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--targets', default='js,wasm-gc')
    args = parser.parse_args()
    expected = EXPECTED.read_text()
    self_test(expected)
    moon = shutil.which(os.environ.get('MOON_BIN', 'moon'))
    if not moon:
        print('moon not available; set MOON_BIN/PATH', file=sys.stderr)
        return 2
    failed = False
    for target in args.targets.split(','):
        r = subprocess.run([moon, 'run', 'examples/versions', '--target', target, '-j', '1'],
                           cwd=ROOT, capture_output=True, text=True, timeout=150)
        problems = check(r.stdout, expected) if r.returncode == 0 else [f'exit code {r.returncode}']
        failed |= bool(problems)
        print(f'versions example {target}: {"passed" if not problems else "FAILED " + "; ".join(problems)}')
        if r.returncode:
            print(r.stderr, file=sys.stderr)
    return 1 if failed else 0

if __name__ == '__main__':
    raise SystemExit(main())
