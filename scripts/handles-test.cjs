'use strict';
// Scripted numeric-loopback peers: handle routing/lifecycle, not broker semantics.
const assert = require('node:assert/strict');
const net = require('node:net');
const {TcpClient, protocol} = require('../transport/tcp.cjs');
const {Transaction} = require('../transport/handles.cjs');
const header = (f, name) => f.headers.find(h => h[0] === name)?.[1];
async function check(version) {
  const frames = [], sockets = new Set(); let socket, counter = 0;
  const server = net.createServer(s => {
    socket = s; sockets.add(s); s.on('close', () => sockets.delete(s)); s.on('error', () => {});
    let bytes = Buffer.alloc(0);
    s.on('data', data => {
      bytes = Buffer.concat([bytes, data]);
      while (bytes.length) {
        if (bytes[0] === 10) { bytes = bytes.subarray(1); continue; }
        const headersEnd = bytes.indexOf('\n\n'); if (headersEnd < 0) break;
        const length = bytes.subarray(0, headersEnd).toString().match(/\ncontent-length:(\d+)/);
        const end = length ? headersEnd + 2 + Number(length[1]) : bytes.indexOf(0, headersEnd + 2);
        if (end < 0 || end >= bytes.length) break;
        const f = protocol.parse(bytes.subarray(0, end + 1)).map(JSON.parse)[0]; frames.push(f); bytes = bytes.subarray(end + 1);
        if (f.command === 'CONNECT') s.write('CONNECTED\n' + (version === '1.0' ? '' : `version:${version}\n`) + '\n\0');
        else if (header(f, 'receipt')) s.write(`RECEIPT\nreceipt-id:${header(f, 'receipt')}\n\n\0`);
      }
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const client = new TcpClient({port: server.address().port});
  function deliver(sub, text) {
    const id = `m-${++counter}`;
    socket.write(`MESSAGE\nmessage-id:${id}\nsubscription:${sub.id}\ndestination:${sub.destination}\n` + (version === '1.2' ? `ack:${id}\n` : '') + `\n${text}\0`);
  }
  try {
    await client.connect({versions: [version], heartbeat: '0,0'});
    const mode = version === '1.0' ? 'client' : 'client-individual';
    const one = await client.subscribe('/queue/one', {ack: mode});
    const two = await client.subscribe('/queue/two', {ack: mode});
    assert.notEqual(one.id, two.id); assert.throws(() => { one.id = 'changed'; }, TypeError);
    const a = one.next(), b = two.next(); deliver(two, 'two'); deliver(one, 'one');
    const [first, second] = await Promise.all([a, b]);
    assert.equal(Buffer.from(first.body).toString(), 'one'); assert.equal(Buffer.from(second.body).toString(), 'two');
    assert.throws(() => one.ack(second), /not delivered by this subscription/);
    const tx = await client.beginTransaction(); one.ack(first, {transaction: tx}); await tx.abort();
    assert.equal(tx.state, 'aborted'); one.ack(first);
    if (version === '1.0') { assert.throws(() => two.nack(second), /NACK unavailable/); two.ack(second); }
    else two.nack(second);
    const committed = await client.beginTransaction(); committed.send('/queue/output', Buffer.from([65, 0, 255])); await committed.commit();
    assert.equal(committed.state, 'committed'); await assert.rejects(committed.abort(), /not open/);
    assert.throws(() => committed.send('/queue/output', Buffer.alloc(0)), /not open/);
    await assert.rejects(client.subscribe('x', {headers: [['destination', 'bad']]}), /reserved/);
    const foreign = new Transaction(new TcpClient({port: 9}), 'foreign');
    assert.throws(() => two.ack(second, {transaction: foreign}), /another client/);
    await client.receipt('SEND', [['destination', '/queue/barrier']]);
    const acknowledgements = frames.filter(f => f.command === 'ACK' || f.command === 'NACK');
    assert.equal(acknowledgements.length, 3);
    for (const f of acknowledgements) assert(header(f, version === '1.2' ? 'id' : 'message-id'));
    if (version === '1.1') assert(acknowledgements.every(f => header(f, 'subscription')));
    assert(frames.some(f => f.command === 'SEND' && header(f, 'transaction') === committed.id && f.body.join(',') === '65,0,255'));
    const canceled = one.next(5000); canceled.catch(() => {});
    const other = two.next(); await one.unsubscribe();
    await assert.rejects(canceled, /subscription closed/); assert.equal(one.state, 'closed'); assert.equal(client.waiters.length, 1);
    deliver(two, 'still-live'); assert.equal(Buffer.from((await other).body).toString(), 'still-live');
    await two.unsubscribe(); assert.equal(client.waiters.length, 0); await client.disconnect();
    await assert.rejects(one.next(), /not active/);
    console.log(`PASS ${version} handles: scoped delivery, ACK/NACK, aborted/committed tx, cancel, ownership and lifecycle guards`);
  } finally { client.stop(); for (const s of sockets) s.destroy(); await new Promise(resolve => server.close(resolve)); }
}
(async () => { for (const version of ['1.0', '1.1', '1.2']) await check(version); })().catch(error => { console.error(error); process.exitCode = 1; });
