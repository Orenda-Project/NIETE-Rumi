'use strict';
/**
 * A BRAND-NEW row's first message, through the REAL handleTextMessage (the one-door harness's mock set; only the
 * network/DB boundary is faked, the language resolver, the script detector and the handler are real).
 *
 * Today a new row is stored 'ur' (the offer's first language), and Latin script is not evidence of English (Roman
 * Urdu is Latin-script Urdu), so an English first message is answered in Urdu. With FIRST_REPLY_ENGLISH_EVIDENCE
 * exactly "true", a brand-new row's first message is answered in English ONLY on positive English evidence:
 * at least three English words, every word English, no Roman-Urdu word. Nothing is written: not
 * preferred_language, not language_locked — it shapes this turn's reply language only.
 *
 * Observed at two seams the handler already has: the language the user message is stored with (the turn's
 * response language) and the language the registration Flow is offered in (turn.languageOf / the greeting door).
 */
const { fixturePhone } = require('../quiz/web-quiz/fixture-phone');
process.env.REGISTRATION_FLOW_ID = '2010172012940869';
process.env.TRANSCRIPT_QUIZ_ENABLED = 'true';
delete process.env.FIRST_REPLY_ENGLISH_EVIDENCE;

// --- top-level dep mocks (dep-load order at the top of the handler) ---
jest.mock('../../shared/services/whatsapp.service', () => ({
  startContinuousTypingIndicator: jest.fn(() => ({ stop: jest.fn() })),
  sendMessage: jest.fn().mockResolvedValue(true),
  sendFlow: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  sendLanguageSelectionList: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../shared/services/openai.service', () => ({ detectIntent: jest.fn(async () => ({ type: 'unsure' })) }));
jest.mock('../../shared/services/content.service', () => ({}));
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
jest.mock('../../shared/services/menu.service', () => ({ sendMenu: jest.fn(), checkAwaitingLessonPlanTopic: jest.fn(async () => null) }));
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
  // a new row's stored default is Urdu (the offer's first language)
  getUserLanguage: jest.fn().mockResolvedValue('ur'),
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



const mockOffer = jest.fn(async () => true);
const mockOfferDetailed = jest.fn(async () => 'sent');
const mockSendInvite = jest.fn(async () => true);
jest.mock('../../shared/services/registration-invite.service', () => ({
  offerRegistrationOnce: (...a) => mockOffer(...a),
  offerRegistrationOnceDetailed: (...a) => mockOfferDetailed(...a),
  sendRegistrationInvite: (...a) => mockSendInvite(...a),
}));
jest.mock('../../shared/services/first-touch/one-door.flags', () => ({ on: jest.fn(async () => false), flags: jest.fn(async () => ({ on: false, ownCap: 20, eventsV3: false, teacherHome: false })) }));
jest.mock('../../shared/services/conversation-state.service', () => ({
  getState: jest.fn(async () => null), clearState: jest.fn(async () => true), setState: jest.fn(async () => true),
}));
jest.mock('../../shared/services/app-redirect.service', () => ({ redirectToApp: jest.fn(async () => false), redirectIfFlagged: jest.fn(async () => false) }));

const { handleTextMessage } = require('../../shared/handlers/text-message.handler');
const BotHelpers = require('../../shared/database/bot-helpers');
const LanguageCache = require('../../shared/utils/language-cache');
const supabase = require('../../shared/config/supabase');
const WhatsAppService = require('../../shared/services/whatsapp.service');
const MenuService = require('../../shared/services/menu.service');
const { resolveUx } = require('../../shared/config/ux-strings');

const FROM = fixturePhone(7654321);
const MESSAGE = { id: 'wamid.first-reply.test' };
const NEW_ROW = {
  id: 'user-uuid-brand-new', phone_number: FROM, first_name: null, name: null, role: null,
  preferred_language: 'ur', language_locked: false, first_message_at: null,
  registration_completed: false, registration_pending_name: false,
};
const OLD_ROW = { ...NEW_ROW, id: 'user-uuid-existing', first_message_at: '2026-09-01T08:00:00.000Z' };

const ENGLISH = 'I need a lesson plan on fractions for class 4';
const URDU_SCRIPT = 'مجھے کلاس چار کے لیے کسور پر سبق کا منصوبہ چاہیے';

/** The language this turn answered in: what the user message was stored with (storeConversation arg 7). */
function storedTurnLanguage() {
  const calls = BotHelpers.storeConversation.mock.calls.filter((c) => c[1] === 'user');
  return calls.length ? calls[0][6] : undefined;
}
/** The words the teacher was sent (the classifier is faked to "unsure": the reply is the real catalog line). */
function expectReplyIn(lang) {
  const sent = WhatsAppService.sendMessage.mock.calls.map((c) => c[1]);
  expect(sent).toContain(resolveUx('menuMatchUnsure', { language: lang }));
  expect(resolveUx('menuMatchUnsure', { language: 'en' })).not.toBe(resolveUx('menuMatchUnsure', { language: 'ur' }));
  for (const c of MenuService.sendMenu.mock.calls) expect(c[3]).toBe(lang);
}
/** The language every registration-Flow offer this turn was made in. */
function offerLanguages() {
  const all = [...mockOffer.mock.calls, ...mockOfferDetailed.mock.calls, ...mockSendInvite.mock.calls]
    .map((c) => c[0] && c[0].language);
  // every turn below is a new person who still needs the form: the Flow is offered, so its language is observable
  expect(all.length).toBeGreaterThan(0);
  return all;
}
/** Nothing in this turn may write a stored language or its lock. */
function expectNoLanguageWrite() {
  expect(LanguageCache.setUserLanguage).not.toHaveBeenCalled();
  for (const m of ['update', 'upsert', 'insert']) {
    for (const [payload] of supabase[m].mock.calls) {
      const rows = Array.isArray(payload) ? payload : [payload];
      for (const row of rows) {
        expect(row || {}).not.toHaveProperty('preferred_language');
        expect(row || {}).not.toHaveProperty('language_locked');
      }
    }
  }
}

async function turn(text, row) {
  // the whole turn must complete: a throw would skip the after-reply offer and hide the language it uses
  await handleTextMessage(MESSAGE, FROM, text, { ...row });
}

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.FIRST_REPLY_ENGLISH_EVIDENCE;
});
afterAll(() => { delete process.env.FIRST_REPLY_ENGLISH_EVIDENCE; });

describe('switch ON + brand-new row', () => {
  beforeEach(() => { process.env.FIRST_REPLY_ENGLISH_EVIDENCE = 'true'; });

  test('RED on the base: a plain English request is answered in English, and the Flow is offered in English', async () => {
    await turn(ENGLISH, NEW_ROW);
    expect(storedTurnLanguage()).toBe('en');
    expectReplyIn('en');
    const offers = offerLanguages();
    expect(offers.length).toBeGreaterThan(0);
    for (const lang of offers) expect(lang).toBe('en');
    expectNoLanguageWrite();
  });

  test.each([
    ['lesson plan chahiye', 'Roman Urdu'],
    ['I need lesson plan chahiye', 'mixed English + Roman Urdu'],
    [URDU_SCRIPT, 'Urdu script'],
  ])('%s (%s) → Urdu, as today', async (text) => {
    await turn(text, NEW_ROW);
    expect(storedTurnLanguage()).toBe('ur');
    expectReplyIn('ur');
    for (const lang of offerLanguages()) expect(lang).toBe('ur');
    expectNoLanguageWrite();
  });

  test.each(['aoa sir', 'Hello'])('%s (a greeting; Hello is also one word) → the greeting door offers the Flow in Urdu, as today', async (text) => {
    await turn(text, NEW_ROW);
    const offers = offerLanguages();
    expect(offers.length).toBeGreaterThan(0);
    for (const lang of offers) expect(lang).toBe('ur');
    expectNoLanguageWrite();
  });

  test('an EXISTING row stored ur sending a pure-English sentence → Urdu (unchanged)', async () => {
    await turn(ENGLISH, OLD_ROW);
    expect(storedTurnLanguage()).toBe('ur');
    expectReplyIn('ur');
    for (const lang of offerLanguages()) expect(lang).toBe('ur');
    expectNoLanguageWrite();
  });

  test('a brand-new row that LOCKED Urdu → Urdu (her choice wins)', async () => {
    await turn(ENGLISH, { ...NEW_ROW, language_locked: true });
    expect(storedTurnLanguage()).toBe('ur');
    expectReplyIn('ur');
    expectNoLanguageWrite();
  });
});

describe('switch OFF (absent, or anything but exactly "true") — every case is today\'s', () => {
  test.each([undefined, 'TRUE', '1', 'false'])('switch=%s: the plain English request on a brand-new row → Urdu', async (v) => {
    if (v !== undefined) process.env.FIRST_REPLY_ENGLISH_EVIDENCE = v;
    await turn(ENGLISH, NEW_ROW);
    expect(storedTurnLanguage()).toBe('ur');
    expectReplyIn('ur');
    for (const lang of offerLanguages()) expect(lang).toBe('ur');
    expectNoLanguageWrite();
  });

  test.each(['lesson plan chahiye', 'I need lesson plan chahiye', URDU_SCRIPT])('%s → Urdu', async (text) => {
    await turn(text, NEW_ROW);
    expect(storedTurnLanguage()).toBe('ur');
    expectReplyIn('ur');
    expectNoLanguageWrite();
  });

  test.each(['aoa sir', 'Hello'])('%s → the greeting door, in Urdu', async (text) => {
    await turn(text, NEW_ROW);
    for (const lang of offerLanguages()) expect(lang).toBe('ur');
    expectNoLanguageWrite();
  });

  test('existing row, English sentence → Urdu', async () => {
    await turn(ENGLISH, OLD_ROW);
    expect(storedTurnLanguage()).toBe('ur');
  });
});
