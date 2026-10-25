'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs');
const {TcpClient}=require('../transport/tcp.cjs');
(async()=>{
 const client=new TcpClient({port:Number(process.env.STOMP_PORT),tlsOptions:{ca:fs.readFileSync(process.env.STOMP_TLS_CA),servername:'localhost'}});
 try{
  await client.connect({versions:['1.2'],heartbeat:'1000,1000',login:'moonstomp-test',passcode:'loopback-test-only'});
  const destination='/queue/async-send-'+process.pid,sub=await client.subscribe(destination,{ack:'client-individual'});
  const outputs=await Promise.all(Array.from({length:16},(_,i)=>client.sendAsync(destination,Buffer.from('synthetic-'+i))));assert(outputs.every(r=>r.localWriteComplete&&!r.brokerReceipt));
  // A separate broker receipt is not confused with local write completion.
  await client.receipt('SEND',[['destination',destination]],Buffer.from('receipt-fence'));
  for(let i=0;i<17;i++){const message=await sub.next(2000);assert.equal(Buffer.from(message.body).toString(),i<16?'synthetic-'+i:'receipt-fence');sub.ack(message);}
  await sub.unsubscribe();await client.disconnect();
  console.log(JSON.stringify({status:'PASSED',tls_verified:true,version:'1.2',async_local_writes:16,observed_ordered_deliveries:17,separate_broker_receipt:true,no_automatic_replay:true}));
 }finally{client.stop();assert.equal(client.pendingSends,0);assert.equal(client.pendingSendBytes,0);assert.equal(client.waiters.length,0);}
})().catch(()=>{console.error('FAILED async SEND real broker fixture; inspect private evidence');process.exitCode=1;});
