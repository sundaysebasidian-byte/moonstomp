'use strict';
// Transactions with the Transaction handle: ABORT leaves no trace, COMMIT publishes atomically.
const {assert, text, say, demo} = require('./demo-common.cjs');
demo('transaction', async ctx => {
  const broker = await ctx.broker();
  const c = await ctx.connect(broker);
  const reader = await c.subscribe('/queue/ledger', {id: 'tx-reader'});
  const t1 = await c.beginTransaction({id: 't1'});
  t1.send('/queue/ledger', Buffer.from('debit 10'));
  await t1.abort();
  await assert.rejects(reader.next(300), /event timeout/);
  say('abort    staged "debit 10" discarded; nothing delivered');
  const t2 = await c.beginTransaction({id: 't2'});
  for (const body of ['debit 10', 'credit 10']) t2.send('/queue/ledger', Buffer.from(body));
  await assert.rejects(reader.next(300), /event timeout/);
  say('staged   two sends inside t2 are invisible before COMMIT');
  await t2.commit();
  const got = [text(await reader.next()), text(await reader.next())];
  assert.deepEqual(got, ['debit 10', 'credit 10']);
  say(`commit   delivered in order: ${got.join(' | ')}`);
  await c.disconnect();
});
