'use strict';
/**
 * A QUESTION THAT CANNOT BE DELIVERED IS NEVER A FINISH.
 *
 * Seen on sandbox: a child answered question 1 of 8; question 2's picker could
 * not be sent (its question card could not be fetched), three tries failed, and
 * the engine then FINISHED the session on what had been answered so far —
 * `status: completed`, 1/1 = 100%, a "mastered" scorecard to the child, and a
 * class report counting a child who saw one question of eight at full marks.
 *
 * What the engine does instead, and what these tests hold it to:
 *
 *   1. A question that still cannot be sent after its retries is SKIPPED for
 *      this session — the child is told, and the quiz carries on with the next
 *      one. The scored total is what was actually asked: the card and the
 *      report read the answers table, so a skipped question is in neither the
 *      numerator nor the denominator.
 *   2. A skipped question stays skipped. The next question is derived from the
 *      answers table on every answer, and an unanswered question used to look
 *      like the next one to ask — so after a skip (or a question row that could
 *      not be read) the session walked back to it, skipped it again, and
 *      re-sent the question the child had just answered, forever.
 *   3. When NOTHING gets through — a skipped question followed straight away by
 *      more failed sends — the channel is down, not the question. The session
 *      ends UNFINISHED (`incomplete`): no mastery written, no scorecard, the
 *      child is told the quiz stopped and to try again later. Every reader of
 *      quiz_sessions already counts `completed` as finished and anything else
 *      as started-but-unfinished, so the teacher's report says exactly that.
 *   4. A session that ends with nothing answered is never `completed` at 0%.
 *
 * Harness: the REAL engine, sender, renderer and rate limiter. Only the network
 * boundary (whatsapp.service), the two stores (supabase, Redis) and the
 * scorecard renderer are stand-ins. The stores behave like the real ones: the
 * answers table rejects a duplicate (session, question) with 23505, Redis keys
 * are separate (the rate limiter and the session state share the client).
 *
 * RUN: cd bot && npx jest --config jest.config.js tests/quiz/video-quiz-undeliverable-question.test.js
 */
jest.mock('../../shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../shared/services/cache/railway-redis.service', () => ({
  get: jest.fn(), set: jest.fn(), delete: jest.fn(), setNX: jest.fn(),
}));
jest.mock('../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(),
  sendTextReturningId: jest.fn(),
  sendInteractiveButtons: jest.fn(),
  sendImageWithButtons: jest.fn(),
  sendInteractiveMessage: jest.fn(),
  sendImageFromUrl: jest.fn(),
  sendAudioFromUrlReturningId: jest.fn(),
  sendFlow: jest.fn(),
}));
jest.mock('../../shared/services/quiz/video-quiz-scorecard.service', () => ({
  sendScorecard: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const supabase = require('../../shared/config/supabase');
const redis = require('../../shared/services/cache/railway-redis.service');
const WhatsAppService = require('../../shared/services/whatsapp.service');
const Scorecard = require('../../shared/services/quiz/video-quiz-scorecard.service');
const { logEvent } = require('../../shared/utils/structured-logger');
const { resolveUx } = require('../../shared/config/ux-strings');
const VideoQuiz = require('../../shared/services/quiz/video-quiz.service');

const PHONE = '923000000000';
const SESSION = 'sess-undeliverable';

const question = (n) => ({
  id: `q-${n}`, external_id: `tq:quiz1:S1:${n}`, sort_order: n,
  question_text: `Question text ${n}?`, option_a: 'a', option_b: 'b', option_c: 'c', option_d: null,
  correct_option: 'A', explanation: 'because', option_feedback: null,
  media: {}, render_pattern: 'P1',
});

/**
 * The two tables this path reads and writes, behaving like Postgres:
 * `quiz_answers` accumulates and rejects a duplicate; `quiz_sessions` holds the
 * one row the scorecard and the class report are built from.
 */
function stubStores({ questions, missing = [] }) {
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
        single: async () => {
          if (missing.includes(wanted)) return { data: null, error: { code: 'PGRST116', message: 'no rows' } };
          return { data: questions.find((q) => q.id === wanted) || null, error: null };
        },
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
      const filters = [];
      const chain = {
        select: () => chain,
        update: (p) => { patch = p; return chain; },
        eq: (c, v) => { filters.push([c, v]); return chain; },
        or: () => chain,   // the counters' never-downwards guard; the table only grows here
        maybeSingle: async () => ({ data: { ...store.sessionRow }, error: null }),
        then: (res, rej) => {
          const matches = filters.every(([c, v]) => c === 'id' || store.sessionRow[c] === v);
          if (patch && matches) Object.assign(store.sessionRow, patch);
          return Promise.resolve({ data: null, error: null }).then(res, rej);
        },
      };
      return chain;
    }
    // quizzes (the scorecard's topic), anything else: an empty, successful read.
    const chain = {
      select: () => chain, eq: () => chain, update: () => chain,
      single: async () => ({ data: null, error: null }),
      maybeSingle: async () => ({ data: null, error: null }),
      then: (res, rej) => Promise.resolve({ data: null, error: null }).then(res, rej),
    };
    return chain;
  });
  return store;
}

