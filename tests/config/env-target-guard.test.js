/**
 * A local .env must say which database it points at, and a production one must be opted into.
 *
 * The footgun: a checkout's `.env` held PRODUCTION Supabase credentials while the docs called
 * it the sandbox .env, so a "sandbox" script run from that checkout would write to prod.
 * The guard only judges credentials that came FROM A FILE: on Railway (or anywhere the
 * credentials arrive through the process environment) it stays out of the way.
 *
 * TDD: written red-first, before bot/shared/config/env-target-guard.js existed.
 */

const { evaluateEnvTarget, assertEnvTarget } = require('../../bot/shared/config/env-target-guard');

const URL = 'https://example-ref.supabase.co';

const fromFile = (extra = {}) => ({ SUPABASE_URL: URL, ...extra });
const procEnv = (extra = {}) => ({ SUPABASE_URL: URL, ...extra });

describe('evaluateEnvTarget', () => {
  it('refuses a .env that does not declare RUMI_ENV_TARGET', () => {
    const r = evaluateEnvTarget({ fileVars: fromFile(), env: procEnv() });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/RUMI_ENV_TARGET/);
  });

  it('refuses a .env labelled production without RUMI_ALLOW_PROD=1', () => {
    const r = evaluateEnvTarget({
      fileVars: fromFile({ RUMI_ENV_TARGET: 'production' }),
      env: procEnv({ RUMI_ENV_TARGET: 'production' }),
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/RUMI_ALLOW_PROD=1/);
  });

  it('treats "prod" and mixed case as production too', () => {
    for (const label of ['prod', 'PRODUCTION', ' Prod ']) {
      const r = evaluateEnvTarget({ fileVars: fromFile({ RUMI_ENV_TARGET: label }), env: procEnv() });
      expect(r.ok).toBe(false);
    }
  });

  it('allows a production .env when RUMI_ALLOW_PROD=1 is set for this run', () => {
    const r = evaluateEnvTarget({
      fileVars: fromFile({ RUMI_ENV_TARGET: 'production' }),
      env: procEnv({ RUMI_ALLOW_PROD: '1' }),
    });
    expect(r).toEqual({ ok: true, target: 'production' });
  });

  it('does not accept RUMI_ALLOW_PROD from the .env file itself', () => {
    const r = evaluateEnvTarget({
      fileVars: fromFile({ RUMI_ENV_TARGET: 'production', RUMI_ALLOW_PROD: '1' }),
      env: procEnv({ RUMI_ALLOW_PROD: '1' }), // dotenv copies file vars into process.env
    });
    expect(r.ok).toBe(false);
  });

  it('allows a .env labelled sandbox or staging', () => {
    for (const label of ['sandbox', 'staging']) {
      const r = evaluateEnvTarget({ fileVars: fromFile({ RUMI_ENV_TARGET: label }), env: procEnv() });
      expect(r).toEqual({ ok: true, target: label });
    }
  });

  it('reads the label from the file, not the shell (a prod file cannot be relabelled on the command line)', () => {
    const r = evaluateEnvTarget({
      fileVars: fromFile({ RUMI_ENV_TARGET: 'production' }),
      env: procEnv({ RUMI_ENV_TARGET: 'sandbox' }),
    });
    expect(r.ok).toBe(false);
  });

  it('stays out of the way when no .env file supplied the URL (Railway, CI secrets)', () => {
    expect(evaluateEnvTarget({ fileVars: undefined, env: procEnv() }).ok).toBe(true);
    expect(evaluateEnvTarget({ fileVars: {}, env: procEnv() }).ok).toBe(true);
  });

  it('stays out of the way when the process env overrides the file URL', () => {
    const r = evaluateEnvTarget({
      fileVars: fromFile(),
      env: procEnv({ SUPABASE_URL: 'https://other-ref.supabase.co' }),
    });
    expect(r.ok).toBe(true);
  });
});

describe('assertEnvTarget', () => {
  it('exits 78 with a message naming the fix when refused, without printing secrets or the URL', () => {
    const exit = jest.fn();
    const write = jest.fn();
    assertEnvTarget({
      fileVars: fromFile({ SUPABASE_SERVICE_ROLE_KEY: 'sekret-value' }),
      env: procEnv({ SUPABASE_SERVICE_ROLE_KEY: 'sekret-value' }),
      exit,
      write,
    });
    expect(exit).toHaveBeenCalledWith(78);
    const out = write.mock.calls.map((c) => c[0]).join('');
    expect(out).toMatch(/RUMI_ENV_TARGET/);
    expect(out).not.toMatch(/sekret-value/);
    expect(out).not.toMatch(/example-ref/);
  });

  it('does nothing when allowed', () => {
    const exit = jest.fn();
    assertEnvTarget({ fileVars: fromFile({ RUMI_ENV_TARGET: 'sandbox' }), env: procEnv(), exit, write: jest.fn() });
    expect(exit).not.toHaveBeenCalled();
  });
});
