'use strict';
const assert = require('node:assert/strict');
const net = require('node:net');
const {TcpClient} = require('../transport/tcp.cjs');
const {Subscription} = require('../transport/handles.cjs');

async function wireCase(version, mode) {
  let peer;
  const sockets = new Set();
  const server = net.createServer(socket => {
    peer = socket; sockets.add(socket); socket.on('error', () => {});
    socket.on('close', () => sockets.delete(socket));
    let pending = '';
    socket.on('data', chunk => {
      pending += chunk;
      while (pending.includes('\0')) {
        const end = pending.indexOf('\0');
        const frame = pending.slice(0, end); pending = pending.slice(end + 1);
        if (frame.startsWith('CONNECT\n')) {
          socket.write(`CONNECTED\n${version === '1.0' ? '' : `version:${version}\n`}\n\0`);
        } else {
          const id = frame.match(/\nreceipt:([^\n]+)/)?.[1];
          if (id) socket.write(`RECEIPT\nreceipt-id:${id}\n\n\0`);
        }
      }
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const client = new TcpClient({port: server.address().port, controlTimeoutMs: 1000});
  try {
    await client.connect({versions: [version], heartbeat: '0,0'});
    const destination = mode === 'mapped' ? '/topic/prefix.*' : '/queue/shared';
    const a = await client.subscribe(destination, {id: 'A'});
    if (mode === 'overlap') {
      const b = await client.subscribe(destination, {id: 'B'});
      const waitingA = a.next(150).then(() => 'wrong', () => 'timeout');
      const waitingB = b.next(1000);
      peer.write('MESSAGE\nmessage-id:m1\nsubscription:B\ndestination:/queue/shared\n\nB-only\0');
      assert.equal(Buffer.from((await waitingB).body).toString(), 'B-only');
      assert.equal(await waitingA, 'timeout');
    } else {
      const next = a.next(1000);
      const subscription = mode === 'legacy' ? '' : 'subscription:A\n';
      const target = mode === 'mapped' ? '/topic/prefix.actual' : destination;
      peer.write(`MESSAGE\nmessage-id:m2\n${subscription}destination:${target}\n\nA-only\0`);
      assert.equal(Buffer.from((await next).body).toString(), 'A-only');
    }
    assert.equal(client.state(), 'active');
  } finally {
    client.stop(); for (const socket of sockets) socket.destroy();
    await new Promise(resolve => server.close(resolve));
  }
}

async function predicateControls(version) {
  // Isolated controls ensure an explicit unknown/empty ID never falls back.
  const client = {state: () => 'active', version: () => version,
    _waitFor: async predicate => {
      const event = headers => ({event: 'message', frame: {headers}});
      const destination = ['destination', '/queue/shared'];
      assert.equal(predicate(event([destination, ['subscription', 'unknown']])), false);
      assert.equal(predicate(event([destination, ['subscription', '']])), false);
      assert.equal(predicate(event([destination])), version === '1.0');
      assert.equal(predicate({event: 'receipt'}), false);
      assert.equal(predicate(event([['destination', '/other'], ['subscription', 'A']])), true);
      return event([destination, ['subscription', 'A']]);
    }};
  await new Subscription(client, 'A', '/queue/shared', 'auto').next();
}

(async () => {
  for (const version of ['1.0', '1.1', '1.2']) {
    await wireCase(version, 'overlap');
    await wireCase(version, 'mapped');
    await predicateControls(version);
  }
  await wireCase('1.0', 'legacy');
  console.log('PASS 7 real TCP subscription identity cases and 3 isolated predicate controls');
})().catch(error => { console.error(error); process.exitCode = 1; });
