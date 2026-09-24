'use strict';
/**
 * A teacher who types "quiz" — in any spelling — lands on the /quiz menu.
 *
 * Production, 14 days to 24 Sep: of 351 bare "quiz" texts that reached the
 * text handler, only 138 saw the menu. 54 went to general AI chat because
 * `isQuizCommand` accepted only the exact strings `quiz`, `/quiz…` and «کوئز»
 * (`quiz/`, `/ quiz`, `/quizz`, `quize`, `quiz?`, `send me quiz`, `where is
 * quiz`, `mera quiz`, `mujhe quize dein` …); a quiz typed inside a 10-minute
 * 👎 window was stored as the lesson plan's feedback reason; a coach was told
 * to record a lesson for coaching; a child who typed the word got tutor chat,
 * and a child in the middle of a quiz got the teacher's lesson list.
 *
 * This suite drives the REAL text handler (and the real child door), mocking
 * only the network boundary: supabase (an in-memory table store), redis (a
 * map), WhatsApp, the LLM. Every decision in between is the shipped code.
 */

// Bot-only packages, mocked virtually — CI runs the root suite before `bot/ npm ci`.
jest.mock('uuid', () => ({ v4: () => 'stub-uuid' }), { virtual: true });
jest.mock('p-limit', () => () => ((fn) => fn()), { virtual: true });
jest.mock('sharp', () => () => ({}), { virtual: true });
jest.mock('bullmq', () => ({ Queue: class {}, Worker: class {}, QueueEvents: class {} }), { virtual: true });
jest.mock('chartjs-node-canvas', () => ({ ChartJSNodeCanvas: class {} }), { virtual: true });
jest.mock('microsoft-cognitiveservices-speech-sdk', () => ({}), { virtual: true });

const { makeDb } = require('./helpers/memory-db');

let mockDb;
jest.mock('../../bot/shared/config/supabase', () => ({
  from: (...a) => mockDb.from(...a),
  rpc: (...a) => mockDb.rpc(...a),
  auth: {},
}));

// Redis: one map, the shapes both client styles read (parsed get / raw redis.get).
const mockStore = new Map();
jest.mock('../../bot/shared/services/cache/railway-redis.service', () => ({
  redis: {
    get: jest.fn(async (k) => (mockStore.has(k) ? JSON.stringify(mockStore.get(k)) : null)),
    set: jest.fn(async (k, v) => { mockStore.set(k, typeof v === 'string' ? JSON.parse(v) : v); return 'OK'; }),
    del: jest.fn(async (k) => { mockStore.delete(k); return 1; }),
  },
  isAvailable: () => true,
  get: jest.fn(async (k) => (mockStore.has(k) ? mockStore.get(k) : null)),
  set: jest.fn(async (k, v) => { mockStore.set(k, v); return true; }),
  setexWithCeiling: jest.fn(async (k, _t, v) => { mockStore.set(k, typeof v === 'string' ? JSON.parse(v) : v); return true; }),
  setNX: jest.fn(async (k, v) => { if (mockStore.has(k)) return false; mockStore.set(k, v); return true; }),
  delete: jest.fn(async (k) => { mockStore.delete(k); return true; }),
  del: jest.fn(async (k) => { mockStore.delete(k); return true; }),
}));

const mockDetectIntent = jest.fn().mockResolvedValue({ type: 'general' });
const mockGetResponse = jest.fn().mockResolvedValue('a warm answer');
jest.mock('../../bot/shared/services/openai.service', () => ({
  getResponseWithFormat: (...a) => mockGetResponse(...a),
  detectIntent: (...a) => mockDetectIntent(...a),
  generateResponse: jest.fn().mockResolvedValue('ok'),
}));

const mockWa = {
  sendMessage: jest.fn().mockResolvedValue(true),
  sendFlow: jest.fn().mockResolvedValue(true),
  sendInteractiveMessage: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  sendFeatureMenuCarousel: jest.fn().mockResolvedValue(true),
};
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: (...a) => mockWa.sendMessage(...a),
  sendFlow: (...a) => mockWa.sendFlow(...a),
  sendInteractiveMessage: (...a) => mockWa.sendInteractiveMessage(...a),
  sendInteractiveButtons: (...a) => mockWa.sendInteractiveButtons(...a),
  sendFeatureMenuCarousel: (...a) => mockWa.sendFeatureMenuCarousel(...a),
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
const mockLogEvent = jest.fn();
jest.mock('../../bot/shared/utils/structured-logger', () => {
  const actual = jest.requireActual('../../bot/shared/utils/structured-logger');
  return { ...actual, logEvent: (...a) => mockLogEvent(...a) };
});

