'use strict';
/**
 * Measure the child's tap-to-next-question time.
 *
 * A prior review round closed at "slow from the driver's side" and demanded
 * a measurement before anyone claims the pacing is fast. Nothing before this
 * timed a single send, a phase, or the gap between a child's tap and the
 * next question landing. This file proves two events now do:
 *
 *  - `video_quiz.phase_sent` (video-quiz-sender.service.js `sendPhase`) — the
 *    wall time for a whole phase, decomposed into WhatsApp-call time, throttle
 *    wait, and our own deliberate pacing sleeps.
 *  - `video_quiz.answer_latency` (video-quiz.service.js `handleAnswer`) — the
 *    time from a child's tap to the verdict, and from the tap to the next
 *    question (or the finish) landing.
 *
 * Each describe block below gives itself a fresh module registry
 * (jest.resetModules + jest.doMock, not the hoisted jest.mock) because the
 * two functions under test need conflicting mocks for the SAME dependency:
 * the sendPhase suite needs the REAL video-quiz-sender.service; the
 * handleAnswer suite needs it stubbed so only video-quiz.service's own logic
 * is under test (the same convention video-quiz-question-cascade.test.js and
 * video-quiz-tracking.test.js use in their own, separate files).
 *
 * RUN: NODE_OPTIONS='--localstorage-file=/tmp/jest-ls.json' npx jest tests/quiz/video-quiz-latency.test.js
 */

function eventsNamed(logEvent, name) {
  return logEvent.mock.calls.filter((c) => c[0] === name).map((c) => c[1]);
}

// ─── sendPhase: video_quiz.phase_sent ───────────────────────────────────────
describe('sendPhase emits video_quiz.phase_sent with a timing decomposition', () => {
  let sender;
  let WhatsAppService;
  let logEvent;

  beforeAll(() => {
    jest.resetModules();
    jest.doMock('../../shared/services/whatsapp.service', () => ({
      sendMessage: jest.fn().mockResolvedValue(true),
      sendInteractiveButtons: jest.fn().mockResolvedValue(true),
      sendImageWithButtons: jest.fn().mockResolvedValue(true),
      sendInteractiveMessage: jest.fn().mockResolvedValue(true),
      sendImageFromUrl: jest.fn().mockResolvedValue(true),
      sendAudioFromUrlReturningId: jest.fn().mockResolvedValue('mid-1'),
      sendTextReturningId: jest.fn().mockResolvedValue('mid-2'),
      sendFlow: jest.fn().mockResolvedValue(true),
    }));
    // Only the rate limiter's WAIT is faked (a fixed, known delay) — its real
    // logic (Redis-backed window) is out of scope here; sendPhase's own
    // timing math is what this suite proves.
    jest.doMock('../../shared/services/quiz/video-quiz-rate-limiter.service', () => ({
      throttle: jest.fn(() => new Promise((r) => setTimeout(r, 50))),
    }));
    jest.doMock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));
    jest.doMock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

    sender = require('../../shared/services/quiz/video-quiz-sender.service');
    WhatsAppService = require('../../shared/services/whatsapp.service');
    ({ logEvent } = require('../../shared/utils/structured-logger'));
  });

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  test('a question phase of two messages emits one phase_sent with messages:2 and the right kinds', async () => {
    const msgs = [
      { phase: 'question', kind: 'text', body: 'What is 2+2?', role: 'stem' },
      { phase: 'question', kind: 'audio', url: 'https://x/clip.mp3', role: 'question_audio' },
    ];
    const promise = sender.sendPhase('923000000000', msgs, 'question', {
      questionId: 'q1', sessionId: 's1',
    });
    await jest.runAllTimersAsync();
    const res = await promise;

    expect(res).toEqual({ sent: 2, failed: 0, pickerFailed: false });
    const events = eventsNamed(logEvent, 'video_quiz.phase_sent');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      phase: 'question', sessionId: 's1', questionId: 'q1',
      messages: 2, sent: 2, failed: 0, pickerFailed: false,
      kinds: ['text', 'audio'],
    });
  });

  test('the decomposition holds: msSending + msThrottled + msGaps ~= ms', async () => {
    const msgs = [
      { phase: 'question', kind: 'text', body: 'Q', role: 'stem' },
      { phase: 'question', kind: 'audio', url: 'https://x/clip.mp3', role: 'question_audio' },
    ];
    const promise = sender.sendPhase('923000000000', msgs, 'question', {
      questionId: 'q1', sessionId: 's1',
    });
    await jest.runAllTimersAsync();
    await promise;

    const [event] = eventsNamed(logEvent, 'video_quiz.phase_sent');
    // Every WhatsApp call in this test resolves on the same tick (no fake-
    // timer advance), so msSending is 0 and the whole phase time is throttle
    // wait (2 x 50ms) plus our own GAP_TEXT_MS/GAP_MEDIA_MS pacing.
    expect(event.msThrottled).toBe(100);
    expect(event.msGaps).toBe(sender.GAP_TEXT_MS + sender.GAP_MEDIA_MS);
    expect(event.msSending).toBe(0);
    const sum = event.msSending + event.msThrottled + event.msGaps;
    expect(Math.abs(event.ms - sum)).toBeLessThanOrEqual(5);
  });

  test('a picker failure still emits phase_sent with pickerFailed:true', async () => {
    WhatsAppService.sendInteractiveButtons.mockResolvedValueOnce(false);
    const msgs = [
      { phase: 'interaction', kind: 'buttons', role: 'ask', options: ['A', 'B'] },
    ];
    const promise = sender.sendPhase('923000000000', msgs, 'interaction', {
      questionId: 'q1', sessionId: 's1',
    });
    await jest.runAllTimersAsync();
    const res = await promise;

    expect(res.pickerFailed).toBe(true);
    const [event] = eventsNamed(logEvent, 'video_quiz.phase_sent');
    expect(event).toMatchObject({
      phase: 'interaction', messages: 1, sent: 0, failed: 1, pickerFailed: true,
    });
  });
});

