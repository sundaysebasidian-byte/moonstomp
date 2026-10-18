#!/usr/bin/env python3
"""Build the pinned real Go client peer from an existing checkout; never download tools/packages."""
import argparse, hashlib, json, os, subprocess
from pathlib import Path

PINNED='c155a2d699bb5bc1b2547a4382b3cdd7f4403648'
ROOT=Path(__file__).resolve().parents[1]

def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--go',type=Path,required=True)
    ap.add_argument('--go-stomp-checkout',type=Path,required=True)
    ap.add_argument('--output',type=Path,required=True)
    args=ap.parse_args()
    out=args.output.resolve();out.mkdir(parents=True,exist_ok=False)
    checkout=args.go_stomp_checkout.resolve()
    report={'go_stomp_commit':PINNED,'scope':'Go peer build only; no broker or MoonBit execution','status':'FAILED'}
    try:
        head=subprocess.check_output(['git','rev-parse','HEAD'],cwd=checkout,text=True).strip()
        dirty=subprocess.check_output(['git','status','--porcelain','--untracked-files=all'],cwd=checkout,text=True)
        if head!=PINNED or dirty:raise RuntimeError('requires clean pinned upstream checkout')
        env=dict(os.environ,GOTOOLCHAIN='local',GOPROXY='off',GOSUMDB='off',GOCACHE=str(out/'cache'),GOPATH=str(out/'gopath'))
        for name,command,cwd in [('version',[str(args.go.resolve()),'version'],ROOT)]:
            r=subprocess.run(command,cwd=cwd,env=env,capture_output=True,text=True,timeout=30)
            (out/(name+'.stdout.txt')).write_text(r.stdout);(out/(name+'.stderr.txt')).write_text(r.stderr)
            if r.returncode or not r.stdout.startswith('go version go'):raise RuntimeError('supplied tool is not a Go compiler')
            report['go_version']=r.stdout.strip()
        # No copied protocol source or generated replacement client. A public Go
        # module points to the exact clean upstream source already present.
        source=(ROOT/'tests/interop/go-peer/main.go').read_bytes()
        (out/'main.go').write_bytes(source)
        report['peer_source_sha256']=hashlib.sha256(source).hexdigest()
        (out/'go.mod').write_text('module moonstomp-interop-peer\n\ngo 1.26.8\n\nrequire github.com/go-stomp/stomp/v3 v3.0.0\n\nreplace github.com/go-stomp/stomp/v3 => '+json.dumps(str(checkout))+'\n')
        command=[str(args.go.resolve()),'build','-buildvcs=false','-mod=mod','-o',str(out/'go-peer'),'.']
        r=subprocess.run(command,cwd=out,env=env,capture_output=True,text=True,timeout=120)
        (out/'build.stdout.txt').write_text(r.stdout);(out/'build.stderr.txt').write_text(r.stderr)
        report['build_command']=command;report['exit_code']=r.returncode
        report['vcs_stamping']='disabled for standalone temporary glue module; explicit upstream pin/source/binary hashes retained'
        if r.returncode:raise RuntimeError('Go peer build failed; no downloads or toolchain substitution attempted')
        report['binary_sha256']=hashlib.sha256((out/'go-peer').read_bytes()).hexdigest();report['status']='BUILT_NOT_RUN'
    except Exception as e:report['error']=str(e)
    (out/'build.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report));return 0 if report['status']=='BUILT_NOT_RUN' else 1
if __name__=='__main__':raise SystemExit(main())
