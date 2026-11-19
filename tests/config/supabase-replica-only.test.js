'use strict';
/**
 * bot/shared/config/supabase-replica-only.js — the read-replica client for jobs that must NEVER read the primary.
 *   - no NIETE_SUPABASE_REPLICA_URL (or no service key) → null: the job is off on that tier, never the primary;
 *   - the primary client module is never loaded, and createClient is only ever called with the replica URL;
 *   - checkReplica(client) is true only when rpc db_is_replica answers exactly true; false, an error, a throw or
 *     no client all refuse.
 * Mocked at the network edge: createClient records what it is asked for.
 */
let mockPrimaryLoaded = 0;
jest.mock('../../bot/shared/config/supabase', () => { mockPrimaryLoaded += 1; return {}; });

const mockCreated = [];
jest.mock('@supabase/supabase-js', () => ({
  createClient: (url, key, opts) => { mockCreated.push({ url, key, opts }); return { url, rpc: jest.fn() }; },
}));

const REPLICA = 'https://example-rr.supabase.co';

function load(env) {
  let mod;
  jest.isolateModules(() => {
    const saved = { ...process.env };
    delete process.env.NIETE_SUPABASE_REPLICA_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    Object.assign(process.env, env);
    try { mod = require('../../bot/shared/config/supabase-replica-only'); } finally { process.env = saved; }
  });
  return mod;
}

beforeEach(() => { mockCreated.length = 0; mockPrimaryLoaded = 0; });

describe('replicaClient', () => {
  test('a replica URL and the service key → a client on the replica URL, no session', () => {
    const M = load({ NIETE_SUPABASE_REPLICA_URL: ` ${REPLICA} `, SUPABASE_SERVICE_ROLE_KEY: 'k' });
    const c = M.replicaClient();
    expect(c).not.toBeNull();
    expect(mockCreated).toHaveLength(1);
    expect(mockCreated[0].url).toBe(REPLICA);
    expect(mockCreated[0].opts.auth).toEqual({ autoRefreshToken: false, persistSession: false });
    expect(M.replicaClient()).toBe(c); // one client per process
  });

  test.each([
    ['no URL', { SUPABASE_SERVICE_ROLE_KEY: 'k' }],
    ['blank URL', { NIETE_SUPABASE_REPLICA_URL: '  ', SUPABASE_SERVICE_ROLE_KEY: 'k' }],
    ['no service key', { NIETE_SUPABASE_REPLICA_URL: REPLICA }],
  ])('%s → null, and no client of any kind is made', (_, env) => {
    const M = load(env);
    expect(M.replicaClient()).toBeNull();
    expect(mockCreated).toHaveLength(0);
  });

  test('the primary client is never loaded', () => {
    const M = load({ NIETE_SUPABASE_REPLICA_URL: REPLICA, SUPABASE_SERVICE_ROLE_KEY: 'k' });
    M.replicaClient();
    load({});
    expect(mockPrimaryLoaded).toBe(0);
  });
});

describe('checkReplica', () => {
  const M = load({});
  const client = (answer) => ({ rpc: jest.fn(answer) });

  test('db_is_replica true → true', async () => {
    const c = client(async () => ({ data: true, error: null }));
    await expect(M.checkReplica(c)).resolves.toEqual({ ok: true });
    expect(c.rpc).toHaveBeenCalledWith('db_is_replica');
  });

  test.each([
    ['false (the primary)', async () => ({ data: false, error: null }), 'not_replica'],
    ['a string "true"', async () => ({ data: 'true', error: null }), 'not_replica'],
    ['null', async () => ({ data: null, error: null }), 'not_replica'],
    ['an error', async () => ({ data: null, error: { message: 'boom' } }), 'check_failed'],
    ['a throw', async () => { throw new Error('ECONNRESET'); }, 'check_failed'],
  ])('%s → refused', async (_, answer, reason) => {
    await expect(M.checkReplica(client(answer))).resolves.toEqual({ ok: false, reason });
  });

  test('no client → refused without a call', async () => {
    await expect(M.checkReplica(null)).resolves.toEqual({ ok: false, reason: 'no_replica' });
  });
});
