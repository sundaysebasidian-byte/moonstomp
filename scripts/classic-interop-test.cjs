'use strict';
// Real authenticated ActiveMQ Classic profile, started by classic-run.py.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {TcpClient} = require('../transport/tcp.cjs');
const options = {host: '127.0.0.1', port: Number(process.env.STOMP_PORT)};
if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) throw new Error('explicit loopback port required');
const tlsEnabled = Boolean(process.env.STOMP_TLS_CA);
if (tlsEnabled) options.tlsOptions = {ca: fs.readFileSync(process.env.STOMP_TLS_CA), servername: 'localhost'};
const credentials = {login: 'moonstomp-test', passcode: 'loopback-test-only', heartbeat: '0,0'};
const results = [];
(async () => {
  if (tlsEnabled) {
    for (const tlsOptions of [{servername: 'localhost'}, {ca: options.tlsOptions.ca, servername: 'wrong.invalid'}]) {
      const untrusted = new TcpClient({...options, tlsOptions}); let connects = 0;
      const send = untrusted.send.bind(untrusted);
      untrusted.send = (...args) => { if (args[0] === 'CONNECT') connects++; return send(...args); };
      try {
        await assert.rejects(untrusted.connect(credentials), error => /CERT|SELF_SIGNED/.test(error.code));
        assert.equal(connects, 0); assert.equal(untrusted.state(), 'closed');
        results.push({name: tlsOptions.ca ? 'wrong-tls-hostname' : 'untrusted-tls-ca', status: 'PASSED', connects: 0});
      } finally { untrusted.stop(); }
    }
  }
  const anonymous = new TcpClient(options);
  try {
    await assert.rejects(anonymous.connect({heartbeat: '0,0'}), error => error.code === 'STOMP_BROKER_ERROR');
    assert.equal(anonymous.state(), 'closed');
    results.push({name: 'missing-credentials', status: 'PASSED'});
  } finally { anonymous.stop(); }
  const bad = new TcpClient(options);
  try {
    await assert.rejects(bad.connect({...credentials, passcode: 'deliberately-wrong'}), error => error.code === 'STOMP_BROKER_ERROR' && error.frame.command === 'ERROR');
    assert.equal(bad.state(), 'closed');
    results.push({name: 'incorrect-credentials', status: 'PASSED', structured_broker_error: true});
  } finally { bad.stop(); }
  for (const version of ['1.0', '1.1', '1.2']) {
    const client = new TcpClient(options);
    try {
      await client.connect({...credentials, versions: [version], virtualHost: 'localhost'});
      assert.equal(client.version(), version);
      if (tlsEnabled) assert.equal(client.socket.authorized, true);
      const destination = `/queue/moonstomp-classic-${version}-${process.pid}-${Date.now()}`;
      const sub = await client.subscribe(destination, {ack: version === '1.0' ? 'client' : 'client-individual'});
      const committed = await client.beginTransaction();
      committed.send(destination, Buffer.from([65, 0, 255, 13, 10]), [['content-type', 'application/octet-stream']]);
      // Bounded negative observation plus the positive post-COMMIT delivery below.
      await assert.rejects(sub.next(100), error => error.code === 'STOMP_EVENT_TIMEOUT');
      assert.equal(client.state(), 'active');
      await committed.commit();
      const message = await sub.next(); assert.deepEqual(message.body, [65, 0, 255, 13, 10]); sub.ack(message);
      const aborted = await client.beginTransaction(); aborted.send(destination, Buffer.from('must-not-arrive')); await aborted.abort();
      await assert.rejects(sub.next(250), /event timeout/);
      await client.receipt('SEND', [['destination', destination]], Buffer.from('after-abort'));
      const after = await sub.next(); assert.equal(Buffer.from(after.body).toString(), 'after-abort');
      if (version === '1.0') sub.ack(after); else sub.nack(after);
      // A broker-confirmed transactional SEND must not become visible when its
      // owning connection is lost before COMMIT. No reconnect/replay is attempted.
      const doomed = new TcpClient(options);
      try {
        await doomed.connect({...credentials, versions: [version]});
        const pending = await doomed.beginTransaction();
        await doomed.receipt('SEND', [['destination', destination], ['transaction', pending.id]],
          Buffer.from('disconnect-before-commit'));
        await assert.rejects(sub.next(100), error => error.code === 'STOMP_EVENT_TIMEOUT');
        const waiting = doomed.waitFor(() => false, 1000); waiting.catch(() => {});
        doomed.stop();
        await assert.rejects(waiting, error => error.code === 'STOMP_CONNECTION_CLOSED');
        assert.equal(doomed.state(), 'closed'); assert.equal(pending.state, 'failed');
        assert.equal(doomed.timer, null); assert.equal(doomed.waiters.length, 0);
        assert.equal(doomed.socket.destroyed, true);
        const written = doomed.socket.bytesWritten;
        await assert.rejects(pending.commit(), /not open/);
        await assert.rejects(doomed.receipt('SEND', [['destination', destination]]));
        assert.equal(doomed.socket.bytesWritten, written);
      } finally { doomed.stop(); }
      await client.receipt('SEND', [['destination', destination]], Buffer.from('after-disconnect'));
      const marker = await sub.next(); assert.equal(Buffer.from(marker.body).toString(), 'after-disconnect');
      sub.ack(marker);
      await assert.rejects(sub.next(100), error => error.code === 'STOMP_EVENT_TIMEOUT');
      await sub.unsubscribe(); await client.disconnect();
      results.push({version, status: 'PASSED', authenticated: true, actual_version: version,
        tls_verified: tlsEnabled, precommit_not_received_ms: 100, binary_octets: 5, scoped_subscription: true, versioned_ack: true, nack_sent: version !== '1.0',
        abrupt_disconnect_no_replay: true, uncommitted_send_not_received_after_disconnect_ms: 100,
        committed_send_received: true, aborted_send_not_received_ms: 250, unsubscribe_disconnect_receipts: true});
    } finally { client.stop(); }
  }
  console.log(JSON.stringify({status: 'PASSED', broker: 'Apache ActiveMQ Classic 6.3.2', results,
    tls: tlsEnabled, scope: 'numeric-loopback authenticated profile; TLS only when STOMP_TLS_CA is set; transactional ACK rollback not claimed'}, null, 2));
})().catch(error => { console.error(JSON.stringify({status: 'FAILED', results, error: error.message, code: error.code}, null, 2)); process.exitCode = 1; });
