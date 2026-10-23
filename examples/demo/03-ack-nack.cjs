'use strict';
// Manual ACK / NACK with ack:client-individual, using the Subscription handle.
// NACK redelivery is a broker policy: this demo broker requeues; the recorded
// Artemis 2.57.0 profile discards.
const {assert, header, text, say, demo} = require('./demo-common.cjs');
demo('ack-nack', async ctx => {
  const broker = await ctx.broker();
  const c = await ctx.connect(broker);
  const sub = await c.subscribe('/queue/tasks', {id: 'worker', ack: 'client-individual'});
  for (const body of ['resize', 'corrupt']) await c.receipt('SEND', [['destination', '/queue/tasks']], Buffer.from(body));
  const first = await sub.next();
  assert.equal(text(first), 'resize');
  sub.ack(first);
  say('ACK    resize processed and acknowledged');
  const second = await sub.next();
  assert.equal(text(second), 'corrupt');
  sub.nack(second);
  say('NACK   corrupt rejected');
  const again = await sub.next();
  assert.equal(text(again), 'corrupt');
  assert.equal(header(again, 'redelivered'), 'true');
  sub.ack(again);
  say('retry  demo broker redelivered corrupt (redelivered:true); ACKed on second attempt');
  await sub.unsubscribe();
  await c.disconnect();
  const discard = await ctx.broker({nack: 'discard'});
  const d = await ctx.connect(discard);
  const dsub = await d.subscribe('/queue/tasks', {id: 'worker', ack: 'client-individual'});
  await d.receipt('SEND', [['destination', '/queue/tasks']], Buffer.from('corrupt'));
  dsub.nack(await dsub.next());
  await assert.rejects(dsub.next(300), /event timeout/);
  say('policy NACK with discard policy: no redelivery (the recorded Artemis 2.57.0 profile behaves this way)');
  await d.disconnect();
});
