'use strict';
/**
 * "Jugnu" (and "reading game") on NIETE. Jugnu is what the main Rumi bot calls the children's reading game, and on
 * NIETE the same game is the coach app's Learning Assessment. NIETE had no such word: a Gilgit-Baltistan teacher's
 * "Jugnu" went to the intent classifier (general) and the chat model wrote a lesson plan about fireflies.
 *
 * Now, for a LEADER (observe-gate LEADER_ROLES), the whole message, in the main bot's words and its normalisation:
 *   a leader the Learning Assessment opens for (the child-test gate AND the portal's portal_child_test_sa)
 *       → ONE message with a button that opens the app signed in, on /portal/leader/assess;
 *   a Gilgit-Baltistan leader it does not open for → ONE line: it is not switched on for their account yet;
 *   an ICT leader it does not open for, or any leader whose gate cannot be read → exactly today's reply;
 *   the link cannot be made → ONE line that says so and where to find it.
 * A teacher's Jugnu is exactly today's: NIETE already calls the games and quizzes teachers send home "Jugnu".
 * The word is read only when no open conversation took it first (a quiz or video waiting for its topic, …), so a
 * waiting flow still gets its answer. No account, a child's handset and a sentence that mentions Jugnu: today's path.
 *
 * Driven through the REAL text handler, the REAL child-test gate and the REAL app link; the link is tapped through
 * the REAL GET /go router. Mocked: the DB (memory), the WhatsApp send layer, the LLM, redis, the portal's lookups.
 */

jest.mock('uuid', () => ({ v4: () => 'stub-uuid' }), { virtual: true });
jest.mock('p-limit', () => () => ((fn) => fn()), { virtual: true });
jest.mock('sharp', () => () => ({}), { virtual: true });
jest.mock('bullmq', () => ({ Queue: class {}, Worker: class {}, QueueEvents: class {} }), { virtual: true });
jest.mock('chartjs-node-canvas', () => ({ ChartJSNodeCanvas: class {} }), { virtual: true });
jest.mock('microsoft-cognitiveservices-speech-sdk', () => ({}), { virtual: true });

const { makeDb } = require('../quiz/helpers/memory-db');

let mockDb;
jest.mock('../../bot/shared/config/supabase', () => ({
  from: (...a) => mockDb.from(...a),
  rpc: (...a) => mockDb.rpc(...a),
}));

const mockStore = new Map();
jest.mock('../../bot/shared/services/cache/railway-redis.service', () => ({
  redis: {
    get: jest.fn(async (k) => (mockStore.has(k) ? JSON.stringify(mockStore.get(k)) : null)),
    set: jest.fn(async (k, v) => { mockStore.set(k, typeof v === 'string' ? JSON.parse(v) : v); return 'OK'; }),
    del: jest.fn(async (k) => { mockStore.delete(k); return 1; }),
  },
  get: jest.fn(async (k) => (mockStore.has(k) ? mockStore.get(k) : null)),
  set: jest.fn(async (k, v) => { mockStore.set(k, v); return true; }),
  setexWithCeiling: jest.fn(async (k, _t, v) => { mockStore.set(k, typeof v === 'string' ? JSON.parse(v) : v); return true; }),
  setNX: jest.fn(async (k, v) => { if (mockStore.has(k)) return false; mockStore.set(k, v); return true; }),
  delete: jest.fn(async (k) => { mockStore.delete(k); return true; }),
  del: jest.fn(async (k) => { mockStore.delete(k); return true; }),
}));

const mockDetectIntent = jest.fn().mockResolvedValue({ type: 'general' });
const mockGetResponse = jest.fn().mockResolvedValue('Lesson Plan: Reading Games with "Jugnu" - Grade 5');
jest.mock('../../bot/shared/services/openai.service', () => ({
  getResponseWithFormat: (...a) => mockGetResponse(...a),
  detectIntent: (...a) => mockDetectIntent(...a),
  generateResponse: jest.fn().mockResolvedValue('ok'),
}));

