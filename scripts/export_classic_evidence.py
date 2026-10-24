#!/usr/bin/env python3
"""Export assertion fields only; never copy broker profiles, frames or logs."""
import argparse
import importlib.util
import json
from pathlib import Path

spec = importlib.util.spec_from_file_location('classic_runner', Path(__file__).with_name('classic-run.py'))
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--matrix', type=Path, required=True)
    parser.add_argument('--demo', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists():
        parser.error('Output must be new')
    args.output.mkdir(parents=True)
    report = {'status': 'failed', 'scope': 'Classic TLS matrix and receipt-loss demo; no heartbeat claim'}
    passed = []
    for name, directory in [('matrix', args.matrix), ('demo', args.demo)]:
        path = directory / 'classic.json'
        if not path.is_file():
            report[name] = {'status': 'missing'}
            passed.append(False)
            continue
        raw = json.loads(path.read_text())
        safe = {key: raw[key] for key in ['status', 'broker', 'tls', 'mode', 'port_closed', 'elapsed_ms'] if key in raw}
        safe['private_key_removed'] = not (directory / 'profile/conf/broker.p12').exists()
        good = raw.get('status') == 'PASSED' and raw.get('tls') is True and raw.get('port_closed') is True and safe['private_key_removed']
        if name == 'matrix':
            interop = raw.get('interop', {})
            allowed = ['name', 'status', 'version', 'actual_version', 'tls_verified', 'authenticated',
                       'versioned_ack', 'committed_send_received', 'unsubscribe_disconnect_receipts',
                       'abrupt_disconnect_no_replay', 'binary_octets', 'connects']
            rows = [{key: row[key] for key in allowed if key in row} for row in interop.get('results', [])]
            safe['results'] = rows
            try:
                runner.validate_interop(interop, True)
            except (RuntimeError, TypeError, KeyError):
                good = False
        else:
            demo = raw.get('demo', {})
            allowed = ['status', 'version', 'tls_verified', 'wrong_credentials_rejected', 'sender_closed',
                       'no_automatic_replay', 'forwardedSends', 'droppedReceipts', 'relay_closed',
                       'relay_open_sockets_after_cleanup', 'upstreamTlsVerified']
            safe['assertions'] = {key: demo[key] for key in allowed if key in demo}
            error = demo.get('receipt_error', {})
            safe['receipt_error'] = {key: error[key] for key in ['code', 'operation', 'outcomeUnknown'] if key in error}
            try:
                runner.validate_demo(demo)
            except (RuntimeError, TypeError, KeyError):
                good = False
        report[name] = safe
        passed.append(good)
    report['status'] = 'passed' if all(passed) else 'failed'
    (args.output / 'summary.json').write_text(json.dumps(report, indent=2))
    return 0 if report['status'] == 'passed' else 1


if __name__ == '__main__':
    raise SystemExit(main())
