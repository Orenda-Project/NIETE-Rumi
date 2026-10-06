/**
 * bd-klecr.6 — the portal module quiz, one question at a time, with a verdict
 * after each answer (operator, 2026-10-06).
 *
 *   POST /training/module/:id/quiz-attempts/start
 *   POST /training/module/:id/quiz-attempts/:attemptId/answer
 *   POST /training/module/:id/quiz-attempts/:attemptId/finish
 *
 * Decisions this suite holds the routes to:
 *   - every answer is SAVED as it is checked (training_assessment_answers), and
 *     the attempt row moves on (current_question_index), the way WhatsApp's
 *     handleQuizButton writes it — so a quiz left halfway is resumable on either
 *     surface;
 *   - a checked answer is FINAL for that attempt: a second answer to the same
 *     question is refused with the stored verdict, reload or not;
 *   - the verdict is right / wrong only: the answer key never leaves the server;
 *   - the bot marks (markPaper) and passes (getModuleQuizVerdict); the paper is
 *     the bot's served paper for this attempt (servePaper), so WhatsApp resuming
 *     the attempt sees the same questions in the same order;
 *   - the result is saved when the LAST answer is checked, even if she never
 *     taps Submit; finish is idempotent and returns the stored result.
 *
 * Runs against the stateful in-memory Supabase, so each test reads back the
 * rows a real database would hold after the flow.
 */

const { createMemorySupabase } = require('../fixtures/memory-supabase');

const USER = 'user-1';
const OTHER = 'user-2';
const MODULE = 42;

let db;

/** The memory fake has no upsert; teacher_training_progress needs one (unique user_id+module_id). */
function withUpsert(fake) {
  const from = fake.from.getMockImplementation();
  fake.from.mockImplementation((table) => {
    const chain = from(table);
    chain.upsert = (row, opts) => {
      const keys = String((opts && opts.onConflict) || 'id').split(',').map((k) => k.trim());
      const rows = fake.tables[table] || (fake.tables[table] = []);
      const hit = rows.find((r) => keys.every((k) => r[k] === row[k]));
      if (hit) Object.assign(hit, row); else rows.push({ id: `${table}-up-${rows.length + 1}`, ...row });
      const out = { data: [row], error: null };
      const c = { select: () => c, single: async () => ({ data: row, error: null }), then: (res, rej) => Promise.resolve(out).then(res, rej) };
      return c;
    };
    return chain;
  });
  return fake;
}

function seed({ moduleQuizStrategy = null, sameBloom = false } = {}) {
  const ts = {
    training_modules: { rows: [{ id: MODULE, course_id: 7, title: 'Restorative Practices', is_active: true, order_index: 0 }] },
    training_courses: { rows: [{ id: 7, level_id: 1, title: 'Course', order_index: 0, is_active: true }] },
    training_levels: { rows: [{ id: 1, name: 'Skilled Practitioner', order_index: 0, is_active: true }] },
    training_questions: {
      rows: [
        { id: 101, training_module_id: MODULE, question_text: 'Q1', options: ['a', 'b', 'c'], correct_option: '2', order_index: 0, is_active: true, bloom_level: 'remember' },
        { id: 102, training_module_id: MODULE, question_text: 'Q2', options: [{ text: 'x' }, { text: 'y' }], correct_option: '1', order_index: 1, is_active: true, bloom_level: 'understand' },
        { id: 103, training_module_id: MODULE, question_text: 'Q3', options: ['p', 'q', 'r'], correct_option: '1,3', order_index: 2, is_active: true, bloom_level: 'apply' },
      ],
    },
    teacher_training_assignments: { rows: [{ program_id: 'prog-1', user_id: USER, is_active: true }, { program_id: 'prog-1', user_id: OTHER, is_active: true }] },
    training_assessment_attempts: { rows: [] },
    training_assessment_answers: { rows: [] },
    teacher_training_progress: { rows: [] },
    training_grand_quizzes: { rows: [] },
  };
  if (sameBloom) for (const q of ts.training_questions.rows) q.bloom_level = 'remember';
  require('../fixtures/delegate-training-to-bot').seedProgramScope(ts);
  if (moduleQuizStrategy) for (const v of ts.training_vendors.rows) v.module_quiz_strategy = moduleQuizStrategy;
  const plain = {};
  for (const [t, v] of Object.entries(ts)) plain[t] = v.rows || [];
  db = withUpsert(createMemorySupabase(plain, { unique: { training_assessment_answers: ['attempt_id', 'question_index'] } }));
}

