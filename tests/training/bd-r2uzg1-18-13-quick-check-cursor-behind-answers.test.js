/**
 * bd-r2uzg1.18.13 — a portal quick check stuck for ever after one failed write.
 *
 * Checking an answer is two writes: the answer row, then the attempt's cursor
 * (current_question_index) moves on. When the database times out between them
 * (a Supabase 522, "fetch failed"), the answer is saved and the cursor is not.
 * From then on:
 *   - start (a reload, or re-opening the quick check) puts her on the next
 *     UNANSWERED question (current_index = answers saved), and
 *   - answer refused that question with 409 "Answer the questions in order",
 *     because it compared it with the stale cursor.
 * She picks an option, taps Check, and nothing moves on — on every try. On
 * production four open attempts sat in this state, each with dozens of 409s.
 *
 * The saved answers are the record; the cursor is only where WhatsApp resumes.
 * So the order rule now reads the saved answers (the next question is the
 * first one with no saved answer), and the cursor is moved forward to it —
 * never back, never by re-writing an answer that is already saved.
 *
 * Runs against the stateful in-memory Supabase, as portal-quiz-per-question does.
 */

require('../fixtures/portal-auth-live').installLivePortalAccounts();

const { createMemorySupabase } = require('../fixtures/memory-supabase');

const USER = 'user-1';
const MODULE = 42;
const ATTEMPT = '00000000-0000-4000-8000-000000000042';

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

/**
 * The next cursor move on the attempt (an update that sets current_question_index and does not
 * close the attempt) fails the way production's did: the request reaches nothing, no row changes.
 */
function failNextCursorMove() {
  const from = db.from.getMockImplementation();
  let armed = true;
  db.from.mockImplementation((table) => {
    const chain = from(table);
    if (table !== 'training_assessment_attempts') return chain;
    const update = chain.update;
    chain.update = (p) => {
      if (armed && p && 'current_question_index' in p && !('status' in p)) {
        armed = false;
        const failed = { data: null, error: { message: 'TypeError: fetch failed' } };
        const c = new Proxy({}, {
          get: (_t, k) => (k === 'then' ? (res, rej) => Promise.resolve(failed).then(res, rej) : () => c),
        });
        return c;
      }
      return update(p);
    };
    return chain;
  });
}

function seed({ attempt = null, saved = [] } = {}) {
  const ts = {
    training_modules: { rows: [{ id: MODULE, course_id: 7, title: 'Module', is_active: true, order_index: 0 }] },
    training_courses: { rows: [{ id: 7, level_id: 1, title: 'Course', order_index: 0, is_active: true }] },
    training_levels: { rows: [{ id: 1, name: 'Level', order_index: 0, is_active: true }] },
    training_questions: {
      rows: [
        { id: 101, training_module_id: MODULE, question_text: 'Q1', options: ['a', 'b', 'c'], correct_option: '2', order_index: 0, is_active: true, bloom_level: 'remember' },
        { id: 102, training_module_id: MODULE, question_text: 'Q2', options: ['x', 'y'], correct_option: '1', order_index: 1, is_active: true, bloom_level: 'understand' },
        { id: 103, training_module_id: MODULE, question_text: 'Q3', options: ['p', 'q', 'r'], correct_option: '3', order_index: 2, is_active: true, bloom_level: 'apply' },
      ],
    },
    teacher_training_assignments: { rows: [{ program_id: 'prog-1', user_id: USER, is_active: true }] },
    training_assessment_attempts: { rows: attempt ? [attempt] : [] },
    training_assessment_answers: { rows: saved },
    teacher_training_progress: { rows: [] },
    training_grand_quizzes: { rows: [] },
  };
  require('../fixtures/delegate-training-to-bot').seedProgramScope(ts);
  const plain = {};
  for (const [t, v] of Object.entries(ts)) plain[t] = v.rows || [];
  db = withUpsert(createMemorySupabase(plain, { unique: { training_assessment_answers: ['attempt_id', 'question_index'] } }));
}

/** Production's shape: answers saved for the first `answered` questions, the cursor one behind them. */
function seedStuck({ answered = 2, cursor = 1 } = {}) {
  const t = '2026-01-05T06:00:00.000Z';
  const saved = [
    { id: 'a0', attempt_id: ATTEMPT, question_index: 0, question_id: 101, chosen_option: '2', is_correct: true, answered_at: t },
    { id: 'a1', attempt_id: ATTEMPT, question_index: 1, question_id: 102, chosen_option: '2', is_correct: false, answered_at: t },
  ].slice(0, answered);
  seed({
    attempt: {
      id: ATTEMPT, user_id: USER, program_id: 'prog-1', quiz_kind: 'training_module', training_module_id: MODULE,
      level_id: 1, status: 'in_progress', current_question_index: cursor, total_questions: 3, total_score: 3,
      started_at: t, last_activity_at: t, score: null, is_passed: null, completed_at: null,
    },
    saved,
  });
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
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { delete process.env.PORTAL_ASSESSMENTS_TEST_ENABLE; jest.restoreAllMocks(); jest.resetModules(); });