const { resolveUx } = require('../../bot/shared/config/ux-strings');

const TEACHER_PHONE = '923002220000';
const CHILD_PHONE = '923001110000';
const TEACHER = {
  id: 'u-teacher', phone_number: TEACHER_PHONE, name: 'T', role: 'teacher',
  preferred_language: 'en', registration_completed: true, registration_state: 'completed',
};
const COACH = { ...TEACHER, id: 'u-coach', role: 'coach' };
const CHILD = {
  id: 'u-child', phone_number: CHILD_PHONE, name: null, role: 'teacher', preferred_language: 'en',
  registration_completed: false, registration_state: null, persona: 'student', personaLanguage: 'en',
};

function seed() {
  return {
    users: [TEACHER, COACH, CHILD].map(({ persona, personaLanguage, ...u }) => u),
    coaching_sessions: [{
      id: 'cs-1', user_id: TEACHER.id, status: 'completed', observation_type: null,
      created_at: '2026-09-20T05:00:00Z', transcript_text: 'x'.repeat(4000),
      analysis_data: { topic: 'Photosynthesis', subject: 'science' },
    }],
    quizzes: [],
    quiz_sessions: [],
    lp_feedback: [{ id: 'fb-1', user_id: TEACHER.id, reason_text: null }],
  };
}

let handler;
function load() {
  jest.resetModules();
  handler = require('../../bot/shared/handlers/text-message.handler');
}

async function say(user, body) {
  global.__TEST_USER__ = user;
  try {
    await handler.handleTextMessage({ id: 'wamid.test' }, user.phone_number, body, user);
  } catch (_) { /* a branch this suite does not stub — the assertions say what mattered */ }
  await new Promise((r) => setImmediate(r));
}

const flowSentTo = (phone) => mockWa.sendFlow.mock.calls.some(([to, o]) => to === phone && o && o.flowId === 'flow-tq');

beforeEach(() => {
  jest.clearAllMocks();
  mockStore.clear();
  mockDb = makeDb(seed());
  process.env.TRANSCRIPT_QUIZ_ENABLED = 'true';
  process.env.TRANSCRIPT_QUIZ_FLOW_ID = 'flow-tq';
  load();
});
afterAll(() => {
  delete process.env.TRANSCRIPT_QUIZ_ENABLED;
  delete process.env.TRANSCRIPT_QUIZ_FLOW_ID;
});

describe('a teacher\'s bare quiz request opens the /quiz menu — every spelling seen in production', () => {
  // Each of these reached general AI chat (or a state handler) in production.
  test.each([
    'quiz/', '/ quiz', '/quizz', 'quize', 'Quiz?', 'QUIZ!', 'quizzes', 'My quiz', 'my quizzes',
    'send me quiz', 'where is my quiz', 'where is the quiz', 'give me quiz', 'make a quiz', 'new quiz',
    'quiz btao', 'quiz den', 'mera quiz', 'mujhe quize dein', 'quiz send kar dein', 'please quiz',
    'کویز', 'کوئز؟', 'میرے کوئز', 'كوئز',
  ])('%s → the /quiz Flow, and never the intent classifier', async (text) => {
    await say(TEACHER, text);
    expect(flowSentTo(TEACHER_PHONE)).toBe(true);
    expect(mockDetectIntent).not.toHaveBeenCalled();
  });

  test('the exact word still works (regression)', async () => {
    await say(TEACHER, 'quiz');
    expect(flowSentTo(TEACHER_PHONE)).toBe(true);
  });

  test.each([
    'quiz on fractions for class 4', 'stop quiz', 'next quiz', 'what is a quiz', 'quiz time',
  ])('%s is not a bare menu request and is left to the ordinary path', async (text) => {
    await say(TEACHER, text);
    expect(flowSentTo(TEACHER_PHONE)).toBe(false);
  });

  test('the decision is logged, ids only', async () => {
    await say(TEACHER, 'quiz/');
    expect(mockLogEvent).toHaveBeenCalledWith('quiz_menu.requested', expect.objectContaining({
      userId: TEACHER.id, route: 'teacher_menu',
    }));
    const [, fields] = mockLogEvent.mock.calls.find(([e]) => e === 'quiz_menu.requested');
    expect(JSON.stringify(fields)).not.toMatch(/quiz\/|923/);
  });
});

