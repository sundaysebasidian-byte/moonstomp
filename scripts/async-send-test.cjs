'use strict';
// Actual loopback TCP, including a paused reader. No broker claim.
const assert=require('node:assert/strict'),net=require('node:net');
const {TcpClient}=require('../transport/tcp.cjs');
const {frameStream}=require('../examples/receipt-loss-relay.cjs');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function fixture(run,options={},heartbeat="0,0"){
 const sockets=new Set();let peer;const frames=[];
 const server=net.createServer(s=>{peer=s;sockets.add(s);s.on('error',()=>{});s.on('close',()=>sockets.delete(s));
  const parser=frameStream(b=>{const text=b.subarray(0,100).toString();if(text.startsWith('CONNECT\n'))s.write('CONNECTED\nversion:1.2\nheart-beat:100,100\n\n\0');else if(text.startsWith('SEND\n')){const start=b.indexOf(Buffer.from('\n\n'))+2;frames.push(b.subarray(start,start+6).toString());}else{const receipt=b.toString().match(/\nreceipt:([^\n]+)/);if(receipt)s.write('RECEIPT\nreceipt-id:'+receipt[1]+'\n\n\0');}});
  s.on('data',b=>parser.feed(b));
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const c=new TcpClient({port:server.address().port,maxPendingSends:64,maxPendingSendBytes:24*1024*1024,maxSendFrameBytes:512*1024,...options});
 try{await c.connect({heartbeat});await run(c,()=>peer,frames);}finally{c.stop();for(const s of sockets)s.destroy();await new Promise(r=>server.close(r));}
 assert.equal(c.pendingSends,0);assert.equal(c.pendingSendBytes,0);assert.equal(c.socket.listenerCount('drain'),0);assert.equal(c.timer,null);
}
(async()=>{
 let falseWrites=0;
 await fixture(async(c,peer,frames)=>{
  peer().pause();const write=c.socket.write.bind(c.socket);c.socket.write=(...a)=>{const ok=write(...a);if(!ok)falseWrites++;return ok;};
  const pending=[];for(let i=0;i<48;i++){const b=Buffer.alloc(256*1024,65);b.write(String(i).padStart(6,'0'));pending.push(c.sendAsync('/queue/test',b,{timeoutMs:10000}));b.fill(85);}
  assert.throws(()=>c.send('SEND',[['destination','/queue/sync']]),e=>e.code==='STOMP_ASYNC_BUSY');
  await assert.rejects(c.receipt('SEND',[['destination','/queue/control']]),e=>e.code==='STOMP_ASYNC_BUSY');assert.equal(c.waiters.length,0);
  setTimeout(()=>peer().resume(),150);const results=await Promise.all(pending);assert(results.every(r=>r.localWriteComplete&&r.brokerReceipt===false));
  const until=Date.now()+3000;while(frames.length<48&&Date.now()<until)await delay(10);
  assert.deepEqual(frames,Array.from({length:48},(_,i)=>String(i).padStart(6,'0')));assert(falseWrites>0);
 });
 await fixture(async(c,peer)=>{
  peer().pause();c.socket.cork();const first=c.sendAsync('/queue/test',Buffer.alloc(128*1024),{timeoutMs:80});
  const controller=new AbortController();const second=c.sendAsync('/queue/test',Buffer.alloc(20),{signal:controller.signal});const rejected=assert.rejects(second,e=>e.code==='STOMP_SEND_CANCELLED'&&e.outcomeUnknown===false);controller.abort();await rejected;
  await assert.rejects(first,e=>e.code==='STOMP_SEND_TIMEOUT'&&e.outcomeUnknown===true);assert.equal(c.state(),'closed');
 });
 await fixture(async(c)=>{
  c.socket.cork();const abort=new AbortController();const a=c.sendAsync('/queue/test',Buffer.alloc(128*1024),{signal:abort.signal});const b=c.sendAsync('/queue/test',Buffer.alloc(8));const results=Promise.allSettled([a,b]);await delay(5);abort.abort();const r=await results;assert(r[0].reason.outcomeUnknown);assert.equal(r[1].reason.outcomeUnknown,false);
 });
 await fixture(async(c)=>{
  const abort=new AbortController();abort.abort();await assert.rejects(c.sendAsync('/x',Buffer.alloc(0),{signal:abort.signal}),e=>e.outcomeUnknown===false);
  await assert.rejects(c.sendAsync('/x',Buffer.alloc(1024*1024)),e=>e.code==='STOMP_SEND_LIMIT'&&e.outcomeUnknown===false);assert.equal(c.state(),'active');
  c.socket.cork();const a=c.sendAsync('/x',Buffer.alloc(128*1024));const b=c.sendAsync('/x',Buffer.alloc(8));const result=Promise.allSettled([a,b]);await delay(5);c.stop();const r=await result;assert.equal(r[0].reason.outcomeUnknown,true);assert.equal(r[1].reason.outcomeUnknown,false);
 });
 await fixture(async(c,peer)=>{
  c.socket.cork();const a=c.sendAsync('/x',Buffer.alloc(128*1024));const b=c.sendAsync('/x',Buffer.alloc(8));const result=Promise.allSettled([a,b]);await delay(5);peer().destroy();const r=await result;assert(r.every(x=>x.status==='rejected'));assert.equal(r[1].reason.outcomeUnknown,false);
 });
 await fixture(async(c,peer)=>{
  // Establish an attempted write before queuing followers: a short deadline plus
  // large encoding cost can legitimately expire every item before socket.write.
  // The earlier paused-reader test separately proves real OS backpressure.
  peer().pause();c.socket.cork();
  let wrote;const firstWrite=new Promise(resolve=>{wrote=resolve;});
  const write=c.socket.write.bind(c.socket);c.socket.write=(...args)=>{const ok=write(...args);wrote();return ok;};
  const first=c.sendAsync('/q',Buffer.alloc(128*1024),{timeoutMs:5000});
  const firstResult=Promise.allSettled([first]);
  let timer;try{await Promise.race([firstWrite,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('first SEND never reached socket.write')),6000);})]);}finally{clearTimeout(timer);c.socket.write=write;}
  const pending=Array.from({length:47},()=>c.sendAsync('/q',Buffer.alloc(256*1024),{timeoutMs:10000}));
  const followersResult=Promise.allSettled(pending);
  const result=[...(await firstResult),...(await followersResult)];assert(result.some(r=>r.status==='rejected'&&r.reason.code==='STOMP_SEND_TIMEOUT'&&r.reason.outcomeUnknown===true));assert(result.some(r=>r.status==='rejected'&&r.reason.outcomeUnknown===false));assert.equal(c.state(),'closed');
 });
 for(const limits of [{maxPendingSends:1},{maxPendingSendBytes:200*1024}])await fixture(async(c)=>{
  c.socket.cork();const first=c.sendAsync('/q',Buffer.alloc(128*1024));const result=Promise.allSettled([first]);await assert.rejects(c.sendAsync('/q',Buffer.alloc(128*1024)),e=>e.code==='STOMP_SEND_LIMIT'&&!e.outcomeUnknown);await delay(5);await assert.rejects(c.disconnect(),e=>e.code==='STOMP_ASYNC_BUSY');const r=await result;assert.equal(r[0].reason.outcomeUnknown,true);
 },limits);
 await fixture(async(c)=>{
  c.socket.cork();c.send('SEND',[['destination','/q']],Buffer.alloc(128*1024));assert(c.socket.writableNeedDrain);assert.equal(c.pendingSends,0);
  const until=Date.now()+1000;while(c.state()!=='closed'&&Date.now()<until)await delay(5);assert.equal(c.state(),'closed');assert.equal(c.error.code,'STOMP_HEARTBEAT_BACKPRESSURE');
 },{tickMs:5},'100,100');
 await fixture(async(c)=>{
  c.socket.cork();c.send('SEND',[['destination','/q']],Buffer.alloc(128*1024));assert(c.socket.writableNeedDrain);
  const until=Date.now()+1000;while(c.state()!=='closed'&&Date.now()<until)await delay(5);assert.equal(c.state(),'closed');assert.match(c.error.message,/heartbeat timeout/);
 },{tickMs:5},'0,100');
 await fixture(async(c)=>{
  const sub=await c.subscribe('/q'),commit=await c.beginTransaction(),abort=await c.beginTransaction();const read=sub.next(1000);read.catch(()=>{});
  c.socket.cork();const send=c.sendAsync('/q',Buffer.alloc(128*1024));
  for(const op of [()=>sub.unsubscribe(),()=>commit.commit(),()=>abort.abort()])await assert.rejects(op(),e=>e.code==='STOMP_ASYNC_BUSY');
  assert.equal(sub.state,'active');assert.equal(commit.state,'open');assert.equal(abort.state,'open');assert.equal(c.waiters.length,1);
  c.socket.uncork();await send;await commit.commit();await abort.abort();await sub.unsubscribe();await assert.rejects(read,e=>e.code==='STOMP_HANDLE');assert.equal(commit.state,'committed');assert.equal(abort.state,'aborted');assert.equal(sub.state,'closed');
 });
 console.log(JSON.stringify({status:'PASSED',scope:'real numeric-loopback TCP, scripted peer; no broker',ordered_messages:48,write_false_observed:falseWrites,queued_cancel_unknown:false,attempted_timeout_unknown:true,stop_and_disconnect_cleanup:true}));
})().catch(e=>{console.error(e);process.exitCode=1;});
