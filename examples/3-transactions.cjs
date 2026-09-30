const {assert,open,message,run} = require('./broker-common.cjs');
run(async()=>{
  const {c,destination}=await open('transactions');
  try {
    await c.receipt('BEGIN',[['transaction','abort-me']]);
    await c.receipt('SEND',[['destination',destination],['transaction','abort-me']],Buffer.from('discard'));
    await c.receipt('ABORT',[['transaction','abort-me']]);
    await assert.rejects(c.waitFor(e=>e.event==='message',300),/event timeout/);
    await c.receipt('BEGIN',[['transaction','commit-me']]);
    await c.receipt('SEND',[['destination',destination],['transaction','commit-me']],Buffer.from('publish'));
    const incoming=message(c);
    await c.receipt('COMMIT',[['transaction','commit-me']]);
    assert.equal(Buffer.from((await incoming).frame.body).toString(),'publish');
    console.log('PASS real broker transaction abort invisible and commit delivered');
    await c.disconnect();
  } finally { c.stop(); }
});