/** Redis as it is: one namespace, separate keys, JSON round-trip. */
function stubRedis() {
  const kv = new Map();
  redis.get.mockImplementation(async (k) => (kv.has(k) ? JSON.parse(kv.get(k)) : null));
  redis.set.mockImplementation(async (k, v) => { kv.set(k, JSON.stringify(v)); return true; });
  redis.delete.mockImplementation(async (k) => { kv.delete(k); return true; });
  redis.setNX.mockImplementation(async (k, v) => {
    if (kv.has(k)) return false;
    kv.set(k, JSON.stringify(v));
    return true;
  });
  return kv;
}

/** Question ids whose picker actually REACHED the child, in order. */
let delivered = [];

/** WhatsApp: every send lands, except a picker for a question in `failFor`. */
function stubWhatsApp({ failFor = [] } = {}) {
  delivered = [];
  const pickerFor = (payload) => {
    const b = payload && payload.buttons && payload.buttons[0];
    return b ? String(b.id).split('_')[1] : null;
  };
  WhatsAppService.sendMessage.mockResolvedValue(true);
  WhatsAppService.sendTextReturningId.mockResolvedValue('wamid.t');
  WhatsAppService.sendImageFromUrl.mockResolvedValue(true);
  WhatsAppService.sendAudioFromUrlReturningId.mockResolvedValue('wamid.a');
  WhatsAppService.sendFlow.mockResolvedValue(true);
  WhatsAppService.sendInteractiveMessage.mockResolvedValue(true);
  WhatsAppService.sendImageWithButtons.mockResolvedValue(true);
  WhatsAppService.sendInteractiveButtons.mockImplementation(async (_p, payload) => {
    const qid = pickerFor(payload);
    if (failFor.includes(qid)) return false;
    delivered.push(qid);
    return true;
  });
}

const deliveredPickers = () => delivered;

const sentTexts = () => WhatsAppService.sendMessage.mock.calls.map((c) => c[1]);
const events = (name) => logEvent.mock.calls.filter((c) => c[0] === name).map((c) => c[1]);

function baseState(questions) {
  return {
    sessionId: SESSION, quizId: 'quiz1', videoId: null, userId: null, language: 'en',
    source: 'share_link', shareCodeId: null, studentId: null, takerName: 'Child',
    questionIds: questions.map((q) => q.id),
    index: 0, correct: 0, answered: 0, currentQuestionId: null,
  };
}

/** Run an engine call to completion under fake timers (backoffs, pacing gaps). */
async function drive(promise) {
  let settled = false;
  promise.then(() => { settled = true; }, () => { settled = true; });
  for (let i = 0; i < 100 && !settled; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await jest.runAllTimersAsync();
  }
  return promise;
}

const stateKey = VideoQuiz.STATE_KEY(PHONE);

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
});
afterEach(() => { jest.useRealTimers(); });

