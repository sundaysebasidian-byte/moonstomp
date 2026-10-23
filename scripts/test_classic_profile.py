"""Offline checks for broker profile generation. Does not start a broker."""
import importlib.util
from pathlib import Path
import unittest
import xml.etree.ElementTree as ET

spec = importlib.util.spec_from_file_location('classic_runner', Path(__file__).with_name('classic-run.py'))
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)
NS = {'a': 'http://activemq.apache.org/schema/core'}


class ClassicProfile(unittest.TestCase):
    def test_plaintext_keeps_one_numeric_loopback_connector(self):
        xml = ET.fromstring(runner.broker_config(62614))
        connectors = xml.findall('.//a:transportConnector', NS)
        self.assertEqual(len(connectors), 1)
        self.assertEqual(connectors[0].get('uri'), 'stomp://127.0.0.1:62614?wireFormat.maxFrameSize=1048576')
        self.assertEqual(xml.findall('.//a:sslContext', NS), [])

    def test_tls_uses_only_tls_and_escapes_keystore_path(self):
        key = Path('/tmp/test with spaces & "quotes"/broker.p12')
        xml = ET.fromstring(runner.broker_config(62615, key))
        connectors = xml.findall('.//a:transportConnector', NS)
        self.assertEqual(len(connectors), 1)
        self.assertEqual(connectors[0].get('uri'), 'stomp+ssl://127.0.0.1:62615?wireFormat.maxFrameSize=1048576')
        ssl = xml.find('.//a:sslContext/a:sslContext', NS)
        self.assertEqual(ssl.get('keyStore'), key.as_uri())
        self.assertEqual(ssl.get('keyStoreType'), 'PKCS12')

    def test_both_profiles_require_auth_and_disable_services(self):
        for key in [None, Path('/tmp/ephemeral.p12')]:
            xml = ET.fromstring(runner.broker_config(62614, key))
            broker = xml.find('a:broker', NS)
            for name in ['persistent', 'useJmx', 'schedulerSupport', 'advisorySupport']:
                self.assertEqual(broker.get(name), 'false')
            self.assertEqual(xml.find('.//a:simpleAuthenticationPlugin', NS).get('anonymousAccessAllowed'), 'false')
            self.assertEqual(xml.findall('.//a:web', NS), [])

    def test_invalid_ports_fail_before_profile_generation(self):
        for port in [0, -1, 65536, True, '62614']:
            with self.subTest(port=port), self.assertRaises(ValueError):
                runner.broker_config(port)

    def test_incomplete_success_evidence_rejected(self):
        for report in [{}, {'status': 'PASSED'}, {'status': 'PASSED', 'tls': True, 'results': []}]:
            with self.subTest(report=report), self.assertRaises(RuntimeError):
                runner.validate_interop(report, True)

    def test_full_evidence_and_tls_mismatch(self):
        versions = [dict(version=v, actual_version=v, status='PASSED', tls_verified=True,
            authenticated=True, versioned_ack=True, committed_send_received=True,
            unsubscribe_disconnect_receipts=True, abrupt_disconnect_no_replay=True,
            uncommitted_send_not_received_after_disconnect_ms=100, binary_octets=5, precommit_not_received_ms=100,
            aborted_send_not_received_ms=250) for v in ['1.0', '1.1', '1.2']]
        controls = [dict(name=name, status='PASSED', connects=0) for name in
            ['missing-credentials', 'incorrect-credentials', 'wrong-tls-hostname', 'untrusted-tls-ca']]
        report = dict(status='PASSED', tls=True, results=versions + controls)
        runner.validate_interop(report, True)
        report['results'].append({'name': 'extra', 'status': 'FAILED'})
        with self.assertRaises(RuntimeError):
            runner.validate_interop(report, True)
        report['results'].pop()
        controls[-1]['connects'] = False
        with self.assertRaises(RuntimeError):
            runner.validate_interop(report, True)
        controls[-1]['connects'] = 0
        with self.assertRaises(RuntimeError):
            runner.validate_interop(report, False)
        versions[0]['abrupt_disconnect_no_replay'] = False
        with self.assertRaises(RuntimeError):
            runner.validate_interop(report, True)
        versions[0]['abrupt_disconnect_no_replay'] = True
        versions[0]['committed_send_received'] = 'true'
        with self.assertRaises(RuntimeError):
            runner.validate_interop(report, True)

    def test_demo_evidence_requires_real_drop_and_cleanup_counters(self):
        report = dict(status='PASSED', version='1.2', tls_verified=True, wrong_credentials_rejected=True,
            commit_delivered=True, sender_closed=True, no_automatic_replay=True, upstreamTlsVerified=True,
            relay_closed=True, acceptedConnections=1, forwardedSends=1, droppedReceipts=1,
            relay_open_sockets_after_cleanup=0, abort_not_delivered_ms=150, elapsed_ms=1000,
            receipt_error=dict(code='STOMP_RECEIPT_TIMEOUT', operation='SEND', outcomeUnknown=True),
            credentials_in_public_output=False, steps=[dict(name=name, status='PASSED') for name in
                ['tls-authentication', 'transactions', 'unknown-no-replay']])
        runner.validate_demo(report)
        for field, invalid in [('forwardedSends', 2), ('droppedReceipts', True), ('relay_closed', False),
                               ('elapsed_ms', 180000), ('credentials_in_public_output', True)]:
            bad = dict(report, **{field: invalid})
            with self.subTest(field=field), self.assertRaises(RuntimeError):
                runner.validate_demo(bad)

    def test_demo_requires_all_three_explanatory_stages(self):
        with self.assertRaises(RuntimeError):
            runner.validate_demo(dict(status='PASSED'))

    def test_wrong_and_extra_actual_listeners_rejected(self):
        good = 'java 123 user 12u IPv4 123 0t0 TCP 127.0.0.1:62614 (LISTEN)\n'
        runner.validate_listeners(good, 62614)
        for text in ['', good.replace('127.0.0.1', '*'), good.replace('62614', '62615'), good + good]:
            with self.subTest(text=text), self.assertRaises(RuntimeError):
                runner.validate_listeners(text, 62614)


if __name__ == '__main__':
    unittest.main()
