'use strict';
/**
 * The /quiz turn through the REAL handleTextMessage (the mock set of the registration tests): with quiz_one_door ON
 *  - the turn sends ONE reply: the registration Flow is never the second message (RED on the base: an unknown phone's
 *    /quiz is followed by offerRegistrationOnce — 2 replies);
 *  - the class line's `quiz` and the card's `quiz please` / «کوئز دکھائیں» reach the door; the bot's own name
 *    `jugnu` / «جگنو» does NOT (it stays the general bot's, ON or OFF);
 *  - the door does not depend on TRANSCRIPT_QUIZ_ENABLED; the quiz topic-reply window lets /quiz pass;
 *  - the one door receives the words that asked (its script rule and src).
 * With it OFF every one of these is today's (the same assertions the base passes).
 */
const { fixturePhone } = require('../quiz/web-quiz/fixture-phone');
process.env.REGISTRATION_FLOW_ID = '2010172012940869';
process.env.TRANSCRIPT_QUIZ_ENABLED = 'true';

// --- top-level dep mocks (dep-load order at the top of the handler) ---
jest.mock('../../shared/services/whatsapp.service', () => ({
  startContinuousTypingIndicator: jest.fn(() => ({ stop: jest.fn() })),
  sendMessage: jest.fn().mockResolvedValue(true),
  sendFlow: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  sendLanguageSelectionList: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../shared/services/openai.service', () => ({}));
jest.mock('../../shared/services/content.service', () => ({}));
jest.mock('../../shared/services/language-detector.service', () => ({
  detectLanguage: jest.fn(() => null),
}));
jest.mock('../../shared/services/feature-registration.service', () => ({
  isPendingName: jest.fn().mockResolvedValue(false),
  countUserFeatures: jest.fn().mockResolvedValue(0),
  sendNameQuestion: jest.fn().mockResolvedValue(undefined),
  handleNameResponse: jest.fn().mockResolvedValue({ success: true, firstName: 'X' }),
}));
jest.mock('../../shared/services/context.service', () => ({}));
jest.mock('../../shared/services/cache/railway-redis.service', () => ({
  redis: {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
  },
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue('OK'),
}));
jest.mock('../../shared/services/coaching-orchestrator.service', () => ({}));
jest.mock('../../shared/services/menu.service', () => ({ sendMenu: jest.fn() }));
jest.mock('../../shared/services/helper-agent.service', () => ({
  detectCapabilityInquiry: jest.fn().mockResolvedValue({ detected: false }),
}));
jest.mock('../../shared/handlers/portal-command.handler', () => ({ handlePortalCommand: jest.fn() }));
jest.mock('../../shared/services/reading-assessment.service', () => ({}));
jest.mock('../../shared/services/feature-linker.service', () => ({}));
jest.mock('../../shared/services/feature-intro.service', () => ({}));
jest.mock('../../shared/services/lesson-plan-queue.service', () => ({}));
jest.mock('../../shared/services/lp-feedback.service', () => ({
  consumeReasonIfPending: jest.fn().mockResolvedValue(false),
}));
jest.mock('../../shared/handlers/lesson-plan-v2.handler', () => jest.fn());
jest.mock('../../shared/services/region-features.service', () => ({
  getRegionFeatures: jest.fn().mockResolvedValue({}),
}));
jest.mock('../../shared/utils/region', () => ({ getUserRegion: jest.fn(() => 'niete') }));
jest.mock('../../shared/services/video/video-orchestrator.service', () => ({
  checkAwaitingTopic: jest.fn().mockResolvedValue(null),
  checkAwaitingCustomization: jest.fn().mockResolvedValue(null),
}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../shared/utils/constants', () => ({
  TEMP_DIR: '/tmp', LOADING_STICKER_PATH: '', LOADING_STICKER_MEDIA_ID: '',
  OPENAI_API_KEY: '', ATTENDANCE_SETUP_FLOW_ID: '', ATTENDANCE_MARKING_FLOW_ID: '',
}));
jest.mock('../../shared/services/llm-client', () => ({ getClient: () => ({}) }));
jest.mock('../../shared/utils/language-detector', () => ({
  detectLanguageOverride: jest.fn(() => null),
  isMarketLanguage: jest.fn(() => false),
}));
jest.mock('../../shared/utils/language-cache', () => ({
  getUserLanguage: jest.fn().mockResolvedValue('en'),
  setUserLanguage: jest.fn(),
}));
jest.mock('../../shared/utils/language-detection', () => ({
  detectRequestedLanguage: jest.fn(() => null),
  parseSubjectAndGrade: jest.fn(() => ({})),
}));
jest.mock('../../shared/database/bot-helpers', () => ({
  getOrCreateUser: jest.fn(),
  getOrCreateSession: jest.fn().mockResolvedValue('session-1'),
  updateSessionType: jest.fn(),
  storeConversation: jest.fn().mockResolvedValue(undefined),
  storeLessonPlan: jest.fn(),
}));
jest.mock('../../shared/config/supabase', () => {
  const chain = {};
  ['from', 'select', 'eq', 'in', 'order', 'limit', 'update', 'insert', 'upsert',
   'delete', 'not', 'gte', 'lte', 'is'].forEach((m) => { chain[m] = jest.fn(() => chain); });
  chain.single = jest.fn(() => Promise.resolve({ data: null, error: { code: 'PGRST116' } }));
  chain.maybeSingle = jest.fn(() => Promise.resolve({ data: null, error: null }));
  chain.then = (resolve) => Promise.resolve({ data: null, error: null }).then(resolve);
  return chain;
});
jest.mock('../../shared/handlers/homework-trigger', () => ({
  evaluateHomeworkTrigger: jest.fn(() => ({ match: false })),
}));

// --- inline-required (lazy) modules on the text path — all fall-through ---
jest.mock('../../shared/services/quiz/quiz-session.service', () => ({
  getPostQuizState: jest.fn().mockResolvedValue(null),
  getActiveState: jest.fn().mockResolvedValue(null),
}));
jest.mock('../../shared/services/training/capstone-delivery.service', () => ({
  routeTextAnswer: jest.fn().mockResolvedValue(false),
}));
jest.mock('../../shared/services/student-video-feedback.service', () => ({
  consumeReasonIfPending: jest.fn().mockResolvedValue(false),
}));
jest.mock('../../shared/services/observe/observe-gate', () => ({
  isSchoolLeader: jest.fn(() => false),
  OBSERVE_TRIGGER_RX: /^\/observe\b/i,
  evaluateObserveTrigger: jest.fn(() => ({ match: false })),
}));
jest.mock('../../shared/handlers/observe-command.handler', () => ({
  handleObserveCommand: jest.fn().mockResolvedValue(false),
}));
jest.mock('../../shared/handlers/exam-checker.handler', () => ({
  handleExamText: jest.fn().mockResolvedValue({ handled: false }),
}));
jest.mock('../../shared/services/quiz/quiz-follow-up.service', () => ({
  getAwaitingState: jest.fn().mockResolvedValue(null),
}));
jest.mock('../../shared/services/redis-comprehension.service', () => ({
  findActiveFlowByUser: jest.fn().mockResolvedValue(null),
}));


const mockOpenQuizMenu = jest.fn(async () => 'one_door');
jest.mock('../../shared/services/quiz/quiz-menu-entry.service', () => ({ openQuizMenu: (...a) => mockOpenQuizMenu(...a) }));
const mockOffer = jest.fn(async () => true);
jest.mock('../../shared/services/registration-invite.service', () => ({ offerRegistrationOnce: (...a) => mockOffer(...a) }));
let mockOneDoor = false;
jest.mock('../../shared/services/first-touch/one-door.flags', () => ({ on: jest.fn(async () => mockOneDoor), flags: jest.fn(async () => ({ on: mockOneDoor, ownCap: 20, eventsV3: false, teacherHome: false })) }));
const mockTopic = jest.fn(async () => true);
jest.mock('../../shared/services/quiz/quiz-orchestrator.service', () => ({ handleTopicReply: (...a) => mockTopic(...a), initiateQuizRequest: jest.fn(async () => true) }));
jest.mock('../../shared/services/conversation-state.service', () => ({
  getState: jest.fn(async () => null), clearState: jest.fn(async () => true), setState: jest.fn(async () => true),
}));
jest.mock('../../shared/services/app-redirect.service', () => ({ redirectToApp: jest.fn(async () => false), redirectIfFlagged: jest.fn(async () => false) }));

const ConversationState = require('../../shared/services/conversation-state.service');
const { handleTextMessage } = require('../../shared/handlers/text-message.handler');

const FROM = fixturePhone(1234567);
const MESSAGE = { id: 'wamid.one-door.test' };
const UNKNOWN = {
  id: 'user-uuid-new', phone_number: FROM, first_name: null, name: null, role: null, preferred_language: 'en',
  registration_completed: false, registration_pending_name: false,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockOneDoor = false;
  process.env.TRANSCRIPT_QUIZ_ENABLED = 'true';
});

describe('switch OFF — today', () => {
  test('an unknown phone\'s /quiz: the quiz entry, THEN the registration Flow offer (2 replies)', async () => {
    await handleTextMessage(MESSAGE, FROM, '/quiz', { ...UNKNOWN });
    expect(mockOpenQuizMenu).toHaveBeenCalledTimes(1);
    expect(mockOpenQuizMenu.mock.calls[0][0]).not.toHaveProperty('body');
    expect(mockOffer).toHaveBeenCalledTimes(1);
  });

  test('`jugnu` is not a quiz request', async () => {
    // not a quiz request: it walks on into the rest of the handler (outside this file's fakes) — only the door matters here
    await handleTextMessage(MESSAGE, FROM, 'jugnu', { ...UNKNOWN }).catch(() => {});
    expect(mockOpenQuizMenu).not.toHaveBeenCalled();
  });
});

describe('switch ON — the one door', () => {
  beforeEach(() => { mockOneDoor = true; });

  test('RED on the base: an unknown phone\'s /quiz → the one entry with the words, and NO registration Flow after it', async () => {
    await handleTextMessage(MESSAGE, FROM, '/quiz', { ...UNKNOWN });
    expect(mockOpenQuizMenu).toHaveBeenCalledTimes(1);
    expect(mockOpenQuizMenu.mock.calls[0][0]).toMatchObject({ from: FROM, trigger: 'text', body: '/quiz' });
    expect(mockOffer).not.toHaveBeenCalled();
  });

  test.each(['jugnu', 'جگنو'])('%s (the bot\'s own name) is not a quiz request: no door, ON as OFF', async (word) => {
    await handleTextMessage(MESSAGE, FROM, word, { ...UNKNOWN }).catch(() => {});
    expect(mockOpenQuizMenu).not.toHaveBeenCalled();
  });

  test.each(['quiz please', 'کوئز دکھائیں', 'quiz', 'کوئز'])('%s → the one entry, no registration Flow', async (word) => {
    await handleTextMessage(MESSAGE, FROM, word, { ...UNKNOWN });
    expect(mockOpenQuizMenu).toHaveBeenCalledTimes(1);
    expect(mockOpenQuizMenu.mock.calls[0][0].body).toBe(word);
    expect(mockOffer).not.toHaveBeenCalled();
  });

  test('the door does not depend on TRANSCRIPT_QUIZ_ENABLED', async () => {
    process.env.TRANSCRIPT_QUIZ_ENABLED = 'false';
    await handleTextMessage(MESSAGE, FROM, 'quiz', { ...UNKNOWN });
    expect(mockOpenQuizMenu).toHaveBeenCalledTimes(1);
  });

  test('a quiz topic-reply window open → /quiz still reaches the door (the window stays for its real answer)', async () => {
    ConversationState.getState.mockResolvedValue({ flow: 'quiz', step: 'awaiting_topic', payload: {} });
    await handleTextMessage(MESSAGE, FROM, '/quiz', { ...UNKNOWN });
    expect(mockTopic).not.toHaveBeenCalled();
    expect(mockOpenQuizMenu).toHaveBeenCalledTimes(1);
  });

  test('a sentence about a quiz is not a quiz request (no door)', async () => {
    await handleTextMessage(MESSAGE, FROM, 'jugnu what is photosynthesis', { ...UNKNOWN }).catch(() => {});
    expect(mockOpenQuizMenu).not.toHaveBeenCalled();
  });
});
