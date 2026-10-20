'use strict';
/**
 * STOP through the REAL text handler: the reminder-template STOP hook (nudges/reminder-stop.js) is one guarded call
 * placed AFTER the quiz intercepts, so a quiz's own STOP keeps priority, and with the switch
 * (app_settings.lp_quiz_offer_window_template) absent a STOP goes exactly where it went before.
 * Same harness as video-quiz-typed-letter.test.js: only the network (WhatsApp), the stores (supabase, Redis) and
 * services this path never needs are stand-ins.
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
    sendReaction: jest.fn(async (to, id, emoji) => { mockSent.push({ kind: 'reaction', to, payload: { id, emoji } }); return true; }),
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

const { fixturePhone } = require('../../bot/tests/quiz/web-quiz/fixture-phone');

const PHONE = fixturePhone(41);
const SESSION = 'vq-session-1';
const UID = 'a0000000-0000-4000-8000-0000000000b4';
const NAME = 'teacher_quiz_reminder_v1';
const EN = 'You will not get quiz reminders like this again.';
const TEACHER = { id: UID, phone_number: PHONE, preferred_language: 'en', registration_completed: true, role: 'teacher' };

const templateRow = () => ({
  id: 'n-1', user_id: UID, kind: 'lp_quiz_offer', status: 'skipped', nudge_date: '2026-10-19',
  updated_at: new Date(Date.now() - 86400000).toISOString(),
  context: { skip_reason: 'window_closed_template', sent: 1, template: NAME, lang: 'en' },
});
const question = (n) => ({
  id: `q-${n}`, quiz_id: 'quiz-1', external_id: `tq:quiz-1:S1:${n}`, sort_order: n,
  question_text: `Which one is right, ${n}?`, option_a: 'the first', option_b: 'the second', option_c: 'the third',
  option_d: null, correct_option: 'B', explanation: 'because', option_feedback: null, media: {}, render_pattern: 'P1',
});
const shareLinkRow = () => ({
  id: SESSION, quiz_id: 'quiz-1', student_id: 'st-1', parent_phone: PHONE, source: 'share_link',
  status: 'in_progress', created_at: '2026-09-20T10:00:00Z', expires_at: '2099-01-01T00:00:00Z',
  current_difficulty: 3, total_questions_answered: 1, correct_answers: 1,
});
const videoState = () => ({
  sessionId: SESSION, quizId: 'quiz-1', videoId: null, userId: null, language: 'en', source: 'share_link',
  shareCodeId: null, studentId: 'st-1', takerName: 'Child', questionIds: ['q-0', 'q-1'],
  index: 0, correct: 0, answered: 0, currentQuestionId: 'q-0', sentAt: Date.now(),
});

function reset({ on, quiz = false } = {}) {
  mockDb.tables = {
    quiz_sessions: quiz ? [shareLinkRow()] : [], quiz_questions: [question(0), question(1)], quiz_answers: [],
    users: [], training_assessment_attempts: [], teacher_nudges: [templateRow()],
    ...(on ? { app_settings: [{ key: 'lp_quiz_offer_window_template', value: NAME }] } : {}),
  };
  mockDb.inserts = []; mockDb.updates = [];
  mockKv.clear(); mockSent.length = 0;
  if (quiz) mockKv.set(`videoquiz:${PHONE}:active`, JSON.stringify(videoState()));
}

let handler;
function load({ stubHook = false } = {}) {
  jest.resetModules();
  if (stubHook) {
    // "today": a handler whose hook never claims anything.
    jest.doMock('../../bot/shared/services/nudges/reminder-stop', () => ({ handleReminderStop: jest.fn(async () => false) }));
  } else {
    jest.dontMock('../../bot/shared/services/nudges/reminder-stop');
  }
  handler = require('../../bot/shared/handlers/text-message.handler');
}
beforeEach(() => { jest.useFakeTimers(); });
afterEach(() => { jest.useRealTimers(); });

async function send(body, user = TEACHER) {
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
const optOuts = () => mockDb.inserts.filter((i) => i.table === 'teacher_reminder_optouts');
/** What a turn did: every send and every write, minus the switch read the hook makes. */
const trace = () => JSON.parse(JSON.stringify({ sent: mockSent, inserts: mockDb.inserts, updates: mockDb.updates }));

describe('STOP to the quiz reminder template, through the real text handler', () => {
  test('switch on + the template went this week ⇒ opt-out recorded and one confirmation, nothing else', async () => {
    load(); reset({ on: true });
    await send('STOP');
    expect(optOuts()).toEqual([{ table: 'teacher_reminder_optouts', row: expect.objectContaining({ user_id: UID, kind: 'quiz_reminder_template', source: 'stop_reply' }) }]);
    expect(texts()).toEqual([EN]);
  });

  test('switch OFF ⇒ STOP goes exactly where it went before (same sends, same writes as a handler with no hook)', async () => {
    load({ stubHook: true }); reset({ on: false });
    await send('STOP');
    const today = trace();

    load(); reset({ on: false });
    await send('STOP');
    expect(optOuts()).toEqual([]);
    expect(texts()).not.toContain(EN);
    expect(trace()).toEqual(today);
  });

  test('STOP inside a class quiz ⇒ the quiz still wins (switch on, template row present)', async () => {
    load(); reset({ on: true, quiz: true });
    const { resolveUx } = require('../../bot/shared/config/ux-strings');
    await send('stop');
    expect(texts()).toContain(resolveUx('vqStopped', { language: 'en' }));
    expect(texts()).not.toContain(EN);
    expect(optOuts()).toEqual([]);
  });

  test('a non-STOP text ⇒ not taken by the hook (switch on, template row present)', async () => {
    load(); reset({ on: true });
    await send('hello');
    expect(optOuts()).toEqual([]);
    expect(texts()).not.toContain(EN);
  });
});
