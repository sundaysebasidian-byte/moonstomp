#!/usr/bin/env node
'use strict';
// moonstomp CLI: `send` and `subscribe` over the MoonBit-core TCP adapter.
// Exit codes: 0 success, 1 runtime failure (connect/timeout/broker error), 2 usage error.
// Plaintext, anonymous, numeric loopback by default; see README "Boundaries".
const fs = require('node:fs');
const TcpClient = require('./load-adapter.cjs').loadTcpClient();

const USAGE = `usage:
  stomp-cli send      --destination D (--body TEXT | --body-file F | --body-hex HEX | --stdin)
                      [--header k=v]... [--no-receipt] [--tx commit|abort]
  stomp-cli subscribe --destination D [--count N] [--ack auto|client|client-individual]
                      [--nack-if SUBSTR] [--timeout MS] [--format text|json]
common: [--host 127.0.0.1] [--port 61613] [--versions 1.0,1.1,1.2] [--heartbeat cx,cy]
        [--allow-remote]   (non-loopback host; connection is plaintext and anonymous)
exit codes: 0 ok, 1 failure, 2 usage`;

class UsageError extends Error {}
function parse(argv) {
  const [command, ...rest] = argv;
  if (!['send', 'subscribe'].includes(command)) throw new UsageError(command ? `unknown command ${command}` : 'missing command');
  const o = {command, headers: [], versions: ['1.2'], host: '127.0.0.1', port: 61613, count: 1, ack: 'auto', timeout: 5000, format: 'text', receipt: true};
  const flags = new Set(['--no-receipt', '--stdin', '--allow-remote']);
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (!a.startsWith('--')) throw new UsageError(`unexpected argument ${a}`);
    const value = flags.has(a) ? true : rest[++i];
    if (value === undefined) throw new UsageError(`${a} needs a value`);
    switch (a) {
      case '--destination': o.destination = value; break;
      case '--body': o.body = Buffer.from(value, 'utf8'); break;
      case '--body-file': o.body = fs.readFileSync(value); break;
      case '--body-hex': if (!/^([0-9a-fA-F]{2})*$/.test(value)) throw new UsageError('--body-hex needs an even number of hex digits'); o.body = Buffer.from(value, 'hex'); break;
      case '--stdin': o.body = fs.readFileSync(0); break;
      case '--header': { const at = value.indexOf('='); if (at < 1) throw new UsageError('--header needs k=v'); o.headers.push([value.slice(0, at), value.slice(at + 1)]); break; }
      case '--no-receipt': o.receipt = false; break;
      case '--tx': if (!['commit', 'abort'].includes(value)) throw new UsageError('--tx is commit or abort'); o.tx = value; break;
      case '--host': o.host = value; break;
      case '--port': o.port = Number(value); break;
      case '--versions': o.versions = value.split(','); break;
      case '--heartbeat': o.heartbeat = value; break;
      case '--count': o.count = Number(value); break;
      case '--ack': o.ack = value; break;
      case '--nack-if': o.nackIf = value; break;
      case '--timeout': o.timeout = Number(value); break;
      case '--format': o.format = value; break;
      case '--allow-remote': o.remote = true; break;
      default: throw new UsageError(`unknown option ${a}`);
    }
  }
  if (!o.destination) throw new UsageError('--destination is required');
  if (!Number.isInteger(o.port) || o.port < 1 || o.port > 65535) throw new UsageError('--port must be 1..65535');
  if (!['127.0.0.1', '::1', 'localhost'].includes(o.host) && !o.remote) throw new UsageError('non-loopback host needs --allow-remote (plaintext, anonymous, untested)');
  if (!['auto', 'client', 'client-individual'].includes(o.ack)) throw new UsageError('--ack must be auto, client or client-individual');
  if (!['text', 'json'].includes(o.format)) throw new UsageError('--format must be text or json');
  if (!Number.isInteger(o.count) || o.count < 1) throw new UsageError('--count must be a positive integer');
  if (!Number.isInteger(o.timeout) || o.timeout < 1) throw new UsageError('--timeout must be a positive integer (ms)');
  if (o.command === 'send' && o.body === undefined) throw new UsageError('send needs --body, --body-file, --body-hex or --stdin');
  if (o.command === 'send' && o.tx && !o.receipt) throw new UsageError('--tx needs receipts (omit --no-receipt)');
  return o;
}
const header = (frame, name) => frame.headers.find(h => h[0] === name)?.[1];
function render(frame, format) {
  const body = Buffer.from(frame.body);
  let utf8 = null;
  try { utf8 = new TextDecoder('utf-8', {fatal: true}).decode(body); } catch { /* binary */ }
  if (format === 'json') return JSON.stringify({destination: header(frame, 'destination'), messageId: header(frame, 'message-id'), headers: frame.headers, bodyUtf8: utf8, bodyHex: body.toString('hex')});
  return `message destination=${header(frame, 'destination')} body=${utf8 !== null ? JSON.stringify(utf8) : 'hex:' + body.toString('hex')}`;
}
function ackHeaders(c, frame, subId) {
  const v = c.version();
  if (v === '1.2') return [['id', header(frame, 'ack')]];
  if (v === '1.1') return [['subscription', subId], ['message-id', header(frame, 'message-id')]];
  return [['message-id', header(frame, 'message-id')]];
}

