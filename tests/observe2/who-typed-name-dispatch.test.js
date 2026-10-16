/**
 * The typed teacher name reaches observe-who from the REAL text handler (the dispatch line itself runs),
 * for a school leader with a pending "Someone else" wait; a slash command still reaches its own handler.
 * Harness copied from command-dispatch.test.js; observe-who and the text handler are real.
 */
// --- top-level dep mocks (dep-load order at the top of the handler) ---
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  startContinuousTypingIndicator: jest.fn(() => ({ stop: jest.fn() })),
  sendMessage: jest.fn().mockResolvedValue(true),
  sendFlow: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  sendInteractiveMessage: jest.fn().mockResolvedValue(true),
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
const mockRedis = new Map();
jest.mock('../../bot/shared/services/cache/railway-redis.service', () => ({
  redis: {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
  },
  get: jest.fn((k) => Promise.resolve(mockRedis.has(k) ? JSON.parse(mockRedis.get(k)) : null)),
  set: jest.fn().mockResolvedValue('OK'),
  setexWithCeiling: jest.fn((k, ttl, v) => { mockRedis.set(k, v); return Promise.resolve(true); }),
  delete: jest.fn((k) => { mockRedis.delete(k); return Promise.resolve(true); }),
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
jest.mock('../../bot/shared/services/llm-client', () => ({
  getClient: () => ({}),
  getClientForModel: (m) => ({ client: {}, model: String(m || '') }),
}));
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
jest.mock('../../bot/shared/services/observe/patch-resolver.service', () => ({
  listPatchViaSupabase: jest.fn(() => Promise.resolve([{ userId: 't-10', name: 'Rukhsana Kausar', displayName: 'Rukhsana Kausar', phone: '920000000210', emis: '9001', schoolName: 'Test School' }])),
  displayNameOf: (u) => (u && u.name) || null,
}));
jest.mock('../../bot/shared/services/coaching/lp-coaching/lp-step.service', () => ({
  resendLpPromptIfWaiting: jest.fn().mockResolvedValue(false),
}));
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
  isSchoolLeader: jest.fn(() => true),
  OBSERVE_TRIGGER_RX: /^\/observe\b/i,
  evaluateObserveTrigger: jest.fn(() => ({ match: false })),
}));
jest.mock('../../bot/shared/handlers/observe-command.handler', () => ({
  handleObserveCommand: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/services/observe/observe2/start', () => ({
  handleObserve2Command: jest.fn().mockResolvedValue(true),
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


const { handleTextMessage } = require('../../bot/shared/handlers/text-message.handler');
const WhatsAppService = require('../../bot/shared/services/whatsapp.service');
const { handleObserve2Command } = require('../../bot/shared/services/observe/observe2/start');
const { observeStrings } = require('../../bot/shared/services/observe/observe-strings');

const FROM = '923000000001';
const MESSAGE = { id: 'wamid.who.typed' };
const coach = () => ({
  id: 'coach-1', phone_number: FROM, name: 'Coach', role: 'coach', preferred_language: 'en',
  registration_completed: true, registration_state: 'completed', registration_pending_name: false,
});
const waitForName = () => mockRedis.set('observe:who-typed:coach-1', JSON.stringify({ sessionId: 'sess-1', attempts: 0, askedAt: new Date().toISOString() }));

beforeEach(() => { jest.clearAllMocks(); mockRedis.clear(); });

test('after "Someone else", the coach\'s next text is taken as the teacher\'s name', async () => {
  waitForName();
  await handleTextMessage(MESSAGE, FROM, 'Rukhsana Kausar', coach());
  const sent = WhatsAppService.sendMessage.mock.calls.map((c) => c[1]);
  expect(sent).toContain(observeStrings('en').who_ack.replace('{name}', 'Rukhsana Kausar'));
  expect(mockRedis.has('observe:who-typed:coach-1')).toBe(false);
});

test('a slash command while the name is awaited still reaches its own handler', async () => {
  waitForName();
  await handleTextMessage(MESSAGE, FROM, '/observe2', coach());
  expect(handleObserve2Command).toHaveBeenCalled();
});
