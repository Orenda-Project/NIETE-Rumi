/**
 * GET /api/portal/training/level/:id/certificate — the I-SAPS "My scores" sheet
 * for units with no quick check.
 *
 * Ten I-SAPS units have zero quick-check questions on production (I-SAPS did
 * not provide them: Units 302/303, 2206/2207, 2705, 3105, 3205, 3306, 3605,
 * 3906). A teacher completes such a unit by watching it (a
 * teacher_training_progress row; WhatsApp and the portal both write it), but
 * the sheet read only quiz attempts, so the unit showed "Not taken" for ever
 * and two teachers reported themselves blocked (ICT sheet, Middle and High TT
 * 76-77).
 *
 * The route now tells the sheet which units have a servable quick check (the
 * same stem rule as everywhere else) and which ones she has completed. This
 * drives the real route and the real rules over a mocked database.
 */

require('../fixtures/portal-auth-live').installLivePortalAccounts();

let supabaseFrom;
let tableStates;

function makeChain(tableName) {
  const state = tableStates[tableName] || {};
  const record = { filters: {} };
  const rowsNow = () => (typeof state.rows === 'function' ? state.rows(record.filters) : (state.rows || []));
  const chain = {};
  chain.select = jest.fn(() => chain);
  ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'is', 'not'].forEach((m) => {
    chain[m] = jest.fn((col, val) => { record.filters[col] = val; return chain; });
  });
  chain.in = jest.fn((col, vals) => { record.filters[col] = { in: vals }; return chain; });
  chain.order = jest.fn(() => chain);
  chain.limit = jest.fn(() => chain);
  chain.range = jest.fn(() => chain);
  chain.maybeSingle = jest.fn(async () => ({ data: rowsNow()[0] || null, error: null }));
  chain.single = jest.fn(async () => ({ data: rowsNow()[0] || null, error: null }));
  chain.then = (resolve, reject) => Promise.resolve({ data: rowsNow(), error: null }).then(resolve, reject);
  return chain;
}

function findRoute(router, method, path) {
  for (const layer of router.stack) {
    if (layer.route && layer.route.path === path && layer.route.methods[method]) {
      return layer.route.stack.map(s => s.handle);
    }
  }
  return null;
}

async function invoke({ userId, levelId }) {
  const routes = require('../../dashboard/routes/portal.routes');
  const stack = findRoute(routes, 'get', '/training/level/:id/certificate');
  if (!stack) throw new Error('Route GET /training/level/:id/certificate not found');
  const req = {
    session: { portalUserId: userId, id: 'sess-1' }, params: { id: String(levelId) }, query: {},
    method: 'GET', path: `/training/level/${levelId}/certificate`, ip: '127.0.0.1', headers: {}, get: () => undefined,
  };
  let statusCode = 200;
  let payload = null;
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

beforeEach(() => {
  jest.resetModules();
  // Level 1 (Novice), Module 3 - Classroom Management: Unit 301 has a quick
  // check; 302 and 303 have none (303 carries a blank-stem row, which serves
  // nothing and so is no check either). She passed 301 and watched 302.
  tableStates = {
    training_certificates: { rows: [] },
    training_levels: { rows: [{ id: 27, vendor_id: 'v-isaps', order_index: 1, name: 'Level 1: Novice' }] },
    training_vendors: { rows: [{ capstone_points_per_question: 10 }] },
    training_courses: { rows: [{ id: 69, title: 'Module 3 - Classroom Management', order_index: 3, level_id: 27 }] },
    training_modules: { rows: [
      { id: 453, course_id: 69, title: 'Unit 301', order_index: 1 },
      { id: 454, course_id: 69, title: 'Unit 302', order_index: 2 },
      { id: 455, course_id: 69, title: 'Unit 303', order_index: 3 },
    ] },
    training_grand_quizzes: { rows: [{ id: 41, source_quiz_id: 903, is_active: true, level_id: 27 }] },
    training_questions: { rows: [
      { id: 1, training_module_id: 453, question_text: 'What is the first step?' },
      { id: 2, training_module_id: 455, question_text: '   ' },
    ] },
    teacher_training_progress: { rows: [
      { module_id: 453, completed_at: '2026-11-01T16:13:29Z' },
      { module_id: 454, completed_at: '2026-11-01T16:12:49Z' },
    ] },
    training_assessment_attempts: { rows: (f) => (f.quiz_kind === 'training_module'
      ? [{ training_module_id: 453, score: 3, total_questions: 4, status: 'passed' }]
      : []) },
    training_assessment_answers: { rows: [] },
    app_settings: { rows: [] },
  };
  supabaseFrom = jest.fn((tbl) => makeChain(tbl));
  jest.doMock('../../dashboard/config/supabase', () => ({ from: supabaseFrom, rpc: jest.fn().mockResolvedValue({ error: null }) }));
  const { installTrainingDelegation } = require('../fixtures/delegate-training-to-bot');
  installTrainingDelegation(() => supabaseFrom);
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

describe('My scores: I-SAPS units with no quick check', () => {
  it('marks each unit with whether it has a check and whether she has done it', async () => {
    const { statusCode, payload } = await invoke({ userId: 'teacher-1', levelId: 27 });
    expect(statusCode).toBe(200);
    expect(payload.scores.modules[0].units).toEqual([
      { id: 453, title: 'Unit 301', best_pct: 75, has_check: true, done: true },
      { id: 454, title: 'Unit 302', best_pct: null, has_check: false, done: true },
      { id: 455, title: 'Unit 303', best_pct: null, has_check: false, done: false },
    ]);
  });

  it('counts the watched no-check unit among the units done (level completion unchanged)', async () => {
    const { payload } = await invoke({ userId: 'teacher-1', levelId: 27 });
    expect(payload.units_total).toBe(3);
    expect(payload.units_done).toBe(2);
  });
});
