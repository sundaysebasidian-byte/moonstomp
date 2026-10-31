'use strict';
// Deterministic local regression; external services are not contacted.
const SOURCE = require('node:path').resolve(__dirname, '..');
const assert=require('node:assert/strict');const {fixture,frame,delay}=require('./review30-peer.cjs');
(async()=>{await fixture('1.2',async(c,peer)=>{const s=await c.subscribe('/q');peer().write(frame('MESSAGE',[['destination','/q'],['subscription',s.id],['message-id','m']],Buffer.from('a')));for(let i=0;i<100&&!c.queue.some(e=>e.event==='message');i++)await delay(2);const before=c.queueBytes;const m=await c.waitFor(e=>{if(e.event!=='message')return false;e.frame.body.push(...Array(1000).fill(66));return true;});console.log(JSON.stringify({before,after:c.queueBytes,queue:c.queue.length,body:m.frame.body.length}));assert.equal(c.queue.length,0);assert.equal(c.queueBytes,0,'caller-visible mutable event must not make accounting negative');});})().catch(e=>{console.error(e);process.exitCode=1});
