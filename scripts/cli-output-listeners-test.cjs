// Regression probes promoted from independent 2026-10-31 review; local test peers only.
'use strict';const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),{Writable}=require('node:stream'),{once}=require('node:events');
const src=path.resolve(__dirname, '..');const source=fs.readFileSync(src+'/tools/stomp-cli.cjs','utf8');const snippet=source.slice(source.indexOf('function writeLine('),source.indexOf('// Offline demonstration'));
function writer(out){return vm.runInNewContext(snippet+'\nwriteLine',{process:{stdout:out},Promise,setImmediate});}
const later=()=>new Promise(r=>setImmediate(r));
(async()=>{const rows=[];const good=new Writable({write(b,e,cb){setImmediate(cb);}});const wg=writer(good);for(let i=0;i<50;i++)await wg('line');assert.equal(good.listenerCount('error'),0);rows.push({mode:'50 successful callbacks',listeners:good.listenerCount('error')});
const bad=new Writable({write(b,e,cb){const err=Error('simulated failure');err.code='EIO';cb(err);}});await assert.rejects(writer(bad)('x'),e=>e.code==='EIO');await later();assert.equal(bad.listenerCount('error'),0);rows.push({mode:'callback error then actual Writable error event',listeners:bad.listenerCount('error')});
const thrown=new Writable({write(){throw Error('sync write throw');}});await assert.rejects(writer(thrown)('x'),/sync write throw/);await later();assert.equal(thrown.listenerCount('error'),0);rows.push({mode:'sync throw',listeners:thrown.listenerCount('error')});
const dead=new Writable({write(b,e,cb){cb();}});dead.destroy();await once(dead,'close');const wd=writer(dead);for(let i=0;i<3;i++)await assert.rejects(wd('x'),e=>e.code==='ERR_STREAM_DESTROYED');await later();rows.push({mode:'already destroyed Writable, no later error event',listeners:dead.listenerCount('error'),expected:0});assert.equal(dead.listenerCount('error'),0,'each rejected write on an already destroyed stream must remove its listener');
const closing=new Writable({write(b,e,cb){/* deliberately blocked write */}});
const closingTask=writer(closing)('x').then(()=>({state:'resolved'}),e=>({state:'rejected',code:e.code}));
closing.destroy();const closed=await Promise.race([closingTask,new Promise(r=>setTimeout(()=>r({state:'pending'}),100))]);
assert.equal(closed.state,'rejected');assert.equal(closed.code,'ERR_STREAM_DESTROYED');await later();
for(const out of [good,bad,thrown,dead,closing]){assert.equal(out.listenerCount('error'),0);assert.equal(out.listenerCount('close'),0);}
rows.push({mode:'mid-write close without error or callback',...closed,errorListeners:closing.listenerCount('error'),closeListeners:closing.listenerCount('close')});
console.log(JSON.stringify({rows},null,2));})().catch(e=>{console.error(e.stack);process.exitCode=1;});
