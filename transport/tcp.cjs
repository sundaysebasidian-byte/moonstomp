'use strict';
// Node TCP is glue only; framing, validation and session state run in MoonBit.
const net = require('node:net');
const {performance} = require('node:perf_hooks');
require('../_build/js/debug/build/bridge/bridge.js');
const protocol = globalThis.MoonSTOMP;
class TcpClient {
  constructor({host = '127.0.0.1', port = 61613, tickMs = 25, maxQueue = 1024, maxWaiters = 256, maxQueueBytes = 4*1024*1024} = {}) {
    if (!Number.isInteger(port) || port < 1 || port > 65535 || !Number.isInteger(tickMs) || tickMs < 1 || !Number.isInteger(maxQueue) || maxQueue < 1 || !Number.isInteger(maxWaiters) || maxWaiters < 1 || !Number.isInteger(maxQueueBytes) || maxQueueBytes < 1) throw new Error('invalid TCP configuration');
    this.options = {host, port};
    this.core = protocol.create(); this.queue = []; this.waiters = []; this.maxQueue = maxQueue; this.maxWaiters = maxWaiters; this.maxQueueBytes = maxQueueBytes; this.queueBytes = 0;
    this.origin = performance.now(); this.socket = null; this.timer = null; this.error = null; this.tickMs = tickMs;
  }
  now() { return BigInt(Math.floor(performance.now() - this.origin)); }
  state() { return protocol.state(this.core); }
  stop(error = null) {
    if (error && !this.error) this.error = error;
    clearInterval(this.timer); this.timer = null;
    protocol.close(this.core);
    for (const w of this.waiters.splice(0)) { clearTimeout(w.timer); w.reject(this.error || new Error('connection closed')); }
    this.queue.length = 0; this.queueBytes = 0;
    if (this.socket && !this.socket.destroyed) this.socket.destroy();
  }
  deliver(event) {
    const i = this.waiters.findIndex(w => w.predicate(event));
    if (i >= 0) { const w = this.waiters.splice(i,1)[0]; clearTimeout(w.timer); w.resolve(event); }
    else {
      const size = Buffer.byteLength(JSON.stringify(event));
      if (this.queue.length >= this.maxQueue || this.queueBytes + size > this.maxQueueBytes) throw new Error('event queue limit');
      this.queue.push(event); this.queueBytes += size;
    }
  }
  waitFor(predicate, timeout = 5000) {
    if (!Number.isFinite(timeout) || timeout < 1) return Promise.reject(new Error('invalid timeout'));
    const i = this.queue.findIndex(predicate);
    if (i >= 0) {
      const event = this.queue.splice(i, 1)[0];
      this.queueBytes -= Buffer.byteLength(JSON.stringify(event));
      return Promise.resolve(event);
    }
    if (this.error || this.state() === 'closed') return Promise.reject(this.error || new Error('connection closed'));
    if (this.waiters.length >= this.maxWaiters) return Promise.reject(new Error('waiter limit'));
    return new Promise((resolve,reject) => {
      const w = {predicate, resolve, reject};
      w.timer = setTimeout(() => { this.waiters = this.waiters.filter(x => x !== w); reject(new Error('event timeout')); }, timeout);
      this.waiters.push(w);
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
  async connect({virtualHost = 'localhost', heartbeat = '1000,1000'} = {}) {
    if (this.socket) throw new Error('connect once per client');
    this.socket = net.createConnection(this.options);
    this.socket.on('data', chunk => {
      try {
        for (const text of protocol.receive(this.core, chunk, this.now())) {
          const event = JSON.parse(text);
          this.deliver(event);
          if (event.event === 'error') throw new Error('broker ERROR frame');
        }
        if (this.state() === 'closed') this.stop();
      } catch(e) { this.stop(e); }
    });
    this.socket.on('error', e => this.stop(e));
    this.socket.on('end', () => this.stop(new Error(protocol.eof(this.core) ? 'peer EOF' : 'truncated STOMP stream')));
    this.socket.on('close', () => this.stop());
    const connected = this.waitFor(e => e.event === 'connected', 5000);
    // Consume rejection even when the socket fails before CONNECT is sent.
    connected.catch(() => {});
    this.socket.once('connect', () => {
      try { this.send('CONNECT', [['accept-version','1.2'],['host',virtualHost],['heart-beat',heartbeat]]); }
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
    const wait = this.waitFor(e => e.event === 'receipt' && e.id === id);
    wait.catch(() => {});
    this.send(command, [...headers,['receipt',id]], body);
    return wait;
  }
  async disconnect() {
    try { await this.receipt('DISCONNECT'); }
    finally { this.stop(); }
  }
}
TcpClient.sequence = 0;
module.exports = {TcpClient, protocol};