const mockWa = {
  sendMessage: jest.fn().mockResolvedValue(true),
  sendCtaUrl: jest.fn().mockResolvedValue(true),
  sendFlow: jest.fn().mockResolvedValue(true),
  sendInteractiveMessage: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  sendFeatureMenuCarousel: jest.fn().mockResolvedValue(true),
  sendLanguageSelectionList: jest.fn().mockResolvedValue(true),
};
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: (...a) => mockWa.sendMessage(...a),
  sendCtaUrl: (...a) => mockWa.sendCtaUrl(...a),
  sendFlow: (...a) => mockWa.sendFlow(...a),
  sendInteractiveMessage: (...a) => mockWa.sendInteractiveMessage(...a),
  sendInteractiveButtons: (...a) => mockWa.sendInteractiveButtons(...a),
  sendFeatureMenuCarousel: (...a) => mockWa.sendFeatureMenuCarousel(...a),
  sendLanguageSelectionList: (...a) => mockWa.sendLanguageSelectionList(...a),
  sendTypingIndicator: jest.fn(),
  markAsRead: jest.fn(),
  startContinuousTypingIndicator: () => ({ stop: jest.fn() }),
}));

jest.mock('../../bot/shared/services/lp-context.service', () => ({
  injectLpContext: jest.fn(async ({ existingContext }) => existingContext || null),
  buildLpContext: jest.fn().mockResolvedValue({ entries: [] }),
  deliveryHint: () => '',
}));
jest.mock('../../bot/shared/services/lp612-edit-router.service', () => ({
  maybeHandleLp612Reply: jest.fn().mockResolvedValue(false),
}));
jest.mock('../../bot/shared/database/bot-helpers', () => ({
  getOrCreateUser: jest.fn(async () => global.__TEST_USER__),
  getOrCreateSession: jest.fn().mockResolvedValue('sess-1'),
  updateSessionType: jest.fn(),
  storeConversation: jest.fn(),
  storeLessonPlan: jest.fn(),
  getConversationHistory: jest.fn().mockResolvedValue([]),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../bot/shared/handlers/exam-checker.handler', () => ({
  ...jest.requireActual('../../bot/shared/handlers/exam-checker.handler'),
  hasActiveExamSession: jest.fn().mockResolvedValue(false),
  handleExamText: jest.fn().mockResolvedValue(null),
}));
jest.mock('../../dashboard/services/telemetry.service', () => ({ logEvent: jest.fn(), flush() {}, isEnabled: () => true }));
// A quiz and a video waiting for their topic: the real handlers' doors, with the work they start stubbed.
const mockTopic = jest.fn().mockResolvedValue(true);
jest.mock('../../bot/shared/services/quiz/quiz-orchestrator.service', () => ({
  ...jest.requireActual('../../bot/shared/services/quiz/quiz-orchestrator.service'),
  handleTopicReply: (...a) => mockTopic(...a),
}));
let mockVideoAwaiting = null;
const mockVideoStart = jest.fn().mockResolvedValue(true);
jest.mock('../../bot/shared/services/video/video-orchestrator.service', () => ({
  ...jest.requireActual('../../bot/shared/services/video/video-orchestrator.service'),
  checkAwaitingTopic: jest.fn(async () => mockVideoAwaiting),
  clearAwaitingTopic: jest.fn(async () => true),
  initiateVideoRequest: (...a) => mockVideoStart(...a),
}));

const PHONE = '923002222222';
const PORTAL = 'https://portal.example.test';
const person = (id, role, region, lang = 'en') => ({
  id, phone_number: PHONE, name: 'P', first_name: 'P', role, region,
  preferred_language: lang, registration_completed: true, registration_state: 'completed',
});
const GB_COACH = person('u-gb-coach', 'coach', 'Gilgit-Baltistan');
const GB_PRINCIPAL = person('u-gb-principal', 'principal', 'Gilgit-Baltistan');
const ICT_COACH = person('u-ict-coach', 'coach', 'Sihala');
const ICT_PRINCIPAL = person('u-ict-principal', 'principal', 'Urban-I');
const GB_TEACHER = person('u-gb-teacher', 'teacher', 'Gilgit-Baltistan');
const ICT_TEACHER = person('u-ict-teacher', 'teacher', 'Sihala');
const OFF_LIST_COACH = person('u-gb-coach-2', 'coach', 'Gilgit-Baltistan');
const LEADERS = [GB_COACH.id, GB_PRINCIPAL.id, ICT_COACH.id];

