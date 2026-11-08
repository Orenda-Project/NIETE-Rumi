/**
 * Boot-level proof that the Supabase client actually runs the local-.env target guard.
 * Spawns a real Node process in a temp dir holding a fake .env (no real credentials).
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CLIENT = path.resolve(__dirname, '../../bot/shared/config/supabase.js');

function boot(envFileLines, extraEnv = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'env-target-'));
  fs.writeFileSync(
    path.join(dir, '.env'),
    ['SUPABASE_URL=https://fake-ref.supabase.co', 'SUPABASE_SERVICE_ROLE_KEY=fake-key', ...envFileLines].join('\n'),
  );
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, ...extraEnv };
  const r = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(CLIENT)}); console.log('BOOTED')`], {
    cwd: dir,
    env,
    encoding: 'utf8',
  });
  fs.rmSync(dir, { recursive: true, force: true });
  return r;
}

describe('bot Supabase client boot runs the .env target guard', () => {
  it('refuses an unlabelled .env with exit 78', () => {
    const r = boot([]);
    expect(r.status).toBe(78);
    expect(r.stderr).toMatch(/RUMI_ENV_TARGET/);
    expect(r.stderr).not.toMatch(/fake-key|fake-ref/);
  });

  it('refuses a production .env without RUMI_ALLOW_PROD=1', () => {
    expect(boot(['RUMI_ENV_TARGET=production']).status).toBe(78);
  });

  it('boots a production .env with RUMI_ALLOW_PROD=1 on the command line', () => {
    const r = boot(['RUMI_ENV_TARGET=production'], { RUMI_ALLOW_PROD: '1' });
    expect(r.stdout).toMatch(/BOOTED/);
  });

  it('boots a sandbox .env', () => {
    expect(boot(['RUMI_ENV_TARGET=sandbox']).stdout).toMatch(/BOOTED/);
  });

  it('boots when credentials come from the process env, not a file (Railway)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'env-target-'));
    const r = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(CLIENT)}); console.log('BOOTED')`], {
      cwd: dir,
      env: {
        PATH: process.env.PATH,
        SUPABASE_URL: 'https://fake-ref.supabase.co',
        SUPABASE_SERVICE_ROLE_KEY: 'fake-key',
      },
      encoding: 'utf8',
    });
    fs.rmSync(dir, { recursive: true, force: true });
    expect(r.stdout).toMatch(/BOOTED/);
  });
});
