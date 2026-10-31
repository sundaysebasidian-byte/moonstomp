'use strict';
// Deterministic local regression; external services are not contacted.
const SOURCE = require('node:path').resolve(__dirname, '..');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');const src=SOURCE,root=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'moonstomp-module-test-'));
const paths=['项目 A','项目 B'].map(n=>path.join(root,n));for(const dir of paths){for(const n of ['transport','tools'])fs.cpSync(path.join(src,n),path.join(dir,n),{recursive:true});const bridge='_build/js/debug/build/bridge/bridge.js';fs.mkdirSync(path.dirname(path.join(dir,bridge)),{recursive:true});fs.copyFileSync(path.join(src,bridge),path.join(dir,bridge));}
require(paths[0]+'/_build/js/debug/build/bridge/bridge.js');const apiA=globalThis.MoonSTOMP;require(paths[1]+'/_build/js/debug/build/bridge/bridge.js');const apiB=globalThis.MoonSTOMP;assert.notEqual(apiA,apiB);
const a=require(paths[0]+'/transport/tcp.cjs'),b=require(paths[1]+'/transport/tcp.cjs');const child=spawnSync(process.execPath,[paths[0]+'/tools/stomp-cli.cjs','demo'],{cwd:root,encoding:'utf8',timeout:5000});console.log(JSON.stringify({isolatedA:a.protocol===apiA,isolatedB:b.protocol===apiB,demoCode:child.status,demo:child.stdout,stderr:child.stderr},null,2));assert.equal(child.status,0);assert.equal(a.protocol,apiA,'adapter A must use its own built bridge despite another project loading later');assert.equal(b.protocol,apiB);
for(const [own,foreign]of [[apiA,apiB],[apiB,apiA]]){const c=own.create();for(const op of ['state','version','close','eof','tick','send','receive','acknowledge']){assert.throws(()=>{if(op==='tick')foreign.tick(c,0n);else if(op==='send')foreign.send(c,'CONNECT',[],Buffer.alloc(0),0n);else if(op==='receive')foreign.receive(c,Buffer.alloc(0),0n);else if(op==='acknowledge')foreign.acknowledge(c,[],false,'',0n);else foreign[op](c);},e=>e.code==='STOMP_ARGUMENT');assert.equal(own.state(c),'fresh');}own.close(c);}


fs.rmSync(root,{recursive:true,force:true}); // Only this test's newly created directory.
