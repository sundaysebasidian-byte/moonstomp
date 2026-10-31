// Deterministic local regression; external services are not contacted.
const SOURCE = require('node:path').resolve(__dirname, '..');
'use strict';
const {spawn}=require('node:child_process');
function child(args,{env={},closeInput=true}={}){return new Promise((resolve,reject)=>{const p=spawn(process.execPath,[SOURCE+'/tools/stomp-cli.cjs',...args],{env:{...process.env,...env}});let out='',err='';const timer=setTimeout(()=>{p.kill();reject(Error('CLI child timed out'));},5000);p.stdout.on('data',b=>out+=b);p.stderr.on('data',b=>err+=b);p.on('error',reject);p.on('close',code=>{clearTimeout(timer);resolve({code,out,err});});if(closeInput)p.stdin.end();});}
module.exports={child};
