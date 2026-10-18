#!/usr/bin/env python3
"""Use an already downloaded official Artemis archive and existing Java. No downloads."""
import argparse
from datetime import datetime,timezone
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import socket
import subprocess
import tarfile
import time
import xml.etree.ElementTree as ET

ROOT=Path(__file__).resolve().parents[1]
PINNED_SHA512='47d2193b4707bde8c856ee0f7ee623e87722559b8503aaef6ee015496499774a8c9b9492933cc0a52873e95dce73ff825222422996d2a8768a4936b015415e8c'

def validate_configuration(broker_text, bootstrap_path, port=61613):
    """Fail closed even under python -O; no listener starts before this check."""
    tree = ET.fromstring(broker_text)
    ns = {'c': 'urn:activemq:core'}
    acceptors = tree.findall('.//c:acceptor', ns)
    if (len(acceptors) != 1 or not acceptors[0].text or
            not acceptors[0].text.startswith(f'tcp://127.0.0.1:{port}?protocols=STOMP;')):
        raise RuntimeError('broker must have exactly one numeric-loopback STOMP acceptor')
    for tag in ['persistence-enabled', 'security-enabled', 'jmx-management-enabled']:
        setting = tree.find('.//c:' + tag, ns)
        if setting is None or setting.text != 'false':
            raise RuntimeError('broker requires ' + tag + '=false')
    if ET.parse(bootstrap_path).getroot().findall('.//{http://activemq.apache.org/schema}web'):
        raise RuntimeError('broker web listener must be disabled')

def validate_listeners(listeners, port=61613):
    rows = [line.split() for line in listeners.splitlines() if 'LISTEN' in line]
    if len(rows) != 1 or len(rows[0]) < 2 or rows[0][-2:] != [f'127.0.0.1:{port}', '(LISTEN)']:
        raise RuntimeError(f'actual broker listeners must be only 127.0.0.1:{port}')