// Production's ICT values, with Gilgit-Baltistan and the GB leaders added (the config this change is switched on by).
const GATE_ENV = {
  CHILD_TEST_ENABLED: 'true',
  CHILD_TEST_REGIONS: 'niete,ict,islamabad,federal,sihala,urban,b.k,gilgit-baltistan',
  CHILD_TEST_COACH_IDS: LEADERS.join(','),
};
const PORTAL_ON = [{ key: 'portal_child_test_sa', value: LEADERS }];

const LEADER_BODY_EN = "Open Jugnu: the NIETE app's Learning Assessment. Pick a school and a grade, then hand the phone to each child in turn.";
const NOT_ON_EN = "Jugnu, the NIETE app's Learning Assessment, isn't switched on for your account yet.";
// The line the first version of this door sent a teacher: never sent now.
const OLD_TEACHER_LINE = "Jugnu is for coaches and school leaders in the NIETE app, and it isn't on for this account yet.";
const NO_LINK_EN = "I couldn't send the link. Open the NIETE app and tap Learning Assessment.";
const OLD_NO_LINK_EN = "I couldn't send the link just now. Open the NIETE app and tap Learning Assessment.";
// The region registry (region_features): the GB check reads it.
const REGISTRY = [
  { region: 'gilgit-baltistan', organization: 'moawin', display_name: 'Gilgit-Baltistan', is_active: true },
  { region: 'sihala', organization: 'niete', display_name: 'Sihala', is_active: true },
  { region: 'urban-i', organization: 'niete', display_name: 'Urban-I', is_active: true },
];

const WORDS = ['jugnu', '/jugnu', 'reading game', 'readinggame', '/readinggame', 'جگنو', 'پڑھنے کا کھیل', 'ریڈنگ گیم'];

const ENV = { ...process.env };
let handler; let me;
function load(user, { settings = PORTAL_ON, env = GATE_ENV, failTables = [] } = {}) {
  jest.resetModules();
  me = user ? { ...user } : null;
  mockDb = makeDb({
    users: user ? [{ ...user }] : [], app_settings: settings.map((r) => ({ ...r })),
    user_feature_first_use: [], coaching_sessions: [], leader_schools: [], region_features: REGISTRY.map((r) => ({ ...r })),
  }, { failTables });
  Object.assign(process.env, env);
  handler = require('../../bot/shared/handlers/text-message.handler');
}

async function say(body) {
  global.__TEST_USER__ = me ? { ...me } : null;
  try {
    await handler.handleTextMessage({ id: 'wamid.test' }, PHONE, body, me ? { ...me } : null);
  } catch (_) { /* a branch this suite does not stub — the assertions say what mattered */ }
  await new Promise((r) => setImmediate(r));
}

beforeEach(() => {
  jest.clearAllMocks();
  mockStore.clear();
  mockDetectIntent.mockResolvedValue({ type: 'general' });
  mockVideoAwaiting = null;
  // Dummy LLM keys: the real text handler builds an LLM client on load; the LLM itself is mocked above.
  process.env = {
    ...ENV, INTERNAL_API_KEY: 'test-internal-key', PORTAL_URL: PORTAL, SUPABASE_URL: 'https://abcdefgh.supabase.co',
    OPENAI_API_KEY: 'test-openai', OPENROUTER_API_KEY: 'test-openrouter',
  };
  for (const k of ['CHILD_TEST_ENABLED', 'CHILD_TEST_REGIONS', 'CHILD_TEST_COACH_IDS', 'APP_STORE_URL']) delete process.env[k];
});
afterAll(() => { process.env = ENV; });

