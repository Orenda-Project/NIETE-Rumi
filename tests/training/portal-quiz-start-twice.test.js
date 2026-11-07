/**
 * bd-gipj44 / bd-hz6ez.8 — "start quiz" is safe to call twice, and never trips
 * on an old open attempt.
 *
 *   POST /training/module/:id/quiz-attempts/start
 *
 * The database allows ONE open module attempt per teacher per module
 * (ux_taa_one_active_per_module: user_id + training_module_id, WHERE
 * status = 'in_progress' AND quiz_kind = 'training_module'). The start read only
 * her NEWEST attempt and inserted otherwise, so on NIETE production it answered
 * 500 ("We could not load this quiz") in two cases, 618 times in 31 days:
 *
 *   1. a double start — the same phone sends two starts ~380 ms apart; both read
 *      "nothing open", both insert, the second hits the index;
 *   2. a stuck pair — an old open attempt (Jul–Oct) under a newer CLOSED one
 *      (the all-at-once submit writes a closed row without closing the open
 *      one). The newest row is closed, so every start inserts and fails, every
 *      time: 13 teachers could not pass that module at all.
 *
 * Decisions held here:
 *   - a start resumes or opens EXACTLY one attempt, and never answers 500 for
 *     either case;
 *   - two parallel starts give the same attempt and the same paper;
 *   - an open attempt with a newer finished one above it is stale: it is closed
 *     as 'abandoned' and a fresh attempt opens (a months-old paper is not
 *     resumed — operator's call, 7 Nov: abandon-and-fresh);
 *   - her open attempt that IS her newest is resumed, as before;
 *   - any other insert error still fails cleanly — and is now logged to Axiom
 *     (the portal telemetry sink) with its pg code and a correlation id, where
 *     before it reached only the Railway console.
 */

require('../fixtures/portal-auth-live').installLivePortalAccounts();

const { createMemorySupabase } = require('../fixtures/memory-supabase');

const USER = 'user-1';
const MODULE = 42;
const ONE_OPEN_PER_MODULE = {
  keys: ['user_id', 'training_module_id'],
  where: (r) => r.status === 'in_progress' && r.quiz_kind === 'training_module',
};

let db;
let telemetry;
let failInsert = null;

function seed(attemptRows = []) {
  const ts = {
    training_modules: { rows: [{ id: MODULE, course_id: 7, title: 'Restorative Practices', is_active: true, order_index: 0 }] },
    training_courses: { rows: [{ id: 7, level_id: 1, title: 'Course', order_index: 0, is_active: true }] },
    training_levels: { rows: [{ id: 1, name: 'Skilled Practitioner', order_index: 0, is_active: true }] },
    training_questions: {
      rows: [
        { id: 101, training_module_id: MODULE, question_text: 'Q1', options: ['a', 'b', 'c'], correct_option: '2', order_index: 0, is_active: true, bloom_level: 'remember' },
        { id: 102, training_module_id: MODULE, question_text: 'Q2', options: ['x', 'y'], correct_option: '1', order_index: 1, is_active: true, bloom_level: 'understand' },
        { id: 103, training_module_id: MODULE, question_text: 'Q3', options: ['p', 'q', 'r'], correct_option: '3', order_index: 2, is_active: true, bloom_level: 'apply' },
      ],
    },
    teacher_training_assignments: { rows: [{ program_id: 'prog-1', user_id: USER, is_active: true }] },
    training_assessment_attempts: { rows: attemptRows },
    training_assessment_answers: { rows: [] },
    teacher_training_progress: { rows: [] },
    training_grand_quizzes: { rows: [] },
  };
  require('../fixtures/delegate-training-to-bot').seedProgramScope(ts);
  const plain = {};
  for (const [t, v] of Object.entries(ts)) plain[t] = v.rows || [];
  db = createMemorySupabase(plain, {
    unique: { training_assessment_answers: ['attempt_id', 'question_index'], training_assessment_attempts: ONE_OPEN_PER_MODULE },
  });
  // A forced insert failure that is NOT the one-open rule (a NOT NULL, say).
  const from = db.from.getMockImplementation();
  db.from.mockImplementation((table) => {
    const chain = from(table);
    if (table === 'training_assessment_attempts' && failInsert) {
      chain.insert = () => {
        const err = { data: null, error: failInsert };
        const c = { select: () => c, single: async () => err, then: (res, rej) => Promise.resolve(err).then(res, rej) };
        return c;
      };
    }
    return chain;
  });
}

