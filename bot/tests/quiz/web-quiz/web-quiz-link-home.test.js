'use strict';
/**
 * An old, finished class link opens the child's own hub (web-quiz-link-home.js, app_settings web_quiz_link_home,
 * only with web_quiz_hub on). Supabase and Redis are the boundaries and are faked; every first-party module on the
 * path runs for real (the token signer, the hub's device binding, the flags, getQuiz()).
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/services/queue/sqs-queue.service', () => ({ queueJob: jest.fn().mockResolvedValue({ MessageId: 'm1' }) }));
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
jest.mock('../../../shared/services/quiz/web-quiz-publish.service', () => ({
  isCurrent: () => true, requestQuizAudio: jest.fn().mockResolvedValue(null), quizLanguage: () => 'en',
}));

const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const redis = require('../../../shared/services/cache/railway-redis.service');
const { logEvent } = require('../../../shared/utils/structured-logger');
const T = require('../../../shared/services/quiz/web-quiz-token');
const WQ = require('../../../shared/services/quiz/web-quiz.service');
const Flags = require('../../../shared/services/quiz/web-quiz-hub-flags');
const Device = require('../../../shared/services/quiz/web-quiz-hub-device');

const TEACHER = '11111111-1111-4111-8111-111111111111';
const QUIZ = '22222222-2222-4222-8222-222222222222';
const SC = '33333333-3333-4333-8333-333333333333';
const CH = '33333333-3333-4333-8333-444444444444';
const KID = '44444444-4444-4444-8444-444444444444';
const SIB = '44444444-4444-4444-8444-555555555555';
const Q = (n) => `cccccc${String(n).padStart(2, '0')}-cccc-4ccc-8ccc-cccccccccccc`;
const D1 = 'AAAAAAAAAAAAAAAAAAAAAA';
const D2 = 'BBBBBBBBBBBBBBBBBBBBBB';
const future = new Date(Date.now() + 86400000 * 10).toISOString();
const ago = (h) => new Date(Date.now() - h * 3600000).toISOString();
const run = (over = {}) => ({ id: 's1', quiz_id: QUIZ, share_code_id: SC, student_id: KID, status: 'completed', user_id: null,
  invited_by_student_id: null, created_at: ago(30), device_ref: D1, ...over });

function seed({ hub = true, linkHome = true, sessions = [run()] } = {}) {
  const settings = [{ key: 'web_quiz_teachers', value: '"all"' }];
  settings.push({ key: 'web_quiz_hub', value: hub });
  if (linkHome !== 'absent') settings.push({ key: 'web_quiz_link_home', value: linkHome });
  const fake = makeFake({
    app_settings: settings,
    quizzes: [{ id: QUIZ, topic: 'Fractions', grade: '3', subject: 'maths', quiz_source: 'transcript', video_id: null, meta: {} }],
    quiz_share_codes: [
      { id: SC, code: 'AB12CD', quiz_id: QUIZ, video_id: null, teacher_user_id: TEACHER, language: 'en', active: true,
        expires_at: future, invited_by_student_id: null, parent_share_code_id: null, created_at: ago(48), teacher_name: 'Ms Testwala' },
      { id: CH, code: 'CH12AB', quiz_id: QUIZ, video_id: null, teacher_user_id: TEACHER, language: 'en', active: true,
        expires_at: future, invited_by_student_id: KID, parent_share_code_id: SC, created_at: ago(24) },
    ],
    quiz_questions: [1, 2].map((n) => ({ id: Q(n), quiz_id: QUIZ, external_id: `q${n}`, sort_order: n, question_text: `Q${n}`,
      option_a: 'A', option_b: 'B', option_c: null, option_d: null, correct_option: 'A', explanation: null, option_feedback: null, media: {}, render_pattern: null })),
    quiz_sessions: sessions,
    quiz_answers: [],
    students: [{ id: KID, student_name: 'Zara Testwala' }, { id: SIB, student_name: 'Omar Testwala' }],
  });
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
}
const LH = () => require('../../../shared/services/quiz/web-quiz-link-home');
const reset = () => { Flags._resetCache(); try { LH()._resetCache(); } catch (_) { /* absent on the base */ } };

