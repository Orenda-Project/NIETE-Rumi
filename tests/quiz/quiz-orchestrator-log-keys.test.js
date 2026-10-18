/**
 * The quiz orchestrator logs the teacher's keyed reference (tk), never the raw user id.
 */
const KEY = 'k'.repeat(40);

const mockLog = jest.fn();
const mockQuery = { select: () => mockQuery, eq: () => mockQuery, limit: async () => ({ data: [] }) };
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: (...a) => mockLog(...a) }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({ sendMessage: jest.fn() }));
jest.mock('../../bot/shared/services/cache/railway-redis.service', () => ({}));
jest.mock('../../bot/shared/services/conversation-state.service', () => ({}));
jest.mock('../../bot/shared/config/supabase', () => ({ from: () => mockQuery }));

describe('quiz orchestrator log lines', () => {
  beforeEach(() => { process.env.WEB_QUIZ_KID_KEY = KEY; jest.clearAllMocks(); });
  afterAll(() => { delete process.env.WEB_QUIZ_KID_KEY; });

  it('the quiz offer after a report logs tk, not userId', async () => {
    const { tk } = require('../../bot/shared/services/quiz/web-quiz-kid');
    const QuizOrchestrator = require('../../bot/shared/services/quiz/quiz-orchestrator.service');
    await QuizOrchestrator.offerQuizAfterReport({ id: 'teacher-1' }, '92' + '000000' + '4321', 'lp-1', 'fractions');
    const [, p] = mockLog.mock.calls.find(([m]) => /offerQuizAfterReport$/.test(m));
    expect(p).toEqual({ tk: tk('teacher-1'), lessonPlanId: 'lp-1', topic: 'fractions' });
    expect(p.tk).toMatch(/^[0-9a-f]{16}$/);
    expect(p).not.toHaveProperty('userId');
  });
});
