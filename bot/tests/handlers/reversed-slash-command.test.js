/**
 * bd-5ls6qy.7 — a slash command typed back the way an Urdu message SHOWED it is still the command.
 *
 * Ahmed (ICT, 8 Oct): the bot's Urdu messages say "… /menu ٹائپ کریں", and WhatsApp paints
 * the bare `/menu` inside right-to-left text as "menu/". Teachers type what they see. In
 * production (niete-logs, 10–13 Oct 2026) 43 reversed "Menu/"-style messages and 76
 * "/ menu" messages from 88 teachers reached the bot, and NONE reached the menu: 110 were
 * answered by the general AI chat, because every command door compares the exact string
 * (`messageBody.toLowerCase() === '/menu'`).
 *
 * These tests drive the REAL handleTextMessage (the mocks are the ones the /register
 * suite uses) and assert the command's own door runs.
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
jest.mock('../../shared/services/menu.service', () => ({ sendMenu: jest.fn().mockResolvedValue(undefined) }));
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

// The teacher-app redirect (bd-fmf24g): off unless a test turns it on.
jest.mock('../../shared/services/app-redirect.service', () => ({
  redirectIfFlagged: jest.fn().mockResolvedValue(false),
}));

const WhatsAppService = require('../../shared/services/whatsapp.service');
const { redirectIfFlagged } = require('../../shared/services/app-redirect.service');
const MenuService = require('../../shared/services/menu.service');
const { handleObserveCommand } = require('../../shared/handlers/observe-command.handler');
const { handleTextMessage } = require('../../shared/handlers/text-message.handler');

const FROM = '923365709413';
const MESSAGE = { id: 'wamid.bd5ls6qy7.test' };
const teacher = () => ({
  id: 'user-uuid-bd5ls6qy7',
  phone_number: FROM,
  first_name: 'Ayesha',
  role: 'teacher',
  preferred_language: 'ur',
  registration_completed: true,
  registration_pending_name: false,
});

beforeEach(() => { jest.clearAllMocks(); redirectIfFlagged.mockResolvedValue(false); });

describe('bd-5ls6qy.7 — /menu typed the way RTL text displayed it opens the menu', () => {
  test('control: "/menu" opens the menu (unchanged)', async () => {
    await handleTextMessage(MESSAGE, FROM, '/menu', teacher());
    expect(MenuService.sendMenu).toHaveBeenCalledTimes(1);
  });

  test.each([
    ['Menu/'],          // the reversed form: 28 messages, 10–13 Oct
    ['menu/'],
    ['Menu /'],
    ['/ menu'],         // slash-space: 74 messages, 10–13 Oct
    ['/ Menu'],
    ['  Menu/  '],
    ['\\menu'],         // backslash: 3 messages, 10\u201313 Oct
    ['\u2066/menu\u2069'], // copied from an isolated Urdu line
    ['\u200F/menu'],
  ])('%j opens the menu', async (typed) => {
    await handleTextMessage(MESSAGE, FROM, typed, teacher());
    expect(MenuService.sendMenu).toHaveBeenCalledTimes(1);
    expect(MenuService.sendMenu.mock.calls[0][0]).toBe(FROM);
  });

  test('a pilot teacher on the app: "Menu/" gets the app link, the same door as "/menu"', async () => {
    // Since 11–12 Oct most /menu taps answer with the teacher-app link (12 Oct: 541 of 570).
    redirectIfFlagged.mockResolvedValue(true);
    await handleTextMessage(MESSAGE, FROM, 'Menu/', teacher());
    expect(redirectIfFlagged).toHaveBeenCalledWith('menu', expect.objectContaining({ reason: 'menu_command' }));
    expect(MenuService.sendMenu).not.toHaveBeenCalled();
  });

  test('"observe/" reaches the /observe door as "/observe"', async () => {
    await handleTextMessage(MESSAGE, FROM, 'observe/', teacher());
    expect(handleObserveCommand).toHaveBeenCalledWith(expect.anything(), FROM, '/observe');
  });

  test.each([
    ['Attendance/menu'],   // a sentence, not a command
    ['menu'],              // bare word: not a slash command (unchanged)
    ['lesson plan/'],      // not a command word
  ])('%j is NOT turned into a command', async (typed) => {
    // It falls through to the general chat, which this suite does not wire up; a throw
    // there is fine — the assertion is only that the menu door did not open.
    await handleTextMessage(MESSAGE, FROM, typed, teacher()).catch(() => {});
    expect(MenuService.sendMenu).not.toHaveBeenCalled();
  });
});
