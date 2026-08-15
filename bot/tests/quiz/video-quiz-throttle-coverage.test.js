'use strict';
/**
 * bd-2681 — bd-2666's per-recipient throttle only wraps sender.sendPhase().
 * Two other WhatsApp sends to the same phone during a quiz session bypass it
 * entirely: startSession()'s "Here we go — N questions" line, and
 * sendNextQuestion()'s "Question N of M" line (both direct WhatsAppService
 * calls in video-quiz.service.js), and Scorecard.sendScorecard()'s final
 * image send (video-quiz-scorecard.service.js, not routed through
 * sendPhase() at all). Meta's 131056 pair-rate-limit counts everything sent
 * to a phone regardless of which code path sent it — so these "side door"
 * sends still spend the recipient's real budget while the throttle's own
 * window never learns about them. A traced real production incident
 * (phone …6989, 2026-08-13 09:27-09:28 UTC, 80 minutes after bd-2666
 * deployed) hit exactly this: the "Question N of M" send fired into an
 * already-exhausted budget the throttle didn't know was exhausted.
 *
 * Fix: route all three through the same rateLimiter.throttle(phone) gate
 * everything in sendPhase() already goes through.
 *
 * RUN: NODE_OPTIONS='--localstorage-file=/tmp/jest-ls.json' npx jest tests/quiz/video-quiz-throttle-coverage.test.js
 */

