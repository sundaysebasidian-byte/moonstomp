'use strict';
// Adapter-only fault injection. The protocol and socket are explicit test doubles.
// This does NOT exercise MoonBit, TCP/TLS, a STOMP parser, or a real broker.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {performance} = require('node:perf_hooks');
const {friendlyError} = require('../tools/friendly-error.cjs');

function fixture(reply = () => 'receipt', {handshake = true, completeEof = true, sendFailure = null} = {}) {
  const frames = [];
  let socket;
  class Socket extends EventEmitter {
    destroyed = false; writableLength = 0;
    write(bytes, done) {
      const frame = JSON.parse(Buffer.from(bytes).toString()); frames.push(frame);
      queueMicrotask(() => {
        if (this.destroyed) return;
        if (frame.command === 'CONNECT') { if (handshake) this.emit('data', Buffer.from(JSON.stringify({event: 'connected'}))); }
        else {
          const action = reply(frame);
          if (action === 'eof') this.emit('end');
          else if (action instanceof Error) this.emit('error', action);
          else if (action === 'receipt') {
            const id = frame.headers.find(h => h[0] === 'receipt')?.[1];
            if (id) this.emit('data', Buffer.from(JSON.stringify({event: 'receipt', id})));
          }
        }
        done?.();
      });
    }
    destroy() { if (!this.destroyed) { this.destroyed = true; queueMicrotask(() => this.emit('close')); } }
  }
  const protocol = {
    create: () => ({state: 'idle'}), state: c => c.state, version: () => '1.2',
    close: c => { c.state = 'closed'; }, tick: () => [], eof: () => completeEof,
    send(c, command, headers, body) {
      if (command !== 'CONNECT' && sendFailure) throw sendFailure;
      if (c.state === 'closed') throw new Error('closed core');
      return Buffer.from(JSON.stringify({command, headers, body: [...body]}));
    },
    receive(c, bytes) {
      const event = JSON.parse(bytes.toString());
      if (event.event === 'connected') c.state = 'active';
      return [JSON.stringify(event)];
    },
  };
  const module = {exports: {}};
  const sandbox = {module, Buffer, performance, setTimeout, clearTimeout, setInterval, clearInterval, AbortController,
    // Share Uint8Array identity: no codec behavior is supplied by the VM.
    Uint8Array, MoonSTOMP: protocol,
    require(name) {
      if (name.includes('_build/')) return {};
      if (name === 'node:net') return {isIP: () => 4, createConnection() {
        socket = new Socket(); queueMicrotask(() => socket.emit('connect')); return socket;
      }};
      if (name.startsWith('./')) return require(path.join(__dirname, '../transport', name));
      return require(name);
    }};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../transport/tcp.cjs'), 'utf8'), sandbox,
    {filename: 'transport/tcp.cjs'});
  return {Client: module.exports.TcpClient, frames, get socket() { return socket; }};
}

async function connected(f) {
  const c = new f.Client({controlTimeoutMs: 40});
  await c.connect({heartbeat: '0,0'});
  return c;
}
function clean(c) {
  assert.equal(c.state(), 'closed'); assert.equal(c.timer, null);
  assert.equal(c.waiters.length, 0); assert.equal(c.queue.length, 0);
  assert.equal(c.socket.destroyed, true);
}

