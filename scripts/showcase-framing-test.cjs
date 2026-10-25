'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {frameStream} = require('../examples/receipt-loss-relay.cjs');

test('demo relay preserves a binary frame across every byte boundary', () => {
  const bytes = Buffer.concat([Buffer.from('SEND\ndestination:/queue/test\ncontent-length:3\n\n'), Buffer.from([65, 0, 255, 0])]);
  const got = [], reader = frameStream(frame => got.push(Buffer.from(frame)));
  for (const byte of bytes) reader.feed(Buffer.from([byte]));
  reader.finish(); assert.equal(got.length, 1); assert.deepEqual(got[0], bytes);
});
test('demo relay separates coalesced frames and removes only heartbeat separators', () => {
  const a = Buffer.from('CONNECTED\nversion:1.2\n\n\0'), b = Buffer.from('RECEIPT\nreceipt-id:test\n\n\0');
  const got = [], reader = frameStream(frame => got.push(Buffer.from(frame)));
  reader.feed(Buffer.concat([Buffer.from('\n\r\n'), a, Buffer.from('\n'), b])); reader.finish();
  assert.deepEqual(got, [a, b]);
});
test('demo relay supports CRLF header boundaries', () => {
  const bytes = Buffer.from('RECEIPT\r\nreceipt-id:test\r\n\r\n\0');
  const got = [], reader = frameStream(frame => got.push(Buffer.from(frame)));
  for (let i = 0; i < bytes.length; i += 2) reader.feed(bytes.subarray(i, i + 2));
  reader.finish(); assert.deepEqual(got, [bytes]);
});
test('demo relay fails closed on malformed, oversized or truncated frames', () => {
  for (const bytes of [Buffer.from('SEND\ncontent-length:NaN\n\n\0'),
    Buffer.from('SEND\ncontent-length:1048576\n\n'), Buffer.from('SEND\ncontent-length:1\n\nAx'), Buffer.alloc(1024 * 1024 + 1)]) {
    const reader = frameStream(() => assert.fail('must not forward invalid frame'));
    assert.throws(() => { reader.feed(bytes); reader.finish(); });
  }
  const reader = frameStream(() => assert.fail('truncated frame forwarded'));
  reader.feed(Buffer.from('RECEIPT\nreceipt-id:part')); assert.throws(() => reader.finish(), /truncated/);
});

test('heartbeat observer excludes fragmented header newlines and sees coalesced beats', () => {
  const frames=[],beats=[];
  const stream=frameStream(b=>frames.push(b),b=>beats.push(b));
  for(const byte of Buffer.from('CONNECTED\nversion:1.2\n\n\0\n\r\n'))stream.feed(Buffer.from([byte]));
  stream.finish();assert.equal(frames.length,1);assert.equal(beats.length,2);
});
