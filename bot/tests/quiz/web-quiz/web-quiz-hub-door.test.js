'use strict';
/**
 * The results card's door to the child's own hub (web-quiz-hub-door.js): finish() says the card may offer it
 * (hub_door) and POST /hubdoor mints a hub link for THIS session's child, bound to the phone that played.
 * Supabase and Redis are the boundaries and are faked; every first-party module on the path runs for real
 * (the token signer, the hub's device binding, the flags, finish()).
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

function seed({ hub = true, door = true, sess = {} } = {}) {
  const fake = makeFake({
    app_settings: [{ key: 'web_quiz_teachers', value: '"all"' }, { key: 'web_quiz_hub', value: hub }, { key: 'web_quiz_hub_door', value: door }],
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
const err = async (p) => { try { await p; } catch (e) { return { status: e.status, ...(e.body || {}) }; } return null; };

const SAVED = { ...process.env };
beforeEach(() => {
  process.env = { ...SAVED, INTERNAL_API_KEY: 'test-key', WEB_QUIZ_TOKEN_SECRET: 'door-test-secret' };
  jest.clearAllMocks();
  redis._store.clear();
  Flags._resetCache();
});
afterAll(() => { process.env = SAVED; });

describe('finish(): the card is told it may offer the door', () => {
  test('a class child\'s own run, hub and door on: hub_door', async () => {
    seed();
    expect((await WQ.finishSession({ st: st() })).hub_door).toBe(true);
  });
  test('door off, or hub off: the payload is today\'s', async () => {
    seed({ door: false });
    expect((await WQ.finishSession({ st: st() })).hub_door).toBeUndefined();
    Flags._resetCache(); seed({ hub: false });
    expect((await WQ.finishSession({ st: st() })).hub_door).toBeUndefined();
  });
  test('an invited friend\'s run, or the teacher\'s own test run: no door', async () => {
    seed({ sess: { invited_by_student_id: FRIEND } });
    expect((await WQ.finishSession({ st: st() })).hub_door).toBeUndefined();
    Flags._resetCache(); seed({ sess: { user_id: TEACHER, student_id: null } });
    expect((await WQ.finishSession({ st: st() })).hub_door).toBeUndefined();
  });
});

describe('POST /hubdoor', () => {
  test('mints a hub link for this session\'s child only, bound to the phone that played', async () => {
    seed({ sess: { status: 'completed' } });
    const out = await Door.door({ st: st(), device_ref: D2 });
    expect(out.href).toMatch(/^\/h\/[A-Za-z0-9._-]+$/);
    const token = out.href.slice(3);
    expect(T.verify(token, 'h').ids).toEqual([KID]);
    // the session's phone owns the link; the body's device_ref is ignored, and a forwarded copy names nobody
    expect(await Device.deviceTrusted(token, D1)).toMatchObject({ ok: true, why: 'bound', ids: [KID] });
    expect((await Device.deviceTrusted(token, D2)).ok).toBe(false);
  });
  test('a bad or foreign session token: 401', async () => {
    seed({ sess: { status: 'completed' } });
    expect(await err(Door.door({ st: 'nope' }))).toMatchObject({ status: 401, error: 'bad_token' });
    expect(await err(Door.door({ st: st({ shareCodeId: 'other' }) }))).toMatchObject({ status: 401, error: 'bad_token' });
  });
  test('door off, an unfinished run, an invited friend\'s run: 404 no_door, nothing bound', async () => {
    seed({ door: false, sess: { status: 'completed' } });
    expect(await err(Door.door({ st: st() }))).toMatchObject({ status: 404, error: 'no_door' });
    Flags._resetCache(); seed();
    expect(await err(Door.door({ st: st() }))).toMatchObject({ status: 404, error: 'no_door' });
    Flags._resetCache(); seed({ sess: { status: 'completed', invited_by_student_id: FRIEND } });
    expect(await err(Door.door({ st: st() }))).toMatchObject({ status: 404, error: 'no_door' });
    expect(redis.setNX).not.toHaveBeenCalled();
  });
});
