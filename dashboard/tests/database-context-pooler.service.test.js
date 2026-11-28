'use strict';
/**
 * The portal's per-request DB role and user context through a transaction pooler (bd-sex15q.50).
 * Prod's portal runs on Supavisor 6543 (transaction mode): a statement may land on any backend, and a session-scope
 * SET ROLE / set_config stays on the backend for whoever is served next. Needs a real PostgreSQL behind pgbouncer in
 * pool_mode=transaction with ONE server connection: run scripts/portal_rls_pooler_harness.sh. Without the harness the
 * suite is skipped (CI has neither server).
 * The middleware and dashboard/config/database run for real; only req/res are stand-ins. Fictional ids.
 */
const EventEmitter = require('events');
const { Client } = require('pg');

const d = process.env.PORTAL_RLS_POOLED ? describe : describe.skip;
const ADMIN_A = '11111111-1111-4111-8111-111111111111';
const ADMIN_B = '22222222-2222-4222-8222-222222222222';
const WHO = "SELECT current_user AS role, coalesce(current_setting('app.portal_user_id', true), '') AS uid";

const request = (userId) => {
  const req = { method: 'GET', path: '/observability/users', url: '/observability/users', session: userId ? { userId } : {} };
  const res = new EventEmitter();
  res.headersSent = false;
  res.writableEnded = false;
  res.status = () => res;
  res.json = () => res;
  return { req, res };
};

d('the portal DB context through a transaction pooler (one shared backend)', () => {
  let setDatabaseContext;
  let pool;
  const open = [];
  // Runs the real middleware; resolves with req once next() is called.
  const enter = async (userId) => {
    const r = request(userId);
    await new Promise((resolve, reject) => setDatabaseContext(r.req, r.res, (err) => (err ? reject(err) : resolve())));
    open.push(r);
    return r;
  };
  const finish = (r) => { r.res.writableEnded = true; r.res.emit('finish'); };
  const who = async (q) => (await q.query(WHO)).rows[0];
  const settle = (ms = 50) => new Promise((r) => setTimeout(r, ms));

  beforeAll(() => {
    ({ setDatabaseContext } = require('../middleware/rbac/database-context'));
    pool = require('../config/database');
  });
  afterEach(async () => {
    while (open.length) finish(open.pop());
    await settle();
    // Clear anything a failing (pre-fix) case left on the one server backend, so cases stay independent.
    const c = new Client({ connectionString: process.env.PORTAL_RLS_DIRECT_URL });
    await c.connect();
    await c.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE backend_type = 'client backend' AND pid <> pg_backend_pid()");
    await c.end();
    await settle(200);
  });
  afterAll(async () => { await pool.end().catch(() => {}); });

  test("an admin request's role and user id do not reach another request's statements on the same backend", async () => {
    const admin = await enter(ADMIN_A);
    expect(await who(admin.req.dbClient)).toEqual({ role: 'postgres', uid: ADMIN_A });
    const visitor = await enter(null); // a coach or COACHIP request: no session.userId
    expect(await who(visitor.req.dbClient)).toEqual({ role: 'postgres', uid: '' });
    expect(await who(pool)).toEqual({ role: 'postgres', uid: '' }); // a route's own pool.query (COACHIP, portal.routes)
  });

  test('two admin requests at once each run under their own user id', async () => {
    const a = await enter(ADMIN_A);
    const b = await enter(ADMIN_B);
    expect(await who(a.req.dbClient)).toEqual({ role: 'postgres', uid: ADMIN_A });
    expect(await who(b.req.dbClient)).toEqual({ role: 'postgres', uid: ADMIN_B });
    // the same, concurrently (Promise.all on req.dbClient, as /observability/user/:id does)
    const [x, y, z] = await Promise.all([who(a.req.dbClient), who(b.req.dbClient), who(a.req.dbClient)]);
    expect([x.uid, y.uid, z.uid]).toEqual([ADMIN_A, ADMIN_B, ADMIN_A]);
  });

  test('a finished admin request leaves nothing on the backend', async () => {
    const admin = await enter(ADMIN_A);
    await who(admin.req.dbClient);
    finish(admin); open.length = 0;
    await settle();
    expect(await who(pool)).toEqual({ role: 'postgres', uid: '' });
  });

  test('a failed statement does not poison the next one in the same request (autocommit semantics kept)', async () => {
    const admin = await enter(ADMIN_A);
    await expect(admin.req.dbClient.query('SELECT 1/0')).rejects.toThrow(/division by zero/);
    expect(await who(admin.req.dbClient)).toEqual({ role: 'postgres', uid: ADMIN_A });
    expect(await who(pool)).toEqual({ role: 'postgres', uid: '' });
  });

  test("a handler's own BEGIN … COMMIT runs under the request's user id and leaves nothing behind", async () => {
    const admin = await enter(ADMIN_A);
    const q = admin.req.dbClient;
    await q.query('BEGIN');
    expect(await who(q)).toEqual({ role: 'postgres', uid: ADMIN_A });
    expect((await q.query('SELECT 2 AS n')).rows[0].n).toBe(2);
    await q.query('COMMIT');
    expect(await who(pool)).toEqual({ role: 'postgres', uid: '' });
  });

  test("an admin's reads see the rows Observability counts (no switch into the service-role-only RLS of portal_app_user)", async () => {
    // on prod portal_app_user reads 0 rows from coaching_sessions, conversations and lesson_plans: their only policy is
    // auth.role() = 'service_role'. The role scoped nothing per user; it only emptied the admin's panels.
    const admin = await enter(ADMIN_A);
    expect((await admin.req.dbClient.query('SELECT count(*)::int AS n FROM public.coaching_sessions')).rows[0].n).toBe(3);
  });

  test('a request torn down mid-statement does not hand its transaction to the next request', async () => {
    const admin = await enter(ADMIN_A);
    const slow = admin.req.dbClient.query('SELECT pg_sleep(0.4)').catch(() => {});
    await settle(100);
    admin.res.emit('close'); // the client went away; cleanup runs while the statement is in flight
    open.length = 0;
    await slow;
    await settle(200);
    expect(await who(pool)).toEqual({ role: 'postgres', uid: '' });
    const next = await enter(null);
    expect(await who(next.req.dbClient)).toEqual({ role: 'postgres', uid: '' });
  });
});
