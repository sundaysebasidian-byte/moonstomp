'use strict';
// Manual ACK / NACK with ack:client-individual. NACK redelivery is a broker
// policy: this demo broker requeues; the recorded Artemis 2.57.0 profile discards.
const {assert, header, text, next, say, demo} = require('./demo-common.cjs');
demo('ack-nack', async ctx => {
  const broker = await ctx.broker();
  const c = await ctx.connect(broker);
  await c.receipt('SUBSCRIBE', [['id', 'worker'], ['destination', '/queue/tasks'], ['ack', 'client-individual']]);
  for (const body of ['resize', 'corrupt']) await c.receipt('SEND', [['destination', '/queue/tasks']], Buffer.from(body));
  const first = (await next(c)).frame;
  assert.equal(text(first), 'resize');
  await c.receipt('ACK', [['id', header(first, 'ack')]]);
  say('ACK    resize processed and acknowledged');
  const second = (await next(c)).frame;
  assert.equal(text(second), 'corrupt');
  await c.receipt('NACK', [['id', header(second, 'ack')]]);
  say('NACK   corrupt rejected');
  const again = (await next(c)).frame;
  assert.equal(text(again), 'corrupt');
  assert.equal(header(again, 'redelivered'), 'true');
  await c.receipt('ACK', [['id', header(again, 'ack')]]);
  say('retry  demo broker redelivered corrupt (redelivered:true); ACKed on second attempt');
  await c.disconnect();
  const discard = await ctx.broker({nack: 'discard'});
  const d = await ctx.connect(discard);
  await d.receipt('SUBSCRIBE', [['id', 'worker'], ['destination', '/queue/tasks'], ['ack', 'client-individual']]);
  await d.receipt('SEND', [['destination', '/queue/tasks']], Buffer.from('corrupt'));
  await d.receipt('NACK', [['id', header((await next(d)).frame, 'ack')]]);
  await assert.rejects(next(d, 300), /event timeout/);
  say('policy NACK with discard policy: no redelivery (the recorded Artemis 2.57.0 profile behaves this way)');
  await d.disconnect();
});
