'use strict';
/**
 * The quiz answer names app_settings web_quiz_video_clean_start (`video_clean: true`, JSON true only) so the lesson
 * video page (wq.js) shows one play button at 0:00 and the player's own controls only once it plays. It rides the hub's
 * one batched switch read the page's `nav` already makes: ON adds no settings read. Off: the answer is today's, key for
 * key. Invented children only.
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
const T = require('../../../shared/services/quiz/web-quiz-token');
const WQ = require('../../../shared/services/quiz/web-quiz.service');
const Flags = require('../../../shared/services/quiz/web-quiz-hub-flags');
const R = require('../../../shared/services/quiz/web-quiz-return-lang');

const TEACHER = '11111111-1111-4111-8111-111111111191';
const QUIZ = '22222222-2222-4222-8222-222222222291';
const SC = '33333333-3333-4333-8333-333333333391';
const OLD = '33333333-3333-4333-8333-333333333392';
const KID = '44444444-4444-4444-8444-444444444491';
const SIB = '44444444-4444-4444-8444-444444444492';
const Q = (n) => `cccccc${String(n).padStart(2, '0')}-cccc-4ccc-8ccc-cccccccccc91`;
const future = new Date(Date.now() + 86400000 * 10).toISOString();
const ago = (h) => new Date(Date.now() - h * 3600000).toISOString();
const KEY = 'web_quiz_return_lang';

let fake;
function seed({ sw = true, langs = [] } = {}) {
  const settings = [{ key: 'web_quiz_teachers', value: '"all"' }];
  if (sw !== 'absent') settings.push({ key: KEY, value: sw });
  fake = makeFake({
    app_settings: settings,
    quizzes: [{ id: QUIZ, topic: 'Fractions', grade: '3', subject: 'maths', language: 'en', quiz_source: 'transcript', video_id: null, meta: {} }],
    quiz_share_codes: [
      { id: SC, code: 'AB12CD', quiz_id: QUIZ, video_id: null, teacher_user_id: TEACHER, language: 'en', active: true,
        expires_at: future, invited_by_student_id: null, parent_share_code_id: null, created_at: ago(48), teacher_name: 'Ms Testwala' },
      { id: OLD, code: 'OLD123', quiz_id: QUIZ, video_id: null, teacher_user_id: TEACHER, language: 'en', active: true,
        expires_at: future, invited_by_student_id: null, parent_share_code_id: null, created_at: ago(200), teacher_name: 'Ms Testwala' },
    ],
    quiz_questions: [1, 2].map((n) => ({ id: Q(n), quiz_id: QUIZ, external_id: `q${n}`, sort_order: n, question_text: `Q${n}`,
      option_a: 'A', option_b: 'B', option_c: null, option_d: null, correct_option: 'A', explanation: null, option_feedback: null, media: {}, render_pattern: null })),
    quiz_sessions: [
      { id: 's1', quiz_id: QUIZ, share_code_id: SC, student_id: KID, student_name: 'Zara Testwala', status: 'completed', user_id: null, invited_by_student_id: null, created_at: ago(30) },
      { id: 's2', quiz_id: QUIZ, share_code_id: OLD, student_id: SIB, student_name: 'Omar Testwala', status: 'completed', user_id: null, invited_by_student_id: null, created_at: ago(150) },
    ],
    quiz_answers: [],
    students: [{ id: KID, student_name: 'Zara Testwala' }, { id: SIB, student_name: 'Omar Testwala' }],
    child_language: langs,
  });
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
}
const chip = (id, sc = SC) => T.chipId(sc, id);
const reads = (t) => fake.calls.filter((c) => c.table === t && c.op === 'select').length;
const QL = () => require('../../../shared/services/quiz/web-quiz-quiz-lang');

const SAVED = { ...process.env };
beforeEach(() => {
  process.env = { ...SAVED, INTERNAL_API_KEY: 'test-key', WEB_QUIZ_TOKEN_SECRET: 'quiz-lang-test-secret' };
  jest.clearAllMocks();
  jest.restoreAllMocks();
  redis._store.clear();
  Flags._resetCache();
  R._resetCache();
});
afterAll(() => { process.env = SAVED; });

const KEY_VC = 'web_quiz_video_clean_start';
const stable = (o) => JSON.parse(JSON.stringify(o));

describe('getQuiz: video_clean', () => {
  const answer = async (value) => {
    seed();
    if (value !== undefined) fake.db.app_settings.push({ key: KEY_VC, value });
    Flags._resetCache();
    const before = reads('app_settings');
    const out = stable(await WQ.getQuiz('AB12CD'));
    return { out, reads: reads('app_settings') - before };
  };
  test('on (JSON true): `video_clean: true`, otherwise the switch-off answer key for key, with the same settings reads', async () => {
    await answer(undefined); // the page's other caches warm, as in a running bot
    const off = await answer(undefined);
    const on = await answer(true);
    expect(off.out).not.toHaveProperty('video_clean');
    expect(on.out.video_clean).toBe(true);
    delete on.out.video_clean;
    expect(on.out).toEqual(off.out);
    expect(on.reads).toBe(off.reads);
  });
  test('off (false, the string "true", an object): no key', async () => {
    for (const value of [false, 'true', { enabled: true }]) expect([value, 'video_clean' in (await answer(value)).out]).toEqual([value, false]);
  });
});