def validate_extended(result):
    if result.get('passed') is not True or result.get('compatible_cases') != 5:
        raise RuntimeError('extended broker test evidence did not pass all five compatible cases')

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive',type=Path,required=True)
    parser.add_argument('--sha512',type=Path,required=True)
    parser.add_argument('--java-home',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--port',type=int,default=61613,help='Unused numeric-loopback test port; never stop an existing listener')
    parser.add_argument('--go-peer',type=Path,help='Optional prebuilt pinned real Go client peer; enables three-version bidirectional broker checks')
    args=parser.parse_args()
    if not 1 <= args.port <= 65535:parser.error('--port must be between 1 and 65535')
    out=args.output.resolve()
    if out==ROOT or ROOT in out.parents:parser.error('output must be new and outside source')
    out.mkdir(parents=True,exist_ok=False)
    env=dict(os.environ)
    env['JAVA_HOME']=str(args.java_home.resolve())
    env['JAVA_ARGS']='-Xms64m -Xmx256m -XX:ActiveProcessorCount=2 -Djava.net.preferIPv4Stack=true -Dlog4j2.disableJmx=true --add-opens=java.base/jdk.internal.misc=ALL-UNNAMED'
    report={'started_utc':datetime.now(timezone.utc).isoformat(),'broker':'Apache Artemis 2.57.0',
      'host':'127.0.0.1','port':args.port,'persistence':False,'credentials_required':False,
      'heap_max_mib':256,'active_processor_count':2,'stages':[],'overall':'FAILED',
      'transactional_ack':'NOT SUPPORTED BY THIS BROKER','other_brokers':'NOT TESTED',
      'go_stomp_interop':'NOT RUN: supply --go-peer after building the pinned peer'}
    temporary=out/'temporary'
    temporary.mkdir()
    process=None
    def run(name,command,cwd=ROOT,child_env=None,timeout=30):
        completed=subprocess.run(command,cwd=cwd,env=child_env or env,capture_output=True,timeout=timeout)
        (out/(name+'.stdout.txt')).write_bytes(completed.stdout)
        (out/(name+'.stderr.txt')).write_bytes(completed.stderr)
        report['stages'].append({'name':name,'command':command,'exit_code':completed.returncode,
                                'status':'PASSED' if not completed.returncode else 'FAILED'})
        if completed.returncode:raise RuntimeError(name+' failed; see original logs')
        return completed
    try:
        archive=args.archive.resolve()
        declared=re.search(r'[0-9a-fA-F]{128}',args.sha512.read_text()).group().lower()
        actual=hashlib.sha512(archive.read_bytes()).hexdigest()
        if declared!=actual or actual!=PINNED_SHA512:raise RuntimeError('official pinned archive SHA512 mismatch')
        report['archive_sha512']=actual;report['archive_bytes']=archive.stat().st_size
        java=run('java-version',[env['JAVA_HOME']+'/bin/java','-version'])
        report['java_version']=java.stderr.decode().strip()
        major = re.search(r'version "(\d+)', report['java_version'])
        if not major or int(major.group(1)) < 17:raise RuntimeError('Apache Artemis 2.57.0 requires Java 17 or above')
        report['java_requirement_source']='https://artemis.apache.org/components/artemis/download/release-notes-2.57.0'
        report['java_major']=int(major.group(1))
        with tarfile.open(archive) as bundle:bundle.extractall(temporary,filter='data')
        home=temporary/'apache-artemis-2.57.0'
        instance=temporary/'instance'
        # Refuse to share or stop any preexisting listener.
        reservation=socket.socket();reservation.bind(('127.0.0.1',args.port));reservation.close()
        run('create-instance',[str(home/'bin/artemis'),'create',str(instance),'--silent','--allow-anonymous',
            '--disable-persistence','--no-web','--no-autotune','--no-amqp-acceptor','--no-mqtt-acceptor',
            '--no-hornetq-acceptor','--host','127.0.0.1','--name','MoonSTOMP-local-interop',
            '--user','local-test','--password','local-test-only','--java-memory','256M'])
        broker=instance/'etc/broker.xml'
        text=broker.read_text()
        text=re.sub(r'<acceptors>.*?</acceptors>', f'<acceptors><acceptor name="stomp">tcp://127.0.0.1:{args.port}?protocols=STOMP;useEpoll=false;nioRemotingThreads=2;connectionTtl=10000</acceptor></acceptors>',text,flags=re.S)
        text=text.replace('<name>MoonSTOMP-local-interop</name>','<name>MoonSTOMP-local-interop</name><security-enabled>false</security-enabled><jmx-management-enabled>false</jmx-management-enabled><thread-pool-max-size>4</thread-pool-max-size><scheduled-thread-pool-max-size>2</scheduled-thread-pool-max-size><global-max-size>32M</global-max-size>')
        text=re.sub(r'(<address-setting match="[^"]+">)',r'\1<default-address-routing-type>ANYCAST</default-address-routing-type><default-queue-routing-type>ANYCAST</default-queue-routing-type>',text)
        broker.write_text(text)
        bootstrap=instance/'etc/bootstrap.xml'
        validate_configuration(text, bootstrap, args.port)
        shutil.copyfile(broker,out/'broker.xml');shutil.copyfile(bootstrap,out/'bootstrap.xml')
        for filename in ['LICENSE','NOTICE']:shutil.copyfile(home/filename,out/('ARTEMIS-'+filename))
        report['config_sha256']=hashlib.sha256(broker.read_bytes()).hexdigest()
        with (out/'broker.stdout.txt').open('wb') as stdout,(out/'broker.stderr.txt').open('wb') as stderr:
            process=subprocess.Popen([str(instance/'bin/artemis'),'run'],cwd=instance,env=env,
              stdout=stdout,stderr=stderr,start_new_session=True)
            report['pid']=process.pid
            for attempt in range(100):
                if process.poll() is not None:raise RuntimeError('broker exited during startup')
                try:
                    with socket.create_connection(('127.0.0.1',args.port),timeout=.1):break
                except OSError:time.sleep(.1)
            else:raise RuntimeError('broker startup timed out')
            lsof = shutil.which('lsof')
            if not lsof: raise RuntimeError('lsof is required to verify loopback-only broker listeners')
            listeners=run('listeners',[lsof,'-nP','-a','-p',str(process.pid),'-iTCP','-sTCP:LISTEN']).stdout.decode()
            validate_listeners(listeners, args.port)
            for script in ['examples/1-tasks.cjs','examples/2-reliable.cjs','examples/3-transactions.cjs','scripts/broker-test.cjs']:
                name=Path(script).stem;child_env=dict(env)
                child_env['STOMP_HOST']='127.0.0.1';child_env['STOMP_PORT']=str(args.port)
                child_env['NODE_OPTIONS']='--require='+str(ROOT/'scripts/broker-trace.cjs')
                child_env['MOONSTOMP_TRACE_FILE']=str(out/(name+'.wire.jsonl'))
                print('RUN real broker',name,flush=True)
                run(name,['node',script],child_env=child_env)
            if args.go_peer:
                report['go_stomp_interop']='FAILED_PRECHECK_OR_EXECUTION'
                interop_env=dict(env)
                interop_env.update(STOMP_HOST='127.0.0.1',STOMP_PORT=str(args.port),MOONSTOMP_GO_PEER=str(args.go_peer.resolve()),MOONSTOMP_INTEROP_OUTPUT=str(out/'go-interop'))
                interop_env['NODE_OPTIONS']='--require='+str(ROOT/'scripts/broker-trace.cjs')
                interop_env['MOONSTOMP_TRACE_FILE']=str(out/'go-interop.moon-wire.jsonl')
                run('go-broker-interop',['node','scripts/go-broker-interop.cjs'],child_env=interop_env,timeout=100)
                report['go_stomp_interop']=json.loads((out/'go-interop/interop.json').read_text())
            report['extended']=json.loads((out/'broker-test.stdout.txt').read_text())
            validate_extended(report['extended'])
            report['rss_sample_kib']=int(subprocess.check_output(['/bin/ps','-o','rss=','-p',str(process.pid)],text=True).strip())
            report['overall']='PASSED_ARTEMIS_2_57_PROFILE_WITH_TX_ACK_LIMITATION'
    except Exception as error:
        report['error']=str(error)
    finally:
        if process:
            if process.poll() is None:process.terminate()
            try:process.wait(timeout=10)
            except subprocess.TimeoutExpired:process.kill();process.wait(timeout=5)
            report['broker_exit_code']=process.returncode
            try:
                with socket.create_connection(('127.0.0.1',args.port),timeout=.2):report['port_closed']=False
            except OSError:report['port_closed']=True
        shutil.rmtree(temporary)
        report['temporary_runtime_removed']=True
        report['finished_utc']=datetime.now(timezone.utc).isoformat()
        (out/'broker-tests.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(report['overall'],report.get('error',''),flush=True)
    return 0 if report['overall'].startswith('PASSED') and report.get('port_closed') else 1

if __name__=='__main__':raise SystemExit(main())