describe('an undeliverable question is skipped, never turned into a finish', () => {
  test('Q2 cannot be sent: the child still gets Q3, and the score is over the two questions actually asked', async () => {
    const questions = [0, 1, 2].map(question);
    const store = stubStores({ questions });
    const kv = stubRedis();
    stubWhatsApp({ failFor: ['q-1'] });
    kv.set(stateKey, JSON.stringify(baseState(questions)));

    await drive(VideoQuiz.sendNextQuestion(PHONE, JSON.parse(kv.get(stateKey))));
    await drive(VideoQuiz.handleAnswer(PHONE, 'vq_q-0_0'));   // Q1 right

    // Not finished after Q1: the session is still going and Q3 reached the child.
    expect(store.sessionRow.status).toBe('in_progress');
    expect(Scorecard.sendScorecard).not.toHaveBeenCalled();
    expect(deliveredPickers()).toEqual(['q-0', 'q-2']);
    // The child is told why question 2 never came, in the quiz language.
    expect(sentTexts()).toContain(resolveUx('vqQuestionSkipped', { language: 'en', params: { i: 2 } }));
    expect(events('video_quiz.question_skipped')).toEqual([
      expect.objectContaining({ sessionId: SESSION, questionId: 'q-1', position: 2, reason: 'undeliverable' }),
    ]);

    await drive(VideoQuiz.handleAnswer(PHONE, 'vq_q-2_1'));   // Q3 wrong

    // Completed on what was ASKED: 1 of 2, never 1/1 and never 1 of 3.
    expect(store.sessionRow).toEqual(expect.objectContaining({
      status: 'completed', total_questions_answered: 2, correct_answers: 1, mastery_percentage: 50,
    }));
    expect(Scorecard.sendScorecard).toHaveBeenCalledTimes(1);
    expect(Scorecard.sendScorecard).toHaveBeenCalledWith(PHONE, expect.objectContaining({ correct: 1, total: 2, pct: 50 }));
    expect(events('video_quiz.completed')).toEqual([
      expect.objectContaining({ total: 2, correct: 1, pct: 50, skipped: 1 }),
    ]);
  });

  test('a question row that cannot be read is skipped ONCE — the session never walks back to it and re-asks the one after', async () => {
    const questions = [0, 1, 2].map(question);
    const store = stubStores({ questions, missing: ['q-1'] });
    const kv = stubRedis();
    stubWhatsApp();
    kv.set(stateKey, JSON.stringify(baseState(questions)));

    await drive(VideoQuiz.sendNextQuestion(PHONE, JSON.parse(kv.get(stateKey))));
    await drive(VideoQuiz.handleAnswer(PHONE, 'vq_q-0_0'));
    await drive(VideoQuiz.handleAnswer(PHONE, 'vq_q-2_0'));

    // Q3 was sent exactly once, and answering it finished the quiz.
    expect(deliveredPickers()).toEqual(['q-0', 'q-2']);
    expect(store.sessionRow).toEqual(expect.objectContaining({
      status: 'completed', total_questions_answered: 2, correct_answers: 2, mastery_percentage: 100,
    }));
    expect(events('video_quiz.question_skipped')).toEqual([
      expect.objectContaining({ questionId: 'q-1', position: 2, reason: 'missing' }),
    ]);
  });

  test('a duplicate tap on an earlier answer after a skip resumes at the open question, not the skipped one', async () => {
    const questions = [0, 1, 2].map(question);
    stubStores({ questions });
    const kv = stubRedis();
    stubWhatsApp({ failFor: ['q-1'] });
    kv.set(stateKey, JSON.stringify(baseState(questions)));

    await drive(VideoQuiz.sendNextQuestion(PHONE, JSON.parse(kv.get(stateKey))));
    await drive(VideoQuiz.handleAnswer(PHONE, 'vq_q-0_0'));
    const picked = WhatsAppService.sendInteractiveButtons.mock.calls.length;

    await drive(VideoQuiz.handleAnswer(PHONE, 'vq_q-0_0'));   // the same tap again (23505 → reconcile)

    const after = WhatsAppService.sendInteractiveButtons.mock.calls.slice(picked)
      .map((c) => String(c[1].buttons[0].id).split('_')[1]);
    expect(after).toEqual(['q-2']);
  });
});

