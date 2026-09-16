/**
 * bd-qd1p3 (audit P1-9) — a teacher on two programs cannot submit a level exam.
 *
 * POST /api/portal/training/level/:id/grand-quiz/attempts opens with:
 *
 *     const { data: enrolment } = await supabase
 *       .from('teacher_training_assignments')
 *       .select('program_id').eq('user_id', userId).eq('is_active', true)
 *       .maybeSingle();                        // <-- no .limit(1)
 *     if (!enrolment) return res.status(400)…
 *
 * PostgREST answers `.maybeSingle()` with PGRST116 and `data: null` when the
 * filter matches more than one row. Only `data` is destructured, so `error` is
 * dropped on the floor and the handler reads the null as "not enrolled" — a
 * teacher who selected two bands is told she has no training programme and
 * never reaches the gate.
 *
 * 787 teachers on production hold two active assignments; 656 have already sat
 * a level exam. THREE of the four identical reads in this file already carry
 * `.limit(1)`, including one 70 lines further down the SAME handler.
 *
 * WHY NO EXISTING SUITE CATCHES IT
 *   The shared harness in portal-grand-quiz.test.js resolves `maybeSingle()` to
 *   `rows[0] || null` unconditionally — it cannot represent the multi-row error,
 *   so the bug is invisible to every test written on it. The harness below
 *   models the real contract instead: >1 matching row WITHOUT `.limit()` is an
 *   error, with `.limit()` it is the first row. That distinction is the whole
 *   test; weaken it and this suite passes against the bug.
 */

let tableStates;
let supabaseFrom;

function makeChain(tableName) {
  const state = tableStates[tableName] || {};
  const filters = {};
  let limited = false;

  const matching = () => {
    const rows = typeof state.rows === 'function' ? state.rows(filters) : (state.rows || []);
    return rows.filter(r => Object.entries(filters).every(([k, v]) => r[k] === undefined || r[k] === v));
  };

  const chain = {};
  chain.select = jest.fn(() => chain);
  ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'is', 'not'].forEach((m) => {
    chain[m] = jest.fn((col, val) => { filters[col] = val; return chain; });
  });
  chain.in = jest.fn(() => chain);
  chain.order = jest.fn(() => chain);
  chain.range = jest.fn(() => chain);
  chain.limit = jest.fn(() => { limited = true; return chain; });

  // The contract this suite exists to pin.
  const single = async () => {
    const rows = matching();
    if (rows.length > 1 && !limited) {
      return {
        data: null,
        error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' },
      };
    }
    return { data: rows[0] || null, error: null };
  };
  chain.maybeSingle = jest.fn(single);
  chain.single = jest.fn(single);

  chain.insert = jest.fn(() => {
    const ins = { select: jest.fn(() => ins), single: jest.fn(async () => ({ data: { id: 'new-id' }, error: null })), maybeSingle: jest.fn(async () => ({ data: { id: 'new-id' }, error: null })) };
    return ins;
  });
  chain.update = jest.fn(() => chain);
  chain.upsert = jest.fn(() => chain);
  chain.delete = jest.fn(() => chain);
  chain.then = (res) => res({ data: matching(), error: null });
  return chain;
}

function findRoute(router, method, path) {
  for (const layer of router.stack || []) {
    if (!layer.route) continue;
    const p = layer.route.path;
    if ((layer.route.methods || {})[method] && p === path) return layer.route.stack.map(s => s.handle);
  }
  return null;
}

async function invoke({ method, path, userId, params = {}, body = {} }) {
  const routes = require('../../dashboard/routes/portal.routes');
  const stack = findRoute(routes, method, path);
  if (!stack) throw new Error(`Route ${method.toUpperCase()} ${path} not found`);
  const req = {
    session: userId ? { portalUserId: userId, id: 'sess-1' } : null,
    params, body, query: {}, method: method.toUpperCase(), path, ip: '127.0.0.1',
    headers: {}, get: () => undefined,
  };
  let statusCode = 200; let payload = null;
  const res = { status(c) { statusCode = c; return this; }, json(b) { payload = b; return this; } };
  let advanced = true;
  for (const handler of stack) {
    if (!advanced) break;
    advanced = false;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => {
      const maybe = handler(req, res, () => { advanced = true; resolve(); });
      if (maybe && typeof maybe.then === 'function') maybe.then(() => resolve(), () => resolve());
      else if (advanced === false) resolve();
    });
  }
  return { statusCode, payload };
}

const SUBMIT = '/training/level/:id/grand-quiz/attempts';
const NOT_ENROLLED = /No active training program assignment/i;

