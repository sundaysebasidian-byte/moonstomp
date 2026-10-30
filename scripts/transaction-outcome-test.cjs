'use strict';
// Local observed outcome only. Scripted TCP peer, NOT broker/business truth.
const assert = require('node:assert/strict');
const net = require('node:net');
const {TcpClient} = require('../transport/tcp.cjs');
const delay = ms => new Promise(resolve => setTimeout(resolve,ms));
async function scenario(version, command, mode) {
  const seen=[], sockets=new Set(), timers=new Set();
  const server=net.createServer(socket=>{
    sockets.add(socket); socket.on('close',()=>sockets.delete(socket));socket.on('error',()=>{});
    let input=Buffer.alloc(0);
    socket.on('data',chunk=>{
      input=Buffer.concat([input,chunk]);
      while(input.length){
        if(input[0]===10){input=input.subarray(1);continue;}
        const split=input.indexOf('\n\n');if(split<0)return;
        const lines=input.subarray(0,split).toString().split('\n'), name=lines.shift();
        const headers=Object.fromEntries(lines.map(x=>{const i=x.indexOf(':');return [x.slice(0,i),x.slice(i+1)];}));
        const end=headers['content-length']===undefined?input.indexOf(0,split+2):split+2+Number(headers['content-length']);
        if(end<0||end>=input.length)return;
        input=input.subarray(end+1);seen.push(name);
        if(name==='CONNECT')socket.write(`CONNECTED\n${version==='1.0'?'':`version:${version}\n`}\n\0`);
        else if(headers.receipt && !(mode==='drop' && name===command)) {
          const timer=setTimeout(()=>{timers.delete(timer);if(!socket.destroyed)socket.write(`RECEIPT\nreceipt-id:${headers.receipt}\n\n\0`);},10);
          timers.add(timer);
        }
      }
    });
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const client=new TcpClient({port:server.address().port,controlTimeoutMs:150,maxWaiters:1});
  try {
    await client.connect({versions:[version],heartbeat:'0,0'});
    const tx=await client.beginTransaction();
    assert.deepEqual(tx.outcome,{status:'not-requested',operation:null,receiptId:null,errorCode:null});
    assert(Object.isFrozen(tx.outcome));const initial=tx.outcome;
    // Invalid public receipt commands must not contaminate errors or this handle's evidence.
    for(const invalid of [{passcode:'private-outcome-marker'},'SEND\nprivate-outcome-marker','private-outcome-marker',null]){
      const error=await client.receipt(invalid).then(()=>assert.fail('invalid command accepted'),e=>e);
      assert.equal(error.code,'STOMP_ARGUMENT');assert.equal(error.operation,'receipt');
      assert.equal(error.cause,undefined);assert.equal(error.outcomeUnknown,undefined);
      assert(!require('node:util').inspect(error).includes('private-outcome-marker'));
      assert.strictEqual(tx.outcome,initial);assert.equal(client.state(),'active');
      assert.equal(client.waiters.length,0);
    }
    assert.throws(()=>{tx.outcome.status='confirmed';},TypeError);
    assert.throws(()=>{tx.outcome={status:'confirmed'};},TypeError);
    tx.send('/queue/observed',Buffer.from('PRIVATE_PAYLOAD_NOT_IN_METADATA'));
    let ordinaryWait;
    if(mode==='waiter-limit'){ordinaryWait=client.waitFor(()=>false,10000);ordinaryWait.catch(()=>{});}
    if(mode==='buffer-limit')Object.defineProperty(client.socket,'writableLength',{configurable:true,get:()=>2*1024*1024});
    if(mode==='stopped-before-finish'){
      client.stop();assert.equal(tx.state,'failed');
      await assert.rejects(tx[command==='COMMIT'?'commit':'abort'](),/not open/);
      assert.strictEqual(tx.outcome,initial);assert.equal(seen.filter(x=>x===command).length,0);
      return console.log(`PASS ${version} ${command} ${mode}`);
    }
    const finish=tx[command==='COMMIT'?'commit':'abort']();finish.catch(()=>{});
    const pending=tx.outcome;assert.equal(pending.status,'pending');assert.equal(pending.operation,command);
    await assert.rejects(tx[command==='COMMIT'?'abort':'commit'](),/not open/);
    let failure;
    try{await finish;}catch(e){failure=e;}
    assert.equal(pending.status,'pending','retained snapshot must not mutate');
    assert.equal(initial.status,'not-requested');
    if(mode==='confirm'){
      assert.equal(failure,undefined);assert.equal(tx.state,command==='COMMIT'?'committed':'aborted');
      assert.deepEqual(tx.outcome,{status:'confirmed',operation:command,receiptId:tx.outcome.receiptId,errorCode:null});
      assert.match(tx.outcome.receiptId,/^r-\d+$/);
      await client.disconnect();assert.equal(tx.outcome.status,'confirmed');
    }else{
      assert(failure);assert.equal(tx.state,'failed');
      assert.equal(tx.outcome.status,mode==='drop'?'unknown':'not-sent');
      assert.equal(failure.outcomeUnknown,mode==='drop');
      assert.equal(tx.outcome.receiptId,failure.receiptId);
      assert.equal(tx.outcome.errorCode,failure.code);
      if(mode==='drop'){assert.equal(client.state(),'closed');assert.equal(tx.outcome.errorCode,'STOMP_RECEIPT_TIMEOUT');}
      if(mode==='waiter-limit')assert.equal(client.state(),'active','preflight refusal must keep live client');
    }
    const terminal=tx.outcome;assert(Object.isFrozen(terminal));
    const terminalText=JSON.stringify(terminal);
    if(failure){failure.outcomeUnknown=!failure.outcomeUnknown;failure.receiptId='MUTATED';failure.code='MUTATED';}
    assert.equal(JSON.stringify(tx.outcome),terminalText,'mutating caught Error must not rewrite stored outcome');
    await assert.rejects(tx.commit(),/not open/);await assert.rejects(tx.abort(),/not open/);
    assert.strictEqual(tx.outcome,terminal,'duplicate finish must not erase terminal evidence');
    assert(!JSON.stringify(terminal).includes('PRIVATE_PAYLOAD'));
    assert.deepEqual(Object.keys(terminal).sort(),['errorCode','operation','receiptId','status']);
    // Close and bound observation; no infinite claim about delivery or broker state.
    if(client.state()==='active'){
      client.stop();if(ordinaryWait)await assert.rejects(ordinaryWait);
    }
    await delay(20);
    assert.equal(seen.filter(x=>x===command).length,['confirm','drop'].includes(mode)?1:0);
    assert.equal(seen.filter(x=>x===(command==='COMMIT'?'ABORT':'COMMIT')).length,0);
    console.log(`PASS ${version} ${command} ${mode}: ${terminal.status}`);
  }finally{
    client.stop();for(const timer of timers)clearTimeout(timer);for(const s of sockets)s.destroy();
    await new Promise(resolve=>server.close(resolve));
  }
}
(async()=>{
 for(const version of ['1.0','1.1','1.2'])for(const command of ['COMMIT','ABORT'])for(const mode of ['confirm','drop','waiter-limit','buffer-limit','stopped-before-finish'])await scenario(version,command,mode);
 console.log('PASS 30 transaction observed-outcome lifecycle scenarios; all peers cleaned up');
})().catch(error=>{console.error(error);process.exitCode=1;});
