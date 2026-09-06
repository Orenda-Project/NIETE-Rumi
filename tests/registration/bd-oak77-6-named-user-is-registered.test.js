/**
 * bd-oak77.6 — a teacher whose row has a NAME but registration_completed=false
 * must be treated as REGISTERED.
 *
 * PROD EVIDENCE (ihzciabopbttygxxgrkm, read-only, 2026-09-06): 7,685 users have a
 * first_name; only 440 have registration_completed=true. 7,245 have it FALSE (0 NULL),
 * and 4,145 of those messaged the bot in the last 30 days — 3,951 of them teachers.
 * `registration_state` is no substitute: it reads 'unregistered' for 7,684 of the 7,685,
 * including 439 of the 440 whose flag IS true. Exactly one row on prod says 'completed'.
 *
 * So the predicate `registration_completed || registration_state === 'completed'`,
 * introduced on develop by bd-2480 and correct on staging (a separate DB, freshly
 * registered users), sends 4,145 active production users back into registration on a
 * number where they are already registered and using lesson plans.
 *
 * The fix is the UNION, not a swap back: a completed Flow OR a name on the row means
 * registered. That keeps bd-2480's case (started the Flow, abandoned it, first_name
 * persisted at screen 1 → still NOT registered... which is why the writer fix in
 * bd-oak77-6-completion-sets-flag.test.js has to land with this one) and stops the
 * mass re-registration.
 *
 * RED-FIRST: these tests drive the REAL handleTextMessage, so they execute the two
 * changed lines (text-message.handler.js ~1775 and ~2271). Both fail on develop.
 */

process.env.REGISTRATION_FLOW_ID = '2010172012940869'; // published "Registration v4"

// --- top-level dep mocks (dep-load order at the top of the handler) ---
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  startContinuousTypingIndicator: jest.fn(() => ({ stop: jest.fn() })),
  sendMessage: jest.fn().mockResolvedValue(true),
  sendFlow: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  sendLanguageSelectionList: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/services/openai.service', () => ({}));
