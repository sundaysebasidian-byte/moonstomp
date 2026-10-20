'use strict';
// Transactions: ABORT leaves no trace, COMMIT publishes atomically.
const {assert, text, next, say, demo} = require('./demo-common.cjs');
demo('transaction', async ctx => {
  const broker = await ctx.broker();
  const c = await ctx.connect(broker);
  await c.receipt('SUBSCRIBE', [['id', 'tx-reader'], ['destination', '/queue/ledger']]);
  await c.receipt('BEGIN', [['transaction', 't1']]);
  await c.receipt('SEND', [['destination', '/queue/ledger'], ['transaction', 't1']], Buffer.from('debit 10'));
  await c.receipt('ABORT', [['transaction', 't1']]);
  await assert.rejects(next(c, 300), /event timeout/);
  say('abort    staged "debit 10" discarded; nothing delivered');
  await c.receipt('BEGIN', [['transaction', 't2']]);
  for (const body of ['debit 10', 'credit 10']) await c.receipt('SEND', [['destination', '/queue/ledger'], ['transaction', 't2']], Buffer.from(body));
  await assert.rejects(next(c, 300), /event timeout/);
  say('staged   two sends inside t2 are invisible before COMMIT');
  await c.receipt('COMMIT', [['transaction', 't2']]);
  const got = [text((await next(c)).frame), text((await next(c)).frame)];
  assert.deepEqual(got, ['debit 10', 'credit 10']);
  say(`commit   delivered in order: ${got.join(' | ')}`);
  await c.disconnect();
});
