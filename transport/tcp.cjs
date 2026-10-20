'use strict';
// Node TCP is glue only; framing, validation and session state run in MoonBit.
const net = require('node:net');
const tls = require('node:tls');
const {performance} = require('node:perf_hooks');
const {Subscription, Transaction, extraHeaders, handleError} = require('./handles.cjs');
require('../_build/js/debug/build/bridge/bridge.js');
const protocol = globalThis.MoonSTOMP;
class TcpClient {
  constructor({host = '127.0.0.1', port = 61613, tickMs = 25, maxQueue = 1024, maxWaiters = 256, maxQueueBytes = 4*1024*1024, tlsOptions = null} = {}) {
    if (typeof host !== 'string' || !host.trim().length || !Number.isInteger(port) || port < 1 || port > 65535 || !Number.isInteger(tickMs) || tickMs < 1 || tickMs > 2147483647 || !Number.isInteger(maxQueue) || maxQueue < 1 || !Number.isInteger(maxWaiters) || maxWaiters < 1 || !Number.isInteger(maxQueueBytes) || maxQueueBytes < 1) throw new Error('invalid TCP configuration');
    this.options = {host, port};
    if (tlsOptions !== null && (typeof tlsOptions !== 'object' || Array.isArray(tlsOptions) || tlsOptions.rejectUnauthorized === false || tlsOptions.socket !== undefined)) throw new Error('invalid TLS configuration; certificate verification is required');
    this.tlsOptions = tlsOptions === null ? null : {...tlsOptions};
    this.core = protocol.create(); this.queue = []; this.waiters = []; this.maxQueue = maxQueue; this.maxWaiters = maxWaiters; this.maxQueueBytes = maxQueueBytes; this.queueBytes = 0;
    this.origin = performance.now(); this.socket = null; this.timer = null; this.error = null; this.tickMs = tickMs;
    this.handleSequence = 0n;
  }
  now() { return BigInt(Math.floor(performance.now() - this.origin)); }
  state() { return protocol.state(this.core); }
  version() { return protocol.version(this.core); }
  stop(error = null) {
    if (error && !this.error) this.error = error;
    clearInterval(this.timer); this.timer = null;
    protocol.close(this.core);
    for (const w of this.waiters.splice(0)) { w.cleanup(); w.reject(this.error || new Error('connection closed')); }
    this.queue.length = 0; this.queueBytes = 0;
    if (this.socket && !this.socket.destroyed) this.socket.destroy();
  }
  _matches(predicate, event) {
    const result = predicate(event);
    if (typeof result !== 'boolean') {
      // Reject accidental async callbacks without leaving an unhandled rejection.
      if (result instanceof Promise) result.catch(() => {});
      throw new Error('event predicate must return a synchronous boolean');
    }
    return result;
  }
  deliver(event) {
    const i = this.waiters.findIndex(w => this._matches(w.predicate, event));
    if (i >= 0) { const w = this.waiters.splice(i,1)[0]; w.cleanup(); w.resolve(event); }
    else {
      // Liveness is already updated by MoonBit. Unobserved beats are transient.
      if (event.event === 'heartbeat') return;
      const size = Buffer.byteLength(JSON.stringify(event));
      if (this.queue.length >= this.maxQueue || this.queueBytes + size > this.maxQueueBytes) throw new Error('event queue limit');
      this.queue.push(event); this.queueBytes += size;
    }
  }
  waitFor(predicate, timeout = 5000) {
    return this._waitFor(predicate, timeout, false);
  }
  _waitFor(predicate, timeout, control, signal) {
    if (signal?.aborted) return Promise.reject(handleError('subscription closed'));
    if (typeof predicate !== 'function') return Promise.reject(new Error('invalid event predicate'));
    if (['AsyncFunction','AsyncGeneratorFunction','GeneratorFunction'].includes(predicate.constructor?.name)) return Promise.reject(new Error('event predicate must return a synchronous boolean'));
    if (!Number.isFinite(timeout) || timeout < 1 || timeout > 2147483647) return Promise.reject(new Error('invalid timeout'));
    let i;
    try { i = this.queue.findIndex(event => this._matches(predicate, event)); }
    catch (e) { return Promise.reject(e); }
    if (i >= 0) {
      const event = this.queue.splice(i, 1)[0];
      this.queueBytes -= Buffer.byteLength(JSON.stringify(event));
      return Promise.resolve(event);
    }
    if (this.error || this.state() === 'closed') return Promise.reject(this.error || new Error('connection closed'));
    if (this.waiters.length >= this.maxWaiters) return Promise.reject(new Error('waiter limit'));
    return new Promise((resolve,reject) => {
      const w = {predicate, resolve, reject};
      const cancel = () => { this.waiters = this.waiters.filter(x => x !== w); w.cleanup(); reject(handleError('subscription closed')); };
      w.cleanup = () => { clearTimeout(w.timer); signal?.removeEventListener('abort', cancel); };
      w.timer = setTimeout(() => { this.waiters = this.waiters.filter(x => x !== w); w.cleanup(); reject(new Error('event timeout')); }, timeout);
      signal?.addEventListener('abort', cancel, {once: true});
      // Dedicated handshake/receipt waits own their control events before generic
      // waitFor predicates; ordinary waits retain first-matching registration order.
      if (control) this.waiters.unshift(w); else this.waiters.push(w);
    });
  }
  write(bytes) {
    if (!bytes.length) return;
    if (!this.socket || this.socket.destroyed || this.socket.writableLength + bytes.length > 2*1024*1024) throw new Error('transport unavailable or write buffer limit');
    this.socket.write(bytes, error => { if (error) this.stop(error); });
  }
  send(command, headers = [], body = Buffer.alloc(0)) {
    try { this.write(protocol.send(this.core, command, headers, body, this.now())); }
    catch (e) { this.stop(e); throw e; }
  }
  acknowledge(message, {negative = false, transaction = ''} = {}) {
    if (!message || message.command !== 'MESSAGE') throw handleError('acknowledgement requires MESSAGE');
    try { this.write(protocol.acknowledge(this.core, message.headers, negative, transaction, this.now())); }
    catch (error) { this.stop(error); throw error; }
  }
  async subscribe(destination, {id = 'sub-' + (++this.handleSequence), ack = 'auto', headers = []} = {}) {
    if (typeof destination !== 'string' || !destination.length || typeof id !== 'string' || !id.length || !['auto', 'client', 'client-individual'].includes(ack) || (ack === 'client-individual' && this.version() === '1.0')) throw handleError('invalid subscription arguments');
    extraHeaders(headers, ['id', 'destination', 'ack', 'receipt']);
    await this.receipt('SUBSCRIBE', [['id', id], ['destination', destination], ['ack', ack], ...headers]);
    return new Subscription(this, id, destination, ack);
  }
  async beginTransaction({id = 'tx-' + (++this.handleSequence)} = {}) {
    if (typeof id !== 'string' || !id.length) throw handleError('invalid transaction id');
    await this.receipt('BEGIN', [['transaction', id]]);
    return new Transaction(this, id);
  }
  async connect({virtualHost = 'localhost', versions = ['1.2'], heartbeat = versions.length === 1 && versions[0] === '1.0' ? '0,0' : '1000,1000', login, passcode} = {}) {
    if (!Array.isArray(versions) || !versions.length || versions.length > 3 || new Set(versions).size !== versions.length || versions.some(v => !['1.0','1.1','1.2'].includes(v))) throw new Error('invalid offered STOMP versions');
    versions = versions.slice();
    // CONNECT values are literal, never STOMP-escaped. Validate before opening I/O.
    for (const value of [virtualHost, heartbeat, login, passcode]) {
      if (value !== undefined && (typeof value !== 'string' || /[\r\n\0]/.test(value))) throw new Error('invalid CONNECT header value');
    }
    const headers = versions.length === 1 && versions[0] === '1.0' && heartbeat === '0,0' ? [] : [['accept-version',versions.join(',')],['host',virtualHost],['heart-beat',heartbeat]];
    if (login !== undefined) headers.push(['login',login]);
    if (passcode !== undefined) headers.push(['passcode',passcode]);
    if (this.socket) throw new Error('connect once per client');
    const options = {...this.tlsOptions, ...this.options, rejectUnauthorized: true};
    if (!options.servername && !net.isIP(this.options.host)) options.servername = this.options.host;
    this.socket = this.tlsOptions === null ? net.createConnection(this.options) : tls.connect(options);
    this.socket.on('data', chunk => {
      try {
        for (const text of protocol.receive(this.core, chunk, this.now())) {
          const event = JSON.parse(text);
          this.deliver(event);
          if (event.event === 'error') {
            const error = new Error(event.frame.headers.find(h => h[0] === 'message')?.[1] || 'broker ERROR frame');
            error.name = 'MoonSTOMPBrokerError'; error.code = 'STOMP_BROKER_ERROR'; error.operation = 'receive'; error.frame = event.frame;
            throw error;
          }
        }
        if (this.state() === 'closed') this.stop();
      } catch(e) { this.stop(e); }
    });
    this.socket.on('error', e => this.stop(e));
    this.socket.on('end', () => this.stop(new Error(protocol.eof(this.core) ? 'peer EOF' : 'truncated STOMP stream')));
    this.socket.on('close', () => this.stop());
    const connected = this._waitFor(e => e.event === 'connected', 5000, true);
    // Consume rejection even when the socket fails before CONNECT is sent.
    connected.catch(() => {});
    this.socket.once(this.tlsOptions === null ? 'connect' : 'secureConnect', () => {
      try { this.send('CONNECT', headers); }
      catch(e) { this.stop(e); }
    });
    try { await connected; }
    catch(e) { this.stop(e); throw e; }
    if (this.state() !== 'active' || this.socket.destroyed) {
      const error = this.error || new Error('connection closed during negotiation');
      this.stop(error); throw error;
    }
    this.timer = setInterval(() => {
      try { this.write(protocol.tick(this.core, this.now())); } catch(e) { this.stop(e); }
    }, this.tickMs);
    return this;
  }
  async receipt(command, headers = [], body = Buffer.alloc(0), id = 'r-' + (++TcpClient.sequence)) {
    if (typeof id !== 'string' || !id.length || !Array.isArray(headers) || headers.some(h => !Array.isArray(h) || h.length !== 2 || h.some(v => typeof v !== 'string')) || !(body instanceof Uint8Array)) throw new Error('invalid receipt arguments');
    if (headers.some(h => h[0] === 'receipt')) throw new Error('receipt() controls the receipt header');
    if (this.error || this.state() !== 'active') throw this.error || new Error('connection is not active');
    // Registering a failed waiter must never send an unobservable command.
    if (this.waiters.length >= this.maxWaiters) throw new Error('waiter limit');
    if (this.queue.some(e => e.event === 'receipt' && e.id === id)) throw new Error('unconsumed receipt id');
    const wait = this._waitFor(e => e.event === 'receipt' && e.id === id, 5000, true);
    wait.catch(() => {});
    try {
      this.send(command, [...headers,['receipt',id]], body);
      return await wait;
    } catch (error) {
      // A control timeout leaves the broker outcome unknown. Retire this
      // session, including its pending receipt IDs; never retry implicitly.
      this.stop(error);
      throw error;
    }
  }
  async disconnect() {
    try { await this.receipt('DISCONNECT'); }
    finally { this.stop(); }
  }
}
TcpClient.sequence = 0;
module.exports = {TcpClient, protocol};
