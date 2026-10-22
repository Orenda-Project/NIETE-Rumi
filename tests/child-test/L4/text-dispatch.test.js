/**
 * /egra in the REAL handleTextMessage (harness from tests/observe2/command-dispatch.test.js): the
 * dispatch line runs, and the real child-test handler behind it (network boundary mocked: WhatsApp,
 * Redis, Supabase). Flag off → the text falls through exactly as before.
 */

// --- top-level dep mocks (dep-load order at the top of the handler) ---
jest.mock('../../../bot/shared/services/whatsapp.service', () => {
  const { createWhatsAppRecorder } = require('./helpers/boundary');
  const svc = createWhatsAppRecorder();
  svc.sendFlow = jest.fn().mockResolvedValue(true);
  svc.sendLanguageSelectionList = jest.fn().mockResolvedValue(true);
  return svc;
});
jest.mock('../../../bot/shared/services/openai.service', () => ({}));
jest.mock('../../../bot/shared/services/content.service', () => ({}));
jest.mock('../../../bot/shared/services/language-detector.service', () => ({
  detectLanguage: jest.fn(() => null),
}));
jest.mock('../../../bot/shared/services/feature-registration.service', () => ({
  isPendingName: jest.fn().mockResolvedValue(false),
  countUserFeatures: jest.fn().mockResolvedValue(0),
  sendNameQuestion: jest.fn().mockResolvedValue(undefined),
  handleNameResponse: jest.fn().mockResolvedValue({ success: true, firstName: 'X' }),
}));
jest.mock('../../../bot/shared/services/context.service', () => ({}));
jest.mock('../../../bot/shared/services/cache/railway-redis.service', () => {
  const { createFakeRedis } = require('./helpers/boundary');
  const r = createFakeRedis();
  r.redis = { get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue('OK'), del: jest.fn().mockResolvedValue(1) };
  return r;
});
jest.mock('../../../bot/shared/services/coaching-orchestrator.service', () => ({}));
jest.mock('../../../bot/shared/services/menu.service', () => ({ sendMenu: jest.fn(), checkAwaitingLessonPlanTopic: jest.fn().mockResolvedValue(null) }));
jest.mock('../../../bot/shared/services/helper-agent.service', () => ({
  detectCapabilityInquiry: jest.fn().mockResolvedValue({ detected: false }),
}));
jest.mock('../../../bot/shared/handlers/portal-command.handler', () => ({ handlePortalCommand: jest.fn() }));
jest.mock('../../../bot/shared/services/reading-assessment.service', () => ({}));
jest.mock('../../../bot/shared/services/feature-linker.service', () => ({}));
jest.mock('../../../bot/shared/services/feature-intro.service', () => ({}));
jest.mock('../../../bot/shared/services/lesson-plan-queue.service', () => ({}));
jest.mock('../../../bot/shared/services/lp-feedback.service', () => ({
  consumeReasonIfPending: jest.fn().mockResolvedValue(false),
}));
jest.mock('../../../bot/shared/handlers/lesson-plan-v2.handler', () => jest.fn());
jest.mock('../../../bot/shared/services/region-features.service', () => ({
  getRegionFeatures: jest.fn().mockResolvedValue({}),
}));
jest.mock('../../../bot/shared/utils/region', () => ({ getUserRegion: jest.fn(() => 'niete') }));
jest.mock('../../../bot/shared/services/video/video-orchestrator.service', () => ({
  checkAwaitingTopic: jest.fn().mockResolvedValue(null),
  checkAwaitingCustomization: jest.fn().mockResolvedValue(null),
}));
jest.mock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../../bot/shared/utils/constants', () => ({
  TEMP_DIR: '/tmp', LOADING_STICKER_PATH: '', LOADING_STICKER_MEDIA_ID: '',
  OPENAI_API_KEY: '', ATTENDANCE_SETUP_FLOW_ID: '', ATTENDANCE_MARKING_FLOW_ID: '',
}));
jest.mock('../../../bot/shared/services/llm-client', () => ({
  getClient: () => ({}),
  getClientForModel: (m) => ({ client: {}, model: String(m || '') }),
}));
jest.mock('../../../bot/shared/utils/language-detector', () => ({
  detectLanguageOverride: jest.fn(() => null),
  isMarketLanguage: jest.fn(() => false),
}));
jest.mock('../../../bot/shared/utils/language-cache', () => ({
  getUserLanguage: jest.fn().mockResolvedValue('en'),
  setUserLanguage: jest.fn(),
}));
jest.mock('../../../bot/shared/utils/language-detection', () => ({
  detectRequestedLanguage: jest.fn(() => null),
  parseSubjectAndGrade: jest.fn(() => ({})),
}));
jest.mock('../../../bot/shared/database/bot-helpers', () => ({
  getOrCreateUser: jest.fn(),
  getOrCreateSession: jest.fn().mockResolvedValue('session-1'),
  updateSessionType: jest.fn(),
  storeConversation: jest.fn().mockResolvedValue(undefined),
  storeLessonPlan: jest.fn(),
}));
jest.mock('../../../bot/shared/config/supabase', () => {
  const chain = {};
  ['from', 'select', 'eq', 'in', 'order', 'limit', 'update', 'insert', 'upsert',
   'delete', 'not', 'gte', 'lte', 'is'].forEach((m) => { chain[m] = jest.fn(() => chain); });
  chain.single = jest.fn(() => Promise.resolve({ data: null, error: { code: 'PGRST116' } }));
  chain.maybeSingle = jest.fn(() => Promise.resolve({ data: null, error: null }));
  chain.then = (resolve) => Promise.resolve({ data: null, error: null }).then(resolve);
  return chain;
});
jest.mock('../../../bot/shared/handlers/homework-trigger', () => ({
  evaluateHomeworkTrigger: jest.fn(() => ({ match: false })),
}));

