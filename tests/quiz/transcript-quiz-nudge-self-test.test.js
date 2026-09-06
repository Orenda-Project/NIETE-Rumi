'use strict';
/**
 * PLAN_R5 §1 D8 — the nudge's `started` count decides whether a teacher is
 * told "only N children have started". Her own test run of the class link
 * must never count toward NUDGE_BELOW.
 */
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const supabase = require('../../bot/shared/config/supabase');
const WhatsAppService = require('../../bot/shared/services/whatsapp.service');
const { installFrom } = require('./helpers/supabase-chain');
const Nudge = require('../../bot/shared/services/quiz/transcript-quiz-nudge.service');

const QUIZ_ID = 'q1';
const TEACHER_ID = 'u1';

function stub({ sessions, quiz = {} }) {
  return installFrom(supabase.from, {
    quizzes: {
      data: [{
        id: QUIZ_ID, teacher_id: TEACHER_ID, topic: 'Fractions', status: 'sent',
        language: 'en', meta: {}, ...quiz,
      }],
    },
    quiz_sessions: { data: sessions },
    users: { data: [{ phone_number: '923001234567', preferred_language: 'en' }] },
  });
}

beforeEach(() => jest.clearAllMocks());

describe('PLAN_R5 D8 — the nudge count excludes the teacher self-test', () => {
  test('her self-test run does not count toward NUDGE_BELOW, so the nudge still fires', async () => {
    // 1 real child + her self-test = 2 raw rows, which is < NUDGE_BELOW (5)
    // either way — the real assertion is the REPORTED started count, below.
    stub({
      sessions: [
        { quiz_id: QUIZ_ID, user_id: TEACHER_ID },
        { quiz_id: QUIZ_ID, user_id: null },
      ],
    });
    const result = await Nudge.process(QUIZ_ID);
    expect(result.ok).toBe(true);
    expect(result.started).toBe(1);   // the self-test row must not be counted
  });

  test('her self-test run alone must not read as "started" at all', async () => {
    stub({ sessions: [{ quiz_id: QUIZ_ID, user_id: TEACHER_ID }] });
    const result = await Nudge.process(QUIZ_ID);
    expect(result.started).toBe(0);
    expect(WhatsAppService.sendMessage).toHaveBeenCalled();   // still nudges — nobody real has started
  });

  test('with enough REAL children started, the self-test row cannot push it under the nudge threshold', async () => {
    const sessions = [
      { quiz_id: QUIZ_ID, user_id: TEACHER_ID },
      ...Array.from({ length: 5 }, () => ({ quiz_id: QUIZ_ID, user_id: null })),
    ];
    stub({ sessions });
    const result = await Nudge.process(QUIZ_ID);
    expect(result.skipped).toBe('enough_started');
    expect(result.started).toBe(5);
  });
});
