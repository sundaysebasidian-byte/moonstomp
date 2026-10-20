#!/usr/bin/env node
'use strict';
// MoonSTOMP demo broker: a small in-memory STOMP 1.0/1.1/1.2 broker for demos and
// CI. It is NOT a conformance reference and NOT evidence of broker
// interoperability (use the Artemis/go-stomp runner for that). It exists so every
// example can run with one command and no external download.
// Scope: loopback only, in-memory, no TLS, no persistence. Anonymous unless started
// with `credentials` (then CONNECT must carry the exact login/passcode, otherwise an
// ERROR frame is returned) - a test peer for the client's authentication path only.
// Parsing is deliberately independent of the MoonBit codec under test.
const net = require('node:net');

const NUL = 0;
function unescape(value, version) {
  if (version === '1.0') return value;
  const table = version === '1.1' ? {n: '\n', c: ':', '\\': '\\'} : {n: '\n', c: ':', r: '\r', '\\': '\\'};
  let out = '';
  for (let i = 0; i < value.length; i++) {
    if (value[i] !== '\\') { out += value[i]; continue; }
    const mapped = table[value[++i]];
    if (mapped === undefined) throw new Error('undefined escape');
    out += mapped;
  }
  return out;
}
function escape(value, version) {
  if (version === '1.0') return value;
  let out = value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/:/g, '\\c');
  if (version === '1.2') out = out.replace(/\r/g, '\\r');
  return out;
}
function encode(command, headers, body, version) {
  const parts = [Buffer.from(command + '\n' + headers.map(([k, v]) => escape(k, version) + ':' + escape(v, version) + '\n').join('') + '\n')];
  if (body && body.length) parts.push(Buffer.from(body));
  parts.push(Buffer.from([NUL]));
  return Buffer.concat(parts);
}

// Incremental frame parser. Returns {frames, rest}; heart-beat EOLs are skipped.
function parseFrames(buffer, version) {
  const frames = [];
  for (;;) {
    let start = 0;
    while (start < buffer.length && (buffer[start] === 10 || (buffer[start] === 13 && buffer[start + 1] === 10))) start += buffer[start] === 13 ? 2 : 1;
    buffer = buffer.subarray(start);
    const headEnd = buffer.indexOf('\n\n');
    if (headEnd < 0) break;
    const lines = buffer.subarray(0, headEnd).toString('utf8').split('\n').map(l => l.replace(/\r$/, ''));
    const command = lines.shift();
    const headers = [];
    for (const line of lines) {
      const at = line.indexOf(':');
      if (at < 0) throw new Error('malformed header');
      const name = command === 'CONNECT' || command === 'STOMP' ? line.slice(0, at) : unescape(line.slice(0, at), version);
      const value = command === 'CONNECT' || command === 'STOMP' ? line.slice(at + 1) : unescape(line.slice(at + 1), version);
      headers.push([name, value]);
    }
    const lengthHeader = headers.find(h => h[0] === 'content-length');
    const bodyStart = headEnd + 2;
    let bodyEnd;
    if (lengthHeader) {
      bodyEnd = bodyStart + Number(lengthHeader[1]);
      if (buffer.length < bodyEnd + 1) break;
      if (buffer[bodyEnd] !== NUL) throw new Error('body not terminated');
    } else {
      bodyEnd = buffer.indexOf(NUL, bodyStart);
      if (bodyEnd < 0) break;
    }
    frames.push({command, headers, body: Buffer.from(buffer.subarray(bodyStart, bodyEnd))});
    buffer = buffer.subarray(bodyEnd + 1);
  }
  return {frames, rest: buffer};
}
const header = (frame, name) => frame.headers.find(h => h[0] === name)?.[1];

