'use strict';
/**
 * The three page-side doors to a child's home — an old class link opened again (web-quiz-link-home.js), the results
 * card's door (web-quiz-hub-door.js) and the result card's next thing (web-quiz-next-offer-result.js) — carry the
 * child's own language in the hub link (app_settings web_quiz_return_lang): childLang() = the newest class quiz's
 * language, else the language the child joined in. A library lesson code speaks its lesson's language, not the
 * child's. Switch off: every link is byte-identical to today's (signed at the same second) and the card's language is
 * today's. Supabase and Redis are the boundaries and are faked; every first-party module on the path runs for real.
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
const Ret = require('../../../shared/services/quiz/web-quiz-return-lang');
const Door = require('../../../shared/services/quiz/web-quiz-hub-door');
const LinkHome = require('../../../shared/services/quiz/web-quiz-link-home');
const Result = require('../../../shared/services/quiz/web-quiz-next-offer-result');

const TEACHER = '11111111-1111-4111-8111-111111111111';
const QUIZ = '22222222-2222-4222-8222-222222222222';
const ROOT = '33333333-3333-4333-8333-333333333300';
const SC = '33333333-3333-4333-8333-333333333333';
const KID = '44444444-4444-4444-8444-444444444471';
const Q = (n) => `cccccc${String(n).padStart(2, '0')}-cccc-4ccc-8ccc-cccccccccccc`;
const D1 = 'AAAAAAAAAAAAAAAAAAAAAA';
const NOW_MS = Date.UTC(2026, 9, 17, 2, 0, 0);
const at = (h) => new Date(NOW_MS + h * 3600000).toISOString();

/**
 * One finished run of code AB12CD on phone D1 by a child with no class. `lesson`: AB12CD is a library lesson code (a
 * parent code), else the teacher's class quiz. `quizLang`: the quiz's language. `joined`: the language kept for the
 * child by the join (child_language), or none.
 */
