'use strict';
/**
 * Child test L14 (bd-s1oo0.18) — the mock stack's bot can SEND the check: sendCheck needs
 * CHILD_TEST_CHECK_FLOW_ID (L6), and without it every child ends "ready but did not open". The stack
 * gives the bot a mock id (the mock Graph API records the card; the driver plays the Flow against the
 * local endpoint). `sim-stack.sh env-names [--live-vendors]` prints the NAMES (never values) of the
 * env the bot is started with — built by the same function `up` uses.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPT = path.resolve(__dirname, '../../../bot/scripts/e2e/child-test-sim/sim-stack.sh');
function run(args, env) {
  return spawnSync('bash', [SCRIPT, ...args], { env: { PATH: process.env.PATH, HOME: os.tmpdir(), ...env }, encoding: 'utf8', timeout: 20000 });
}
function sandboxEnv() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'l14-stack-'));
  const f = path.join(d, 'sandbox.env');
  fs.writeFileSync(f, ['SUPABASE_URL=https://olvritwoqujtjvwfulbh.supabase.co', 'OPENROUTER_API_KEY=sk-secret-value', 'SONIOX_API_KEY=so-secret'].join('\n') + '\n', { mode: 0o600 });
  return f;
}

test('the bot gets CHILD_TEST_CHECK_FLOW_ID next to the child-test flags; values are never printed', () => {
  const r = run(['env-names', '--live-vendors'], { SIM_SANDBOX_ENV: sandboxEnv() });
  expect(r.status).toBe(0);
  const names = r.stdout.trim().split('\n');
  expect(names).toEqual(expect.arrayContaining(['CHILD_TEST_ENABLED', 'CHILD_TEST_CHECK_FLOW_ID', 'CHILD_TEST_DRAW_SECRET', 'OPENROUTER_API_KEY', 'E2E_CASSETTE']));
  expect(r.stdout).not.toMatch(/secret|sk-|=/);
});

test('env-names refuses a source that is not the sandbox, like up does', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'l14-stack-'));
  const f = path.join(d, 'sandbox.env');
  fs.writeFileSync(f, 'SUPABASE_URL=https://ihzciabopbttygxxgrkm.supabase.co\n', { mode: 0o600 });
  expect(run(['env-names'], { SIM_SANDBOX_ENV: f }).status).toBe(3);
});