test('adapter unit: invalid control deadline fails before I/O', () => {
  const f = fixture();
  for (const value of [0, -1, 1.5, Infinity, NaN, 2147483648, '40', null])
    assert.throws(() => new f.Client({controlTimeoutMs: value}), /invalid control timeout/);
  assert.equal(f.frames.length, 0);
});
test('adapter unit: observer timeout has a code and keeps session usable', async () => {
  const f = fixture(), c = await connected(f);
  try {
    await assert.rejects(c.waitFor(() => false, 5), e => e.code === 'STOMP_EVENT_TIMEOUT');
    assert.equal(c.state(), 'active');
    assert.equal((await c.receipt('SEND', [['destination', 'test']])).event, 'receipt');
    await c.disconnect(); clean(c);
  } finally { c.stop(); }
});
for (const command of ['SEND', 'DISCONNECT']) test(`adapter unit: missing ${command} receipt closes without replay`, async () => {
  const f = fixture(() => null), c = await connected(f);
  try {
    const other = c.waitFor(() => false, 1000); other.catch(() => {});
    const error = await c.receipt(command, [], Buffer.alloc(0), 'missing').then(() => assert.fail('unexpected receipt'), e => e);
    assert.equal(error.code, 'STOMP_RECEIPT_TIMEOUT'); assert.equal(error.operation, command);
    assert.equal(error.receiptId, 'missing'); assert.equal(error.outcomeUnknown, true);
    assert.equal(error.cause.code, 'STOMP_EVENT_TIMEOUT');
    await assert.rejects(other, e => e === error);
    clean(c);
    await assert.rejects(c.receipt(command));
    assert.equal(f.frames.filter(f => f.command === command).length, 1);
  } finally { c.stop(); }
});
test('adapter unit: lost COMMIT receipt means failed handle, unknown broker outcome', async () => {
  const f = fixture(frame => frame.command === 'COMMIT' ? null : 'receipt'), c = await connected(f);
  try {
    const tx = await c.beginTransaction(); tx.send('test', Buffer.from('payload'));
    await assert.rejects(tx.commit(), e => e.operation === 'COMMIT' && e.outcomeUnknown === true);
    assert.equal(tx.state, 'failed');
    await assert.rejects(tx.abort(), /not open/);
    assert.throws(() => tx.send('test', Buffer.alloc(0)), /not open/);
    assert.equal(f.frames.filter(f => f.command === 'COMMIT').length, 1);
    assert.equal(f.frames.filter(f => f.command === 'ABORT').length, 0); clean(c);
  } finally { c.stop(); }
});
test('adapter unit: pending SEND preserves EOF as its cause and does not replay', async () => {
  const f = fixture(() => 'eof'), c = await connected(f);
  try {
    await assert.rejects(c.receipt('SEND'), e => e.code === 'STOMP_PEER_EOF' &&
      e.operation === 'SEND' && e.cause.operation === 'receive' && e.outcomeUnknown === true);
    clean(c); assert.equal(f.frames.filter(f => f.command === 'SEND').length, 1);
  } finally { c.stop(); }
});
test('adapter unit: preserves native network error code and cause', async () => {
  const reset = Object.assign(new Error('test reset'), {code: 'ECONNRESET'});
  const f = fixture(() => reset), c = await connected(f);
  try {
    await assert.rejects(c.receipt('SEND'), e => e.code === 'ECONNRESET' && e.cause === reset && e.outcomeUnknown);
    clean(c);
  } finally { c.stop(); }
});
test('adapter unit: transaction finish rejects concurrent commit/abort', async () => {
  const f = fixture(), c = await connected(f);
  try {
    const tx = await c.beginTransaction(), pending = tx.commit();
    await assert.rejects(tx.abort(), /not open/); await pending;
    assert.equal(tx.state, 'committed'); assert.equal(f.frames.filter(f => f.command === 'COMMIT').length, 1);
  } finally { c.stop(); }
});
test('adapter unit: CLI explains unknown outcome and quotes receipt id', () => {
  const {receiptFailure, transportError} = require('../transport/errors.cjs');
  const error = receiptFailure(transportError('STOMP_EVENT_TIMEOUT', 'event timeout'), 'COMMIT', 'r\ncontrol');
  const text = friendlyError(error, '127.0.0.1', 61613);
  assert.match(text, /code=STOMP_RECEIPT_TIMEOUT operation=COMMIT/);
  assert.match(text, /receiptId="r\\ncontrol"/);
  assert.match(text, /outcome is unknown/); assert.match(text, /no automatic resend/);
});

