/**
 * GET /api/portal/training/module/:id/questions
 *
 * Serves the active quiz questions for a module so the portal can render the
 * quiz-taking form (the read side of the POST /quiz-attempts submit endpoint).
 *
 * Behaviour under test:
 *   1. Requires portal auth (401 otherwise).
 *   2. Rejects non-numeric module ids with 400.
 *   3. 404 when the module doesn't exist or is inactive.
 *   4. Returns active questions ordered by order_index ascending — the same
 *      set + order the WhatsApp side delivers and the POST endpoint grades.
 *   5. SECURITY: correct_option is never present in the response — grading is
 *      server-side only and the client must not receive the answer key.
 *   6. Options are normalised to plain strings whether the JSONB column holds
 *      ['a', 'b'] or [{ text: 'a' }, { text: 'b' }].
 *   7. Returns { success: true, questions: [] } when the module has no active
 *      questions (the frontend hides the Take Quiz button on that).
 *
 * Same mock harness as tests/training/portal-quiz-submit.test.js — mounts the
 * portal router on a bare req/res and pokes the matching handler.
 */

let supabaseFrom;
let tableStates;

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
  chain.range = jest.fn(() => chain);
  chain.maybeSingle = jest.fn(async () => finalize());
  chain.single = jest.fn(async () => finalize());
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
  const stack = findRoute(routes, 'get', '/training/module/:id/questions');
  if (!stack) throw new Error('Route GET /training/module/:id/questions not found');

  const req = {
    session: userId ? { portalUserId: userId, id: 'sess-1' } : null,
    params,
    query: {},
    method: 'GET',
    path: `/training/module/${params.id}/questions`,
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

// Canonical seed: one active module in an unlocked (first) level, with three
// active questions in a deliberately shuffled row order to prove order_index
// sorting, mixed option shapes to prove normalisation, and one INACTIVE
// question that must not appear.
function seedModule({ moduleId = 42, courseId = 7, levelId = 1 } = {}) {
  tableStates.training_questions = {
    rows: (filters) => {
      const all = [
        { id: 103, training_module_id: moduleId, question_text: 'Q3', options: ['x', 'y'], correct_option: '1', order_index: 2, is_active: true },
        { id: 101, training_module_id: moduleId, question_text: 'Q1', options: [{ text: 'a' }, { text: 'b' }], correct_option: '1', order_index: 0, is_active: true },
        { id: 102, training_module_id: moduleId, question_text: 'Q2', options: ['c', { text: 'd' }], correct_option: '2', order_index: 1, is_active: true },
        { id: 104, training_module_id: moduleId, question_text: 'Q4-inactive', options: ['z'], correct_option: '1', order_index: 3, is_active: false },
      ];
      // Honour the is_active filter the handler applies.
      if (filters.is_active === true) return all.filter(q => q.is_active);
      return all;
    },
  };
  tableStates.training_modules = {
    rows: (filters) => {
      const all = [{ id: moduleId, course_id: courseId, title: 'M', is_active: true }];
      if (filters.is_active === true) return all.filter(m => m.is_active);
      return all;
    },
  };
  tableStates.training_courses = {
    rows: [{ id: courseId, level_id: levelId, title: 'C' }],
  };
  tableStates.training_levels = {
    rows: [
      // First level (no previous) — never locked in the state map.
      { id: levelId, name: 'L1', order_index: 0, is_active: true },
    ],
  };
  tableStates.teacher_training_progress = { rows: [] };
  tableStates.training_assessment_attempts = { rows: [] };
  tableStates.training_grand_quizzes = { rows: [] };
}

beforeEach(() => {
  jest.resetModules();
  tableStates = {};

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

describe('GET /api/portal/training/module/:id/questions', () => {
  it('requires portal auth (401 when unauthenticated)', async () => {
    const { statusCode } = await invoke({ userId: null, params: { id: '42' } });
    expect(statusCode).toBe(401);
  });

  it('rejects non-numeric module ids with 400', async () => {
    const { statusCode, payload } = await invoke({ userId: 'user-1', params: { id: 'not-a-number' } });
    expect(statusCode).toBe(400);
    expect(payload.success).toBe(false);
  });

  it('404s when the module does not exist', async () => {
    tableStates.training_modules = { rows: [] };
    const { statusCode, payload } = await invoke({ userId: 'user-1', params: { id: '99' } });
    expect(statusCode).toBe(404);
    expect(payload.success).toBe(false);
  });

  it('returns active questions ordered by order_index, options normalised to strings', async () => {
    seedModule();
    const { statusCode, payload } = await invoke({ userId: 'user-1', params: { id: '42' } });

    expect(statusCode).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.questions).toHaveLength(3); // inactive Q4 excluded

    // order_index ascending regardless of DB row order
    expect(payload.questions.map(q => q.id)).toEqual([101, 102, 103]);

    // options normalised: [{text}] and mixed shapes both come back as strings
    expect(payload.questions[0].options).toEqual(['a', 'b']);
    expect(payload.questions[1].options).toEqual(['c', 'd']);
    expect(payload.questions[2].options).toEqual(['x', 'y']);

    // Full row shape for the first question (multi added by bd-2138 —
    // single-answer questions carry multi: false)
    expect(payload.questions[0]).toEqual({
      id: 101,
      question_text: 'Q1',
      options: ['a', 'b'],
      order_index: 0,
      multi: false,
    });
  });

  it('SECURITY: never exposes correct_option in the response', async () => {
    seedModule();
    const { payload } = await invoke({ userId: 'user-1', params: { id: '42' } });
    for (const q of payload.questions) {
      expect(q).not.toHaveProperty('correct_option');
    }
    // Belt-and-braces: the serialised payload must not contain the key at all.
    expect(JSON.stringify(payload)).not.toContain('correct_option');
  });

  it('returns an empty questions list when the module has no active questions', async () => {
    seedModule();
    tableStates.training_questions = { rows: [] };
    const { statusCode, payload } = await invoke({ userId: 'user-1', params: { id: '42' } });
    expect(statusCode).toBe(200);
    expect(payload).toEqual({ success: true, questions: [] });
  });

  it('filters by training_module_id and is_active in the questions query', async () => {
    seedModule();
    await invoke({ userId: 'user-1', params: { id: '42' } });

    expect(supabaseFrom).toHaveBeenCalledWith('training_questions');
    const calls = supabaseFrom.mock.results
      .filter(r => r.value && r.value.eq && r.value.eq.mock)
      .map(r => r.value.eq.mock.calls)
      .flat();
    const modCall = calls.find(c => c[0] === 'training_module_id');
    expect(modCall && Number(modCall[1])).toBe(42);
    const activeCall = calls.find(c => c[0] === 'is_active');
    expect(activeCall && activeCall[1]).toBe(true);
  });
});