function seed({ ret = true, lesson = false, quizLang = 'en', joined = 'ur', canon = false } = {}) {
  const settings = [{ key: 'web_quiz_teachers', value: '"all"' }, { key: 'web_quiz_hub', value: true }, { key: 'web_quiz_hub_door', value: true },
    { key: 'web_quiz_link_home', value: true }];
  if (ret !== 'absent') settings.push({ key: 'web_quiz_return_lang', value: ret });
  if (canon) settings.push({ key: 'web_quiz_identity_canon', value: true });
  const fake = makeFake({
    app_settings: settings,
    quizzes: [{ id: QUIZ, topic: 'Fractions', grade: '2', subject: 'maths', quiz_source: 'transcript', video_id: null, meta: {}, language: quizLang }],
    quiz_share_codes: [{ id: SC, code: 'AB12CD', quiz_id: QUIZ, video_id: null, teacher_user_id: TEACHER, language: quizLang, active: true,
      expires_at: new Date(new Date().getTime() + 240 * 3600000).toISOString(), invited_by_student_id: null, parent_share_code_id: lesson ? ROOT : null, created_at: at(-30) }],
    quiz_questions: [1, 2].map((n) => ({ id: Q(n), quiz_id: QUIZ, external_id: `q${n}`, sort_order: n, question_text: `Q${n}`,
      option_a: 'A', option_b: 'B', option_c: null, option_d: null, correct_option: 'A', explanation: null, option_feedback: null, media: {}, render_pattern: null })),
    quiz_sessions: [{ id: 's1', quiz_id: QUIZ, share_code_id: SC, student_id: KID, status: 'completed', user_id: null, invited_by_student_id: null,
      created_at: at(-1), completed_at: at(-0.9), correct_answers: 2, total_questions_answered: 2, mastery_percentage: 100, device_ref: D1 }],
    quiz_answers: [1, 2].map((n) => ({ session_id: 's1', question_id: Q(n), selected_option: 'A', is_correct: true })),
    students: [{ id: KID, student_name: 'Zara Testwala', student_name_urdu: null, self_reported_class: 'Grade 2', list_id: null, is_active: true, created_at: at(-48) }],
    student_lists: [],
    child_language: joined ? [{ canonical_id: KID, language: joined, source: 'join' }] : [],
  });
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
  Flags._resetCache();
  LinkHome._resetCache();
  Ret._resetCache();
  try { require('../../../shared/services/quiz/web-quiz-hub')._resetCache(); } catch (_) { /* none */ }
  try { require('../../../shared/services/quiz/web-quiz-next-offer')._resetCache(); } catch (_) { /* none */ }
  require('../../../shared/services/quiz/web-quiz-identity-flags')._resetCache();
  redis._store.clear();
  return fake;
}
const st = () => T.signSession({ sessionId: 's1', deviceRef: D1, shareCodeId: SC });
const resolve = (c) => WQ.resolveCode(c);
const tokOf = (href) => T.verify(href.replace(/^\/h\//, '').split('?')[0], 'h');
const doorHref = async () => (await Door.door({ st: st() }, WQ.WqError)).href;
const linkHomeHref = async () => (await LinkHome.home({ code: 'AB12CD', device_ref: D1 }, resolve)).home;
const snap = () => Result._snapshot({ studentId: KID, device: D1 });

const SAVED = { ...process.env };
beforeEach(() => {
  process.env = { ...SAVED, INTERNAL_API_KEY: 'test-key', WEB_QUIZ_TOKEN_SECRET: 'page-links-test-secret', PORTAL_URL: 'https://portal.example.test' };
  jest.clearAllMocks();
  jest.spyOn(Date, 'now').mockReturnValue(NOW_MS);
});
afterEach(() => { jest.restoreAllMocks(); });
afterAll(() => { process.env = SAVED; });

describe('switch on: a self-joined Urdu child whose only play was an English library lesson', () => {
  test('the results card\'s door opens "ur"', async () => {
    seed({ lesson: true });
    expect(tokOf(await doorHref())).toMatchObject({ k: 'h', ids: [KID], l: 'ur' });
  });
  test('the old link opened again opens "ur"', async () => {
    seed({ lesson: true });
    expect(tokOf(await linkHomeHref())).toMatchObject({ k: 'h', ids: [KID], l: 'ur' });
  });
  test('the result card\'s snapshot: its link carries "ur" and the card speaks "ur"', async () => {
    seed({ lesson: true });
    const s = await snap();
    expect(T.verify(s.token, 'h')).toMatchObject({ k: 'h', ids: [KID], l: 'ur' });
    expect(s.lang).toBe('ur');
  });
});

describe('switch on: a child with a class quiz keeps that quiz\'s language', () => {
  test.each([['an English class quiz, joined in Urdu', 'en', 'ur', 'en'], ['an Urdu class quiz, never joined', 'ur', null, 'ur']])('%s → door, old link and card all "%s"', async (_l, quizLang, joined, want) => {
    seed({ quizLang, joined });
    expect(tokOf(await doorHref()).l).toBe(want);
    seed({ quizLang, joined });
    expect(tokOf(await linkHomeHref()).l).toBe(want);
    seed({ quizLang, joined });
    const s = await snap();
    expect(T.verify(s.token, 'h').l).toBe(want);
    expect(s.lang).toBe(want);
  });
});

describe('switch off: today\'s links, byte for byte, and today\'s card language', () => {
  test.each([['absent', 'absent'], ['false', false], ['the string "true"', 'true'], ['the JSON string "\\"true\\""', '"true"']])('switch row %s', async (_l, ret) => {
    seed({ ret, lesson: true });
    expect(await doorHref()).toBe(`/h/${T.signHub([KID])}`);
    seed({ ret, lesson: true });
    expect(await linkHomeHref()).toBe(`/h/${T.signHub([KID])}?from=link`);
    seed({ ret, lesson: true });
    const s = await snap();
    expect(s.token).toBe(T.signHub([KID]));
    expect(s.lang).toBe('en');
  });
});

// A child whose run was played under a record later merged into the child (web_quiz_identity_canon): the kept choice
// lives under the id the child is known by, and every door reads it there.
describe('switch on: a merged child\'s kept choice', () => {
  const RAW = '44444444-4444-4444-8444-444444444499';
  const merged = (opts = {}) => {
    const fake = seed({ quizLang: 'en', joined: null, canon: true, ...opts });
    fake.db.students.push({ id: RAW, student_name: 'Zara Testwala', student_name_urdu: null, self_reported_class: 'Grade 2', list_id: null, is_active: true, status: 'merged', merged_into: KID, created_at: at(-72) });
    fake.db.quiz_sessions[0].student_id = RAW;
    fake.db.child_language.push({ canonical_id: KID, language: 'ur', source: 'chosen' });
    return fake;
  };
  test('the old link opened again carries the chosen "ur" (read by the id the child is known by)', async () => {
    merged();
    expect(tokOf(await linkHomeHref())).toMatchObject({ k: 'h', l: 'ur' });
  });
  test('the results card\'s door: the same "ur"', async () => {
    merged();
    expect(tokOf(await doorHref())).toMatchObject({ k: 'h', ids: [KID], l: 'ur' });
  });
  test('switch off: the old link is today\'s, byte for byte', async () => {
    merged({ ret: false });
    expect(await linkHomeHref()).toBe(`/h/${T.signHub([RAW])}?from=link`);
  });
});
