/**
 * A typed letter answers the quiz the child is actually taking — and nothing
 * else on the handset is taken over by a quiz it does not belong to.
 *
 * The adaptive (parent) quiz recovers its state from the phone's newest
 * `quiz_sessions` row when Redis has none. That row is almost never its own:
 * video, transcript and lesson-plan quizzes write `quiz_sessions` too (source
 * `share_link` / `video_solo`), and nothing ever expires an abandoned one. So
 * the adaptive engine adopted those sessions, and every later text from that
 * phone — a child's typed "B", a teacher's "Lesson plan" menu tap, "/menu" —
 * was answered with "Tap one of the answer buttons above, or type A, B, or C"
 * while the letter itself was never recorded (production, 14 days: 2,893
 * adoptions over 2,754 sessions; 97% share_link / video_solo).
 *
 * Driven through the REAL text handler, the real adaptive and video quiz
 * services, render and sender. Only the network boundary (WhatsApp), the two
 * stores (supabase, Redis) and services this path never needs are stand-ins.
 */

jest.mock('uuid', () => ({ v4: () => 'stub-uuid' }), { virtual: true });
jest.mock('p-limit', () => () => ((fn) => fn()), { virtual: true });
jest.mock('sharp', () => () => ({}), { virtual: true });
jest.mock('bullmq', () => ({ Queue: class {}, Worker: class {}, QueueEvents: class {} }), { virtual: true });
jest.mock('chartjs-node-canvas', () => ({ ChartJSNodeCanvas: class {} }), { virtual: true });
jest.mock('microsoft-cognitiveservices-speech-sdk', () => ({}), { virtual: true });

// ── the database: tables that really filter, order and accumulate ──────────
const mockDb = { tables: {}, inserts: [], updates: [] };
function mockChain(table) {
  let rows = [...(mockDb.tables[table] || [])];
  let op = null; let payload = null;
  const filters = [];
  const chain = {};
  const apply = () => rows.filter((r) => filters.every(([f, v]) => r[f] === v));
  chain.select = () => chain;
  chain.eq = (f, v) => { filters.push([f, v]); return chain; };
  ['neq', 'in', 'is', 'not', 'gte', 'lte', 'lt', 'gt', 'or', 'range'].forEach((m) => { chain[m] = () => chain; });
  chain.order = (f, o) => {
    const desc = o && o.ascending === false;
    rows = [...rows].sort((a, b) => (String(a[f]) < String(b[f]) ? -1 : 1) * (desc ? -1 : 1));
    return chain;
  };
  chain.limit = () => chain;
  chain.insert = (p) => {
    op = 'insert'; payload = p; mockDb.inserts.push({ table, row: p });
    if (table === 'quiz_answers') {
      const all = mockDb.tables.quiz_answers || (mockDb.tables.quiz_answers = []);
      if (all.some((a) => a.session_id === p.session_id && a.question_id === p.question_id)) {
        return Promise.resolve({ error: { code: '23505', message: 'duplicate' } });
      }
      all.push(p);
      return Promise.resolve({ error: null });
    }
    return chain;
  };
  chain.update = (p) => { op = 'update'; payload = p; return chain; };
  chain.upsert = () => chain;
  chain.delete = () => chain;
  chain.single = async () => { const r = apply(); return r.length ? { data: r[0], error: null } : { data: null, error: { code: 'PGRST116' } }; };
  chain.maybeSingle = async () => ({ data: apply()[0] || null, error: null });
  chain.then = (res, rej) => {
    if (op === 'update') {
      const hit = apply(); hit.forEach((r) => Object.assign(r, payload));
      mockDb.updates.push({ table, patch: payload, filters: [...filters] });
      return Promise.resolve({ data: hit, error: null }).then(res, rej);
    }
    return Promise.resolve({ data: apply(), error: null }).then(res, rej);
  };
  return chain;
}
jest.mock('../../bot/shared/config/supabase', () => ({
  from: jest.fn((t) => mockChain(t)),
  rpc: jest.fn().mockResolvedValue({ data: null, error: null }),
  auth: {},
}));

