'use strict';
// Real generated bridge plus scripted loopback peer; no external broker.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {spawnSync} = require('node:child_process');
const {protocol} = require('../transport/tcp.cjs');
const {fixture} = require('./review30-peer.cjs');
function detached() { const body = new Uint8Array([65]); structuredClone(body.buffer, {transfer: [body.buffer]}); return body; }
function outOfBounds() { const buffer = new ArrayBuffer(4, {maxByteLength: 8}); const body = new Uint8Array(buffer, 2, 2); buffer.resize(1); return body; }
for (const [label, create] of [['detached', detached], ['out-of-bounds', outOfBounds], ['prototype-only', () => Object.create(Uint8Array.prototype)]]) {
  for (const operation of ['parse', 'receive', 'send']) test(`${label} byte view rejected by bridge ${operation} before state mutation`, () => {
    const client = protocol.create(), body = create();
    assert.throws(() => operation === 'parse' ? protocol.parse(body) : operation === 'send'
      ? protocol.send(client, 'CONNECT', [['accept-version','1.2'], ['host','localhost']], body, 0n)
      : protocol.receive(client, body, 0n), e => e.code === 'STOMP_ARGUMENT');
    assert.equal(protocol.state(client), 'fresh');
  });
}
test('valid empty typed arrays and Buffers remain valid', () => {
  for (const value of [new Uint8Array(0), Buffer.alloc(0)]) assert.deepEqual(protocol.parse(value), []);
});
test('detached byte views cannot become an empty outgoing message or close a healthy receipt session', async () => {
  await fixture('1.2', async (client, peer, seen) => {
    const before = seen.length;
    await assert.rejects(client.receipt('SEND', [['destination','/q']], detached()), e => e.outcomeUnknown === false);
    assert.equal(client.state(), 'active');
    await assert.rejects(client.sendAsync('/q', detached()), e => e.code === 'STOMP_ARGUMENT');
    assert.equal(client.pendingSends, 0); assert.equal(client.pendingSendBytes, 0);
    const tx = await client.beginTransaction();
    assert.throws(() => tx.send('/q', detached()), e => e.code === 'STOMP_HANDLE');
    assert.equal(client.state(), 'active');
    await tx.abort();
    assert.equal(seen.slice(before).filter(x => x.command === 'SEND').length, 0);
    await client.receipt('SEND', [['destination','/q']], Buffer.from('valid'));
    assert.equal(seen.filter(x => x.command === 'SEND').length, 1);
  });
});
test('foreign rejected Promise predicate is refused without unhandled rejection', () => {
  const result = spawnSync(process.execPath, ['--unhandled-rejections=strict', '-e', `
    const assert=require('node:assert/strict'),vm=require('node:vm');
    const {TcpClient}=require('./transport/tcp.cjs');
    const client=new TcpClient();
    const promise=vm.runInNewContext('Promise.reject(new Error("foreign rejection"))');
    assert.throws(()=>client._matches(()=>promise,{}),/synchronous boolean/);
    let used=false;assert.throws(()=>client._matches(()=>({then(){used=true;}}),{}),/synchronous boolean/);assert.equal(used,false);
    assert.throws(()=>client._matches(()=>Promise.reject(Error('local rejection')),{}),/synchronous boolean/);
    setImmediate(()=>{client.stop();console.log('clean strict process');});
  `], {cwd: require('node:path').resolve(__dirname, '..'), encoding:'utf8',timeout:5000});
  assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /clean strict process/);
});
