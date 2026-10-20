#!/usr/bin/env python3
"""Serial verification; real loopback broker only with explicit archive/Java options."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
EXCLUDED = {'.git', '_build', '.moon', 'target', '__pycache__'}

def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def inventory():
    return {str(p.relative_to(ROOT)): sha256(p) for p in sorted(ROOT.rglob('*'))
            if p.is_file() and not any(part in EXCLUDED for part in p.relative_to(ROOT).parts)}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True, help='New directory outside source tree')
    parser.add_argument('--current-toolchain', action='store_true', help='Explicit compatibility run: record version differences without changing the historical lock')
    parser.add_argument('--go-peer', type=Path, help='Pinned real Go client peer; requires all broker arguments')
    parser.add_argument('--transport', action='store_true', help='Run scripted numeric-loopback TCP tests; no broker')
    parser.add_argument('--broker-archive', type=Path, help='Optional already downloaded official Artemis 2.57.0 tar.gz')
    parser.add_argument('--broker-checksum', type=Path, help='Official SHA512 file for the archive')
    parser.add_argument('--broker-java-home', type=Path, help='Existing Java 17+ home for the optional local broker')
    parser.add_argument('--broker-port', type=int, default=61613, help='Unused loopback port for the optional local broker')
    args = parser.parse_args()
    broker_args = [args.broker_archive, args.broker_checksum, args.broker_java_home]
    if any(broker_args) and not all(broker_args):
        parser.error('provide all three broker arguments or none')
    if args.go_peer and not all(broker_args):
        parser.error('--go-peer requires all three broker arguments')
    out = args.output.resolve()
    if out == ROOT or ROOT in out.parents:
        parser.error('--output must be outside the source tree')
    out.mkdir(parents=True, exist_ok=False)
    lock = json.loads((ROOT / 'toolchain.lock.json').read_text())
    env = dict(os.environ)
    moon = shutil.which(env.get('MOON_BIN', 'moon'))
    if moon:
        env['PATH'] = str(Path(moon).parent) + os.pathsep + env.get('PATH', '')
    env['RUST_LOG'] = 'error'
    started = datetime.now(timezone.utc).isoformat()
    report = {'started_utc': started, 'platform': platform.platform(), 'machine': platform.machine(),
              'python': sys.version, 'moon_bin': moon, 'moon_home': env.get('MOON_HOME'),
              'source_sha256': inventory(), 'stages': [], 'overall': 'FAILED',
              'transport': 'NOT TESTED', 'real_broker': 'NOT RUN IN THIS INVOCATION: optional local broker arguments required',
              'remote_ci': 'NOT TESTED', 'mooncakes_publication': 'NOT DONE'}
    if (ROOT / '.git').exists():
        report['git_head'] = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
        report['git_status'] = subprocess.check_output(['git', 'status', '--short'], cwd=ROOT, text=True)
    def run(name, command):
        begin = time.monotonic()
        stage = {'name': name, 'command': command, 'status': 'FAILED'}
        report['stages'].append(stage)
        print('RUN', name, flush=True)
        result = subprocess.run(command, cwd=ROOT, env=env, capture_output=True, timeout=180)
        (out / (name + '.stdout.txt')).write_bytes(result.stdout)
        (out / (name + '.stderr.txt')).write_bytes(result.stderr)
        stage.update(exit_code=result.returncode, seconds=round(time.monotonic()-begin, 3),
                     stdout=name+'.stdout.txt', stderr=name+'.stderr.txt')
        if result.returncode:
            raise RuntimeError(f'{name} failed (exit {result.returncode})')
        stage['status'] = 'PASSED'
        return result.stdout.decode('utf-8').strip()
    try:
        if not moon:
            raise RuntimeError('moon not available; set MOON_BIN/PATH to the existing trusted SDK')
        moonc = shutil.which('moonc', path=env['PATH'])
        if not moonc:
            raise RuntimeError('moonc not available alongside moon')
        report['tool_sha256'] = {'moon': sha256(Path(moon)), 'moonc': sha256(Path(moonc))}
        compiler = run('compiler-version', [moonc, '-v'])
        report['compiler_version'] = compiler
        report['toolchain_mode'] = 'CURRENT_COMPATIBILITY_NOT_LOCKED' if args.current_toolchain else 'LOCKED'
        report['lock_differences'] = {}
        if compiler != lock['compiler_version']:
            report['lock_differences']['compiler'] = {'locked': lock['compiler_version'], 'actual': compiler}
        if compiler != lock['compiler_version'] and not args.current_toolchain:
            raise RuntimeError('compiler differs from toolchain.lock.json')
        cli = run('moon-version', [moon, 'version'])
        report['moon_version'] = cli
        if not cli.startswith(lock['moon_version']):
            report['lock_differences']['moon'] = {'locked': lock['moon_version'], 'actual': cli}
        if not cli.startswith(lock['moon_version']) and not args.current_toolchain:
            raise RuntimeError('moon differs from toolchain.lock.json')
        report['node_version'] = run('node-version', ['node', '--version'])
        if report['node_version'] != lock['tested_node_version']:
            report['lock_differences']['node'] = {'locked': lock['tested_node_version'], 'actual': report['node_version']}
        if report['node_version'] != lock['tested_node_version'] and not args.current_toolchain:
            raise RuntimeError('Node differs from the verified version in toolchain.lock.json')
        run('runner-negative-controls', [sys.executable, '-E', 'scripts/broker-runner-test.py'])
        run('runner-negative-controls-optimized', [sys.executable, '-E', '-O', 'scripts/broker-runner-test.py'])
        run('check-js', [moon, 'check', '--target', 'js', '-j', '1'])
        run('build-js', [moon, 'build', '--target', 'js', '-j', '1'])
        run('test-js', [moon, 'test', '--target', 'js', '-j', '1'])
        run('test-wasm-gc', [moon, 'test', '--target', 'wasm-gc', '--package', 'sundaysebasidian-byte/moonstomp', '-j', '1'])
        run('offline-example', [moon, 'run', 'examples/offline', '--target', 'js', '-j', '1'])
        run('versions-example', [sys.executable, '-E', 'scripts/versions-example-test.py'])
        run('demos-and-cli', [sys.executable, '-E', 'scripts/usability-test.py'])
        report['demos_and_cli'] = 'PASSED: 6 demos (golden output) + CLI send/subscribe cases against the built-in demo broker; test peer, not broker interoperability evidence'
        run('js-bridge', ['node', 'scripts/bridge-test.cjs'])
        run('differential', ['node', 'scripts/differential.cjs'])
        consumer_command = [sys.executable, 'scripts/downstream.py', '--output', str(out / 'downstream')]
        if args.current_toolchain:
            consumer_command.append('--workspace-dependencies')
        if args.transport:
            consumer_command.append('--transport')
        run('downstream', consumer_command)
        report['downstream'] = 'PASSED: independent module consumes local candidate archive; not Mooncakes'
        if args.transport:
            run('loopback-transport', ['node', 'scripts/transport-test.cjs'])
            run('loopback-transport-quality', ['node', 'scripts/transport-quality-test.cjs'])
            run('loopback-control-timeouts', ['node', 'scripts/transport-timeout-test.cjs'])
            report['transport'] = 'PASSED: 10 lifecycle + 4 control/predicate/host + 6 three-version control-timeout cases, scripted loopback peers, not a broker'
        if all(broker_args):
            broker_command = [sys.executable, 'scripts/broker-run.py',
                '--archive', str(args.broker_archive.resolve()),
                '--sha512', str(args.broker_checksum.resolve()),
                '--java-home', str(args.broker_java_home.resolve()),
                '--output', str(out / 'broker'), '--port', str(args.broker_port)]
            if args.go_peer:
                broker_command += ['--go-peer', str(args.go_peer.resolve())]
            run('real-broker', broker_command)
            report['go_stomp_interop'] = json.loads((out / 'broker/broker-tests.json').read_text())['go_stomp_interop']
            report['real_broker'] = 'PASSED_ARTEMIS_2_57_PROFILE: 3 examples + 5 extended cases + 7 CLI cases; transaction ACK unsupported'
        if inventory() != report['source_sha256']:
            raise RuntimeError('verification unexpectedly changed source files')
        report['overall'] = ('PASSED_WITH_ARTEMIS_PROFILE_LIMITATION_AND_UNTESTED_REMOTE_CI'
            if all(broker_args) else 'PASSED_WITH_BROKER_NOT_RUN_AND_UNTESTED_REMOTE_CI')
    except Exception as error:
        report['error'] = str(error)
    finally:
        report['finished_utc'] = datetime.now(timezone.utc).isoformat()
        (out / 'verification.json').write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n')
    print(report['overall'], flush=True)
    if report['overall'] == 'FAILED':
        print(report.get('error', 'unknown failure'), file=sys.stderr)
        return 1
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
