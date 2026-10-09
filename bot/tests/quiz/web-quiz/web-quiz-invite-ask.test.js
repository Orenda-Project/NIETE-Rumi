'use strict';
/**
 * app_settings web_quiz_invite_ask: the challenge asked as "who can beat your score?" with three "who" tiles,
 * under the class-group share. off (default, fails closed) | on | split. The quiz payload names the mode only
 * when it is not off; the page then shows the panel (on) or picks its arm from the phone's key (split).
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
const Ask = require('../../../shared/services/quiz/web-quiz-invite-ask');

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
  Ask._reset();
});
afterAll(() => { process.env = SAVED; });


const ASK = (v) => [{ key: 'web_quiz_invite_ask', value: v }];

describe('the invite-ask switch', () => {
  test('absent or off: the quiz payload is today\'s (no invite_ask)', async () => {
    seed();
    expect((await WQ.getQuiz('AB12CD')).invite_ask).toBeUndefined();
    Ask._reset(); seed({ settings: ASK('off') });
    expect((await WQ.getQuiz('AB12CD')).invite_ask).toBeUndefined();
  });
  test('on and split reach the page; any other value is off', async () => {
    seed({ settings: ASK('on') });
    expect((await WQ.getQuiz('AB12CD')).invite_ask).toBe('on');
    Ask._reset(); seed({ settings: ASK('"split"') });
    expect((await WQ.getQuiz('AB12CD')).invite_ask).toBe('split');
    Ask._reset(); seed({ settings: ASK(true) });
    expect((await WQ.getQuiz('AB12CD')).invite_ask).toBe('on');
    Ask._reset(); seed({ settings: ASK('maybe') });
    expect((await WQ.getQuiz('AB12CD')).invite_ask).toBeUndefined();
  });
  test('a failed settings read is off', async () => {
    Object.assign(supabase, { from: () => { throw new Error('db down'); } });
    expect(await Ask.mode()).toBe('off');
  });
  test('the allow-list keeps the arm and the tile, and nothing else', () => {
    expect(WQ.cleanEvent({ n: 'share_click', step: 'tap', src: 'challenge', v: 'a1', who: 'cousin' }).props).toMatchObject({ v: 'a1', who: 'cousin' });
    const bad = WQ.cleanEvent({ n: 'share_click', step: 'tap', v: 'b1', who: 'Ali' }).props;
    expect(bad.v).toBeUndefined();
    expect(bad.who).toBeUndefined();
  });
});
