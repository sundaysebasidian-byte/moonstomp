'use strict';
// Real TLS over numeric loopback; scripted STOMP peer, not a production broker.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const tls = require('node:tls');
const {execFileSync} = require('node:child_process');
const {TcpClient, protocol} = require('../transport/tcp.cjs');
(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'moonstomp-tls-'));
  let server; const sockets = new Set(); let connects = 0;
  try {
    fs.writeFileSync(path.join(temp, 'cert.conf'), '[req]\nprompt=no\ndistinguished_name=dn\nx509_extensions=v3\n[dn]\nCN=localhost\n[v3]\nsubjectAltName=DNS:localhost,IP:127.0.0.1\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,digitalSignature,keyEncipherment,keyCertSign\nextendedKeyUsage=serverAuth\n');
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '1', '-config', path.join(temp, 'cert.conf'), '-keyout', path.join(temp, 'key.pem'), '-out', path.join(temp, 'cert.pem')], {stdio: 'ignore'});
    const cert = fs.readFileSync(path.join(temp, 'cert.pem'));
    server = tls.createServer({key: fs.readFileSync(path.join(temp, 'key.pem')), cert}, socket => {
      sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.on('error', () => {});
      let bytes = Buffer.alloc(0);
      socket.on('data', data => {
        bytes = Buffer.concat([bytes, data]); let end;
        while ((end = bytes.indexOf(0)) !== -1) {
          const f = protocol.parse(bytes.subarray(0, end + 1)).map(JSON.parse)[0]; bytes = bytes.subarray(end + 1);
          if (f.command === 'CONNECT') { connects++; socket.write('CONNECTED\nversion:1.2\n\n\0'); }
          if (f.command === 'DISCONNECT') socket.end(`RECEIPT\nreceipt-id:${f.headers.find(h => h[0] === 'receipt')[1]}\n\n\0`);
        }
      });
    });
    server.on('tlsClientError', () => {});
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    const good = new TcpClient({port, tlsOptions: {ca: cert, servername: 'localhost'}});
    try { await good.connect({heartbeat: '0,0', login: 'local-test', passcode: 'test-only'}); assert.equal(good.socket.authorized, true); await good.disconnect(); }
    finally { good.stop(); }
    for (const options of [{servername: 'localhost'}, {ca: cert, servername: 'wrong.invalid'}]) {
      const bad = new TcpClient({port, tlsOptions: options});
      try { await assert.rejects(bad.connect({heartbeat: '0,0'}), error => /CERT|SELF_SIGNED/.test(error.code)); assert.equal(bad.state(), 'closed'); }
      finally { bad.stop(); }
    }
    assert.equal(connects, 1, 'untrusted or wrong-host TLS must send no CONNECT');
    assert.throws(() => new TcpClient({tlsOptions: {rejectUnauthorized: false}}), /certificate verification/);
    console.log('PASS TLS: trusted CA and hostname; untrusted CA/wrong hostname rejected before CONNECT; no insecure mode');
    console.log(execFileSync('openssl', ['version'], {encoding: 'utf8'}).trim());
  } finally {
    for (const socket of sockets) socket.destroy();
    if (server) await new Promise(resolve => server.close(resolve));
    fs.rmSync(temp, {recursive: true, force: true});
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
