'use strict';
// Generated MoonBit bridge and scripted numeric-loopback peer, not a broker.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {fixture} = require('./review30-peer.cjs');
const {protocol} = require('../transport/tcp.cjs');

const malformed = [
  ['missing pair', () => new Array(1)],
  ['missing name', () => [[, 'value']]],
  ['missing value', () => [['name', ,]]],
];
function withDestination(headers) {
  const result = [['destination', '/q']];
  result.length += headers.length;
  for (let i = 0; i < headers.length; i++) {
    if (i in headers) result[i + 1] = headers[i];
  }
  return result;
}

for (const version of ['1.0', '1.1', '1.2']) {
  for (const operation of ['receipt', 'sendAsync', 'subscribe', 'transaction']) {
    test(`${version} ${operation}: sparse headers rejected before session mutation or write`, async () => {
      await fixture(version, async (client, peer, seen) => {
        const tx = operation === 'transaction' ? await client.beginTransaction() : null;
        const before = seen.length;
        for (const [label, create] of malformed) {
          const headers = create();
          if (operation === 'receipt') {
            await assert.rejects(client.receipt('SEND', withDestination(headers)),
              e => e.code === 'STOMP_RECEIPT_FAILED' && e.outcomeUnknown === false, label);
          } else if (operation === 'sendAsync') {
            await assert.rejects(client.sendAsync('/q', Buffer.alloc(0), {headers}),
              e => e.code === 'STOMP_ARGUMENT' && e.outcomeUnknown === false, label);
          } else if (operation === 'subscribe') {
            await assert.rejects(client.subscribe('/q', {headers}), e => e.code === 'STOMP_HANDLE', label);
          } else {
            assert.throws(() => tx.send('/q', Buffer.alloc(0), headers), e => e.code === 'STOMP_HANDLE', label);
            assert.equal(tx.state, 'open');
          }
          assert.equal(client.state(), 'active', label);
          assert.equal(client.pendingSends, 0);
          assert.equal(client.pendingSendBytes, 0);
          assert.equal(client.waiters.length, 0);
        }
        // A confirmed valid command proves the connection remains usable and
        // fences any unexpected prior frame on the same ordered transport.
        await client.receipt('SEND', [['destination', '/q'], ['valid', '']], Buffer.from('valid'));
        assert.deepEqual(seen.slice(before).map(f => f.command), ['SEND']);
        if (tx) await tx.abort();
      });
    });
  }
}

test('bridge rejects sparse header pairs as arguments without changing a fresh core', () => {
  for (const [label, create] of malformed) {
    const client = protocol.create();
    assert.throws(() => protocol.send(client, 'CONNECT', create(), Buffer.alloc(0), 0n),
      e => e.code === 'STOMP_ARGUMENT', label);
    assert.equal(protocol.state(client), 'fresh');
  }
});

test('async SEND rejects an oversized header array before inspecting its entries', async () => {
  await fixture('1.2', async (client, peer, seen) => {
    const headers = new Array(127).fill(['valid', 'value']);
    let reads = 0;
    Object.defineProperty(headers, 0, {get() { reads++; throw Error('must not inspect over-budget entries'); }});
    const before = seen.length;
    await assert.rejects(client.sendAsync('/q', Buffer.alloc(0), {headers}), e => e.code === 'STOMP_ARGUMENT');
    assert.equal(reads, 0);
    assert.equal(client.state(), 'active');
    assert.equal(client.pendingSends, 0);
    await client.receipt('SEND', [['destination', '/q']]);
    assert.deepEqual(seen.slice(before).map(f => f.command), ['SEND']);
  });
});
