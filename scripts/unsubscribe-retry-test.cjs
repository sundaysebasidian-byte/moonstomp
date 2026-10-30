'use strict';
const assert=require('node:assert/strict'),net=require('node:net');
const {TcpClient}=require('../transport/tcp.cjs');
(async()=>{const results=[];
for(const version of ['1.0','1.1','1.2']){
 const received=[],sockets=new Set();let peer;
 const server=net.createServer(s=>{peer=s;sockets.add(s);s.on('close',()=>sockets.delete(s));s.on('error',()=>{});let b='';s.on('data',d=>{b+=d.toString();while(b.includes('\0')){const n=b.indexOf('\0'),f=b.slice(0,n);b=b.slice(n+1);received.push(f);if(f.startsWith('CONNECT\n'))s.write(`CONNECTED\n${version==='1.0'?'':`version:${version}\n`}\n\0`);else{const id=f.match(/\nreceipt:([^\n]+)/)?.[1];if(id)s.write(`RECEIPT\nreceipt-id:${id}\n\n\0`);}}});});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const c=new TcpClient({port:server.address().port,maxWaiters:1});
 try {await c.connect({versions:[version],heartbeat:'0,0'});const sub=await c.subscribe('/queue/probe',{id:'probe'});const wait=c.waitFor(()=>false,50);wait.catch(()=>{});let err;try{await sub.unsubscribe();}catch(e){err=e;}assert(err);await assert.rejects(wait);const sent=received.filter(x=>x.startsWith('UNSUBSCRIBE\n')).length;assert.equal(sub.state,'active');const next=sub.next(1000);peer.write(`MESSAGE\nmessage-id:m\n${version==='1.0'?'':'subscription:probe\n'}destination:/queue/probe\n\nbody\0`);assert.equal((await next).command,'MESSAGE');let retry;await sub.unsubscribe();assert.equal(sub.state,'closed');assert.equal(received.filter(x=>x.startsWith('UNSUBSCRIBE\n')).length,1);results.push({version,firstAttemptSent:sent,errorCode:err.code,outcomeUnknown:err.outcomeUnknown,recoveredAndReadMessage:true,retryConfirmed:true,terminalHandleState:sub.state});assert.equal(sent,0);assert.equal(c.state(),'active');

 } finally {c.stop();for(const s of sockets)s.destroy();await new Promise(r=>server.close(r));}
}
console.log(JSON.stringify(results,null,2));})().catch(e=>{console.error(e);process.exitCode=1;});
