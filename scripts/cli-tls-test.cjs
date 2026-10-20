'use strict';
// CLI --tls over numeric loopback: a TLS listener in front of the built-in demo broker.
// Scripted local peer only: this is NOT a TLS test against a real broker.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const tls = require('node:tls');
const {execFile, execFileSync} = require('node:child_process');
const {startDemoBroker} = require('../tools/demo-broker.cjs');
const cli = path.join(__dirname, '..', 'tools', 'stomp-cli.cjs');
const run = (args, options = {}) => new Promise(resolve => execFile('node', [cli, ...args], {timeout: 30000, ...options},
  (error, stdout, stderr) => resolve({code: error ? error.code : 0, stdout, stderr})));
(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'moonstomp-cli-tls-'));
  let broker, server; const sockets = new Set();
  try {
    fs.writeFileSync(path.join(temp, 'cert.conf'), '[req]\nprompt=no\ndistinguished_name=dn\nx509_extensions=v3\n[dn]\nCN=localhost\n[v3]\nsubjectAltName=DNS:localhost,IP:127.0.0.1\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,digitalSignature,keyEncipherment,keyCertSign\nextendedKeyUsage=serverAuth\n');
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '1', '-config', path.join(temp, 'cert.conf'), '-keyout', path.join(temp, 'key.pem'), '-out', path.join(temp, 'cert.pem')], {stdio: 'ignore'});
    broker = await startDemoBroker({port: 0, credentials: {login: 'tls-user', passcode: 'tls-pass'}});
    server = tls.createServer({key: fs.readFileSync(path.join(temp, 'key.pem')), cert: fs.readFileSync(path.join(temp, 'cert.pem'))}, socket => {
      const upstream = net.connect(broker.port, '127.0.0.1');
      sockets.add(socket); sockets.add(upstream);
      socket.on('error', () => upstream.destroy()); upstream.on('error', () => socket.destroy());
      socket.pipe(upstream); upstream.pipe(socket);
    });
    server.on('tlsClientError', () => {});
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = String(server.address().port);
    const ca = path.join(temp, 'cert.pem');
    const env = {...process.env, TLS_PASS: 'tls-pass'};
    const common = ['--port', port, '--login', 'tls-user', '--passcode-env', 'TLS_PASS', '--tls', '--tls-servername', 'localhost'];

    let r = await run(['send', '--destination', '/queue/tls', '--body', 'over tls', ...common, '--tls-ca', ca], {env});
    assert.equal(r.code, 0, r.stderr); assert.match(r.stdout, /sent destination=\/queue\/tls bytes=8 receipt=confirmed/);
    r = await run(['subscribe', '--destination', '/queue/tls', ...common, '--tls-ca', ca], {env});
    assert.equal(r.code, 0, r.stderr); assert.match(r.stdout, /message destination=\/queue\/tls body="over tls"/);
    console.log('ok   cli send + subscribe over TLS with a trusted CA, login and the expected server name');

    r = await run(['send', '--destination', '/queue/tls', '--body', 'x', ...common], {env});
    assert.equal(r.code, 1); assert.match(r.stderr, /TLS certificate check failed/); assert.match(r.stderr, /code=(DEPTH_ZERO_SELF_SIGNED_CERT|SELF_SIGNED_CERT_IN_CHAIN|UNABLE_TO_VERIFY_LEAF_SIGNATURE)/);
    console.log('ok   cli --tls without --tls-ca rejects the self-signed certificate (exit 1, hint printed)');

    r = await run(['send', '--destination', '/queue/tls', '--body', 'x', '--port', port, '--login', 'tls-user', '--passcode-env', 'TLS_PASS', '--tls', '--tls-ca', ca, '--tls-servername', 'wrong.invalid'], {env});
    assert.equal(r.code, 1); assert.match(r.stderr, /code=ERR_TLS_CERT_ALTNAME_INVALID/);
    console.log('ok   cli --tls with the wrong server name is rejected (exit 1)');

    assert.equal(broker.received.filter(c => c === 'CONNECT' || c === 'STOMP').length, 2, 'rejected TLS attempts must never reach the broker');
    console.log('ok   rejected TLS attempts sent no CONNECT (broker saw only the two accepted sessions)');
    console.log('PASS cli-tls: scripted local TLS peer in front of the demo broker; not a real-broker TLS test');
  } finally {
    for (const socket of sockets) socket.destroy();
    if (server) await new Promise(resolve => server.close(resolve));
    if (broker) await broker.close();
    fs.rmSync(temp, {recursive: true, force: true});
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
