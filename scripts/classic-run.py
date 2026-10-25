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
from xml.sax.saxutils import quoteattr

ROOT = Path(__file__).resolve().parents[1]


def broker_config(port, key_store=None):
    if not isinstance(port, int) or isinstance(port, bool) or not 1 <= port <= 65535:
        raise ValueError('invalid port')
    scheme = 'stomp+ssl' if key_store is not None else 'stomp'
    ssl_context = '' if key_store is None else (
        '<sslContext><sslContext keyStore=' + quoteattr(Path(key_store).as_uri()) +
        ' keyStoreType="PKCS12" keyStorePassword="profile-test-only"/></sslContext>')
    return ('''<beans xmlns="http://www.springframework.org/schema/beans"
xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
xsi:schemaLocation="http://www.springframework.org/schema/beans http://www.springframework.org/schema/beans/spring-beans.xsd http://activemq.apache.org/schema/core http://activemq.apache.org/schema/core/activemq-core.xsd">
<broker xmlns="http://activemq.apache.org/schema/core" brokerName="MoonSTOMPClassicLocal" persistent="false" useJmx="false" schedulerSupport="false" advisorySupport="false">
<plugins><simpleAuthenticationPlugin anonymousAccessAllowed="false"><users>
<authenticationUser username="moonstomp-test" password="loopback-test-only" groups="users"/>
</users></simpleAuthenticationPlugin></plugins>
''' + ssl_context + '''<transportConnectors><transportConnector name="stomp" uri="''' + scheme + '''://127.0.0.1:''' + str(port) + '''?wireFormat.maxFrameSize=1048576"/></transportConnectors>
</broker></beans>
''')


def validate_listeners(text, port):
    rows = [line.split() for line in text.splitlines() if 'LISTEN' in line]
    if len(rows) != 1 or rows[0][-2:] != ['127.0.0.1:' + str(port), '(LISTEN)']:
        raise RuntimeError('unexpected broker listeners')


def validate_interop(result, tls_enabled):
    if result.get('status') != 'PASSED' or result.get('tls') is not tls_enabled:
        raise RuntimeError('interop status/TLS evidence mismatch')
    rows = result.get('results', [])
    if not isinstance(rows, list) or any(not isinstance(row, dict) or row.get('status') != 'PASSED' for row in rows):
        raise RuntimeError('failed or malformed interop row')
    for name in ['missing-credentials', 'incorrect-credentials'] + (
            ['wrong-tls-hostname', 'untrusted-tls-ca'] if tls_enabled else []):
        matches = [row for row in rows if row.get('name') == name and row.get('status') == 'PASSED']
        if len(matches) != 1 or ('tls' in name and (type(matches[0].get('connects')) is not int or matches[0]['connects'] != 0)):
            raise RuntimeError('missing authentication/TLS negative control')
    versions = [row for row in rows if 'version' in row]
    if sorted(row['version'] for row in versions) != ['1.0', '1.1', '1.2']:
        raise RuntimeError('missing or duplicate version evidence')
    for row in versions:
        if (row.get('status') != 'PASSED' or row.get('actual_version') != row['version'] or
                row.get('tls_verified') is not tls_enabled or
                any(row.get(key) is not True for key in ['authenticated', 'versioned_ack',
                    'committed_send_received', 'unsubscribe_disconnect_receipts', 'abrupt_disconnect_no_replay']) or
                row.get('binary_octets') != 5 or row.get('precommit_not_received_ms') != 100 or
                row.get('aborted_send_not_received_ms') != 250 or
                row.get('uncommitted_send_not_received_after_disconnect_ms') != 100):
            raise RuntimeError('incomplete version/transaction evidence')


