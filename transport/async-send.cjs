'use strict';
const {transportError} = require('./errors.cjs');
const {performance} = require('node:perf_hooks');
// Application SENDs only. Core validation/encoding stays in MoonBit.
class AsyncSends {
  constructor(client, {count, bytes, frame}) { this.client=client; this.limits={count,bytes,frame}; this.items=[]; this.bytes=0; this.running=false; }
  error(code, message, attempted=false) { return transportError(code,message,{operation:'SEND',outcomeUnknown:attempted}); }
  deadlineError(item) { return performance.now() >= item.expiresAt ? this.error('STOMP_SEND_TIMEOUT','SEND deadline expired',item.attempted) : null; }
  enqueue(destination, body, {headers=[], timeoutMs=5000, signal}={}) {
    const started=performance.now();
    try {
      if (typeof destination!=='string'||!destination.length||!(body instanceof Uint8Array)||!Array.isArray(headers)||headers.length>126||headers.some(h=>!Array.isArray(h)||h.length!==2||h.some(v=>typeof v!=='string')||['destination','receipt'].includes(h[0]))) throw this.error('STOMP_ARGUMENT','invalid async SEND arguments');
      if (!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000||signal!==undefined&&(!(signal instanceof AbortSignal))) throw this.error('STOMP_ARGUMENT','invalid async SEND deadline/signal');
      if (signal?.aborted) throw this.error('STOMP_SEND_CANCELLED','SEND cancelled before write');
      if (this.client.state()!=='active'||this.client.error) throw this.error('STOMP_CONNECTION_CLOSED','connection is not active');
      // Conservative UTF-8/escaping upper bound, including automatic content-length.
      const size=64+body.byteLength+2*Buffer.byteLength(destination)+headers.reduce((n,h)=>n+2*(Buffer.byteLength(h[0])+Buffer.byteLength(h[1]))+2,0);
      if (!Number.isSafeInteger(size)||size>this.limits.frame||this.items.length>=this.limits.count||this.bytes+size>this.limits.bytes) throw this.error('STOMP_SEND_LIMIT','async SEND queue/frame limit');
      return new Promise((resolve,reject)=>{
        const item={headers:[['destination',destination],...headers.map(h=>h.slice())],body:Buffer.from(body),size,expiresAt:started+timeoutMs,attempted:false,resolve,reject,done:false,wake:null};
        const cancel=(code,message)=>{ const error=this.error(code,message,item.attempted); if(item.attempted)this.client.stop(error); else this.finish(item,error); };
        item.abort=()=>cancel('STOMP_SEND_CANCELLED','SEND cancelled');item.signal=signal;
        const expire=()=>{
          if(item.done)return;
          if(this.deadlineError(item))cancel('STOMP_SEND_TIMEOUT','SEND deadline expired');
          else item.timer=setTimeout(expire,Math.max(1,Math.ceil(item.expiresAt-performance.now())));
        };
        item.timer=setTimeout(expire,Math.max(1,Math.ceil(item.expiresAt-performance.now())));
        signal?.addEventListener('abort',item.abort,{once:true});
        this.items.push(item);this.bytes+=size;
        queueMicrotask(()=>this.pump());
      });
    } catch(error) { return Promise.reject(error); }
  }
  finish(item,error) {
    if(item.done)return;item.done=true;clearTimeout(item.timer);item.signal?.removeEventListener('abort',item.abort);
    const i=this.items.indexOf(item);if(i>=0){this.items.splice(i,1);this.bytes-=item.size;}
    item.wake?.(error||this.error('STOMP_CONNECTION_CLOSED','SEND retired',item.attempted));
    if(error)item.reject(error);else item.resolve({operation:'SEND',localWriteComplete:true,brokerReceipt:false});
  }
  close(error) {
    for(const item of [...this.items])this.finish(item,this.error(error?.code||'STOMP_CONNECTION_CLOSED',error?.message||'connection closed',item.attempted));
  }
  async ready(item, write) {
    const expired=this.deadlineError(item);if(expired)throw expired;
    const socket=this.client.socket;
    if(!socket||socket.destroyed)throw this.error('STOMP_CONNECTION_CLOSED','socket closed',item.attempted);
    await new Promise((resolve,reject)=>{
      let callbackDone=!write,drained=!socket.writableNeedDrain,settled=false;
      const cleanup=()=>{socket.removeListener('drain',drain);socket.removeListener('error',fail);socket.removeListener('close',closed);item.wake=null;};
      const end=error=>{if(settled)return;settled=true;cleanup();error?reject(error):resolve();};
      const check=()=>{if(callbackDone&&drained)end(this.deadlineError(item));};
      const drain=()=>{drained=true;check();};const fail=e=>end(e);const closed=()=>end(this.error('STOMP_CONNECTION_CLOSED','socket closed',item.attempted));
      item.wake=fail;socket.on('drain',drain);socket.once('error',fail);socket.once('close',closed);
      if(write){
        try {const wire=write();const expired=this.deadlineError(item);if(expired)throw expired;if(socket.writableLength+wire.length>2*1024*1024)throw this.error('STOMP_SEND_LIMIT','transport write buffer limit');item.attempted=true;const ok=socket.write(wire,e=>{if(e)end(e);else{callbackDone=true;check();}});drained=ok;check();}
        catch(e){end(e);}
      }else check();
    });
  }
  async pump() {
    if(this.running)return;this.running=true;
    try {
      while(this.items.length){
        const item=this.items[0];
        try {
          await this.ready(item);
          if(item.done)continue;
          await this.ready(item,()=>this.client._asyncSendWire(item.headers,item.body));
          this.finish(item);
        }catch(error){
          if(item.done)continue;
          if(item.attempted)this.client.stop(this.error(error.code||'STOMP_SEND_FAILED',error.message,true));
          else this.finish(item,this.error(error.code||'STOMP_SEND_FAILED',error.message,false));
        }
      }
    }finally{this.running=false;}
  }
}
module.exports={AsyncSends};
