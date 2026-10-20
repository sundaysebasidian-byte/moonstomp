'use strict';
// Shared helpers for the runnable demos. Each demo starts the built-in loopback
// demo broker (tools/demo-broker.cjs), runs one scenario over the real TCP
// adapter, prints deterministic lines, and exits 0 only if every assertion held.
// The demo broker is NOT interoperability evidence; see README "Evidence".
const assert = require('node:assert/strict');
const {startDemoBroker} = require('../../tools/demo-broker.cjs');
const TcpClient = require('../../tools/load-adapter.cjs').loadTcpClient();

const header = (frame, name) => frame.headers.find(h => h[0] === name)?.[1];
const text = frame => Buffer.from(frame.body).toString('utf8');
const next = (client, ms = 2000) => client.waitFor(e => e.event === 'message', ms);
const say = line => console.log(line);

async function demo(name, scenario, brokerOptions = {}) {
  const clients = [], brokers = [];
  const ctx = {
    async broker(options = brokerOptions) { const b = await startDemoBroker(options); brokers.push(b); return b; },
    async connect(broker, options = {}) {
      const c = new TcpClient({port: broker.port, host: broker.host}); await c.connect(options); clients.push(c); return c;
    },
  };
  try { await scenario(ctx); say('PASS ' + name); }
  catch (error) { console.error('FAIL ' + name + ': ' + error.message); process.exitCode = 1; }
  finally { for (const c of clients) c.stop(); for (const b of brokers) await b.close(); }
}
module.exports = {assert, header, text, next, say, demo};
