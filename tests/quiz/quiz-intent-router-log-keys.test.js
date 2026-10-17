/**
 * The quiz intent router logs the teacher's keyed reference (tk) and a masked phone, never the raw user id or the
 * full sender phone.
 */
const KEY = 'k'.repeat(40);
const PHONE = '92' + '000000' + '4321';

const mockLog = jest.fn();
const mockRedis = { get: jest.fn(), set: jest.fn(), del: jest.fn() };
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: (...a) => mockLog(...a) }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({ sendMessage: jest.fn(), sendFlow: jest.fn() }));
jest.mock('../../bot/shared/services/cache/railway-redis.service', () => mockRedis);
jest.mock('../../bot/shared/config/supabase', () => ({}));
jest.mock('../../bot/shared/services/quiz/quiz-readiness.service', () => ({ checkQuizReadiness: jest.fn(async () => ({ gate: 'no_class' })) }));

const payloadOf = (re) => (mockLog.mock.calls.find(([m]) => re.test(m)) || [])[1];

describe('quiz intent router log lines', () => {
  beforeEach(() => { process.env.WEB_QUIZ_KID_KEY = KEY; jest.clearAllMocks(); });
  afterAll(() => { delete process.env.WEB_QUIZ_KID_KEY; });

  it('a resume held back by readiness logs tk, not userId', async () => {
    const { tk } = require('../../bot/shared/services/quiz/web-quiz-kid');
    const router = require('../../bot/shared/services/quiz/quiz-intent-router.service');
    mockRedis.get.mockResolvedValueOnce(JSON.stringify({ topic: 'fractions' }));
    await expect(router.tryResumeAfterClassFlow({ id: 'teacher-1' }, PHONE)).resolves.toBe(false);
    const p = payloadOf(/resume deferred/);
    expect(p).toEqual({ tk: tk('teacher-1'), gate: 'no_class' });
    expect(p.tk).toMatch(/^[0-9a-f]{16}$/);
    expect(p).not.toHaveProperty('userId');
  });

  it('a button tap without a user logs the last 4 digits of the sender phone only', async () => {
    const router = require('../../bot/shared/services/quiz/quiz-intent-router.service');
    await router.handleConfirmationButton('quiz_intent_yes', null, PHONE);
    expect(payloadOf(/without user/)).toEqual({ buttonId: 'quiz_intent_yes', from: '4321' });
  });
});
