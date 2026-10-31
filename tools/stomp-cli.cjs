#!/usr/bin/env node
'use strict';
// moonstomp CLI: `send` and `subscribe` over the MoonBit-core TCP adapter.
// Exit codes: 0 success, 1 runtime failure (connect/timeout/broker error), 2 usage error.
// Plaintext and anonymous unless --login/--passcode-env/--tls are given; see README "Boundaries".
const fs = require('node:fs');
const {friendlyError, safeLine, safeJson} = require('./friendly-error.cjs');

const USAGE = `usage:
  stomp-cli demo      (no broker needed: starts the in-memory demo broker, sends one message, receives it, exits)
  stomp-cli send      --destination D (--body TEXT | --body-file F | --body-hex HEX | --stdin)
                      [--header k=v]... [--no-receipt] [--tx commit|abort]
  stomp-cli subscribe --destination D   (alias: listen) [--count N] [--ack auto|client|client-individual]
                      [--nack-if SUBSTR] [--timeout MS] [--format text|json]
common: [--host 127.0.0.1] [--port 61613] [--versions 1.0,1.1,1.2] [--heartbeat cx,cy] [--vhost NAME]
        [--login USER (--passcode-env VAR | --passcode PASS)]   (a passcode on the command line is visible to other local users)
        [--tls [--tls-ca FILE] [--tls-servername NAME]]         (certificate verification is always on)
        [--allow-remote]   (non-loopback host; needs --tls when a login is given)
body limit: 1048576 bytes (text/hex/file/stdin; checked before connecting)
exit codes: 0 ok, 1 failure, 2 usage`;

class UsageError extends Error {}
const MAX_BODY_BYTES = 1024 * 1024; // Match the default MoonBit outbound body limit.
function bodyLimit(size) {
  if (size > MAX_BODY_BYTES) throw new UsageError('body must not exceed 1048576 bytes');
}
function readBody(source) {
  const owned = source !== 0;
  const fd = owned ? fs.openSync(source, 'r') : source;
  try {
    // One bounded allocation reused even for streams producing one byte/read.
    // The extra byte distinguishes exactly-at-limit EOF from an oversized body.
    const buffer = Buffer.allocUnsafe(MAX_BODY_BYTES + 1);
    let size = 0;
    for (;;) {
      const count = fs.readSync(fd, buffer, size, buffer.length - size, null);
      if (count === 0) return Buffer.from(buffer.subarray(0, size));
      size += count;
      bodyLimit(size);
    }
  } finally { if (owned) fs.closeSync(fd); }
}
// Recognize help only in option positions, never inside a value such as --body.
function helpRequested(argv) {
  if (argv[0] === '--help') return true;
  if (!['send', 'subscribe', 'listen', 'demo'].includes(argv[0])) return false;
  const flags = new Set(['--no-receipt', '--stdin', '--allow-remote', '--tls']);
  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === '--help') return true;
    if (!flags.has(argv[i])) i++;
  }
  return false;
}