def validate_demo(result):
    if result.get('status') != 'PASSED' or result.get('version') != '1.2':
        raise RuntimeError('demo did not pass as STOMP 1.2')
    for field in ['tls_verified', 'wrong_credentials_rejected', 'commit_delivered',
                  'sender_closed', 'no_automatic_replay', 'upstreamTlsVerified', 'relay_closed']:
        if result.get(field) is not True:
            raise RuntimeError('incomplete demo assertion: ' + field)
    for field, expected in [('acceptedConnections', 1), ('forwardedSends', 1), ('droppedReceipts', 1),
                            ('relay_open_sockets_after_cleanup', 0), ('abort_not_delivered_ms', 150)]:
        if type(result.get(field)) is not int or result[field] != expected:
            raise RuntimeError('incomplete demo counter: ' + field)
    error = result.get('receipt_error', {})
    if (error.get('code') != 'STOMP_RECEIPT_TIMEOUT' or error.get('operation') != 'SEND' or
            error.get('outcomeUnknown') is not True or result.get('credentials_in_public_output') is not False):
        raise RuntimeError('invalid demo failure/credential evidence')
    steps = result.get('steps', [])
    if ([row.get('name') for row in steps] != ['tls-authentication', 'transactions', 'unknown-no-replay'] or
            any(row.get('status') != 'PASSED' for row in steps)):
        raise RuntimeError('incomplete demo steps')
    elapsed = result.get('elapsed_ms')
    if type(elapsed) is not int or not 0 < elapsed < 180000:
        raise RuntimeError('demo exceeded three-minute budget')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--home', type=Path, required=True)
    parser.add_argument('--java-home', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--port', type=int, default=62614)
    parser.add_argument('--processors', type=int, choices=[1, 2], default=2,
                        help='Bound Java active processors; manual CI uses one, historical default remains two')
    parser.add_argument('--tls', action='store_true', help='Ephemeral localhost certificate, verified STOMP TLS plus authentication; no plaintext connector')
    parser.add_argument('--demo', action='store_true', help='One focused STOMP 1.2 TLS/transaction/receipt-loss demonstration; requires --tls; does not run broker matrix')
    parser.add_argument('--heartbeat', action='store_true', help='Bounded real TLS heartbeat timeout fixture; no business SEND')
    parser.add_argument('--soak', action='store_true', help='Fixed five-minute real TLS load/heartbeat window')
    args = parser.parse_args()
    if args.soak and (not args.tls or args.demo or args.heartbeat):
        parser.error('--soak requires --tls and excludes --demo/--heartbeat')
    if args.heartbeat and (not args.tls or args.demo):
        parser.error('--heartbeat requires --tls and cannot combine with --demo')
    if args.demo and not args.tls:
        parser.error('--demo requires --tls')
    if not 1 <= args.port <= 65535:
        parser.error('invalid port')
    out = args.output.resolve()
    if out == ROOT or ROOT in out.parents:
        parser.error('output must be outside source')
    out.mkdir(parents=True, exist_ok=False)
    home = args.home.resolve()
    report = {'started_utc': datetime.now(timezone.utc).isoformat(), 'broker': 'ActiveMQ Classic 6.3.2',
              'tls': args.tls, 'host': '127.0.0.1', 'port': args.port, 'status': 'FAILED', 'stages': [],
              'profile': 'test-only credentials, no persistence/JMX/web or system service'}
    process = None
    start_clock = time.monotonic()
    report['mode'] = 'five-minute-soak' if args.soak else 'heartbeat-timeout' if args.heartbeat else ('three-minute-demo' if args.demo else 'interop-matrix')
    def run(name, command, env=None):
        p = subprocess.run(command, cwd=ROOT, env=env, capture_output=True, timeout=340 if args.soak else (20 if args.demo else 90))
        (out / (name + '.stdout.txt')).write_bytes(p.stdout)
        (out / (name + '.stderr.txt')).write_bytes(p.stderr)
        report['stages'].append({'name': name, 'command': command, 'exit_code': p.returncode})
        if p.returncode:
            raise RuntimeError(name + ' failed; see logs')
        return p.stdout.decode()
    try:
        if args.demo and not (ROOT / '_build/js/debug/build/bridge/bridge.js').is_file():
            raise RuntimeError('MoonBit bridge missing; run moon build --target js before --demo')
        jar = home / 'lib/activemq-broker-6.3.2.jar'
        with zipfile.ZipFile(jar) as archive:
            if 'Implementation-Version: 6.3.2' not in archive.read('META-INF/MANIFEST.MF').decode():
                raise RuntimeError('wrong broker jar version')
        report['broker_jar_sha256'] = hashlib.sha256(jar.read_bytes()).hexdigest()
        java = str(args.java_home.resolve() / 'bin/java')
        run('java-version', [java, '-version'])
        # Fail without disturbing any existing listener.
        with socket.socket() as reservation:
            # Permit a rehearsal after our own TCP TIME_WAIT; a live listener still fails.
            reservation.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            reservation.bind(('127.0.0.1', args.port))
        profile = out / 'profile'
        conf = profile / 'conf'
        conf.mkdir(parents=True)
        (profile / 'data').mkdir()
        (profile / 'tmp').mkdir()
        config = conf / 'broker.xml'
        key_store = None
        if args.tls:
            key_store = conf / 'broker.p12'
            keytool = str(args.java_home.resolve() / 'bin/keytool')
            run('test-certificate', [keytool, '-genkeypair', '-alias', 'broker', '-keyalg', 'RSA',
                '-keysize', '2048', '-dname', 'CN=localhost', '-ext', 'SAN=dns:localhost,ip:127.0.0.1',
                '-validity', '2', '-storetype', 'PKCS12', '-keystore', str(key_store),
                '-storepass', 'profile-test-only', '-keypass', 'profile-test-only', '-noprompt'])
            run('export-test-certificate', [keytool, '-exportcert', '-rfc', '-alias', 'broker',
                '-keystore', str(key_store), '-storepass', 'profile-test-only',
                '-file', str(conf / 'broker-cert.pem')])
        config.write_text(broker_config(args.port, key_store))
        (conf / 'log4j2.properties').write_text('status=error\nname=MoonSTOMPClassic\nappender.console.type=Console\nappender.console.name=console\nappender.console.layout.type=PatternLayout\nappender.console.layout.pattern=%p %m%n\nrootLogger.level=warn\nrootLogger.appenderRef.console.ref=console\n')
        command = [java, '-Xms64m', '-Xmx256m', '-XX:ActiveProcessorCount=' + str(args.processors), '-Djava.awt.headless=true',
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
        validate_listeners(listeners, args.port)
        child_env = dict(env, STOMP_PORT=str(args.port))
        # Do not inherit a caller's TLS test configuration into the plaintext run.
        child_env.pop('STOMP_TLS_CA', None)
        if args.tls:
            child_env['STOMP_TLS_CA'] = str(conf / 'broker-cert.pem')
        if args.soak:
            report['soak'] = json.loads(run('classic-soak', ['node', 'scripts/classic-soak-test.cjs'], child_env))
            report['soak_fixture_sha256'] = hashlib.sha256((ROOT / 'scripts/classic-soak-test.cjs').read_bytes()).hexdigest()
            if report['soak'].get('status') != 'PASSED' or report['soak'].get('elapsed_ms', 0) < 300000:
                raise RuntimeError('five-minute load did not complete')
        elif args.heartbeat:
            child_env['STOMP_DEMO_PFX'] = str(key_store)
            report['heartbeat'] = json.loads(run('classic-heartbeat', ['node', 'scripts/classic-heartbeat-test.cjs'], child_env))
            report['heartbeat_fixture_sha256'] = hashlib.sha256((ROOT / 'scripts/classic-heartbeat-test.cjs').read_bytes()).hexdigest()
            h = report['heartbeat']
            if not (h.get('status') == 'PASSED' and h.get('tls') is True and h.get('heartbeat_timeout') is True and h.get('no_reconnect') is True and h.get('open_relay_sockets') == 0 and h.get('business_SENDs') == 0):
                raise RuntimeError('incomplete real heartbeat evidence')
        elif args.demo:
            child_env['STOMP_DEMO_PFX'] = str(key_store)
            tests = run('classic-three-minute', ['node', 'examples/classic-three-minute.cjs'], child_env)
            # Public demo output is a whitelist of assertions, never raw broker ERROR/cause.
            if any(token in tests for token in ['moonstomp-test', 'loopback-test-only', 'deliberately-wrong', 'profile-test-only']):
                raise RuntimeError('demo output included a synthetic credential marker')
            report['demo'] = json.loads(tests)
            validate_demo(report['demo'])
        else:
            tests = run('classic-interop', ['node', 'scripts/classic-interop-test.cjs'], child_env)
            report['interop'] = json.loads(tests)
            validate_interop(report['interop'], args.tls)
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
        # Retain the public test certificate, never the ephemeral private key.
        key_file = out / 'profile/conf/broker.p12'
        if key_file.exists():
            key_file.unlink()
        if report['status'] == 'PASSED' and not report['port_closed']:
            report.update(status='FAILED', error='broker port still open after cleanup')
        report['elapsed_ms'] = round((time.monotonic() - start_clock) * 1000)
        if args.demo and report['status'] == 'PASSED' and report['elapsed_ms'] >= 180000:
            report.update(status='FAILED', error='demo exceeded three-minute budget')
        report['private_key_removed'] = not key_file.exists()
        report['finished_utc'] = datetime.now(timezone.utc).isoformat()
        (out / 'classic.json').write_text(json.dumps(report, indent=2) + '\n')
    if args.demo:
        for row in report.get('demo', {}).get('steps', []):
            print(row['name'] + ': ' + row['text'])
        print('cleanup: broker port closed=' + str(report.get('port_closed')) +
              '; temporary private key removed=' + str(not (out / 'profile/conf/broker.p12').exists()))
        print('Wasm GC compatibility remains FAILED; this focused demo is not full acceptance.')
        print('RESULT ' + report['status'] + '; elapsed_ms=' + str(report['elapsed_ms']))
        if report['status'] != 'PASSED':
            print('See private classic.json/stage logs; raw errors are not printed in demo output.')
    else:
        print(json.dumps(report, indent=2))
    return 0 if report['status'] == 'PASSED' and report['port_closed'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