const SAVED = { ...process.env };
beforeEach(() => {
  process.env = { ...SAVED, INTERNAL_API_KEY: 'test-key', WEB_QUIZ_TOKEN_SECRET: 'link-home-test-secret' };
  jest.clearAllMocks();
  redis._store.clear();
  reset();
});
afterAll(() => { process.env = SAVED; });

describe('the teacher\'s quiz link, opened again on the phone that finished it', () => {
  test('one remembered child, run finished, switch on: that child\'s hub, bound to this phone; door_shown written by the server', async () => {
    seed();
    const out = await LH().home({ code: 'AB12CD', device_ref: D1 });
    expect(out.home).toMatch(/^\/h\/[A-Za-z0-9._-]+\?from=link$/);
    const token = out.home.slice(3, out.home.indexOf('?'));
    expect(T.verify(token, 'h').ids).toEqual([KID]);                 // that child only, never a sibling
    expect(await Device.deviceTrusted(token, D1)).toMatchObject({ ok: true, why: 'bound', ids: [KID] });
    expect((await Device.deviceTrusted(token, D2)).ok).toBe(false);  // a copy of the hub link on another phone names nobody
    expect(logEvent).toHaveBeenCalledWith('web_quiz.door_shown', { door: 'link_home', surface: 'hub', w: 's' });
  });

  test('the run is not finished (or a new attempt is under way): no home, the quiz goes on as today', async () => {
    seed({ sessions: [run({ status: 'in_progress' })] });
    expect((await LH().home({ code: 'AB12CD', device_ref: D1 })).home).toBeNull();
    reset(); seed({ sessions: [run(), run({ id: 's2', status: 'in_progress', created_at: ago(1) })] });
    expect((await LH().home({ code: 'AB12CD', device_ref: D1 })).home).toBeNull();
  });

  test('two remembered children played this code on the phone: no home (the landing asks "Whose turn?")', async () => {
    seed({ sessions: [run(), run({ id: 's2', student_id: SIB })] });
    expect((await LH().home({ code: 'AB12CD', device_ref: D1 })).home).toBeNull();
  });

  test('an unknown phone, a forwarded copy on another phone, or no device: no home', async () => {
    seed();
    expect((await LH().home({ code: 'AB12CD', device_ref: D2 })).home).toBeNull();
    expect((await LH().home({ code: 'AB12CD' })).home).toBeNull();
    expect(redis.setNX).not.toHaveBeenCalled();
    expect(logEvent).not.toHaveBeenCalledWith('web_quiz.door_shown', expect.anything());
  });

  test('a teacher\'s phone (a test run on it) or a friend\'s challenge code: no home', async () => {
    seed({ sessions: [run(), run({ id: 's2', student_id: null, user_id: TEACHER })] });
    expect((await LH().home({ code: 'AB12CD', device_ref: D1 })).home).toBeNull();
    reset(); seed({ sessions: [run({ share_code_id: SC })] });
    expect((await LH().home({ code: 'CH12AB', device_ref: D1 })).home).toBeNull();
  });

  test('switch off, or the hub off, or the setting unreadable: no home, nothing bound', async () => {
    seed({ linkHome: false });
    expect((await LH().home({ code: 'AB12CD', device_ref: D1 })).home).toBeNull();
    reset(); seed({ hub: false });
    expect((await LH().home({ code: 'AB12CD', device_ref: D1 })).home).toBeNull();
    reset(); Object.assign(supabase, { from: () => { throw new Error('down'); } });
    expect((await LH().home({ code: 'AB12CD', device_ref: D1 })).home).toBeNull();
    expect(redis.setNX).not.toHaveBeenCalled();
  });
});

describe('the quiz payload (getQuiz)', () => {
  test('switch on: link_home tells the page to ask; never on a friend\'s challenge code', async () => {
    seed();
    expect((await WQ.getQuiz('AB12CD')).link_home).toBe(true);
    expect((await WQ.getQuiz('CH12AB')).link_home).toBeUndefined();
  });

  test('golden: with the switch off the payload is deep-equal to the payload with no such setting (today\'s)', async () => {
    seed({ linkHome: 'absent' });
    const base = await WQ.getQuiz('AB12CD');
    expect(base.link_home).toBeUndefined();
    for (const variant of [{ linkHome: false }, { linkHome: true, hub: false }]) {
      reset(); seed(variant);
      expect(await WQ.getQuiz('AB12CD')).toEqual(base);
    }
  });
});