beforeEach(() => {
  failInsert = null;
  process.env.PORTAL_ASSESSMENTS_TEST_ENABLE = '1';
  jest.resetModules();
  jest.doMock('../../dashboard/config/supabase', () => ({ from: (...a) => db.from(...a), rpc: jest.fn().mockResolvedValue({ error: null }) }));
  const { installTrainingDelegation } = require('../fixtures/delegate-training-to-bot');
  installTrainingDelegation(() => (...a) => db.from(...a));
  telemetry = { logEvent: jest.fn(), flush: jest.fn(), isEnabled: () => true };
  jest.doMock('../../dashboard/services/telemetry.service', () => telemetry);
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
afterEach(() => {
  delete process.env.PORTAL_ASSESSMENTS_TEST_ENABLE;
  jest.restoreAllMocks();
  jest.resetModules();
});

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
  const req = { session: { portalUserId: userId, id: 's' }, params, body, query: {}, method: 'POST', path, ip: '127.0.0.1', headers: {}, get: () => undefined };
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
const start = () => post(START, { params: { id: String(MODULE) } });
const answer = (attemptId, question_id, chosen_option) =>
  post(ANSWER, { params: { id: String(MODULE), attemptId }, body: { question_id, chosen_option } });

const attempts = () => db.rows('training_assessment_attempts');
const open = () => attempts().filter((a) => a.status === 'in_progress');

const attemptRow = (over) => ({
  user_id: USER, program_id: 'prog-1', quiz_kind: 'training_module', training_module_id: MODULE, level_id: 1,
  current_question_index: 0, total_questions: 3, total_score: 3, ...over,
});

describe('two starts at once (the double start)', () => {
  it('both answer 200 with the SAME attempt and the same paper, and one row is open', async () => {
    seed();
    const [a, b] = await Promise.all([start(), start()]);
    expect([a.statusCode, b.statusCode]).toEqual([200, 200]);
    expect(a.payload.attempt.id).toBe(b.payload.attempt.id);
    expect(b.payload.questions.map((q) => q.id)).toEqual(a.payload.questions.map((q) => q.id));
    expect(attempts()).toHaveLength(1);
    expect(open()).toHaveLength(1);
    expect(open()[0].id).toBe(a.payload.attempt.id);
  });

  it('the race is logged as a resume, not an error', async () => {
    seed();
    await Promise.all([start(), start()]);
    const events = telemetry.logEvent.mock.calls.map((c) => c[0]);
    expect(events).toContain('training_quiz_start_raced');
    expect(events).not.toContain('training_quiz_attempt_error');
  });
});

describe('an old open attempt under a newer finished one (the stuck pair)', () => {
  const OLD = 'att-old-open';
  const NEWER = 'att-newer-closed';
  const stuck = () => seed([
    attemptRow({ id: OLD, status: 'in_progress', current_question_index: 1, started_at: '2026-08-06T09:00:00Z' }),
    // Written closed in one shot by the all-at-once submit: started_at = completed_at.
    attemptRow({ id: NEWER, status: 'failed', score: 1, is_passed: false, started_at: '2026-10-20T18:00:00Z', completed_at: '2026-10-20T18:00:00Z' }),
  ]);

  it('opens a FRESH attempt (200), and the old open one reads abandoned', async () => {
    stuck();
    const { statusCode, payload } = await start();
    expect(statusCode).toBe(200);
    expect(payload.attempt.id).not.toBe(OLD);
    expect(payload.attempt.id).not.toBe(NEWER);
    expect(payload.attempt.current_index).toBe(0);
    expect(payload.answered).toEqual([]);
    expect(attempts().find((a) => a.id === OLD).status).toBe('abandoned');
    expect(attempts().find((a) => a.id === NEWER).status).toBe('failed');
    expect(open().map((a) => a.id)).toEqual([payload.attempt.id]);
  });

  it('the fresh attempt is playable: an answer on it is saved', async () => {
    stuck();
    const { payload } = await start();
    const first = payload.questions[0].id;
    const r = await answer(payload.attempt.id, first, '1');
    expect(r.statusCode).toBe(200);
  });

  it('says what it abandoned, on Axiom', async () => {
    stuck();
    await start();
    expect(telemetry.logEvent).toHaveBeenCalledWith('training_quiz_attempt_abandoned', expect.objectContaining({
      attempt_uuid: OLD, newer_attempt_uuid: NEWER, module_row_id: MODULE, surface: 'portal',
    }));
  });

  it('a second start then resumes the fresh one (no third row)', async () => {
    stuck();
    const first = (await start()).payload;
    const again = (await start()).payload;
    expect(again.attempt.id).toBe(first.attempt.id);
    expect(attempts()).toHaveLength(3);
  });
});

describe('her open attempt that is her newest', () => {
  it('is resumed, as before, with nothing abandoned', async () => {
    seed([
      attemptRow({ id: 'att-closed', status: 'passed', is_passed: true, started_at: '2026-09-01T09:00:00Z', completed_at: '2026-09-01T09:05:00Z' }),
      attemptRow({ id: 'att-open', status: 'in_progress', started_at: '2026-11-01T09:00:00Z' }),
    ]);
    const { statusCode, payload } = await start();
    expect(statusCode).toBe(200);
    expect(payload.attempt.id).toBe('att-open');
    expect(attempts()).toHaveLength(2);
    expect(attempts().every((a) => a.status !== 'abandoned')).toBe(true);
  });
});

describe('any other insert error', () => {
  it('still fails cleanly (500), writes nothing, and reaches Axiom with its pg code and a correlation id', async () => {
    seed();
    failInsert = { code: '23502', message: 'null value in column "program_id" violates not-null constraint' };
    const { statusCode, payload } = await start();
    expect(statusCode).toBe(500);
    expect(payload).toEqual(expect.objectContaining({ success: false, error: 'Failed to start the quiz' }));
    expect(attempts()).toHaveLength(0);
    expect(telemetry.logEvent).toHaveBeenCalledWith('training_quiz_attempt_error', expect.objectContaining({
      step: 'start', pg_code: '23502', user_uuid: USER, module_row_id: MODULE, correlation_id: expect.any(String),
    }));
    expect(payload.correlation_id).toBe(telemetry.logEvent.mock.calls.find((c) => c[0] === 'training_quiz_attempt_error')[1].correlation_id);
  });
});
