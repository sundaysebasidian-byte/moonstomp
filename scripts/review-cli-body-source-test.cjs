'use strict';
// Independent user-scenario regression: body source must be exactly one,
// and invalid multi-source invocations must not read a file or block on stdin.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {spawn} = require('node:child_process');
const path = require('node:path');
const {parse, UsageError} = require('../tools/stomp-cli.cjs');
const prefix = ['send', '--destination', '/queue/body-source-review'];
const sources = [ ['--body', 'text'], ['--body-hex', '00ff'], ['--body-file', '/not-opened-by-this-test'], ['--stdin'] ];
const originalRead = fs.readFileSync, originalOpen = fs.openSync, originalReadSync = fs.readSync, originalClose = fs.closeSync;
let consumed = false;
let reads = [];
try {
  fs.readFileSync = () => { throw Error('body sources must use bounded reads'); };
  fs.openSync = name => { reads.push(name); consumed = false; return 77; };
  fs.closeSync = fd => assert.equal(fd, 77);
  fs.readSync = (fd, buffer, offset) => {
    if (consumed) return 0;
    consumed = true; if (fd === 0) reads.push(0);
    return Buffer.from(fd === 0 ? 'stdin' : 'file').copy(buffer, offset);
  };
  for (let a = 0; a < sources.length; a++) for (let b = 0; b < sources.length; b++) {
    reads = [];
    assert.throws(() => parse([...prefix, ...sources[a], ...sources[b]]), UsageError);
    assert.deepEqual(reads, [], 'ambiguous inputs must be refused before reading any source');
  }
  for (const [source, body, expectedReads] of [
    [sources[0], Buffer.from('text'), []], [sources[1], Buffer.from([0,255]), []],
    [sources[2], Buffer.from('file'), ['/not-opened-by-this-test']], [sources[3], Buffer.from('stdin'), [0]],
  ]) {
    reads=[]; consumed=false; assert.deepEqual(parse([...prefix,...source]).body,body); assert.deepEqual(reads,expectedReads);
  }
  assert.throws(() => parse(prefix), UsageError);
} finally { fs.readFileSync = originalRead; fs.openSync = originalOpen; fs.readSync = originalReadSync; fs.closeSync = originalClose; }
function processRefusal(args) {
  return new Promise((resolve,reject) => {
    const p=spawn(process.execPath,[path.join(__dirname,'../tools/stomp-cli.cjs'),...prefix,...args],{stdio:['pipe','pipe','pipe']});
    let err=''; p.stderr.on('data',b=>err+=b);p.stdout.resume();
    const timer=setTimeout(()=>{p.kill();reject(Error('ambiguous invocation blocked on stdin'));},2000);
    p.on('exit',code=>{clearTimeout(timer);try{assert.equal(code,2);assert.match(err,/usage error:/);assert.doesNotMatch(err,/ENOENT/);resolve();}catch(e){reject(e);}});
    p.on('error',e=>{clearTimeout(timer);reject(e);});
    // Deliberately do not send or close stdin: parse must reject before read.
  });
}
(async()=>{
 await processRefusal(['--stdin','--body','second']);
 await processRefusal(['--body-file','/no-such-input-for-review','--body','second']);
 console.log('PASS 16 ordered conflicting-source pairs; four unique sources; absent source; two real CLI early-refusal/nonblocking probes');
})().catch(e=>{console.error(e);process.exitCode=1;});