jest.mock('../../bot/shared/services/content.service', () => ({}));
jest.mock('../../bot/shared/services/language-detector.service', () => ({
  detectLanguage: jest.fn(() => null),
}));
jest.mock('../../bot/shared/services/feature-registration.service', () => ({
  isPendingName: jest.fn().mockResolvedValue(false),
  countUserFeatures: jest.fn().mockResolvedValue(0),
  sendNameQuestion: jest.fn().mockResolvedValue(undefined),
  handleNameResponse: jest.fn().mockResolvedValue({ success: true, firstName: 'X' }),
}));
jest.mock('../../bot/shared/services/context.service', () => ({}));
jest.mock('../../bot/shared/services/cache/railway-redis.service', () => ({
  redis: {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
  },
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue('OK'),
}));
jest.mock('../../bot/shared/services/coaching-orchestrator.service', () => ({}));
jest.mock('../../bot/shared/services/menu.service', () => ({ sendMenu: jest.fn() }));
jest.mock('../../bot/shared/services/helper-agent.service', () => ({
  detectCapabilityInquiry: jest.fn().mockResolvedValue({ detected: false }),
}));
jest.mock('../../bot/shared/handlers/portal-command.handler', () => ({ handlePortalCommand: jest.fn() }));
jest.mock('../../bot/shared/services/reading-assessment.service', () => ({}));
jest.mock('../../bot/shared/services/feature-linker.service', () => ({}));
jest.mock('../../bot/shared/services/feature-intro.service', () => ({}));
jest.mock('../../bot/shared/services/lesson-plan-queue.service', () => ({}));
jest.mock('../../bot/shared/services/lp-feedback.service', () => ({
  consumeReasonIfPending: jest.fn().mockResolvedValue(false),
}));
jest.mock('../../bot/shared/handlers/lesson-plan-v2.handler', () => jest.fn());
jest.mock('../../bot/shared/services/region-features.service', () => ({
  getRegionFeatures: jest.fn().mockResolvedValue({}),
}));
jest.mock('../../bot/shared/utils/region', () => ({ getUserRegion: jest.fn(() => 'niete') }));
jest.mock('../../bot/shared/services/video/video-orchestrator.service', () => ({
  checkAwaitingTopic: jest.fn().mockResolvedValue(null),
  checkAwaitingCustomization: jest.fn().mockResolvedValue(null),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/constants', () => ({
  TEMP_DIR: '/tmp', LOADING_STICKER_PATH: '', LOADING_STICKER_MEDIA_ID: '',
  OPENAI_API_KEY: '', ATTENDANCE_SETUP_FLOW_ID: '', ATTENDANCE_MARKING_FLOW_ID: '',
}));
jest.mock('../../bot/shared/services/llm-client', () => ({ getClient: () => ({}) }));
jest.mock('../../bot/shared/utils/language-detector', () => ({
  detectLanguageOverride: jest.fn(() => null),
  isMarketLanguage: jest.fn(() => false),
}));
jest.mock('../../bot/shared/utils/language-cache', () => ({
  getUserLanguage: jest.fn().mockResolvedValue('en'),
  setUserLanguage: jest.fn(),
}));
jest.mock('../../bot/shared/utils/language-detection', () => ({
  detectRequestedLanguage: jest.fn(() => null),
  parseSubjectAndGrade: jest.fn(() => ({})),
}));
jest.mock('../../bot/shared/database/bot-helpers', () => ({
  getOrCreateUser: jest.fn(),
  getOrCreateSession: jest.fn().mockResolvedValue('session-1'),
  updateSessionType: jest.fn(),
  storeConversation: jest.fn().mockResolvedValue(undefined),
  storeLessonPlan: jest.fn(),
}));
jest.mock('../../bot/shared/config/supabase', () => {
  const chain = {};
  ['from', 'select', 'eq', 'in', 'order', 'limit', 'update', 'insert', 'upsert',
   'delete', 'not', 'gte', 'lte', 'is'].forEach((m) => { chain[m] = jest.fn(() => chain); });
  chain.single = jest.fn(() => Promise.resolve({ data: null, error: { code: 'PGRST116' } }));
  chain.maybeSingle = jest.fn(() => Promise.resolve({ data: null, error: null }));
  chain.then = (resolve) => Promise.resolve({ data: null, error: null }).then(resolve);
  return chain;
});
jest.mock('../../bot/shared/handlers/homework-trigger', () => ({
  evaluateHomeworkTrigger: jest.fn(() => ({ match: false })),
}));

// --- inline-required (lazy) modules on the text path — all fall-through ---
jest.mock('../../bot/shared/services/quiz/quiz-session.service', () => ({
  getPostQuizState: jest.fn().mockResolvedValue(null),
  getActiveState: jest.fn().mockResolvedValue(null),
}));
jest.mock('../../bot/shared/services/training/capstone-delivery.service', () => ({
  routeTextAnswer: jest.fn().mockResolvedValue(false),
}));
jest.mock('../../bot/shared/services/student-video-feedback.service', () => ({
  consumeReasonIfPending: jest.fn().mockResolvedValue(false),
}));
jest.mock('../../bot/shared/services/observe/observe-gate', () => ({
  isSchoolLeader: jest.fn(() => false),
  OBSERVE_TRIGGER_RX: /^\/observe\b/i,
  evaluateObserveTrigger: jest.fn(() => ({ match: false })),
}));
jest.mock('../../bot/shared/handlers/observe-command.handler', () => ({
  handleObserveCommand: jest.fn().mockResolvedValue(false),
}));
jest.mock('../../bot/shared/handlers/exam-checker.handler', () => ({
  handleExamText: jest.fn().mockResolvedValue({ handled: false }),
}));
jest.mock('../../bot/shared/services/quiz/quiz-follow-up.service', () => ({
  getAwaitingState: jest.fn().mockResolvedValue(null),
}));
jest.mock('../../bot/shared/services/redis-comprehension.service', () => ({
  findActiveFlowByUser: jest.fn().mockResolvedValue(null),
}));

