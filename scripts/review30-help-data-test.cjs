'use strict';
// Deterministic local regression; external services are not contacted.
const SOURCE = require('node:path').resolve(__dirname, '..');
const assert=require('node:assert/strict'),{spawn}=require('node:child_process');const {fixture}=require('./review30-peer.cjs');
(async()=>{await fixture('1.2',async(c,peer,seen)=>{const result=await new Promise((r,j)=>{const p=spawn(process.execPath,[SOURCE+'/tools/stomp-cli.cjs','send','--host','127.0.0.1','--port',String(c.options.port),'--destination','/q','--body','--help']);let out='',err='';p.stdout.on('data',b=>out+=b);p.stderr.on('data',b=>err+=b);p.on('error',j);p.on('close',code=>r({code,out,err}));});const sends=seen.filter(f=>f.command==='SEND');console.log(JSON.stringify({...result,sends:sends.map(f=>f.body.toString())}));assert.equal(result.code,0);assert.deepEqual(sends.map(f=>f.body.toString()),['--help'],'body value must not be consumed as global help');});})().catch(e=>{console.error(e);process.exitCode=1});
