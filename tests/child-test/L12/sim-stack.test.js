'use strict';
/**
 * sim-stack.sh refuses anything that is not the NIETE sandbox before it seeds, provisions or starts anything.
 * These run the real script; no network is reached on the refusal paths.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPT = path.resolve(__dirname, '../../../bot/scripts/e2e/child-test-sim/sim-stack.sh');
const tmpdir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'l12-stack-'));
function run(args, env) {
  return spawnSync('bash', [SCRIPT, ...args], { env: { PATH: process.env.PATH, HOME: os.tmpdir(), ...env }, encoding: 'utf8', timeout: 20000 });
}
function envFile(dir, lines) { const f = path.join(dir, 'sandbox.env'); fs.writeFileSync(f, lines.join('\n') + '\n', { mode: 0o600 }); return f; }

test('a source env pointing at NIETE production is refused (exit 3), nothing written', () => {
  const d = tmpdir();
  const src = envFile(d, ['SUPABASE_URL=https://ihzciabopbttygxxgrkm.supabase.co', 'SUPABASE_SERVICE_ROLE_KEY=x']);
  const keys = path.join(d, 'keys');
  const r = run(['up', 'HEAD', path.join(d, 'run')], { SIM_SANDBOX_ENV: src, SIM_KEYS_DIR: keys });
  expect(r.status).toBe(3);
  expect(r.stderr).toMatch(/REFUSED.*not the NIETE sandbox/);
  expect(fs.existsSync(keys)).toBe(false);
  expect(fs.existsSync(path.join(d, 'run'))).toBe(false);
});

test('a sandbox SUPABASE_URL with a production DATABASE_URL is refused', () => {
  const d = tmpdir();
  const src = envFile(d, ['SUPABASE_URL=https://olvritwoqujtjvwfulbh.supabase.co', 'DATABASE_URL=postgres://u:p@db.jlpenspfdcwxkopaidys.supabase.co/postgres']);
  const r = run(['up', 'HEAD', path.join(d, 'run')], { SIM_SANDBOX_ENV: src, SIM_KEYS_DIR: path.join(d, 'keys') });
  expect(r.status).toBe(3);
  expect(r.stderr).toMatch(/DATABASE_URL names production/);
});

test('a keys file whose R2 bucket is not rumi-sandbox is refused (exit 4) before any seed', () => {
  const d = tmpdir();
  const src = envFile(d, ['SUPABASE_URL=https://olvritwoqujtjvwfulbh.supabase.co', 'SUPABASE_SERVICE_ROLE_KEY=x']);
  const keys = path.join(d, 'keys'); fs.mkdirSync(keys);
  fs.writeFileSync(path.join(keys, 'niete-local.env'), 'SUPABASE_URL=https://olvritwoqujtjvwfulbh.supabase.co\nR2_BUCKET_NAME=rumi-staging\n', { mode: 0o600 });
  const r = run(['up', 'HEAD', path.join(d, 'run')], { SIM_SANDBOX_ENV: src, SIM_KEYS_DIR: keys });
  expect(r.status).toBe(4);
  expect(r.stderr).toMatch(/R2_BUCKET_NAME is not rumi-sandbox/);
  expect(r.stderr).not.toMatch(/SIM visit/);
});

test('usage errors exit 2', () => {
  expect(run(['up'], {}).status).toBe(2);
  expect(run(['nope'], {}).status).toBe(2);
});
