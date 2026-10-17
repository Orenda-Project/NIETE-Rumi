/**
 * The quiz follow-up service logs the teacher's keyed reference (tk) and a masked phone, never the raw user id or
 * the full sender phone.
 */
const KEY = 'k'.repeat(40);
const PHONE = '92' + '000000' + '4321';

const mockLog = jest.fn();
const mockRedis = { redis: { get: jest.fn(), del: jest.fn() } };
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: (...a) => mockLog(...a) }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({ sendMessage: jest.fn() }));
jest.mock('../../bot/shared/services/cache/railway-redis.service', () => mockRedis);
jest.mock('../../bot/shared/services/quiz/quiz-insight.service', () => ({}));
jest.mock('../../bot/shared/config/supabase', () => ({}));

const payloadOf = (re) => (mockLog.mock.calls.find(([m]) => re.test(m)) || [])[1];

describe('quiz follow-up log lines', () => {
  beforeEach(() => { process.env.WEB_QUIZ_KID_KEY = KEY; jest.clearAllMocks(); });
  afterAll(() => { delete process.env.WEB_QUIZ_KID_KEY; });

  it('a next-topic reply logs tk and the last 4 digits of the phone, not userId or the full phone', async () => {
    const { tk } = require('../../bot/shared/services/quiz/web-quiz-kid');
    const svc = require('../../bot/shared/services/quiz/quiz-follow-up.service');
    mockRedis.redis.get.mockResolvedValueOnce(JSON.stringify({ kind: 'revision_only', priorTopic: 'fractions' }));
    await expect(svc.handleNextTopicReply('teacher-1', PHONE, 'en', 'decimals')).resolves.toBe(true);
    const p = payloadOf(/retired_freeform_lp/);
    expect(p).toEqual(expect.objectContaining({ tk: tk('teacher-1'), from: '4321', kind: 'revision_only', nextTopic: 'decimals' }));
    expect(p.tk).toMatch(/^[0-9a-f]{16}$/);
    expect(p).not.toHaveProperty('userId');
  });

  it('a button tap without a user logs the last 4 digits of the sender phone only', async () => {
    const svc = require('../../bot/shared/services/quiz/quiz-follow-up.service');
    await svc.handleFollowUpButton('quiz_followup_x', null, PHONE);
    expect(payloadOf(/without registered user/)).toEqual({ buttonId: 'quiz_followup_x', from: '4321' });
  });
});
