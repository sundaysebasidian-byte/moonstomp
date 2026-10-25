'use strict';
// Actual TCP; deliberate event-loop/callback delay, not a simulated broker.
const assert=require('node:assert/strict'),net=require('node:net');
const {test}=require('node:test'),{performance}=require('node:perf_hooks');
const {TcpClient}=require('../transport/tcp.cjs');
const {frameStream}=require('../examples/receipt-loss-relay.cjs');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const stall=ms=>{const end=performance.now()+ms;while(performance.now()<end){}};
async function fixture(run){
 const peers=new Set(),bodies=[];
 const server=net.createServer(s=>{
  peers.add(s);s.on('error',()=>{});s.on('close',()=>peers.delete(s));
  const frames=frameStream(b=>{
   if(b.subarray(0,8).toString()==='CONNECT\n')s.write('CONNECTED\nversion:1.2\nheart-beat:0,0\n\n\0');
   else if(b.subarray(0,5).toString()==='SEND\n')bodies.push(b.subarray(b.indexOf(Buffer.from('\n\n'))+2,b.length-1).toString());
  });s.on('data',b=>frames.feed(b));
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const c=new TcpClient({port:server.address().port});
 try{await c.connect({heartbeat:'0,0'});await run(c,bodies);}
 finally{c.stop();for(const s of peers)s.destroy();await new Promise(r=>server.close(r));}
 assert.equal(c.pendingSends,0);assert.equal(c.pendingSendBytes,0);assert.equal(c.socket.listenerCount('drain'),0);assert.equal(c.timer,null);
}
test('expired queued SEND is never written after an event-loop stall',async()=>{
 await fixture(async(c,bodies)=>{
  const first=c.sendAsync('/q',Buffer.from('expired'),{timeoutMs:10});
  const rejected=assert.rejects(first,e=>e.code==='STOMP_SEND_TIMEOUT'&&e.outcomeUnknown===false);
  stall(50);await rejected;assert.equal(c.state(),'active');
  await c.sendAsync('/q',Buffer.from('fresh'));await delay(20);
  assert.deepEqual(bodies,['fresh']);
 });
});
test('late local completion is unknown and closes without replaying queued SEND',async()=>{
 await fixture(async(c,bodies)=>{
  let attempted=0;const write=c.socket.write.bind(c.socket);
  c.socket.write=(bytes,callback)=>{attempted++;return write(bytes,error=>{stall(50);callback(error);});};
  const first=c.sendAsync('/q',Buffer.from('attempted'),{timeoutMs:10});
  const queued=c.sendAsync('/q',Buffer.from('unsent'),{timeoutMs:1000});
  const results=await Promise.allSettled([first,queued]);
  assert.equal(results[0].status,'rejected');assert.equal(results[0].reason.code,'STOMP_SEND_TIMEOUT');assert.equal(results[0].reason.outcomeUnknown,true);
  assert.equal(results[1].status,'rejected');assert.equal(results[1].reason.outcomeUnknown,false);
  assert.equal(attempted,1);assert.equal(c.state(),'closed');await delay(20);
  assert(bodies.length<=1);assert(!bodies.includes('unsent'));
 });
});
