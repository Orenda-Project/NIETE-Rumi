'use strict';
/**
 * bd-mg9c7.87 (Lane I) — ONE answer at a time per phone, and an index that
 * comes from the truth, not an increment.
 *
 * Staging, 2026-09-06 11:18-11:24 UTC: the per-recipient send throttle filled
 * up at question 5, so four `handleAnswer` calls sat inside the answer-phase
 * send at the same time. All four read the SAME stale `state.index` (4), so
 * all four incremented it to 5 and all four sent "question 6" — four times.
 * The session finished 8/8 answered and never left `in_progress`.
 *
 * TWO fixes, both exercised here:
 *   1. A per-phone `videoquiz:<phone>:answerlock` (setNX) serialises the
 *      whole answer path — the state read happens AFTER the lock, not before.
 *   2. `state.index` is derived from `quiz_answers` (nextIndexFromTruth),
 *      never incremented — so a second handler that runs after the first
 *      already has the up-to-date picture, and a lost cache write cannot
 *      rewind the quiz.
 *
 * A THIRD fix rides along: when every question already has an answer,
 * `handleAnswer`/`handleMultiAnswer` call `finish()` directly instead of
 * trusting a possibly-stale `state.index` to reach the same conclusion.
 *
 * RUN: cd bot && NODE_OPTIONS=--no-experimental-webstorage npx jest --config jest.config.js tests/quiz/video-quiz-answer-lock.test.js
 */