describe('the 👎 reason window does not swallow a quiz request', () => {
  test('LP feedback pending → "quiz" opens the menu and is NOT stored as the reason', async () => {
    mockStore.set(`lp_feedback_pending:${TEACHER.id}`, { lpFeedbackId: 'fb-1', polarity: 'disliked' });
    await say(TEACHER, 'quiz');
    expect(flowSentTo(TEACHER_PHONE)).toBe(true);
    expect(mockDb.tables.lp_feedback[0].reason_text).toBeNull();
    // The window stays open for the teacher's real reason, as it does for a slash command.
    expect(mockStore.has(`lp_feedback_pending:${TEACHER.id}`)).toBe(true);
  });
});

describe('a handset in the middle of a quiz stays in it', () => {
  test('a question is waiting → one line in the QUIZ\'s language, no menu, no quiz list', async () => {
    mockStore.set(`videoquiz:${TEACHER_PHONE}:active`, {
      sessionId: 'qs-1', quizId: 'q-1', language: 'ur', currentQuestionId: 'qq-3', index: 2,
    });
    await say(TEACHER, 'quiz');
    expect(flowSentTo(TEACHER_PHONE)).toBe(false);
    expect(mockWa.sendInteractiveMessage).not.toHaveBeenCalled();
    expect(mockWa.sendMessage).toHaveBeenCalledWith(TEACHER_PHONE, resolveUx('vqStillInQuiz', { language: 'ur' }));
    // Still mid-quiz: nothing touched the state.
    expect(mockStore.get(`videoquiz:${TEACHER_PHONE}:active`).currentQuestionId).toBe('qq-3');
  });

  test('a proven child mid-quiz gets the same line, never the teacher menu', async () => {
    mockStore.set(`videoquiz:${CHILD_PHONE}:active`, {
      sessionId: 'qs-2', quizId: 'q-2', language: 'en', currentQuestionId: 'qq-1', index: 0,
    });
    await say(CHILD, 'Quiz');
    expect(flowSentTo(CHILD_PHONE)).toBe(false);
    expect(mockWa.sendMessage).toHaveBeenCalledWith(CHILD_PHONE, resolveUx('vqStillInQuiz', { language: 'en' }));
  });
});

describe('a coach has their own menu', () => {
  test('a coach typing quiz gets their role menu, not "record a lesson for coaching first"', async () => {
    await say(COACH, 'quiz');
    expect(flowSentTo(COACH.phone_number)).toBe(false);
    expect(mockWa.sendFeatureMenuCarousel).toHaveBeenCalledWith(
      COACH.phone_number, expect.objectContaining({ role: 'coach' }), expect.anything(), expect.anything(),
    );
    expect(mockWa.sendMessage).not.toHaveBeenCalledWith(COACH.phone_number, resolveUx('tqListEmpty', { language: 'en' }));
  });
});

describe('the child door (student ingress)', () => {
  function ingress() { return require('../../bot/shared/services/student-ingress'); }

  test.each(['quiz', 'Quiz?', 'my quizzes', 'کوئز'])('a proven child typing %s gets THEIR quiz list, not tutor chat', async (text) => {
    const handled = await ingress().route({
      message: { id: 'w1', type: 'text' }, messageType: 'text', messageBody: text, from: CHILD_PHONE, user: { ...CHILD },
    });
    expect(handled).toBe(true);
    expect(mockGetResponse).not.toHaveBeenCalled();
    // No quiz on this handset yet: the child's own "no quizzes" line.
    expect(mockWa.sendMessage).toHaveBeenCalledWith(CHILD_PHONE, resolveUx('sqNoQuizzes', { language: 'en' }));
  });
});

