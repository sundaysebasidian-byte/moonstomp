'use strict';
// New real TLS broker fixture. It does not claim to recover the historical fixture.
const assert=require('node:assert/strict'),fs=require('node:fs'),tls=require('node:tls');
const {performance}=require('node:perf_hooks');
const {TcpClient}=require('../transport/tcp.cjs');
const {frameStream,frameCommand}=require('../examples/receipt-loss-relay.cjs');
(async()=>{
 const port=Number(process.env.STOMP_PORT);assert(Number.isInteger(port)&&port>0&&port<65536);
 const ca=fs.readFileSync(process.env.STOMP_TLS_CA),pfx=fs.readFileSync(process.env.STOMP_DEMO_PFX);
 const period=Number(process.env.STOMP_HEARTBEAT_PERIOD_MS||100);assert([100,1000].includes(period));
 const sockets=new Set();let connects=0,outgoing=0,incoming=0,dropped=0,drop=false,businessSends=0,upstreamTlsVerified=false,client,server,connectedAt,brokerHeartbeat;let earlyEols=0,totalBrokerEols=0;
 let rejectRelay;const relayFailure=new Promise((_,reject)=>{rejectRelay=reject;});relayFailure.catch(()=>{});
 const track=s=>{sockets.add(s);s.on('close',()=>sockets.delete(s));s.on('error',()=>{});return s;};
 const wait=ms=>new Promise(r=>setTimeout(r,ms));let failure;
 try{
  server=tls.createServer({pfx,passphrase:'profile-test-only'},down=>{
   connects++;track(down);const up=track(tls.connect({host:'127.0.0.1',port,ca,servername:'localhost'}));
   const outbound=frameStream(b=>{if(frameCommand(b)==='SEND')businessSends++;up.write(b);},b=>{outgoing++;up.write(b);});
   const inbound=frameStream(b=>{if(frameCommand(b)==='CONNECTED'){brokerHeartbeat=b.toString().match(/heart-beat:([^\n\r]*)/)?.[1];assert.equal(brokerHeartbeat,period+','+period);connectedAt=performance.now();}down.write(b);},b=>{totalBrokerEols++;if(connectedAt!==undefined&&performance.now()-connectedAt>=period)incoming++;else earlyEols++;if(drop)dropped+=b.length;else down.write(b);});
   const fail=e=>{down.destroy();up.destroy();rejectRelay(e);};
   up.on('secureConnect',()=>{upstreamTlsVerified=up.authorized===true;});
   down.on('data',b=>{try{outbound.feed(b);}catch(e){fail(e);}});
   up.on('data',b=>{try{inbound.feed(b);}catch(e){fail(e);}});
   down.on('error',fail);up.on('error',fail);
   down.on('close',()=>up.destroy());up.on('close',()=>down.destroy());
  });
  server.on('connection',track);
  server.on('tlsClientError',()=>{});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  client=new TcpClient({port:server.address().port,tickMs:20,tlsOptions:{ca,servername:'localhost'}});
  await client.connect({versions:['1.2'],heartbeat:period+','+period,login:'moonstomp-test',passcode:'loopback-test-only'});
  assert.equal(client.socket.authorized,true);
  const pending=client.waitFor(()=>false,65000).catch(e=>{failure=e;});
  const deadline=performance.now()+45000;
  while((outgoing<2||incoming<2)&&performance.now()<deadline&&!failure)await Promise.race([wait(20),relayFailure]);
  assert(outgoing>=2&&incoming>=2,'two real heartbeats required in both directions');drop=true;
  await Promise.race([pending,relayFailure]);assert.equal(businessSends,0);assert.equal(upstreamTlsVerified,true);assert(failure&&/heartbeat timeout/.test(failure.message));assert(dropped>0);
  assert.equal(client.state(),'closed');assert.equal(client.timer,null);assert.equal(client.waiters.length,0);assert.equal(client.socket.destroyed,true);assert.equal(connects,1);
 }finally{if(client)client.stop();for(const s of sockets)s.destroy();if(server)await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(new Error('relay close timeout')),1000);server.close(e=>{clearTimeout(t);e?reject(e):resolve();});});}
 await wait(30);assert.equal(sockets.size,0);
 console.log(JSON.stringify({status:'PASSED',tls:true,version:'1.2',real_broker:true,negotiated_period_ms:period,broker_heartbeat_header:brokerHeartbeat,broker_total_eols:totalBrokerEols,excluded_early_eols:earlyEols,idle_window_after_ms:period,client_heartbeats:outgoing,broker_heartbeats:incoming,dropped_broker_bytes:dropped,heartbeat_timeout:true,connections:connects,no_reconnect:true,open_relay_sockets:sockets.size,business_SENDs:businessSends,upstream_tls_verified:upstreamTlsVerified}));
})().catch(error=>{console.error(JSON.stringify({status:'FAILED',scope:'real TLS heartbeat fixture; inspect private runner evidence',reason:error.message}));process.exitCode=1;});
