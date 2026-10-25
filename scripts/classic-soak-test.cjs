'use strict';
// One fixed five-minute local load window. Not a throughput ceiling or production SLO.
const assert=require('node:assert/strict'),fs=require('node:fs'),{performance}=require('node:perf_hooks');
const {TcpClient}=require('../transport/tcp.cjs');
(async()=>{
 const port=Number(process.env.STOMP_PORT);assert(Number.isInteger(port)&&port>0&&port<65536);
 const client=new TcpClient({port,tlsOptions:{ca:fs.readFileSync(process.env.STOMP_TLS_CA),servername:'localhost'}});
 const diagnostic=process.env.STOMP_SOAK_DIAGNOSTIC==='1',duration=diagnostic?6500:300000,cycle=diagnostic?6500:60000,idleStart=diagnostic?2000:56000;let startedAt;const heartbeatTimes={outgoing:[],incoming:[]};
 let attempted=0,unknown=0,progressMinute=-1;let outgoing=0,incoming=0,sent=0,received=0,acked=0,receipts=0,duplicates=0,errors=0,timeouts=0;const latencies=[],windows=[],seen=new Set();let elapsed=0,sub,negotiatedHeartbeat=null;
 const write=client.write.bind(client),deliver=client.deliver.bind(client);
 client.write=b=>{if(b.length===1&&b[0]===10){outgoing++;heartbeatTimes.outgoing.push(client.now().toString());}return write(b);};
 client.deliver=e=>{if(e.event==='heartbeat'){incoming++;heartbeatTimes.incoming.push(client.now().toString());}return deliver(e);};
 const wait=ms=>new Promise(r=>setTimeout(r,ms));
 try{
  const connecting=client.connect({versions:['1.2'],heartbeat:'1000,1000',login:'moonstomp-test',passcode:'loopback-test-only'});let handshake=Buffer.alloc(0);client.socket.on('data',bytes=>{if(negotiatedHeartbeat===null&&handshake.length<4096){handshake=Buffer.concat([handshake,bytes]);const m=handshake.toString().match(/heart-beat:([0-9]+,[0-9]+)/);if(m)negotiatedHeartbeat=m[1];}});await connecting;assert.equal(client.socket.authorized,true);
  const destination='/queue/moonstomp-five-minute-'+process.pid+'-'+Date.now();sub=await client.subscribe(destination,{ack:'client-individual'});
  const start=performance.now();startedAt=start;let next=start,lastWindow=-1,windowStart;
  while(performance.now()-start<duration){
   if(client.error)throw client.error;
   const now=performance.now(),age=now-start,window=Math.floor(age/cycle),idle=age%cycle>=idleStart;
   if(window!==progressMinute){progressMinute=window;if(process.env.STOMP_SOAK_PROGRESS)fs.writeFileSync(process.env.STOMP_SOAK_PROGRESS,JSON.stringify({elapsed_ms:age,sent,received,errors,timeouts}));}
   if(idle){if(lastWindow!==window){windowStart={window,start_ms:age,outgoing,incoming};lastWindow=window;}await wait(20);continue;}
   if(windowStart){windows.push({...windowStart,end_ms:age,outgoing_delta:outgoing-windowStart.outgoing,incoming_delta:incoming-windowStart.incoming});windowStart=null;next=now;}
   if(now<next){await wait(Math.min(20,next-now));continue;}next=now+200;
   const payload=Buffer.from('synthetic-order-'+sent);const before=performance.now();
   attempted++;await client.receipt('SEND',[['destination',destination]],payload);sent++;receipts++;
   const message=await sub.next(2000);received++;const key=Buffer.from(message.body).toString();if(seen.has(key)){duplicates++;throw new Error("duplicate payload");}seen.add(key);assert.deepEqual(Buffer.from(message.body),payload);sub.ack(message);acked++;latencies.push(performance.now()-before);
  }
  elapsed=performance.now()-start;if(windowStart)windows.push({...windowStart,end_ms:elapsed,outgoing_delta:outgoing-windowStart.outgoing,incoming_delta:incoming-windowStart.incoming});
  assert(sent>0);assert.equal(sent,received);assert.equal(sent,acked);assert.equal(sent,receipts);assert(windows.length===(diagnostic?1:5)&&windows.every(w=>w.incoming_delta>0&&w.outgoing_delta>0));
  await assert.rejects(sub.next(200),e=>e.code==='STOMP_EVENT_TIMEOUT');await sub.unsubscribe();await client.disconnect();
 }catch(error){elapsed=startedAt?performance.now()-startedAt:0;errors++;if(error.outcomeUnknown)unknown++;if(/TIMEOUT/.test(error.code||'')||/heartbeat timeout/.test(error.message||''))timeouts++;console.error(JSON.stringify({status:'FAILED',attempted_sends:attempted,outcome_unknown:unknown,sent,received,acked,receipts,errors,timeouts,reason:error.code||'unknown',detail:error.message,heartbeatTimes,negotiatedHeartbeat,diagnostic,elapsed_ms:elapsed,outgoing_heartbeats:outgoing,incoming_heartbeats:incoming,idle_windows:windows}));throw error;
 }finally{client.stop();}
 assert.equal(client.state(),'closed');assert.equal(client.timer,null);assert.equal(client.waiters.length,0);assert.equal(client.socket.destroyed,true);
 console.log(JSON.stringify({status:'PASSED',diagnostic,heartbeatTimes,scope:'real Classic TLS single connection five-minute load with five four-second heartbeat idle windows',elapsed_ms:elapsed,target_active_rate_per_second:5,attempted_sends:attempted,outcome_unknown:unknown,sent,received,acked,receipts,errors,timeouts,duplicates,unique_payloads:seen.size,expected_negative_observation_timeouts:1,outgoing_heartbeats:outgoing,incoming_heartbeats:incoming,idle_windows:windows,latency_scope:'SEND start through receipt/delivery/local ACK call; not broker persistence or ACK confirmation',latency_ms:{mean:latencies.reduce((a,b)=>a+b,0)/latencies.length,max:Math.max(...latencies)},cleanup:true}));
})().catch(()=>{process.exitCode=1;});
