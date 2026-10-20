'use strict';
// Turns the raw "connect ECONNREFUSED host:port" into a message that says what to do next.
function friendlyError(error, host, port) {
  const text = String(error && error.message || error);
  if (error && error.code === 'ECONNREFUSED' || /ECONNREFUSED/.test(text)) {
    return [
      `no STOMP broker is listening on ${host}:${port} (ECONNREFUSED).`,
      '  start the in-memory test broker:  node tools/demo-broker.cjs --port ' + port,
      '  or try it with no broker at all:  node tools/stomp-cli.cjs demo',
      '  real broker: see README section "真实 broker 复现"',
    ].join('\n');
  }
  return text;
}
module.exports = {friendlyError};