const LOOPBACK = ['127.0.0.1', '::1', 'localhost'];
function parse(argv, env = process.env) {
  let [command, ...rest] = argv;
  if (command === 'listen') command = 'subscribe';
  if (!['send', 'subscribe'].includes(command)) throw new UsageError(command ? `unknown command ${command}` : 'missing command');
  const o = {command, headers: [], versions: ['1.2'], host: '127.0.0.1', port: 61613, count: 1, ack: 'auto', timeout: 5000, format: 'text', receipt: true};
  const flags = new Set(['--no-receipt', '--stdin', '--allow-remote', '--tls']);
  let passcodeEnv;
  let bodySource;
  const supplied = new Set();
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (!a.startsWith('--')) throw new UsageError(`unexpected argument ${a}`);
    supplied.add(a);
    const value = flags.has(a) ? true : rest[++i];
    if (value === undefined) throw new UsageError(`${a} needs a value`);
    switch (a) {
      case '--destination': o.destination = value; break;
      case '--body':
      case '--body-file':
      case '--body-hex':
      case '--stdin':
        if (bodySource) throw new UsageError('exactly one body source is allowed');
        bodySource = {kind: a, value};
        break;
      case '--header': { const at = value.indexOf('='); if (at < 1) throw new UsageError('--header needs k=v'); o.headers.push([value.slice(0, at), value.slice(at + 1)]); break; }
      case '--no-receipt': o.receipt = false; break;
      case '--tx': if (!['commit', 'abort'].includes(value)) throw new UsageError('--tx is commit or abort'); o.tx = value; break;
      case '--host': o.host = value; break;
      case '--port': o.port = Number(value); break;
      case '--versions': o.versions = value.split(','); break;
      case '--heartbeat': o.heartbeat = value; break;
      case '--vhost': o.virtualHost = value; break;
      case '--login': o.login = value; break;
      case '--passcode': o.passcode = value; break;
      case '--passcode-env': passcodeEnv = value; break;
      case '--tls': o.tls = true; break;
      case '--tls-ca': o.tlsCa = value; break;
      case '--tls-servername': o.tlsServername = value; break;
      case '--count': o.count = Number(value); break;
      case '--ack': o.ack = value; break;
      case '--nack-if': o.nackIf = value; break;
      case '--timeout': o.timeout = Number(value); break;
      case '--format': o.format = value; break;
      case '--allow-remote': o.remote = true; break;
      default: throw new UsageError(`unknown option ${a}`);
    }
  }
  const otherCommandOptions = command === 'subscribe'
    ? ['--body', '--body-file', '--body-hex', '--stdin', '--header', '--no-receipt', '--tx']
    : ['--count', '--ack', '--nack-if', '--timeout', '--format'];
  const wrongOption = otherCommandOptions.find(flag => supplied.has(flag));
  if (wrongOption) throw new UsageError(`${wrongOption} is only valid for ${command === 'subscribe' ? 'send' : 'subscribe'}`);
  if (!o.destination) throw new UsageError('--destination is required');
  if (!o.host.trim() || /[\r\n\0]/.test(o.host)) throw new UsageError('--host must be nonempty and contain no CR, LF or NUL');
  if (o.virtualHost !== undefined && !o.virtualHost.trim()) throw new UsageError('--vhost must be nonempty');
  if (o.versions.length < 1 || o.versions.length > 3 || new Set(o.versions).size !== o.versions.length || o.versions.some(v => !['1.0','1.1','1.2'].includes(v))) throw new UsageError('--versions must contain unique 1.0, 1.1 or 1.2 values');
  if (o.heartbeat !== undefined && (!/^[0-9]+,[0-9]+$/.test(o.heartbeat) || o.heartbeat.split(',').some(n => Number(n) > 2147483647))) throw new UsageError('--heartbeat must be two integers from 0 through 2147483647');
  if (o.versions.length === 1 && o.versions[0] === '1.0' && o.heartbeat !== undefined && o.heartbeat.split(',').some(n => Number(n) !== 0)) throw new UsageError('STOMP 1.0 does not support heartbeat');
  if (/\0/.test(o.destination) || Buffer.byteLength('destination') + Buffer.byteLength(o.destination) > 2047) throw new UsageError('invalid or oversized destination');
  const sendHeaderBase = 1 + (o.tx || o.receipt ? 1 : 0); // destination + transaction/receipt
  if (o.headers.length + sendHeaderBase > 128 || o.headers.some(([key,value]) => /\0/.test(key + value) || Buffer.byteLength(key) + Buffer.byteLength(value) > 2047 || ['destination','receipt','transaction'].includes(key))) throw new UsageError('invalid, oversized or reserved --header');
  // Validate for every offered version: negotiation may choose literal 1.0 headers.
  if (o.versions.includes('1.0') && (/\n/.test(o.destination) || o.headers.some(([key,value]) => /[\n:]/.test(key) || /\n/.test(value)))) throw new UsageError('STOMP 1.0 headers cannot contain LF or a colon in the name');
  for (const [key, value] of o.headers) {
    if (key === 'content-length' && (!/^[0-9]+$/.test(value) || Number(value) > MAX_BODY_BYTES)) throw new UsageError('content-length must be an integer from 0 through 1048576');
  }
  if (!Number.isInteger(o.port) || o.port < 1 || o.port > 65535) throw new UsageError('--port must be 1..65535');
  if (passcodeEnv !== undefined) {
    if (o.passcode !== undefined) throw new UsageError('use either --passcode or --passcode-env, not both');
    if (env[passcodeEnv] === undefined) throw new UsageError(`environment variable ${passcodeEnv} is not set`);
    o.passcode = env[passcodeEnv];
  }
  if ((o.login === undefined) !== (o.passcode === undefined)) throw new UsageError('--login and a passcode (--passcode-env or --passcode) go together');
  for (const [name, key, text] of [['--login', 'login', o.login], ['--passcode', 'passcode', o.passcode], ['--vhost', 'host', o.virtualHost], ['--heartbeat', 'heart-beat', o.heartbeat]]) {
    if (text !== undefined && /[\r\n\0]/.test(text)) throw new UsageError(`${name} must not contain CR, LF or NUL`);
    if (text !== undefined && Buffer.byteLength(key) + Buffer.byteLength(text) > 2047) throw new UsageError(`${name} exceeds the 2047-byte header limit`);
  }
  if ((o.tlsCa !== undefined || o.tlsServername !== undefined) && !o.tls) throw new UsageError('--tls-ca and --tls-servername need --tls');
  if (!LOOPBACK.includes(o.host) && !o.remote) throw new UsageError(`non-loopback host needs --allow-remote (${o.tls ? 'TLS is checked against --tls-ca or the system store' : 'plaintext'}; only a scripted local TLS peer has been tested)`);
  if (!LOOPBACK.includes(o.host) && o.login !== undefined && !o.tls) throw new UsageError('refusing to send a login over plaintext to a non-loopback host; add --tls');
  if (!['auto', 'client', 'client-individual'].includes(o.ack)) throw new UsageError('--ack must be auto, client or client-individual');
  if (o.nackIf !== undefined && o.ack === 'auto') throw new UsageError('--nack-if requires --ack client or client-individual');
  if (o.nackIf !== undefined && o.versions.length === 1 && o.versions[0] === '1.0') throw new UsageError('--nack-if requires STOMP 1.1 or 1.2');
  if (!['text', 'json'].includes(o.format)) throw new UsageError('--format must be text or json');
  if (!Number.isSafeInteger(o.count) || o.count < 1) throw new UsageError('--count must be a positive integer');
  if (!Number.isInteger(o.timeout) || o.timeout < 1 || o.timeout > 2147483647) throw new UsageError('--timeout must be an integer from 1 through 2147483647 (ms)');
  if (o.command === 'send' && !bodySource) throw new UsageError('send needs --body, --body-file, --body-hex or --stdin');
  if (o.command === 'send' && o.tx && !o.receipt) throw new UsageError('--tx needs receipts (omit --no-receipt)');
  if (bodySource) {
    const {kind, value} = bodySource;
    if (kind === '--body') { bodyLimit(Buffer.byteLength(value, 'utf8')); o.body = Buffer.from(value, 'utf8'); }
    else if (kind === '--body-file') o.body = readBody(value);
    else if (kind === '--stdin') o.body = readBody(0);
    else {
      bodyLimit(Math.ceil(value.length / 2));
      if (!/^([0-9a-fA-F]{2})*$/.test(value)) throw new UsageError('--body-hex needs an even number of hex digits');
      o.body = Buffer.from(value, 'hex');
    }
  }
  const declaredLength = o.headers.find(([key]) => key === 'content-length')?.[1];
  if (declaredLength !== undefined && Number(declaredLength) !== o.body.length) throw new UsageError('content-length must match the body byte length');
  if (o.command === 'send' && o.headers.length + sendHeaderBase + (o.body.length > 0 && declaredLength === undefined ? 1 : 0) > 128) throw new UsageError('SEND exceeds the 128-header limit including content-length');
  return o;
}
const header = (frame, name) => frame.headers.find(h => h[0] === name)?.[1];
function render(frame, format) {
  const body = Buffer.from(frame.body);
  let utf8 = null;
  // STOMP bodies are message data: a UTF-8 BOM must not be silently stripped.
  try { utf8 = new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(body); } catch { /* binary */ }
  if (format === 'json') return safeJson({destination: header(frame, 'destination'), messageId: header(frame, 'message-id'), headers: frame.headers, bodyUtf8: utf8, bodyHex: body.toString('hex')});
  return `message destination=${safeLine(header(frame, 'destination'))} body=${utf8 !== null ? safeJson(utf8) : 'hex:' + body.toString('hex')}`;
}

