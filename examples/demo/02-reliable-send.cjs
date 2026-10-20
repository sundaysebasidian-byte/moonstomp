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
  const d = new TcpClient({port: mute.port});
  await d.connect({heartbeat: '0,0'});
  // The default receipt wait is 5 s; shrink it only for this demo by waiting on the same condition directly.
  d.send('SEND', [['destination', '/queue/orders'], ['receipt', 'lost-1']], Buffer.from('order-2'));
  await assert.rejects(d.waitFor(e => e.event === 'receipt' && e.id === 'lost-1', 400), /event timeout/);
  say('unconfirmed no RECEIPT within 400 ms: outcome unknown, the library never retries for you');
  d.stop();
});
