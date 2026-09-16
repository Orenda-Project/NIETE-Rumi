/**
 * The stale-session "Continue coaching" tap must respect the CONFIGURED number
 * of reflective questions.
 *
 * The debrief is configured at one question, and the automatic loop honours it —
 * but the Continue button carried its own hardcoded count from the three-question
 * era, so a teacher who tapped Continue after answering was asked a second
 * question nobody configured. That second question is also the only live reader
 * of the session-scoped reflection language, which is why the two changes ship
 * together.
 *
 * Executes the real tap handler; Supabase and the queue are mocked at the
 * boundary.
 */

jest.mock('../../bot/shared/config/supabase', () => {
  const builder = {
    select: jest.fn(() => builder),
    update: jest.fn(() => builder),
    eq: jest.fn(() => builder),
    single: jest.fn(() => Promise.resolve({ data: global.__CONTINUE_SESSION, error: null })),
    maybeSingle: jest.fn(() => Promise.resolve({ data: global.__CONTINUE_SESSION, error: null })),
    then: (resolve) => resolve({ data: null, error: null }),
  };
  return { from: jest.fn(() => builder) };
});
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('dotenv', () => ({ config: () => ({}) }), { virtual: true });

const mockSendMessage = jest.fn(() => Promise.resolve());
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: (...a) => mockSendMessage(...a),
}));
const mockQueueReport = jest.fn(() => Promise.resolve());
jest.mock('../../bot/shared/services/coaching/coaching-job-queue.service', () => ({
  queueReport: (...a) => mockQueueReport(...a),
}));
jest.mock('../../bot/shared/utils/language-cache', () => ({
  getUserLanguage: jest.fn(() => Promise.resolve('ur')),
  setUserLanguage: jest.fn(),
  DEFAULT_LANGUAGE: 'en',
}));
const mockConduct = jest.fn(() => Promise.resolve());
jest.mock('../../bot/shared/services/coaching/reflective-conversation.service', () => ({
  conductReflectiveConversation: (...a) => mockConduct(...a),
}));

const { handleContinueCoachingTap } =
  require('../../bot/shared/services/coaching/continue-coaching.service');
const { NUM_REFLECTIVE_QUESTIONS } =
  require('../../bot/shared/config/coaching-debrief.config');
const { getCoachingMessage } = require('../../bot/shared/config/coaching-messages');

const SID = 'sess-continue';
const FROM = '923001234567';
const USER = { id: 'u1' };

beforeEach(() => {
  jest.clearAllMocks();
  // The projected shape the read actually asks PostgREST for: the id plus the
  // one JSONB key this tap consumes, aliased.
  global.__CONTINUE_SESSION = {
    id: SID,
    questions_answered: NUM_REFLECTIVE_QUESTIONS,
  };
});

describe('Continue coaching tap', () => {
  test('with every configured question answered it queues the report', async () => {
    await handleContinueCoachingTap({ sessionId: SID, from: FROM, user: USER });

    expect(mockQueueReport).toHaveBeenCalledTimes(1);
    expect(mockQueueReport.mock.calls[0][0]).toBe(SID);
  });

  test('and does NOT reopen the conversation with an unconfigured question', async () => {
    await handleContinueCoachingTap({ sessionId: SID, from: FROM, user: USER });

    expect(mockConduct).not.toHaveBeenCalled();
  });

  test('with questions still outstanding it resumes at the next one', async () => {
    global.__CONTINUE_SESSION.questions_answered = 0;

    await handleContinueCoachingTap({ sessionId: SID, from: FROM, user: USER });

    expect(mockConduct).toHaveBeenCalledTimes(1);
    expect(mockConduct.mock.calls[0][2]).toBe(1);
    expect(mockQueueReport).not.toHaveBeenCalled();
  });

  test('a session that cannot be found says so and touches nothing', async () => {
    global.__CONTINUE_SESSION = null;

    await handleContinueCoachingTap({ sessionId: SID, from: FROM, user: USER });

    expect(mockQueueReport).not.toHaveBeenCalled();
    expect(mockConduct).not.toHaveBeenCalled();
    expect(mockSendMessage).toHaveBeenCalledWith(
      FROM, getCoachingMessage('coaching_sessionNotFound', 'ur'),
    );
  });

  test('the closing message is in her language, not an inline English literal', async () => {
    await handleContinueCoachingTap({ sessionId: SID, from: FROM, user: USER });

    expect(mockSendMessage).toHaveBeenCalledWith(
      FROM, getCoachingMessage('coaching_continueAllAnswered', 'ur'),
    );
    expect(mockSendMessage.mock.calls[0][1]).not.toMatch(/[A-Za-z]{4,}/);
  });
});