jest.mock('../../shared/config/supabase', () => ({ from: jest.fn(), rpc: jest.fn() }));
jest.mock('../../shared/services/cache/railway-redis.service', () => ({
  get: jest.fn(), set: jest.fn().mockResolvedValue(true), delete: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  sendImageFromBuffer: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../shared/services/quiz/video-quiz-render.service', () => ({ build: jest.fn(() => ({})) }));
jest.mock('../../shared/services/quiz/video-quiz-sender.service', () => ({ sendPhase: jest.fn().mockResolvedValue({ sent: 1, failed: 0, pickerFailed: false }) }));
jest.mock('../../shared/services/quiz/video-quiz-rate-limiter.service', () => ({
  throttle: jest.fn().mockResolvedValue(undefined),
}));

const supabase = require('../../shared/config/supabase');
const WhatsAppService = require('../../shared/services/whatsapp.service');
const rateLimiter = require('../../shared/services/quiz/video-quiz-rate-limiter.service');
const vq = require('../../shared/services/quiz/video-quiz.service');

function stubSupabase({ sessionId = 'sess-1' } = {}) {
  supabase.from.mockImplementation((table) => {
    const chain = {
      then(resolve) {
        resolve({
          data: [{ id: 'q-1', external_id: 'leg:1', sort_order: 1 }],
          error: null,
        });
      },
      select: () => chain,
      order: () => chain,
      insert: () => chain,
      update: () => chain,
      eq: () => chain,
      is: () => chain,
      lt: () => chain,
      single: async () => (table === 'quiz_sessions'
        ? { data: { id: sessionId }, error: null }
        : { data: { id: 'q-1', question_text: 'x', option_a: 'a', option_b: 'b', correct_option: 'A' }, error: null }),
      maybeSingle: async () => ({ data: { uses_count: 0 }, error: null }),
    };
    return chain;
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  supabase.rpc.mockResolvedValue({ data: null, error: null });
});

describe('bd-2681 — startSession throttles its own direct "Here we go" send', () => {
  test('calls rateLimiter.throttle(phone) before sending the opening message', async () => {
    stubSupabase({ sessionId: 'sess-42' });

    await vq.startSession({
      phone: '923001234567', userId: 'u1', quizId: 'qz1', videoId: 'v1',
      language: 'en', deliveryId: null, source: 'video_solo',
    });

    expect(rateLimiter.throttle).toHaveBeenCalledWith('923001234567');
    // throttle must run BEFORE the send it's guarding, not just at some point.
    const throttleCallOrder = rateLimiter.throttle.mock.invocationCallOrder[0];
    const sendCall = WhatsAppService.sendMessage.mock.calls.findIndex(
      (c) => typeof c[1] === 'string' && c[1].includes('Here we go'));
    expect(sendCall).toBeGreaterThanOrEqual(0);
    const sendCallOrder = WhatsAppService.sendMessage.mock.invocationCallOrder[sendCall];
    expect(throttleCallOrder).toBeLessThan(sendCallOrder);
  });
});

describe('bd-2681 — sendNextQuestion throttles its own direct "Question N of M" send', () => {
  test('calls rateLimiter.throttle(phone) before sending the question label', async () => {
    const state = {
      sessionId: 'sess-1', quizId: 'qz1', videoId: 'v1', userId: 'u1',
      language: 'en', source: 'video_solo',
      questionIds: ['q-1', 'q-2'], index: 0, correct: 0, answered: 0, currentQuestionId: null,
    };
    stubSupabase();

    await vq.sendNextQuestion('923365709413', state);

    expect(rateLimiter.throttle).toHaveBeenCalledWith('923365709413');
    const throttleCallOrder = rateLimiter.throttle.mock.invocationCallOrder[0];
    const sendCall = WhatsAppService.sendMessage.mock.calls.findIndex(
      (c) => typeof c[1] === 'string' && c[1].includes('Question 1 of 2'));
    expect(sendCall).toBeGreaterThanOrEqual(0);
    const sendCallOrder = WhatsAppService.sendMessage.mock.invocationCallOrder[sendCall];
    expect(throttleCallOrder).toBeLessThan(sendCallOrder);
  });
});

describe('bd-2681 — the scorecard image send is also throttled', () => {
  test('Scorecard.sendScorecard calls rateLimiter.throttle(phone) before sendImageFromBuffer', async () => {
    jest.resetModules();
    jest.doMock('../../shared/services/whatsapp.service', () => ({
      sendImageFromBuffer: jest.fn().mockResolvedValue(true),
    }));
    jest.doMock('../../shared/services/quiz/video-quiz-rate-limiter.service', () => ({
      throttle: jest.fn().mockResolvedValue(undefined),
    }));
    jest.doMock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));
    jest.doMock('../../shared/templates/video-quiz-scorecard.template', () => ({
      __esModule: true,
      default: undefined,
    }));
    jest.doMock('../../shared/utils/html-to-pdf', () => ({
      htmlToImage: jest.fn().mockResolvedValue(Buffer.from('fake-png')),
    }));
    // The template is required as a bare function export AND destructured
    // for starsAndBadge — provide both on the same mock factory function.
    jest.doMock('../../shared/templates/video-quiz-scorecard.template', () => {
      const fn = jest.fn(() => '<html></html>');
      fn.starsAndBadge = jest.fn(() => ({ stars: 3 }));
      return fn;
    });

    const freshWhatsApp = require('../../shared/services/whatsapp.service');
    const freshRateLimiter = require('../../shared/services/quiz/video-quiz-rate-limiter.service');
    const Scorecard = require('../../shared/services/quiz/video-quiz-scorecard.service');

    await Scorecard.sendScorecard('923001234567', {
      topic: 't', correct: 8, total: 10, pct: 80, grade: '4', subject: 'Science', takerName: 'Ali',
    });

    expect(freshRateLimiter.throttle).toHaveBeenCalledWith('923001234567');
    const throttleCallOrder = freshRateLimiter.throttle.mock.invocationCallOrder[0];
    const sendCallOrder = freshWhatsApp.sendImageFromBuffer.mock.invocationCallOrder[0];
    expect(throttleCallOrder).toBeLessThan(sendCallOrder);

    jest.dontMock('../../shared/services/whatsapp.service');
    jest.dontMock('../../shared/services/quiz/video-quiz-rate-limiter.service');
    jest.dontMock('../../shared/utils/logger');
    jest.dontMock('../../shared/templates/video-quiz-scorecard.template');
    jest.dontMock('../../shared/utils/html-to-pdf');
  });
});
