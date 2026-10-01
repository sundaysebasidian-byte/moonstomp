#!/usr/bin/env python3
"""Consume a locally packaged candidate from an independent module. Never publishes."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[1]

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True, type=Path)
    out = parser.parse_args().output.resolve()
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
              'consumption':'local moon package archive via local path dependency',
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
        run('local-package', [moon, 'package', '--frozen'], ROOT)
        archive = ROOT / '_build/publish/sundaysebasidian-byte-moonstomp-0.1.0.zip'
        shutil.copyfile(archive, out / 'moonstomp-0.1.0-local-candidate.zip')
        candidate = out / 'candidate'
        candidate.mkdir()
        with zipfile.ZipFile(archive) as bundle:
            assert bundle.testzip() is None
            for name in bundle.namelist():
                p = Path(name)
                if p.is_absolute() or '..' in p.parts or '.git' in p.parts or '_build' in p.parts:
                    raise RuntimeError('unsafe candidate archive entry')
            bundle.extractall(candidate)
        consumer = out / 'consumer'
        consumer.mkdir()
        manifest = {'name':'independent/moonstomp-consumer', 'version':'0.1.0',
                    'license':'MIT', 'deps':{'sundaysebasidian-byte/moonstomp':{'path':'../candidate'}}}
        (consumer / 'moon.mod.json').write_text(json.dumps(manifest, indent=2)+'\n')
        for file in ['main.mbt', 'moon.pkg']:
            shutil.copyfile(ROOT / 'validation/consumer' / (file+'.in'), consumer / file)
        report['candidate_archive_sha256'] = digest(archive)
        report['candidate_source_sha256'] = {str(p.relative_to(candidate)):digest(p)
            for p in sorted(candidate.rglob('*')) if p.is_file()}
        report['consumer_sha256'] = {p.name:digest(p) for p in sorted(consumer.iterdir()) if p.is_file()}
        for target in ['js', 'wasm-gc']:
            run('consumer-check-'+target, [moon,'check','--target',target,'--deny-warn','-j','1'], consumer)
            run('consumer-build-'+target, [moon,'build','--target',target,'--deny-warn','-j','1'], consumer)
            run('consumer-test-'+target, [moon,'test','--target',target,'--package','independent/moonstomp-consumer','--deny-warn','-j','1'], consumer)
            run('consumer-run-'+target, [moon,'run','.','--target',target,'--deny-warn','-j','1'], consumer)
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