async function run(o) {
  const c = new TcpClient({host: o.host, port: o.port});
  try {
    await c.connect({versions: o.versions, ...(o.heartbeat ? {heartbeat: o.heartbeat} : {})});
    if (o.command === 'send') {
      const headers = [['destination', o.destination], ...o.headers];
      if (o.tx) {
        const t = 'cli-tx';
        await c.receipt('BEGIN', [['transaction', t]]);
        await c.receipt('SEND', [...headers, ['transaction', t]], o.body);
        await c.receipt(o.tx === 'commit' ? 'COMMIT' : 'ABORT', [['transaction', t]]);
        console.log(`sent destination=${o.destination} bytes=${o.body.length} tx=${o.tx}`);
      } else if (o.receipt) {
        await c.receipt('SEND', headers, o.body);
        console.log(`sent destination=${o.destination} bytes=${o.body.length} receipt=confirmed`);
      } else {
        c.send('SEND', headers, o.body);
        console.log(`sent destination=${o.destination} bytes=${o.body.length} receipt=not-requested`);
      }
    } else {
      const subId = 'cli-sub';
      await c.receipt('SUBSCRIBE', [['id', subId], ['destination', o.destination], ['ack', o.ack]]);
      for (let n = 0; n < o.count; n++) {
        const frame = (await c.waitFor(e => e.event === 'message', o.timeout)).frame;
        console.log(render(frame, o.format));
        if (o.ack !== 'auto') {
          const reject = o.nackIf !== undefined && Buffer.from(frame.body).toString('utf8').includes(o.nackIf);
          await c.receipt(reject ? 'NACK' : 'ACK', ackHeaders(c, frame, subId));
          console.error(reject ? 'nack' : 'ack');
        }
      }
      await c.receipt('UNSUBSCRIBE', [['id', subId]]);
    }
    await c.disconnect();
  } finally { c.stop(); }
}

if (require.main === module) {
  let options;
  try {
    if (process.argv.includes('--help') || process.argv.length < 3) { console.log(USAGE); process.exit(process.argv.length < 3 ? 2 : 0); }
    options = parse(process.argv.slice(2));
  } catch (e) { console.error((e instanceof UsageError ? 'usage error: ' : 'error: ') + e.message + '\n' + USAGE); process.exit(2); }
  run(options).then(() => process.exit(0), e => { console.error('error: ' + e.message); process.exit(1); });
}
module.exports = {parse, run, UsageError};
