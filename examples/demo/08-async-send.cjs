'use strict';
// Unpublished source example: real loopback TCP with an in-memory test peer.
// No persistence, production traffic, TLS or slow-reader claim.
const assert = require('node:assert/strict');
const {startDemoBroker} = require('../../tools/demo-broker.cjs');
const TcpClient = require('../../tools/load-adapter.cjs').loadTcpClient();

async function main() {
  const broker = await startDemoBroker();
  let client;
  try {
    client = new TcpClient({host: broker.host, port: broker.port,
      maxPendingSends: 3, maxPendingSendBytes: 4096, maxSendFrameBytes: 1024});
    await client.connect({versions: ['1.2'], heartbeat: '0,0'});
    const subscription = await client.subscribe('/queue/sample-batch');
    const records = ['sample-1', 'sample-2', 'sample-3'];
    // Bound the application batch too: do not materialize an unbounded list of
    // promises/bodies just because the transport queue has its own limits.
    const results = await Promise.allSettled(records.map(record =>
      client.sendAsync(subscription.destination, Buffer.from(record), {timeoutMs: 2000})));
    let failed = false;
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === 'rejected') {
        failed = true;
        console.error(`${records[i]}: ${result.reason.code}; outcomeUnknown=${result.reason.outcomeUnknown}`);
        // false = no socket.write attempt; true = broker outcome unknown.
        // Keep the per-record decision for the caller; never replay the batch.
      } else {
        assert.equal(result.value.localWriteComplete, true);
        assert.equal(result.value.brokerReceipt, false);
      }
    }
    if (failed) throw new Error('inspect per-record results; no automatic resend');
    assert.equal(client.pendingSends, 0);
    assert.equal(client.pendingSendBytes, 0);
    console.log('local      3 writes completed; broker receipts not requested');

    const received = [];
    for (const record of records) {
      const message = await subscription.next(2000);
      received.push(Buffer.from(message.body).toString('utf8'));
    }
    assert.deepEqual(received, records);
    assert.equal(broker.received.filter(command => command === 'SEND').length, 3);
    console.log('observed   sample-1,sample-2,sample-3 in order at the demo subscriber');
    // Control operations start only after all SEND promises have settled.
    // receipt('SEND', ...) here would send a fourth message, not confirm these.
    await subscription.unsubscribe();
    await client.disconnect();
  } finally {
    client?.stop();
    await broker.close();
  }
  console.log('cleanup    client closed and demo listener stopped');
  console.log('PASS async-send (unpublished source; demo peer only)');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
