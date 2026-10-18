'use strict';
// Two real clients exchange only through an already-running isolated loopback
// broker. Requires the MoonBit bridge build and the separately built real Go peer.
const fs = require('node:fs');
const path = require('node:path');
const {spawn} = require('node:child_process');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {once} = require('node:events');
const {TcpClient} = require('../transport/tcp.cjs');
const {header} = require('../examples/broker-common.cjs');

function label(version) {
  if (version === '1.0') return 'wire-common';
  return ' leading:中文\nslash\\ ' + (version === '1.2' ? '\r' : '');
}
function acknowledgement(version, frame) {
  if (version === '1.0') return [['message-id',header(frame,'message-id')]];
  if (version === '1.1') return [['message-id',header(frame,'message-id')],['subscription',header(frame,'subscription')]];
  return [['id',header(frame,'ack')]];
}
function observe(child, stdout, stderr) {
  let buffer='', total=0, failure=null;
  const queued=[], waiters=[];
  function rejectAll(error) {failure=error;for(const w of waiters.splice(0)){clearTimeout(w.timer);w.reject(error);}}
  child.stdout.on('data',chunk=>{
    fs.appendFileSync(stdout,chunk);total+=chunk.length;
    if(total>65536){rejectAll(new Error('Go stdout limit'));child.kill();return;}
    buffer+=chunk.toString('utf8');
    for(let i;(i=buffer.indexOf('\n'))>=0;){
      const line=buffer.slice(0,i);buffer=buffer.slice(i+1);
      try {const event=JSON.parse(line);const at=waiters.findIndex(w=>w.event===event.event);
        if(at<0)queued.push(event);else{const w=waiters.splice(at,1)[0];clearTimeout(w.timer);w.resolve(event);}
      } catch(error){rejectAll(error);child.kill();}
    }
  });
  let stderrBytes=0;
  child.stderr.on('data',chunk=>{stderrBytes+=chunk.length;if(stderrBytes>65536){rejectAll(new Error('Go stderr limit'));child.kill();}else fs.appendFileSync(stderr,chunk);});
  child.on('error',rejectAll);
  child.on('close',(code,signal)=>rejectAll(new Error(`Go peer exited ${code}/${signal}`)));
  return event=>{
    const at=queued.findIndex(e=>e.event===event);if(at>=0)return Promise.resolve(queued.splice(at,1)[0]);
    if(failure)return Promise.reject(failure);
    return new Promise((resolve,reject)=>{const w={event,resolve,reject};w.timer=setTimeout(()=>{const at=waiters.indexOf(w);if(at>=0)waiters.splice(at,1);reject(new Error('Go event timeout: '+event));},7000);waiters.push(w);});
  };
}
async function main() {
  const peer=path.resolve(process.env.MOONSTOMP_GO_PEER||'');
  const output=path.resolve(process.env.MOONSTOMP_INTEROP_OUTPUT||'');
  const host=process.env.STOMP_HOST||'127.0.0.1',port=Number(process.env.STOMP_PORT||61613);
  if(host!=='127.0.0.1'||!process.env.MOONSTOMP_GO_PEER||!process.env.MOONSTOMP_INTEROP_OUTPUT||!Number.isInteger(port)||port<1||port>65535)throw new Error('explicit peer/output and numeric IPv4 loopback required');
  const build=JSON.parse(fs.readFileSync(path.join(path.dirname(peer),'build.json'),'utf8'));
  const digest=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  assert.equal(build.status,'BUILT_NOT_RUN');
  assert.equal(build.go_stomp_commit,'c155a2d699bb5bc1b2547a4382b3cdd7f4403648');
  assert.equal(build.binary_sha256,digest(peer));
  assert.equal(build.peer_source_sha256,digest(path.join(__dirname,'../tests/interop/go-peer/main.go')));
  fs.mkdirSync(output,{recursive:false});
  fs.writeFileSync(path.join(output,'verified-peer-build.json'),JSON.stringify(build,null,2)+'\n');
  const results=[];
  try {
    for(const version of ['1.0','1.1','1.2']) {
      const c=new TcpClient({host,port});let child=null,exit=null;
      try {
        await c.connect({versions:[version],heartbeat:'0,0'});assert.equal(c.version(),version);
        const stem=`/queue/moonstomp-go-${version.replaceAll('.','')}-${process.pid}-${Date.now()}`;
        const incoming=stem+'-go',outgoing=stem+'-moon';
        await c.receipt('SUBSCRIBE',[['id','moon'],['destination',outgoing],['ack','client']]);
        child=spawn(peer,['-version',version,'-port',String(port),'-incoming',incoming,'-outgoing',outgoing,'-trace',path.join(output,version+'.go-wire.jsonl')],{stdio:['ignore','pipe','pipe']});
        exit=once(child,'exit');exit.catch(()=>{});
        const wait=observe(child,path.join(output,version+'.go.stdout.jsonl'),path.join(output,version+'.go.stderr.txt'));
        const ready=await wait('ready');assert.equal(ready.selected_version,version);assert.equal(ready.subscription_receipt,true);
        const message=c.waitFor(e=>e.event==='message');message.catch(()=>{});
        await c.receipt('SEND',[['destination',incoming],['x-label',label(version)]],Buffer.from([65,0,255,13,10]));
        const frame=(await message).frame;assert.deepEqual(frame.body,[65,0,255,13,10]);assert.equal(header(frame,'x-label'),label(version));
        const ack=acknowledgement(version,frame);assert(ack.every(h=>typeof h[1]==='string'&&h[1].length));
        await c.receipt('ACK',ack);
        const done=await wait('done');assert.equal(done.selected_version,version);assert.equal(done.node_to_go_verified,true);assert.equal(done.go_to_node_sent_receipt,true);assert.equal(done.unsubscribe_and_disconnect_completed,true);
        const [code,signal]=await exit;assert.equal(code,0);assert.equal(signal,null);
        await c.receipt('UNSUBSCRIBE',[['id','moon']]);await c.disconnect();
        results.push({version,status:'PASSED',go_actual_version:ready.selected_version,moon_actual_version:version,node_to_go_verified:true,go_to_node_verified:true,binary_octets:5,ack_headers:ack.map(h=>h[0]),scope:version==='1.0'?'common safe ASCII headers':version==='1.1'?'colon LF backslash Unicode spaces':'colon LF CR backslash Unicode spaces'});
      } finally {
        c.stop();if(child&&child.exitCode===null&&child.signalCode===null){child.kill();await Promise.race([exit,new Promise(resolve=>setTimeout(resolve,1000))]);}
      }
    }
    fs.writeFileSync(path.join(output,'interop.json'),JSON.stringify({status:'PASSED',go_stomp_commit:build.go_stomp_commit,go_peer_sha256:build.binary_sha256,go_version:build.go_version,path:'Go ↔ real broker ↔ MoonBit',results},null,2)+'\n');
  } catch(error) {
    fs.writeFileSync(path.join(output,'interop.json'),JSON.stringify({status:'FAILED',error:error.message,results},null,2)+'\n');throw error;
  }
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
