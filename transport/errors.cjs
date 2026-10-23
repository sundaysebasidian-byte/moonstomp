'use strict';

// Keep machine-readable failure context separate from broker/body text.
function transportError(code, message, fields = {}, cause) {
  const error = new Error(message, cause === undefined ? undefined : {cause});
  error.name = 'MoonSTOMPTransportError';
  error.code = code;
  Object.assign(error, fields);
  return error;
}

function receiptFailure(cause, command, receiptId, outcomeUnknown = true) {
  const error = transportError(cause.code === 'STOMP_EVENT_TIMEOUT' ? 'STOMP_RECEIPT_TIMEOUT' :
    cause.code || 'STOMP_RECEIPT_FAILED', cause.message, {
      operation: command, receiptId, outcomeUnknown,
    }, cause);
  if (cause.name && cause.name !== 'Error') error.name = cause.name;
  if (cause.frame) error.frame = cause.frame;
  if (typeof cause.reason === 'string') error.reason = cause.reason;
  return error;
}

module.exports = {transportError, receiptFailure};
