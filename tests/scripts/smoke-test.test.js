/**
 * bd-v0toag.71 — scripts/smoke-test.js: require-loads the bot entry, workers and dashboard
 * routes, exits non-zero on any load error. The child-process tests use fixtures through
 * SMOKE_MODULES, so this suite needs neither bot/ nor dashboard/ deps installed.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'scripts', 'smoke-test.js');
const FIX = 'tests/scripts/fixtures/smoke';

function runCli(modules) {
  return spawnSync(process.execPath, [SCRIPT], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, SMOKE_MODULES: modules.join(',') },
    timeout: 60000,
  });
}

describe('scripts/smoke-test.js', () => {
  it('lists the bot entry, the SQS worker and the portal routes, and every entry exists', () => {
    const { MODULES } = require(SCRIPT);
    expect(MODULES).toEqual(expect.arrayContaining([
      'bot/whatsapp-bot.js',
      'bot/workers/sqs-worker.js',
      'dashboard/routes/portal.routes.js',
    ]));
    // dashboard/index.js calls app.listen() on load — requiring it would start a server.
    expect(MODULES).not.toContain('dashboard/index.js');
    for (const m of MODULES) expect(fs.existsSync(path.join(ROOT, m))).toBe(true);
  });

  it('forces placeholder credentials and blanks the connection URLs', () => {
    const { PLACEHOLDER_ENV } = require(SCRIPT);
    expect(PLACEHOLDER_ENV.SUPABASE_URL).toMatch(/^http:\/\/127\.0\.0\.1/);
    expect(PLACEHOLDER_ENV.REDIS_URL).toBe('');
    expect(PLACEHOLDER_ENV.DATABASE_URL).toBe('');
  });

  it('runSmoke counts a loading module as passed and a throwing one as failed', () => {
    const { runSmoke } = require(SCRIPT);
    const r = runSmoke([`${FIX}/loads.js`, `${FIX}/throws.js`], { preflight: false });
    expect(r.passed).toBe(1);
    expect(r.failed).toBe(1);
    expect(r.failures[0]).toEqual({ name: `${FIX}/throws.js`, error: 'logEvent is not defined' });
  });

  it('exits 0 when every module loads', () => {
    const r = runCli([`${FIX}/loads.js`]);
    expect(r.stdout).toContain('Smoke test: 1 passed, 0 failed');
    expect(r.status).toBe(0);
  });

  it('exits 1 when a module throws on load', () => {
    const r = runCli([`${FIX}/loads.js`, `${FIX}/throws.js`]);
    expect(r.stdout).toContain('BLOCKING');
    expect(r.stdout).toContain('logEvent is not defined');
    expect(r.status).toBe(1);
  });

  it('exits 1 when a local require does not resolve', () => {
    const r = runCli([`${FIX}/missing-require.js`]);
    expect(r.stdout).toContain("Cannot resolve local require('./does-not-exist')");
    expect(r.status).toBe(1);
  });

  it('ignores requires inside block and whole-line comments', () => {
    const r = runCli([`${FIX}/commented-require.js`]);
    expect(r.stdout).toContain('Smoke test: 1 passed, 0 failed');
    expect(r.status).toBe(0);
  });
});
