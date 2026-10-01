'use strict';
// Real broker only. Never starts a server or connects beyond numeric loopback.
const {assert,header,options} = require('../examples/broker-common.cjs');
const {TcpClient} = require('../transport/tcp.cjs');
const results=[];
async function scenario(name,ack,fn) {
  const c=new TcpClient(options());
  try {
    await c.connect();
    const destination='/queue/moonstomp-extra-'+name+'-'+process.pid+'-'+Date.now();
    if(ack)await c.receipt('SUBSCRIBE',[['id','s'],['destination',destination],['ack',ack]]);
    const details=await fn(c,destination);
    if(c.state()==='active')await c.disconnect();
    results.push({name,status:name==='transactional-ack-limitation'?'CONFIRMED_BROKER_LIMITATION':'PASSED',details});
  } finally {c.stop();}
}
async function message(c) {return (await c.waitFor(e=>e.event==='message')).frame;}
(async()=>{
  await scenario('fragmented-binary-headers','client-individual',async(c,destination)=>{
    const label=' leading:中文\nline\rslash\\ ';
    const body=Buffer.from([65,0,255,13,10]);
    const incoming=message(c);
    const original=c.write.bind(c);let fragments=0;
    c.write=bytes=>{for(let i=0;i<bytes.length;i+=3){fragments++;original(bytes.subarray(i,i+3));}};
    await c.receipt('SEND',[['destination',destination],['x-label',label],['x-label','ignored']],body);
    c.write=original;
    const frame=await incoming;
    assert.deepEqual(frame.body,[65,0,255,13,10]);assert.equal(header(frame,'x-label'),label);
    await c.receipt('ACK',[['id',header(frame,'ack')]]);
    assert(fragments>1);return {binary_octets:5,write_fragments:fragments,unicode_escapes_spaces_and_first_duplicate:true};
  });
  await scenario('nack-discard-policy','client-individual',async(c,destination)=>{
    const first=message(c);await c.receipt('SEND',[['destination',destination]],Buffer.from('rejected'));
    const initial=await first;assert.equal(Buffer.from(initial.body).toString(),'rejected');
    await c.receipt('NACK',[['id',header(initial,'ack')]]);
    await c.receipt('UNSUBSCRIBE',[['id','s']]);
    await c.receipt('SUBSCRIBE',[['id','s'],['destination',destination],['ack','client-individual']]);
    await assert.rejects(c.waitFor(e=>e.event==='message',300),/event timeout/);
    return {broker_policy:'discard',redelivery_observed:false,empty_observation_ms:300,scope:'Artemis 2.57.0 onNack delegates to onAck; not universal NACK semantics'};
  });
  await scenario('cumulative-ack','client',async(c,destination)=>{
    const one=message(c);await c.receipt('SEND',[['destination',destination]],Buffer.from('one'));
    const a=await one;const two=message(c);await c.receipt('SEND',[['destination',destination]],Buffer.from('two'));
    const b=await two;assert.equal(Buffer.from(a.body).toString(),'one');assert.equal(Buffer.from(b.body).toString(),'two');
    await c.receipt('ACK',[['id',header(b,'ack')]]);
    await c.receipt('UNSUBSCRIBE',[['id','s']]);
    await c.receipt('SUBSCRIBE',[['id','s'],['destination',destination],['ack','client-individual']]);
    await assert.rejects(c.waitFor(e=>e.event==='message',300),/event timeout/);
    return {two_deliveries_settled:true,empty_observation_ms:300};
  });
  await scenario('idle-heartbeats',null,async c=>{
    let sent=0;const original=c.write.bind(c);
    c.write=bytes=>{if(Buffer.from(bytes).equals(Buffer.from('\n')))sent++;original(bytes);};
    for(let i=0;i<2;i++)assert.equal((await c.waitFor(e=>e.event==='heartbeat',5000)).event,'heartbeat');
    assert(sent>=1);assert.equal(c.state(),'active');assert.equal(c.queue.length,0);
    return {server_beats_observed:2,client_beats_sent:sent,healthy:true};
  });
  await scenario('broker-error',null,async c=>{
    const error=c.waitFor(e=>e.event==='error');
    c.write(Buffer.from('BOGUS\n\n\0'));
    assert.equal((await error).frame.command,'ERROR');assert.equal(c.state(),'closed');assert.equal(c.timer,null);
    return {actual_broker_error_received:true,closed:true};
  });
  await scenario('transactional-ack-limitation','client-individual',async(c,destination)=>{
    const first=message(c);await c.receipt('SEND',[['destination',destination]],Buffer.from('tx-ack-probe'));
    const delivery=await first;
    await c.receipt('BEGIN',[['transaction','probe']]);
    await c.receipt('ACK',[['id',header(delivery,'ack')],['transaction','probe']]);
    await c.receipt('ABORT',[['transaction','probe']]);
    await c.receipt('UNSUBSCRIBE',[['id','s']]);
    await c.receipt('SUBSCRIBE',[['id','after-abort'],['destination',destination],['ack','client-individual']]);
    await assert.rejects(c.waitFor(e=>e.event==='message',300),/event timeout/);
    return {transactional_ack_supported:false,aborted_ack_not_redelivered:true,empty_observation_ms:300,basis:'Artemis 2.57.0 onAck warns but executes acknowledgement outside transaction; ABORT does not restore delivery'};
  });
  console.log(JSON.stringify({broker:'Apache Artemis 2.57.0',passed:true,compatible_cases:5,limitation_probes:1,results},null,2));
})().catch(error=>{console.error(JSON.stringify({passed:false,results,error:error.message},null,2));process.exitCode=1;});
