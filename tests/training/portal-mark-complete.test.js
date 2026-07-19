/**
 * POST /api/portal/training/module/:id/complete
 *
 * "Mark complete" for QUIZ-LESS training modules on the portal. Modules with
 * an active quiz record completion via quiz submission (see
 * portal-quiz-submit.test.js) — this endpoint only accepts modules that have
 * zero active training_questions, and writes the same
 * teacher_training_progress row shape both other writers use:
 * { user_id, module_id, completed_at }.
 *
 * Same mock harness as tests/training/portal-quiz-submit.test.js — mounts the
 * portal router on a bare req/res and pokes the matching handler. Extended
 * with head-count support (select(..., { count: 'exact', head: true })) since
 * the endpoint counts active questions to enforce the quiz-less rule.
 */

let supabaseFrom;
let tableStates;
let inserts;
let upserts;

function makeChain(tableName) {
  const state = tableStates[tableName] || {};
  const record = { table: tableName, filters: {}, orderCol: null, orderDir: null, selectOpts: null };
  const chain = {};

  const computeRows = () => {
    let rows = typeof state.rows === 'function' ? state.rows(record.filters) : (state.rows || []);
    // Opt-in equality filtering for the columns a state declares — used by
    // head-count queries so a seed can hold rows for several modules.
    if (Array.isArray(state.filterCols)) {
      for (const col of state.filterCols) {
        if (col in record.filters && typeof record.filters[col] !== 'object') {
          // String-coerced equality — Postgres coerces a text param against a
          // bigint column, so the mock must too (:id params arrive as strings).
          rows = rows.filter((r) => String(r[col]) === String(record.filters[col]));
        }
      }
    }
    return rows;
  };

  const finalize = () => {
    if (state.error) return { data: null, error: state.error };
    const rows = computeRows();
    return { data: rows[0] || null, error: null };
  };
  const finalizeMany = () => {
    if (state.error) return { data: null, count: null, error: state.error };
    let rows = computeRows();
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
    if (record.selectOpts && record.selectOpts.head) {
      return { data: null, count: rows.length, error: null };
    }
    return { data: rows, count: rows.length, error: null };
  };

  chain.select = jest.fn((_cols, opts) => { record.selectOpts = opts || null; return chain; });
  ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'is', 'not'].forEach((m) => {
    chain[m] = jest.fn((col, val) => { record.filters[col] = val; return chain; });
  });
  chain.in = jest.fn((col, vals) => { record.filters[col] = { in: vals }; return chain; });
  chain.order = jest.fn((col, opts) => {
    record.orderCol = col;
    record.orderDir = opts && opts.ascending ? 'asc' : 'desc';
    return chain;
  });
  chain.limit = jest.fn(() => chain);
  chain.maybeSingle = jest.fn(async () => finalize());
  chain.single = jest.fn(async () => finalize());
  chain.insert = jest.fn((rowOrRows) => {
    const rows = Array.isArray(rowOrRows) ? rowOrRows : [rowOrRows];
    for (const r of rows) inserts.push({ table: tableName, row: r });
    const returned = { ...(rows[0] || {}) };
    if (returned.id == null) returned.id = state.newId || 'generated-id';
    const insertChain = {
      select: jest.fn(() => insertChain),
      single: jest.fn(async () => ({ data: returned, error: state.insertError || null })),
      maybeSingle: jest.fn(async () => ({ data: returned, error: state.insertError || null })),
      then: (resolve, reject) => Promise.resolve({ data: state.insertError ? null : returned, error: state.insertError || null }).then(resolve, reject),
    };
    return insertChain;
  });
  chain.upsert = jest.fn((row, opts) => {
    upserts.push({ table: tableName, row, opts });
    const upsertChain = {
      select: jest.fn(() => upsertChain),
      single: jest.fn(async () => ({ data: row, error: null })),
      then: (resolve, reject) => Promise.resolve({ data: row, error: state.upsertError || null }).then(resolve, reject),
    };
    return upsertChain;
  });
  chain.then = (resolve, reject) => Promise.resolve(finalizeMany()).then(resolve, reject);
  return chain;
}

function findRoute(router, method, path) {
  for (const layer of router.stack) {
    if (!layer.route) continue;
    const p = layer.route.path;
    const methods = layer.route.methods || {};
    if (methods[method] && p === path) return layer.route.stack.map(s => s.handle);
  }
  return null;
}

async function invoke({ userId, params = {} }) {
  const routes = require('../../dashboard/routes/portal.routes');
  const stack = findRoute(routes, 'post', '/training/module/:id/complete');
  if (!stack) throw new Error('Route POST /training/module/:id/complete not found');

  const req = {
    session: userId ? { portalUserId: userId, id: 'sess-1' } : null,
    params, body: {}, query: {},
    method: 'POST',
    path: `/training/module/${params.id}/complete`,
    ip: '127.0.0.1',
    headers: {},
    get: () => undefined,
  };

  let statusCode = 200;
  let payload = null;
  const res = {
    status(code) { statusCode = code; return this; },
    json(b) { payload = b; return this; },
  };

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
        resolve();
      }
    });
  }
  return { statusCode, payload };
}