// Wait for local stdout completion before acknowledging a delivery. This does
// not prove that the pipe's consumer processed or persisted the message.
function writeLine(text, output = process.stdout) {
  return new Promise((resolve, reject) => {
    const closedError = () => Object.assign(new Error('output is closed'), {code: 'ERR_STREAM_DESTROYED'});
    if (output.destroyed || output.writableEnded) {
      reject(closedError());
      return;
    }
    let settled = false;
    const cleanup = () => {
      output.removeListener('error', onError);
      output.removeListener('close', onClose);
    };
    const fail = (error, keepErrorThroughTurn = false) => {
      if (settled) return;
      settled = true;
      output.removeListener('close', onClose);
      // Writable may emit error after its callback. Retain the handler through
      // this turn, then clean up even when a destroyed stream emits none.
      if (keepErrorThroughTurn) setImmediate(cleanup); else cleanup();
      reject(error);
    };
    const onError = error => fail(error);
    const onClose = () => fail(closedError(), true);
    output.once('error', onError);
    output.once('close', onClose);
    try {
      output.write(text + '\n', error => {
        if (error) fail(error, true);
        else if (!settled) {
          settled = true;
          cleanup();
          resolve();
        }
      });
    } catch (error) { fail(error, true); }
  });
}

function exitWithLine(code, text, output = process.stderr) {
  writeLine(text, output).then(() => process.exit(code), () => process.exit(code || 1));
}

