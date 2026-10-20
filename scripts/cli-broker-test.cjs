'use strict';
// Real broker only (run by scripts/broker-run.py): drives tools/stomp-cli.cjs as a
// subprocess against the numeric-loopback broker on STOMP_PORT. Never connects elsewhere.
const {spawnSync} = require('node:child_process');
const assert = require('node:assert/strict');
const path = require('node:path');
const {options} = require('../examples/broker-common.cjs');
const {port} = options();
const cli = path.join(__dirname, '..', 'tools', 'stomp-cli.cjs');
const tag = process.pid + '-' + Date.now();
const results = [];
function run(args) {
  const r = spawnSync('node', [cli, ...args, '--port', String(port)], {encoding: 'utf8', timeout: 30000});
  return {code: r.status, out: r.stdout, err: r.stderr};
}
function step(name, fn) { fn(); results.push({name, status: 'PASSED'}); }
const dest = name => `/queue/moonstomp-cli-${name}-${tag}`;
step('send + subscribe with client-individual ACK (STOMP 1.2)', () => {
  const d = dest('basic');
  const s = run(['send', '--destination', d, '--body', 'hello 你好']);
  assert.equal(s.code, 0, s.err); assert.match(s.out, /receipt=confirmed/);
  const r = run(['subscribe', '--destination', d, '--ack', 'client-individual']);
  assert.equal(r.code, 0, r.err); assert.match(r.out, /body="hello 你好"/); assert.match(r.err, /^ack/);
});
for (const version of ['1.0', '1.1', '1.2']) {
  step(`round trip with --versions ${version} and cumulative ACK`, () => {
    const d = dest('v' + version);
    assert.equal(run(['send', '--destination', d, '--body', 'v' + version, '--versions', version]).code, 0);
    const r = run(['subscribe', '--destination', d, '--versions', version, '--ack', 'client']);
    assert.equal(r.code, 0, r.err); assert.match(r.out, new RegExp(`body="v${version}"`));
  });
}
step('binary body survives exactly (json format)', () => {
  const d = dest('bin');
  assert.equal(run(['send', '--destination', d, '--body-hex', '4100ff0d0a']).code, 0);
  const r = run(['subscribe', '--destination', d, '--format', 'json']);
  assert.equal(r.code, 0, r.err); assert.equal(JSON.parse(r.out.split('\n')[0]).bodyHex, '4100ff0d0a');
});
step('transaction abort delivers nothing, commit delivers', () => {
  const d = dest('tx');
  assert.equal(run(['send', '--destination', d, '--body', 'gone', '--tx', 'abort']).code, 0);
  const none = run(['subscribe', '--destination', d, '--timeout', '500']);
  assert.equal(none.code, 1); assert.match(none.err, /event timeout/);
  assert.equal(run(['send', '--destination', d, '--body', 'kept', '--tx', 'commit']).code, 0);
  const got = run(['subscribe', '--destination', d]);
  assert.equal(got.code, 0, got.err); assert.match(got.out, /body="kept"/);
});
step('NACK path completes (redelivery is broker policy, not asserted)', () => {
  const d = dest('nack');
  assert.equal(run(['send', '--destination', d, '--body', 'bad-job']).code, 0);
  const r = run(['subscribe', '--destination', d, '--ack', 'client-individual', '--nack-if', 'bad']);
  assert.equal(r.code, 0, r.err); assert.match(r.err, /^nack/);
});
console.log(JSON.stringify({passed: true, cases: results.length, results}, null, 2));
