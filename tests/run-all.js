'use strict';
/*
 * Unified test runner (no framework to install).
 *   node tests/run-all.js            unit tests (jsdom + node:test)
 *   node tests/run-all.js --browser  headless Chromium sanity checks only
 *   node tests/run-all.js --all      both
 */
const { spawnSync } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const wantBrowser = args.includes('--browser');
const wantAll = args.includes('--all');

function run(label, nodeArgs) {
  console.log('\n== ' + label + ' ==');
  const res = spawnSync(process.execPath, nodeArgs, { cwd: ROOT, stdio: 'inherit' });
  return res.status === null ? 1 : res.status;
}

let code = 0;
if (!wantBrowser || wantAll) code = run('unit tests', ['--test', 'tests/unit.test.js']);
if ((wantBrowser || wantAll) && code === 0) code = run('browser tests', ['tests/browser.test.js']);
process.exit(code);
