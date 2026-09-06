'use strict';
/**
 * THE SESSION COUNTERS ARE THE ANSWERS TABLE, NOT A CACHE.
 *
 * A live staging run stored eight rows in `quiz_answers`, one per question, no
 * duplicates — while `quiz_sessions.total_questions_answered` sat at five. No
 * error, no warning, no deploy in the window. The child's scorecard and the
 * teacher's roster are built from those columns.
 *
 * ONE ROOT CAUSE: the counters were derived from `state`, a best-effort Redis
 * blob, instead of from the durable record the same function had just written
 * to. That cache can lose an update through at least two doors, and NEITHER
 * raises anything a caller can see:
 *
 *   1. `redisService.set()` returns `false` on any Redis failure and logs it as
 *      a warning (railway-redis.service.js `async set`). Nothing in this file
 *      checks the return value, so a dropped write leaves `state.answered`
 *      behind and every later answer counts up from the stale number.
 *   2. The read→write window in `handleAnswer` spans the ENTIRE answer-phase
 *      send — verdict text, explanation image, explanation audio, each behind a
 *      rate-limiter throttle and a 700–1200 ms gap. Two calls overlapping in
 *      that window both read `answered = n` and both write `n + 1`.
 *
 * The fix removes the dependency rather than patching either door: the counters
 * are computed from `quiz_answers` (the row this call has just inserted) and the
 * update is guarded so a stale-lower value can never overwrite a higher one.
 * `truthFromAnswers` already did exactly this for `finish()` and
 * `reconcileFromAnswers()` — the per-answer write was the one place still
 * trusting the cache.
 *
 * RUN: cd bot && NODE_OPTIONS=--no-experimental-webstorage npx jest --config jest.config.js tests/quiz/video-quiz-counter-drift.test.js
 */