describe('when nothing gets through, the session ends unfinished', () => {
  test('Q1 answered, then no picker can be sent: incomplete, no mastery, no scorecard, and the child is told it stopped', async () => {
    const questions = [0, 1, 2].map(question);
    const store = stubStores({ questions });
    const kv = stubRedis();
    stubWhatsApp({ failFor: ['q-1', 'q-2'] });
    kv.set(stateKey, JSON.stringify(baseState(questions)));

    await drive(VideoQuiz.sendNextQuestion(PHONE, JSON.parse(kv.get(stateKey))));
    await drive(VideoQuiz.handleAnswer(PHONE, 'vq_q-0_0'));

    expect(store.sessionRow.status).toBe('incomplete');
    expect(store.sessionRow.total_questions_answered).toBe(1);
    expect(store.sessionRow.correct_answers).toBe(1);
    // Not scored: no percentage and no level for a quiz the child never got to finish.
    expect(store.sessionRow.mastery_percentage).toBeUndefined();
    expect(store.sessionRow.mastery_level).toBeUndefined();
    expect(Scorecard.sendScorecard).not.toHaveBeenCalled();
    expect(events('video_quiz.completed')).toEqual([]);
    expect(events('video_quiz.ended_unfinished')).toEqual([
      expect.objectContaining({ sessionId: SESSION, answered: 1, correct: 1, reason: 'undeliverable' }),
    ]);
    expect(sentTexts()).toContain(resolveUx('vqTrouble', { language: 'en' }));
    // The state is gone, so a stale tap cannot re-open it.
    expect(kv.has(stateKey)).toBe(false);
    // The give-up still honours the storm cap: at most five picker attempts after Q1.
    const attemptsAfterQ1 = WhatsAppService.sendInteractiveButtons.mock.calls.length - 1;
    expect(attemptsAfterQ1).toBeLessThanOrEqual(5);
  });

  test('a child asked fewer than half the quiz is not scored: 1 of 4 asked is never 1/1 = 100%', async () => {
    // Not a failed SEND this time: three question rows cannot be read (a quiz
    // rewritten under a live session), so the send-failure guard never trips.
    // The floor in finish() is what keeps this child out of the report at 100%.
    const questions = [0, 1, 2, 3].map(question);
    const store = stubStores({ questions, missing: ['q-1', 'q-2', 'q-3'] });
    const kv = stubRedis();
    stubWhatsApp();
    kv.set(stateKey, JSON.stringify(baseState(questions)));

    await drive(VideoQuiz.sendNextQuestion(PHONE, JSON.parse(kv.get(stateKey))));
    await drive(VideoQuiz.handleAnswer(PHONE, 'vq_q-0_0'));

    expect(store.sessionRow.status).toBe('incomplete');
    expect(store.sessionRow.total_questions_answered).toBe(1);
    expect(store.sessionRow.mastery_percentage).toBeUndefined();
    expect(Scorecard.sendScorecard).not.toHaveBeenCalled();
    expect(events('video_quiz.completed')).toEqual([]);
    expect(events('video_quiz.ended_unfinished')).toEqual([
      expect.objectContaining({ answered: 1, reason: 'too_few_asked', questions: 4, skipped: 3 }),
    ]);
    // Unreadable rows are skipped quietly — one line per missing row would be a
    // burst of messages when a whole quiz is rewritten; the ending line explains.
    expect(sentTexts().filter((t) => /couldn’t send question/.test(t))).toEqual([]);
    expect(sentTexts()).toContain(resolveUx('vqTrouble', { language: 'en' }));
  });

  test('a session whose every question row is unreadable is never completed at 0%', async () => {
    const questions = [0, 1].map(question);
    const store = stubStores({ questions, missing: ['q-0', 'q-1'] });
    const kv = stubRedis();
    stubWhatsApp();
    kv.set(stateKey, JSON.stringify(baseState(questions)));

    await drive(VideoQuiz.sendNextQuestion(PHONE, JSON.parse(kv.get(stateKey))));

    expect(store.sessionRow.status).toBe('incomplete');
    expect(store.sessionRow.mastery_percentage).toBeUndefined();
    expect(Scorecard.sendScorecard).not.toHaveBeenCalled();
    expect(events('video_quiz.completed')).toEqual([]);
    expect(events('video_quiz.ended_unfinished')).toEqual([
      expect.objectContaining({ answered: 0, reason: 'nothing_answered' }),
    ]);
  });
});