beforeEach(() => {
  process.env.PORTAL_ASSESSMENTS_TEST_ENABLE = '1';
  jest.resetModules();
  jest.doMock('../../dashboard/config/supabase', () => ({ from: (...a) => db.from(...a), rpc: jest.fn().mockResolvedValue({ error: null }) }));
  const { installTrainingDelegation } = require('../fixtures/delegate-training-to-bot');
  installTrainingDelegation(() => (...a) => db.from(...a));
  jest.doMock('../../dashboard/services/r2.service', () => ({
    generatePresignedUrl: jest.fn().mockResolvedValue(null),
    generatePresignedUrls: jest.fn().mockResolvedValue([]),
    isValidR2Url: jest.fn().mockReturnValue(true),
  }));
  jest.doMock('bcryptjs', () => ({ hash: jest.fn(), compare: jest.fn(), genSalt: jest.fn() }), { virtual: true });
  jest.doMock('express-rate-limit', () => jest.fn(() => (_q, _s, next) => next()), { virtual: true });
  jest.doMock('@aws-sdk/client-s3', () => ({ S3Client: jest.fn(), GetObjectCommand: jest.fn() }), { virtual: true });
});
afterEach(() => { delete process.env.PORTAL_ASSESSMENTS_TEST_ENABLE; jest.resetModules(); });

function findRoute(router, path) {
  for (const layer of router.stack) {
    if (layer.route && layer.route.methods.post && layer.route.path === path) return layer.route.stack.map((s) => s.handle);
  }
  return null;
}

async function post(path, { userId = USER, params = {}, body = {} } = {}) {
  const routes = require('../../dashboard/routes/portal.routes');
  const stack = findRoute(routes, path);
  if (!stack) throw new Error(`Route POST ${path} not found`);
  const req = { session: userId ? { portalUserId: userId, id: 's' } : null, params, body, query: {}, method: 'POST', path, ip: '127.0.0.1', headers: {}, get: () => undefined };
  let statusCode = 200;
  let payload = null;
  const res = { status(c) { statusCode = c; return this; }, json(b) { payload = b; return this; } };
  for (const h of stack) {
    let next = false;
    // eslint-disable-next-line no-await-in-loop
    await h(req, res, () => { next = true; });
    if (!next) break;
  }
  return { statusCode, payload };
}

const START = '/training/module/:id/quiz-attempts/start';
const ANSWER = '/training/module/:id/quiz-attempts/:attemptId/answer';
const FINISH = '/training/module/:id/quiz-attempts/:attemptId/finish';

const start = (userId = USER) => post(START, { userId, params: { id: String(MODULE) } });
const answer = (attemptId, question_id, chosen_option, userId = USER) =>
  post(ANSWER, { userId, params: { id: String(MODULE), attemptId }, body: { question_id, chosen_option } });
const finish = (attemptId, userId = USER) => post(FINISH, { userId, params: { id: String(MODULE), attemptId } });

const attempts = () => db.rows('training_assessment_attempts');
const answers = () => db.rows('training_assessment_answers');
const progress = () => db.rows('teacher_training_progress');