function findRoute(router, path) {
  for (const layer of router.stack) {
    if (layer.route && layer.route.methods.post && layer.route.path === path) return layer.route.stack.map((s) => s.handle);
  }
  return null;
}

async function post(path, { params = {}, body = {} } = {}) {
  const routes = require('../../dashboard/routes/portal.routes');
  const stack = findRoute(routes, path);
  if (!stack) throw new Error(`Route POST ${path} not found`);
  const req = { session: { portalUserId: USER, id: 's' }, params, body, query: {}, method: 'POST', path, ip: '127.0.0.1', headers: {}, get: () => undefined };
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

const start = () => post('/training/module/:id/quiz-attempts/start', { params: { id: String(MODULE) } });
const answer = (attemptId, question_id, chosen_option) =>
  post('/training/module/:id/quiz-attempts/:attemptId/answer', { params: { id: String(MODULE), attemptId }, body: { question_id, chosen_option } });

const attempt = () => db.rows('training_assessment_attempts').find((a) => a.id === ATTEMPT) || db.rows('training_assessment_attempts')[0];
const answers = () => db.rows('training_assessment_answers');

describe('an attempt whose saved answers are ahead of its cursor (the production state)', () => {
  it('re-opening it lands on the next unanswered question and moves the cursor there', async () => {
    seedStuck();
    const { statusCode, payload } = await start();
    expect(statusCode).toBe(200);
    expect(payload.attempt.id).toBe(ATTEMPT);
    expect(payload.attempt.current_index).toBe(2);
    expect(attempt().current_question_index).toBe(2);
    expect(answers()).toHaveLength(2);
  });

  it('accepts the next unanswered question, saves it once, and finishes with the right score', async () => {
    seedStuck();
    await start();
    const { statusCode, payload } = await answer(ATTEMPT, 103, '3');
    expect(statusCode).toBe(200);
    expect(payload.is_correct).toBe(true);
    // Every answer once — the two saved before the failure are untouched.
    expect(answers().map((r) => [r.question_index, r.chosen_option, r.is_correct])).toEqual([
      [0, '2', true], [1, '2', false], [2, '3', true],
    ]);
    // The last answer closed the attempt with the bot's mark: Q1 right, Q2 wrong, Q3 right.
    expect(payload.result.attempt).toEqual(expect.objectContaining({ id: ATTEMPT, score: 2, max_score: 3 }));
    expect(attempt()).toEqual(expect.objectContaining({ status: 'failed', score: 2, current_question_index: 3 }));
  });

  it('even without a reload first (her screen was already on the next question)', async () => {
    seedStuck();
    const { statusCode } = await answer(ATTEMPT, 103, '3');
    expect(statusCode).toBe(200);
    expect(answers()).toHaveLength(3);
  });

  it('a second answer to the question saved before the failure is still refused, and the first stands', async () => {
    seedStuck();
    const { statusCode, payload } = await answer(ATTEMPT, 102, '1');
    expect(statusCode).toBe(409);
    expect(payload).toEqual(expect.objectContaining({ already_answered: true, chosen_option: '2', is_correct: false }));
    expect(answers().find((r) => r.question_index === 1)).toEqual(expect.objectContaining({ chosen_option: '2', is_correct: false }));
  });

  it('a question past the next unanswered one is still refused (no skipping ahead)', async () => {
    seedStuck({ answered: 1, cursor: 0 });
    const { statusCode, payload } = await answer(ATTEMPT, 103, '3');
    expect(statusCode).toBe(409);
    expect(payload.current_index).toBe(1);
    expect(answers()).toHaveLength(1);
  });
});

describe('the failure itself, end to end', () => {
  it('a cursor move that times out after the answer is saved no longer strands the quiz', async () => {
    seed();
    const opened = (await start()).payload;
    expect((await answer(opened.attempt.id, 101, '2')).statusCode).toBe(200);

    failNextCursorMove();
    const hit = await answer(opened.attempt.id, 102, '1');
    // The answer was saved; she is told her verdict rather than "not sent".
    expect(hit.statusCode).toBe(200);
    expect(hit.payload.is_correct).toBe(true);
    expect(attempt().current_question_index).toBe(1); // the move really failed

    // She carries on: the next question is accepted and the cursor catches up.
    const next = await answer(opened.attempt.id, 103, '3');
    expect(next.statusCode).toBe(200);
    expect(next.payload.result.attempt).toEqual(expect.objectContaining({ score: 3, max_score: 3, is_passed: true }));
    expect(answers()).toHaveLength(3);
    expect(attempt()).toEqual(expect.objectContaining({ status: 'passed', current_question_index: 3 }));
  });
});
