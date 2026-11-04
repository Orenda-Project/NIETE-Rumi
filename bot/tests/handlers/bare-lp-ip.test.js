'use strict';
/**
 * bd-xw56ed.7 — a bare «IP» is a bare «LP» typed with a capital I, and opens the lesson-plan catalogue at the bare-LP
 * door, through the REAL handleTextMessage (the mock set of first-touch/reg-after-plan-turn.test.js).
 *
 * Before: «IP» and «/IP» missed the exact door (lp-intent BARE), fell to the menu-match classifier, and were answered
 * «not sure» + the menu — on sandbox (4 Nov 2026) and production (21 and 27 Oct). «Ip» and «/Ip» reached lesson plans
 * only because the classifier guessed them.
 * Guard: a message that only MENTIONS IP («What is my IP address?») is not a command and still goes to the classifier.
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
const mockDetectIntent = jest.fn(async () => ({ type: 'general_chat' }));
jest.mock('../../shared/services/openai.service', () => ({ detectIntent: (...a) => mockDetectIntent(...a) }));
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
const mockAwaitingTopic = jest.fn(async () => null);
jest.mock('../../shared/services/menu.service', () => ({
  sendMenu: jest.fn(), checkAwaitingLessonPlanTopic: (...a) => mockAwaitingTopic(...a), clearAwaitingLessonPlanTopic: jest.fn(async () => true),
}));
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


const mockOpenLp = jest.fn(async () => true);
jest.mock('../../shared/services/lp-browse-entry.service', () => ({ openLpBrowseFlow: (...a) => mockOpenLp(...a) }));

const { handleTextMessage } = require('../../shared/handlers/text-message.handler');

const FROM = fixturePhone(1234568);
const MESSAGE = { id: 'wamid.bare-lp-ip.test' };
const NEW_TEACHER = {
  id: 'user-uuid-new', phone_number: FROM, first_name: null, name: null, role: null, preferred_language: 'ur',
  registration_completed: false, registration_pending_name: false,
};
const ORIG = { flow: process.env.PAKISTAN_LP_FLOW_ID, sw: process.env.REGISTRATION_AFTER_PLAN };

beforeEach(() => {
  jest.clearAllMocks();
  mockOneDoor = false;
  process.env.PAKISTAN_LP_FLOW_ID = '1565529551677911';
  delete process.env.REGISTRATION_AFTER_PLAN;
});
afterAll(() => {
  for (const [k, v] of [['PAKISTAN_LP_FLOW_ID', ORIG.flow], ['REGISTRATION_AFTER_PLAN', ORIG.sw]]) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});

describe.each(['IP', '/IP', 'Ip', '/Ip', 'ip'])('«%s» on its own', (text) => {
  test('opens the lesson-plan catalogue at the bare-LP door, without asking the classifier', async () => {
    // A miss falls through to the chat path, which this mock set does not carry; the door is what is asserted.
    await handleTextMessage(MESSAGE, FROM, text, { ...NEW_TEACHER }).catch(() => {});
    expect(mockOpenLp).toHaveBeenCalledTimes(1);
    expect(mockOpenLp.mock.calls[0][0]).toMatchObject({ from: FROM, reason: 'bare_command' });
    expect(mockDetectIntent).not.toHaveBeenCalled();
  });
});

describe.each(['What is my IP address?', 'IP address', 'IPs'])('«%s» (mentions IP, is not the command)', (text) => {
  test('never takes the bare-LP door; the classifier decides', async () => {
    // The classifier's answer leads on to the chat path, which this mock set does not carry; the door is what is asserted.
    await handleTextMessage(MESSAGE, FROM, text, { ...NEW_TEACHER }).catch(() => {});
    expect(mockOpenLp.mock.calls.filter((c) => c[0] && c[0].reason === 'bare_command')).toHaveLength(0);
    expect(mockDetectIntent).toHaveBeenCalledWith(text, expect.anything(), expect.anything());
  });
});