// --- inline-required (lazy) modules on the text path — all fall-through ---
jest.mock('../../../bot/shared/services/quiz/quiz-session.service', () => ({
  getPostQuizState: jest.fn().mockResolvedValue(null),
  getActiveState: jest.fn().mockResolvedValue(null),
}));
jest.mock('../../../bot/shared/services/training/capstone-delivery.service', () => ({
  routeTextAnswer: jest.fn().mockResolvedValue(false),
}));
jest.mock('../../../bot/shared/services/student-video-feedback.service', () => ({
  consumeReasonIfPending: jest.fn().mockResolvedValue(false),
}));
jest.mock('../../../bot/shared/services/observe/observe-gate', () => ({
  ...jest.requireActual('../../../bot/shared/services/observe/observe-gate'),
  evaluateObserveTrigger: jest.fn(() => ({ match: false })),
}));
jest.mock('../../../bot/shared/handlers/observe-command.handler', () => ({
  handleObserveCommand: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../../bot/shared/services/observe/observe2/start', () => ({
  handleObserve2Command: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../../bot/shared/handlers/exam-checker.handler', () => ({
  handleExamText: jest.fn().mockResolvedValue({ handled: false }),
}));
jest.mock('../../../bot/shared/services/quiz/quiz-follow-up.service', () => ({
  getAwaitingState: jest.fn().mockResolvedValue(null),
}));
jest.mock('../../../bot/shared/services/redis-comprehension.service', () => ({
  findActiveFlowByUser: jest.fn().mockResolvedValue(null),
}));


const { handleTextMessage } = require('../../../bot/shared/handlers/text-message.handler');
const WhatsAppService = require('../../../bot/shared/services/whatsapp.service');
const redis = require('../../../bot/shared/services/cache/railway-redis.service');
const { handleObserve2Command } = require('../../../bot/shared/services/observe/observe2/start');
const { handleObserveCommand } = require('../../../bot/shared/handlers/observe-command.handler');

const FROM = '923000000001';
const MESSAGE = { id: 'wamid.egra.dispatch' };
const coach = () => ({
  id: 'coach-1', phone_number: FROM, name: 'Coach', role: 'coach', region: 'niete', preferred_language: 'en',
  registration_completed: true, registration_state: 'completed', registration_pending_name: false,
});
const texts = () => WhatsAppService.__sent.filter((m) => m.kind === 'text').map((m) => m.text);
const SAVED = { ...process.env };

beforeEach(() => {
  jest.clearAllMocks();
  WhatsAppService.__sent.length = 0;
  redis.__data.clear();
  process.env.CHILD_TEST_ENABLED = 'true';
});
afterAll(() => { process.env = SAVED; });

test('/egra reaches the child test (a coach with no school is told so), not /observe or chat', async () => {
  await handleTextMessage(MESSAGE, FROM, '/egra', coach());
  expect(texts().some((t) => /No school is linked to your account/.test(t))).toBe(true);
  expect(handleObserveCommand).not.toHaveBeenCalled();
  expect(handleObserve2Command).not.toHaveBeenCalled();
});

test('«بچوں کا ٹیسٹ» reaches it too', async () => {
  await handleTextMessage(MESSAGE, FROM, 'بچوں کا ٹیسٹ', { ...coach(), preferred_language: 'ur' });
  expect(texts().some((t) => /کوئی اسکول منسلک نہیں/.test(t))).toBe(true);
});

test('flag off: /egra is not the child test\'s', async () => {
  delete process.env.CHILD_TEST_ENABLED;
  // falls through to normal chat, whose AI services are stubbed out in this harness
  await handleTextMessage(MESSAGE, FROM, '/egra', coach()).catch(() => {});
  expect(texts().some((t) => /No school is linked|child test/i.test(t))).toBe(false);
});

test('/cancel while a child test is open closes it', async () => {
  await redis.set('ctst:state:coach-1', JSON.stringify({ ctx: { schoolId: 's1', visitId: 'v1' }, step: 'list', pendingPhotos: [] }));
  await handleTextMessage(MESSAGE, FROM, '/cancel', coach());
  expect(texts().some((t) => /Child test closed/.test(t))).toBe(true);
  expect(redis.__data.has('ctst:state:coach-1')).toBe(false);
});

test('/egra does not shadow /observe2', async () => {
  await handleTextMessage(MESSAGE, FROM, '/observe2', coach());
  expect(handleObserve2Command).toHaveBeenCalled();
});
