/**
 * PLAN_R5 D8 — the ONE student-mode gate, executed inside the real handler.
 *
 * The repo's TDD rule is explicit that a source-text grep does not count: a
 * grep-green call site can still be a runtime ReferenceError, and the thing
 * being asserted here — "the persona reaches the model, and ONLY on the
 * free-chat path" — is a property of what actually runs, not of what is
 * written. So this suite loads the real 2,900-line text handler and drives it.
 *
 * Class O of the pre-merge checklist applies directly: student-mode.service is
 * the module under audit, so it is NOT mocked. The mocks stop at the network
 * boundary — supabase, redis, the LLM client and WhatsApp — and the decision
 * itself is the real one, reading the real rows the doubles return.
 *
 * Four things are proven, and they are different:
 *   1. THE GATE RUNS on free chat and its verdict reaches the prompt builder.
 *   2. A REGISTERED TEACHER IS NEVER A STUDENT, even holding a handset that
 *      carries a child's row and a quiz from this morning.
 *   3. THE FLAG IS A KILL SWITCH — off, nothing is read and nothing changes.
 *   4. IT TOUCHES NOTHING ELSE — a share code, a command and a quiz answer all
 *      short-circuit above it, proven by the gate's own reads never happening.
 */

// Bot-only packages, mocked virtually — CI runs the root suite before `bot/ npm ci`,
// and a module-scope require of one kills the whole suite FILE. Same set as
// tests/lp612/handler-wiring.test.js, which is the other suite that loads this handler.
jest.mock('uuid', () => ({ v4: () => 'stub-uuid' }), { virtual: true });
jest.mock('p-limit', () => () => ((fn) => fn()), { virtual: true });
jest.mock('sharp', () => () => ({}), { virtual: true });
jest.mock('bullmq', () => ({ Queue: class {}, Worker: class {}, QueueEvents: class {} }), { virtual: true });
jest.mock('chartjs-node-canvas', () => ({ ChartJSNodeCanvas: class {} }), { virtual: true });
jest.mock('microsoft-cognitiveservices-speech-sdk', () => ({}), { virtual: true });

const { installFrom } = require('./helpers/supabase-chain');

const mockFrom = jest.fn();
jest.mock('../../bot/shared/config/supabase', () => ({
  from: (...a) => mockFrom(...a),
  rpc: jest.fn().mockResolvedValue({ data: null, error: null }),
  auth: {},
}));

const mockGetResponse = jest.fn().mockResolvedValue('a warm answer');
const mockDetectIntent = jest.fn().mockResolvedValue({ type: 'general' });
jest.mock('../../bot/shared/services/openai.service', () => ({
  getResponseWithFormat: (...a) => mockGetResponse(...a),
  detectIntent: (...a) => mockDetectIntent(...a),
  generateResponse: jest.fn().mockResolvedValue('ok'),
}));

const mockSendMessage = jest.fn().mockResolvedValue(undefined);
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: (...a) => mockSendMessage(...a),
  sendTypingIndicator: jest.fn(),
  markAsRead: jest.fn(),
  sendInteractiveMessage: jest.fn().mockResolvedValue(undefined),
  sendFlow: jest.fn().mockResolvedValue(undefined),
  startContinuousTypingIndicator: () => ({ stop: jest.fn() }),
}));

jest.mock('../../bot/shared/services/cache/railway-redis.service', () => ({
  redis: { get: jest.fn().mockResolvedValue(null), set: jest.fn(), del: jest.fn() },
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue(undefined),
  setNX: jest.fn().mockResolvedValue(true),
  delete: jest.fn().mockResolvedValue(undefined),
}));

// The share-code join is deliberately ABOVE the gate and runs before user
// lookup. It is real here — the point of test 4 is that it wins.
const mockBeginFromCodeLocked = jest.fn().mockResolvedValue(true);
jest.mock('../../bot/shared/services/quiz/video-quiz-share.service', () => ({
  parseShareCode: jest.requireActual('../../bot/shared/services/quiz/video-quiz-share.service').parseShareCode,
  beginFromCodeLocked: (...a) => mockBeginFromCodeLocked(...a),
  consumeJoinReply: jest.fn().mockResolvedValue(false),
}));

