'use strict';
/**
 * The maker page's Test-paper card pre-types a word into WhatsApp. That word has to open today's assessment door.
 *
 * The word is the REAL card word (CARDS 'exam' -> str('mk.card.exam.word', l)), not a copy. It is sent through
 * the REAL handleTextMessage, the way a teacher might send it (as typed, with spaces, in upper case), and the
 * boundary just after the door, assessment-entry.service's openAssessmentFlow, must be called exactly once, with
 * no other feature door (menu, exam checker, lesson plan, general chat) reached.
 *
 * The negative: the card's TITLE ("Test Paper", the real menu row title) sent as text does NOT open the door,
 * so the card must pre-type the word, not the title.
 *
 * Mock set: the one the reversed-slash-command handler suite uses (boundaries only), plus the assessment entry
 * service (the boundary after the door) and the general-chat calls on openai.service.
 */

process.env.REGISTRATION_FLOW_ID = '2010172012940869'; // published "Registration v4"

// --- top-level dep mocks (dep-load order at the top of the handler) ---
jest.mock('../../shared/services/whatsapp.service', () => ({
  startContinuousTypingIndicator: jest.fn(() => ({ stop: jest.fn() })),
  sendMessage: jest.fn().mockResolvedValue(true),
  sendFlow: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  sendLanguageSelectionList: jest.fn().mockResolvedValue(true),
}));
// The general-chat boundary: the door under test must return before any of these run.
jest.mock('../../shared/services/openai.service', () => ({
  detectIntent: jest.fn().mockResolvedValue({ intent: 'general' }),
  getResponseWithFormat: jest.fn().mockResolvedValue('ok'),
  getConversationHistory: jest.fn().mockResolvedValue([]),
}));
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
// checkAwaitingLessonPlanTopic sits far below the assessment door (the general-text path): the negative uses it
// to prove the title went PAST the door line rather than stopping before it.
jest.mock('../../shared/services/menu.service', () => ({
  sendMenu: jest.fn().mockResolvedValue(undefined),
  checkAwaitingLessonPlanTopic: jest.fn().mockResolvedValue(null),
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
  handleObserveCommand: jest.fn().mockResolvedValue(true),
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

// The teacher-app redirect: off (not redirected), so the door itself runs.
jest.mock('../../shared/services/app-redirect.service', () => ({
  redirectIfFlagged: jest.fn().mockResolvedValue(false),
}));


jest.mock('../../shared/services/assessment-entry.service', () => ({
  openAssessmentFlow: jest.fn().mockResolvedValue(undefined),
}));

const OpenAIService = require('../../shared/services/openai.service');
const { redirectIfFlagged } = require('../../shared/services/app-redirect.service');
const MenuService = require('../../shared/services/menu.service');
const { handleExamText } = require('../../shared/handlers/exam-checker.handler');
const lessonPlanV2 = require('../../shared/handlers/lesson-plan-v2.handler');
const { openAssessmentFlow } = require('../../shared/services/assessment-entry.service');
const { resolveUx } = require('../../shared/config/ux-strings');
const { str } = require('../../shared/services/first-touch/maker.strings');
const { CARDS } = require('../../shared/services/first-touch/cards.page');
const { handleTextMessage } = require('../../shared/handlers/text-message.handler');

const FROM = ['92', '0000', '000001'].join(''); // synthetic sender, built from parts (no phone-shaped literal)
const MESSAGE = { id: 'wamid.maker-cards-assessment-door.test' };
const teacher = () => ({
  id: 'user-uuid-maker-cards-assessment',
  phone_number: FROM,
  first_name: 'Teacher',
  role: 'teacher',
  preferred_language: 'en',
  registration_completed: true,
  registration_pending_name: false,
});

const EXAM_CARD = CARDS.find((c) => c.card === 'exam');
const examWord = (l) => str(EXAM_CARD.word, l);

function expectNoOtherDoor() {
  expect(MenuService.sendMenu).not.toHaveBeenCalled();
  expect(MenuService.checkAwaitingLessonPlanTopic).not.toHaveBeenCalled();
  expect(handleExamText).not.toHaveBeenCalled();
  expect(lessonPlanV2).not.toHaveBeenCalled();
  expect(OpenAIService.detectIntent).not.toHaveBeenCalled();
  expect(OpenAIService.getResponseWithFormat).not.toHaveBeenCalled();
}

beforeEach(() => { jest.clearAllMocks(); redirectIfFlagged.mockResolvedValue(false); });

describe('the Test-paper card word reaches the assessment door', () => {
  test('the exam card pre-types mk.card.exam.word, and its value is "/assessment" in en and ur', () => {
    expect(EXAM_CARD.word).toBe('mk.card.exam.word');
    expect(examWord('en')).toBe('/assessment');
    expect(examWord('ur')).toBe('/assessment');
  });

  test.each([
    ['en', 'as pre-typed', (w) => w],
    ['ur', 'as pre-typed', (w) => w],
    ['en', 'with surrounding spaces', (w) => ` ${w} `],
    ['en', 'as " /Assessment "', (w) => ` ${w.charAt(0)}${w.charAt(1).toUpperCase()}${w.slice(2)} `],
    ['en', 'in upper case', (w) => w.toUpperCase()],
    ['ur', 'between a newline and a tab', (w) => `\n${w}\t`],
  ])('the %s card word, sent %s, opens the assessment door once', async (lang, _how, shape) => {
    const typed = shape(examWord(lang));
    await handleTextMessage(MESSAGE, FROM, typed, teacher());
    expect(openAssessmentFlow).toHaveBeenCalledTimes(1);
    expect(openAssessmentFlow).toHaveBeenCalledWith(expect.objectContaining({
      from: FROM, userId: 'user-uuid-maker-cards-assessment', reason: 'command',
    }));
    expect(redirectIfFlagged).toHaveBeenCalledWith('assessment_generator', expect.objectContaining({ reason: 'command' }));
    expectNoOtherDoor();
  });

  test.each([['en'], ['ur']])('the %s card TITLE sent as text does NOT open the assessment door', async (lang) => {
    const title = EXAM_CARD.title(lang);
    expect(title).toBe(resolveUx('menuRowAssessmentTitle', { language: lang }));
    if (lang === 'en') expect(title).toBe('Test Paper');
    // It falls through to later doors / general chat; a throw there is fine, the door must stay shut.
    await handleTextMessage(MESSAGE, FROM, title, teacher()).catch(() => {});
    expect(MenuService.checkAwaitingLessonPlanTopic).toHaveBeenCalled(); // went past the assessment door
    expect(openAssessmentFlow).not.toHaveBeenCalled();
  });
});