jest.mock('../../shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../shared/services/cache/railway-redis.service', () => ({
  get: jest.fn(), set: jest.fn(), delete: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../shared/services/quiz/video-quiz-sender.service', () => ({
  sendPhase: jest.fn().mockResolvedValue({ pickerFailed: false }),
}));
jest.mock('../../shared/services/quiz/video-quiz-scorecard.service', () => ({
  sendScorecard: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const supabase = require('../../shared/config/supabase');
const redis = require('../../shared/services/cache/railway-redis.service');
const sender = require('../../shared/services/quiz/video-quiz-sender.service');
const VideoQuiz = require('../../shared/services/quiz/video-quiz.service');

const PHONE = '923000000000';
const SESSION = 'sess-1';

const QUESTIONS = [0, 1, 2, 3].map((n) => ({
  id: `q-${n}`, external_id: `tq:quiz1:S1:${n}`, sort_order: n,
  question_text: `Q${n}?`, option_a: 'a', option_b: 'b', option_c: 'c', option_d: null,
  correct_option: 'A', explanation: '', option_feedback: null,
  media: {}, render_pattern: 'P1',
}));

/**
 * A stand-in for the two stores this path touches. `answers` is durable (rows
 * only ever accumulate); `sessionRow` is what the scorecard and the report read.
 */
function stubStores() {
  const store = {
    answers: [],
    sessionRow: { id: SESSION, total_questions_answered: 0, correct_answers: 0 },
    counterWrites: [],
  };

  supabase.from.mockImplementation((table) => {
    if (table === 'quiz_questions') {
      let wanted = null;
      const chain = {
        select: () => chain,
        eq: (_c, v) => { wanted = v; return chain; },
        order: () => chain,
        single: async () => ({ data: QUESTIONS.find((q) => q.id === wanted) || null, error: null }),
        then: (res) => res({ data: QUESTIONS, error: null }),
      };
      return chain;
    }
    if (table === 'quiz_answers') {
      const chain = {
        insert: async (row) => {
          if (store.answers.some((a) => a.question_id === row.question_id)) {
            return { error: { code: '23505', message: 'duplicate key' } };
          }
          store.answers.push(row);
          return { error: null };
        },
        select: () => chain,
        eq: async () => ({ data: store.answers.map((a) => ({
          question_id: a.question_id, is_correct: a.is_correct,
        })), error: null }),
      };
      return chain;
    }
    if (table === 'quiz_sessions') {
      let patch = null;
      let guard = null;
      const chain = {
        update: (p) => { patch = p; return chain; },
        eq: (_c, _v) => chain,
        // `.or('col.is.null,col.lte.N')` — the same PostgREST filter the client
        // builds, applied here the way Postgres would: NULL passes, a stored
        // value above N does not.
        or: (expr) => {
          const m = /^(\w+)\.is\.null,\1\.lte\.(\d+)$/.exec(expr);
          if (!m) throw new Error(`unexpected guard: ${expr}`);
          guard = { col: m[1], val: Number(m[2]) };
          return chain;
        },
        select: () => chain,
        single: async () => ({ data: { id: SESSION }, error: null }),
        maybeSingle: async () => ({ data: store.sessionRow, error: null }),
        // The update resolves when awaited — that is when the guard is applied.
        then: (res) => {
          const stored = guard ? store.sessionRow[guard.col] : undefined;
          const applied = !guard || stored == null || stored <= guard.val;
          if (applied && patch) {
            store.counterWrites.push({ ...patch });
            Object.assign(store.sessionRow, patch);
          }
          return res({ data: null, error: null });
        },
      };
      return chain;
    }
    const chain = {
      select: () => chain, eq: () => chain, insert: () => chain, update: () => chain,
      single: async () => ({ data: null, error: null }),
      maybeSingle: async () => ({ data: null, error: null }),
      then: (res) => res({ data: null, error: null }),
    };
    return chain;
  });
  return store;
}

/** The Redis blob, with a switch to make writes vanish the way a real one can. */
function stubRedis({ dropWritesFrom = Infinity } = {}) {
  const box = { value: null, writes: 0 };
  redis.get.mockImplementation(async () => (box.value ? JSON.parse(JSON.stringify(box.value)) : null));
  redis.set.mockImplementation(async (_k, v) => {
    box.writes += 1;
    if (box.writes >= dropWritesFrom) return false;   // exactly what the real one returns
    box.value = JSON.parse(JSON.stringify(v));
    return true;
  });
  return box;
}

const baseState = () => ({
  sessionId: SESSION, quizId: 'quiz1', videoId: null, userId: null, language: 'en',
  source: 'share_link', questionIds: QUESTIONS.map((q) => q.id),
  index: 0, correct: 0, answered: 0, currentQuestionId: null, sentAt: Date.now(),
});

beforeEach(() => { jest.clearAllMocks(); });

describe('a lost cache update never costs the session an answer', () => {
  test('a dropped Redis write does not stall the counter', async () => {
    const store = stubStores();
    const box = stubRedis({ dropWritesFrom: 2 });   // the first write lands, the rest vanish
    box.value = baseState();

    await VideoQuiz.handleAnswer(PHONE, 'vq_q-0_0');
    await VideoQuiz.handleAnswer(PHONE, 'vq_q-1_0');
    await VideoQuiz.handleAnswer(PHONE, 'vq_q-2_0');

    expect(store.answers).toHaveLength(3);
    expect(store.sessionRow.total_questions_answered).toBe(3);
    expect(store.sessionRow.correct_answers).toBe(3);
  });

  test('two answers racing in the send window both count', async () => {
    const store = stubStores();
    const box = stubRedis();
    box.value = baseState();

    // Hold the answer-phase send open, which is where the read→write window is.
    let release;
    const held = new Promise((r) => { release = r; });
    let held0 = false;
    sender.sendPhase.mockImplementation(async (_p, _m, phase) => {
      if (phase === 'answer' && !held0) { held0 = true; await held; }
      return { pickerFailed: false };
    });

    const first = VideoQuiz.handleAnswer(PHONE, 'vq_q-0_0');
    await new Promise((r) => setImmediate(r));
    const second = VideoQuiz.handleAnswer(PHONE, 'vq_q-1_0');
    await new Promise((r) => setImmediate(r));
    release();
    await Promise.all([first, second]);

    expect(store.answers).toHaveLength(2);
    expect(store.sessionRow.total_questions_answered).toBe(2);
  });

  test('the counters can never go backwards', async () => {
    const store = stubStores();
    const box = stubRedis();
    box.value = baseState();
    store.sessionRow.total_questions_answered = 7;
    store.sessionRow.correct_answers = 6;

    await VideoQuiz.handleAnswer(PHONE, 'vq_q-0_0');

    expect(store.sessionRow.total_questions_answered).toBe(7);
    expect(store.sessionRow.correct_answers).toBe(6);
  });

  test('a session whose counter is NULL is still written (the guard admits NULL)', async () => {
    // The column is nullable and `NULL <= n` is UNKNOWN in SQL, so a bare
    // `.lte()` would match no rows and the session would never be counted again.
    const store = stubStores();
    const box = stubRedis();
    box.value = baseState();
    store.sessionRow.total_questions_answered = null;
    store.sessionRow.correct_answers = null;

    await VideoQuiz.handleAnswer(PHONE, 'vq_q-0_0');

    expect(store.sessionRow.total_questions_answered).toBe(1);
  });

  test('after every answer the columns equal the answers table', async () => {
    const store = stubStores();
    const box = stubRedis();
    box.value = baseState();

    for (const [i, id] of ['vq_q-0_0', 'vq_q-1_1', 'vq_q-2_0'].entries()) {
      // eslint-disable-next-line no-await-in-loop
      await VideoQuiz.handleAnswer(PHONE, id);
      const correct = store.answers.filter((a) => a.is_correct).length;
      expect(store.sessionRow.total_questions_answered).toBe(i + 1);
      expect(store.sessionRow.correct_answers).toBe(correct);
    }
  });
});
