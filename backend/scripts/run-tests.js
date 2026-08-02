/**
 * Cross-platform test runner (avoids shell glob issues on Windows CI).
 * Usage: node scripts/run-tests.js
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const testsDir = path.join(__dirname, '..', 'tests');
const files = fs
  .readdirSync(testsDir)
  .filter((f) => f.endsWith('.test.js'))
  .map((f) => path.join(testsDir, f));

if (files.length === 0) {
  console.error('No test files found in', testsDir);
  process.exit(1);
}

// Cap parallelism: many parallel processes on loaded machines drop loopback
// segments, which shows up as flaky 3s-RTO delays in WebSocket tests.
const result = spawnSync(
  process.execPath,
  ['--test', '--test-concurrency=4', ...files],
  {
    stdio: 'inherit',
    cwd: path.join(__dirname, '..'),
  }
);

process.exit(result.status === null ? 1 : result.status);
