'use strict';
// One client API, three protocol versions: negotiation and per-version ACK headers.
const {assert, header, text, next, say, demo} = require('./demo-common.cjs');
demo('versions', async ctx => {
  const broker = await ctx.broker();
  for (const version of ['1.0', '1.1', '1.2']) {
    const c = await ctx.connect(broker, {versions: [version]});
    assert.equal(c.version(), version);
    await c.receipt('SUBSCRIBE', [['id', 's'], ['destination', '/queue/v'], ['ack', 'client']]);
    await c.receipt('SEND', [['destination', '/queue/v']], Buffer.from('hello ' + version));
    const frame = (await next(c)).frame;
    // The MESSAGE tells the client which header to ACK with in each version.
    const ackHeaders = version === '1.2' ? [['id', header(frame, 'ack')]]
      : version === '1.1' ? [['subscription', 's'], ['message-id', header(frame, 'message-id')]]
      : [['message-id', header(frame, 'message-id')]];
    await c.receipt('ACK', ackHeaders);
    say(`${version}  ${text(frame)} acked with ${ackHeaders.map(h => h[0]).join('+')}`);
    await c.disconnect();
  }
  const both = await ctx.connect(broker, {versions: ['1.1', '1.2']});
  assert.equal(both.version(), '1.2');
  say('offer 1.1,1.2 -> broker picks 1.2');
  await both.disconnect();
});
