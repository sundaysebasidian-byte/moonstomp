#!/usr/bin/env node
'use strict';
// moonstomp CLI: `send` and `subscribe` over the MoonBit-core TCP adapter.
// Exit codes: 0 success, 1 runtime failure (connect/timeout/broker error), 2 usage error.
// Plaintext and anonymous unless --login/--passcode-env/--tls are given; see README "Boundaries".
const fs = require('node:fs');
const TcpClient = require('./load-adapter.cjs').loadTcpClient();
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
exit codes: 0 ok, 1 failure, 2 usage`;

class UsageError extends Error {}
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
  if (!Number.isInteger(o.port) || o.port < 1 || o.port > 65535) throw new UsageError('--port must be 1..65535');
  if (passcodeEnv !== undefined) {
    if (o.passcode !== undefined) throw new UsageError('use either --passcode or --passcode-env, not both');
    if (env[passcodeEnv] === undefined) throw new UsageError(`environment variable ${passcodeEnv} is not set`);
    o.passcode = env[passcodeEnv];
  }
  if ((o.login === undefined) !== (o.passcode === undefined)) throw new UsageError('--login and a passcode (--passcode-env or --passcode) go together');
  for (const [name, text] of [['--login', o.login], ['--passcode', o.passcode], ['--vhost', o.virtualHost]]) {
    if (text !== undefined && /[\r\n\0]/.test(text)) throw new UsageError(`${name} must not contain CR, LF or NUL`);
  }
  if ((o.tlsCa !== undefined || o.tlsServername !== undefined) && !o.tls) throw new UsageError('--tls-ca and --tls-servername need --tls');
  if (!LOOPBACK.includes(o.host) && !o.remote) throw new UsageError(`non-loopback host needs --allow-remote (${o.tls ? 'TLS is checked against --tls-ca or the system store' : 'plaintext'}; only a scripted local TLS peer has been tested)`);
  if (!LOOPBACK.includes(o.host) && o.login !== undefined && !o.tls) throw new UsageError('refusing to send a login over plaintext to a non-loopback host; add --tls');
  if (!['auto', 'client', 'client-individual'].includes(o.ack)) throw new UsageError('--ack must be auto, client or client-individual');
  if (!['text', 'json'].includes(o.format)) throw new UsageError('--format must be text or json');
  if (!Number.isInteger(o.count) || o.count < 1) throw new UsageError('--count must be a positive integer');
  if (!Number.isInteger(o.timeout) || o.timeout < 1) throw new UsageError('--timeout must be a positive integer (ms)');
  if (bodySource) {
    const {kind, value} = bodySource;
    if (kind === '--body') o.body = Buffer.from(value, 'utf8');
    else if (kind === '--body-file') o.body = fs.readFileSync(value);
    else if (kind === '--stdin') o.body = fs.readFileSync(0);
    else {
      if (!/^([0-9a-fA-F]{2})*$/.test(value)) throw new UsageError('--body-hex needs an even number of hex digits');
      o.body = Buffer.from(value, 'hex');
    }
  }
  if (o.command === 'send' && o.body === undefined) throw new UsageError('send needs --body, --body-file, --body-hex or --stdin');
  if (o.command === 'send' && o.tx && !o.receipt) throw new UsageError('--tx needs receipts (omit --no-receipt)');
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
function writeLine(text) {
  return new Promise((resolve, reject) => {
    const output = process.stdout;
    const closedError = () => Object.assign(new Error('stdout is closed'), {code: 'ERR_STREAM_DESTROYED'});
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
      const sub = await c.subscribe(o.destination, {ack: o.ack});
      for (let n = 0; n < o.count; n++) {
        const frame = await sub.next(o.timeout);
        await writeLine(render(frame, o.format));
        if (o.ack !== 'auto') {
          const reject = o.nackIf !== undefined && Buffer.from(frame.body).toString('utf8').includes(o.nackIf);
          if (reject) sub.nack(frame); else sub.ack(frame);
          console.error(reject ? 'nack' : 'ack');
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
    if (process.argv.includes('--help') || process.argv.length < 3) { console.log(USAGE); process.exit(process.argv.length < 3 ? 2 : 0); }
    if (process.argv[2] === 'demo') {
      if (process.argv.length > 3) throw new UsageError('demo takes no options');
      demo().then(() => process.exit(0), e => { console.error('error: ' + safeLine(e.message)); process.exit(1); });
      return;
    }
    options = parse(process.argv.slice(2));
  } catch (e) { console.error((e instanceof UsageError ? 'usage error: ' : 'error: ') + safeLine(e.message) + '\n' + USAGE); process.exit(2); }
  const state = {};
  run(options, state).then(() => process.exit(0), e => {
    console.error('error: ' + friendlyError(e, options.host, options.port, {connecting: state.connecting, credentials: options.login !== undefined}));
    process.exit(1);
  });
}
module.exports = {parse, run, UsageError};
