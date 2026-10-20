#!/usr/bin/env python3
"""Run an existing verified Classic archive in a task-local, loopback-only profile."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import socket
import subprocess
import time
import zipfile

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--home', type=Path, required=True)
    parser.add_argument('--java-home', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--port', type=int, default=62614)
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error('invalid port')
    out = args.output.resolve()
    if out == ROOT or ROOT in out.parents:
        parser.error('output must be outside source')
    out.mkdir(parents=True, exist_ok=False)
    home = args.home.resolve()
    report = {'started_utc': datetime.now(timezone.utc).isoformat(), 'broker': 'ActiveMQ Classic 6.3.2',
              'host': '127.0.0.1', 'port': args.port, 'status': 'FAILED', 'stages': [],
              'profile': 'test-only credentials, no persistence/JMX/web or system service'}
    process = None
    def run(name, command, env=None):
        p = subprocess.run(command, cwd=ROOT, env=env, capture_output=True, timeout=90)
        (out / (name + '.stdout.txt')).write_bytes(p.stdout)
        (out / (name + '.stderr.txt')).write_bytes(p.stderr)
        report['stages'].append({'name': name, 'command': command, 'exit_code': p.returncode})
        if p.returncode:
            raise RuntimeError(name + ' failed; see logs')
        return p.stdout.decode()
    try:
        jar = home / 'lib/activemq-broker-6.3.2.jar'
        with zipfile.ZipFile(jar) as archive:
            if 'Implementation-Version: 6.3.2' not in archive.read('META-INF/MANIFEST.MF').decode():
                raise RuntimeError('wrong broker jar version')
        report['broker_jar_sha256'] = hashlib.sha256(jar.read_bytes()).hexdigest()
        java = str(args.java_home.resolve() / 'bin/java')
        run('java-version', [java, '-version'])
        # Fail without disturbing any existing listener.
        with socket.socket() as reservation:
            reservation.bind(('127.0.0.1', args.port))
        profile = out / 'profile'
        conf = profile / 'conf'
        conf.mkdir(parents=True)
        (profile / 'data').mkdir()
        (profile / 'tmp').mkdir()
        config = conf / 'broker.xml'
        config.write_text('''<beans xmlns="http://www.springframework.org/schema/beans"
xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
xsi:schemaLocation="http://www.springframework.org/schema/beans http://www.springframework.org/schema/beans/spring-beans.xsd http://activemq.apache.org/schema/core http://activemq.apache.org/schema/core/activemq-core.xsd">
<broker xmlns="http://activemq.apache.org/schema/core" brokerName="MoonSTOMPClassicLocal" persistent="false" useJmx="false" schedulerSupport="false" advisorySupport="false">
<plugins><simpleAuthenticationPlugin anonymousAccessAllowed="false"><users>
<authenticationUser username="moonstomp-test" password="loopback-test-only" groups="users"/>
</users></simpleAuthenticationPlugin></plugins>
<transportConnectors><transportConnector name="stomp" uri="stomp://127.0.0.1:''' + str(args.port) + '''?wireFormat.maxFrameSize=1048576"/></transportConnectors>
</broker></beans>
''')
        (conf / 'log4j2.properties').write_text('status=error\nname=MoonSTOMPClassic\nappender.console.type=Console\nappender.console.name=console\nappender.console.layout.type=PatternLayout\nappender.console.layout.pattern=%p %m%n\nrootLogger.level=warn\nrootLogger.appenderRef.console.ref=console\n')
        command = [java, '-Xms64m', '-Xmx256m', '-XX:ActiveProcessorCount=2', '-Djava.awt.headless=true',
                   '-Dactivemq.home=' + str(home), '-Dactivemq.base=' + str(profile),
                   '-Dactivemq.conf=' + str(conf), '-Dactivemq.data=' + str(profile / 'data'),
                   '-Djava.io.tmpdir=' + str(profile / 'tmp'),
                   '-Dlog4j2.configurationFile=' + str(conf / 'log4j2.properties'),
                   '-jar', str(home / 'bin/activemq.jar'), 'start', 'xbean:' + str(config)]
        env = {k: v for k, v in os.environ.items() if k not in ['JAVA_TOOL_OPTIONS', '_JAVA_OPTIONS', 'JDK_JAVA_OPTIONS']}
        with (out / 'broker.stdout.txt').open('wb') as stdout, (out / 'broker.stderr.txt').open('wb') as stderr:
            process = subprocess.Popen(command, cwd=profile, env=env, stdout=stdout, stderr=stderr)
        report.update(broker_pid=process.pid, broker_command=command, config_sha256=hashlib.sha256(config.read_bytes()).hexdigest())
        for attempt in range(150):
            if process.poll() is not None:
                raise RuntimeError('broker exited during startup')
            try:
                with socket.create_connection(('127.0.0.1', args.port), timeout=.2):
                    break
            except OSError:
                time.sleep(.1)
        else:
            raise RuntimeError('broker startup timeout')
        listeners = run('listeners', ['lsof', '-nP', '-a', '-p', str(process.pid), '-iTCP', '-sTCP:LISTEN'])
        rows = [x.split() for x in listeners.splitlines() if 'LISTEN' in x]
        if len(rows) != 1 or rows[0][-2:] != ['127.0.0.1:' + str(args.port), '(LISTEN)']:
            raise RuntimeError('unexpected broker listeners')
        child_env = dict(env, STOMP_PORT=str(args.port))
        tests = run('classic-interop', ['node', 'scripts/classic-interop-test.cjs'], child_env)
        report['interop'] = json.loads(tests)
        if report['interop']['status'] != 'PASSED':
            raise RuntimeError('interop did not pass')
        report['status'] = 'PASSED'
    except Exception as error:
        report['error'] = str(error)
    finally:
        if process is not None:
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=15)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=10)
            report['broker_exit_code'] = process.returncode
        try:
            with socket.create_connection(('127.0.0.1', args.port), timeout=.2):
                report['port_closed'] = False
        except OSError:
            report['port_closed'] = True
        report['finished_utc'] = datetime.now(timezone.utc).isoformat()
        (out / 'classic.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))
    return 0 if report['status'] == 'PASSED' and report['port_closed'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
