'use strict';
/**
 * Where a /finish spends its time: finishSession() logs ONE web_quiz.finish_timing line per call with each
 * step's duration (steps_ms) and the total, whether it answers or throws. Labels and numbers only, never an id.
 * Supabase and Redis are the boundaries and are faked; finishSession() and everything first-party it calls runs.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/services/queue/sqs-queue.service', () => ({ queueJob: jest.fn().mockResolvedValue({ MessageId: 'm1' }) }));
// Redis is a boundary: an in-memory SET NX / GET, so the hub's first-device binding runs for real.
jest.mock('../../../shared/services/cache/railway-redis.service', () => {
  const store = new Map();
  return {
    _store: store,
    isAvailable: () => true,
    get: jest.fn(async (k) => (store.has(k) ? store.get(k) : null)),
    set: jest.fn(async (k, v) => { store.set(k, v); return true; }),
    delete: jest.fn(async (k) => store.delete(k)),
    setNX: jest.fn(async (k, v) => { if (store.has(k)) return false; store.set(k, v); return true; }),
  };
});
jest.mock('../../../shared/services/whatsapp.service', () => ({ sendMessage: jest.fn() }));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('openchemlib', () => require('../../../../tests/__mocks__/openchemlib.js'));

const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const redis = require('../../../shared/services/cache/railway-redis.service');
const T = require('../../../shared/services/quiz/web-quiz-token');
const WQ = require('../../../shared/services/quiz/web-quiz.service');
const Flags = require('../../../shared/services/quiz/web-quiz-hub-flags');
const Device = require('../../../shared/services/quiz/web-quiz-hub-device');
const Door = require('../../../shared/services/quiz/web-quiz-hub-door');

const TEACHER = '11111111-1111-4111-8111-111111111111';
const QUIZ = '22222222-2222-4222-8222-222222222222';
const SC = '33333333-3333-4333-8333-333333333333';
const KID = '44444444-4444-4444-8444-444444444444';
const FRIEND = '44444444-4444-4444-8444-555555555555';
const Q = (n) => `cccccc${String(n).padStart(2, '0')}-cccc-4ccc-8ccc-cccccccccccc`;
const D1 = 'AAAAAAAAAAAAAAAAAAAAAA';
const D2 = 'BBBBBBBBBBBBBBBBBBBBBB';
const future = new Date(Date.now() + 86400000 * 10).toISOString();
const ago = (h) => new Date(Date.now() - h * 3600000).toISOString();

function seed({ hub = true, door = true, sess = {}, settings = [] } = {}) {
  const fake = makeFake({
    app_settings: [{ key: 'web_quiz_teachers', value: '"all"' }, { key: 'web_quiz_hub', value: hub }, { key: 'web_quiz_hub_door', value: door }, ...settings],
    quizzes: [{ id: QUIZ, topic: 'Fractions', grade: '3', subject: 'maths', quiz_source: 'transcript', video_id: null }],
    quiz_share_codes: [{ id: SC, code: 'AB12CD', quiz_id: QUIZ, video_id: null, teacher_user_id: TEACHER, language: 'en', active: true,
      expires_at: future, invited_by_student_id: null, parent_share_code_id: null, created_at: ago(30) }],
    quiz_questions: [1, 2].map((n) => ({ id: Q(n), quiz_id: QUIZ, external_id: `q${n}`, sort_order: n, question_text: `Q${n}`,
      option_a: 'A', option_b: 'B', option_c: null, option_d: null, correct_option: 'A', explanation: null, option_feedback: null, media: {}, render_pattern: null })),
    quiz_sessions: [{ id: 's1', quiz_id: QUIZ, share_code_id: SC, student_id: KID, status: 'in_progress', user_id: null,
      invited_by_student_id: null, created_at: ago(0.1), device_ref: D1, ...sess }],
    quiz_answers: [1, 2].map((n) => ({ session_id: 's1', question_id: Q(n), selected_option: 'A', is_correct: true })),
    students: [{ id: KID, student_name: 'Zara Khan' }, { id: FRIEND, student_name: 'Omar Ali' }],
  });
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
}
const st = (over = {}) => T.signSession({ sessionId: 's1', deviceRef: D1, shareCodeId: SC, ...over });
const err = async (p) => { try { await p; } catch (e) { expect(e).toBeInstanceOf(WQ.WqError); return { status: e.status, ...(e.body || {}) }; } return null; };

const SAVED = { ...process.env };
beforeEach(() => {
  process.env = { ...SAVED, INTERNAL_API_KEY: 'test-key', WEB_QUIZ_TOKEN_SECRET: 'door-test-secret' };
  jest.clearAllMocks();
  redis._store.clear();
  Flags._resetCache();
});
afterAll(() => { process.env = SAVED; });


const STEPS = ['session', 'questions', 'answers', 'complete', 'prior', 'names', 'challenge', 'class_code',
  'best', 'place', 'versus', 'next_lesson', 'hub_door', 'rest'];
const { logEvent } = require('../../../shared/utils/structured-logger');
const timingLines = () => logEvent.mock.calls.filter(([ev]) => ev === 'web_quiz.finish_timing').map(([, p]) => p);

describe('finish(): one web_quiz.finish_timing line per call', () => {
  test('a class child\'s first finish: every step is timed, the total covers them, no ids on the line', async () => {
    seed();
    await WQ.finishSession({ st: st() });
    const lines = timingLines();
    expect(lines).toHaveLength(1);
    const [l] = lines;
    expect(l.ok).toBe(true);
    expect(Object.keys(l.steps_ms).sort()).toEqual([...STEPS].sort());
    Object.values(l.steps_ms).forEach((ms) => expect(ms).toBeGreaterThanOrEqual(0));
    expect(l.total_ms).toBeGreaterThanOrEqual(Object.values(l.steps_ms).reduce((a, b) => a + b, 0) - 1);
    expect(Object.keys(l).sort()).toEqual(['completed_now', 'ok', 'steps_ms', 'total_ms']);
    expect(l.completed_now).toBe(true);
  });

  test('a repeat finish of a completed session says so (completed_now false)', async () => {
    seed({ sess: { status: 'completed', completed_at: ago(0.05) } });
    await WQ.finishSession({ st: st() });
    expect(timingLines()).toEqual([expect.objectContaining({ ok: true, completed_now: false })]);
  });

  test('an invited friend\'s run (the versus step) is timed the same way', async () => {
    seed({ sess: { invited_by_student_id: FRIEND } });
    await WQ.finishSession({ st: st() });
    const [l] = timingLines();
    expect(Object.keys(l.steps_ms).sort()).toEqual([...STEPS].sort());
  });

  test('a finish that throws still logs its line, with the status', async () => {
    seed();
    const e = await err(WQ.finishSession({ st: 'not-a-token' }));
    expect(e.status).toBe(401);
    expect(timingLines()).toEqual([expect.objectContaining({ ok: false, status: 401 })]);
  });
});