/** @param {number} programs how many ACTIVE assignments this teacher holds */
function seed(programs) {
  tableStates = {
    teacher_training_assignments: {
      rows: Array.from({ length: programs }, (_, i) => ({
        user_id: 'user-1', is_active: true, program_id: `prog-${i + 1}`,
      })),
    },
    training_levels: { rows: [{ id: 1, name: 'Foundations', order_index: 0, is_active: true, vendor_id: 'v1' }] },
    training_vendors: { rows: [{ id: 'v1', key: 'NIETE', name: 'NIETE', unlock_logic: 'chain', has_grand_quiz: true, passing_pct: 80 }] },
    training_program_scopes: { rows: [{ program_id: 'prog-1', vendor_id: 'v1', level_ids: null }] },
    training_courses: { rows: [{ id: 'c1', level_id: 1, is_active: true }] },
    training_modules: { rows: [{ id: 'm1', course_id: 'c1', is_active: true }] },
    teacher_training_progress: { rows: [{ module_id: 'm1', user_id: 'user-1' }] },
    training_grand_quizzes: { rows: [{ id: 90, level_id: 1, quiz_type: 'grand_quiz', is_active: true }] },
    training_questions: { rows: [{ id: 201, grand_quiz_id: 90, question_text: 'Q1', options: ['a', 'b'], correct_option: '1', is_active: true }] },
    training_assessment_attempts: { rows: [], newId: 'att-1' },
    training_assessment_answers: { rows: [] },
    training_certificates: { rows: [] },
  };
}

beforeEach(() => {
  process.env.PORTAL_ASSESSMENTS_TEST_ENABLE = '1';
  jest.resetModules();
  supabaseFrom = jest.fn((t) => makeChain(t));
  jest.doMock('../../dashboard/config/supabase', () => ({ from: supabaseFrom, rpc: jest.fn().mockResolvedValue({ error: null }) }));
  const { installTrainingDelegation } = require('../fixtures/delegate-training-to-bot');
  installTrainingDelegation(() => supabaseFrom);
  jest.doMock('../../dashboard/services/r2.service', () => ({
    generatePresignedUrl: jest.fn().mockResolvedValue(null),
    generatePresignedUrls: jest.fn().mockResolvedValue([]),
    isValidR2Url: jest.fn().mockReturnValue(true),
  }));
  jest.doMock('bcryptjs', () => ({ hash: jest.fn(), compare: jest.fn(), genSalt: jest.fn() }), { virtual: true });
  jest.doMock('express-rate-limit', () => jest.fn(() => (_q, _s, next) => next()), { virtual: true });
  jest.doMock('@aws-sdk/client-s3', () => ({ S3Client: jest.fn(), GetObjectCommand: jest.fn() }), { virtual: true });
  jest.doMock('../../bot/shared/services/training/certificate.service', () => ({
    issueCertificate: jest.fn().mockResolvedValue({ certificate_code: 'X', already_issued: false }),
  }), { virtual: true });
  jest.doMock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }), { virtual: true });
});
afterEach(() => { delete process.env.PORTAL_ASSESSMENTS_TEST_ENABLE; jest.resetModules(); });

describe('bd-qd1p3 — the level-exam submit must not mistake two programmes for none', () => {
  it('a teacher on TWO active programmes is not told she has none', async () => {
    seed(2);
    const { payload } = await invoke({
      method: 'post', path: SUBMIT, userId: 'user-1', params: { id: '1' },
      body: { answers: [{ question_id: 201, selected_option: '1' }] },
    });
    expect(String((payload && payload.error) || '')).not.toMatch(NOT_ENROLLED);
  });

  it('a teacher on ONE programme is unaffected (regression guard)', async () => {
    seed(1);
    const { payload } = await invoke({
      method: 'post', path: SUBMIT, userId: 'user-1', params: { id: '1' },
      body: { answers: [{ question_id: 201, selected_option: '1' }] },
    });
    expect(String((payload && payload.error) || '')).not.toMatch(NOT_ENROLLED);
  });

  it('a teacher on NO programme is still refused — the check is fixed, not deleted', async () => {
    seed(0);
    const { statusCode, payload } = await invoke({
      method: 'post', path: SUBMIT, userId: 'user-1', params: { id: '1' },
      body: { answers: [{ question_id: 201, selected_option: '1' }] },
    });
    expect(statusCode).toBe(400);
    expect(String((payload && payload.error) || '')).toMatch(NOT_ENROLLED);
  });
});

describe('bd-qd1p3 — every single-row read of teacher_training_assignments is bounded', () => {
  // The defect is one read among four identical ones in this file; the other
  // three already carry .limit(1). A count guard is what stops the fourth
  // coming back, or a fifth arriving unbounded.
  it('no .maybeSingle() on teacher_training_assignments lacks a .limit()', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.join(__dirname, '../../dashboard/routes/portal.routes.js'), 'utf8');
    const offenders = [];
    const re = /from\(\s*'teacher_training_assignments'\s*\)([\s\S]{0,400}?)(maybeSingle|single)\s*\(/g;
    let m;
    while ((m = re.exec(src)) !== null) {
      if (!/\.limit\(/.test(m[1])) {
        offenders.push(src.slice(0, m.index).split('\n').length);
      }
    }
    expect(offenders).toEqual([]);
  });
});
