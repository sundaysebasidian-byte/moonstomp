'use strict';
// Error presentation only: no SDK, sockets or broker. This is a simulation.
const {transportError, receiptFailure} = require('../transport/errors.cjs');
const {friendlyError} = require('../tools/friendly-error.cjs');
const timeout = transportError('STOMP_EVENT_TIMEOUT', 'event timeout');
const failure = receiptFailure(timeout, 'COMMIT', 'example-commit-1');
console.log('SIMULATION: COMMIT was sent but its receipt was not observed.');
console.log(friendlyError(failure, '127.0.0.1', 61613));
console.log('Application action: reconcile the business operation before a retry.');
