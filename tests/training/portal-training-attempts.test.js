/**
 * GET /api/portal/training/module/:id/attempts
 *
 * Returns the authenticated teacher's training-module quiz attempts for a
 * given module (rows in training_assessment_attempts with quiz_kind =
 * 'training_module' and training_module_id = :id).
 *
 * Behaviour:
 *   1. Requires portal auth (401 otherwise).
 *   2. Returns { success: true, attempts: [] } when the teacher has no
 *      attempts on the module.
 *   3. Returns attempts scoped to the caller — filtered by user_id from the
 *      session, filtered by the URL's :id, and filtered by
 *      quiz_kind = 'training_module' so grand-level attempts never leak into
 *      the per-module list.
 *   4. Each row exposes exactly: id, completed_at, score, max_score (aliased
 *      from total_score), quiz_kind.
 *   5. Ordered by completed_at ascending (chronological attempt history).
 *
 * Testing shape: rather than pull in supertest as a new devDep, we mount the
 * portal router on a fresh express app and invoke the handler by locating its
 * layer on the router stack. This mirrors the mock-supabase harness used in
 * tests/training/training-quiz.test.js.
 */

let supabaseFrom;
let tableStates;

// A per-table mock harness modelled on tests/training/training-quiz.test.js.
function makeChain(tableName) {
  const state = tableStates[tableName] || {};
  const record = { table: tableName, filters: {}, orderCol: null, orderDir: null };

  const chain = {};
  const finalize = () => {
    if (state.error) return { data: null, error: state.error };
    const rows = typeof state.rows === 'function' ? state.rows(record.filters) : (state.rows || []);
    return { data: rows[0] || null, error: null };
  };
  const finalizeMany = () => {
    if (state.error) return { data: null, error: state.error };
    let rows = typeof state.rows === 'function' ? state.rows(record.filters) : (state.rows || []);
    if (record.orderCol) {
      const dir = record.orderDir === 'asc' ? 1 : -1;
      rows = [...rows].sort((a, b) => {
        const av = a[record.orderCol], bv = b[record.orderCol];
        if (av === bv) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        return av < bv ? -1 * dir : 1 * dir;
      });
    }
    return { data: rows, error: null };
  };

  chain.select = jest.fn(() => chain);
  ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'is'].forEach((m) => {
    chain[m] = jest.fn((col, val) => { record.filters[col] = val; return chain; });
  });
  chain.in = jest.fn((col, vals) => { record.filters[col] = { in: vals }; return chain; });
  chain.order = jest.fn((col, opts) => {
    record.orderCol = col;
    record.orderDir = opts && opts.ascending ? 'asc' : 'desc';
    return chain;
  });
  chain.limit = jest.fn(() => chain);
  chain.range = jest.fn(() => chain);
  chain.maybeSingle = jest.fn(async () => finalize());
  chain.single = jest.fn(async () => finalize());
  chain.then = (resolve, reject) => Promise.resolve(finalizeMany()).then(resolve, reject);
  return chain;
}

// Locate the express layer that matches GET /training/module/:id/attempts on
// the router. Returns the handler stack.
function findAttemptsRoute(router) {
  for (const layer of router.stack) {
    if (!layer.route) continue;
    const path = layer.route.path;
    const methods = layer.route.methods || {};
    if (methods.get && path === '/training/module/:id/attempts') {
      return layer.route.stack.map(s => s.handle);
    }
  }
  return null;
}

// Invoke the handler stack (auth middleware → route handler) with a fake req/res.
async function invoke({ userId, params = {}, query = {} }) {
  const routes = require('../../dashboard/routes/portal.routes');
  const stack = findAttemptsRoute(routes);
  if (!stack) throw new Error('Route GET /training/module/:id/attempts not found on router');

  const req = {
    session: userId ? { portalUserId: userId, id: 'sess-1' } : null,
    params,
    query,
    method: 'GET',
    path: `/training/module/${params.id}/attempts`,
    ip: '127.0.0.1',
    headers: {},
    get: () => undefined,
  };

  let statusCode = 200;
  let payload = null;
  const res = {
    status(code) { statusCode = code; return this; },
    json(body) { payload = body; return this; },
  };

  // Run stack sequentially; the auth middleware calls next() only on success.
  let advanced = true;
  for (const handler of stack) {
    if (!advanced) break;
    advanced = false;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => {
      const maybe = handler(req, res, () => { advanced = true; resolve(); });
      if (maybe && typeof maybe.then === 'function') {
        maybe.then(() => resolve(), () => resolve());
      } else if (advanced === false) {
        // Sync handler that terminated (called res.json / res.status) — done.
        resolve();
      }
    });
  }
  return { statusCode, payload };
}

