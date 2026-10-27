/**
 * "portal" typed without the slash is the /portal command (G1 of the keyword-entry review, 27 Oct 2026).
 *
 * Production, 7 days to 27 Oct 2026 (niete-logs): 213 "/portal" turns, 202 of them answered with the signed portal
 * button. The bare word "portal" (3 turns) got "I'm not sure which feature you meant" plus the whole menu, and 0 of the
 * 63 messages that said "portal" inside a sentence got a portal link from that sentence. A teacher who types "portal"
 * is asking for the portal.
 *
 * These tests drive the REAL handleTextMessage and the REAL portal-command handler (its signed /go link included).
 * Only the network boundary is mocked: WhatsAppService (sendCtaUrl / sendMessage / sendFlow) and the stores below it.
 */

process.env.REGISTRATION_FLOW_ID = '2010172012940869'; // published "Registration v4"
// the /go link's key: derived from the internal key and the environment's Supabase host (app-login-link.js)
process.env.INTERNAL_API_KEY = 'unit-internal-key-not-a-secret';
process.env.SUPABASE_URL = 'https://unit-project.supabase.co';

// --- top-level dep mocks (dep-load order at the top of the handler) ---
jest.mock('../../shared/services/whatsapp.service', () => ({
  startContinuousTypingIndicator: jest.fn(() => ({ stop: jest.fn() })),
  sendMessage: jest.fn().mockResolvedValue(true),
  sendCtaUrl: jest.fn().mockResolvedValue(true),
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
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
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
// the portal's web address (config, not the network)
jest.mock('../../shared/config/branding', () => ({
  ...jest.requireActual('../../shared/config/branding'),
  portalUrl: () => 'https://portal.example',
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
  shouldTriggerExamChecker: jest.fn(() => false),
  hasActiveExamSession: jest.fn().mockResolvedValue(false),
  handleExamText: jest.fn().mockResolvedValue({ handled: false }),
}));
jest.mock('../../shared/services/quiz/quiz-follow-up.service', () => ({
  getAwaitingState: jest.fn().mockResolvedValue(null),
}));
jest.mock('../../shared/services/redis-comprehension.service', () => ({
  findActiveFlowByUser: jest.fn().mockResolvedValue(null),
}));
jest.mock('../../shared/services/app-redirect.service', () => ({
  redirectIfFlagged: jest.fn().mockResolvedValue(false),
}));

const WhatsAppService = require('../../shared/services/whatsapp.service');
const LpFeedbackService = require('../../shared/services/lp-feedback.service');
const ExamChecker = require('../../shared/handlers/exam-checker.handler');
const MenuService = require('../../shared/services/menu.service');
const { handleTextMessage } = require('../../shared/handlers/text-message.handler');

const FROM = '920000000001';
const MESSAGE = { id: 'wamid.portal-bare-word.test' };
const teacher = (over = {}) => ({
  id: 'user-uuid-portal-bare-word',
  phone_number: FROM,
  name: 'Teacher Testwala',
  first_name: 'Teacher',
  role: 'teacher',
  preferred_language: 'en',
  registration_completed: true,
  registration_pending_name: false,
  ...over,
});
const unregistered = () => teacher({ name: null, first_name: null, registration_completed: false, registration_state: 'unregistered' });

const SAVED = process.env.PORTAL_KEYWORD_ROUTING;
beforeEach(() => {
  jest.clearAllMocks();
  // a queued once-answer left by a test whose window was (rightly) never asked must not leak into the next test
  LpFeedbackService.consumeReasonIfPending.mockReset().mockResolvedValue(false);
  delete process.env.PORTAL_KEYWORD_ROUTING;
});
afterAll(() => { if (SAVED === undefined) delete process.env.PORTAL_KEYWORD_ROUTING; else process.env.PORTAL_KEYWORD_ROUTING = SAVED; });

/** The one portal button the turn sent: { body, buttonText, url }, after asserting there was exactly one. */
function onePortalButton() {
  expect(WhatsAppService.sendCtaUrl).toHaveBeenCalledTimes(1);
  const [to, args] = WhatsAppService.sendCtaUrl.mock.calls[0];
  expect(to).toBe(FROM);
  return args;
}

describe('control: "/portal" sends the signed portal button (unchanged)', () => {
  test('/portal', async () => {
    await handleTextMessage(MESSAGE, FROM, '/portal', teacher());
    const b = onePortalButton();
    expect(b.url).toMatch(/^https:\/\/portal\.example\/go\/[A-Za-z0-9_-]+$/);
    expect(b.buttonText).toBe('Open portal');
  });
});

describe('a registered teacher\'s bare "portal" gets the same button as /portal', () => {
  test.each([
    ['portal'], ['Portal'], ['PORTAL'], ['portal?'], ['  portal.  '], ['open portal'], ['my portal'], ['portal link'],
    ['send me the portal link'], ['mera portal'], ['portal kholo'], ['portal link bhejo'], ['NIETE portal'],
    ['پورٹل'], ['پورٹل کھولیں'], ['میرا پورٹل'], ['پورٹل کا لنک دیں'],
    ['portl'], ['portel'],
    ['/ portal'],           // the canonicaliser's form, still the command
    ['portal/'],            // typed back the way an Urdu line displayed it
  ])('%j → one cta_url with the signed /go link and "Open portal"', async (typed) => {
    await handleTextMessage(MESSAGE, FROM, typed, teacher());
    const b = onePortalButton();
    expect(b.url).toMatch(/^https:\/\/portal\.example\/go\/[A-Za-z0-9_-]+$/);
    expect(b.buttonText).toBe('Open portal');
    expect(MenuService.sendMenu).not.toHaveBeenCalled();
  });

  test('in Urdu: the Urdu button, the same link', async () => {
    await handleTextMessage(MESSAGE, FROM, 'portal', teacher({ preferred_language: 'ur' }));
    const b = onePortalButton();
    expect(b.buttonText).toBe('پورٹل کھولیں');
    expect([...b.buttonText].length).toBeLessThanOrEqual(20);
    expect(b.url).toMatch(/\/go\/[A-Za-z0-9_-]+$/);
  });

  test('the bare word is a command: an open 👎-reason window does not take it as the reason', async () => {
    LpFeedbackService.consumeReasonIfPending.mockResolvedValueOnce(true); // a window IS open
    await handleTextMessage(MESSAGE, FROM, 'portal', teacher());
    expect(LpFeedbackService.consumeReasonIfPending).not.toHaveBeenCalled();
    onePortalButton();
  });

  test('the bare word is a command: the exam checker never reads it', async () => {
    await handleTextMessage(MESSAGE, FROM, 'portal', teacher());
    expect(ExamChecker.handleExamText).not.toHaveBeenCalled();
    onePortalButton();
  });
});

describe('not registered: the form first, exactly as for /portal', () => {
  test.each([['portal'], ['/portal']])('%j → the registration Flow, no portal link', async (typed) => {
    await handleTextMessage(MESSAGE, FROM, typed, unregistered());
    expect(WhatsAppService.sendCtaUrl).not.toHaveBeenCalled();
    expect(WhatsAppService.sendFlow).toHaveBeenCalled();
  });
});

describe('a sentence that says "portal" is not the command', () => {
  test.each([
    ['portal pe lesson nahi khul raha'],
    ['what is portal'],
    ['portal password bhool gaya'],
    ['my portal is not opening'],
    ['پورٹل نہیں کھل رہا'],
  ])('%j → no portal button from the keyword door', async (typed) => {
    // It falls through to the classifier / general chat, which this suite does not wire up; a throw there is fine —
    // the assertion is only that the keyword door did not answer it.
    await handleTextMessage(MESSAGE, FROM, typed, teacher()).catch(() => {});
    expect(WhatsAppService.sendCtaUrl).not.toHaveBeenCalled();
  });
});

describe('kill switch PORTAL_KEYWORD_ROUTING', () => {
  test.each([['false'], ['0'], ['off'], ['no']])('=%s → a bare "portal" is not the command (today), /portal still is', async (v) => {
    process.env.PORTAL_KEYWORD_ROUTING = v;
    await handleTextMessage(MESSAGE, FROM, 'portal', teacher()).catch(() => {});
    expect(WhatsAppService.sendCtaUrl).not.toHaveBeenCalled();
    await handleTextMessage(MESSAGE, FROM, '/portal', teacher());
    onePortalButton();
  });
});