test('adapter unit: CONNECT timeout closes without a second CONNECT', async () => {
  const f = fixture(() => null, {handshake: false}), c = new f.Client({controlTimeoutMs: 20});
  try {
    await assert.rejects(c.connect({heartbeat: '0,0'}), e => e.code === 'STOMP_CONNECT_TIMEOUT' && e.operation === 'CONNECT');
    clean(c); assert.equal(f.frames.length, 1);
  } finally { c.stop(); }
});
test('adapter unit: truncated EOF differs from a complete frame boundary', async () => {
  const f = fixture(() => 'eof', {completeEof: false}), c = await connected(f);
  try {
    await assert.rejects(c.receipt('SEND'), e => e.code === 'STOMP_TRUNCATED_STREAM' && e.cause.operation === 'receive');
    clean(c);
  } finally { c.stop(); }
});
test('adapter unit: receipt failure retains broker frame, reason and original cause', () => {
  const {receiptFailure} = require('../transport/errors.cjs');
  const cause = Object.assign(new Error('broker refused'), {name: 'MoonSTOMPBrokerError', code: 'STOMP_BROKER_ERROR', reason: 'test reason',
    frame: {command: 'ERROR', headers: [['message', 'test refusal']], body: []}});
  const failure = receiptFailure(cause, 'SEND', 'test-receipt');
  assert.equal(failure.cause, cause); assert.equal(failure.frame, cause.frame);
  assert.equal(failure.reason, cause.reason); assert.equal(failure.code, cause.code); assert.equal(failure.name, cause.name);
});

test('adapter unit: pre-write protocol rejection is known not sent and preserves error type', async () => {
  const cause = Object.assign(new Error('missing destination'), {name: 'MoonSTOMPProtocolError', code: 'STOMP_INVALID'});
  const f = fixture(() => 'receipt', {sendFailure: cause}), c = await connected(f);
  try {
    await assert.rejects(c.receipt('SEND'), e => e.code === 'STOMP_INVALID' &&
      e.name === 'MoonSTOMPProtocolError' && e.cause === cause && e.outcomeUnknown === false);
    assert.equal(f.frames.length, 1); clean(c);
  } finally { c.stop(); }
});
test('adapter unit: write buffer rejection is known not sent', async () => {
  const f = fixture(), c = await connected(f);
  try {
    f.socket.writableLength = 2 * 1024 * 1024;
    await assert.rejects(c.receipt('SEND'), e => e.outcomeUnknown === false);
    assert.equal(f.frames.length, 1); clean(c);
  } finally { c.stop(); }
});
test('adapter unit: invalid command objects and control characters are not retained in errors', async () => {
  const f = fixture(), c = await connected(f);
  try {
    for (const command of [{passcode: 'private-test-marker'}, 'SEND\nprivate-test-marker', 'private-test-marker', null]) {
      const error = await c.receipt(command).then(() => assert.fail('accepted invalid command'), e => e);
      assert.equal(error.code, 'STOMP_ARGUMENT'); assert.equal(error.operation, 'receipt');
      assert.equal(error.cause, undefined); assert.equal(error.outcomeUnknown, undefined);
      assert(!require('node:util').inspect(error).includes('private-test-marker'));
    }
    assert.equal(f.frames.length, 1); assert.equal(c.state(), 'active');
    assert.equal(c.waiters.length, 0);
  } finally { c.stop(); }
});

test('adapter unit: control deadline cannot be mutated into a rejected waiter followed by a write', async () => {
  const f = fixture(), c = await connected(f);
  try {
    assert.throws(() => { c.controlTimeoutMs = 0; }, TypeError);
    assert.throws(() => Object.defineProperty(c, 'controlTimeoutMs', {value: NaN}), TypeError);
    assert.equal(c.controlTimeoutMs, 40);
    await c.receipt('SEND'); assert.equal(c.waiters.length, 0);
  } finally { c.stop(); }
});
