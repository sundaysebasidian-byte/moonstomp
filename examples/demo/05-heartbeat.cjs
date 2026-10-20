'use strict';
// Heart-beating: negotiated beats keep the link alive; a silent peer is detected.
const {assert, say, demo} = require('./demo-common.cjs');
demo('heartbeat', async ctx => {
  const live = await ctx.broker({heartbeat: '200,200'});
  const c = await ctx.connect(live, {heartbeat: '200,200'});
  await c.waitFor(e => e.event === 'heartbeat', 2000);
  await c.waitFor(e => e.event === 'heartbeat', 2000);
  assert.equal(c.state(), 'active');
  say('alive   negotiated 200,200: two broker heart-beats observed, session still active');
  await c.disconnect();
  const silent = await ctx.broker({heartbeat: '200,200', silentAfterConnect: true});
  const d = await ctx.connect(silent, {heartbeat: '200,200'});
  await assert.rejects(d.waitFor(e => e.event === 'message', 3000));
  assert.equal(d.state(), 'closed');
  say('silent  broker went quiet: client closed the session itself (state=closed) instead of hanging');
});
