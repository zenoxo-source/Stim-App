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

const result = spawnSync(process.execPath, ['--test', ...files], {
  stdio: 'inherit',
  cwd: path.join(__dirname, '..'),
});

process.exit(result.status === null ? 1 : result.status);
