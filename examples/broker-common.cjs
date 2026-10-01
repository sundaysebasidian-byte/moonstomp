const {TcpClient} = require('../transport/tcp.cjs');
const assert = require('node:assert/strict');
function options() {
  const host = process.env.STOMP_HOST || '127.0.0.1';
  if (host !== '127.0.0.1' && host !== '::1') throw new Error('examples require numeric loopback; no public broker tests');
  return {host, port: Number(process.env.STOMP_PORT || 61613)};
}
function header(frame, name) { return frame.headers.find(h=>h[0]===name)?.[1]; }
async function open(name, ack='auto') {
  const c = new TcpClient(options()); await c.connect();
  const destination = '/queue/moonstomp-' + name + '-' + process.pid + '-' + Date.now();
  await c.receipt('SUBSCRIBE',[['id','worker'],['destination',destination],['ack',ack]]);
  return {c,destination};
}
function message(c) { return c.waitFor(e=>e.event==='message'); }
function run(fn) { fn().catch(e=>{ console.error(e.message); process.exitCode=1; }); }
module.exports={assert,header,options,open,message,run};
