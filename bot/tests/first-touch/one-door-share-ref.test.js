'use strict';
/**
 * A shared card's words with its ref ("quiz please jb3b9c1e2a", web_quiz_share_v4) through the REAL handleTextMessage
 * with quiz_one_door ON (the mock set of one-door-text-turn.test.js):
 *  (a) switch OFF: the words are not a quiz request, as today: no door, they go on to the general reply;
 *  (b) switch ON: they reach the one door with the words intact (the door keeps the item: the join seam's rows);
 *  (c) a message with no ref adds no settings read for the share;
 *  (d) a phone with no users row yet gets the door, never an account error.
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
// the general path's first step: a marked stop, so a row can tell "went on to the general reply, as today" from a throw
const mockGeneral = jest.fn(async () => { throw Object.assign(new Error('general path reached'), { generalPath: true }); });
jest.mock('../../shared/services/menu.service', () => ({ sendMenu: jest.fn(), checkAwaitingLessonPlanTopic: (...a) => mockGeneral(...a) }));
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
  chain.__rows = [];
  chain.__reads = [];
  chain.from = jest.fn((t) => { chain.__t = t; return chain; });
  chain.in = jest.fn((col, keys) => { if (chain.__t === 'app_settings') chain.__reads.push(keys); return chain; });
  chain.then = (resolve) => Promise.resolve({ data: chain.__t === 'app_settings' ? chain.__rows : null, error: null }).then(resolve);
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

const supabase = require('../../shared/config/supabase');
const WhatsApp = require('../../shared/services/whatsapp.service');
const { handleTextMessage } = require('../../shared/handlers/text-message.handler');

const FROM = fixturePhone(7654321);
const MESSAGE = { id: 'wamid.share-ref.test' };
const WORDS = 'quiz please jb3b9c1e2a';
const UNKNOWN = {
  id: 'user-uuid-new', phone_number: FROM, first_name: null, name: null, role: null, preferred_language: 'en',
  registration_completed: false, registration_pending_name: false,
};
const shareReads = () => supabase.__reads.filter((keys) => (keys || []).includes('web_quiz_share_v4')).length;
function share(value) {
  supabase.__rows = value === undefined ? [{ key: 'web_quiz_card_v3', value: true }] : [{ key: 'web_quiz_card_v3', value: true }, { key: 'web_quiz_share_v4', value }];
  require('../../shared/services/quiz/web-quiz-card-image')._reset();
}

beforeEach(() => {
  jest.clearAllMocks();
  supabase.__reads.length = 0;
  mockOneDoor = true;
  process.env.TRANSCRIPT_QUIZ_ENABLED = 'true';
});

describe('(a) switch off: the card\'s words with a ref are not a quiz request, as today', () => {
  test.each([['absent', undefined], ['false', false], ['the string "true"', 'true'], ['1', 1]])('share_v4 %s: no door; the words go on to the general reply, with nothing sent before it', async (_, v) => {
    share(v);
    let err = null;
    await handleTextMessage(MESSAGE, FROM, WORDS, { ...UNKNOWN }).catch((e) => { err = e; });
    expect(err && err.generalPath).toBe(true);
    expect(mockGeneral).toHaveBeenCalledTimes(1);
    expect(mockOpenQuizMenu).not.toHaveBeenCalled();
    expect(mockOffer).not.toHaveBeenCalled();
    expect(mockTopic).not.toHaveBeenCalled();
    expect(WhatsApp.sendMessage).not.toHaveBeenCalled();
    expect(WhatsApp.sendFlow).not.toHaveBeenCalled();
  });
});

describe('(b) switch on: the words reach the one door, intact', () => {
  test('an unknown phone: the one entry with the words and the ref, and no registration Flow after it', async () => {
    share(true);
    await handleTextMessage(MESSAGE, FROM, WORDS, { ...UNKNOWN });
    expect(mockOpenQuizMenu).toHaveBeenCalledTimes(1);
    expect(mockOpenQuizMenu.mock.calls[0][0]).toMatchObject({ from: FROM, trigger: 'text', body: WORDS });
    expect(mockOffer).not.toHaveBeenCalled();
  });
  test('Urdu words with the ref: the same', async () => {
    share(true);
    await handleTextMessage(MESSAGE, FROM, 'کوئز دکھائیں jb3b9c1e2a', { ...UNKNOWN });
    expect(mockOpenQuizMenu).toHaveBeenCalledTimes(1);
    expect(mockOpenQuizMenu.mock.calls[0][0].body).toBe('کوئز دکھائیں jb3b9c1e2a');
  });
});

describe('(c) a message with no ref asks nothing about the share', () => {
  test.each(['quiz please', 'quiz', 'hello there', 'کوئز دکھائیں'])('%s: no read of the share switch', async (word) => {
    share(true);
    await handleTextMessage(MESSAGE, FROM, word, { ...UNKNOWN }).catch(() => {});
    expect(shareReads()).toBe(0);
  });
});

describe('(d) a phone with no users row yet', () => {
  const Helpers = () => require('../../shared/database/bot-helpers');
  test('its first message is the card\'s words: the row is made, the words get the door, never an account line', async () => {
    share(true);
    Helpers().getOrCreateUser.mockResolvedValueOnce({ ...UNKNOWN });
    await handleTextMessage(MESSAGE, FROM, WORDS, null);
    expect(Helpers().getOrCreateUser).toHaveBeenCalledTimes(1);
    expect(mockOpenQuizMenu).toHaveBeenCalledTimes(1);
    expect(mockOpenQuizMenu.mock.calls[0][0].body).toBe(WORDS);
    const said = WhatsApp.sendMessage.mock.calls.map((c) => String(c[1] || '')).join(' ');
    expect(said).not.toMatch(/account/i);
  });
  test('the lookup itself fails (an outage): the same honest line a /quiz gets today, not "register"', async () => {
    share(true);
    Helpers().getOrCreateUser.mockRejectedValueOnce(Object.assign(new Error('522'), { code: '522' }));
    await handleTextMessage(MESSAGE, FROM, WORDS, null).catch(() => {});
    const quizSaid = WhatsApp.sendMessage.mock.calls.map((c) => String(c[1] || ''));
    WhatsApp.sendMessage.mockClear();
    Helpers().getOrCreateUser.mockRejectedValueOnce(Object.assign(new Error('522'), { code: '522' }));
    await handleTextMessage(MESSAGE, FROM, '/quiz', null).catch(() => {});
    expect(quizSaid).toEqual(WhatsApp.sendMessage.mock.calls.map((c) => String(c[1] || '')));
    expect(quizSaid.join(' ')).not.toMatch(/to register/i);
  });
});
