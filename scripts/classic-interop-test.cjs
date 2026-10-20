'use strict';
// Real authenticated ActiveMQ Classic profile, started by classic-run.py.
const assert = require('node:assert/strict');
const {TcpClient} = require('../transport/tcp.cjs');
const options = {host: '127.0.0.1', port: Number(process.env.STOMP_PORT)};
if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) throw new Error('explicit loopback port required');
const credentials = {login: 'moonstomp-test', passcode: 'loopback-test-only', heartbeat: '0,0'};
const results = [];
(async () => {
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
      const destination = `/queue/moonstomp-classic-${version}-${process.pid}-${Date.now()}`;
      const sub = await client.subscribe(destination, {ack: version === '1.0' ? 'client' : 'client-individual'});
      const committed = await client.beginTransaction();
      committed.send(destination, Buffer.from([65, 0, 255, 13, 10]), [['content-type', 'application/octet-stream']]);
      await committed.commit();
      const message = await sub.next(); assert.deepEqual(message.body, [65, 0, 255, 13, 10]); sub.ack(message);
      const aborted = await client.beginTransaction(); aborted.send(destination, Buffer.from('must-not-arrive')); await aborted.abort();
      await assert.rejects(sub.next(250), /event timeout/);
      await client.receipt('SEND', [['destination', destination]], Buffer.from('after-abort'));
      const after = await sub.next(); assert.equal(Buffer.from(after.body).toString(), 'after-abort');
      if (version === '1.0') sub.ack(after); else sub.nack(after);
      await sub.unsubscribe(); await client.disconnect();
      results.push({version, status: 'PASSED', authenticated: true, actual_version: version,
        binary_octets: 5, scoped_subscription: true, versioned_ack: true, nack_sent: version !== '1.0',
        committed_send_received: true, aborted_send_not_received_ms: 250, unsubscribe_disconnect_receipts: true});
    } finally { client.stop(); }
  }
  console.log(JSON.stringify({status: 'PASSED', broker: 'Apache ActiveMQ Classic 6.3.2', results,
    scope: 'numeric-loopback authenticated profile; no TLS or transactional-ACK claim'}, null, 2));
})().catch(error => { console.error(JSON.stringify({status: 'FAILED', results, error: error.message, code: error.code}, null, 2)); process.exitCode = 1; });