describe('start', () => {
  it('requires a portal session', async () => {
    seed();
    expect((await start(null)).statusCode).toBe(401);
  });

  it('opens an in-progress attempt and serves the paper without the answer key', async () => {
    seed();
    const { statusCode, payload } = await start();
    expect(statusCode).toBe(200);
    expect(attempts()).toHaveLength(1);
    expect(attempts()[0]).toEqual(expect.objectContaining({
      id: payload.attempt.id, user_id: USER, program_id: 'prog-1', quiz_kind: 'training_module',
      training_module_id: MODULE, level_id: 1, status: 'in_progress', current_question_index: 0,
      total_questions: 3, total_score: 3,
    }));
    expect(payload.questions.map((q) => q.id)).toEqual([101, 102, 103]);
    expect(payload.questions[1].options).toEqual([{ value: '1', text: 'x' }, { value: '2', text: 'y' }]);
    expect(payload.questions[2].multi).toBe(true);
    expect(JSON.stringify(payload)).not.toMatch(/correct_option/);
    expect(payload.answered).toEqual([]);
  });

  it('serves the bot\'s paper for this attempt (one_per_bloom → one per Bloom level)', async () => {
    seed({ moduleQuizStrategy: 'one_per_bloom', sameBloom: true });
    const { payload } = await start();
    // Exactly the bot's own pick for this attempt id — and fewer than the bank.
    const Serving = require('../../bot/shared/services/training/quiz-serving.service');
    const bank = db.rows('training_questions');
    const botPick = Serving.selectServedQuestions(bank, {
      attemptId: payload.attempt.id, isModuleQuiz: true,
      config: Serving.normalizeServingConfig({ module_quiz_strategy: 'one_per_bloom' }),
    }).map((q) => q.id);
    expect(payload.questions.map((q) => q.id)).toEqual(botPick);
    expect(botPick.length).toBeLessThan(bank.length);
    expect(payload.attempt.total_questions).toBe(botPick.length);
    expect(attempts()[0].total_questions).toBe(payload.questions.length);
  });

  it('resumes her open attempt after a reload, with what she already answered', async () => {
    seed();
    const first = (await start()).payload;
    await answer(first.attempt.id, 101, '3');
    const again = (await start()).payload;
    expect(again.attempt.id).toBe(first.attempt.id);
    expect(attempts()).toHaveLength(1);
    expect(again.answered).toEqual([{ question_id: 101, chosen_option: '3', is_correct: false }]);
    expect(again.attempt.current_index).toBe(1);
  });
});

describe('answer', () => {
  it('saves a right answer and says so', async () => {
    seed();
    const { attempt } = (await start()).payload;
    const { statusCode, payload } = await answer(attempt.id, 101, '2');
    expect(statusCode).toBe(200);
    expect(payload.is_correct).toBe(true);
    expect(answers()).toEqual([expect.objectContaining({ attempt_id: attempt.id, question_index: 0, question_id: 101, chosen_option: '2', is_correct: true })]);
    expect(attempts()[0]).toEqual(expect.objectContaining({ current_question_index: 1, status: 'in_progress' }));
  });

  it('saves a wrong answer, says wrong, and does not reveal the right one', async () => {
    seed();
    const { attempt } = (await start()).payload;
    const { payload } = await answer(attempt.id, 101, '1');
    expect(payload.is_correct).toBe(false);
    expect(JSON.stringify(payload)).not.toMatch(/correct_option|"2"/);
    expect(answers()[0]).toEqual(expect.objectContaining({ chosen_option: '1', is_correct: false }));
  });

  it('marks a pick-all question by its whole set', async () => {
    seed();
    const { attempt } = (await start()).payload;
    await answer(attempt.id, 101, '2');
    await answer(attempt.id, 102, '1');
    expect((await answer(attempt.id, 103, '3,1')).payload.is_correct).toBe(true);
  });

  it('refuses a second answer to a checked question and keeps the first', async () => {
    seed();
    const { attempt } = (await start()).payload;
    await answer(attempt.id, 101, '1');
    const { statusCode, payload } = await answer(attempt.id, 101, '2');
    expect(statusCode).toBe(409);
    expect(payload).toEqual(expect.objectContaining({ already_answered: true, is_correct: false, chosen_option: '1' }));
    expect(answers()).toHaveLength(1);
    expect(attempts()[0].current_question_index).toBe(1);
  });

  it('refuses answers out of order', async () => {
    seed();
    const { attempt } = (await start()).payload;
    const { statusCode } = await answer(attempt.id, 102, '1');
    expect(statusCode).toBe(409);
    expect(answers()).toHaveLength(0);
  });

  it('refuses another teacher\'s attempt', async () => {
    seed();
    const { attempt } = (await start()).payload;
    const { statusCode } = await answer(attempt.id, 101, '2', OTHER);
    expect(statusCode).toBe(404);
    expect(answers()).toHaveLength(0);
  });

  it('refuses an empty answer', async () => {
    seed();
    const { attempt } = (await start()).payload;
    expect((await answer(attempt.id, 101, '')).statusCode).toBe(400);
  });
});

