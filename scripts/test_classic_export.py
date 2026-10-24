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

    def invoke(self, root, matrix, demo):
        for name, content in [('matrix', matrix), ('demo', demo)]:
            folder = root/name
            folder.mkdir()
            (folder/'classic.json').write_text(json.dumps(content))
        output = root/'public'
        result = subprocess.run([sys.executable, str(SCRIPT), '--matrix', str(root/'matrix'),
                                 '--demo', str(root/'demo'), '--output', str(output)], capture_output=True)
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

    def test_missing_tls_negative_control_fails(self):
        matrix, demo = self.fixture()
        matrix['interop']['results'].pop()
        with tempfile.TemporaryDirectory() as temp:
            result, output = self.invoke(Path(temp), matrix, demo)
            self.assertEqual(result.returncode, 1)
            self.assertEqual(json.loads(output)['status'], 'failed')


if __name__ == '__main__':
    unittest.main()
