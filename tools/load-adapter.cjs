'use strict';
// Loads transport/tcp.cjs, but turns the most common first-run mistake (the
// MoonBit bridge was never built) into a one-line instruction instead of a stack trace.
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_BRIDGE = path.join(__dirname, '..', '_build', 'js', 'debug', 'build', 'bridge', 'bridge.js');

function loadTcpClient(bridgePath = DEFAULT_BRIDGE) {
  if (!fs.existsSync(bridgePath)) {
    process.stderr.write(`error: MoonBit bridge not built (missing ${bridgePath}).\nrun once from the repository root: moon build --target js\n`);
    process.exit(1);
  }
  return require('../transport/tcp.cjs').TcpClient;
}

module.exports = {loadTcpClient};
