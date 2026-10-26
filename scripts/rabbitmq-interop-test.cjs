'use strict';
// Real RabbitMQ STOMP plugin on numeric loopback, started by the broker workflow.
const assert = require('node:assert/strict');
const {TcpClient} = require('../transport/tcp.cjs');
const options = {host: '127.0.0.1', port: Number(process.env.STOMP_PORT || 61613)};
const credentials = {login: process.env.STOMP_LOGIN, passcode: process.env.STOMP_PASSCODE, virtualHost: '/'};
if (!credentials.login || !credentials.passcode) throw new Error('STOMP_LOGIN and STOMP_PASSCODE required');
const header = (frame, name) => frame.headers.find(h => h[0] === name)?.[1];
const text = frame => Buffer.from(frame.body).toString();
const results = [];
(async () => {
  const bad = new TcpClient(options);
  try {
    await assert.rejects(bad.connect({...credentials, passcode: 'deliberately-wrong'}),
      error => error.code === 'STOMP_BROKER_ERROR' && error.frame.command === 'ERROR');
    assert.equal(bad.state(), 'closed');
    results.push({name: 'incorrect-credentials', status: 'PASSED'});
  } finally { bad.stop(); }

  for (const version of ['1.0', '1.1', '1.2']) {
    const client = new TcpClient(options);
    try {
      await client.connect({...credentials, versions: [version], heartbeat: '0,0'});
      assert.equal(client.version(), version);
      const destination = `/queue/moonstomp-rabbitmq-${version}-${process.pid}-${Date.now()}`;
      const sub = await client.subscribe(destination, {ack: version === '1.0' ? 'client' : 'client-individual'});

      // Binary body with NUL and CR/LF needs content-length on the wire.
      const label = version === '1.0' ? 'plain' : 'colon:a\\b line';
      await client.receipt('SEND', [['destination', destination], ['x-label', label]], Buffer.from([65, 0, 255, 13, 10]));
      const binary = await sub.next();
      assert.deepEqual(binary.body, [65, 0, 255, 13, 10]);
      assert.equal(header(binary, 'x-label'), label);
      sub.ack(binary);

      const committed = await client.beginTransaction();
      committed.send(destination, Buffer.from('committed'));
      await assert.rejects(sub.next(300), error => error.code === 'STOMP_EVENT_TIMEOUT');
      await committed.commit();
      const afterCommit = await sub.next();
      assert.equal(text(afterCommit), 'committed');
      sub.ack(afterCommit);

      const aborted = await client.beginTransaction();
      aborted.send(destination, Buffer.from('must-not-arrive'));
      await aborted.abort();
      await client.receipt('SEND', [['destination', destination]], Buffer.from('after-abort'));
      const afterAbort = await sub.next();
      assert.equal(text(afterAbort), 'after-abort');

      let redelivered = false;
      if (version === '1.0') sub.ack(afterAbort);
      else {
        // RabbitMQ requeues on NACK by default, so the same body comes back.
        sub.nack(afterAbort);
        const again = await sub.next();
        assert.equal(text(again), 'after-abort');
        assert.equal(header(again, 'redelivered'), 'true');
        sub.ack(again);
        redelivered = true;
      }
      await assert.rejects(sub.next(300), error => error.code === 'STOMP_EVENT_TIMEOUT');
      await sub.unsubscribe();
      await client.disconnect();
      results.push({name: `stomp-${version}`, status: 'PASSED', binary_octets: 5, header_round_trip: true,
        transaction_commit: true, transaction_abort: true, nack_redelivered: redelivered});
    } finally { client.stop(); }
  }

  const beating = new TcpClient(options);
  try {
    await beating.connect({...credentials, versions: ['1.2'], heartbeat: '1000,1000'});
    for (let i = 0; i < 2; i++) await beating.waitFor(e => e.event === 'heartbeat', 5000);
    assert.equal(beating.state(), 'active');
    const destination = `/queue/moonstomp-rabbitmq-async-${process.pid}-${Date.now()}`;
    const sub = await beating.subscribe(destination);
    const sends = [];
    for (let i = 0; i < 20; i++) sends.push(beating.sendAsync(destination, Buffer.from(`async-${i}`)));
    await Promise.all(sends);
    for (let i = 0; i < 20; i++) assert.equal(text(await sub.next()), `async-${i}`);
    await sub.unsubscribe();
    await beating.disconnect();
    results.push({name: 'heartbeat-and-async-send', status: 'PASSED', server_heartbeats: 2, async_sends_in_order: 20});
  } finally { beating.stop(); }

  console.log(JSON.stringify({status: 'PASSED', broker: process.env.RABBITMQ_VERSION || 'RabbitMQ', results}, null, 2));
})().catch(error => {
  console.error(JSON.stringify({status: 'FAILED', results, error: error.message, code: error.code}, null, 2));
  process.exitCode = 1;
});
