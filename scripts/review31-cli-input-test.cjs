'use strict';
// Source-budget and early-refusal controls; no broker access.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {parse, UsageError} = require('../tools/stomp-cli.cjs');
const MAX = 1024 * 1024;
const prefix = ['send','--destination','/q'];
const root = path.resolve(__dirname,'..');
test('all invalid non-body options fail before opening body file or consuming stdin', () => {
  const invalid = [['--tx','commit','--no-receipt'],['--versions','2.0'],['--versions','1.2,1.2'],['--heartbeat','a,0'],['--heartbeat','2147483648,0'],['--host','','--allow-remote'],['--vhost',''],['--header','receipt=x'],['--destination','bad\0value'],['--versions','1.0','--destination','bad\nvalue'],['--versions','1.0','--header','x=y\nz'],['--versions','1.0,1.2','--header','x:y=z'],['--header','content-length=NaN'],['--header','content-length=1048577']];
  const originalRead=fs.readSync, originalOpen=fs.openSync, originalAll=fs.readFileSync;
  let reads=[];
  try {
    fs.readSync=(...args)=>{reads.push('readSync');return 0;};
    fs.openSync=(...args)=>{reads.push('openSync');return 77;};
    fs.readFileSync=(...args)=>{reads.push('readFileSync');return Buffer.alloc(0);};
    for(const args of invalid) for(const source of [['--stdin'],['--body-file','synthetic-only']]) {
      reads=[]; assert.throws(()=>parse([...prefix,...source,...args]),UsageError,JSON.stringify(args));
      assert.deepEqual(reads,[],JSON.stringify(args));
    }
  } finally {fs.readSync=originalRead;fs.openSync=originalOpen;fs.readFileSync=originalAll;}
});
test('text, UTF-8, hex and file body boundaries use bytes not codepoints', () => {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'moonstomp-body-'));
  const file=path.join(directory,'body');
  try {
    assert.equal(parse([...prefix,'--body','x'.repeat(MAX)]).body.length,MAX);
    assert.equal(parse([...prefix,'--body','é'.repeat(MAX/2)]).body.length,MAX);
    assert.equal(parse([...prefix,'--body-hex','ab'.repeat(MAX)]).body.length,MAX);
    for(const args of [['--body','x'.repeat(MAX+1)],['--body','é'.repeat(MAX/2+1)],['--body-hex','ab'.repeat(MAX+1)]]) assert.throws(()=>parse([...prefix,...args]),UsageError);
    fs.writeFileSync(file,Buffer.alloc(MAX)); assert.equal(parse([...prefix,'--body-file',file]).body.length,MAX);
    fs.appendFileSync(file,Buffer.from([1])); assert.throws(()=>parse([...prefix,'--body-file',file]),UsageError);
  } finally {fs.rmSync(directory,{recursive:true});}
});
test('one-byte short reads use bounded storage and preserve bytes; stdin is not closed', () => {
  const originalRead=fs.readSync, originalClose=fs.closeSync, originalAll=fs.readFileSync;
  let calls=0, closes=0, allocations=new Set();
  try {
    fs.readFileSync=()=>{throw new Error('unbounded readFileSync forbidden');};
    fs.readSync=(fd,buffer,offset,length)=>{assert.equal(fd,0);assert(length>0);allocations.add(buffer.buffer);if(calls===10000)return 0;buffer[offset]=calls++%256;return 1;};
    fs.closeSync=()=>{closes++;};
    const body=parse([...prefix,'--stdin']).body;
    assert.equal(body.length,10000);for(let i=0;i<body.length;i++)assert.equal(body[i],i%256);
    assert.equal(allocations.size,1,'short reads must reuse a single bounded allocation');
    assert.equal(closes,0);
  } finally {fs.readSync=originalRead;fs.closeSync=originalClose;fs.readFileSync=originalAll;}
});
test('file descriptor closes after read errors and oversized inputs', () => {
  const originalRead=fs.readSync, originalClose=fs.closeSync, originalOpen=fs.openSync;
  let closes=0;
  try {
    fs.openSync=()=>77; fs.closeSync=fd=>{assert.equal(fd,77);closes++;};
    fs.readSync=()=>{throw Object.assign(Error('synthetic read failure'),{code:'EIO'});};
    assert.throws(()=>parse([...prefix,'--body-file','synthetic']),/synthetic read failure/);assert.equal(closes,1);
    fs.readSync=(fd,buffer,offset,length)=>{buffer.fill(65,offset,offset+length);return length;};
    assert.throws(()=>parse([...prefix,'--body-file','synthetic']),UsageError);assert.equal(closes,2);
  } finally {fs.readSync=originalRead;fs.closeSync=originalClose;fs.openSync=originalOpen;}
});
test('help, import and malformed options do not require a generated bridge', () => {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'moonstomp-no-bridge-'));
  try {
    fs.cpSync(path.join(root,'tools'),path.join(directory,'tools'),{recursive:true});
    for(const [args,status] of [[['--help'],0],[[],2],[['send','--destination','/q','--stdin','--tx','commit','--no-receipt'],2]]) {
      const r=spawnSync(process.execPath,[path.join(directory,'tools/stomp-cli.cjs'),...args],{encoding:'utf8',timeout:3000});
      assert.equal(r.status,status,r.stderr);assert.match(r.stdout+r.stderr,/usage:/);assert.doesNotMatch(r.stderr,/bridge not built/);
    }
    const r=spawnSync(process.execPath,['-e',`require(${JSON.stringify(path.join(directory,'tools/stomp-cli.cjs'))})`],{encoding:'utf8'});
    assert.equal(r.status,0,r.stderr);assert.equal(r.stdout+r.stderr,'');
  } finally {fs.rmSync(directory,{recursive:true});}
});

test('CLI SEND header budget matches the core at the 128-header boundary', () => {
  const {protocol} = require('../transport/tcp.cjs');
  const cases = [
    {count:126, body:'', options:[]},
    {count:126, body:'x', options:['--no-receipt']},
    {count:127, body:'', options:['--no-receipt']},
    {count:126, body:'', options:['--tx','commit']},
    {count:125, body:'x', options:['--tx','commit']},
    {count:125, body:'x', options:[]},
    {count:126, body:'x', options:[], explicitLength:true},
  ];
  for (const c of cases) {
    const headers=Array.from({length:c.count},(_,i)=>['x'+i,'y']);
    if(c.explicitLength)headers[0]=['content-length',String(c.body.length)];
    const args=headers.flatMap(([k,v])=>['--header',k+'='+v]);
    const parsed=parse([...prefix,'--body',c.body,...c.options,...args]);
    const core=protocol.create();
    protocol.send(core,'CONNECT',[['accept-version','1.2'],['host','localhost']],Buffer.alloc(0),0n);
    protocol.receive(core,Buffer.from('CONNECTED\nversion:1.2\n\n\0'),0n);
    if(parsed.tx)protocol.send(core,'BEGIN',[['transaction','t']],Buffer.alloc(0),0n);
    const controls=parsed.tx?[['transaction','t']]:parsed.receipt?[['receipt','r']]:[];
    const frameHeaders=[['destination',parsed.destination],...parsed.headers,...controls];
    assert.doesNotThrow(()=>protocol.send(core,'SEND',frameHeaders,parsed.body,0n));
    protocol.close(core);
    assert.throws(()=>parse([...prefix,'--body',c.body,...c.options,...args,'--header','extra=overflow']),UsageError);
  }
});
