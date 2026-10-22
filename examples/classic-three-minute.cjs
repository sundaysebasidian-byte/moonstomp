'use strict';
// One focused STOMP 1.2 demonstration. Requires classic-run.py --tls --demo.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {performance} = require('node:perf_hooks');
const {randomUUID} = require('node:crypto');
const {TcpClient, protocol} = require('../transport/tcp.cjs');
const {receiptLossRelay} = require('./receipt-loss-relay.cjs');
const started = performance.now();
const clients = new Set();
let relay, subscription, report;
const steps = [];
const stage = (name, text) => { steps.push({name, status: 'PASSED', text}); };
const credentials = {login: 'moonstomp-test', passcode: 'loopback-test-only', heartbeat: '0,0', versions: ['1.2']};
async function main() {
  const port = Number(process.env.STOMP_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535 || !process.env.STOMP_TLS_CA || !process.env.STOMP_DEMO_PFX)
    throw new Error('demo needs explicit runner TLS profile');
  const ca = fs.readFileSync(process.env.STOMP_TLS_CA);
  const options = {host: '127.0.0.1', port, tlsOptions: {ca, servername: 'localhost'}, controlTimeoutMs: 1500};
  const client = opts => { const c = new TcpClient(opts); clients.add(c); return c; };
  const bad = client(options);
  await assert.rejects(bad.connect({...credentials, passcode: 'deliberately-wrong'}), e => e.code === 'STOMP_BROKER_ERROR');
  assert.equal(bad.state(), 'closed');
  const observer = client(options); await observer.connect(credentials);
  assert.equal(observer.socket.authorized, true); assert.equal(observer.version(), '1.2');
  stage('tls-authentication', 'TLS certificate and hostname checked; wrong credentials rejected; authenticated session active.');

  const destination = '/queue/moonstomp-showcase-' + randomUUID();
  subscription = await observer.subscribe(destination, {ack: 'client-individual'});
  const aborted = await observer.beginTransaction(); aborted.send(destination, Buffer.from('cancelled-order')); await aborted.abort();
  const committed = await observer.beginTransaction(); committed.send(destination, Buffer.from('confirmed-order'));
  await assert.rejects(subscription.next(100), e => e.code === 'STOMP_EVENT_TIMEOUT');
  await committed.commit();
  const order = await subscription.next(); assert.equal(Buffer.from(order.body).toString(), 'confirmed-order'); subscription.ack(order);
  await assert.rejects(subscription.next(150), e => e.code === 'STOMP_EVENT_TIMEOUT');
  stage('transactions', 'COMMIT delivered confirmed-order; ABORT did not deliver cancelled-order; pre-COMMIT read stayed empty (100 ms).');

  const lostId = 'demo-lost-receipt';
  relay = await receiptLossRelay({brokerPort: port, ca, pfx: fs.readFileSync(process.env.STOMP_DEMO_PFX), receiptId: lostId,
    parse: bytes => JSON.parse(protocol.parse(bytes)[0])});
  const sender = client({...options, port: relay.port, controlTimeoutMs: 600}); await sender.connect(credentials);
  assert.equal(sender.socket.authorized, true);
  const received = subscription.next(2000); received.catch(() => {});
  const sent = sender.receipt('SEND', [['destination', destination]], Buffer.from('receipt-lost-order'), lostId); sent.catch(() => {});
  const observed = await received; assert.equal(Buffer.from(observed.body).toString(), 'receipt-lost-order'); subscription.ack(observed);
  let unknown;
  await assert.rejects(sent, e => {
    unknown = {code: e.code, outcomeUnknown: e.outcomeUnknown, operation: e.operation};
    return e.code === 'STOMP_RECEIPT_TIMEOUT' && e.outcomeUnknown === true && e.receiptId === lostId;
  });
  assert.equal(sender.state(), 'closed'); assert.equal(sender.timer, null); assert.equal(sender.waiters.length, 0);
  await assert.rejects(sender.receipt('SEND', [['destination', destination]], Buffer.from('must-not-resend')));
  await assert.rejects(subscription.next(150), e => e.code === 'STOMP_EVENT_TIMEOUT');
  assert.equal(relay.stats.upstreamTlsVerified, true); assert.equal(relay.stats.droppedReceipts, 1);
  assert.equal(relay.stats.forwardedSends, 1); assert.equal(relay.stats.acceptedConnections, 1);
  stage('unknown-no-replay', 'Observer received one order; relay dropped its real broker RECEIPT; sender timed out with unknown outcome, closed, and forwarded no resend.');
  await subscription.unsubscribe(); subscription = null; await observer.disconnect();
  report = {status: 'PASSED', version: '1.2', scope: 'real Classic 6.3.2, STOMP 1.2, loopback TLS on both relay legs; selected RECEIPT removed before sender decoder',
    steps, tls_verified: true, wrong_credentials_rejected: true, commit_delivered: true, abort_not_delivered_ms: 150,
    receipt_error: unknown, ...relay.stats, sender_closed: sender.state() === 'closed',
    no_automatic_replay: true, credentials_in_public_output: false,
    verification_boundary: 'focused demonstration only; does not rerun the three-version broker matrix; Wasm GC remains FAILED'};
}
(async () => {
  try { await main(); }
  catch (error) {
    // Never print raw broker ERROR, cause, credential fields or received bodies.
    report = {status: 'FAILED', stage: steps.length, code: /^[A-Z0-9_]+$/.test(error.code || '') ? error.code : 'DEMO_ASSERTION_OR_SETUP',
      steps, credentials_in_public_output: false};
    process.exitCode = 1;
  } finally {
    for (const c of clients) c.stop();
    if (relay) {
      try {
        report.relay_open_sockets_after_cleanup = await relay.close();
        report.relay_closed = report.relay_open_sockets_after_cleanup === 0;
      } catch { report.relay_closed = false; }
      if (!report.relay_closed) { report.status = 'FAILED'; process.exitCode = 1; }
    }
    report.elapsed_ms = Math.round(performance.now() - started);
    console.log(JSON.stringify(report, null, 2));
  }
})();
