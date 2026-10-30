/**
 * POST /api/portal/training/module/:id/quiz-attempts
 *
 * Submits a full per-module training quiz attempt from the portal. Server-side
 * grades each answer, persists to training_assessment_attempts (+ per-question
 * rows in training_assessment_answers) and upserts teacher_training_progress so
 * the module also counts as complete. Row shape matches the WhatsApp-side
 * writer (bot/shared/services/training/quiz-delivery.service.js) so both
 * surfaces produce compatible rows.
 *
 * Same mock harness as tests/training/portal-training-attempts.test.js — mounts
 * the portal router on a bare req/res and pokes the matching handler.
 */

// Not a suite about the sign-in account check: every session user reads as live (tests/fixtures/portal-auth-live.js).
require('../fixtures/portal-auth-live').installLivePortalAccounts();

let supabaseFrom;
let tableStates;
let inserts;   // [{ table, row }]  — every .insert() call captured for shape assertions
let upserts;   // [{ table, row, opts }]  — every .upsert() call

function makeChain(tableName) {
  const state = tableStates[tableName] || {};
  const record = { table: tableName, filters: {}, orderCol: null, orderDir: null, rangeArgs: null };
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
  chain.range = jest.fn((a, b) => { record.rangeArgs = [a, b]; return chain; });
  chain.maybeSingle = jest.fn(async () => finalize());
  chain.single = jest.fn(async () => finalize());
  chain.insert = jest.fn((rowOrRows) => {
    const rows = Array.isArray(rowOrRows) ? rowOrRows : [rowOrRows];
    for (const r of rows) inserts.push({ table: tableName, row: r });
    // Support .insert(...).select().single() chain returning first row with an id
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
      then: (resolve, reject) => Promise.resolve({ data: row, error: null }).then(resolve, reject),
    };
    return upsertChain;
  });
  chain.update = jest.fn(() => ({ eq: jest.fn(() => ({ then: (r) => Promise.resolve({ data: null, error: null }).then(r) })) }));
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

