'use strict';
// Run fault probes serially so each failure has an explicit process status.
const {spawnSync} = require('node:child_process');
const path = require('node:path');
const files = ["review30-bridge-handles-test.cjs", "review30-queue-mutation-test.cjs", "review30-reentrant-wait-test.cjs", "review30-credential-echo-test.cjs", "review30-nack-mode-test.cjs", "review30-help-data-test.cjs", "review30-module-loading-test.cjs", "review30-diagnostic-volume-test.cjs"];
for (const file of files) {
  const result = spawnSync(process.execPath, [path.join(__dirname, file)], {encoding: 'utf8', timeout: 15000});
  process.stdout.write(file + ': ' + (result.status === 0 ? 'PASS' : 'FAIL') + '\n');
  if (result.status !== 0) {
    process.stdout.write(result.stdout || ''); process.stderr.write(result.stderr || '');
    if (result.error) process.stderr.write(result.error.message + '\n');
    process.exitCode = 1; break;
  }
}
