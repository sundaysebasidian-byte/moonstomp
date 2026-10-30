'use strict';

function handleError(reason) {
  const error = new Error(reason); error.code = 'STOMP_HANDLE'; return error;
}
function extraHeaders(headers, reserved) {
  if (!Array.isArray(headers) || headers.some(p => !Array.isArray(p) || p.length !== 2 || p.some(v => typeof v !== 'string') || reserved.includes(p[0]))) throw handleError('invalid or reserved handle header');
  return headers;
}

class Subscription {
  #client; #state = 'active'; #messages = new WeakSet(); #cancel = new AbortController();
  constructor(client, id, destination, ack) {
    this.#client = client;
    Object.defineProperties(this, {id: {value: id, enumerable: true}, destination: {value: destination, enumerable: true}, ackMode: {value: ack, enumerable: true}});
  }
  get state() { return this.#client.state() === 'closed' ? 'closed' : this.#state; }
  #active() {
    if (this.#state !== 'active' || this.#client.state() !== 'active') throw handleError('subscription is not active');
  }
  async next(timeout = 5000) {
    this.#active();
    const event = await this.#client._waitFor(e => e.event === 'message' &&
      (this.#client.version() === '1.0' ? e.frame.headers.find(h => h[0] === 'destination')?.[1] === this.destination : e.frame.headers.find(h => h[0] === 'subscription')?.[1] === this.id), timeout, false, this.#cancel.signal);
    this.#messages.add(event.frame); return event.frame;
  }
  #acknowledge(message, negative, transaction) {
    this.#active();
    if (!this.#messages.has(message)) throw handleError('message was not delivered by this subscription');
    if (this.ackMode === 'auto') throw handleError('auto subscription does not accept acknowledgements');
    if (negative && this.#client.version() === '1.0') throw handleError('NACK unavailable in STOMP 1.0');
    const id = transaction === undefined ? '' : Transaction.idFor(transaction, this.#client);
    this.#client.acknowledge(message, {negative, transaction: id});
  }
  ack(message, {transaction} = {}) { this.#acknowledge(message, false, transaction); }
  nack(message, {transaction} = {}) { this.#acknowledge(message, true, transaction); }
  async unsubscribe() {
    this.#active(); this.#client._requireSyncTurn(); this.#state = 'closing';
    // Cancel only this handle's pending reads; other subscriptions stay live.
    this.#cancel.abort();
    try {
      const receipt = await this.#client.receipt('UNSUBSCRIBE', [['id', this.id]]);
      this.#state = 'closed';
      return receipt;
    } catch (error) {
      // Only a proven pre-write refusal on a healthy connection is retryable.
      // Prior next() calls remain cancelled; new reads receive a fresh signal.
      if (error?.outcomeUnknown === false && this.#client.state() === 'active') {
        this.#cancel = new AbortController();
        this.#state = 'active';
      } else {
        this.#state = 'closed';
      }
      throw error;
    }
  }
}

class Transaction {
  #client; #state = 'open';
  #outcome = Object.freeze({status: 'not-requested', operation: null, receiptId: null, errorCode: null});
  constructor(client, id) {
    this.#client = client; Object.defineProperty(this, 'id', {value: id, enumerable: true});
  }
  get state() { return this.#state === 'open' && this.#client.state() === 'closed' ? 'failed' : this.#state; }
  // Local finish receipt evidence only; never a broker/business-state query.
  get outcome() { return this.#outcome; }
  static idFor(transaction, client) {
    if (!(transaction instanceof Transaction) || transaction.#client !== client) throw handleError('transaction belongs to another client');
    if (transaction.#state !== 'open' || client.state() !== 'active') throw handleError('transaction is not open');
    return transaction.id;
  }
  send(destination, body, headers = []) {
    Transaction.idFor(this, this.#client);
    if (typeof destination !== 'string' || !destination.length || !(body instanceof Uint8Array)) throw handleError('invalid transaction destination/body');
    extraHeaders(headers, ['destination', 'transaction', 'receipt']);
    this.#client.send('SEND', [['destination', destination], ['transaction', this.id], ...headers], body);
  }
  async #finish(command, state) {
    Transaction.idFor(this, this.#client); this.#client._requireSyncTurn(); this.#state = 'finishing';
    this.#outcome = Object.freeze({status: 'pending', operation: command, receiptId: null, errorCode: null});
    try {
      const receipt = await this.#client.receipt(command, [['transaction', this.id]]);
      this.#state = state;
      this.#outcome = Object.freeze({status: 'confirmed', operation: command, receiptId: receipt.id, errorCode: null});
      return receipt;
    } catch (error) {
      this.#state = 'failed';
      this.#outcome = Object.freeze({
        status: error?.outcomeUnknown === false ? 'not-sent' : 'unknown',
        operation: command,
        receiptId: typeof error?.receiptId === 'string' ? error.receiptId : null,
        errorCode: typeof error?.code === 'string' ? error.code : null,
      });
      throw error;
    }
  }
  commit() { return this.#finish('COMMIT', 'committed'); }
  abort() { return this.#finish('ABORT', 'aborted'); }
}

module.exports = {Subscription, Transaction, extraHeaders, handleError};