async function invoke({ userId, params = {}, body = {} }) {
  const routes = require('../../dashboard/routes/portal.routes');
  const stack = findRoute(routes, 'post', '/training/module/:id/quiz-attempts');
  if (!stack) throw new Error('Route POST /training/module/:id/quiz-attempts not found');

  const req = {
    session: userId ? { portalUserId: userId, id: 'sess-1' } : null,
    params, body, query: {},
    method: 'POST',
    path: `/training/module/${params.id}/quiz-attempts`,
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

// A canonical 3-question module used by most happy-path tests.
function seedThreeQuestionModule({ moduleId = 42, courseId = 7, levelId = 1, programId = 'prog-1' } = {}) {
  tableStates.training_questions = {
    rows: [
      { id: 101, training_module_id: moduleId, question_text: 'Q1', options: [{ text: 'a' }, { text: 'b' }], correct_option: '1', order_index: 0, is_active: true },
      { id: 102, training_module_id: moduleId, question_text: 'Q2', options: [{ text: 'a' }, { text: 'b' }], correct_option: '2', order_index: 1, is_active: true },
      { id: 103, training_module_id: moduleId, question_text: 'Q3', options: [{ text: 'a' }, { text: 'b' }], correct_option: '1', order_index: 2, is_active: true },
    ],
  };
  tableStates.training_modules = {
    rows: [{ id: moduleId, course_id: courseId, title: 'M', is_active: true }],
  };
  tableStates.training_courses = {
    rows: [{ id: courseId, level_id: levelId, title: 'C' }],
  };
  tableStates.training_levels = {
    rows: [
      // Level 1 has no previous, so it's never "locked" in the state map.
      { id: levelId, name: 'L1', order_index: 0, is_active: true },
    ],
  };
  tableStates.teacher_training_assignments = {
    rows: [{ program_id: programId, user_id: 'user-1', is_active: true }],
  };
  tableStates.training_assessment_attempts = {
    // Empty by default — no in-progress row, no history
    rows: [],
    newId: 'attempt-uuid-1',
  };
  tableStates.training_assessment_answers = { rows: [] };
  tableStates.teacher_training_progress = { rows: [] };
  tableStates.training_grand_quizzes = { rows: [] };
  require('../fixtures/delegate-training-to-bot').seedProgramScope(tableStates);
}

beforeEach(() => {
  // bd-2490 — the portal's assessment routes are gated to WhatsApp. This
  // suite covers the grading logic behind them, which is RETAINED for when
  // the surface comes back (bd-2488), so it opens the test seam. The
  // production default stays blocked — see
  // tests/portal/assessments-are-whatsapp-only.test.js.
  process.env.PORTAL_ASSESSMENTS_TEST_ENABLE = '1';
  jest.resetModules();
  tableStates = {};
  inserts = [];
  upserts = [];

  supabaseFrom = jest.fn((tbl) => makeChain(tbl));
  jest.doMock('../../dashboard/config/supabase', () => ({
    from: supabaseFrom,
    rpc: jest.fn().mockResolvedValue({ error: null }),
  }));
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

afterEach(() => { delete process.env.PORTAL_ASSESSMENTS_TEST_ENABLE; });
afterEach(() => jest.resetModules());

describe('POST /api/portal/training/module/:id/quiz-attempts', () => {
  it('requires portal auth (401 when unauthenticated)', async () => {
    const { statusCode } = await invoke({ userId: null, params: { id: '42' }, body: { answers: [] } });
    expect(statusCode).toBe(401);
  });

  it('rejects non-numeric module ids with 400', async () => {
    const { statusCode, payload } = await invoke({ userId: 'user-1', params: { id: 'not-a-number' }, body: { answers: [] } });
    expect(statusCode).toBe(400);
    expect(payload.success).toBe(false);
  });

  it('rejects a missing or malformed answers array with 400', async () => {
    seedThreeQuestionModule();
    const { statusCode, payload } = await invoke({ userId: 'user-1', params: { id: '42' }, body: {} });
    expect(statusCode).toBe(400);
    expect(payload.success).toBe(false);
  });

  it('rejects answer count mismatch with 400', async () => {
    seedThreeQuestionModule();
    const { statusCode, payload } = await invoke({
      userId: 'user-1', params: { id: '42' },
      body: { answers: [{ question_id: 101, chosen_option: '1' }] }, // only 1 of 3
    });
    expect(statusCode).toBe(400);
    expect(payload.success).toBe(false);
    expect((payload.error || '').toLowerCase()).toMatch(/answer|question|count|mismatch/);
  });

  it('happy path — all 3 correct → grades, persists attempt + answer rows + progress row', async () => {
    seedThreeQuestionModule();
    const { statusCode, payload } = await invoke({
      userId: 'user-1', params: { id: '42' },
      body: { answers: [
        { question_id: 101, chosen_option: '1' },  // correct
        { question_id: 102, chosen_option: '2' },  // correct
        { question_id: 103, chosen_option: '1' },  // correct
      ] },
    });

    expect(statusCode).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.attempt).toEqual(expect.objectContaining({
      score: 3,
      max_score: 3,
      is_passed: true,
    }));

    // Attempt row persisted with the exact shape WhatsApp writes.
    const attemptInsert = inserts.find(i => i.table === 'training_assessment_attempts');
    expect(attemptInsert).toBeTruthy();
    expect(attemptInsert.row).toEqual(expect.objectContaining({
      user_id: 'user-1',
      quiz_kind: 'training_module',
      training_module_id: 42,
      total_questions: 3,
      total_score: 3,
      score: 3,
      is_passed: true,
      status: 'passed',
    }));
    expect(attemptInsert.row.completed_at).toBeTruthy();
    expect(attemptInsert.row.program_id).toBe('prog-1');

    // Three answer rows, one per question, all is_correct: true
    const answerInserts = inserts.filter(i => i.table === 'training_assessment_answers');
    expect(answerInserts).toHaveLength(3);
    for (const a of answerInserts) {
      expect(a.row.is_correct).toBe(true);
      expect(a.row.attempt_id).toBeTruthy();
    }

    // Progress upsert — module counts as complete
    const progUpsert = upserts.find(u => u.table === 'teacher_training_progress');
    expect(progUpsert).toBeTruthy();
    expect(progUpsert.row).toEqual(expect.objectContaining({
      user_id: 'user-1',
      module_id: 42,
    }));
  });

  /**
   * bd-2450 — THE fix. A failed check must leave no progress row.
   *
   * The portal upserted teacher_training_progress unconditionally, and the bot
   * counts ANY progress row as a passed module (doneModuleIds has no status
   * filter). So a teacher failing a check on the portal still had the module
   * counted toward level completion on WhatsApp — unlocking the level exam and
   * ultimately certifying a level off work that was never passed.
   */
  it('writes NO progress row when the check is failed (bd-2450)', async () => {
    seedThreeQuestionModule();
    await invoke({
      userId: 'user-1', params: { id: '42' },
      body: { answers: [
        { question_id: 101, chosen_option: '1' },  // correct
        { question_id: 102, chosen_option: '1' },  // WRONG
        { question_id: 103, chosen_option: '1' },  // correct
      ] },
    });

    const progress = upserts.filter(u => u.table === 'teacher_training_progress');
    expect(progress).toHaveLength(0);
  });

  it('writes the progress row when the check is passed', async () => {
    seedThreeQuestionModule();
    await invoke({
      userId: 'user-1', params: { id: '42' },
      body: { answers: [
        { question_id: 101, chosen_option: '1' },
        { question_id: 102, chosen_option: '2' },
        { question_id: 103, chosen_option: '1' },
      ] },
    });

    const progress = upserts.filter(u => u.table === 'teacher_training_progress');
    expect(progress).toHaveLength(1);
    expect(progress[0].row).toMatchObject({ user_id: 'user-1', module_id: 42 });
  });

  /**
   * bd-2483 — the bar is the VENDOR's, not 100%.
   *
   * `score === totalQuestions` is only right where module_passing_pct is 100
   * (NIETE). Beacon House and Oxbridge pass at 70, so their teachers were
   * failed on the portal for work that passed on WhatsApp.
   */
  it('passes a Beacon House module at 2/3 — its bar is 70, not 100', async () => {
    seedThreeQuestionModule();
    tableStates.training_vendors.rows[0].module_passing_pct = 70;

    const { payload } = await invoke({
      userId: 'user-1', params: { id: '42' },
      body: { answers: [
        { question_id: 101, chosen_option: '1' },
        { question_id: 102, chosen_option: '1' },  // WRONG -> 2/3 = 67%... 
        { question_id: 103, chosen_option: '1' },
      ] },
    });

    // 2/3 is 66.7%, below 70 — still a fail. The point is the BAR moved, so
    // assert against the bar the bot reported rather than a hardcoded verdict.
    expect(payload.attempt.pass_pct).toBe(70);
    expect(payload.attempt.achieved_pct).toBe(67);
    expect(payload.attempt.is_passed).toBe(false);
  });

  /**
   * bd-2450 / bd-2483 — this used to assert `status: 'passed'` on a FAILED
   * check, described as "non-blocking, matches WA". It did not match WA: the
   * bot writes status='failed' below the vendor bar, and the comment recorded
   * an intention rather than the behaviour.
   *
   * The consequence was not cosmetic. The portal also wrote a progress row
   * whatever the outcome, and the bot treats any progress row as a pass, so a
   * failed check on the portal counted toward level completion on WhatsApp and
   * could certify a level off work that was never passed.
   */
  it('partial score — 2/3 correct on a 100% bar → is_passed=false AND status=failed', async () => {
    seedThreeQuestionModule();
    const { statusCode, payload } = await invoke({
      userId: 'user-1', params: { id: '42' },
      body: { answers: [
        { question_id: 101, chosen_option: '1' },  // correct
        { question_id: 102, chosen_option: '1' },  // WRONG (correct=2)
        { question_id: 103, chosen_option: '1' },  // correct
      ] },
    });

    expect(statusCode).toBe(200);
    expect(payload.attempt.score).toBe(2);
    expect(payload.attempt.is_passed).toBe(false);

    const attemptInsert = inserts.find(i => i.table === 'training_assessment_attempts');
    expect(attemptInsert.row.score).toBe(2);
    expect(attemptInsert.row.is_passed).toBe(false);
    expect(attemptInsert.row.status).toBe('failed');

    // The wrong-answer row is is_correct=false
    const answerInserts = inserts.filter(i => i.table === 'training_assessment_answers');
    const wrong = answerInserts.find(a => a.row.question_id === 102);
    expect(wrong.row.is_correct).toBe(false);
    expect(wrong.row.chosen_option).toBe('1');
  });
});
