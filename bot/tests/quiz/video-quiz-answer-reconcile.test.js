'use strict';
/**
 * A restart between "answer recorded" and "state advanced" strands the child:
 * every later tap on that question is a duplicate (23505) and used to be
 * swallowed silently — no next question, no scorecard, and the teacher's
 * report says "nothing completed yet". Seen live on staging 2026-09-05 17:24
 * (a deploy landed mid-quiz: all 8 answers in quiz_answers, session stuck at
 * 5/8). A duplicate tap now rebuilds the state from the answers table and
 * carries on — next question, or the finish.
 */
jest.mock('../../shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../shared/services/cache/railway-redis.service', () => ({ get: jest.fn(), set: jest.fn(), delete: jest.fn() }));
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
function chain(table, answers) {
  const c = {
    _filters: [],
    select: () => c, eq: () => c, in: () => c, is: () => c, order: () => c,
    update: (patch) => { updates.push([table, patch]); return c; },
    insert: async () => (table === 'quiz_answers' ? { error: { code: '23505', message: 'duplicate' } } : { error: null }),
    single: async () => ({ data: { id: 'q6', question_text: 'x', option_a: 'a', option_b: 'b', option_c: 'c', correct_option: 'A', media: null, render_pattern: 'P1' } }),
    maybeSingle: async () => ({ data: { topic: 'Fractions', grade: '4', subject: 'maths' } }),
    then: (resolve) => resolve({ data: table === 'quiz_answers' ? answers : [], error: null }),
  };
  return c;
}

beforeEach(() => { updates.length = 0; jest.clearAllMocks(); });

test('all eight answers already in the table → the session is completed and the scorecard sent', async () => {
  const answers = IDS.map((id, i) => ({ question_id: id, is_correct: i !== 1 }));
  supabase.from.mockImplementation((t) => chain(t, answers));
  redis.get.mockResolvedValue({ sessionId: 's1', quizId: 'z1', questionIds: IDS, index: 5, answered: 5, correct: 4, language: 'ur', takerName: 'حمزہ' });
  await VQ.handleAnswer('923000000000', 'vq_q6_0');
  const done = updates.find(([t, p]) => t === 'quiz_sessions' && p.status === 'completed');
  expect(done).toBeDefined();
  expect(done[1].total_questions_answered).toBe(8);
  expect(done[1].correct_answers).toBe(7);
  expect(Scorecard.sendScorecard).toHaveBeenCalledTimes(1);
  expect(redis.delete).toHaveBeenCalled();
});

test('six answers in the table → state moves to question seven and it is sent', async () => {
  const answers = IDS.slice(0, 6).map((id) => ({ question_id: id, is_correct: true }));
  supabase.from.mockImplementation((t) => chain(t, answers));
  redis.get.mockResolvedValue({ sessionId: 's1', quizId: 'z1', questionIds: IDS, index: 5, answered: 5, correct: 5, language: 'ur' });
  const sender = require('../../shared/services/quiz/video-quiz-sender.service');
  await VQ.handleAnswer('923000000000', 'vq_q6_0');
  const saved = redis.set.mock.calls.map((c) => c[1]).find((s) => s && s.index === 6);
  expect(saved).toBeDefined();
  expect(saved.answered).toBe(6);
  expect(sender.sendPhase).toHaveBeenCalled();
  expect(Scorecard.sendScorecard).not.toHaveBeenCalled();
});
