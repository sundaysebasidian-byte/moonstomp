const {assert,header,open,message,run} = require('./broker-common.cjs');
run(async()=>{
  const {c,destination}=await open('reliable','client-individual');
  try {
    for (const [body,decision] of [['success','ACK'],['failed','NACK']]) {
      const incoming=message(c);
      await c.receipt('SEND',[['destination',destination]],Buffer.from(body));
      const f=(await incoming).frame;
      assert.equal(Buffer.from(f.body).toString(),body);
      await c.receipt(decision,[['id',header(f,'ack')]]);
    }
    console.log('PASS real broker explicit ACK/NACK receipts; NACK redelivery is broker-specific');
    await c.disconnect();
  } finally { c.stop(); }
});
