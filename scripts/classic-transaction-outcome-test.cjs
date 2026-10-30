'use strict';
// Positive confirmation controls on a real isolated Classic TLS broker.
// No receipt-loss injection; unknown-outcome tests remain scripted-peer evidence.
const assert=require('node:assert/strict'),fs=require('node:fs');
const {TcpClient}=require('../transport/tcp.cjs');
const port=Number(process.env.STOMP_PORT);assert(Number.isInteger(port)&&port>0&&port<65536);
assert(process.env.STOMP_TLS_CA,'TLS CA is required');
const ca=fs.readFileSync(process.env.STOMP_TLS_CA),results=[];
async function check(version,command){
 const c=new TcpClient({port,host:'127.0.0.1',tlsOptions:{ca,servername:'localhost'}});
 try{
  await c.connect({versions:[version],heartbeat:'0,0',login:'moonstomp-test',passcode:'loopback-test-only'});
  assert.equal(c.version(),version);assert.equal(c.socket.authorized,true);
  const q=`/queue/outcome-confirmed-${process.pid}-${version}-${command}`;
  const sub=await c.subscribe(q,{ack:'auto'});
  const tx=await c.beginTransaction();assert.equal(tx.outcome.status,'not-requested');
  tx.send(q,Buffer.from('transaction-payload'),[['persistent','false']]);
  const pending=tx[command==='COMMIT'?'commit':'abort']();
  const during=tx.outcome;assert.equal(during.status,'pending');
  const receipt=await pending;
  const outcome=tx.outcome;
  assert.deepEqual(outcome,{status:'confirmed',operation:command,receiptId:receipt.id,errorCode:null});
  assert.equal(during.status,'pending');assert(Object.isFrozen(outcome));
  assert.equal(tx.state,command==='COMMIT'?'committed':'aborted');
  if(command==='COMMIT')assert.equal(Buffer.from((await sub.next(2500)).body).toString(),'transaction-payload');
  // Positive marker demonstrates live consumer; bounded absence is not permanent proof.
  await c.receipt('SEND',[['destination',q],['persistent','false']],Buffer.from('marker'));
  assert.equal(Buffer.from((await sub.next(2500)).body).toString(),'marker');
  await assert.rejects(sub.next(100),e=>e.code==='STOMP_EVENT_TIMEOUT');
  await sub.unsubscribe();await c.disconnect();
  assert.strictEqual(tx.outcome,outcome);assert.equal(c.state(),'closed');
  await assert.rejects(tx.commit(),/not open/);await assert.rejects(tx.abort(),/not open/);
  assert.strictEqual(tx.outcome,outcome);
  results.push({version,actual_version:version,command,outcome,receipt_matches:true,tls_verified:true,marker_received:true,extra_observation_ms:100,confirmed_survives_disconnect:true,no_duplicate_finish:true,status:'PASSED'});
 }finally{c.stop();}
}
(async()=>{
 for(const v of ['1.0','1.1','1.2'])for(const command of ['COMMIT','ABORT'])await check(v,command);
 console.log(JSON.stringify({status:'PASSED',broker:'ActiveMQ Classic 6.3.2',results,scope:'real TLS positive finish receipt confirmation; nonpersistent loopback queue; no loss injection/business persistence/exactly-once proof'},null,2));
})().catch(e=>{console.error(JSON.stringify({status:'FAILED',results,error:e.message,code:e.code},null,2));process.exitCode=1;});
