'use strict';
// Scripted loopback peers test transport lifecycle only; these are not real brokers.
const net = require('node:net');
const assert = require('node:assert/strict');
const {TcpClient} = require('../transport/tcp.cjs');
async function listen(handler) {
  const sockets=new Set();
  const server=net.createServer(s=>{sockets.add(s);s.on('close',()=>sockets.delete(s));handler(s);});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  return {port:server.address().port,close:async()=>{for(const s of sockets)s.destroy();await new Promise(resolve=>server.close(resolve));}};
}
(async()=>{
  let tests=0;
  const peer=await listen(s=>{
    let buffer=''; let initial=true;
    s.on('data',b=>{
      buffer+=b.toString();
      while(buffer.includes('\0')) {
        const at=buffer.indexOf('\0'), frame=buffer.slice(0,at);buffer=buffer.slice(at+1);
        if(initial) {initial=false;s.write('CONNECTED\nversion:1.2\n\n\0');}
        else {const id=frame.match(/\nreceipt:([^\n]+)/)?.[1];if(id)s.write('RECEIPT\nreceipt-id:'+id+'\n\n\0');}
      }
    });
  });
  const c=new TcpClient({port:peer.port});
  try {
    await c.connect({heartbeat:'0,0'});
    await c.receipt('SEND',[['destination','tasks']],Buffer.from('job'));
    await assert.rejects(c.waitFor(e=>e.event==='message',10),/event timeout/);
    assert.equal(c.waiters.length,0);
    await c.disconnect();
    assert.equal(c.state(),'closed');assert.equal(c.timer,null);assert.equal(c.socket.destroyed,true);tests++;
  } finally {c.stop();await peer.close();}
  const overflow=await listen(s=>s.once('data',()=>{s.write('CONNECTED\nversion:1.2\n\n\0');setTimeout(()=>{if(!s.destroyed)s.write('\n\n');},10);}));
  const q=new TcpClient({port:overflow.port,maxQueue:1});
  try {await q.connect({heartbeat:'0,0'});await assert.rejects(q.waitFor(e=>e.event==='message'),/event queue limit/);assert.equal(q.state(),'closed');assert.equal(q.timer,null);tests++;}
  finally{q.stop();await overflow.close();}
  const eof=await listen(s=>s.once('data',()=>s.end('CONNECTED\nversion:1.2\n\n\0MESS')));
  const e=new TcpClient({port:eof.port});
  try {await e.connect({heartbeat:'0,0'});await assert.rejects(e.waitFor(x=>x.event==='message'),/truncated STOMP stream|closed/);assert.equal(e.state(),'closed');tests++;}
  finally{e.stop();await eof.close();}
  const unavailable=await listen(()=>{});const port=unavailable.port;await unavailable.close();
  const r=new TcpClient({port});
  try {await assert.rejects(r.connect());assert.equal(r.state(),'closed');assert.equal(r.timer,null);tests++;}
  finally{r.stop();}
  const failHandshake=await listen(s=>s.once('data',()=>s.write('CONNECTED\nversion:1.2\n\n\0ERROR\nmessage:closed\n\n\0')));
  const failed=new TcpClient({port:failHandshake.port});
  try {await assert.rejects(failed.connect(),/broker ERROR frame|closed/);assert.equal(failed.timer,null);assert.equal(failed.state(),'closed');tests++;}
  finally{failed.stop();await failHandshake.close();}
  const limits=new TcpClient({maxWaiters:1,maxQueueBytes:25});
  const waiter=limits.waitFor(e=>e.event==='message',1000);waiter.catch(()=>{});
  await assert.rejects(limits.waitFor(e=>e.event==='receipt'),/waiter limit/);
  assert.throws(()=>limits.deliver({event:'heartbeat',padding:'too much padding'}),/event queue limit/);
  limits.stop();await assert.rejects(waiter,/closed/);assert.equal(limits.queueBytes,0);tests++;
  console.log(JSON.stringify({passed:true,tests,scope:'scripted loopback TCP lifecycle, not broker interoperability'},null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
