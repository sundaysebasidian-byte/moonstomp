'use strict';
// Scripted loopback peers, NOT broker interoperability. Real default 5000ms control timeouts.
const net = require('node:net');
const assert = require('node:assert/strict');
const {TcpClient} = require('../transport/tcp.cjs');
async function check(version, operation) {
  const sockets=new Set(); let controls=0;
  const server=net.createServer(socket=>{
    sockets.add(socket);socket.on('close',()=>sockets.delete(socket));
    let pending='';socket.on('data',bytes=>{
      pending+=bytes.toString();
      for(let at;(at=pending.indexOf('\0'))>=0;){
        const frame=pending.slice(0,at);pending=pending.slice(at+1);
        if(frame.startsWith('CONNECT\n'))socket.write('CONNECTED\nversion:'+version+'\n\n\0');
        else if(frame.startsWith(operation+'\n'))controls++;
        // Deliberately no RECEIPT; no fake successful acknowledgment.
      }
    });
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const c=new TcpClient({port:server.address().port});
  try {
    await c.connect({versions:[version],heartbeat:'0,0'});
    await assert.rejects(c.waitFor(e=>e.event==='message',10),/event timeout/);
    assert.equal(c.state(),'active'); // ordinary observer timeout must not close
    const other=c.waitFor(()=>false,10000);other.catch(()=>{});
    await assert.rejects(operation==='DISCONNECT'?c.disconnect():c.receipt('SEND',[['destination','tasks']]), error =>
      error.code === 'STOMP_RECEIPT_TIMEOUT' && error.operation === operation &&
      typeof error.receiptId === 'string' && error.outcomeUnknown === true &&
      error.cause.code === 'STOMP_EVENT_TIMEOUT');
    assert.equal(c.state(),'closed');
    await assert.rejects(other,/event timeout|closed/);
    assert.equal(c.waiters.length,0);assert.equal(c.queue.length,0);assert.equal(c.queueBytes,0);
    assert.equal(c.timer,null);assert.equal(c.socket.destroyed,true);assert.equal(controls,1);
    await assert.rejects(c.receipt('SEND',[['destination','tasks']]),/event timeout|not active|closed/);
    assert.equal(controls,1);
    return {version,operation,status:'PASSED'};
  } finally {c.stop();for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));}
}
(async()=>{
  const results=await Promise.all(['1.0','1.1','1.2'].flatMap(version=>['SEND','DISCONNECT'].map(async operation=>{
    try{return await check(version,operation);}catch(error){return {version,operation,status:'FAILED',error:error.message};}
  })));
  const passed=results.every(r=>r.status==='PASSED');
  console.log(JSON.stringify({passed,tests:results.length,real_timeout_ms:5000,scope:'scripted loopback only',results},null,2));
  if(!passed)process.exitCode=1;
})().catch(error=>{console.error(error);process.exitCode=1;});
