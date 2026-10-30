#!/usr/bin/env python3
"""CI-only, Linux x86_64 pinned SDK bootstrap; never invoked by library code.

Hashes pin previously verified official bytes, not separately vendor-signed sums.
Use a new runner-temporary destination. This does not update a global SDK.
"""
import argparse
import hashlib
import json
from pathlib import Path
import platform
import os
import subprocess
import tarfile
import tempfile
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
TOOLS = ('moon', 'moonc', 'moonrun', 'moonfmt', 'mooninfo', 'mooncake', 'moon-lsp', 'moon_cove_report', 'moon-wasm-opt', 'moonc-prove', 'moon-ide', 'moon-cram', 'moondoc', 'internal/tcc')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dest', required=True, type=Path)
    args = parser.parse_args()
    if platform.system() != 'Linux' or platform.machine() not in ('x86_64', 'AMD64'):
        parser.error('the pinned archives are Linux x86_64 only')
    dest = args.dest.resolve()
    if dest.exists():
        parser.error('destination must not already exist; use a fresh runner-temp path')
    lock = json.loads((ROOT / 'toolchain.lock.json').read_text())
    with tempfile.TemporaryDirectory(prefix='moonstomp-sdk-') as tmp:
        archives = []
        for part in ('sdk', 'core'):
            url = lock[part + '_url']
            if not url.startswith('https://cli.moonbitlang.com/'):
                raise RuntimeError('only the locked official HTTPS host is permitted')
            path = Path(tmp) / (part + '.tar.gz')
            with urllib.request.urlopen(url, timeout=120) as response:
                if not response.url.startswith('https://'):
                    raise RuntimeError('download redirected away from HTTPS')
                path.write_bytes(response.read())
            if hashlib.sha256(path.read_bytes()).hexdigest() != lock[part + '_sha256']:
                raise RuntimeError(part + ' checksum mismatch; nothing was installed')
            archives.append((part, path))
        # Both downloads are verified before destination creation/extraction.
        dest.mkdir(parents=True)
        for part, path in archives:
            target = dest if part == 'sdk' else dest / 'lib'
            target.mkdir(exist_ok=True)
            with tarfile.open(path, 'r:gz') as archive:
                archive.extractall(target, filter='data')
    # Official archive stores executable tools as 0664; restore only the known
    # project-local executables, never global files or arbitrary archive paths.
    for name in TOOLS:
        tool = dest / 'bin' / name
        if tool.is_symlink() or not tool.is_file():
            raise RuntimeError('missing or unsafe SDK tool: ' + name)
        tool.chmod(tool.stat().st_mode | 0o111)
    env = {**os.environ, 'MOON_HOME': str(dest), 'PATH': str(dest / 'bin') + os.pathsep + os.environ.get('PATH', '')}
    subprocess.run([str(dest / 'bin/moon'), 'bundle', '--all'], cwd=dest / 'lib/core', env=env, check=True)
    print('Pinned SDK/core installed into the explicit runner-temporary destination')


if __name__ == '__main__':
    main()
