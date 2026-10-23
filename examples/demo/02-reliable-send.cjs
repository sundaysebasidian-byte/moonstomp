'use strict';
// Receipt-confirmed send, and what an unconfirmed send means.
const {assert, text, next, say, demo} = require('./demo-common.cjs');
const {TcpClient} = require('../../transport/tcp.cjs');
demo('reliable-send', async ctx => {
  const broker = await ctx.broker();
  const c = await ctx.connect(broker);
  await c.receipt('SEND', [['destination', '/queue/orders']], Buffer.from('order-1'));
  assert.equal(broker.pending('/queue/orders'), 1);
  say('confirmed   RECEIPT received: broker holds order-1 before we continue');
  await c.receipt('SUBSCRIBE', [['id', 'reader'], ['destination', '/queue/orders']]);
  say(`delivered   ${text((await next(c)).frame)} reached the subscriber`);
  await c.disconnect();

  const mute = await ctx.broker({swallowReceipts: true});
  const d = new TcpClient({port: mute.port, controlTimeoutMs: 400});
  await d.connect({heartbeat: '0,0'});
  // Use the public receipt API: a missing control receipt retires the session.
  await assert.rejects(d.receipt('SEND', [['destination', '/queue/orders']], Buffer.from('order-2'), 'lost-1'),
    error => error.code === 'STOMP_RECEIPT_TIMEOUT' && error.receiptId === 'lost-1' && error.outcomeUnknown);
  assert.equal(d.state(), 'closed');
  assert.equal(mute.pending('/queue/orders'), 1); // accepted by this demo peer, but not confirmed to the caller
  say('unconfirmed no RECEIPT within 400 ms: outcome unknown, the library never retries for you');
  d.stop();
});