// ─── handleAnswer: video_quiz.answer_latency ────────────────────────────────
describe('handleAnswer emits video_quiz.answer_latency', () => {
  let supabase;
  let redisService;
  let render;
  let vq;
  let logEvent;
  let currentQuestion;

  beforeAll(() => {
    jest.resetModules();
    jest.doMock('../../shared/config/supabase', () => ({ from: jest.fn() }));
    jest.doMock('../../shared/services/cache/railway-redis.service', () => ({
      get: jest.fn(), set: jest.fn().mockResolvedValue(true), delete: jest.fn().mockResolvedValue(true),
      setNX: jest.fn().mockResolvedValue(true),
    }));
    jest.doMock('../../shared/services/whatsapp.service', () => ({
      sendMessage: jest.fn().mockResolvedValue(true),
    }));
    jest.doMock('../../shared/services/quiz/video-quiz-render.service', () => ({
      build: jest.fn(() => ({})),
      parseAnswer: jest.fn(),
      correctIndices: jest.fn(),
    }));
    jest.doMock('../../shared/services/quiz/video-quiz-sender.service', () => ({
      sendPhase: jest.fn().mockResolvedValue({ sent: 1, failed: 0, pickerFailed: false }),
    }));
    jest.doMock('../../shared/services/quiz/video-quiz-scorecard.service', () => ({
      sendScorecard: jest.fn().mockResolvedValue(true),
    }));
    // A jest.doMock registration is keyed by module path and outlives
    // jest.resetModules() (which only clears the require CACHE, not the mock
    // factory registry) — so without this, the sendPhase describe above's
    // 50ms-throttle mock for this same path would silently leak in here and
    // add a fixed 50ms nobody asked for. Force the real module back.
    jest.doMock('../../shared/services/quiz/video-quiz-rate-limiter.service', () =>
      jest.requireActual('../../shared/services/quiz/video-quiz-rate-limiter.service'));
    jest.doMock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));
    jest.doMock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

    supabase = require('../../shared/config/supabase');
    redisService = require('../../shared/services/cache/railway-redis.service');
    render = require('../../shared/services/quiz/video-quiz-render.service');
    vq = require('../../shared/services/quiz/video-quiz.service');
    ({ logEvent } = require('../../shared/utils/structured-logger'));
  });

  function stubSupabase({ insertError = null } = {}) {
    // Lane I: the finished/index derivation reads `quiz_answers` back
    // (nextIndexFromTruth), so this table has to actually accumulate what
    // gets inserted rather than always answering an empty `[]` — the
    // catch-all chain below still does that for every OTHER table.
    const answers = [];
    supabase.from.mockImplementation((table) => {
      if (table === 'quiz_answers') {
        const chain = {
          insert: async (row) => {
            if (insertError) return { error: insertError };
            answers.push(row);
            return { error: null };
          },
          select: () => chain,
          eq: async () => ({
            data: answers.map((a) => ({ question_id: a.question_id, is_correct: a.is_correct })),
            error: null,
          }),
        };
        return chain;
      }
      const chain = {
        select: () => chain,
        eq: () => chain,
        insert: async () => ({ error: insertError }),
        update: () => chain,
        // Lane A's guarded counter write ends .update().eq().or(...) — the
        // chain has to be awaitable at that link too, not just at .eq().
        or: async () => ({ data: null, error: null }),
        single: async () => ({ data: currentQuestion, error: null }),
        maybeSingle: async () => ({ data: { topic: 't', grade: 3, subject: 'Math' }, error: null }),
        then: (resolve) => resolve({ data: [], error: null }),
      };
      return chain;
    });
  }

  function freshState({ questionIds = ['q1', 'q2'] } = {}) {
    return {
      sessionId: 'sess-1', quizId: 'qz1', language: 'en',
      questionIds, index: 0, correct: 0, answered: 0,
      currentQuestionId: 'q1', sentAt: Date.now(),
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    currentQuestion = {
      id: 'q1', question_text: 'x', option_a: 'a', option_b: 'b',
      correct_option: 'A', media: {}, render_pattern: 'P1',
    };
    stubSupabase();
    render.parseAnswer.mockReturnValue({ questionId: 'q1', index: 0 });
    render.correctIndices.mockReturnValue([0]);
    redisService.get.mockResolvedValue(freshState());
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  test('emits exactly one answer_latency with both durations, media:"none" (not the last question)', async () => {
    const promise = vq.handleAnswer('923000000000', 'vq_q1_0');
    await jest.runAllTimersAsync();
    await promise;

    const events = eventsNamed(logEvent, 'video_quiz.answer_latency');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      sessionId: 'sess-1', questionId: 'q1', isCorrect: true,
      msPause: 1200, media: 'none', finished: false,
    });
    expect(typeof events[0].msToFeedback).toBe('number');
    // Nothing in this fully-mocked chain consumes fake time except the
    // hardcoded 1200ms pause, so the two clocks are exactly that.
    expect(events[0].msToFeedback).toBe(0);
    expect(events[0].msToNextQuestion).toBe(1200);
  });

  test('media:"card" when the question row carries a question_card', async () => {
    currentQuestion = { ...currentQuestion, media: { question_card: 'https://x/card.png' } };
    const promise = vq.handleAnswer('923000000000', 'vq_q1_0');
    await jest.runAllTimersAsync();
    await promise;

    const [event] = eventsNamed(logEvent, 'video_quiz.answer_latency');
    expect(event.media).toBe('card');
  });

  test('the last question emits finished:true with msToNextQuestion at the documented value', async () => {
    redisService.get.mockResolvedValue(freshState({ questionIds: ['q1'] }));
    const promise = vq.handleAnswer('923000000000', 'vq_q1_0');
    await jest.runAllTimersAsync();
    await promise;

    const [event] = eventsNamed(logEvent, 'video_quiz.answer_latency');
    expect(event.finished).toBe(true);
    expect(event.msToNextQuestion).toBe(1200);
  });

  test('the 23505 reconcile path emits no answer_latency (that tap delivered no verdict)', async () => {
    stubSupabase({ insertError: { code: '23505' } });
    const promise = vq.handleAnswer('923000000000', 'vq_q1_0');
    await jest.runAllTimersAsync();
    await promise;

    expect(eventsNamed(logEvent, 'video_quiz.answer_latency')).toHaveLength(0);
  });
});