// ── GET /go through the real router: where the link actually lands ──
// The router is driven in-process (router.handle with a request and a response stand-in), not over a loopback socket:
// a test file in the same jest worker that patches net.Socket without restoring it would refuse the connection.
async function tap(url) {
  const token = url.slice(`${PORTAL}/go/`.length);
  const router = require('../../dashboard/routes/app-login.routes').createAppLoginRouter({
    findUser: async (id) => (me && id === me.id ? { id: me.id, name: 'P' } : null),
    isTeacherV2: async () => false,
    isCoachApp: async () => false,
  });
  const session = { regenerate(cb) { cb(); }, save(cb) { cb(); } };
  return new Promise((resolve, reject) => {
    const req = { method: 'GET', url: `/go/${token}`, originalUrl: `/go/${token}`, headers: {}, ip: '127.0.0.1', socket: {}, session };
    const res = {
      statusCode: 200,
      set() { return this; },
      status(code) { this.statusCode = code; return this; },
      type() { return this; },
      send() { resolve({ status: this.statusCode, location: undefined, session }); return this; },
      redirect(code, location) { resolve({ status: code, location, session }); },
    };
    router.handle(req, res, (err) => (err ? reject(err) : resolve({ status: 404, location: undefined, session })));
  });
}

const ctas = () => mockWa.sendCtaUrl.mock.calls;
const texts = () => mockWa.sendMessage.mock.calls.map(([, t]) => t);
const chatRan = () => mockDetectIntent.mock.calls.length > 0 || mockGetResponse.mock.calls.length > 0;
const jugnuLines = () => texts().filter((t) => t === NOT_ON_EN || t === NO_LINK_EN || t === OLD_NO_LINK_EN || t === OLD_TEACHER_LINE
  || /جگنو، یعنی|جگنو ⁦NIETE⁩ ایپ میں|تعلیمی جائزہ پر ٹیپ/.test(t));
const waiting = (flow, step, payload = {}) => ({
  conversation_state: { flow, step, payload },
  conversation_state_expires_at: new Date(Date.now() + 3600e3).toISOString(),
});

describe('a leader the Learning Assessment opens for: one button, signed in on the Learning Assessment', () => {
  test.each(WORDS)('RED on the base: a GB coach types %s', async (word) => {
    load(GB_COACH);
    await say(word);
    expect(chatRan()).toBe(false);
    expect(texts()).toEqual([]);
    expect(ctas()).toHaveLength(1);
    const [to, { body, buttonText, url }] = ctas()[0];
    expect(to).toBe(PHONE);
    // the turn's language: a word typed in Urdu is answered in Urdu, as the text handler answers every typed Urdu message
    if (/[\u0600-\u06FF]/.test(word)) {
      expect(body).toContain('جگنو کھولیں');
      expect(buttonText).toBe('جگنو کھولیں');
    } else {
      expect(body).toBe(LEADER_BODY_EN);
      expect(buttonText).toBe('Open Jugnu');
    }
    const res = await tap(url);
    expect(res.status).toBe(303);
    expect(res.location).toBe('/portal/leader/assess');
    expect(res.session).toEqual(expect.objectContaining({ portalUserId: GB_COACH.id, isPortalAuth: true }));
  });

  test.each([[GB_PRINCIPAL], [ICT_COACH]])('RED on the base: %o gets the same button (ICT exactly as GB)', async (user) => {
    load(user);
    await say('Jugnu');
    expect(chatRan()).toBe(false);
    expect(ctas()).toHaveLength(1);
    expect((await tap(ctas()[0][1].url)).location).toBe('/portal/leader/assess');
  });

  test('RED on the base: in Urdu for a leader who reads Urdu (button within 20 code points)', async () => {
    load({ ...GB_COACH, preferred_language: 'ur' });
    await say('جگنو');
    expect(ctas()).toHaveLength(1);
    const { body, buttonText } = ctas()[0][1];
    expect(body).toContain('جگنو کھولیں');
    expect(body).toContain('تعلیمی جائزہ');
    expect(buttonText).toBe('جگنو کھولیں');
    expect([...buttonText].length).toBeLessThanOrEqual(20);
  });

  test.each(['Jugnu!', '  JUGNU  ', 'Reading  Game.', '/ReadingGame', 'ريڈنگ گیم', 'جگنو۔', 'جگـنو'])(
    'RED on the base: the main bot\'s normalisation: %j is the word', async (word) => {
      load(GB_COACH);
      await say(word);
      expect(ctas()).toHaveLength(1);
      expect(chatRan()).toBe(false);
    },
  );

  test('RED on the base: the funnel row names the request, the door and the leader audience', async () => {
    load(GB_COACH);
    await say('jugnu');
    const logger = require('../../bot/shared/utils/logger');
    const cmd = logger.logToFile.mock.calls.find(([n]) => n === 'app_funnel.command');
    expect(cmd[1]).toEqual(expect.objectContaining({ feature: 'learning_assessment', door: 'jugnu_word', verdict: 'link', audience: 'leader' }));
  });
});

