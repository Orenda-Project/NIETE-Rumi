'use strict';
/**
 * Round 4, live run 2 (staging session cce41fd7, 2026-09-06): the answers table
 * held all eight answers while the session row said five; a replayed tap
 * reconciled to SIX (state.questionIds ∩ answers) and the child's card and the
 * teacher's report were built from the wrong numbers. The answers table is the
 * truth: the finish and the reconcile count from it, not from the in-memory
 * state, and the state's question list may be stale without changing the score.
 */
jest.mock('../../shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../shared/services/cache/railway-redis.service', () => ({
  get: jest.fn(), set: jest.fn(), delete: jest.fn(), setNX: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../shared/services/whatsapp.service', () => ({ sendMessage: jest.fn().mockResolvedValue(true) }));
jest.mock('../../shared/services/quiz/video-quiz-sender.service', () => ({ sendPhase: jest.fn().mockResolvedValue({ sent: 1, failed: 0 }) }));
jest.mock('../../shared/services/quiz/video-quiz-scorecard.service', () => ({ sendScorecard: jest.fn().mockResolvedValue(true) }));
jest.mock('../../shared/services/quiz/video-quiz-rate-limiter.service', () => ({ throttle: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const supabase = require('../../shared/config/supabase');
const redis = require('../../shared/services/cache/railway-redis.service');
const Scorecard = require('../../shared/services/quiz/video-quiz-scorecard.service');
const VQ = require('../../shared/services/quiz/video-quiz.service');

const IDS = ['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7', 'q8'];
const updates = [];
function chain(table, answers, { duplicate = true } = {}) {
  const c = {
    // `or` is the guard on the counter write — the update chain is
    // `.update().eq().or()`, and a stub missing one link fails as a TypeError
    // rather than as a wrong number.
    select: () => c, eq: () => c, in: () => c, is: () => c, order: () => c, or: () => c,
    update: (patch) => { updates.push([table, patch]); return c; },
    insert: async () => (table === 'quiz_answers' && duplicate ? { error: { code: '23505', message: 'duplicate' } } : { error: null }),
    single: async () => ({ data: { id: 'q8', question_text: 'x', option_a: 'a', option_b: 'b', option_c: 'c', correct_option: 'A', media: null, render_pattern: 'P1' } }),
    maybeSingle: async () => ({ data: { topic: 'Electric Circuit', grade: '6-8', subject: 'science' } }),
    then: (resolve) => resolve({ data: table === 'quiz_answers' ? answers : [], error: null }),
  };
  return c;
}
beforeEach(() => { updates.length = 0; jest.clearAllMocks(); });

test('reconcile with a STALE question list still counts every stored answer', async () => {
  const answers = IDS.map((id, i) => ({ question_id: id, is_correct: i !== 2 }));   // 8 answered, 7 correct
  supabase.from.mockImplementation((t) => chain(t, answers));
  // the state only knows six question ids (what happened live: 6 of 8 counted)
  redis.get.mockResolvedValue({ sessionId: 's1', quizId: 'z1', questionIds: IDS.slice(0, 6), index: 5, answered: 5, correct: 4, language: 'ur', takerName: 'حمزہ' });
  await VQ.handleAnswer('923000000000', 'vq_q8_0');
  const done = updates.find(([t, p]) => t === 'quiz_sessions' && p.status === 'completed');
  expect(done).toBeDefined();
  expect(done[1].total_questions_answered).toBe(8);
  expect(done[1].correct_answers).toBe(7);
  expect(done[1].mastery_percentage).toBe(88);
  expect(Scorecard.sendScorecard.mock.calls[0][1]).toMatchObject({ correct: 7, total: 8, pct: 88 });
});

test('finish after a drifted state uses the answers table: 8/7/88, not 6/5/83', async () => {
  const answers = IDS.map((id, i) => ({ question_id: id, is_correct: i !== 2 }));
  supabase.from.mockImplementation((t) => chain(t, answers, { duplicate: false }));
  // the last question is answered normally, but the state's counters had drifted to 6/5
  redis.get.mockResolvedValue({ sessionId: 's1', quizId: 'z1', questionIds: IDS, index: 7, answered: 6, correct: 5, currentQuestionId: 'q8', language: 'ur', takerName: 'حمزہ' });
  await VQ.handleAnswer('923000000000', 'vq_q8_0');
  const done = updates.find(([t, p]) => t === 'quiz_sessions' && p.status === 'completed');
  expect(done).toBeDefined();
  expect(done[1].total_questions_answered).toBe(8);
  expect(done[1].correct_answers).toBe(7);
  expect(done[1].mastery_percentage).toBe(88);
});
