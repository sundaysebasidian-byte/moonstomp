'use strict';
// Publish/subscribe: topic fan-out, then queue work distribution.
const {assert, text, next, say, demo} = require('./demo-common.cjs');
demo('pubsub', async ctx => {
  const broker = await ctx.broker();
  const pub = await ctx.connect(broker);
  const a = await ctx.connect(broker), b = await ctx.connect(broker);
  for (const [c, id] of [[a, 'a'], [b, 'b']]) await c.receipt('SUBSCRIBE', [['id', id], ['destination', '/topic/news']]);
  const gotA = next(a), gotB = next(b);
  await pub.receipt('SEND', [['destination', '/topic/news'], ['content-type', 'text/plain']], Buffer.from('moonbit 0.10'));
  say(`topic    both subscribers received "${text((await gotA).frame)}" and "${text((await gotB).frame)}"`);

  for (const [c, id] of [[a, 'w'], [b, 'w']]) await c.receipt('SUBSCRIBE', [['id', id], ['destination', '/queue/jobs']]);
  const seen = [];
  const drain = async c => { try { for (;;) seen.push(text((await next(c, 300)).frame)); } catch { /* timeout = queue empty */ } };
  for (const n of [1, 2, 3, 4]) await pub.receipt('SEND', [['destination', '/queue/jobs']], Buffer.from('job-' + n));
  await Promise.all([drain(a), drain(b)]);
  assert.deepEqual(seen.sort(), ['job-1', 'job-2', 'job-3', 'job-4']);
  say(`queue    4 jobs delivered exactly once across 2 workers: ${seen.join(',')}`);
  for (const c of [pub, a, b]) await c.disconnect();
});
