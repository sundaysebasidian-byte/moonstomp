'use strict';
// New real TLS broker fixture. It does not claim to recover the historical fixture.
const assert=require('node:assert/strict'),fs=require('node:fs'),tls=require('node:tls');
const {TcpClient}=require('../transport/tcp.cjs');
const {frameStream}=require('../examples/receipt-loss-relay.cjs');
(async()=>{
 const port=Number(process.env.STOMP_PORT);assert(Number.isInteger(port)&&port>0&&port<65536);
 const ca=fs.readFileSync(process.env.STOMP_TLS_CA),pfx=fs.readFileSync(process.env.STOMP_DEMO_PFX);
 const sockets=new Set();let connects=0,outgoing=0,incoming=0,dropped=0,drop=false,client,server;
 const track=s=>{sockets.add(s);s.on('close',()=>sockets.delete(s));s.on('error',()=>{});return s;};
 const wait=ms=>new Promise(r=>setTimeout(r,ms));let failure;
 try{
  server=tls.createServer({pfx,passphrase:'profile-test-only'},down=>{
   connects++;track(down);const up=track(tls.connect({host:'127.0.0.1',port,ca,servername:'localhost'}));
   const outbound=frameStream(b=>up.write(b),b=>{outgoing++;up.write(b);});
   const inbound=frameStream(b=>down.write(b),b=>{incoming++;if(drop)dropped+=b.length;else down.write(b);});
   down.on('data',b=>outbound.feed(b));
   up.on('data',b=>inbound.feed(b));
   down.on('close',()=>up.destroy());up.on('close',()=>down.destroy());
  });
  server.on('tlsClientError',()=>{});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  client=new TcpClient({port:server.address().port,tickMs:20,tlsOptions:{ca,servername:'localhost'}});
  await client.connect({versions:['1.2'],heartbeat:'100,100',login:'moonstomp-test',passcode:'loopback-test-only'});
  assert.equal(client.socket.authorized,true);
  const pending=client.waitFor(()=>false,65000).catch(e=>{failure=e;});
  const deadline=Date.now()+45000;
  while((outgoing<2||incoming<2)&&Date.now()<deadline&&!failure)await wait(20);
  assert(outgoing>=2&&incoming>=2,'two real heartbeats required in both directions');drop=true;
  await pending;assert(failure&&/heartbeat timeout/.test(failure.message));assert(dropped>0);
  assert.equal(client.state(),'closed');assert.equal(client.timer,null);assert.equal(client.waiters.length,0);assert.equal(client.socket.destroyed,true);assert.equal(connects,1);
 }finally{if(client)client.stop();for(const s of sockets)s.destroy();if(server)await new Promise(r=>server.close(r));}
 await wait(30);assert.equal(sockets.size,0);
 console.log(JSON.stringify({status:'PASSED',tls:true,version:'1.2',real_broker:true,client_heartbeats:outgoing,broker_heartbeats:incoming,dropped_broker_bytes:dropped,heartbeat_timeout:true,connections:connects,no_reconnect:true,open_relay_sockets:sockets.size,business_SENDs:0}));
})().catch(error=>{console.error(JSON.stringify({status:'FAILED',scope:'real TLS heartbeat fixture; inspect private runner evidence',reason:error.message}));process.exitCode=1;});
