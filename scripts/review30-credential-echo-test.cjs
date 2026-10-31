'use strict';
// Deterministic local regression; external services are not contacted.
const SOURCE = require('node:path').resolve(__dirname, '..');
const assert=require('node:assert/strict');const {fixture,frame}=require('./review30-peer.cjs'),{child}=require('./review30-cli-peer.cjs');
(async()=>{const rows=[],secret='ONLY-SYNTHETIC-PASS-21';for(const phase of ['CONNECT','SEND'])await fixture('1.2',async(c,peer,seen)=>{const r=await child(['send','--port',String(c.options.port),'--destination','/q','--body','x','--login','audit-user','--passcode-env','AUDIT_SYNTHETIC_PASS'],{env:{AUDIT_SYNTHETIC_PASS:secret}});rows.push({phase,code:r.code,leaked:r.err.includes(secret),stderr:r.err});assert.equal(r.code,1);},{hook:(f,s)=>{if(f.command===phase && (phase!=='CONNECT'||f.h.login==='audit-user')){s.write(frame('ERROR',[['message','denied '+secret],['detail','echo '+secret]],Buffer.from('backend detail '+secret)));return true;}return false;}});console.log(JSON.stringify(rows,null,2));assert(rows.every(r=>!r.leaked),'known CLI passcode must not appear in diagnostic output');})().catch(e=>{console.error(e);process.exitCode=1});

// Display clipping must not expose the prefix of a known passcode.
const {friendlyError}=require('../tools/friendly-error.cjs');
const boundarySecret='synthetic-界-\\-"-secret-boundary';
const raw={command:'ERROR',headers:[['message',boundarySecret],[boundarySecret,'echo '+boundarySecret]],body:[...Buffer.from('x'.repeat(195)+boundarySecret+'tail')]};
const cause=Object.assign(Error(boundarySecret),{name:boundarySecret,code:boundarySecret,operation:boundarySecret,reason:boundarySecret,receiptId:boundarySecret,frame:raw});
const original=JSON.stringify(raw);const diagnostic=friendlyError(cause,'127.0.0.1',61613,{secrets:[boundarySecret]});
assert(!diagnostic.includes(boundarySecret));assert(diagnostic.includes('[redacted]'));assert.equal(JSON.stringify(raw),original);assert.equal(cause.message,boundarySecret);
