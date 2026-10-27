'use strict';
/**
 * The chat share's mint names the teacher on its log line by the keyed reference (tk), never the raw users.id —
 * the same event the maker's mint (maker.bank.js) logs, with the same fields.
 */
process.env.WEB_QUIZ_KID_KEY = 'unit-kid-key-not-a-secret-0123456789';
jest.mock('../../shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../shared/services/cache/railway-redis.service', () => ({
  get: jest.fn(), set: jest.fn().mockResolvedValue(true), delete: jest.fn(),
}));
jest.mock('../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../shared/services/quiz/web-quiz-link', () => ({
  quizLink: jest.fn().mockResolvedValue('https://example.test/q/ABC234'),
}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const { installFrom } = require('../../../tests/quiz/helpers/supabase-chain');
const supabase = require('../../shared/config/supabase');
const { logEvent } = require('../../shared/utils/structured-logger');
const Share = require('../../shared/services/quiz/video-quiz-share.service');
const { tk: tkOf } = require('../../shared/services/quiz/web-quiz-kid');

beforeEach(() => {
  jest.clearAllMocks();
  installFrom(supabase.from, {
    users: { data: [{ name: 'Teacher' }], error: null },
    quizzes: { data: [{ topic: 'Fractions' }], error: null },
    quiz_share_codes: { data: [{ id: 'sc-1', code: 'ABC234' }], error: null },
  });
});

test('share_code_minted carries tk, never the raw teacher id', async () => {
  const minted = await Share.sendClassLink({ userId: 'u1', quizId: 'q1', videoId: 'v1', language: 'en' }, '92' + '000000' + '0001');
  expect(minted).toEqual({ id: 'sc-1', code: 'ABC234' });

  const ev = logEvent.mock.calls.find(([e]) => e === 'video_quiz.share_code_minted');
  expect(ev[1]).toEqual({ tk: tkOf('u1'), quizId: 'q1', code: 'ABC234', classBound: false });
  expect(ev[1].tk).toMatch(/^[0-9a-f]{16}$/);
  expect(ev[1]).not.toHaveProperty('userId');
});
