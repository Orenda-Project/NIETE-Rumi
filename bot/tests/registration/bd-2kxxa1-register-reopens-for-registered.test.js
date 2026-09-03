/**
 * bd-2kxxa.1 (R162) — `/register` must open the registration Flow for an
 * ALREADY-REGISTERED user too, so a coach can correct her own name.
 *
 * Live case: a new coach (Syeda Mariam Abbas Naqvi) was issued a phone number
 * that previously belonged to Iqra Arshad. The users row for that number is
 * registration_completed=true with first_name "Iqra", so the bot greets her as
 * Iqra — and `/register` replied "✅ You're already registered, Iqra!" and
 * returned BEFORE sending the Flow. She had no way to fix her own name.
 *
 * Root cause: text-message.handler.js /register branch checked the
 * already-registered predicate FIRST and returned, so the Flow-send path below
 * it was unreachable for any completed account.
 *
 * Contract under test:
 *  - REGISTRATION_FLOW_ID configured → /register ALWAYS sends the Flow.
 *    Registered users get header 'Update your details' + an update body;
 *    unregistered users keep the existing 'Welcome' copy. The "already
 *    registered" text is NOT sent when the Flow goes out.
 *  - A registered re-open is logged.
 *  - Legacy paths (no REGISTRATION_FLOW_ID, or the Flow send throws) are
 *    unchanged: a registered user still gets the "already registered" reply.
 *
 * The submission side (flow-response.handler.js handleRegistrationFlow) already
 * overwrites first_name/name and only writes role when a valid role is
 * submitted, so re-opening the Flow for a registered user is safe.
 *
 * These tests drive the REAL handleTextMessage (same mock set as bd-2447).
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
const { logToFile } = require('../../shared/utils/logger');
const { handleTextMessage } = require('../../shared/handlers/text-message.handler');

const REGISTRATION_FLOW_ID = '2010172012940869';
const FROM = '923001234567';
const MESSAGE = { id: 'wamid.bd2kxxa1.test' };

const UPDATE_HEADER = 'Update your details';
const UPDATE_BODY = 'Correct your name or details — this replaces what I have on file.';
const WELCOME_HEADER = 'Welcome';
const ALREADY_REGISTERED_MARKER = "already registered";

/** The live row: the previous holder's completed registration on the re-issued number. */
const registeredUser = (over = {}) => ({
  id: 'user-uuid-iqra',
  phone_number: FROM,
  first_name: 'Iqra',
  name: 'Iqra Arshad',
  role: 'coach',
  preferred_language: 'en',
  registration_completed: true,
  registration_state: 'completed',
  registration_pending_name: false,
  ...over,
});

const unregisteredUser = (over = {}) => ({
  id: 'user-uuid-new',
  phone_number: FROM,
  first_name: null,
  role: null,
  preferred_language: 'en',
  registration_completed: false,
  registration_pending_name: false,
  ...over,
});

const sentTexts = () => WhatsAppService.sendMessage.mock.calls.map((c) => String(c[1]));
const logLines = () => logToFile.mock.calls.map((c) => String(c[0]));

beforeEach(() => {
  jest.clearAllMocks();
  process.env.REGISTRATION_FLOW_ID = REGISTRATION_FLOW_ID;
  WhatsAppService.sendFlow.mockResolvedValue(true);
  FeatureRegistrationService.isPendingName.mockResolvedValue(false);
  FeatureRegistrationService.countUserFeatures.mockResolvedValue(0);
});

describe('bd-2kxxa.1 — /register re-opens the registration Flow for an already-registered user', () => {
  test('registered user (registration_completed=true, first_name set): /register sends the Flow with the update copy and does NOT say "already registered"', async () => {
    const user = registeredUser();

    await handleTextMessage(MESSAGE, FROM, '/register', user);

    expect(WhatsAppService.sendFlow).toHaveBeenCalledTimes(1);
    expect(WhatsAppService.sendFlow).toHaveBeenCalledWith(
      FROM,
      expect.objectContaining({
        flowId: REGISTRATION_FLOW_ID,
        flowToken: user.id,
        header: UPDATE_HEADER,
        body: UPDATE_BODY,
      }),
    );
    expect(sentTexts().some((t) => t.includes(ALREADY_REGISTERED_MARKER))).toBe(false);
  });

  test('legacy account (registration_state=completed, no boolean flag): /register still sends the Flow with the update copy', async () => {
    const user = registeredUser({ registration_completed: undefined, registration_state: 'completed' });

    await handleTextMessage(MESSAGE, FROM, '/register', user);

    expect(WhatsAppService.sendFlow).toHaveBeenCalledWith(
      FROM,
      expect.objectContaining({ flowId: REGISTRATION_FLOW_ID, header: UPDATE_HEADER }),
    );
    expect(sentTexts().some((t) => t.includes(ALREADY_REGISTERED_MARKER))).toBe(false);
  });

  test('registered re-open is logged (so a name-fix leaves a trace in the logs)', async () => {
    await handleTextMessage(MESSAGE, FROM, '/register', registeredUser());

    expect(logLines().some((l) => /re-open/i.test(l) && /registered/i.test(l))).toBe(true);
  });

  test('unregistered user keeps the existing "Welcome" copy (no regression on first-time setup)', async () => {
    await handleTextMessage(MESSAGE, FROM, '/register', unregisteredUser());

    expect(WhatsAppService.sendFlow).toHaveBeenCalledWith(
      FROM,
      expect.objectContaining({ flowId: REGISTRATION_FLOW_ID, header: WELCOME_HEADER }),
    );
    expect(WhatsAppService.sendFlow).not.toHaveBeenCalledWith(
      FROM,
      expect.objectContaining({ header: UPDATE_HEADER }),
    );
  });

  test('WhatsApp field caps: update header fits the 60-code-point header cap', () => {
    expect([...UPDATE_HEADER].length).toBeLessThanOrEqual(60);
  });

  describe('legacy fallback paths are unchanged', () => {
    test('no REGISTRATION_FLOW_ID configured: registered user still gets the "already registered" reply, no Flow', async () => {
      delete process.env.REGISTRATION_FLOW_ID;

      await handleTextMessage(MESSAGE, FROM, '/register', registeredUser());

      expect(WhatsAppService.sendFlow).not.toHaveBeenCalled();
      expect(sentTexts().some((t) => t.includes('already registered, Iqra'))).toBe(true);
    });

    test('Flow send throws for a registered user: falls back to the "already registered" reply (not the recovery name question)', async () => {
      WhatsAppService.sendFlow.mockRejectedValueOnce(new Error('meta 5xx'));

      await handleTextMessage(MESSAGE, FROM, '/register', registeredUser());

      expect(WhatsAppService.sendFlow).toHaveBeenCalledTimes(1);
      expect(sentTexts().some((t) => t.includes('already registered, Iqra'))).toBe(true);
      expect(FeatureRegistrationService.sendNameQuestion).not.toHaveBeenCalled();
    });
  });
});
