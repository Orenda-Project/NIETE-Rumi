/**
 * /observe2 retired (app_settings.observe2_retired, operator 12 Nov 2026): the text handler sends the one-line notice
 * and then runs the /observe door itself, with "/observe", so the coach gets exactly what /observe opens for them
 * (v6 or FDE by grade is decided there). The variants the slash-command canonicaliser maps to /observe2 ("observe2/",
 * "/ observe2", a one-letter slip) take the same path. Switch off: /observe2 as before. Drives the REAL
 * handleTextMessage (harness from tests/observe2/command-dispatch.test.js), so the dispatch lines themselves run.
 */

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
  handleObserveCommand: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/services/observe/observe2/start', () => ({
  handleObserve2Command: jest.fn().mockResolvedValue(true),
}));
const mockCalls = [];
const mockRetired = { on: false };
jest.mock('../../bot/shared/services/observe/observe2/retire', () => ({
  announceIfRetired: jest.fn(async () => { mockCalls.push('notice'); return mockRetired.on; }),
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
const { handleObserveCommand } = require('../../bot/shared/handlers/observe-command.handler');
const { handleObserve2Command } = require('../../bot/shared/services/observe/observe2/start');
const { announceIfRetired } = require('../../bot/shared/services/observe/observe2/retire');

const FROM = '923000000001';
const MESSAGE = { id: 'wamid.observe2.retire' };
const coach = () => ({
  id: 'coach-1', phone_number: FROM, name: 'Coach', role: 'coach', preferred_language: 'en',
  registration_completed: true, registration_state: 'completed', registration_pending_name: false,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockCalls.length = 0;
  mockRetired.on = false;
  handleObserveCommand.mockImplementation(async () => { mockCalls.push('observe'); return true; });
});

describe('retired', () => {
  beforeEach(() => { mockRetired.on = true; });

  test('/observe2: the notice, then the /observe door with "/observe"; the /observe2 handler never runs', async () => {
    await handleTextMessage(MESSAGE, FROM, '/observe2', coach());
    expect(announceIfRetired).toHaveBeenCalledWith(expect.objectContaining({ id: 'coach-1' }), FROM);
    expect(handleObserveCommand).toHaveBeenCalledWith(expect.objectContaining({ id: 'coach-1' }), FROM, '/observe');
    expect(handleObserve2Command).not.toHaveBeenCalled();
    expect(mockCalls).toEqual(['notice', 'observe']);
  });

  test.each(['observe2/', '/ observe2', '\\observe2', '/Observe2', '/obsreve2', '/observe2 now'])(
    '%s takes the same path', async (typed) => {
      await handleTextMessage(MESSAGE, FROM, typed, coach());
      expect(handleObserveCommand).toHaveBeenCalledWith(expect.objectContaining({ id: 'coach-1' }), FROM, '/observe');
      expect(handleObserve2Command).not.toHaveBeenCalled();
      expect(mockCalls).toEqual(['notice', 'observe']);
    });

  test('/observe itself is untouched: no notice, the door gets "/observe" as typed', async () => {
    await handleTextMessage(MESSAGE, FROM, '/observe', coach());
    expect(announceIfRetired).not.toHaveBeenCalled();
    expect(handleObserveCommand).toHaveBeenCalledWith(expect.objectContaining({ id: 'coach-1' }), FROM, '/observe');
    expect(mockCalls).toEqual(['observe']);
  });
});

describe('not retired (the default)', () => {
  test('/observe2 reaches the /observe2 handler exactly as before', async () => {
    await handleTextMessage(MESSAGE, FROM, '/observe2', coach());
    expect(handleObserve2Command).toHaveBeenCalledWith(expect.objectContaining({ id: 'coach-1' }), FROM, '/observe2');
    expect(handleObserveCommand).not.toHaveBeenCalled();
  });
});