// ── Redis: one namespace, separate keys — both the object API and the raw client
const mockKv = new Map();
jest.mock('../../bot/shared/services/cache/railway-redis.service', () => ({
  redis: {
    get: jest.fn(async (k) => (mockKv.has(k) ? mockKv.get(k) : null)),
    set: jest.fn(async (k, v) => { mockKv.set(k, v); return 'OK'; }),
    del: jest.fn(async (k) => { mockKv.delete(k); return 1; }),
  },
  get: jest.fn(async (k) => (mockKv.has(k) ? JSON.parse(mockKv.get(k)) : null)),
  set: jest.fn(async (k, v) => { mockKv.set(k, JSON.stringify(v)); return true; }),
  setNX: jest.fn(async (k, v) => { if (mockKv.has(k)) return false; mockKv.set(k, JSON.stringify(v)); return true; }),
  delete: jest.fn(async (k) => { mockKv.delete(k); return true; }),
  setexWithCeiling: jest.fn(async (k, _ttl, v) => { mockKv.set(k, typeof v === 'string' ? v : JSON.stringify(v)); return true; }),
}));

const mockSent = [];
jest.mock('../../bot/shared/services/whatsapp.service', () => {
  const ok = (kind) => jest.fn(async (to, payload) => { mockSent.push({ kind, to, payload }); return true; });
  return {
    sendMessage: ok('text'),
    sendTextReturningId: jest.fn(async (to, payload) => { mockSent.push({ kind: 'text', to, payload }); return 'wamid.t'; }),
    sendInteractiveButtons: ok('buttons'),
    sendImageWithButtons: ok('buttons'),
    sendInteractiveMessage: ok('list'),
    sendImageFromUrl: ok('image'),
    sendAudioFromUrlReturningId: jest.fn(async () => 'wamid.a'),
    sendFlow: ok('flow'),
    sendTypingIndicator: jest.fn(),
    markAsRead: jest.fn(),
    startContinuousTypingIndicator: () => ({ stop: jest.fn() }),
  };
});
jest.mock('../../bot/shared/services/openai.service', () => ({
  getResponseWithFormat: jest.fn().mockResolvedValue('a warm answer'),
  detectIntent: jest.fn().mockResolvedValue({ type: 'general' }),
  generateResponse: jest.fn().mockResolvedValue('ok'),
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
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const PHONE = '923001110000';
const PARENT_NUDGE = 'Tap one of the answer buttons above';
const SESSION = 'vq-session-1';

const question = (n) => ({
  id: `q-${n}`, quiz_id: 'quiz-1', external_id: `tq:quiz-1:S1:${n}`, sort_order: n,
  question_text: `Which one is right, ${n}?`, option_a: 'the first', option_b: 'the second', option_c: 'the third',
  option_d: null, correct_option: 'B', explanation: 'because', option_feedback: null, media: {}, render_pattern: 'P1',
});

/** A child mid video/transcript quiz: its quiz_sessions row (share_link, in_progress). */
const shareLinkRow = (over = {}) => ({
  id: SESSION, quiz_id: 'quiz-1', student_id: 'st-1', parent_phone: PHONE, source: 'share_link',
  status: 'in_progress', created_at: '2026-09-20T10:00:00Z', expires_at: '2099-01-01T00:00:00Z',
  current_difficulty: 3, total_questions_answered: 1, correct_answers: 1, ...over,
});

function reset({ sessions = [], questions = [question(0), question(1)], videoState = null } = {}) {
  mockDb.tables = { quiz_sessions: sessions, quiz_questions: questions, quiz_answers: [], users: [], training_assessment_attempts: [] };
  mockDb.inserts = []; mockDb.updates = [];
  mockKv.clear(); mockSent.length = 0;
  if (videoState) mockKv.set(`videoquiz:${PHONE}:active`, JSON.stringify(videoState));
}

const videoState = (over = {}) => ({
  sessionId: SESSION, quizId: 'quiz-1', videoId: null, userId: null, language: 'en', source: 'share_link',
  shareCodeId: null, studentId: 'st-1', takerName: 'Child', questionIds: ['q-0', 'q-1'],
  index: 0, correct: 0, answered: 0, currentQuestionId: 'q-0', sentAt: Date.now(), ...over,
});

let handler;
let QuizSessionService;
beforeEach(() => {
  jest.resetModules();
  jest.useFakeTimers();
  handler = require('../../bot/shared/handlers/text-message.handler');
  QuizSessionService = require('../../bot/shared/services/quiz/quiz-session.service');
});
afterEach(() => { jest.useRealTimers(); });

async function send(body, user = { id: 'u-1', phone_number: PHONE, preferred_language: 'en', registration_completed: true }) {
  global.__TEST_USER__ = user;
  let settled = false;
  const p = handler.handleTextMessage({ id: 'wamid.in' }, PHONE, body, user)
    .catch(() => { /* paths below the intercepts reach services this suite does not stub */ })
    .finally(() => { settled = true; });
  for (let i = 0; i < 100 && !settled; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await jest.runAllTimersAsync();
  }
  await p;
}
const texts = () => mockSent.filter((s) => s.kind === 'text').map((s) => String(s.payload));
const answers = () => mockDb.tables.quiz_answers;

describe('a typed letter during a video / transcript / lesson-plan quiz', () => {
  test('answers the current question with the option the child SAW under that letter', async () => {
    reset({ sessions: [shareLinkRow()], videoState: videoState() });
    const render = require('../../bot/shared/services/quiz/video-quiz-render.service');
    const ask = render.build(question(0)).find((m) => m.role === 'ask');
    const shownSecond = (ask.optionIndices || [0, 1, 2])[1];

    await send('b');

    expect(answers()).toEqual([
      expect.objectContaining({ session_id: SESSION, question_id: 'q-0', selected_option: 'ABCD'[shownSecond] }),
    ]);
    expect(texts().some((t) => t.includes(PARENT_NUDGE))).toBe(false);
  });

  test('a letter the question does not offer is not taken as an answer', async () => {
    reset({ sessions: [shareLinkRow()], videoState: videoState() });
    await send('D');
    expect(answers()).toEqual([]);
  });
});

describe('the adaptive quiz never adopts a session it does not own', () => {
  test('a teacher’s menu tap, with an abandoned share-link session on the phone, is never answered with the quiz nudge', async () => {
    reset({ sessions: [shareLinkRow({ student_id: null })] });   // no video state: the quiz was left days ago
    await send('Lesson plan · سبق کا منصوبہ');
    expect(texts().some((t) => t.includes(PARENT_NUDGE))).toBe(false);
    expect(mockKv.has(`quiz:student:${PHONE}:active`)).toBe(false);
  });

  test.each([['share_link'], ['video_solo']])('getActiveState does not recover a %s session', async (source) => {
    reset({ sessions: [shareLinkRow({ source })] });
    expect(await QuizSessionService.getActiveState(PHONE)).toBeNull();
  });

  test('a live roster (parent) session is still recovered', async () => {
    reset({ sessions: [shareLinkRow({ id: 'roster-1', source: 'roster', status: 'invited' })] });
    expect(await QuizSessionService.getActiveState(PHONE)).toEqual(expect.objectContaining({ sessionId: 'roster-1' }));
  });

  test('a roster session past its expiry is not recovered', async () => {
    reset({ sessions: [shareLinkRow({ id: 'roster-1', source: 'roster', expires_at: '2026-01-01T00:00:00Z' })] });
    expect(await QuizSessionService.getActiveState(PHONE)).toBeNull();
  });
});

// A typed STOP ends a video / transcript / lesson-plan class quiz. Before, "Stop"
// was honoured only by accident — the adaptive quiz had adopted the session and
// ran its own endSession on it. With the adoption gone, the class quiz needs a
// stop of its own: the session ends unfinished (not counted as finished, no
// score, no scorecard), its state is cleared, and the child is told in the
// quiz's language.
describe('a typed STOP ends the class quiz', () => {
  const { resolveUx } = require('../../bot/shared/config/ux-strings');
  const row = () => mockDb.tables.quiz_sessions.find((s) => s.id === SESSION);

  test.each([['stop'], ['STOP'], ['Stop.'], [' stop ']])('%j ends the session unfinished, clears its state and says so', async (body) => {
    reset({ sessions: [shareLinkRow()], videoState: videoState() });
    mockDb.tables.quiz_answers.push({ session_id: SESSION, question_id: 'q-prev', is_correct: true });

    await send(body);

    expect(row()).toEqual(expect.objectContaining({ status: 'incomplete', total_questions_answered: 1, correct_answers: 1 }));
    expect(row().mastery_percentage).toBeUndefined();
    expect(mockKv.has(`videoquiz:${PHONE}:active`)).toBe(false);
    expect(texts()).toContain(resolveUx('vqStopped', { language: 'en' }));
    expect(texts().some((t) => t.includes(PARENT_NUDGE))).toBe(false);
    expect(answers()).toEqual([expect.objectContaining({ question_id: 'q-prev' })]);   // nothing new recorded
    const { logEvent } = require('../../bot/shared/utils/structured-logger');
    expect(logEvent).toHaveBeenCalledWith('video_quiz.ended_unfinished', expect.objectContaining({
      sessionId: SESSION, reason: 'stopped', answered: 1,
    }));
  });

  test('"روکیں" on an Urdu quiz stops it, and the child is told in Urdu', async () => {
    reset({ sessions: [shareLinkRow()], videoState: videoState({ language: 'ur' }) });
    await send('روکیں');
    expect(row().status).toBe('incomplete');
    expect(texts()).toContain(resolveUx('vqStopped', { language: 'ur' }));
  });

  test('with no class quiz running, "stop" is not taken by the quiz', async () => {
    reset({ sessions: [shareLinkRow({ status: 'completed' })] });
    await send('stop');
    expect(row().status).toBe('completed');
    expect(texts()).not.toContain(resolveUx('vqStopped', { language: 'en' }));
  });

  test('after a stop, a stale tap on the old question records nothing', async () => {
    reset({ sessions: [shareLinkRow()], videoState: videoState() });
    await send('stop');
    const VideoQuiz = require('../../bot/shared/services/quiz/video-quiz.service');
    let settled = false;
    const p = VideoQuiz.handleAnswer(PHONE, 'vq_q-0_1').finally(() => { settled = true; });
    for (let i = 0; i < 50 && !settled; i += 1) await jest.runAllTimersAsync();   // eslint-disable-line no-await-in-loop
    await p;
    expect(answers()).toEqual([]);
    expect(row().status).toBe('incomplete');
  });

  test('a tap still being graded when STOP arrives counts, and cannot bring the quiz back', async () => {
    reset({ sessions: [shareLinkRow()], videoState: videoState() });
    const VideoQuiz = require('../../bot/shared/services/quiz/video-quiz.service');
    global.__TEST_USER__ = { id: 'u-1', phone_number: PHONE, preferred_language: 'en', registration_completed: true };
    let done = 0;
    // The tap is mid-grade (its verdict sent, the next question not yet) when
    // STOP comes in; neither is awaited before the other starts.
    const tap = VideoQuiz.handleAnswer(PHONE, 'vq_q-0_1').finally(() => { done += 1; });
    const stop = handler.handleTextMessage({ id: 'wamid.in' }, PHONE, 'stop', global.__TEST_USER__)
      .catch(() => {}).finally(() => { done += 1; });
    for (let i = 0; i < 200 && done < 2; i += 1) await jest.runAllTimersAsync();   // eslint-disable-line no-await-in-loop
    await Promise.all([tap, stop]);

    expect(answers()).toEqual([expect.objectContaining({ question_id: 'q-0' })]);
    expect(row()).toEqual(expect.objectContaining({ status: 'incomplete', total_questions_answered: 1 }));
    expect(mockKv.has(`videoquiz:${PHONE}:active`)).toBe(false);
    expect(texts()[texts().length - 1]).toBe(resolveUx('vqStopped', { language: 'en' }));
  });
});