describe('a child in the middle of joining a quiz', () => {
  test('typing "quiz" at the name question asks the name again — "quiz" is never stored as a name', async () => {
    const Share = require('../../bot/shared/services/quiz/video-quiz-share.service');
    const key = Share.JOIN_KEY(CHILD_PHONE);
    mockStore.set(key, { step: 'name', language: 'en', quizId: 'q-1', shareCodeId: 'sc-1' });
    const claimed = await Share.consumeJoinReply(CHILD_PHONE, 'Quiz');
    expect(claimed).toBe(true);
    expect(mockStore.get(key).step).toBe('name');
    expect(mockStore.get(key).studentName).toBeUndefined();
    expect(mockWa.sendMessage).toHaveBeenCalledWith(CHILD_PHONE, resolveUx('vqAskNameAgain', { language: 'en' }));
  });

  test('a real name is still taken (regression)', async () => {
    const Share = require('../../bot/shared/services/quiz/video-quiz-share.service');
    const key = Share.JOIN_KEY(CHILD_PHONE);
    mockStore.set(key, { step: 'name', language: 'en', quizId: 'q-1', shareCodeId: 'sc-1' });
    await Share.consumeJoinReply(CHILD_PHONE, 'Zara');
    expect(mockStore.get(key)).toEqual(expect.objectContaining({ step: 'class', studentName: 'Zara' }));
  });
});

// ── kill switches (operator, 24 Sep): unset = on; 'false' / '0' / 'off' = the old behaviour, exactly ──

describe('kill switch QUIZ_BARE_TEXT_TO_MENU=false — the old door, exactly', () => {
  beforeEach(() => { process.env.QUIZ_BARE_TEXT_TO_MENU = 'false'; load(); });
  afterEach(() => { delete process.env.QUIZ_BARE_TEXT_TO_MENU; });

  test.each(['quiz/', 'mera quiz', 'کویز', 'send me quiz'])('%s goes to the intent classifier, as before', async (text) => {
    await say(TEACHER, text);
    expect(flowSentTo(TEACHER_PHONE)).toBe(false);
    expect(mockDetectIntent).toHaveBeenCalled();
  });

  test('the exact word and the command still open the menu, as they always did', async () => {
    await say(TEACHER, 'quiz');
    expect(flowSentTo(TEACHER_PHONE)).toBe(true);
    mockWa.sendFlow.mockClear();
    await say(TEACHER, '/quiz');
    expect(flowSentTo(TEACHER_PHONE)).toBe(true);
  });

  test('an open 👎 window takes "quiz" as the reason, as before', async () => {
    mockStore.set(`lp_feedback_pending:${TEACHER.id}`, { lpFeedbackId: 'fb-1', polarity: 'disliked' });
    await say(TEACHER, 'quiz');
    expect(mockDb.tables.lp_feedback[0].reason_text).toBe('quiz');
    expect(flowSentTo(TEACHER_PHONE)).toBe(false);
  });

  test('a proven child typing "quiz" gets the tutor, as before', async () => {
    const ingress = require('../../bot/shared/services/student-ingress');
    await ingress.route({
      message: { id: 'w1', type: 'text' }, messageType: 'text', messageBody: 'quiz', from: CHILD_PHONE, user: { ...CHILD },
    });
    expect(mockGetResponse).toHaveBeenCalled();
  });

  test('a child at the name question typing "Quiz" is taken at their word, as before', async () => {
    const Share = require('../../bot/shared/services/quiz/video-quiz-share.service');
    const key = Share.JOIN_KEY(CHILD_PHONE);
    mockStore.set(key, { step: 'name', language: 'en', quizId: 'q-1', shareCodeId: 'sc-1' });
    await Share.consumeJoinReply(CHILD_PHONE, 'Quiz');
    expect(mockStore.get(key)).toEqual(expect.objectContaining({ step: 'class', studentName: 'Quiz' }));
  });
});

describe('kill switch QUIZ_MENU_HANDSET_ROUTING=false — every handset gets the teacher menu, as before', () => {
  beforeEach(() => { process.env.QUIZ_MENU_HANDSET_ROUTING = 'off'; load(); });
  afterEach(() => { delete process.env.QUIZ_MENU_HANDSET_ROUTING; });

  test('a question waiting on the handset → the teacher menu, not the reminder', async () => {
    mockStore.set(`videoquiz:${TEACHER_PHONE}:active`, {
      sessionId: 'qs-1', quizId: 'q-1', language: 'en', currentQuestionId: 'qq-3', index: 2,
    });
    await say(TEACHER, 'quiz');
    expect(flowSentTo(TEACHER_PHONE)).toBe(true);
    expect(mockWa.sendMessage).not.toHaveBeenCalledWith(TEACHER_PHONE, resolveUx('vqStillInQuiz', { language: 'en' }));
  });

  test('a coach → the teacher /quiz path, not the coach menu', async () => {
    await say(COACH, 'quiz');
    expect(mockWa.sendFeatureMenuCarousel).not.toHaveBeenCalled();
  });
});