jest.mock('../../shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../shared/services/cache/railway-redis.service', () => ({
  get: jest.fn(), set: jest.fn(), delete: jest.fn(), setNX: jest.fn(),
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
const Scorecard = require('../../shared/services/quiz/video-quiz-scorecard.service');
const VideoQuiz = require('../../shared/services/quiz/video-quiz.service');

const PHONE = '923000000001';
const SESSION = 'sess-lock';
const LOCK_KEY = VideoQuiz.STATE_KEY(PHONE).replace(':active', ':answerlock');

const QUESTIONS = Array.from({ length: 8 }, (_, n) => ({
  id: `q-${n}`, external_id: `tq:quiz1:S1:${n}`, sort_order: n,
  question_text: `Q${n}?`, option_a: 'a', option_b: 'b', option_c: 'c', option_d: null,
  correct_option: 'A', explanation: '', option_feedback: null,
  media: {}, render_pattern: 'P1',
}));

/** Same shape as video-quiz-counter-drift.test.js's stubStores(). */
function stubStores() {
  const store = {
    answers: [],
    sessionRow: { id: SESSION, status: 'in_progress', total_questions_answered: 0, correct_answers: 0 },
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
        eq: async () => ({
          data: store.answers.map((a) => ({ question_id: a.question_id, is_correct: a.is_correct })),
          error: null,
        }),
      };
      return chain;
    }
    if (table === 'quiz_sessions') {
      let patch = null;
      let guard = null;
      const chain = {
        update: (p) => { patch = p; return chain; },
        eq: () => chain,
        or: (expr) => {
          const m = /^(\w+)\.is\.null,\1\.lte\.(\d+)$/.exec(expr);
          if (!m) throw new Error(`unexpected guard: ${expr}`);
          guard = { col: m[1], val: Number(m[2]) };
          return chain;
        },
        select: () => chain,
        maybeSingle: async () => ({ data: store.sessionRow, error: null }),
        then: (res) => {
          const stored = guard ? store.sessionRow[guard.col] : undefined;
          const applied = !guard || stored == null || stored <= guard.val;
          if (applied && patch) Object.assign(store.sessionRow, patch);
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

/**
 * A REAL (in-memory) key-value store backing get/set/delete/setNX, so the
 * answer lock's actual mutual-exclusion semantics are exercised — not just
 * asserted from mock call counts. Mirrors railway-redis.service.js's own
 * contract: setNX claims-or-tells-you-it's-taken; delete always succeeds.
 */
function stubRedis() {
  const kv = new Map();
  const now = () => Date.now();
  redis.get.mockImplementation(async (key) => {
    const e = kv.get(key);
    if (!e) return null;
    if (e.expiresAt && e.expiresAt < now()) { kv.delete(key); return null; }
    return JSON.parse(JSON.stringify(e.value));
  });
  redis.set.mockImplementation(async (key, value, ttlSeconds) => {
    kv.set(key, { value: JSON.parse(JSON.stringify(value)), expiresAt: ttlSeconds ? now() + ttlSeconds * 1000 : null });
    return true;
  });
  redis.delete.mockImplementation(async (key) => { kv.delete(key); return true; });
  redis.setNX.mockImplementation(async (key, value, ttlSeconds) => {
    const e = kv.get(key);
    if (e && (!e.expiresAt || e.expiresAt >= now())) return false;
    kv.set(key, { value, expiresAt: ttlSeconds ? now() + ttlSeconds * 1000 : null });
    return true;
  });
  return kv;
}

const baseState = (overrides = {}) => ({
  sessionId: SESSION, quizId: 'quiz1', videoId: null, userId: null, language: 'en',
  source: 'share_link', questionIds: QUESTIONS.map((q) => q.id),
  index: 0, correct: 0, answered: 0, currentQuestionId: null, sentAt: Date.now(),
  ...overrides,
});

const questionSendsFor = (questionId) => sender.sendPhase.mock.calls
  .filter((c) => c[2] === 'question' && c[3] && c[3].questionId === questionId);

beforeEach(() => {
  jest.clearAllMocks();
  // clearAllMocks() resets call history, not implementations — a test that
  // installs its own sendPhase behaviour (a throw, a held promise) would
  // otherwise leak into whichever test runs next.
  sender.sendPhase.mockResolvedValue({ pickerFailed: false });
});

describe('the answer lock serialises concurrent taps on one phone', () => {
  test('two concurrent answers to different questions: no duplicate next-question send, index lands on 2', async () => {
    stubStores();
    stubRedis();
    await redis.set(VideoQuiz.STATE_KEY(PHONE), baseState());

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

    // Under the pre-fix code both overlapping calls read the SAME stale
    // index and both sent "question 2" (q-1) — a real duplicate of the
    // question the child had JUST answered. Fixed: q-1 is sent once, as the
    // correct next step after q-0; q-2 follows once, as the correct next
    // step after q-1. Neither is ever re-sent.
    expect(questionSendsFor('q-1').length).toBe(1);
    expect(questionSendsFor('q-2').length).toBe(1);

    const finalState = await redis.get(VideoQuiz.STATE_KEY(PHONE));
    expect(finalState.index).toBe(2);
  }, 10000);

  test('the operator\'s session: four concurrent answers finish 8/8 instead of re-sending question 6', async () => {
    const store = stubStores();
    stubRedis();
    // Questions 1-4 (q-0..q-3) already answered before the race, matching
    // the live evidence (state_read found index:4 for all four handlers).
    store.answers.push(
      { question_id: 'q-0', is_correct: true }, { question_id: 'q-1', is_correct: true },
      { question_id: 'q-2', is_correct: false }, { question_id: 'q-3', is_correct: true },
    );
    store.sessionRow.total_questions_answered = 4;
    store.sessionRow.correct_answers = 3;
    await redis.set(VideoQuiz.STATE_KEY(PHONE), baseState({ index: 4, answered: 4, correct: 3 }));

    let release;
    const held = new Promise((r) => { release = r; });
    let held0 = false;
    sender.sendPhase.mockImplementation(async (_p, _m, phase) => {
      if (phase === 'answer' && !held0) { held0 = true; await held; }
      return { pickerFailed: false };
    });

    const calls = ['vq_q-4_0', 'vq_q-5_0', 'vq_q-6_0', 'vq_q-7_0'].map((id) => VideoQuiz.handleAnswer(PHONE, id));
    await new Promise((r) => setImmediate(r));
    release();
    await Promise.all(calls);

    // "question 6" is q-5 (0-indexed). Pre-fix it fired four times; fixed,
    // it is sent exactly once — the run that actually reaches it as the
    // first unanswered question, and only that run.
    expect(questionSendsFor('q-5').length).toBe(1);

    expect(store.sessionRow.status).toBe('completed');
    expect(store.sessionRow.total_questions_answered).toBe(8);
    expect(Scorecard.sendScorecard).toHaveBeenCalledTimes(1);
  }, 20000);
});

describe('the index is derived from the truth, not incremented', () => {
  test('a lost state write cannot re-send an already-answered question', async () => {
    stubStores();
    const kv = stubRedis();
    await redis.set(VideoQuiz.STATE_KEY(PHONE), baseState());

    // Every state SET from the second call onward silently vanishes — the
    // documented railway-redis.service.js failure mode — while the lock's
    // own setNX/delete keep working (a dropped STATE write, not a broken
    // Redis client).
    let stateWrites = 0;
    const realSet = redis.set.getMockImplementation();
    redis.set.mockImplementation(async (key, value, ttlSeconds) => {
      if (key === VideoQuiz.STATE_KEY(PHONE)) {
        stateWrites += 1;
        if (stateWrites >= 2) return false;
      }
      return realSet(key, value, ttlSeconds);
    });

    await VideoQuiz.handleAnswer(PHONE, 'vq_q-0_0');
    await VideoQuiz.handleAnswer(PHONE, 'vq_q-1_0');
    await VideoQuiz.handleAnswer(PHONE, 'vq_q-2_0');

    const lastQuestionSend = sender.sendPhase.mock.calls
      .filter((c) => c[2] === 'question')
      .pop();
    expect(lastQuestionSend[3].questionId).toBe('q-3');
    // The drop really happened: only the FIRST answer's state write landed,
    // so the cached copy is stuck at index 1 even though three answers were
    // graded and the next question sent was correctly q-3 (index 3) — proof
    // the correct progression came from `quiz_answers`, not from this stale
    // cache entry.
    expect(kv.get(VideoQuiz.STATE_KEY(PHONE)).value.index).toBe(1);
  }, 15000);
});

describe('finish fires when every question is answered, regardless of a stale index', () => {
  test('the eighth answer completes the session even though state.index says 5', async () => {
    const store = stubStores();
    stubRedis();
    for (let n = 0; n <= 6; n += 1) {
      store.answers.push({ question_id: `q-${n}`, is_correct: true });
    }
    store.sessionRow.total_questions_answered = 7;
    store.sessionRow.correct_answers = 7;
    // The stale index a crashed/lost write could plausibly have left behind.
    await redis.set(VideoQuiz.STATE_KEY(PHONE), baseState({ index: 5, answered: 7, correct: 7 }));

    await VideoQuiz.handleAnswer(PHONE, 'vq_q-7_0');

    expect(store.sessionRow.status).toBe('completed');
    expect(store.sessionRow.total_questions_answered).toBe(8);
    expect(Scorecard.sendScorecard).toHaveBeenCalledTimes(1);
    expect(sender.sendPhase.mock.calls.filter((c) => c[2] === 'question')).toHaveLength(0);
  }, 10000);
});

describe('the lock releases on every exit', () => {
  test('a missing question row still releases the lock', async () => {
    stubStores();
    stubRedis();
    await redis.set(VideoQuiz.STATE_KEY(PHONE), baseState());

    await VideoQuiz.handleAnswer(PHONE, 'vq_qmissing_0');

    expect(redis.delete).toHaveBeenCalledWith(LOCK_KEY);
  }, 10000);

  test('a throw inside the answer-phase send still releases the lock', async () => {
    stubStores();
    stubRedis();
    await redis.set(VideoQuiz.STATE_KEY(PHONE), baseState());
    sender.sendPhase.mockImplementation(async (_p, _m, phase) => {
      if (phase === 'answer') throw new Error('boom');
      return { pickerFailed: false };
    });

    await expect(VideoQuiz.handleAnswer(PHONE, 'vq_q-0_0')).rejects.toThrow('boom');

    expect(redis.delete).toHaveBeenCalledWith(LOCK_KEY);
  }, 10000);
});

describe('Redis down', () => {
  test('setNX fail-open (always true) still runs one answer end to end', async () => {
    stubStores();
    stubRedis();
    await redis.set(VideoQuiz.STATE_KEY(PHONE), baseState());
    // The real railway-redis.service.js setNX() returns true unconditionally
    // when Redis is unavailable — model exactly that, independent of any
    // lock state, and confirm the answer still gets graded and moved on.
    redis.setNX.mockResolvedValue(true);

    const handled = await VideoQuiz.handleAnswer(PHONE, 'vq_q-0_0');

    expect(handled).toBe(true);
    const finalState = await redis.get(VideoQuiz.STATE_KEY(PHONE));
    expect(finalState.index).toBe(1);
    expect(questionSendsFor('q-1').length).toBe(1);
  }, 10000);
});