// options: heartbeat 'cx,cy' offered by broker (default '0,0'); nack 'requeue'|'discard';
// swallowReceipts: never answer receipt requests (demo of unknown outcome);
// silentAfterConnect: stop all output after CONNECTED (demo of dead-peer detection);
// credentials {login, passcode}: require them on CONNECT (default: anonymous).
async function startDemoBroker({port = 0, host = '127.0.0.1', heartbeat = '0,0', nack = 'requeue', swallowReceipts = false, silentAfterConnect = false, versions = ['1.0', '1.1', '1.2'], credentials = null} = {}) {
  if (host !== '127.0.0.1' && host !== '::1') throw new Error('demo broker is loopback only');
  const queues = new Map();   // destination -> {pending: [], subs: [], next: 0}
  const sessions = new Set();
  const received = [];        // commands seen by the broker, for tests
  let messageSeq = 0;
  const queueOf = d => { if (!queues.has(d)) queues.set(d, {pending: [], subs: [], next: 0}); return queues.get(d); };

  function dispatch(destination) {
    const q = queueOf(destination);
    if (destination.startsWith('/topic/')) return; // topics are delivered immediately, never buffered
    while (q.pending.length && q.subs.length) {
      const sub = q.subs[q.next++ % q.subs.length];
      deliver(sub, q.pending.shift());
    }
  }
  function deliver(sub, message) {
    const s = sub.session, id = 'm' + (++messageSeq);
    const headers = [['subscription', sub.id], ['message-id', id], ['destination', message.destination]];
    if (sub.ack !== 'auto' && s.version === '1.2') headers.push(['ack', 'a' + messageSeq]);
    if (message.redelivered) headers.push(['redelivered', 'true']);
    for (const h of message.headers) headers.push(h);
    if (sub.ack !== 'auto') sub.unacked.set(s.version === '1.2' ? 'a' + messageSeq : id, {message, id});
    s.write('MESSAGE', headers, message.body);
  }
  function publish(destination, headers, body) {
    const message = {destination, headers: headers.filter(h => !['destination', 'transaction', 'receipt'].includes(h[0])), body};
    if (destination.startsWith('/topic/')) { for (const sub of queueOf(destination).subs) deliver(sub, {...message}); }
    else { queueOf(destination).pending.push(message); dispatch(destination); }
  }

  const server = net.createServer(socket => {
    const s = {socket, version: '1.0', connected: false, subs: new Map(), tx: new Map(), buffer: Buffer.alloc(0), timer: null, lastIn: Date.now(), clientBeat: 0, silent: false};
    sessions.add(s);
    s.write = (command, headers, body) => { if (!s.silent && !socket.destroyed) socket.write(encode(command, headers, body, s.version)); };
    const close = () => {
      clearInterval(s.timer);
      for (const sub of s.subs.values()) {
        const q = queueOf(sub.destination); q.subs = q.subs.filter(x => x !== sub);
        for (const {message} of sub.unacked.values()) { message.redelivered = true; q.pending.unshift(message); }
      }
      s.subs.clear(); sessions.delete(s);
      for (const d of queues.keys()) dispatch(d);
      socket.destroy();
    };
    s.close = close;
    const fail = text => { s.write('ERROR', [['message', text]], Buffer.from(text)); socket.end(); setTimeout(close, 20); };
    socket.on('error', close); socket.on('close', close);
    socket.on('data', chunk => {
      s.lastIn = Date.now();
      let parsed;
      try { parsed = parseFrames(Buffer.concat([s.buffer, chunk]), s.version); } catch (e) { return fail('malformed frame: ' + e.message); }
      s.buffer = parsed.rest;
      for (const frame of parsed.frames) { try { handle(s, frame, fail); } catch (e) { return fail(e.message); } }
    });
  });

  function finishTx(s, name, commit) {
    const ops = s.tx.get(name);
    if (!ops) throw new Error('unknown transaction ' + name);
    s.tx.delete(name);
    if (commit) for (const op of ops) op();
  }
  function handle(s, frame, fail) {
    received.push(frame.command);
    const receipt = header(frame, 'receipt');
    const ok = () => { if (receipt && !swallowReceipts) s.write('RECEIPT', [['receipt-id', receipt]]); };
    if (!s.connected) {
      if (frame.command !== 'CONNECT' && frame.command !== 'STOMP') throw new Error('CONNECT required');
      const offered = (header(frame, 'accept-version') || '1.0').split(',');
      const common = versions.filter(v => offered.includes(v));
      if (!common.length) { s.write('ERROR', [['version', versions.join(',')], ['message', 'unsupported version']], Buffer.from('supported versions: ' + versions.join(','))); s.socket.end(); return; }
      if (credentials && (header(frame, 'login') !== credentials.login || header(frame, 'passcode') !== credentials.passcode)) {
        s.write('ERROR', [['message', 'authentication failed'], ['content-type', 'text/plain']], Buffer.from('login or passcode rejected by the demo broker'));
        s.socket.end(); return;
      }
      s.version = common[common.length - 1]; s.connected = true;
      const headers = [['version', s.version]];
      if (s.version !== '1.0') {
        const [cx, cy] = (header(frame, 'heart-beat') || '0,0').split(',').map(Number);
        const [sx, sy] = heartbeat.split(',').map(Number);
        headers.push(['heart-beat', heartbeat]);
        s.clientBeat = cx && sy ? Math.max(cx, sy) : 0;   // client send interval we expect
        const out = sx && cy ? Math.max(sx, cy) : 0;      // our send interval
        if (out) s.timer = setInterval(() => { if (!s.silent && !s.socket.destroyed) s.socket.write('\n'); }, out);
      }
      s.write('CONNECTED', headers);
      if (silentAfterConnect) s.silent = true;
      return;
    }
    switch (frame.command) {
      case 'SEND': {
        const destination = header(frame, 'destination'); if (!destination) throw new Error('destination required');
        const txn = header(frame, 'transaction');
        const apply = () => publish(destination, frame.headers, frame.body);
        if (txn) { if (!s.tx.has(txn)) throw new Error('unknown transaction ' + txn); s.tx.get(txn).push(apply); } else apply();
        return ok();
      }
      case 'SUBSCRIBE': {
        const id = header(frame, 'id'), destination = header(frame, 'destination');
        if (!destination || (s.version !== '1.0' && !id)) throw new Error('destination and id required');
        const key = id ?? destination;
        if (s.subs.has(key)) throw new Error('duplicate subscription');
        const ack = header(frame, 'ack') || 'auto';
        if (!['auto', 'client', 'client-individual'].includes(ack) || (s.version === '1.0' && ack === 'client-individual')) throw new Error('invalid ack mode');
        const sub = {id: key, destination, ack, session: s, unacked: new Map()};
        s.subs.set(key, sub); queueOf(destination).subs.push(sub);
        ok(); dispatch(destination); return;
      }
      case 'UNSUBSCRIBE': {
        const key = header(frame, 'id') ?? header(frame, 'destination'), sub = s.subs.get(key);
        if (!sub) throw new Error('unknown subscription');
        s.subs.delete(key); const q = queueOf(sub.destination); q.subs = q.subs.filter(x => x !== sub);
        for (const {message} of sub.unacked.values()) { message.redelivered = true; q.pending.unshift(message); }
        ok(); dispatch(sub.destination); return;
      }
      case 'ACK': case 'NACK': {
        if (frame.command === 'NACK' && s.version === '1.0') throw new Error('NACK unavailable in 1.0');
        const key = s.version === '1.2' ? header(frame, 'id') : header(frame, 'message-id');
        if (!key) throw new Error('ack id required');
        let found = null;
        for (const sub of s.subs.values()) {
          if (s.version === '1.1' && header(frame, 'subscription') !== sub.id) continue;
          if (sub.unacked.has(key)) { found = sub; break; }
        }
        if (!found) throw new Error('unknown message to ack');
        const txn = header(frame, 'transaction');
        const apply = () => {
          const settled = [];
          if (found.ack === 'client') { // cumulative: everything up to and including key (insertion order)
            for (const k of [...found.unacked.keys()]) { settled.push(found.unacked.get(k)); found.unacked.delete(k); if (k === key) break; }
          } else { settled.push(found.unacked.get(key)); found.unacked.delete(key); }
          if (frame.command === 'NACK' && nack === 'requeue') {
            const q = queueOf(found.destination);
            for (const {message} of settled.reverse()) { message.redelivered = true; q.pending.unshift(message); }
            dispatch(found.destination);
          }
        };
        if (txn) { if (!s.tx.has(txn)) throw new Error('unknown transaction ' + txn); s.tx.get(txn).push(apply); } else apply();
        return ok();
      }
      case 'BEGIN': { const t = header(frame, 'transaction'); if (!t || s.tx.has(t)) throw new Error('invalid transaction'); s.tx.set(t, []); return ok(); }
      case 'COMMIT': finishTx(s, header(frame, 'transaction'), true); return ok();
      case 'ABORT': finishTx(s, header(frame, 'transaction'), false); return ok();
      case 'DISCONNECT': ok(); s.socket.end(); setTimeout(s.close, 20); return;
      default: throw new Error('unsupported command ' + frame.command);
    }
  }

  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
  return {
    host, port: server.address().port, received,
    pending: d => queueOf(d).pending.length,
    async close() { for (const s of [...sessions]) s.close(); await new Promise(r => server.close(r)); },
  };
}

module.exports = {startDemoBroker, parseFrames, encode};

if (require.main === module) {
  const args = process.argv.slice(2);
  const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
  if (args.includes('--help')) {
    console.log('usage: node tools/demo-broker.cjs [--port 61613] [--heartbeat 0,0] [--nack requeue|discard]\n                                  [--login USER --passcode PASS]\nIn-memory loopback STOMP demo broker; not a conformance reference. Anonymous unless --login/--passcode are given.');
    process.exit(0);
  }
  const login = opt('--login'), passcode = opt('--passcode');
  if ((login === undefined) !== (passcode === undefined)) { console.error('--login and --passcode go together'); process.exit(2); }
  startDemoBroker({port: Number(opt('--port', '61613')), heartbeat: opt('--heartbeat', '0,0'), nack: opt('--nack', 'requeue'), ...(login !== undefined ? {credentials: {login, passcode}} : {})}).then(b => {
    console.log(`demo broker listening on ${b.host}:${b.port} (Ctrl-C to stop)`);
    process.on('SIGINT', () => b.close().then(() => process.exit(0)));
    process.on('SIGTERM', () => b.close().then(() => process.exit(0)));
  }).catch(e => { console.error(e.message); process.exit(1); });
}
