'use strict';
/**
 * bd-2477 issue #1 — "Question 13 of 15" but only 10 answered.
 *
 * Root cause, confirmed via Axiom (digital-coach-logs, 2026-08-03 17:20-17:27Z,
 * sessionId 9d4c3ce9-6b48-463e-a461-522576d05ade): WhatsApp returned 8x
 * `whatsapp.message.failed` with error (#131056) "pair rate limit hit" during
 * this exact session, right before `video_quiz.completed` fired with total:10
 * against a 15-question selection.
 *
 * sendNextQuestion's pickerFailed branch (video-quiz.service.js) SKIPS the
 * question and recurses into the NEXT one INSTANTLY with no backoff whenever
 * sender.sendPhase's interaction call fails. When WhatsApp's per-recipient-
 * pair rate limit is active, every retry fails too — so the recursion burns
 * through every remaining question in milliseconds, permanently losing real
 * questions instead of giving the transient condition a moment to clear.
 *
 * RUN: NODE_OPTIONS='--localstorage-file=/tmp/jest-ls.json' npx jest tests/quiz/video-quiz-question-cascade.test.js
 */
jest.mock('../../shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../shared/services/cache/railway-redis.service', () => ({
  get: jest.fn(), set: jest.fn().mockResolvedValue(true), delete: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../shared/services/quiz/video-quiz-render.service', () => ({ build: jest.fn(() => ({})) }));
jest.mock('../../shared/services/quiz/video-quiz-sender.service', () => ({ sendPhase: jest.fn() }));
jest.mock('../../shared/services/quiz/video-quiz-scorecard.service', () => ({
  sendScorecard: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../shared/services/quiz/video-quiz-share.service', () => ({
  offerShare: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../shared/services/student-video-feedback.service', () => ({
  scheduleFeedbackPrompt: jest.fn(),
}));

const supabase = require('../../shared/config/supabase');
const sender = require('../../shared/services/quiz/video-quiz-sender.service');
const vq = require('../../shared/services/quiz/video-quiz.service');

function stubSupabase() {
  supabase.from.mockImplementation((table) => {
    let queriedId = null;
    const chain = {
      select: () => chain,
      eq: (col, val) => { if (col === 'id') queriedId = val; return chain; },
      update: () => chain,
      single: async () => ({
        data: { id: queriedId, question_text: 'x', option_a: 'a', option_b: 'b', correct_option: 'A' },
        error: null,
      }),
      maybeSingle: async () => ({ data: { topic: 't', grade: 4, subject: 'Science' }, error: null }),
    };
    return chain;
  });
}

function freshState(n = 15) {
  return {
    sessionId: 'sess-cascade', quizId: 'qz1', videoId: 'v1', userId: 'u1',
    language: 'en', source: 'video_solo',
    questionIds: Array.from({ length: n }, (_, i) => `q-${i + 1}`),
    index: 0, correct: 0, answered: 0, currentQuestionId: null,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  stubSupabase();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('bd-2477 #1 — a rate-limit storm must not silently burn through every remaining question', () => {
  test('backs off before retrying a failed send instead of recursing instantly', async () => {
    sender.sendPhase.mockImplementation(async (phone, msgs, phase) => {
      if (phase === 'interaction') return { sent: 0, failed: 1, pickerFailed: true };
      return { sent: 1, failed: 0, pickerFailed: false };
    });
    const setTimeoutSpy = jest.spyOn(global, 'setTimeout');

    const state = freshState(15);
    const promise = vq.sendNextQuestion('923365709413', state);
    await jest.runAllTimersAsync();
    await promise;

    // Today: zero delay — pickerFailed increments state.index and recurses on
    // the same tick. A real backoff must schedule a timer of meaningful length
    // before the retry.
    const delays = setTimeoutSpy.mock.calls.map((c) => c[1]);
    expect(delays.some((d) => typeof d === 'number' && d >= 500)).toBe(true);
  });

  test('stops retrying after a small number of consecutive failures instead of cascading through all 15 slots', async () => {
    sender.sendPhase.mockImplementation(async (phone, msgs, phase) => {
      if (phase === 'interaction') return { sent: 0, failed: 1, pickerFailed: true };
      return { sent: 1, failed: 0, pickerFailed: false };
    });

    const state = freshState(15);
    const promise = vq.sendNextQuestion('923365709413', state);
    await jest.runAllTimersAsync();
    await promise;

    // Today this is 15 — every single question in the session gets a picker
    // attempt and a "didn't load, skipping" message, all within milliseconds.
    const interactionAttempts = sender.sendPhase.mock.calls
      .filter(([, , phase]) => phase === 'interaction').length;
    expect(interactionAttempts).toBeLessThan(15);
    expect(interactionAttempts).toBeLessThanOrEqual(5);
    // It must give up rather than pretend all 15 slots were genuinely attempted.
    expect(state.index).toBeLessThan(15);
  });

  test('a transient failure that clears after one retry still presents the SAME question, not the next one', async () => {
    let interactionCalls = 0;
    sender.sendPhase.mockImplementation(async (phone, msgs, phase) => {
      if (phase === 'interaction') {
        interactionCalls += 1;
        // Fails once, then recovers — a real rate-limit window clearing.
        if (interactionCalls === 1) return { sent: 0, failed: 1, pickerFailed: true };
        return { sent: 1, failed: 0, pickerFailed: false };
      }
      return { sent: 1, failed: 0, pickerFailed: false };
    });

    const state = freshState(3);
    const promise = vq.sendNextQuestion('923365709413', state);
    await jest.runAllTimersAsync();
    await promise;

    // Today: the first failure increments state.index and moves on to q-2
    // immediately — the child never gets a real shot at q-1, even though the
    // very next attempt would have succeeded.
    expect(state.currentQuestionId).toBe('q-1');
    expect(state.index).toBe(0);
  });
});
