'use strict';
// Real numeric-loopback sockets with scripted peers; not broker authentication.
const assert = require('node:assert/strict');
const net = require('node:net');
const {TcpClient, protocol} = require('../transport/tcp.cjs');
const header = (frame, key) => frame.headers.find(h => h[0] === key)?.[1];
let cases = 0;
async function handshake(version, credentials, check, reject = false) {
  const sockets = new Set(); let observed;
  const server = net.createServer(socket => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {}); let bytes = Buffer.alloc(0);
    socket.on('data', data => {
      bytes = Buffer.concat([bytes, data]);
      let end;
      while ((end = bytes.indexOf(0)) !== -1) {
        const frame = protocol.parse(bytes.subarray(0, end + 1)).map(JSON.parse)[0]; bytes = bytes.subarray(end + 1);
        if (frame.command === 'CONNECT') {
          observed = frame;
          if (reject) socket.end('ERROR\nmessage:authentication denied\ncontent-length:6\n\ndenied\0');
          else socket.write('CONNECTED\n' + (version === '1.0' ? '' : `version:${version}\n`) + '\n\0');
        } else if (frame.command === 'DISCONNECT') socket.end(`RECEIPT\nreceipt-id:${header(frame, 'receipt')}\n\n\0`);
      }
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const client = new TcpClient({port: server.address().port});
  try {
    const connecting = client.connect({versions: [version], heartbeat: '0,0', virtualHost: 'test:vhost\\literal', ...credentials});
    if (reject) {
      await assert.rejects(connecting, error => error.code === 'STOMP_BROKER_ERROR' && error.name === 'MoonSTOMPBrokerError' && error.message === 'authentication denied' && Buffer.from(error.frame.body).toString() === 'denied');
      assert.equal(client.state(), 'closed');
    } else {
      await connecting; assert.equal(client.version(), version); await client.disconnect();
    }
    check(observed); cases++;
  } finally {
    client.stop(); for (const s of sockets) s.destroy(); await new Promise(resolve => server.close(resolve));
  }
}
(async () => {
  for (const version of ['1.0', '1.1', '1.2']) {
    await handshake(version, {login: 'test:user\\literal', passcode: ''}, frame => {
      assert.equal(header(frame, 'login'), 'test:user\\literal'); assert.equal(header(frame, 'passcode'), '');
      assert.equal(header(frame, 'host'), version === '1.0' ? undefined : 'test:vhost\\literal');
    });
  }
  await handshake('1.2', {}, frame => { assert.equal(header(frame, 'login'), undefined); assert.equal(header(frame, 'passcode'), undefined); });
  await handshake('1.2', {login: '', passcode: ''}, frame => { assert.equal(header(frame, 'login'), ''); assert.equal(header(frame, 'passcode'), ''); });
  await handshake('1.2', {login: 'bad-test-user', passcode: 'test-only'}, () => {}, true);
  for (const key of ['virtualHost', 'login', 'passcode']) for (const value of ['line\nfeed', 'carriage\rreturn', 'nul\0value', 123, null]) {
    const client = new TcpClient({port: 9});
    await assert.rejects(client.connect({[key]: value}), /invalid CONNECT header/);
    assert.equal(client.socket, null); assert.equal(client.state(), 'fresh'); cases++;
  }
  console.log(`PASS ${cases} CONNECT credentials/host/error cases; scripted loopback peers, no broker claim`);
})().catch(error => { console.error(error); process.exitCode = 1; });