// Offline demonstration against the in-process demo broker (a test peer, not a real broker).
async function demo() {
  const {startDemoBroker} = require('./demo-broker.cjs');
  const broker = await startDemoBroker({port: 0});
  const common = {host: '127.0.0.1', port: broker.port, versions: ['1.2'], headers: [], count: 1, ack: 'auto', timeout: 5000, format: 'text', receipt: true, destination: '/queue/demo'};
  try {
    await writeLine(`demo: in-process demo broker on 127.0.0.1:${broker.port} (a test peer, not a real broker)`);
    await run({...common, command: 'send', body: Buffer.from('hello from MoonSTOMP', 'utf8')});
    await run({...common, command: 'subscribe'});
    await writeLine('demo: ok');
  } finally { await broker.close(); }
}

function clientFor(o) {
  const TcpClient = require('./load-adapter.cjs').loadTcpClient();
  const tlsOptions = o.tls ? {...(o.tlsCa ? {ca: fs.readFileSync(o.tlsCa)} : {}), ...(o.tlsServername ? {servername: o.tlsServername} : {})} : null;
  return new TcpClient({host: o.host, port: o.port, tlsOptions});
}

// `state.connecting` tells main() whether an error happened before the broker accepted CONNECT.
async function run(o, state = {}) {
  const c = clientFor(o);
  state.connecting = true;
  try {
    await c.connect({versions: o.versions,
      ...(o.heartbeat ? {heartbeat: o.heartbeat} : {}), ...(o.virtualHost !== undefined ? {virtualHost: o.virtualHost} : {}),
      ...(o.login !== undefined ? {login: o.login, passcode: o.passcode} : {})});
    state.connecting = false;
    if (o.command === 'send') {
      const headers = [['destination', o.destination], ...o.headers];
      if (o.tx) {
        const tx = await c.beginTransaction();
        tx.send(o.destination, o.body, o.headers);
        await (o.tx === 'commit' ? tx.commit() : tx.abort());
        await writeLine(`sent destination=${safeLine(o.destination)} bytes=${o.body.length} tx=${o.tx}`);
      } else if (o.receipt) {
        await c.receipt('SEND', headers, o.body);
        await writeLine(`sent destination=${safeLine(o.destination)} bytes=${o.body.length} receipt=confirmed`);
      } else {
        c.send('SEND', headers, o.body);
        await writeLine(`sent destination=${safeLine(o.destination)} bytes=${o.body.length} receipt=not-requested`);
      }
    } else {
      if (o.nackIf !== undefined && c.version() === '1.0') throw new Error('--nack-if unavailable in negotiated STOMP 1.0');
      const sub = await c.subscribe(o.destination, {ack: o.ack});
      for (let n = 0; n < o.count; n++) {
        const frame = await sub.next(o.timeout);
        await writeLine(render(frame, o.format));
        if (o.ack !== 'auto') {
          const reject = o.nackIf !== undefined && Buffer.from(frame.body).toString('utf8').includes(o.nackIf);
          if (reject) sub.nack(frame); else sub.ack(frame);
          await writeLine(reject ? 'nack' : 'ack', process.stderr);
        }
      }
      await sub.unsubscribe();
    }
    await c.disconnect();
  } finally { c.stop(); }
}

if (require.main === module) {
  let options;
  try {
    if (helpRequested(process.argv.slice(2)) || process.argv.length < 3) { exitWithLine(process.argv.length < 3 ? 2 : 0, USAGE, process.stdout); return; }
    if (process.argv[2] === 'demo') {
      if (process.argv.length > 3) throw new UsageError('demo takes no options');
      demo().then(() => process.exit(0), e => exitWithLine(1, 'error: ' + safeLine(e.message)));
      return;
    }
    options = parse(process.argv.slice(2));
  } catch (e) { exitWithLine(2, (e instanceof UsageError ? 'usage error: ' : 'error: ') + safeLine(e.message) + '\n' + USAGE); return; }
  const state = {};
  run(options, state).then(() => process.exit(0), e =>
    exitWithLine(1, 'error: ' + friendlyError(e, options.host, options.port, {connecting: state.connecting, credentials: options.login !== undefined, secrets: [options.passcode]})));
}
module.exports = {parse, run, UsageError};
