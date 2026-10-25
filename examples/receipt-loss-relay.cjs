'use strict';
// Demonstration-only, loopback TLS relay. Never use this as a production proxy.
const tls = require('node:tls');

function frameStream(onFrame, onHeartbeat = () => {}) {
  let pending = Buffer.alloc(0);
  return {
    feed(chunk) {
      pending = Buffer.concat([pending, chunk]);
      if (pending.length > 1024 * 1024) throw new Error('demo relay frame budget');
      while (pending.length) {
        if (pending[0] === 10) { onHeartbeat(pending.subarray(0, 1)); pending = pending.subarray(1); continue; }
        if (pending[0] === 13 && pending[1] === 10) { onHeartbeat(pending.subarray(0, 2)); pending = pending.subarray(2); continue; }
        const lf = pending.indexOf('\n\n'), crlf = pending.indexOf('\r\n\r\n');
        if (lf < 0 && crlf < 0) return;
        const crlfFirst = crlf >= 0 && (lf < 0 || crlf < lf);
        const headerEnd = crlfFirst ? crlf : lf, bodyStart = headerEnd + (crlfFirst ? 4 : 2);
        const length = pending.subarray(0, headerEnd).toString().replace(/\r/g, '')
          .match(/(?:^|\n)content-length:([^\n]*)/);
        let end;
        if (length) {
          if (!/^\d+$/.test(length[1])) throw new Error('demo relay content length');
          const size = Number(length[1]);
          if (!Number.isSafeInteger(size) || size > 1024 * 1024 - bodyStart) throw new Error('demo relay body budget');
          end = bodyStart + size;
        } else end = pending.indexOf(0, bodyStart);
        if (end < 0 || end >= pending.length) return;
        if (pending[end] !== 0) throw new Error('demo relay frame terminator');
        const frame = pending.subarray(0, end + 1); pending = pending.subarray(end + 1);
        onFrame(frame);
      }
    },
    finish() { if (pending.length) throw new Error('truncated demo relay frame'); },
  };
}

async function receiptLossRelay({brokerPort, ca, pfx, parse, receiptId}) {
  const sockets = new Set();
  const stats = {acceptedConnections: 0, upstreamTlsVerified: false, forwardedSends: 0, droppedReceipts: 0};
  const track = socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); };
  const server = tls.createServer({pfx, passphrase: 'profile-test-only'}, front => {
    stats.acceptedConnections++; track(front);
    const back = tls.connect({host: '127.0.0.1', port: brokerPort, ca, servername: 'localhost', rejectUnauthorized: true});
    track(back);
    back.once('secureConnect', () => { stats.upstreamTlsVerified = back.authorized === true; });
    const tearDown = () => { front.destroy(); back.destroy(); };
    front.on('error', tearDown); back.on('error', tearDown);
    front.once('close', () => back.destroy()); back.once('close', () => front.destroy());
    front.setTimeout(3000, tearDown); back.setTimeout(3000, tearDown);
    const outbound = frameStream(bytes => {
      const frame = parse(bytes);
      if (frame.command === 'SEND') stats.forwardedSends++;
      back.write(bytes);
    });
    const inbound = frameStream(bytes => {
      const frame = parse(bytes);
      if (frame.command === 'RECEIPT' && frame.headers.find(h => h[0] === 'receipt-id')?.[1] === receiptId) {
        stats.droppedReceipts++; return; // Only this selected real broker receipt is withheld.
      }
      front.write(bytes);
    });
    front.on('data', bytes => { try { outbound.feed(bytes); } catch { tearDown(); } });
    back.on('data', bytes => { try { inbound.feed(bytes); } catch { tearDown(); } });
  });
  server.on('connection', track); // Include TLS handshakes in cleanup.
  server.on('tlsClientError', () => {});
  await new Promise((resolve, reject) => {
    server.once('error', reject); server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  return {port, stats, async close() {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    if (sockets.size) await new Promise(resolve => setImmediate(resolve));
    return sockets.size;
  }};
}
function frameCommand(bytes) { return bytes.subarray(0, bytes.indexOf(10)).toString().replace(/\r$/, ''); }
module.exports = {frameStream, receiptLossRelay, frameCommand};