// A module on an unlocked first level. `questions` controls whether the
// module has an active quiz (the endpoint must reject those).
function seedModule({ moduleId = 42, courseId = 7, levelId = 1, questions = [] } = {}) {
  tableStates.training_modules = {
    rows: [{ id: moduleId, course_id: courseId, title: 'M', is_active: true }],
  };
  tableStates.training_courses = {
    rows: [{ id: courseId, level_id: levelId, title: 'C' }],
  };
  tableStates.training_levels = {
    rows: [{ id: levelId, name: 'L1', order_index: 0, is_active: true }],
  };
  tableStates.training_questions = {
    rows: questions,
    filterCols: ['training_module_id'],
  };
  tableStates.teacher_training_progress = { rows: [] };
  tableStates.training_assessment_attempts = { rows: [] };
  tableStates.training_grand_quizzes = { rows: [] };
}

beforeEach(() => {
  jest.resetModules();
  tableStates = {};
  inserts = [];
  upserts = [];

  supabaseFrom = jest.fn((tbl) => makeChain(tbl));
  jest.doMock('../../dashboard/config/supabase', () => ({
    from: supabaseFrom,
    rpc: jest.fn().mockResolvedValue({ error: null }),
  }));
  jest.doMock('../../dashboard/services/r2.service', () => ({
    generatePresignedUrl: jest.fn().mockResolvedValue(null),
    generatePresignedUrls: jest.fn().mockResolvedValue([]),
    isValidR2Url: jest.fn().mockReturnValue(true),
  }));
  jest.doMock('bcryptjs', () => ({ hash: jest.fn(), compare: jest.fn(), genSalt: jest.fn() }), { virtual: true });
  jest.doMock('express-rate-limit', () => jest.fn(() => (_req, _res, next) => next()), { virtual: true });
  jest.doMock('@aws-sdk/client-s3', () => ({ S3Client: jest.fn(), GetObjectCommand: jest.fn() }), { virtual: true });
});

afterEach(() => jest.resetModules());

describe('POST /api/portal/training/module/:id/complete', () => {
  it('requires portal auth (401 when unauthenticated)', async () => {
    const { statusCode } = await invoke({ userId: null, params: { id: '42' } });
    expect(statusCode).toBe(401);
  });

  it('rejects non-numeric module ids with 400', async () => {
    const { statusCode, payload } = await invoke({ userId: 'user-1', params: { id: 'not-a-number' } });
    expect(statusCode).toBe(400);
    expect(payload.success).toBe(false);
  });

  it('returns 404 for an unknown module', async () => {
    seedModule();
    tableStates.training_modules = { rows: [] };
    const { statusCode, payload } = await invoke({ userId: 'user-1', params: { id: '42' } });
    expect(statusCode).toBe(404);
    expect(payload.success).toBe(false);
  });

  it('rejects modules that HAVE an active quiz with 409 (completion flows through quiz submit)', async () => {
    seedModule({
      questions: [
        { id: 101, training_module_id: 42, correct_option: '1', order_index: 0, is_active: true },
      ],
    });
    const { statusCode, payload } = await invoke({ userId: 'user-1', params: { id: '42' } });
    expect(statusCode).toBe(409);
    expect(payload.success).toBe(false);
    expect((payload.error || '').toLowerCase()).toMatch(/quiz/);
    // Nothing written
    expect(upserts).toHaveLength(0);
    expect(inserts).toHaveLength(0);
  });

  it('happy path — quiz-less module → upserts the standard progress row shape', async () => {
    seedModule({ questions: [] });
    const { statusCode, payload } = await invoke({ userId: 'user-1', params: { id: '42' } });

    expect(statusCode).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.already_completed).toBe(false);
    expect(payload.completed_at).toBeTruthy();

    const progUpsert = upserts.find(u => u.table === 'teacher_training_progress');
    expect(progUpsert).toBeTruthy();
    expect(progUpsert.row).toEqual({
      user_id: 'user-1',
      module_id: 42,
      completed_at: payload.completed_at,
    });
    // Idempotent write path: conflict target is the (user_id, module_id)
    // unique constraint — the same one the quiz-submit endpoint uses.
    expect(progUpsert.opts).toEqual(expect.objectContaining({ onConflict: 'user_id,module_id' }));
  });

  it('idempotent — already-completed module returns the EXISTING timestamp and writes nothing', async () => {
    seedModule({ questions: [] });
    tableStates.teacher_training_progress = {
      rows: [{ user_id: 'user-1', module_id: 42, completed_at: '2026-01-01T00:00:00.000Z' }],
    };
    const { statusCode, payload } = await invoke({ userId: 'user-1', params: { id: '42' } });

    expect(statusCode).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.already_completed).toBe(true);
    expect(payload.completed_at).toBe('2026-01-01T00:00:00.000Z');
    expect(upserts).toHaveLength(0);
    expect(inserts).toHaveLength(0);
  });
});