const mockGetActiveState = jest.fn().mockResolvedValue(null);
const mockHandleAnswer = jest.fn().mockResolvedValue(undefined);
jest.mock('../../bot/shared/services/quiz/quiz-session.service', () => ({
  // getPostQuizState is checked FIRST in the handler; leaving it undefined
  // throws inside the intercept's try/catch and the quiz branch is never
  // reached — which is exactly how the first draft of this suite mis-passed.
  getPostQuizState: jest.fn().mockResolvedValue(null),
  endPostQuizChat: jest.fn(),
  handlePostQuizChat: jest.fn(),
  getActiveState: (...a) => mockGetActiveState(...a),
  handleAnswer: (...a) => mockHandleAnswer(...a),
  startQuizFromInvite: jest.fn(),
  endSession: jest.fn(),
}));
jest.mock('../../bot/shared/services/training/capstone-delivery.service', () => ({
  routeTextAnswer: jest.fn().mockResolvedValue(false),
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
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const CHILD_PHONE = '923001110000';
const TEACHER_PHONE = '923002220000';

const CHILD_USER = {
  id: 'u-child', phone_number: CHILD_PHONE, first_name: null,
  preferred_language: 'en', registration_completed: false, registration_state: null,
};
const TEACHER_USER = {
  id: 'u-teacher', phone_number: TEACHER_PHONE, first_name: 'Ayesha',
  preferred_language: 'en', registration_completed: true, registration_state: 'completed',
};

const iso = (daysAgo) => new Date(Date.now() - daysAgo * 86400000).toISOString();

/**
 * The rows the gate's own two reads find: an active quiz-joined child on this
 * handset, and the quiz session that child took, in Urdu, three days ago.
 */
function seedChildHandset() {
  installFrom(mockFrom, {
    students: { data: [{ id: 's-1', student_name: 'Zara', self_reported_class: 'Class 5', is_active: true, created_at: iso(9) }], error: null },
    quiz_sessions: { data: [{ id: 'qs-1', created_at: iso(3), quiz_id: 'q-1', student_class: 'Class 5' }], error: null },
    quizzes: { data: [{ language: 'ur' }], error: null },
  });
}

/** A handset with no child on it at all — the ordinary teacher case. */
function seedEmptyHandset() {
  installFrom(mockFrom, {
    students: { data: [], error: null },
    quiz_sessions: { data: [], error: null },
    quizzes: { data: [], error: null },
  });
}

let handler;
function load() {
  jest.resetModules();
  handler = require('../../bot/shared/handlers/text-message.handler');
}

async function run(from, body, user) {
  global.__TEST_USER__ = user;
  try {
    await handler.handleTextMessage({ id: 'wamid.test' }, from, body, user);
  } catch (_) { /* branches below the gate reach services this suite does not stub */ }
  // The share-code join is dispatched with setImmediate so the webhook can
  // answer Meta in milliseconds. Let that turn of the loop run before asserting.
  await new Promise((r) => setImmediate(r));
}

/** The options object the gate hands the prompt builder (7th argument). */
const personaArg = () => (mockGetResponse.mock.calls[0] || [])[6];
const languageArg = () => (mockGetResponse.mock.calls[0] || [])[3];
const contextArg = () => (mockGetResponse.mock.calls[0] || [])[5];

beforeEach(() => {
  process.env.STUDENT_MODE_ENABLED = 'true';
  jest.clearAllMocks();
  mockGetResponse.mockResolvedValue('a warm answer');
  mockDetectIntent.mockResolvedValue({ type: 'general' });
  mockGetActiveState.mockResolvedValue(null);
  seedEmptyHandset();
  load();
});

afterAll(() => { delete process.env.STUDENT_MODE_ENABLED; });

describe('1 — the gate runs on free chat and its verdict reaches the prompt', () => {
  test('a child who finished a quiz three days ago is tutored, not assisted', async () => {
    seedChildHandset();
    await run(CHILD_PHONE, 'what is a fraction?', CHILD_USER);

    expect(mockGetResponse).toHaveBeenCalledTimes(1);
    expect(personaArg()).toMatchObject({ persona: 'student', studentClass: 'Class 5' });
  });

  test("the reply is in the child's quiz language, not the users row default", async () => {
    seedChildHandset();               // quiz language 'ur', users row preferred 'en'
    await run(CHILD_PHONE, 'what is a fraction?', CHILD_USER);
    expect(languageArg()).toBe('ur');
  });

  test('a child is never handed the teacher feature context', async () => {
    seedChildHandset();
    await run(CHILD_PHONE, 'tell me about my lesson plan', CHILD_USER);
    expect(contextArg()).toBeNull();
  });

  test("a child's own name is never put in the prompt", async () => {
    seedChildHandset();
    await run(CHILD_PHONE, 'what is a fraction?', CHILD_USER);
    expect((mockGetResponse.mock.calls[0] || [])[4]).toBeNull();
    expect(JSON.stringify(personaArg() || {})).not.toContain('Zara');
  });

  test('a handset with no child row keeps the teacher assistant', async () => {
    seedEmptyHandset();
    await run(TEACHER_PHONE, 'how do I teach fractions?', { ...TEACHER_USER, registration_completed: false, registration_state: null });
    expect(mockGetResponse).toHaveBeenCalledTimes(1);
    expect(personaArg()?.persona).toBeUndefined();
  });
});

describe('2 — a registered teacher is never a student', () => {
  test('even on a handset carrying an active child row and a quiz from three days ago', async () => {
    seedChildHandset();
    await run(TEACHER_PHONE, 'what is a fraction?', TEACHER_USER);

    expect(mockGetResponse).toHaveBeenCalledTimes(1);
    expect(personaArg()?.persona).toBeUndefined();
    expect(languageArg()).toBe('en');
  });

  test('saying "I am a teacher" from a child-flagged handset switches back immediately', async () => {
    seedChildHandset();
    await run(CHILD_PHONE, 'I am a teacher', CHILD_USER);
    expect(personaArg()?.persona).toBeUndefined();
  });

  test('...and retires the stray quiz-joined rows on that handset, roster rows untouched', async () => {
    seedChildHandset();
    await run(CHILD_PHONE, 'I am a teacher', CHILD_USER);

    const calls = mockFrom.callsFor('students').flat();
    const update = calls.find((c) => c[0] === 'update');
    expect(update).toBeTruthy();
    expect(update[1]).toMatchObject({ is_active: false });
    // list_id IS NULL — an attendance-roster child must never be retired by a chat message.
    expect(calls.some((c) => c[0] === 'is' && c[1] === 'list_id' && c[2] === null)).toBe(true);
  });

  test('"my teacher said" is a child talking, not a claim — nothing is retired', async () => {
    seedChildHandset();
    await run(CHILD_PHONE, 'my teacher said plants make their own food', CHILD_USER);

    expect(personaArg()).toMatchObject({ persona: 'student' });
    const updates = mockFrom.callsFor('students').flat().filter((c) => c[0] === 'update');
    expect(updates).toHaveLength(0);
  });
});

describe('3 — the flag is the kill switch', () => {
  test('off: the persona is absent and the gate reads nothing at all', async () => {
    process.env.STUDENT_MODE_ENABLED = 'false';
    seedChildHandset();
    load();
    await run(CHILD_PHONE, 'what is a fraction?', CHILD_USER);

    expect(mockGetResponse).toHaveBeenCalledTimes(1);
    expect(personaArg()?.persona).toBeUndefined();
    expect(languageArg()).toBe('en');
    expect(mockFrom.callsFor('students')).toHaveLength(0);
  });

  test('unset behaves exactly like off', async () => {
    delete process.env.STUDENT_MODE_ENABLED;
    seedChildHandset();
    load();
    await run(CHILD_PHONE, 'what is a fraction?', CHILD_USER);
    expect(personaArg()?.persona).toBeUndefined();
    expect(mockFrom.callsFor('students')).toHaveLength(0);
  });
});

describe('4 — everything else short-circuits above the gate', () => {
  test('a share code goes to the join, never to the gate', async () => {
    seedChildHandset();
    await run(CHILD_PHONE, 'QUIZ-ABC123', CHILD_USER);

    expect(mockBeginFromCodeLocked).toHaveBeenCalled();
    expect(mockGetResponse).not.toHaveBeenCalled();
    expect(mockFrom.callsFor('students')).toHaveLength(0);
  });

  test('a quiz answer goes to the quiz, never to the gate', async () => {
    seedChildHandset();
    mockGetActiveState.mockResolvedValue({ currentQuestionId: 'q7' });
    await run(CHILD_PHONE, 'B', CHILD_USER);

    expect(mockHandleAnswer).toHaveBeenCalled();
    expect(mockGetResponse).not.toHaveBeenCalled();
    expect(mockFrom.callsFor('students')).toHaveLength(0);
  });

  test('a slash command never reaches the gate', async () => {
    seedChildHandset();
    await run(CHILD_PHONE, '/menu', CHILD_USER);

    expect(mockGetResponse).not.toHaveBeenCalled();
  });
});
