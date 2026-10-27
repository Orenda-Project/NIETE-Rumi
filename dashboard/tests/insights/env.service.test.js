'use strict';
/** NIGHTLY_JOB §1 and §2: the environment assertion and the read-only client (tests 1 and 2). */
const env = require('../../lib/insights/env');
const C = require('../../lib/insights/constants');

const SANDBOX_URL = `https://${C.SANDBOX_REF}.supabase.co`;
const PROD_URL = `https://${C.PROD_REF}.supabase.co`;

describe('assertEnvironment', () => {
  test('a prod-shaped URL without --dry-run is refused with exit 3 and zero DB calls', () => {
    const calls = [];
    const client = { from: (t) => { calls.push(t); return {}; } };
    expect(() => env.assertEnvironment({ supabaseUrl: PROD_URL, coachipEnv: 'production', dryRun: false, client }))
      .toThrow(env.EnvRefusal);
    try { env.assertEnvironment({ supabaseUrl: PROD_URL, coachipEnv: 'production', dryRun: false, client }); } catch (e) {
      expect(e.exitCode).toBe(3);
      expect(e.failureClass).toBe('env_mismatch');
    }
    expect(calls).toHaveLength(0);
  });

  test('a sandbox URL told it is production is refused', () => {
    expect(() => env.assertEnvironment({ supabaseUrl: SANDBOX_URL, coachipEnv: 'production', dryRun: false }))
      .toThrow(/env_mismatch/);
  });

  test('a prod URL told it is sandbox is refused', () => {
    expect(() => env.assertEnvironment({ supabaseUrl: PROD_URL, coachipEnv: 'sandbox', dryRun: false }))
      .toThrow(env.EnvRefusal);
  });

  test('sandbox URL + COACHIP_ENV=sandbox passes and returns the ref', () => {
    const r = env.assertEnvironment({ supabaseUrl: SANDBOX_URL, coachipEnv: 'sandbox', dryRun: false, bucket: 'rumi-sandbox' });
    expect(r).toEqual({ ref: C.SANDBOX_REF, mode: 'write', env: 'sandbox' });
  });

  test('a database URL on another project is refused even when the REST URL matches', () => {
    expect(() => env.assertEnvironment({
      supabaseUrl: SANDBOX_URL, databaseUrl: `postgresql://postgres.${C.PROD_REF}:pw@aws-0.pooler.supabase.com:6543/postgres`,
      coachipEnv: 'sandbox', dryRun: false,
    })).toThrow(env.EnvRefusal);
  });

  test('the clip bucket must be the environment bucket', () => {
    expect(() => env.assertEnvironment({ supabaseUrl: SANDBOX_URL, coachipEnv: 'sandbox', dryRun: false, bucket: 'niete-prod-audio' }))
      .toThrow(/bucket/);
  });

  test('prod with --dry-run is allowed, read-only', () => {
    const r = env.assertEnvironment({ supabaseUrl: PROD_URL, coachipEnv: 'production', dryRun: true });
    expect(r.mode).toBe('read_only');
    expect(r.ref).toBe(C.PROD_REF);
  });

  test('PROD_WRITES_ALLOWED is false until the operator go', () => {
    expect(C.PROD_WRITES_ALLOWED).toBe(false);
  });

  test('parseRef reads the first host label', () => {
    expect(env.parseRef('https://abc123.supabase.co/rest/v1')).toBe('abc123');
    expect(env.parseRef('not a url')).toBe(null);
  });
});

describe('readOnlyClient', () => {
  const fake = () => {
    const builder = { select: jest.fn(() => builder), eq: jest.fn(() => builder), insert: jest.fn(), update: jest.fn(),
      upsert: jest.fn(), delete: jest.fn() };
    return { from: jest.fn(() => builder), rpc: jest.fn(), builder };
  };

  test.each(['insert', 'update', 'upsert', 'delete'])('%s throws', (op) => {
    const raw = fake();
    const ro = env.readOnlyClient(raw);
    expect(() => ro.from('coaching_sessions')[op]({})).toThrow(/read-only/);
    expect(raw.builder[op]).not.toHaveBeenCalled();
  });

  test('rpc throws', () => {
    const raw = fake();
    expect(() => env.readOnlyClient(raw).rpc('anything')).toThrow(/read-only/);
    expect(raw.rpc).not.toHaveBeenCalled();
  });

  test('select passes through', () => {
    const raw = fake();
    env.readOnlyClient(raw).from('users').select('id').eq('id', 1);
    expect(raw.builder.select).toHaveBeenCalledWith('id');
  });

  test('no coachip_* table may be read in a dry run', () => {
    expect(() => env.readOnlyClient(fake()).from('coachip_rollups')).toThrow(/coachip_/);
  });
});

describe('withPrivateDir', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');

  test('the temp audio directory is empty after success', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coachip-'));
    await env.withPrivateDir(root, async (dir) => { fs.writeFileSync(path.join(dir, 'a.ogg'), 'x'); });
    expect(fs.readdirSync(root)).toEqual([]);
  });

  test('the temp audio directory is empty after a thrown error', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coachip-'));
    await expect(env.withPrivateDir(root, async (dir) => {
      fs.writeFileSync(path.join(dir, 'a.ogg'), 'x');
      throw new Error('boom');
    })).rejects.toThrow('boom');
    expect(fs.readdirSync(root)).toEqual([]);
  });
});
