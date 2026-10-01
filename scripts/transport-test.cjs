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
  const overflow=await listen(s=>{
    let buffer='';s.on('data',bytes=>{
      buffer+=bytes.toString();
      while(buffer.includes('\0')) {
        const at=buffer.indexOf('\0'),frame=buffer.slice(0,at);buffer=buffer.slice(at+1);
        if(frame.startsWith('CONNECT\n'))s.write('CONNECTED\nversion:1.2\n\n\0');
        if(frame.startsWith('SUBSCRIBE\n'))s.write('MESSAGE\nsubscription:s\nmessage-id:a\ndestination:tasks\n\na\0MESSAGE\nsubscription:s\nmessage-id:b\ndestination:tasks\n\nb\0');
      }
    });
  });
  const q=new TcpClient({port:overflow.port,maxQueue:1});
  try {await q.connect({heartbeat:'0,0'});q.send('SUBSCRIBE',[['id','s'],['destination','tasks']]);await assert.rejects(q.waitFor(e=>e.event==='receipt'),/event queue limit/);assert.equal(q.state(),'closed');assert.equal(q.timer,null);tests++;}
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
  assert.throws(()=>limits.deliver({event:'receipt',padding:'too much padding'}),/event queue limit/);
  limits.stop();await assert.rejects(waiter,/closed/);assert.equal(limits.queueBytes,0);tests++;
  const guardPeer=await listen(s=>{
    let buffer='';
    s.on('data',b=>{
      buffer+=b.toString();
      while(buffer.includes('\0')) {
        const at=buffer.indexOf('\0'), frame=buffer.slice(0,at);buffer=buffer.slice(at+1);
        if(frame.startsWith('CONNECT\n'))s.write('CONNECTED\nversion:1.2\n\n\0');
        else {const id=frame.match(/\nreceipt:([^\n]+)/)?.[1];if(id)s.write('RECEIPT\nreceipt-id:'+id+'\n\n\0');}
      }
    });
  });
  const guarded=new TcpClient({port:guardPeer.port,maxWaiters:1});let arrivalTimer;
  try {
    await guarded.connect({heartbeat:'0,0'});
    let writes=0;const originalWrite=guarded.write.bind(guarded);
    guarded.write=bytes=>{writes++;originalWrite(bytes);};
    const occupied=guarded.waitFor(()=>false,20);occupied.catch(()=>{});
    await assert.rejects(guarded.receipt('SEND',[['destination','tasks']]),/waiter limit/);
    await assert.rejects(guarded.receipt('SEND',[['receipt','caller-id']]),/controls the receipt header/);
    await assert.rejects(guarded.receipt('SEND',null),/invalid receipt arguments/);
    assert.equal(writes,0);assert.equal(guarded.state(),'active');
    await assert.rejects(occupied,/event timeout/);
    const originalDeliver=guarded.deliver.bind(guarded);
    const arrived=new Promise((resolve,reject)=>{
      arrivalTimer=setTimeout(()=>reject(new Error('manual receipt arrival timeout')),1000);
      guarded.deliver=event=>{originalDeliver(event);if(event.event==='receipt'&&event.id==='stale'){clearTimeout(arrivalTimer);resolve();}};
    });
    guarded.send('SEND',[['destination','tasks'],['receipt','stale']]);
    await arrived;assert.equal(guarded.queue.length,1);
    await assert.rejects(guarded.receipt('SEND',[['destination','tasks']],Buffer.alloc(0),'stale'),/unconsumed receipt id/);
    assert.equal(writes,1);assert.equal(guarded.state(),'active');
    const previous=await guarded.waitFor(event=>event.event==='receipt'&&event.id==='stale');assert.equal(previous.id,'stale');
    await guarded.receipt('SEND',[['destination','tasks']],Buffer.alloc(0),'stale');
    assert.equal(writes,2);await guarded.disconnect();assert.equal(guarded.timer,null);tests++;
  } finally {clearTimeout(arrivalTimer);guarded.stop();await guardPeer.close();}
  assert.throws(()=>new TcpClient({tickMs:2147483648}),/invalid TCP configuration/);
  const invalid=new TcpClient();
  await assert.rejects(invalid.waitFor(null,10),/invalid event predicate/);
  await assert.rejects(invalid.waitFor(()=>true,2147483648),/invalid timeout/);
  assert.equal(invalid.waiters.length,0);invalid.stop();tests++;
  const beats=await listen(s=>{
    let buffer='';s.on('data',bytes=>{
      buffer+=bytes.toString();
      while(buffer.includes('\0')) {
        const at=buffer.indexOf('\0'),frame=buffer.slice(0,at);buffer=buffer.slice(at+1);
        if(frame.startsWith('CONNECT\n'))s.write('CONNECTED\nversion:1.2\n\n\0');
        if(frame.startsWith('SUBSCRIBE\n'))s.write('\n'.repeat(32)+'MESSAGE\nsubscription:s\nmessage-id:a\ndestination:tasks\n\nv\0');
      }
    });
  });
  const hb=new TcpClient({port:beats.port,maxQueue:1});
  try {
    await hb.connect({heartbeat:'0,0'});
    const observed=hb.waitFor(event=>event.event==='heartbeat');
    const message=hb.waitFor(event=>event.event==='message');
    hb.send('SUBSCRIBE',[['id','s'],['destination','tasks']]);
    assert.equal((await observed).event,'heartbeat');assert.deepEqual((await message).frame.body,[118]);
    assert.equal(hb.queue.length,0);assert.equal(hb.queueBytes,0);assert.equal(hb.state(),'active');tests++;
  } finally {hb.stop();await beats.close();}
  const retirePeer=await listen(s=>{
    let buffer='';
    s.on('data',bytes=>{
      buffer+=bytes.toString();
      while(buffer.includes('\0')) {
        const at=buffer.indexOf('\0'),frame=buffer.slice(0,at);buffer=buffer.slice(at+1);
        const id=frame.match(/\nreceipt:([^\n]+)/)?.[1];
        if(frame.startsWith('CONNECT\n'))s.write('CONNECTED\nversion:1.2\n\n\0');
        else if(frame.startsWith('UNSUBSCRIBE\n')) {
          s.write('MESSAGE\nsubscription:s\nmessage-id:inflight\ndestination:tasks\nack:old\n\njob\0RECEIPT\nreceipt-id:'+id+'\n\n\0');
        } else if(id)s.write('RECEIPT\nreceipt-id:'+id+'\n\n\0');
      }
    });
  });
  const retiring=new TcpClient({port:retirePeer.port});
  try {
    await retiring.connect({heartbeat:'0,0'});
    await retiring.receipt('SUBSCRIBE',[['id','s'],['destination','tasks'],['ack','client-individual']]);
    const inFlight=retiring.waitFor(event=>event.event==='message');
    await retiring.receipt('UNSUBSCRIBE',[['id','s']]);
    const delivered=(await inFlight).frame;
    assert.deepEqual(delivered.body,[106,111,98]);assert.equal(retiring.state(),'active');
    retiring.send('ACK',[['id','old']]);
    await retiring.receipt('SUBSCRIBE',[['id','s'],['destination','other']]);
    await retiring.disconnect();assert.equal(retiring.timer,null);tests++;
  } finally {retiring.stop();await retirePeer.close();}
  console.log(JSON.stringify({passed:true,tests,scope:'scripted loopback TCP lifecycle and API bounds, not broker interoperability'},null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
