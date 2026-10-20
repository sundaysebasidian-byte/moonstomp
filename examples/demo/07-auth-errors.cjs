'use strict';
// login/passcode on CONNECT, and what a rejected login looks like to the caller:
// the adapter throws an error with name/code/operation and the broker's ERROR frame.
// Credentials are checked by the demo broker only; real brokers decide for themselves.
const {assert, say, demo} = require('./demo-common.cjs');
demo('auth-errors', async ctx => {
  const broker = await ctx.broker({credentials: {login: 'alice', passcode: 'wonderland'}});
  await assert.rejects(ctx.connect(broker), error => {
    say(`anonymous   rejected: ${error.name} code=${error.code} operation=${error.operation}`);
    say(`            broker said ${JSON.stringify(error.frame.headers.find(h => h[0] === 'message')[1])} in an ${error.frame.command} frame`);
    return error.code === 'STOMP_BROKER_ERROR';
  });
  await assert.rejects(ctx.connect(broker, {login: 'alice', passcode: 'wrong'}), error => {
    say(`wrong pass  rejected: code=${error.code}; the passcode is not in the error: ${!JSON.stringify(error.frame).includes('wrong')}`);
    return error.code === 'STOMP_BROKER_ERROR';
  });
  const c = await ctx.connect(broker, {login: 'alice', passcode: 'wonderland'});
  await c.receipt('SEND', [['destination', '/queue/private']], Buffer.from('for alice'));
  say(`accepted    login alice, STOMP ${c.version()}, SEND confirmed by receipt`);
  await c.disconnect();
});
