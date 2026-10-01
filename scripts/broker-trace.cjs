'use strict';
// Explicit test opt-in; records synthetic loopback fixture data only.
const fs=require('node:fs'),net=require('node:net'),path=require('node:path');
const trace=process.env.MOONSTOMP_TRACE_FILE;
if(!trace||!path.isAbsolute(trace))throw new Error('absolute trace path required');
const {TcpClient}=require('../transport/tcp.cjs');
function record(direction,bytes){fs.appendFileSync(trace,JSON.stringify({utc:new Date().toISOString(),direction,bytes:bytes.length,hex:Buffer.from(bytes).toString('hex')})+'\n');}
const write=TcpClient.prototype.write;
TcpClient.prototype.write=function(bytes){if(bytes.length)record('transport-write-intent',bytes);return write.call(this,bytes);};
const emit=net.Socket.prototype.emit;
net.Socket.prototype.emit=function(event,...args){if(event==='data'&&this.remotePort===61613&&this.remoteAddress==='127.0.0.1')record('socket-data',args[0]);return emit.call(this,event,...args);};