beforeEach(() => {
  jest.resetModules();
  tableStates = {};

  supabaseFrom = jest.fn((tbl) => makeChain(tbl));
  jest.doMock('../../dashboard/config/supabase', () => ({
    from: supabaseFrom,
    rpc: jest.fn().mockResolvedValue({ error: null }),
  }));

  // R2 service is imported at module load; stub it so the route file loads.
  jest.doMock('../../dashboard/services/r2.service', () => ({
    generatePresignedUrl: jest.fn().mockResolvedValue(null),
    generatePresignedUrls: jest.fn().mockResolvedValue([]),
    isValidR2Url: jest.fn().mockReturnValue(true),
  }));

  // dashboard-only deps that live in dashboard/node_modules (not installed in
  // the OSS root test suite). Virtual-mock them so portal.routes.js loads.
  jest.doMock('bcryptjs', () => ({
    hash: jest.fn(), compare: jest.fn(), genSalt: jest.fn(),
  }), { virtual: true });
  jest.doMock('express-rate-limit', () => {
    // Return a factory that yields a no-op middleware.
    return jest.fn(() => (_req, _res, next) => next());
  }, { virtual: true });
  jest.doMock('@aws-sdk/client-s3', () => ({
    S3Client: jest.fn(),
    GetObjectCommand: jest.fn(),
  }), { virtual: true });
});

afterEach(() => jest.resetModules());

describe('GET /api/portal/training/module/:id/attempts', () => {
  it('requires portal auth (401 when unauthenticated)', async () => {
    const { statusCode } = await invoke({ userId: null, params: { id: '42' } });
    expect(statusCode).toBe(401);
  });

  it('returns an empty list when the teacher has no attempts on this module', async () => {
    tableStates.training_assessment_attempts = { rows: [] };

    const { statusCode, payload } = await invoke({ userId: 'user-1', params: { id: '42' } });

    expect(statusCode).toBe(200);
    expect(payload).toEqual({ success: true, attempts: [] });
  });

  it('returns the teacher\'s attempts on this module in chronological order', async () => {
    tableStates.training_assessment_attempts = {
      rows: [
        { id: 'att-2', user_id: 'user-1', training_module_id: 42, quiz_kind: 'training_module',
          score: 3, total_score: 3, completed_at: '2026-07-12T09:00:00Z', status: 'completed' },
        { id: 'att-1', user_id: 'user-1', training_module_id: 42, quiz_kind: 'training_module',
          score: 2, total_score: 3, completed_at: '2026-07-10T09:00:00Z', status: 'completed' },
      ],
    };

    const { statusCode, payload } = await invoke({ userId: 'user-1', params: { id: '42' } });

    expect(statusCode).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.attempts).toHaveLength(2);
    // Chronological (ascending completed_at) — earliest first
    expect(payload.attempts[0].id).toBe('att-1');
    expect(payload.attempts[1].id).toBe('att-2');
    // Shape check — exactly the fields the frontend needs
    expect(payload.attempts[0]).toEqual({
      id: 'att-1',
      completed_at: '2026-07-10T09:00:00Z',
      score: 2,
      max_score: 3,
      quiz_kind: 'training_module',
    });
  });

  it('scopes to caller: query filters by user_id, module_id, and quiz_kind', async () => {
    tableStates.training_assessment_attempts = { rows: [] };
    await invoke({ userId: 'user-1', params: { id: '42' } });

    expect(supabaseFrom).toHaveBeenCalledWith('training_assessment_attempts');

    // Inspect what filters the chain saw across every from('training_assessment_attempts') call
    const calls = supabaseFrom.mock.results
      .filter(r => r.value && r.value.eq && r.value.eq.mock)
      .map(r => r.value.eq.mock.calls)
      .flat();
    const eqCols = calls.map(c => c[0]);
    expect(eqCols).toEqual(expect.arrayContaining(['user_id', 'training_module_id', 'quiz_kind']));

    const userCall = calls.find(c => c[0] === 'user_id');
    expect(userCall && userCall[1]).toBe('user-1');
    const modCall = calls.find(c => c[0] === 'training_module_id');
    // The handler parses the URL :id — we expect a Number here (training_module_id
    // is a BIGINT column and Supabase happily accepts both, but the handler
    // should normalise to avoid string-vs-int surprises).
    expect(modCall && Number(modCall[1])).toBe(42);
    const kindCall = calls.find(c => c[0] === 'quiz_kind');
    expect(kindCall && kindCall[1]).toBe('training_module');
  });

  it('rejects non-numeric module ids with 400', async () => {
    const { statusCode, payload } = await invoke({ userId: 'user-1', params: { id: 'not-a-number' } });
    expect(statusCode).toBe(400);
    expect(payload.success).toBe(false);
  });
});
