#!/usr/bin/env node
/**
 * Test runner that handles Node.js version compatibility.
 * Node 22+ requires --localstorage-file for Jest to work properly.
 * This script sets that flag automatically when needed.
 */
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const major = parseInt(process.versions.node.split('.')[0], 10);

const nodeOpts = major >= 25
  ? '--no-experimental-webstorage'
  : major >= 22
    ? '--localstorage-file=/tmp/jest-ls'
    : '';

// Resolve jest binary from node_modules
const jestBin = path.resolve(__dirname, '..', 'node_modules', '.bin', 'jest');
const jestCmd = fs.existsSync(jestBin) ? jestBin : 'jest';
// Arguments go to jest as an array, never through a shell: a path with a space stays one argument.
const args = ['--config', 'tests/jest.config.js', ...process.argv.slice(2)];

const result = spawnSync(jestCmd, args, {
  stdio: 'inherit',
  env: {
    ...process.env,
    ...(nodeOpts ? { NODE_OPTIONS: [process.env.NODE_OPTIONS, nodeOpts].filter(Boolean).join(' ') } : {})
  }
});
if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status === null ? 1 : result.status);
