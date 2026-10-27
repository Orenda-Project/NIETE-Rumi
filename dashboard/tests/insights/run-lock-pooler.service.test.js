'use strict';
/**
 * The nightly's run lock through a transaction pooler (bd-sex15q.19 session 2a; board 20261027T003856 lander fail).
 * Needs a real PostgreSQL behind pgbouncer in pool_mode=transaction: run scripts/coachip_lock_harness.sh. Without the
 * harness's URLs the suite is skipped (CI has neither server).
 *   POOLED: default_pool_size=2 (Supavisor on 6543) · ONE: the same pooler, pool_size=1 · DIRECT: the server itself.
 */
const { Client } = require('pg');
const cli = require('../../jobs/coachip-nightly');

const POOLED = process.env.COACHIP_LOCK_POOLED_URL;
const ONE = process.env.COACHIP_LOCK_ONE_URL;
const DIRECT = process.env.COACHIP_LOCK_DIRECT_URL;
const d = POOLED && ONE && DIRECT ? describe : describe.skip;

const open = async (url) => { const c = new Client({ connectionString: url }); await c.connect(); return c; };
const holders = async () => {
  const c = await open(DIRECT);
  try {
    const { rows } = await c.query(`SELECT count(*)::int AS n FROM pg_locks
      WHERE locktype = 'advisory' AND objid = (hashtext('coachip-nightly')::int)::oid`);
    return rows[0].n;
  } finally { await c.end(); }
};
const settle = (ms = 300) => new Promise((r) => setTimeout(r, ms));

d('the run lock through a transaction pooler', () => {
  const clients = [];
  const client = async (url) => { const c = await open(url); clients.push(c); return c; };
  afterEach(async () => {
    while (clients.length) await clients.pop().end().catch(() => {});
    // Clear anything a failing (pre-fix) case leaked, so cases stay independent.
    const c = await open(DIRECT);
    await c.query(`SELECT pg_terminate_backend(pid) FROM pg_locks WHERE locktype = 'advisory'
      AND objid = (hashtext('coachip-nightly')::int)::oid AND pid <> pg_backend_pid()`);
    await c.end();
    await settle();
  });

  test('a run that ended leaves no holder on the pooled backend', async () => {
    const c1 = await client(POOLED);
    expect(await cli.withRunLock(c1, () => {}, async () => 0)).toBe(0);
    await c1.end(); clients.length = 0;
    await settle();
    expect(await holders()).toBe(0);
  });

  test('the next run after an ended one takes the lock: same pooled backend, and a session connection', async () => {
    const c1 = await client(ONE);
    expect(await cli.withRunLock(c1, () => {}, async () => 0)).toBe(0);
    await c1.end(); clients.length = 0;
    await settle();
    const lines = [];
    const c2 = await client(ONE);
    expect(await cli.withRunLock(c2, (m) => lines.push(m), async () => 0)).toBe(0);
    const c3 = await client(DIRECT);
    expect(await cli.withRunLock(c3, (m) => lines.push(m), async () => 0)).toBe(0);
    expect(lines).toEqual([]);
  });

  test('two runs at once through the pooler: the second exits 4 and never runs', async () => {
    const c1 = await client(POOLED);
    let release;
    const gate = new Promise((r) => { release = r; });
    const first = cli.withRunLock(c1, () => {}, () => gate.then(() => 0));
    await settle();
    const lines = [];
    const second = jest.fn(async () => 0);
    const c2 = await client(POOLED);
    expect(await cli.withRunLock(c2, (m) => lines.push(m), second)).toBe(4);
    expect(second).not.toHaveBeenCalled();
    expect(lines).toEqual(['already running']);
    release();
    expect(await first).toBe(0);
  });

  test('a run that throws releases the lock before its connection closes', async () => {
    const c1 = await client(POOLED);
    await expect(cli.withRunLock(c1, () => {}, async () => { throw new Error('stage failed'); })).rejects.toThrow('stage failed');
    expect(await holders()).toBe(0);
  });

  test('a run whose process dies mid-run leaves no holder', async () => {
    const c1 = await client(POOLED);
    let inside;
    const entered = new Promise((r) => { inside = r; });
    const lines = [];
    const run = cli.withRunLock(c1, (m) => lines.push(m), () => { inside(); return new Promise(() => {}); });
    run.catch(() => {});
    await entered;
    expect(await holders()).toBe(1);
    expect(lines).toEqual([]);
    c1.connection.stream.destroy(); clients.length = 0;
    await settle(800);
    expect(await holders()).toBe(0);
    expect(lines).toEqual(['lock_lost']); // the dying client's own process hears it, it does not crash on it
  });
});