describe('a teacher\'s Jugnu is exactly today\'s (NIETE already calls the games teachers send home "Jugnu")', () => {
  test.each(WORDS)('RED on the head before this fix: a GB teacher types %s: no Learning Assessment line, no button', async (word) => {
    load(GB_TEACHER);
    await say(word);
    expect(ctas()).toHaveLength(0);
    expect(jugnuLines()).toEqual([]);
  });

  test.each([[GB_TEACHER], [ICT_TEACHER], [{ ...ICT_TEACHER, preferred_language: 'ur' }]])(
    'RED on the head before this fix: %o types "jugnu": the chat answers it, as on sandbox', async (user) => {
      load(user);
      await say('jugnu');
      expect(mockDetectIntent).toHaveBeenCalledTimes(1);
      expect(jugnuLines()).toEqual([]);
      expect(ctas()).toHaveLength(0);
    },
  );
});

describe('a Gilgit-Baltistan leader the Learning Assessment does not open for: one line that is true for a leader', () => {
  test.each([
    ['not on the pilot list', OFF_LIST_COACH, {}],
    ['outside the child-test regions', GB_COACH, { env: { ...GATE_ENV, CHILD_TEST_REGIONS: 'niete,ict,sihala' } }],
    ['the child test off on this deployment', GB_COACH, { env: { ...GATE_ENV, CHILD_TEST_ENABLED: 'false' } }],
    ['on the bot\'s list but not on the portal\'s (the page would refuse)', GB_COACH, { settings: [] }],
  ])('RED on the head before this fix: a leader %s', async (_label, user, opts) => {
    load(user, opts);
    await say('jugnu');
    expect(chatRan()).toBe(false);
    expect(ctas()).toHaveLength(0);
    expect(texts()).toEqual([NOT_ON_EN]);
  });

  test('RED on the head before this fix: the same line in Urdu for a leader who reads Urdu', async () => {
    load({ ...OFF_LIST_COACH, preferred_language: 'ur' });
    await say('جگنو');
    expect(chatRan()).toBe(false);
    expect(texts()).toHaveLength(1);
    expect(texts()[0]).toContain('تعلیمی جائزہ');
    expect(texts()[0]).toContain('ابھی آپ کے اکاؤنٹ پر دستیاب نہیں');
    expect(texts()[0]).not.toMatch(/ٹیسٹ|امتحان|کوچز اور اسکول سربراہان/);
  });

  test.each([['no signing key', 'INTERNAL_API_KEY'], ['no portal address', 'PORTAL_URL']])(
    'RED on the second review\'s head: the link cannot be made here (%s): a line true for that state, not "just now", and an error log', async (_l, key) => {
      load(GB_COACH);
      delete process.env[key];
      await say('jugnu');
      expect(chatRan()).toBe(false);
      expect(ctas()).toHaveLength(0);
      expect(texts()).toEqual([NO_LINK_EN]);
      const logger = require('../../bot/shared/utils/logger');
      expect(logger.logToFile.mock.calls.some(([m, , level]) => /link not sent/.test(m) && level === 'error')).toBe(true);
    },
  );

  test.each([['off the pilot list', OFF_LIST_COACH], ['on the pilot list', GB_COACH]])(
    'RED on the second review\'s head: a GB leader %s whose gate cannot be read (a database failure): today\'s reply, never "not switched on", and a warn', async (_l, user) => {
    load(user, { failTables: ['app_settings'] });
    await say('jugnu');
    expect(ctas()).toHaveLength(0);
    expect(jugnuLines()).toEqual([]);
    expect(mockDetectIntent).toHaveBeenCalledTimes(1);
    const logger = require('../../bot/shared/utils/logger');
    expect(logger.logToFile.mock.calls.some(([m, , level]) => /could not be read/.test(m) && level === 'warn')).toBe(true);
  });
});

