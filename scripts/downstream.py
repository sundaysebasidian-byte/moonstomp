#!/usr/bin/env python3
"""Consume a locally packaged candidate from an independent module. Never publishes."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
import re
from pathlib import Path
import shutil
import subprocess
import sys
try:
    import tomllib
except ImportError:
    tomllib = None
import zipfile

ROOT = Path(__file__).resolve().parents[1]

def manifest_identity(text):
    """Only name/version are needed. Legacy Python reads their literal prefix."""
    if tomllib is not None:
        metadata = tomllib.loads(text)
        return metadata['name'], metadata['version']
    found = {}
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith('[') or stripped.startswith('import '):
            break
        match = re.match(r'\s*(name|version)\s*=\s*("(?:[^"\\]|\\.)*")\s*(?:#.*)?$', line)
        if match:
            key, value = match.groups()
            if key in found:
                raise RuntimeError('duplicate manifest identity field')
            found[key] = json.loads(value)
        elif re.match(r'\s*(name|version)\s*=', line):
            raise RuntimeError('Python <3.11 requires literal double-quoted name/version')
    if set(found) != {'name', 'version'} or not all(isinstance(v, str) and v for v in found.values()):
        raise RuntimeError('missing or empty manifest identity')
    return found['name'], found['version']

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def validate_archive(bundle):
    if bundle.testzip() is not None:
        raise RuntimeError('candidate archive failed ZIP CRC verification')
    for name in bundle.namelist():
        p = Path(name)
        if p.is_absolute() or '..' in p.parts or '.git' in p.parts or '_build' in p.parts:
            raise RuntimeError('unsafe candidate archive entry')
        if (any(part in {'evidence', '.moon', '.mooncakes', 'target', '__pycache__'} for part in p.parts)
                or p.suffix.lower() in {'.p12', '.key', '.zip', '.patch'}
                or p.name == 'credentials.json' or p.name == '.env' or p.name.startswith('.env.')):
            raise RuntimeError('candidate archive contains local state, credentials or unrelated evidence')

def validate_source_tree(root):
    """Package only regular project sources; do not dereference source symlinks.

    Generated/cache/evidence directories are not package inputs. The ZIP alone
    cannot reveal that moon package copied a file from a symlink target.
    """
    excluded = {'.git', '_build', '.moon', '.mooncakes', 'target', 'evidence', '__pycache__', '.github'}
    for directory, directories, files in os.walk(root, followlinks=False):
        directories[:] = [name for name in directories if name not in excluded]
        for name in directories + files:
            path = Path(directory) / name
            if path.is_symlink():
                raise RuntimeError('source symlink is not permitted for local packaging: ' + str(path.relative_to(root)))


def parse_targets(text):
    targets = text.split(',')
    if (not targets or any(t not in {'js', 'wasm', 'wasm-gc', 'native'} for t in targets) or
            len(set(targets)) != len(targets)):
        raise argparse.ArgumentTypeError('targets must be unique js,wasm,wasm-gc,native names')
    return targets


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--workspace-dependencies', action='store_true', help='Use current MoonBit manifest/workspace format; historical locked SDK uses legacy local dependencies')
    parser.add_argument('--targets', type=parse_targets, default='js,wasm-gc', help='Explicit backend audit selection; default retains JS and Wasm GC gates')
    parser.add_argument('--transport', action='store_true', help='Optional loopback tests of the adapter built from the actual candidate archive')
    args = parser.parse_args()
    out = args.output.resolve()
    if out == ROOT or ROOT in out.parents:
        parser.error('--output must be a new directory outside source')
    out.mkdir(parents=True, exist_ok=False)
    env = dict(os.environ)
    moon = shutil.which(env.get('MOON_BIN', 'moon'))
    if not moon:
        parser.error('moon unavailable; reuse the existing SDK via MOON_BIN/PATH')
    env['PATH'] = str(Path(moon).parent) + os.pathsep + env.get('PATH', '')
    env['RUST_LOG'] = 'error'
    report = {'started_utc':datetime.now(timezone.utc).isoformat(), 'status':'FAILED',
              'consumption':'local moon package archive via local path dependency', 'targets':args.targets,
              'mooncakes':'NOT TESTED; no registry package installed or published',
              'broker':'NOT TESTED; incoming frames are explicit fixtures', 'stages':[]}
    def run(name, args, cwd):
        completed = subprocess.run(args, cwd=cwd, env=env, capture_output=True, timeout=180)
        (out / (name+'.stdout.txt')).write_bytes(completed.stdout)
        (out / (name+'.stderr.txt')).write_bytes(completed.stderr)
        report['stages'].append({'name':name, 'command':args, 'cwd':str(cwd),
            'exit_code':completed.returncode, 'status':'PASSED' if not completed.returncode else 'FAILED'})
        if completed.returncode:
            raise RuntimeError(name+' failed; see original log')
    try:
        validate_source_tree(ROOT)
        module, version = manifest_identity((ROOT / 'moon.mod').read_text())
        report['candidate_module'] = module
        report['candidate_version'] = version
        run('local-package', [moon, 'package', '--frozen'], ROOT)
        archive = ROOT / '_build/publish' / (module.replace('/', '-') + '-' + version + '.zip')
        shutil.copyfile(archive, out / ('moonstomp-' + version + '-local-candidate.zip'))
        candidate = out / 'candidate'
        candidate.mkdir()
        with zipfile.ZipFile(archive) as bundle:
            validate_archive(bundle)
            bundle.extractall(candidate)
        consumer = out / 'consumer'
        consumer.mkdir()
        if args.workspace_dependencies:
            # Current MoonBit resolves local modules through an explicit workspace.
            (consumer / 'moon.mod').write_text(
                'name = "independent/moonstomp-consumer"\nversion = "0.1.0"\nlicense = "MIT"\n'
                + 'import {\n  ' + json.dumps(module + '@' + version) + ',\n}\n')
            (consumer / 'moon.work').write_text('members = [".", "../candidate"]\n')
            report['consumption'] = 'local moon package archive via explicit two-module workspace'
        else:
            manifest = {'name':'independent/moonstomp-consumer', 'version':'0.1.0',
                        'license':'MIT', 'deps':{'sundaysebasidian-byte/moonstomp':{'path':'../candidate'}}}
            (consumer / 'moon.mod.json').write_text(json.dumps(manifest, indent=2)+'\n')
        for file in ['main.mbt', 'moon.pkg']:
            shutil.copyfile(ROOT / 'validation/consumer' / (file+'.in'), consumer / file)
        report['candidate_archive_sha256'] = digest(archive)
        report['candidate_source_sha256'] = {str(p.relative_to(candidate)):digest(p)
            for p in sorted(candidate.rglob('*')) if p.is_file()}
        report['consumer_sha256'] = {p.name:digest(p) for p in sorted(consumer.iterdir()) if p.is_file()}
        for target in args.targets:
            run('consumer-check-'+target, [moon,'check']+(['.'] if args.workspace_dependencies else [])+['--target',target,'--deny-warn','-j','1'], consumer)
            run('consumer-build-'+target, [moon,'build']+(['.'] if args.workspace_dependencies else [])+['--target',target,'--deny-warn','-j','1'], consumer)
            run('consumer-test-'+target, [moon,'test','--target',target,'--package','independent/moonstomp-consumer','--deny-warn','-j','1'], consumer)
            run('consumer-run-'+target, [moon,'run','.','--target',target,'--deny-warn','-j','1'], consumer)
            counts = re.search(r'Total tests: (\d+), passed: (\d+), failed: (\d+)', (out / ('consumer-test-'+target+'.stdout.txt')).read_text())
            if not counts or tuple(map(int, counts.groups())) != (6, 6, 0):
                raise RuntimeError('consumer scenarios/regressions were not all executed')
            report.setdefault('consumer_tests', {})[target] = {'total':6,'passed':6,'failed':0}
        # Package installation alone does not generate bridge.js. Build from the
        # actual extracted package, then exercise that package's adapter boundary.
        run('candidate-build-bridge-js', [moon,'build','bridge','--target','js','--deny-warn','-j','1'], candidate)
        run('candidate-js-bridge', ['node','scripts/bridge-test.cjs'], candidate)
        report['node_adapter'] = 'PASSED: generated bridge and loaded adapter from actual candidate archive; no prebuilt JS distributed'
        if args.transport:
            run('candidate-adapter-unit-faults', ['node', '--test', 'scripts/adapter-unit-test.cjs'], candidate)
            run('candidate-authentication-headers', ['node','scripts/auth-transport-test.cjs'], candidate)
            run('candidate-handles', ['node','scripts/handles-test.cjs'], candidate)
            run('candidate-tls', ['node','scripts/tls-transport-test.cjs'], candidate)
            run('candidate-loopback-quality', ['node','scripts/transport-quality-test.cjs'], candidate)
            run('candidate-control-timeouts', ['node','scripts/transport-timeout-test.cjs'], candidate)
            report['node_adapter_transport'] = 'PASSED: packaged credentials, scoped handles, TLS trust/hostname, 4 adapter boundaries and 6 three-version control-timeout cases; real loopback sockets, scripted peers, not a broker'
        if report['candidate_source_sha256'] != {str(p.relative_to(candidate)):digest(p)
                for p in sorted(candidate.rglob('*')) if p.is_file() and '_build' not in p.relative_to(candidate).parts and '.moon' not in p.relative_to(candidate).parts}:
            raise RuntimeError('candidate source unexpectedly changed')
        report['status'] = 'PASSED_LOCAL_CANDIDATE_ONLY'
    except Exception as error:
        report['error'] = str(error)
    report['finished_utc'] = datetime.now(timezone.utc).isoformat()
    (out / 'downstream.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(report['status'])
    if report['status'] == 'FAILED':
        print(report.get('error','unknown failure'), file=sys.stderr)
        return 1
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
