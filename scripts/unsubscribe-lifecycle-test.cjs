'use strict';
const assert=require('node:assert/strict');
const {Subscription}=require('../transport/handles.cjs');
(async()=>{
 for(const mode of ['not-sent','unknown','closed','success']){
  let state='active',resolve,reject;
  const client={state:()=>state,version:()=> '1.2',_requireSyncTurn(){},receipt:()=>new Promise((a,b)=>{resolve=a;reject=b;}),_waitFor:(_p,_t,_x,signal)=>{assert.equal(signal.aborted,false);return Promise.resolve({frame:{headers:[],command:'MESSAGE'}});}};
  const sub=new Subscription(client,'s','/queue/test','auto');const p=sub.unsubscribe();p.catch(()=>{});assert.equal(sub.state,'closing');await assert.rejects(sub.unsubscribe(),/not active/);
  if(mode==='success')resolve({event:'receipt'});else{if(mode==='closed')state='closed';reject(Object.assign(new Error('test refusal'),{outcomeUnknown:mode==='unknown'}));}
  if(mode==='success')await p;else await assert.rejects(p,/test refusal/);
  if(mode==='not-sent'){assert.equal(sub.state,'active');assert.equal((await sub.next()).command,'MESSAGE');}else{assert.equal(sub.state,'closed');await assert.rejects(sub.next(),/not active/);}
 }
 console.log('PASS 4 isolated lifecycle transition controls (not broker evidence)');
})().catch(e=>{console.error(e);process.exitCode=1;});
