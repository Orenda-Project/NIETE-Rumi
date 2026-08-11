/**
 * bd-2447 — `/register` must ALWAYS open the registration Flow
 *
 * Live repro (operator, +92 320 6281951, user 923365709413, role NULL,
 * first_name NULL, 0 completed features): typing `/register` replied with the
 * deprecated deferred-onboarding text ("I'll ask for your name after you try
 * one of my features!") instead of sending the Registration v4 Flow.
 *
 * Root cause: text-message.handler.js /register branch gates the Flow-send
 * path behind `featureCount > 0` — zero-feature unregistered users (and users
 * with no row at all) fall through to the deferred-onboarding guide message.
 * A second adjacent hole: the registration_pending_name intercept (which runs
 * BEFORE the /register branch) swallows "/register" as a name answer.
 *
 * Contract under test (matches the main Rumi bot, where conversational
 * registration is deprecated): for any user who isn't mid-Flow, `/register`
 * ALWAYS sends the registration Flow (env REGISTRATION_FLOW_ID) — regardless
 * of feature count, registration_pending_name, or onboarding gates. The
 * deferred-onboarding guide still fires for NON-command feature-first inputs
 * (plain-text "register" keyword), so lazy onboarding is untouched elsewhere.
 *
 * These tests drive the REAL handleTextMessage (unlike the doc-style tests in
 * bug-002-registration-recovery.test.js, which never call the handler — which
 * is how this regression shipped unpinned).
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

const WhatsAppService = require('../../shared/services/whatsapp.service');
const FeatureRegistrationService = require('../../shared/services/feature-registration.service');
const { getOrCreateUser } = require('../../shared/database/bot-helpers');
const { handleTextMessage } = require('../../shared/handlers/text-message.handler');

const REGISTRATION_FLOW_ID = '2010172012940869';
const FROM = '923365709413';
const MESSAGE = { id: 'wamid.bd2447.test' };
const DEFERRED_TEXT_MARKER = "I'll ask for your name after you try one of my features";

/** Unregistered existing row — the operator's live state (role NULL, no name). */
const unregisteredUser = (over = {}) => ({
  id: 'user-uuid-bd2447',
  phone_number: FROM,
  first_name: null,
  role: null,
  preferred_language: 'en',
  registration_completed: false,
  registration_pending_name: false,
  ...over,
});

const sentFlowCalls = () => WhatsAppService.sendFlow.mock.calls;
const sentTexts = () => WhatsAppService.sendMessage.mock.calls.map((c) => String(c[1]));

beforeEach(() => {
  jest.clearAllMocks();
  FeatureRegistrationService.isPendingName.mockResolvedValue(false);
  FeatureRegistrationService.countUserFeatures.mockResolvedValue(0);
});

describe('bd-2447 — /register always opens the registration Flow', () => {
  test('unregistered user with 0 features (operator repro): /register sends the Flow, NOT the deferred-onboarding text', async () => {
    await handleTextMessage(MESSAGE, FROM, '/register', unregisteredUser());

    expect(WhatsAppService.sendFlow).toHaveBeenCalledTimes(1);
    expect(WhatsAppService.sendFlow).toHaveBeenCalledWith(
      FROM,
      expect.objectContaining({ flowId: REGISTRATION_FLOW_ID }),
    );
    expect(sentTexts().some((t) => t.includes(DEFERRED_TEXT_MARKER))).toBe(false);
  });

  test('registration_pending_name=true: /register is NOT swallowed as a name answer — the Flow is sent', async () => {
    FeatureRegistrationService.isPendingName.mockResolvedValue(true);

    await handleTextMessage(MESSAGE, FROM, '/register', unregisteredUser({ registration_pending_name: true }));

    expect(FeatureRegistrationService.handleNameResponse).not.toHaveBeenCalled();
    expect(WhatsAppService.sendFlow).toHaveBeenCalledWith(
      FROM,
      expect.objectContaining({ flowId: REGISTRATION_FLOW_ID }),
    );
  });

  test('brand-new number (row created on the fly, no name/features): /register sends the Flow', async () => {
    getOrCreateUser.mockResolvedValue(unregisteredUser({ id: 'fresh-uuid-bd2447' }));

    await handleTextMessage(MESSAGE, FROM, '/register', null);

    expect(WhatsAppService.sendFlow).toHaveBeenCalledWith(
      FROM,
      expect.objectContaining({ flowId: REGISTRATION_FLOW_ID }),
    );
    expect(sentTexts().some((t) => t.includes(DEFERRED_TEXT_MARKER))).toBe(false);
  });

  test('no users row at all (DB down, user stays null): /register still sends the Flow', async () => {
    getOrCreateUser.mockRejectedValue(new Error('db unavailable'));

    await handleTextMessage(MESSAGE, FROM, '/register', null);

    expect(WhatsAppService.sendFlow).toHaveBeenCalledWith(
      FROM,
      expect.objectContaining({ flowId: REGISTRATION_FLOW_ID }),
    );
  });

  test('already-registered user: /register confirms, no Flow (regression pin)', async () => {
    await handleTextMessage(MESSAGE, FROM, '/register', unregisteredUser({ first_name: 'Sana' }));

    expect(WhatsAppService.sendFlow).not.toHaveBeenCalled();
    expect(sentTexts().some((t) => t.includes("already registered, Sana"))).toBe(true);
  });

  test('lazy onboarding untouched: plain-text "register" (non-command) with 0 features still gets the deferred-onboarding guide, not the Flow', async () => {
    await handleTextMessage(MESSAGE, FROM, 'register', unregisteredUser());

    expect(WhatsAppService.sendFlow).not.toHaveBeenCalled();
    expect(sentTexts().some((t) => t.includes(DEFERRED_TEXT_MARKER))).toBe(true);
  });
});
