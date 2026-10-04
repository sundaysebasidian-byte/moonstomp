'use strict';
// Actual numeric-loopback sockets against scripted peers; not broker evidence.
const assert = require('node:assert/strict');
const net = require('node:net');
const {TcpClient} = require('../transport/tcp.cjs');
async function listen() {
  const sockets = new Set();
  const server = net.createServer(socket => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket));
    let pending = '';
    socket.on('data', bytes => {
      pending += bytes.toString();
      while (pending.includes('\0')) {
        const at = pending.indexOf('\0'), frame = pending.slice(0, at);
        pending = pending.slice(at + 1);
        if (frame.startsWith('CONNECT\n')) socket.write('CONNECTED\nversion:1.2\n\n\0');
        else if (frame.startsWith('SUBSCRIBE\n')) socket.write('MESSAGE\nsubscription:s\nmessage-id:one\ndestination:tasks\n\nv\0');
        else {
          const id = frame.match(/\nreceipt:([^\n]+)/)?.[1];
          if (id) socket.write('RECEIPT\nreceipt-id:' + id + '\n\n\0');
        }
      }
    });
  });
  await new Promise((resolve,reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return {port:server.address().port,close:async() => { for (const s of sockets) s.destroy(); await new Promise(resolve => server.close(resolve)); }};
}
const results=[];const unhandled=[];
// Observe rather than conceal rejected callback promises in this test process.
const recordUnhandled=error=>unhandled.push(error.message);
process.on('unhandledRejection',recordUnhandled);
async function check(name,fn) { try { await fn(); results.push({name,status:'PASSED'}); } catch(e) { results.push({name,status:'FAILED',error:e.message}); } }
(async()=>{
  await check('host-validation-before-network', async()=>{
    for (const host of [null,0,{},'', ' ']) assert.throws(()=>new TcpClient({host}),/invalid TCP configuration/);
  });
  await check('async-and-nonboolean-predicate-contract',async()=>{
    const c=new TcpClient();
    try {
      await assert.rejects(c.waitFor(async()=>false,30),/synchronous boolean/);
      assert.equal(c.waiters.length,0);
      c.deliver({event:'receipt',id:'queued'});
      await assert.rejects(c.waitFor(()=>Promise.resolve(false),30),/synchronous boolean/);
      assert.equal(c.queue.length,1);
      await assert.rejects(c.waitFor(()=>({matched:false}),30),/synchronous boolean/);
      assert.equal(c.queue.length,1);
      await assert.rejects(c.waitFor(()=>{throw new Error('caller predicate');},30),/caller predicate/);
      assert.equal((await c.waitFor(e=>e.id==='queued')).id,'queued');
      assert.equal(c.queueBytes,0);
    } finally {c.stop();}
  });
  await check('reserved-connect-and-receipt-events',async()=>{
    const peer=await listen();const c=new TcpClient({port:peer.port});
    const generic=c.waitFor(()=>true,800);generic.catch(()=>{});
    try {
      await c.connect({heartbeat:'0,0'});
      assert.equal(c.waiters.length,1);
      const received=await c.receipt('SEND',[['destination','tasks']],Buffer.from('job'),'reserved');
      assert.equal(received.id,'reserved');assert.equal(c.waiters.length,1);
      c.send('SUBSCRIBE',[['id','s'],['destination','tasks']]);
      assert.equal((await generic).event,'message');
      assert.equal(c.queue.length,0);assert.equal(c.queueBytes,0);
      await c.disconnect();assert.equal(c.timer,null);assert.equal(c.socket.destroyed,true);
    } finally {c.stop();await peer.close();}
  });
  await check('received-promise-predicate-closes-and-cleans',async()=>{
    const peer=await listen();const c=new TcpClient({port:peer.port});
    try {
      await c.connect({heartbeat:'0,0'});
      const bad=c.waitFor(()=>Promise.reject(new Error('async caller')),800);bad.catch(()=>{});
      c.send('SUBSCRIBE',[['id','s'],['destination','tasks']]);
      await assert.rejects(bad,/synchronous boolean/);
      assert.equal(c.state(),'closed');assert.equal(c.timer,null);assert.equal(c.waiters.length,0);
      assert.equal(c.queueBytes,0);assert.equal(c.socket.destroyed,true);
    } finally {c.stop();await peer.close();}
  });
  await new Promise(resolve=>setImmediate(resolve));
  process.removeListener('unhandledRejection',recordUnhandled);
  const passed=results.every(r=>r.status==='PASSED')&&unhandled.length===0;
  console.log(JSON.stringify({passed,tests:results.length,results,unhandled_async_rejections:unhandled,scope:'scripted loopback; not broker interoperability'},null,2));
  if(!passed) process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});
