'use strict';
const assert=require('node:assert/strict'),net=require('node:net');
const path=require('node:path');
const SRC=path.resolve(__dirname, '..');
const {TcpClient}=require(SRC+'/transport/tcp.cjs');
let serial=0;const results=[];
const body=f=>Buffer.from(f.body).toString();
function message(id,destination,text,legacy=false){return `MESSAGE\nmessage-id:${++serial}\ndestination:${destination}\n${legacy?'':`subscription:${id}\n`}\n${text}\0`;}
async function fixture(version, callback){
 const sockets=new Set();let peer,hook=()=>'';
 const server=net.createServer(s=>{peer=s;sockets.add(s);s.on('error',()=>{});s.on('close',()=>sockets.delete(s));let acc='';s.on('data',chunk=>{acc+=chunk;for(;;){let cut=acc.indexOf('\0');if(cut<0)break;const raw=acc.slice(0,cut);acc=acc.slice(cut+1);const lines=raw.split('\n'),cmd=lines.shift(),h=Object.fromEntries(lines.filter(x=>x.includes(':')).map(x=>[x.slice(0,x.indexOf(':')),x.slice(x.indexOf(':')+1)]));if(cmd==='CONNECT'){s.write(`CONNECTED\n${version==='1.0'?'':`version:${version}\n`}\n\0`);continue;}const before=hook(cmd,h)||'';s.write(before+(h.receipt?`RECEIPT\nreceipt-id:${h.receipt}\n\n\0`:''));}});});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const c=new TcpClient({port:server.address().port,controlTimeoutMs:700,maxQueue:4,maxQueueBytes:1600});
 try{await c.connect({versions:[version],heartbeat:'0,0'});await callback(c, f=>hook=f,()=>peer);}
 finally{c.stop();assert.equal(c.queueBytes,0);assert.equal(c.queue.length,0);assert.equal(c.waiters.length,0);for(const s of sockets)s.destroy();await new Promise(r=>server.close(r));}
}
async function generation(version,same,legacy){await fixture(version,async(c,setHook)=>{
 const oldDst='/old',newDst=same?oldDst:'/new';const existing=await c.subscribe('/other',{id:'other'});let old=await c.subscribe(oldDst,{id:'reuse'});let retired=false;
 setHook((cmd,h)=>{if(cmd==='UNSUBSCRIBE'&&h.id==='reuse'){retired=true;return message('reuse',oldDst,'retired',legacy)+message('other','/other','other-queued');}if(cmd==='SUBSCRIBE'&&retired&&h.id==='reuse')return message('reuse',newDst,'new-before-receipt',legacy);});
 await old.unsubscribe();assert.equal(old.state,'closed');assert.equal(c.queue.length,2);const oldBytes=c.queueBytes;
 const fresh=await c.subscribe(newDst,{id:'reuse'});assert.equal(c.queue.length,3);assert.equal(body(await fresh.next(300)),'new-before-receipt');assert.equal(c.queueBytes,oldBytes,'new message removal preserves old queue accounting');
 assert.equal(body(await existing.next(300)),'other-queued','another subscription still consumes its previously queued message');
 const timeout=fresh.next(30);await assert.rejects(timeout,e=>e.code==='STOMP_EVENT_TIMEOUT');assert.equal(c.queue.length,1,'new next must leave retired frame queued');
 const generic=await c.waitFor(e=>e.event==='message',300);assert.equal(body(generic.frame),'retired');assert.equal(c.queueBytes,0);assert.equal(c.queue.length,0);
 await assert.rejects(old.next(30),e=>e.code==='STOMP_HANDLE');
 results.push({version,sameDestination:same,legacy,passed:true,checks:'pre-receipt new delivery, old exclusion, other subscription, generic recovery, byte accounting, timeout, closed handle, cleanup'});
 });}
async function generations(version){await fixture(version,async(c,setHook)=>{
 let generation=0;setHook((cmd,h)=>cmd==='UNSUBSCRIBE'?message('cycle','/cycle',`retired-${generation}`):cmd==='SUBSCRIBE'&&h.id==='cycle'?message('cycle','/cycle',`current-${++generation}`):'');
 for(let i=1;i<=20;i++){const h=await c.subscribe('/cycle',{id:'cycle'});assert.equal(body(await h.next(300)),`current-${i}`);await h.unsubscribe();assert.equal(body((await c.waitFor(e=>e.event==='message',300)).frame),`retired-${i}`);assert.equal(c.queueBytes,0);}
 results.push({version,generations:20,passed:true,checks:'bounded repeated reuse with explicit retired-event drain'});
 });}
async function budget(version){await fixture(version,async(c,setHook)=>{
 let generation=0;setHook((cmd,h)=>cmd==='UNSUBSCRIBE'?message('cap','/cap',`retired-${generation}`):cmd==='SUBSCRIBE'&&h.id==='cap'?message('cap','/cap',`new-${++generation}`):'');
 for(let i=1;i<=4;i++){const h=await c.subscribe('/cap',{id:'cap'});assert.equal(body(await h.next(300)),`new-${i}`);await h.unsubscribe();assert.equal(c.queue.length,i);}
 await assert.rejects(c.subscribe('/cap',{id:'cap'}),e=>/event queue limit/.test(e.message));assert.equal(c.state(),'closed');assert.equal(c.queueBytes,0);assert.equal(c.queue.length,0);
 results.push({version,retainedQueueLimit:4,passed:true,checks:'retired frames remain budgeted; overflow closes and cleans queue instead of unbounded growth'});
 });}
(async()=>{for(const v of ['1.0','1.1','1.2']){await generation(v,false,false);await generation(v,true,false);await generations(v);await budget(v);}await generation('1.0',true,true);console.log(JSON.stringify({passed:true,cases:results.length,results},null,2));})().catch(e=>{console.error(JSON.stringify({passed:false,completed:results,error:e.stack},null,2));process.exitCode=1;});
