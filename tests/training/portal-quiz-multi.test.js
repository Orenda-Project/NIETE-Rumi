/**
 * bd-2138 — multi-answer ("msq") questions on the portal.
 *
 * A question is MULTI iff its correct_option holds a comma-joined set
 * ('1,3'). Contract:
 *   - GET /training/module/:id/questions exposes `multi: true|false` per
 *     question (computed server-side from correct_option, which itself is
 *     STILL never returned).
 *   - POST /training/module/:id/quiz-attempts grades multi answers by SET
 *     EQUALITY. The client may send chosen_option as '1,3', '3,1' or
 *     [1, 3] — all normalise to the same set. Subset/superset → wrong.
 *   - Single-answer grading is unchanged.
 *
 * Harness cloned from tests/training/portal-quiz-questions.test.js.
 */

let supabaseFrom;
let tableStates;

function makeChain(tableName) {
  const state = tableStates[tableName] || {};
  const record = { table: tableName, filters: {}, orderCol: null, orderDir: null, mutation: null };
  const chain = {};

  const finalize = () => {
    if (record.mutation && !record._mutationTracked) {
      state._mutations = state._mutations || [];
      state._mutations.push(record.mutation);
      record._mutationTracked = true;
    }
    if (state.error) return { data: null, error: state.error };
    if (record.mutation && record.mutation.op === 'insert') {
      // .insert().select('id').single() shape — return a fake id
      return { data: { id: state.insertId || 'attempt-1' }, error: null };
    }
    const rows = typeof state.rows === 'function' ? state.rows(record.filters) : (state.rows || []);
    return { data: rows[0] || null, error: null };
  };
  const finalizeMany = () => {
    if (record.mutation && !record._mutationTracked) {
      state._mutations = state._mutations || [];
      state._mutations.push(record.mutation);
      record._mutationTracked = true;
    }
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
  chain.insert = jest.fn((payload) => { record.mutation = { op: 'insert', payload }; return chain; });
  chain.update = jest.fn((payload) => { record.mutation = { op: 'update', payload }; return chain; });
  chain.upsert = jest.fn((payload, opts) => { record.mutation = { op: 'upsert', payload, opts }; return chain; });
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
    if ((layer.route.methods || {})[method] && layer.route.path === path) {
      return layer.route.stack.map(s => s.handle);
    }
  }
  return null;
}

async function invoke(method, path, { userId, params = {}, body = {} }) {
  const routes = require('../../dashboard/routes/portal.routes');
  const stack = findRoute(routes, method, path);
  if (!stack) throw new Error(`Route ${method} ${path} not found`);

  const req = {
    session: userId ? { portalUserId: userId, id: 'sess-1' } : null,
    params,
    body,
    query: {},
    method: method.toUpperCase(),
    path,
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

// Module 42 with one multi question (correct 1,3) and one single (correct 2).
function seed() {
  tableStates.training_questions = {
    rows: [
      { id: 901, training_module_id: 42, question_text: 'Multi? (Select all that apply)', options: ['a', 'b', 'c', 'd'], correct_option: '1,3', order_index: 0, is_active: true },
      { id: 902, training_module_id: 42, question_text: 'Single?', options: ['a', 'b', 'c'], correct_option: '2', order_index: 1, is_active: true },
    ],
  };
  tableStates.training_modules = {
    rows: [{ id: 42, course_id: 7, title: 'M', is_active: true }],
  };
  tableStates.training_courses = { rows: [{ id: 7, level_id: 1, title: 'C' }] };
  tableStates.training_levels = {
    rows: [{ id: 1, name: 'L1', order_index: 0, vendor_id: 'v1', is_active: true }],
  };
  tableStates.training_vendors = { rows: [{ id: 'v1', unlock_logic: 'all_modules' }] };
  tableStates.teacher_training_progress = { rows: [] };
  tableStates.training_assessment_attempts = { rows: [], insertId: 'attempt-1' };
  tableStates.training_assessment_answers = { rows: [] };
  tableStates.training_grand_quizzes = { rows: [] };
  tableStates.teacher_training_assignments = { rows: [{ program_id: 'prog-1' }] };
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

describe('bd-2138 — GET questions exposes multi flag, never the key', () => {
  test('multi flag set per question; correct_option absent', async () => {
    seed();
    const { statusCode, payload } = await invoke('get', '/training/module/:id/questions', { userId: 'u1', params: { id: '42' } });
    expect(statusCode).toBe(200);
    const [q1, q2] = payload.questions;
    expect(q1.multi).toBe(true);
    expect(q2.multi).toBe(false);
    for (const q of payload.questions) {
      expect(q).not.toHaveProperty('correct_option');
    }
  });
});

describe('bd-2138 — POST quiz-attempts grades multi by set equality', () => {
  async function submit(answers) {
    return invoke('post', '/training/module/:id/quiz-attempts', {
      userId: 'u1', params: { id: '42' }, body: { answers },
    });
  }

  test('exact set in any order and any form is correct', async () => {
    for (const form of ['1,3', '3,1', [1, 3], ['3', '1']]) {
      seed();
      const { statusCode, payload } = await submit([
        { question_id: 901, chosen_option: form },
        { question_id: 902, chosen_option: '2' },
      ]);
      expect(statusCode).toBe(200);
      expect(payload.attempt.score).toBe(2);
    }
  });

  test('subset and superset are wrong', async () => {
    for (const form of ['1', '1,2,3']) {
      seed();
      const { payload } = await submit([
        { question_id: 901, chosen_option: form },
        { question_id: 902, chosen_option: '2' },
      ]);
      expect(payload.attempt.score).toBe(1);
    }
  });

  test('single-answer grading unchanged', async () => {
    seed();
    const { payload } = await submit([
      { question_id: 901, chosen_option: '1,3' },
      { question_id: 902, chosen_option: '3' },
    ]);
    expect(payload.attempt.score).toBe(1);
  });
});
