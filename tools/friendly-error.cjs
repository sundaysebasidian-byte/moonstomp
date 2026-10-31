'use strict';
// Turns adapter errors into messages that say what happened and what to do next.
// The adapter's structured fields stay greppable, with terminal controls escaped;
// only the connection-refused case is
// rewritten, because Node's raw "connect ECONNREFUSED host:port" has no next step.
const BODY_LIMIT = 200;
const escapeControl = c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0');
const safeLine = value => String(value).replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, escapeControl);
// JSON quotes C0 controls; also escape C1 and Unicode line separators.
const quote = value => JSON.stringify(value).replace(/[\u007f-\u009f\u2028\u2029]/g, escapeControl);

function describeFrame(frame) {
  const lines = [`  broker frame: ${safeLine(frame.command)}`];
  for (const [name, value] of frame.headers || []) lines.push(`    ${safeLine(name)}: ${quote(value)}`);
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
  if (error && error.code === 'ECONNREFUSED') {
    return [
      `no STOMP broker is listening on ${safeLine(host)}:${safeLine(port)} (ECONNREFUSED).`,
      '  start the in-memory test broker:  node tools/demo-broker.cjs --port ' + safeLine(port),
      '  or try it with no broker at all:  node tools/stomp-cli.cjs demo',
      '  real broker: see README section "真实 broker 复现"',
    ].join('\n');
  }
  const lines = [safeLine(text)];
  const fields = ['name', 'code', 'operation'].filter(key => error && typeof error[key] === 'string' && error[key]);
  if (fields.length) lines.push('  ' + fields.map(key => `${key}=${safeLine(error[key])}`).join(' '));
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
module.exports = {friendlyError, safeLine, safeJson: quote};
