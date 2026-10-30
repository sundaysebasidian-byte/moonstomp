'use strict';
// Real Classic test; explicit independent clients are probes, never auto-reconnect.
const assert=require('node:assert/strict'),fs=require('node:fs');
const {TcpClient}=require('../transport/tcp.cjs');
const port=Number(process.env.STOMP_PORT);assert(Number.isInteger(port)&&port>0&&port<65536);
const ca=process.env.STOMP_TLS_CA;assert(ca,'verified TLS profile required');
const options={host:'127.0.0.1',port,tlsOptions:{ca:fs.readFileSync(ca),servername:'localhost'}};
const results=[];
async function connect(version){const c=new TcpClient(options);try{await c.connect({versions:[version],heartbeat:'0,0',login:'moonstomp-test',passcode:'loopback-test-only'});assert(c.socket.authorized);assert.equal(c.version(),version);return c}catch(e){c.stop();throw e}}
async function transactionCase(version,mode,commit){
 const q=`/queue/review-ack-${process.pid}-${Date.now()}-${version}-${mode}-${commit}`;
 let c=await connect(version),probe;
 try{
  const sub=await c.subscribe(q,{ack:mode,headers:[['activemq.prefetchSize','2']]});
  for(const s of ['a','b'])await c.receipt('SEND',[['destination',q],['persistent','false']],Buffer.from(s));
  const a=await sub.next(),b=await sub.next();assert.equal(Buffer.from(a.body).toString(),'a');assert.equal(Buffer.from(b.body).toString(),'b');
  const tx=await c.beginTransaction();sub.ack(a,{transaction:tx});sub.ack(b,{transaction:tx});
  if(commit)await tx.commit();else await tx.abort();
  await c.disconnect();c.stop();
  probe=await connect(version);const ps=await probe.subscribe(q,{ack:'client-individual'});
  let redelivered=[];
  if(!commit){for(let i=0;i<2;i++){const m=await ps.next(2500);redelivered.push(Buffer.from(m.body).toString());ps.ack(m)}assert.deepEqual(redelivered,['a','b'])}
  // Positive marker proves the independent consumer is live before bounded absence.
  await probe.receipt('SEND',[['destination',q]],Buffer.from('marker'));
  const m=await ps.next(2500);assert.equal(Buffer.from(m.body).toString(),'marker');ps.ack(m);
  await assert.rejects(ps.next(150),e=>e.code==='STOMP_EVENT_TIMEOUT');
  await ps.unsubscribe();await probe.disconnect();
  results.push({version,actual_version:version,mode,transaction:commit?'COMMIT':'ABORT',status:'PASSED',redelivered,marker_received:true,extra_observation_ms:150});
 }finally{c.stop();if(probe)probe.stop()}
}
async function singleAckCase(version,mode){
 const q=`/queue/review-single-${process.pid}-${Date.now()}-${version}-${mode}`;
 const c=await connect(version);let probe;
 try{
  const sub=await c.subscribe(q,{ack:mode,headers:[['activemq.prefetchSize','2']]});
  for(const x of ['a','b'])await c.receipt('SEND',[['destination',q],['persistent','false']],Buffer.from(x));
  const a=await sub.next(),b=await sub.next();assert.equal(Buffer.from(a.body).toString(),'a');assert.equal(Buffer.from(b.body).toString(),'b');
  sub.ack(b);await c.disconnect();c.stop();
  probe=await connect(version);const ps=await probe.subscribe(q,{ack:'client-individual'});let redelivered=[];
  if(mode==='client-individual'){const m=await ps.next(2500);redelivered.push(Buffer.from(m.body).toString());assert.deepEqual(redelivered,['a']);ps.ack(m)}
  await probe.receipt('SEND',[['destination',q]],Buffer.from('marker'));const m=await ps.next(2500);assert.equal(Buffer.from(m.body).toString(),'marker');ps.ack(m);
  await assert.rejects(ps.next(150),e=>e.code==='STOMP_EVENT_TIMEOUT');await ps.unsubscribe();await probe.disconnect();
  results.push({version,actual_version:version,mode,case:'only-second-message-ACK',status:'PASSED',redelivered,marker_received:true,extra_observation_ms:150});
 }finally{c.stop();if(probe)probe.stop()}
}
async function subscriptionCase(version){
 const c=await connect(version);try{
  const prefix=`/queue/review-multi-${process.pid}-${Date.now()}-${version}`;
  const one=await c.subscribe(prefix+'-one',{ack:'auto'}),two=await c.subscribe(prefix+'-two',{ack:'client-individual'});
  await c.receipt('SEND',[['destination',one.destination]],Buffer.from('one'));await c.receipt('SEND',[['destination',two.destination]],Buffer.from('two'));
  assert.equal(Buffer.from((await one.next()).body).toString(),'one');const m=await two.next();assert.equal(Buffer.from(m.body).toString(),'two');two.ack(m);
  const canceled=one.next(2000);canceled.catch(()=>{});await one.unsubscribe();await assert.rejects(canceled,e=>e.code==='STOMP_HANDLE' && /subscription closed/.test(e.message));
  await c.receipt('SEND',[['destination',two.destination]],Buffer.from('still-live'));const n=await two.next();assert.equal(Buffer.from(n.body).toString(),'still-live');two.ack(n);
  await two.unsubscribe();await c.disconnect();results.push({version,actual_version:version,case:'multi-subscription-auto-individual-cancel-isolation',status:'PASSED'});
 }finally{c.stop()}
}
(async()=>{for(const version of ['1.1','1.2']){for(const mode of ['client','client-individual'])for(const commit of [false,true])await transactionCase(version,mode,commit);for(const mode of ['client','client-individual'])await singleAckCase(version,mode);await subscriptionCase(version)}console.log(JSON.stringify({status:'PASSED',broker:'ActiveMQ Classic 6.3.2',tls_verified:true,results,scope:'loopback nonpersistent queue; transaction ACK and subscription probes only; no durable/exactly-once/general broker claim'},null,2))})().catch(e=>{console.error(JSON.stringify({status:'FAILED',results,error:e.message,code:e.code},null,2));process.exitCode=1});
