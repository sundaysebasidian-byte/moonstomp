#!/usr/bin/env python3
"""Export assertion fields only; never copy broker profiles, frames or logs."""
import argparse
import importlib.util
import json
import math
from pathlib import Path

spec = importlib.util.spec_from_file_location('classic_runner', Path(__file__).with_name('classic-run.py'))
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--matrix', type=Path, required=True)
    parser.add_argument('--demo', type=Path, required=True)
    parser.add_argument('--heartbeat', type=Path)
    parser.add_argument('--heartbeat1000', type=Path)
    parser.add_argument('--soak', type=Path)
    parser.add_argument('--resources', type=Path)
    parser.add_argument('--async-send', type=Path)
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
    for name, directory in [('heartbeat', args.heartbeat), ('heartbeat1000', args.heartbeat1000), ('soak', args.soak), ('async_send', args.async_send)]:
        if directory is None:
            continue
        report['scope'] = 'Classic TLS matrix, receipt-loss demo and requested heartbeat/load/async checks'
        path = directory / 'classic.json'
        if not path.is_file():
            report[name] = {'status': 'missing'}
            passed.append(False)
            continue
        raw = json.loads(path.read_text())
        safe = {key: raw[key] for key in ['status', 'broker', 'tls', 'mode', 'port_closed', 'elapsed_ms',
                'heartbeat_fixture_sha256', 'soak_fixture_sha256'] if key in raw}
        safe['private_key_removed'] = raw.get('private_key_removed') is True and not (directory / 'profile/conf/broker.p12').exists()
        good = raw.get('status') == 'PASSED' and raw.get('tls') is True and raw.get('port_closed') is True and safe['private_key_removed']
        data = raw.get('heartbeat' if name == 'heartbeat1000' else name, {})
        if name in ['heartbeat', 'heartbeat1000']:
            allowed = ['status', 'tls', 'version', 'real_broker', 'client_heartbeats', 'broker_heartbeats',
                       'dropped_broker_bytes', 'heartbeat_timeout', 'connections', 'no_reconnect',
                       'open_relay_sockets', 'business_SENDs', 'upstream_tls_verified',
                       'negotiated_period_ms', 'broker_heartbeat_header', 'broker_total_eols', 'excluded_early_eols', 'idle_window_after_ms']
            good = good and all(data.get(k) is True for k in ['tls', 'real_broker', 'heartbeat_timeout', 'no_reconnect', 'upstream_tls_verified'])
            good = good and data.get('status') == 'PASSED' and all(type(data.get(k)) is int and data[k] == expected for k, expected in [('connections', 1), ('business_SENDs', 0), ('open_relay_sockets', 0)])
            good = good and all(type(data.get(k)) is int and data[k] >= minimum for k, minimum in [('client_heartbeats', 2), ('broker_heartbeats', 2), ('dropped_broker_bytes', 1)])
            if name == 'heartbeat1000':
                good = good and type(data.get('negotiated_period_ms')) is int and data['negotiated_period_ms'] == 1000 and data.get('broker_heartbeat_header') == '1000,1000'
                good = good and type(data.get('idle_window_after_ms')) is int and data['idle_window_after_ms'] == 1000
        elif name == 'soak':
            allowed = ['status', 'diagnostic', 'elapsed_ms', 'target_active_rate_per_second', 'attempted_sends',
                       'outcome_unknown', 'sent', 'received', 'acked', 'receipts', 'errors', 'timeouts', 'duplicates',
                       'unique_payloads', 'expected_negative_observation_timeouts', 'outgoing_heartbeats',
                       'incoming_heartbeats', 'latency_scope', 'cleanup']
            count = data.get('sent')
            good = good and data.get('status') == 'PASSED' and data.get('diagnostic') is False and data.get('cleanup') is True
            duration = data.get('elapsed_ms')
            good = good and type(duration) in (int, float) and (type(duration) is int or math.isfinite(duration)) and duration >= 300000
            good = good and type(count) is int and count > 0 and all(type(data.get(k)) is int and data[k] == count for k in ['attempted_sends', 'received', 'acked', 'receipts', 'unique_payloads'])
            good = good and all(type(data.get(k)) is int and data[k] == 0 for k in ['outcome_unknown', 'errors', 'timeouts', 'duplicates'])
            windows = data.get('idle_windows', [])
            good = good and len(windows) == 5 and all(type(w.get(k)) is int and w[k] > 0 for w in windows for k in ['outgoing_delta', 'incoming_delta'])
            safe['idle_windows'] = [{k: w[k] for k in ['window', 'start_ms', 'end_ms', 'outgoing_delta', 'incoming_delta'] if k in w} for w in windows]
            safe['latency_ms'] = {k: data.get('latency_ms', {})[k] for k in ['mean', 'max'] if k in data.get('latency_ms', {})}
        else:
            allowed = ['status', 'tls_verified', 'version', 'async_local_writes',
                       'observed_ordered_deliveries', 'separate_broker_receipt', 'no_automatic_replay']
            good = good and data.get('status') == 'PASSED' and data.get('version') == '1.2'
            good = good and all(data.get(k) is True for k in ['tls_verified', 'separate_broker_receipt', 'no_automatic_replay'])
            good = good and type(data.get('async_local_writes')) is int and data['async_local_writes'] == 16
            good = good and type(data.get('observed_ordered_deliveries')) is int and data['observed_ordered_deliveries'] == 17
        safe['assertions'] = {key: data[key] for key in allowed if key in data}
        report[name] = safe
        passed.append(good)
    if args.resources is not None:
        path = args.resources / 'summary.json'
        resource = json.loads(path.read_text()) if path.is_file() else {}
        report['resources'] = {key: resource[key] for key in ['status', 'exit_code', 'stop_reason', 'elapsed_seconds',
                'sampled_process_tree_rss_peak_bytes', 'rss_limit_bytes', 'note'] if key in resource}
        passed.append(resource.get('status') == 'passed' and type(resource.get('exit_code')) is int and resource['exit_code'] == 0 and resource.get('stop_reason') is None)
    report['status'] = 'passed' if all(passed) else 'failed'
    try:
        text = json.dumps(report, indent=2, allow_nan=False)
    except ValueError:
        # Fail closed rather than export non-standard JSON or claim a successful
        # run with non-finite whitelisted measurements (including outer metadata).
        report = {'status': 'failed', 'error': 'non-finite numeric value in exported evidence'}
        text = json.dumps(report, indent=2)
    (args.output / 'summary.json').write_text(text)
    return 0 if report['status'] == 'passed' else 1


if __name__ == '__main__':
    raise SystemExit(main())
