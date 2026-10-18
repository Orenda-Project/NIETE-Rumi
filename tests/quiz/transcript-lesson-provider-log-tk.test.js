'use strict';
/**
 * The recorded-lesson provider's log lines name the teacher by keyed reference (`tk`), never by raw users.id.
 */
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  sendInteractiveMessage: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/services/queue/sqs-queue.service', () => ({ queueJob: jest.fn().mockResolvedValue('m-1') }));
jest.mock('../../bot/shared/services/quiz/transcript-quiz-digest.service', () => ({ run: jest.fn() }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const supabase = require('../../bot/shared/config/supabase');
const { logEvent } = require('../../bot/shared/utils/structured-logger');
const { installFrom } = require('./helpers/supabase-chain');
const { tk: tkOf } = require('../../bot/shared/services/quiz/web-quiz-kid');
const Provider = require('../../bot/shared/services/quiz/transcript-lesson-provider');

const T1 = '11111111-1111-4111-8111-111111111111';
const SID = '22222222-2222-4222-8222-222222222222';
const QID = '33333333-3333-4333-8333-333333333333';
const PHONE = '92' + '000000' + '1222';
const USER = { id: T1, preferred_language: 'en' };
const SESSION = {
  id: SID, user_id: T1, created_at: '2026-09-05T05:00:00Z', transcript_text: 'x'.repeat(3000),
  transcript_language: 'ur', analysis_data: { topic: 'Fractions', subject: 'Urdu' },
};
const SAVED_KEY = process.env.WEB_QUIZ_KID_KEY;
const named = (name) => logEvent.mock.calls.filter(([n]) => n === name).map(([, p]) => p);

beforeEach(() => {
  jest.clearAllMocks();
  process.env.WEB_QUIZ_KID_KEY = 'unit-kid-key-not-a-secret-0123456789';
});
afterAll(() => {
  if (SAVED_KEY === undefined) delete process.env.WEB_QUIZ_KID_KEY; else process.env.WEB_QUIZ_KID_KEY = SAVED_KEY;
});

describe('transcript lesson provider: list_generate names the teacher by tk', () => {
  test('a language chosen on the Flow: list_generate carries tk, not userId', async () => {
    installFrom(supabase.from, ({ coaching_sessions: { data: [SESSION] }, quizzes: { data: [{ id: QID, status: 'failed', meta: {} }] } }));
    await Provider.startTranscriptLesson(USER, SID, { phone: PHONE, quizLanguage: 'ur', via: 'flow' });
    const [p] = named('transcript_quiz.list_generate');
    expect(p).toEqual(expect.objectContaining({ tk: tkOf(T1), quizId: QID }));
    expect(p.tk).toMatch(/^[0-9a-f]{16}$/);
    expect(p).not.toHaveProperty('userId');
  });

  test('a lesson tapped in /quiz with no quiz yet (no language ask): list_generate carries tk, not userId', async () => {
    installFrom(supabase.from, ({
      coaching_sessions: { data: [SESSION] },
      quizzes: (calls) => (calls.some((c) => c[0] === 'insert') ? { data: [{ id: QID }] } : { data: [] }),
    }));
    await Provider.startTranscriptLesson(USER, SID, { phone: PHONE });
    const [p] = named('transcript_quiz.list_generate');
    expect(p).toEqual(expect.objectContaining({ tk: tkOf(T1), quizId: QID, from: 'none' }));
    expect(p).not.toHaveProperty('userId');
  });
});
