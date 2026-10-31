'use strict';
// Deterministic local regression; external services are not contacted.
const SOURCE = require('node:path').resolve(__dirname, '..');
const assert=require('node:assert/strict');const {protocol:p}=require(SOURCE+'/transport/tcp.cjs');const rows=[];const healthy=p.create();
for(const bad of [null,undefined,0,'client',{},[],Object.create(null)])for(const op of ['state','version','close','eof','tick','send','receive']){let error;try{if(op==='tick')p.tick(bad,0n);else if(op==='send')p.send(bad,'CONNECT',[['accept-version','1.2'],['host','x']],Buffer.alloc(0),0n);else if(op==='receive')p.receive(bad,Buffer.alloc(0),0n);else p[op](bad);}catch(e){error={name:e.name,code:e.code||null};}rows.push({bad:bad===undefined?'undefined':bad===null?'null':typeof bad,op,error:error||null});assert.equal(p.state(healthy),'fresh');}
for(const clock of [-1n,9223372036854775808n,0,NaN,Infinity,'0',null])assert.throws(()=>p.tick(healthy,clock),e=>e.code==='STOMP_ARGUMENT');assert.equal(p.state(healthy),'fresh');
assert(rows.every(r=>r.error?.code==='STOMP_ARGUMENT'));console.log(JSON.stringify({cases:rows.length,invalidClockCases:7,healthyIsolated:true,rows},null,2));