const WhatsAppService = require('../../bot/shared/services/whatsapp.service');
const FeatureRegistrationService = require('../../bot/shared/services/feature-registration.service');
const { getOrCreateUser } = require('../../bot/shared/database/bot-helpers');
const { handleTextMessage } = require('../../bot/shared/handlers/text-message.handler');

const FROM = '923365709413';
const MESSAGE = { id: 'wamid.oak776.test' };
const REGISTRATION_FLOW_ID = '2010172012940869';

/**
 * The production shape: a real, long-registered NIETE teacher. Her name is on the row;
 * her registration_completed was never set (the July roster migration did not write it),
 * and registration_state is the near-universal 'unregistered'.
 */
const namedButFlagFalse = (over = {}) => ({
  id: 'user-uuid-oak776',
  phone_number: FROM,
  first_name: 'Ayesha',
  name: 'Ayesha Bano',
  role: 'teacher',
  preferred_language: 'en',
  registration_completed: false,
  registration_state: 'unregistered',
  registration_pending_name: false,
  ...over,
});

const sentTexts = () => WhatsAppService.sendMessage.mock.calls.map((c) => String(c[1]));

beforeEach(() => {
  jest.clearAllMocks();
  FeatureRegistrationService.isPendingName.mockResolvedValue(false);
  FeatureRegistrationService.countUserFeatures.mockResolvedValue(0);
});

describe('bd-oak77.6 — a name on the row means registered', () => {
  test('the "register" keyword: a named teacher with the flag false is told she is already registered, and is NOT asked her name again', async () => {
    await handleTextMessage(MESSAGE, FROM, 'register me please', namedButFlagFalse());

    expect(sentTexts().some((t) => t.includes("already registered, Ayesha"))).toBe(true);
    expect(FeatureRegistrationService.sendNameQuestion).not.toHaveBeenCalled();
  });

  test('the recovery path is not taken even when she has features (the path that re-asks the name)', async () => {
    FeatureRegistrationService.countUserFeatures.mockResolvedValue(3);

    await handleTextMessage(MESSAGE, FROM, 'register', namedButFlagFalse());

    expect(FeatureRegistrationService.sendNameQuestion).not.toHaveBeenCalled();
    expect(sentTexts().some((t) => t.includes("already registered, Ayesha"))).toBe(true);
  });

  test('/register offers her the UPDATE copy, not the first-time welcome', async () => {
    await handleTextMessage(MESSAGE, FROM, '/register', namedButFlagFalse());

    expect(WhatsAppService.sendFlow).toHaveBeenCalledWith(
      FROM,
      expect.objectContaining({ flowId: REGISTRATION_FLOW_ID, header: 'Update your details' }),
    );
  });

  test('an EMPTY-STRING first_name is not a name — 212 prod rows have one — so she is still unregistered', async () => {
    await handleTextMessage(MESSAGE, FROM, 'register', namedButFlagFalse({ first_name: '', name: '' }));

    expect(sentTexts().some((t) => t.includes('already registered'))).toBe(false);
  });

  test('a genuinely unregistered user (no name, flag false) is unaffected', async () => {
    await handleTextMessage(MESSAGE, FROM, 'register', namedButFlagFalse({ first_name: null, name: null }));

    expect(sentTexts().some((t) => t.includes('already registered'))).toBe(false);
  });

  test('the flag alone still means registered, with no name on the row', async () => {
    await handleTextMessage(MESSAGE, FROM, 'register', namedButFlagFalse({
      first_name: null, name: null, registration_completed: true,
    }));

    expect(sentTexts().some((t) => t.includes('already registered'))).toBe(true);
  });
});