describe('the result is saved', () => {
  it('on the last answer: a pass closes the attempt and completes the module', async () => {
    seed();
    const { attempt } = (await start()).payload;
    await answer(attempt.id, 101, '2');
    await answer(attempt.id, 102, '1');
    const last = (await answer(attempt.id, 103, '1,3')).payload;
    expect(last.result.attempt).toEqual(expect.objectContaining({ id: attempt.id, score: 3, max_score: 3, is_passed: true }));
    expect(last.result.results).toEqual([
      { question_id: 101, question_index: 0, is_correct: true },
      { question_id: 102, question_index: 1, is_correct: true },
      { question_id: 103, question_index: 2, is_correct: true },
    ]);
    expect(attempts()[0]).toEqual(expect.objectContaining({
      status: 'passed', is_passed: true, score: 3, current_question_index: 3,
    }));
    expect(attempts()[0].completed_at).toBeTruthy();
    expect(progress()).toEqual([expect.objectContaining({ user_id: USER, module_id: MODULE })]);
  });

  it('a fail closes the attempt as failed and writes no progress', async () => {
    seed();
    const { attempt } = (await start()).payload;
    await answer(attempt.id, 101, '1');
    await answer(attempt.id, 102, '1');
    const last = (await answer(attempt.id, 103, '1,3')).payload;
    expect(last.result.attempt).toEqual(expect.objectContaining({ score: 2, max_score: 3, is_passed: false }));
    expect(attempts()[0]).toEqual(expect.objectContaining({ status: 'failed', is_passed: false, score: 2 }));
    expect(progress()).toHaveLength(0);
  });

  it('finish returns the stored result again, and writes nothing twice', async () => {
    seed();
    const { attempt } = (await start()).payload;
    await answer(attempt.id, 101, '2');
    await answer(attempt.id, 102, '1');
    await answer(attempt.id, 103, '1,3');
    const { statusCode, payload } = await finish(attempt.id);
    expect(statusCode).toBe(200);
    expect(payload.attempt).toEqual(expect.objectContaining({ score: 3, max_score: 3, is_passed: true }));
    expect(payload.results).toHaveLength(3);
    expect(attempts()).toHaveLength(1);
    expect(answers()).toHaveLength(3);
    expect(progress()).toHaveLength(1);
  });

  it('finish refuses while questions are unanswered', async () => {
    seed();
    const { attempt } = (await start()).payload;
    await answer(attempt.id, 101, '2');
    const { statusCode } = await finish(attempt.id);
    expect(statusCode).toBe(409);
    expect(attempts()[0].status).toBe('in_progress');
  });

  it('a retake after a finished attempt opens a NEW attempt', async () => {
    seed();
    const { attempt } = (await start()).payload;
    await answer(attempt.id, 101, '1');
    await answer(attempt.id, 102, '1');
    await answer(attempt.id, 103, '1');
    const again = (await start()).payload;
    expect(again.attempt.id).not.toBe(attempt.id);
    expect(again.answered).toEqual([]);
    expect(attempts()).toHaveLength(2);
  });
});
