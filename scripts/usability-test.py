#!/usr/bin/env python3
"""Runs every demo and the CLI against the built-in demo broker (Node only, loopback).

Demos are compared byte-for-byte with examples/demo/expected/*.txt. The CLI is
exercised for success paths, protocol versions, transactions, failures and usage
errors. A mutation self-test proves the golden comparison can fail.
The demo broker is a test peer, not evidence of broker interoperability.
"""
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEMOS = sorted((ROOT / 'examples/demo').glob('0*.cjs'))
failures = []

def check(name, condition, detail=''):
    print(('ok   ' if condition else 'FAIL ') + name + ('' if condition else '  ' + detail), flush=True)
    if not condition:
        failures.append(name)

def node(*args, stdin=None, timeout=60):
    return subprocess.run(['node', *map(str, args)], cwd=ROOT, input=stdin, capture_output=True, timeout=timeout)

def golden_matches(actual, expected):
    return actual == expected

# 1. Demos: exit 0, golden stdout, empty stderr.
for demo in DEMOS:
    result = node(demo)
    expected = (ROOT / 'examples/demo/expected' / (demo.stem + '.txt')).read_bytes()
    check(f'demo {demo.stem}', result.returncode == 0 and golden_matches(result.stdout, expected) and not result.stderr,
          f'exit={result.returncode} stdout={result.stdout[:200]!r} stderr={result.stderr[:200]!r}')
    if demo.stem == DEMOS[0].stem:
        for label, mutated in (('changed byte', expected.replace(b'moonbit', b'moonbyt', 1)), ('dropped trailing newline', expected[:-1]), ('empty', b'')):
            check(f'self-test golden rejects {label}', not golden_matches(mutated, expected))

# 2. CLI against the demo broker on an ephemeral loopback port.
broker = subprocess.Popen(['node', 'tools/demo-broker.cjs', '--port', '0'], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
try:
    port = int(re.search(r':(\d+) ', broker.stdout.readline()).group(1))
    def cli(*args, stdin=None):
        return node('tools/stomp-cli.cjs', *args, '--port', port, stdin=stdin)
    def expect(name, result, code, stdout=None, stderr=None):
        out, err = result.stdout.decode(), result.stderr.decode()
        good = result.returncode == code and (stdout is None or stdout in out) and (stderr is None or stderr in err)
        check(name, good, f'exit={result.returncode} stdout={out[:300]!r} stderr={err[:300]!r}')
    expect('cli send text confirmed by receipt', cli('send', '--destination', '/queue/t1', '--body', 'hello 你好'), 0, 'sent destination=/queue/t1 bytes=12 receipt=confirmed')
    expect('cli subscribe text + client-individual ack', cli('subscribe', '--destination', '/queue/t1', '--ack', 'client-individual'), 0, 'message destination=/queue/t1 body="hello 你好"', 'ack')
    expect('cli send binary hex', cli('send', '--destination', '/queue/t2', '--body-hex', '4100ff'), 0, 'bytes=3')
    result = cli('subscribe', '--destination', '/queue/t2', '--format', 'json')
    record = json.loads(result.stdout.decode().splitlines()[0]) if result.returncode == 0 else {}
    check('cli subscribe json keeps binary exactly', record.get('bodyHex') == '4100ff' and record.get('bodyUtf8') is None, result.stdout.decode()[:200])
    expect('cli send from stdin', cli('send', '--destination', '/queue/t3', '--stdin', stdin=b'from stdin'), 0, 'bytes=10')
    expect('cli subscribe reads stdin message', cli('subscribe', '--destination', '/queue/t3'), 0, 'body="from stdin"')
    expect('cli send --no-receipt', cli('send', '--destination', '/queue/t4', '--body', 'x', '--no-receipt'), 0, 'receipt=not-requested')
    expect('cli subscribe receives the no-receipt send', cli('subscribe', '--destination', '/queue/t4', '--count', '1', '--timeout', '3000'), 0, 'body="x"')
    for version in ('1.0', '1.1', '1.2'):
        dest = f'/queue/v{version}'
        expect(f'cli send under {version}', cli('send', '--destination', dest, '--body', 'v' + version, '--versions', version), 0, 'receipt=confirmed')
        expect(f'cli subscribe+ack under {version}', cli('subscribe', '--destination', dest, '--versions', version, '--ack', 'client'), 0, f'body="v{version}"', 'ack')
    expect('cli NACK on match', (cli('send', '--destination', '/queue/t5', '--body', 'bad-job'), cli('subscribe', '--destination', '/queue/t5', '--ack', 'client-individual', '--nack-if', 'bad'))[1], 0, 'body="bad-job"', 'nack')
    expect('cli demo broker redelivers after NACK', cli('subscribe', '--destination', '/queue/t5', '--ack', 'client-individual'), 0, 'body="bad-job"', 'ack')
    expect('cli tx abort leaves nothing', cli('send', '--destination', '/queue/t6', '--body', 'gone', '--tx', 'abort'), 0, 'tx=abort')
    expect('cli subscribe after abort times out (exit 1)', cli('subscribe', '--destination', '/queue/t6', '--timeout', '300'), 1, None, 'event timeout')
    expect('cli tx commit publishes', cli('send', '--destination', '/queue/t6', '--body', 'kept', '--tx', 'commit'), 0, 'tx=commit')
    expect('cli subscribe after commit', cli('subscribe', '--destination', '/queue/t6'), 0, 'body="kept"')
    expect('cli custom header accepted', cli('send', '--destination', '/queue/t7', '--body', 'h', '--header', 'x-trace=abc'), 0, 'receipt=confirmed')
    result = cli('subscribe', '--destination', '/queue/t7', '--format', 'json')
    headers = json.loads(result.stdout.decode().splitlines()[0])['headers'] if result.returncode == 0 else []
    check('cli custom header reaches the subscriber', ['x-trace', 'abc'] in headers, result.stdout.decode()[:200])
    # Failure and usage paths
    expect('cli connection refused exits 1', node('tools/stomp-cli.cjs', 'send', '--port', 1, '--destination', '/q', '--body', 'a'), 1, None, 'ECONNREFUSED')
    expect('cli no arguments exits 2', node('tools/stomp-cli.cjs'), 2)
    expect('cli missing destination exits 2', cli('send', '--body', 'a'), 2, None, '--destination is required')
    expect('cli missing body exits 2', cli('send', '--destination', '/q'), 2, None, 'send needs')
    expect('cli bad port exits 2', node('tools/stomp-cli.cjs', 'send', '--port', 70000, '--destination', '/q', '--body', 'a'), 2, None, '--port must be')
    expect('cli remote host needs flag (exits 2, nothing sent)', cli('send', '--host', '192.0.2.1', '--destination', '/q', '--body', 'a'), 2, None, '--allow-remote')
    expect('cli --tx with --no-receipt exits 2', cli('send', '--destination', '/q', '--body', 'a', '--tx', 'commit', '--no-receipt'), 2)
    expect('cli odd hex exits 2', cli('send', '--destination', '/q', '--body-hex', 'abc'), 2, None, 'hex digits')
    expect('cli unknown option exits 2', cli('send', '--destination', '/q', '--body', 'a', '--bogus', '1'), 2, None, 'unknown option')
    expect('cli 1.0 + client-individual rejected by the core (exit 1)', cli('subscribe', '--destination', '/queue/t8', '--versions', '1.0', '--ack', 'client-individual', '--timeout', '300'), 1)
finally:
    broker.terminate()
    broker.wait(timeout=10)

print('RESULT', 'FAILED: ' + ', '.join(failures) if failures else 'ALL PASSED')
sys.exit(1 if failures else 0)
