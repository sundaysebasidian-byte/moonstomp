'use strict';
const assert = require('node:assert/strict');
const {Parser,FrameImpl} = require('../tests/reference/stompjs-7.2.0.umd.cjs');
const {protocol} = require('../transport/tcp.cjs');
const normal = f => ({command:f.command, headers:Object.fromEntries([...f.headers].reverse()), body:f.body});
function reference(wire, step) {
  const frames=[];
  const parser=new Parser(raw=>{
    const f=FrameImpl.fromRawFrame(raw,true);
    frames.push({command:f.command,headers:f.headers,body:Array.from(f.binaryBody)});
  },()=>{});
  // The reference expects ArrayBuffer, not a Node Buffer's entire pooled backing store.
  for(let i=0;i<wire.length;i+=step) parser.parseChunk(Uint8Array.from(wire.subarray(i,i+step)).buffer);
  return frames;
}
let seed=0x12345678;
const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};
let cases=0, chunkRuns=0;
for(let i=0;i<400;i++) {
  const body=Uint8Array.from({length:random()%100},()=>random()%256);
  const f=new FrameImpl({command:'SEND',headers:{destination:'/queue/tasks','x-label':'中文:'+i+'\nline\rreturn'},binaryBody:body,escapeHeaderValues:true});
  let wire=Buffer.from(f.serialize());
  if(i%2===0) {
    const boundary=wire.indexOf('\n\n');
    wire=Buffer.concat([Buffer.from(wire.subarray(0,boundary+2).toString().replace(/\n/g,'\r\n')),wire.subarray(boundary+2)]);
  }
  const actual=protocol.parse(wire).map(JSON.parse).filter(f=>f.command).map(normal);
  for(const step of [1,7,wire.length]) {
    assert.deepEqual(actual, reference(wire,step)); chunkRuns++;
  }
  assert.deepEqual(actual[0].body,Array.from(body)); cases++;
}
const joined=Buffer.from('SEND\nx:first\nx:second\n\na\0RECEIPT\nreceipt-id:r\n\n\0');
assert.deepEqual(protocol.parse(joined).map(JSON.parse).map(normal),reference(joined,1)); cases++;
// Differences are constrained by the STOMP specification, not by reference laxness.
const strictVectors=[
 ['header whitespace',Buffer.from('SEND\nx: leading \n\n\0'),'spaces preserved'],
 ['undefined escape',Buffer.from('SEND\nx:bad\\t\n\n\0'),'fatal'],
 ['wrong terminator',Buffer.from('SEND\ncontent-length:1\n\naX'),'fatal'],
 ['signed length',Buffer.from('SEND\ncontent-length:+1\n\na\0'),'fatal'],
];
const differences=[];
for(const [name,wire,expected] of strictVectors) {
  const ref=reference(wire,1);
  if(expected==='fatal') {assert.throws(()=>protocol.parse(wire));assert.equal(ref.length,1);}
  else { const ours=normal(JSON.parse(protocol.parse(wire)[0]));assert.equal(ours.headers.x,' leading ');assert.equal(ref[0].headers.x,'leading'); }
  differences.push({name,moonstomp:expected,reference:'accepted/trimmed',basis:'STOMP 1.2 Value Encoding / content-length'});
}
console.log(JSON.stringify({reference:'@stomp/stompjs 7.2.0 Apache-2.0',valid_cases:cases,reference_chunk_runs:chunkRuns+1,passed:true,documented_strictness_differences:differences,broker_interop:'NOT TESTED'},null,2));
