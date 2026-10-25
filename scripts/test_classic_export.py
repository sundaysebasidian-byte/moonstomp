"""Synthetic offline export controls; these never launch a broker."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).with_name('export_classic_evidence.py')


class ExportControls(unittest.TestCase):
    def fixture(self):
        versions = [dict(version=v, actual_version=v, status='PASSED', tls_verified=True,
            authenticated=True, versioned_ack=True, committed_send_received=True,
            unsubscribe_disconnect_receipts=True, abrupt_disconnect_no_replay=True,
            uncommitted_send_not_received_after_disconnect_ms=100, binary_octets=5,
            precommit_not_received_ms=100, aborted_send_not_received_ms=250)
            for v in ['1.0', '1.1', '1.2']]
        controls = [dict(name=name, status='PASSED', connects=0) for name in
                    ['missing-credentials', 'incorrect-credentials', 'wrong-tls-hostname', 'untrusted-tls-ca']]
        demo = dict(status='PASSED', version='1.2', tls_verified=True,
            wrong_credentials_rejected=True, commit_delivered=True, sender_closed=True,
            no_automatic_replay=True, upstreamTlsVerified=True, relay_closed=True,
            acceptedConnections=1, forwardedSends=1, droppedReceipts=1,
            relay_open_sockets_after_cleanup=0, abort_not_delivered_ms=150, elapsed_ms=1000,
            credentials_in_public_output=False,
            receipt_error=dict(code='STOMP_RECEIPT_TIMEOUT', operation='SEND', outcomeUnknown=True),
            steps=[dict(name=n, status='PASSED') for n in
                   ['tls-authentication', 'transactions', 'unknown-no-replay']])
        common = dict(status='PASSED', broker='ActiveMQ Classic 6.3.2', tls=True,
                      port_closed=True, raw_frame='synthetic-do-not-export',
                      broker_command=['synthetic-private-command'])
        return dict(common, interop=dict(status='PASSED', tls=True, results=versions+controls)), dict(common, demo=demo)

    def invoke(self, root, matrix, demo, extra=None):
        documents = dict(matrix=matrix, demo=demo, **(extra or {}))
        for name, content in documents.items():
            folder = root/name
            folder.mkdir()
            if content is None:
                continue
            (folder/('summary.json' if name == 'resources' else 'classic.json')).write_text(json.dumps(content))
        output = root/'public'
        flags = [arg for name in (extra or {}) for arg in ['--'+name, str(root/name)]]
        result = subprocess.run([sys.executable, str(SCRIPT), '--matrix', str(root/'matrix'),
                                 '--demo', str(root/'demo'), *flags, '--output', str(output)], capture_output=True)
        return result, (output/'summary.json').read_text()

    def test_only_whitelisted_assertions_exported(self):
        with tempfile.TemporaryDirectory() as temp:
            result, output = self.invoke(Path(temp), *self.fixture())
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(json.loads(output)['status'], 'passed')
            for marker in ['raw_frame', 'broker_command', 'synthetic-do-not-export', 'synthetic-private-command']:
                self.assertNotIn(marker, output)

    def test_open_port_never_becomes_success(self):
        matrix, demo = self.fixture()
        matrix['port_closed'] = False
        with tempfile.TemporaryDirectory() as temp:
            result, output = self.invoke(Path(temp), matrix, demo)
            self.assertEqual(result.returncode, 1)
            self.assertEqual(json.loads(output)['status'], 'failed')

    def test_second_heartbeat_period_is_required_and_whitelisted(self):
        common = dict(status='PASSED', tls=True, port_closed=True, private_key_removed=True)
        heartbeat = dict(status='PASSED', tls=True, real_broker=True, heartbeat_timeout=True,
                         no_reconnect=True, upstream_tls_verified=True, connections=1,
                         business_SENDs=0, open_relay_sockets=0, client_heartbeats=2,
                         broker_heartbeats=4, dropped_broker_bytes=2, negotiated_period_ms=1000,
                         broker_heartbeat_header='1000,1000', idle_window_after_ms=1000,
                         broker_total_eols=5, excluded_early_eols=1,
                         raw_frame='synthetic-do-not-export')
        for failure in [None, 'period', 'header', 'cleanup', 'missing']:
            candidate = dict(common, heartbeat=dict(heartbeat))
            if failure == 'period': candidate['heartbeat']['negotiated_period_ms'] = 100
            if failure == 'header': candidate['heartbeat']['broker_heartbeat_header'] = '100,100'
            if failure == 'cleanup': candidate['private_key_removed'] = False
            if failure == 'missing': candidate = None
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as temp:
                result, output = self.invoke(Path(temp), *self.fixture(), extra={'heartbeat1000': candidate})
                self.assertEqual(result.returncode, 0 if failure is None else 1, result.stderr)
                self.assertEqual(json.loads(output)['status'], 'passed' if failure is None else 'failed')
                self.assertNotIn('synthetic-do-not-export', output)

    def test_missing_tls_negative_control_fails(self):
        matrix, demo = self.fixture()
        matrix['interop']['results'].pop()
        with tempfile.TemporaryDirectory() as temp:
            result, output = self.invoke(Path(temp), matrix, demo)
            self.assertEqual(result.returncode, 1)
            self.assertEqual(json.loads(output)['status'], 'failed')

    def test_new_modes_cannot_export_sensitive_data_or_short_run_success(self):
        common = dict(status='PASSED', tls=True, port_closed=True, private_key_removed=True,
                      broker_command='synthetic-private-command')
        heartbeat = dict(status='PASSED', tls=True, real_broker=True, heartbeat_timeout=True,
                         no_reconnect=True, upstream_tls_verified=True, connections=1,
                         business_SENDs=0, open_relay_sockets=0, client_heartbeats=2,
                         broker_heartbeats=2, dropped_broker_bytes=1, raw_frame='synthetic-do-not-export')
        soak = dict(status='PASSED', diagnostic=False, cleanup=True, elapsed_ms=300001,
                    sent=2, attempted_sends=2, received=2, acked=2, receipts=2, unique_payloads=2,
                    errors=0, timeouts=0, duplicates=0, outcome_unknown=0,
                    heartbeatTimes='synthetic-do-not-export',
                    latency_ms=dict(mean=1, max=2, raw_frame='synthetic-do-not-export'),
                    idle_windows=[dict(window=i, outgoing_delta=1, incoming_delta=1,
                                       raw_frame='synthetic-do-not-export') for i in range(5)])
        resources = dict(status='passed', exit_code=0, stop_reason=None,
                         command='synthetic-private-command')
        extra = dict(heartbeat=dict(common, heartbeat=heartbeat), soak=dict(common, soak=soak), resources=resources)
        for failure in [None, 'duration', 'key', 'resources']:
            candidate = json.loads(json.dumps(extra))
            if failure == 'duration': candidate['soak']['soak']['elapsed_ms'] = 6500
            if failure == 'key': candidate['heartbeat']['private_key_removed'] = False
            if failure == 'resources': candidate['resources']['status'] = 'partial/failed'
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as temp:
                result, output = self.invoke(Path(temp), *self.fixture(), extra=candidate)
                self.assertEqual(result.returncode, 0 if failure is None else 1, result.stderr)
                for marker in ['synthetic-private-command', 'synthetic-do-not-export', 'heartbeatTimes']:
                    self.assertNotIn(marker, output)


if __name__ == '__main__':
    unittest.main()
