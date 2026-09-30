const {assert,open,message,run} = require('./broker-common.cjs');
run(async()=>{
  const {c,destination}=await open('tasks');
  try {
    const incoming=message(c);
    await c.receipt('SEND',[['destination',destination],['content-type','application/octet-stream']],Buffer.from([65,0,255]));
    assert.deepEqual((await incoming).frame.body,[65,0,255]);
    await c.receipt('UNSUBSCRIBE',[['id','worker']]);
    console.log('PASS real broker task producer/consumer binary NUL');
    await c.disconnect();
  } finally { c.stop(); }
});