describe('an ICT leader the Learning Assessment does not open for: exactly today\'s reply (the chat), no new line', () => {
  test.each(['جگنو', 'jugnu', 'reading game'])('RED on the second review\'s head: an ICT principal not on the gate types %s', async (word) => {
    load(ICT_PRINCIPAL);
    await say(word);
    expect(mockDetectIntent).toHaveBeenCalledTimes(1);
    expect(jugnuLines()).toEqual([]);
    expect(ctas()).toHaveLength(0);
  });

  test.each([
    ['with the portal switch off', ICT_COACH, { settings: [] }],
    ['with the child test off on this deployment', ICT_COACH, { env: { ...GATE_ENV, CHILD_TEST_ENABLED: 'false' } }],
  ])('RED on the second review\'s head: an ICT coach %s types "jugnu"', async (_l, user, opts) => {
    load(user, opts);
    await say('jugnu');
    expect(mockDetectIntent).toHaveBeenCalledTimes(1);
    expect(jugnuLines()).toEqual([]);
    expect(ctas()).toHaveLength(0);
  });
});

describe('an open conversation keeps the word: Jugnu is read only when nothing is waiting for an answer', () => {
  test('RED on the head before this fix: an ICT teacher asked for a quiz topic replies «جگنو»: the quiz takes it as the topic', async () => {
    load({ ...ICT_TEACHER, preferred_language: 'ur', ...waiting('quiz', 'awaiting_topic', { grade: 3 }) });
    await say('جگنو');
    expect(mockTopic).toHaveBeenCalledTimes(1);
    expect(mockTopic.mock.calls[0][2]).toBe('جگنو');
    expect(jugnuLines()).toEqual([]);
    expect(ctas()).toHaveLength(0);
  });

  test('RED on the head before this fix: a leader the Learning Assessment opens for, asked for a quiz topic, replies «جگنو»: the quiz takes it', async () => {
    load({ ...GB_COACH, ...waiting('quiz', 'awaiting_topic', { grade: 3 }) });
    await say('جگنو');
    expect(mockTopic).toHaveBeenCalledTimes(1);
    expect(mockTopic.mock.calls[0][2]).toBe('جگنو');
    expect(ctas()).toHaveLength(0);
  });

  test('RED on the head before this fix: a leader asked for a video topic replies "jugnu": the video takes it', async () => {
    mockVideoAwaiting = { sessionId: 'sess-1' };
    load(GB_COACH);
    await say('jugnu');
    expect(mockVideoStart).toHaveBeenCalledTimes(1);
    expect(ctas()).toHaveLength(0);
    expect(jugnuLines()).toEqual([]);
  });
});

describe('today\'s path, unchanged', () => {
  test('no account: not answered here (never a "not on" line, never a link)', async () => {
    load(null);
    await say('jugnu');
    expect(ctas()).toHaveLength(0);
    expect(jugnuLines()).toEqual([]);
  });

  test('a child\'s handset (persona student) that reaches the text handler: not answered here', async () => {
    load({ ...person('u-child', null, 'Gilgit-Baltistan'), persona: 'student', personaReason: 'identity' });
    await say('jugnu');
    expect(ctas()).toHaveLength(0);
    expect(jugnuLines()).toEqual([]);
  });

  test('a sentence that mentions Jugnu is the chat\'s, as before (a leader too)', async () => {
    load(GB_COACH);
    await say('jugnu what is photosynthesis');
    expect(jugnuLines()).toEqual([]);
    expect(ctas()).toHaveLength(0);
    expect(mockDetectIntent).toHaveBeenCalled();
  });

  test('a registered user with neither role (a parent): not answered here', async () => {
    load(person('u-parent', 'parent', 'Gilgit-Baltistan'));
    await say('jugnu');
    expect(ctas()).toHaveLength(0);
    expect(jugnuLines()).toEqual([]);
  });
});
