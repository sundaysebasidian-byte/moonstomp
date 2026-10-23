'use strict';
// Turns adapter errors into messages that say what happened and what to do next.
// The adapter's structured fields (name, code, operation, reason, broker frame) are
// printed as-is, so the output stays greppable; only the connection-refused case is
// rewritten, because Node's raw "connect ECONNREFUSED host:port" has no next step.
const BODY_LIMIT = 200;
// JSON.stringify keeps broker-controlled text from carrying terminal control characters.
const quote = value => JSON.stringify(value);

function describeFrame(frame) {
  const lines = [`  broker frame: ${frame.command}`];
  for (const [name, value] of frame.headers || []) lines.push(`    ${name}: ${quote(value)}`);
  const body = Buffer.from(frame.body || []);
  if (body.length) {
    const shown = body.subarray(0, BODY_LIMIT).toString('utf8');
    lines.push(`    body (${body.length} bytes${body.length > BODY_LIMIT ? `, first ${BODY_LIMIT}` : ''}): ${quote(shown)}`);
  }
  return lines;
}

// context: {connecting: error happened before CONNECTED, credentials: a login was sent}
function friendlyError(error, host, port, context = {}) {
  const text = String(error && error.message || error);
  if (error && error.code === 'ECONNREFUSED' || /ECONNREFUSED/.test(text)) {
    return [
      `no STOMP broker is listening on ${host}:${port} (ECONNREFUSED).`,
      '  start the in-memory test broker:  node tools/demo-broker.cjs --port ' + port,
      '  or try it with no broker at all:  node tools/stomp-cli.cjs demo',
      '  real broker: see README section "真实 broker 复现"',
    ].join('\n');
  }
  const lines = [text];
  const fields = ['name', 'code', 'operation'].filter(key => error && typeof error[key] === 'string' && error[key]);
  if (fields.length) lines.push('  ' + fields.map(key => `${key}=${error[key]}`).join(' '));
  if (error && typeof error.reason === 'string' && error.reason !== text) lines.push(`  reason=${quote(error.reason)}`);
  if (error && typeof error.receiptId === 'string') lines.push(`  receiptId=${quote(error.receiptId)}`);
  if (error && error.outcomeUnknown === true) lines.push(
    '  broker outcome is unknown; the session is closed. Reconcile before retrying; no automatic resend.');
  if (error && error.frame) {
    lines.push(...describeFrame(error.frame));
    if (context.connecting) {
      lines.push(context.credentials
        ? '  the broker refused the connection: check --login and the passcode in the variable given to --passcode-env'
        : '  the broker refused the connection; if it requires a login, pass --login USER and --passcode-env VARNAME');
    }
  }
  if (error && /^(CERT_|DEPTH_ZERO_|SELF_SIGNED|UNABLE_TO_|ERR_TLS_|ERR_SSL_|HOSTNAME_MISMATCH)/.test(error.code || '')) {
    lines.push('  TLS certificate check failed; trust the broker CA with --tls-ca FILE and check --tls-servername');
  }
  return lines.join('\n');
}
module.exports = {friendlyError};
