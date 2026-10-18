'use strict';
/**
 * One child, one hub open, one language (app_settings web_quiz_return_lang, JSON true only): the page, the teacher's
 * "new from your teacher" pick (the twin in the page's language when the teacher sent the lesson in both), the video
 * library's link and the library's own reading of the child all speak the language of the one order (a grown-up's
 * choice → ?lang= → class quiz → the link's `l` → the join's → a library lesson's → English). Switch off: each reader
 * is today's (the teacher pick and the library follow the child's newest quiz). Supabase and Redis are the boundaries
 * and are faked; every first-party module on the path runs for real.
 */
// the chips are keyed by the token secret: set before any chip is made
process.env.WEB_QUIZ_TOKEN_SECRET = 'hub-test-secret';
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/services/cache/railway-redis.service', () => {
  const store = new Map();
  return {
    _store: store,
    isAvailable() { return true; },
    get: jest.fn(async (k) => (store.has(k) ? store.get(k) : null)),
    set: jest.fn().mockResolvedValue(true), delete: jest.fn().mockResolvedValue(true),
    setNX: jest.fn(async (k, v) => { if (store.has(k)) return false; store.set(k, v); return true; }),
  };
});
jest.mock('../../../shared/services/whatsapp.service', () => ({ sendMessage: jest.fn().mockResolvedValue(true), sendCtaUrl: jest.fn().mockResolvedValue(true) }));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));

const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const T = require('../../../shared/services/quiz/web-quiz-token');
const Hub = require('../../../shared/services/quiz/web-quiz-hub');
const Play = require('../../../shared/services/quiz/web-quiz-hub-play');
const Ret = require('../../../shared/services/quiz/web-quiz-return-lang');
const IdFlags = require('../../../shared/services/quiz/web-quiz-identity-flags');
const redis = require('../../../shared/services/cache/railway-redis.service');
const { fixturePhone } = require('./fixture-phone');

const PHONE = fixturePhone(742);
const KID = '44444444-4444-4444-8444-0000000000d1';
const TEACHER = '11111111-1111-4111-8111-0000000000d1';
const LIST = '55555555-5555-4555-8555-0000000000d1';
const CLASS = '66666666-6666-4666-8666-0000000000d1';
const NOW = Date.now();
const ago = (h) => new Date(NOW - h * 3600000).toISOString();
const ahead = (h) => new Date(NOW + h * 3600000).toISOString();
const A = { device: 'AAAAAAAAAAAAAAAAAAAAAA' };
const B = { device: 'BBBBBBBBBBBBBBBBBBBBBB' };
const BASE = [{ key: 'web_quiz_hub', value: true }, { key: 'web_quiz_library', value: true }];
const ON = [...BASE, { key: 'web_quiz_return_lang', value: true }];
const OFFS = [['absent', BASE], ['false', [...BASE, { key: 'web_quiz_return_lang', value: false }]], ['the string "true"', [...BASE, { key: 'web_quiz_return_lang', value: 'true' }]],
  ['the JSON string "\\"true\\""', [...BASE, { key: 'web_quiz_return_lang', value: '"true"' }]]];
const CHIP = Hub._parts.kidChip(KID);

let db;
let fake;
/**
 * A child in the teacher's class who has NOT opened the teacher's new lesson, sent in both languages (twins); `quizLang`:
 * one finished quiz (a class quiz, or a library lesson with `lesson`); `kept`: the child's child_language row.
 */
function seed(settings, { quizLang = null, lesson = false, kept = null, canon = false } = {}) {
  db = {
    app_settings: canon ? [...settings, { key: 'web_quiz_identity_canon', value: true }] : settings,
    students: [{ id: KID, student_name: 'Zara Testwala', student_name_urdu: 'زارا', self_reported_class: '2', list_id: LIST, is_active: true, status: 'active', phone: PHONE, created_at: ago(1) }],
    student_lists: [{ id: LIST, user_id: TEACHER, class_name: '2', section: 'A', is_active: true, class_id: null }],
    class_enrollments: [{ student_id: KID, class_id: CLASS, is_active: true }],
    quizzes: [
      { id: 'q-en', topic: 'Plants', subject: 'Science', language: 'en', grade: '2', video_id: null, lesson_plan_id: 'lp-1', coaching_session_id: null },
      { id: 'q-ur', topic: 'پودے', subject: 'Science', language: 'ur', grade: '2', video_id: null, lesson_plan_id: 'lp-1', coaching_session_id: null },
    ],
    quiz_share_codes: [
      { id: 'sc-en', code: 'PLNT0E', quiz_id: 'q-en', active: true, expires_at: ahead(240), topic: 'Plants', language: 'en', teacher_user_id: TEACHER, class_id: CLASS, parent_share_code_id: null, invited_by_student_id: null, created_at: ago(3) },
      { id: 'sc-ur', code: 'PLNT0U', quiz_id: 'q-ur', active: true, expires_at: ahead(240), topic: 'پودے', language: 'ur', teacher_user_id: TEACHER, class_id: CLASS, parent_share_code_id: null, invited_by_student_id: null, created_at: ago(2) },
    ],
    quiz_sessions: [],
    child_language: kept ? [{ canonical_id: KID, ...kept }] : [],
  };
  if (quizLang) {
    db.quizzes.push({ id: 'q-1', topic: 'Shapes', subject: 'Maths', language: quizLang, grade: '2', video_id: null, lesson_plan_id: null, coaching_session_id: null });
    db.quiz_share_codes.push({ id: 'sc-1', code: 'SHAP01', quiz_id: 'q-1', active: true, expires_at: ahead(240), topic: 'Shapes', language: quizLang, teacher_user_id: TEACHER, class_id: lesson ? null : CLASS, parent_share_code_id: lesson ? 'sc-root' : null, invited_by_student_id: null, created_at: ago(30) });
    db.quiz_sessions.push({ id: 's1', share_code_id: 'sc-1', quiz_id: 'q-1', student_id: KID, status: 'completed', correct_answers: 4, total_questions_answered: 5, mastery_percentage: 80, completed_at: ago(20), created_at: ago(20), student_class: '2', device_ref: A.device });
  }
  fake = makeFake(db, { uniques: { child_language: ['canonical_id'], quiz_share_codes: ['code'] } });
  // the grown-ups corner's write is an upsert on canonical_id
  const from = (t) => {
    const b = fake.from(t);
    if (t === 'child_language') {
      b.upsert = (row) => {
        fake.calls.push({ table: t, op: 'upsert', payload: [row] });
        const at = db.child_language.findIndex((r) => r.canonical_id === row.canonical_id);
        if (at >= 0) Object.assign(db.child_language[at], row); else db.child_language.push({ ...row });
        return Promise.resolve({ data: null, error: null });
      };
    }
    return b;
  };
  Object.assign(supabase, { from, rpc: fake.rpc });
  Hub._resetCache();
  Play._resetCache();
  Ret._resetCache();
  IdFlags._resetCache();
}
const langCalls = () => fake.calls.filter((c) => c.table === 'child_language');
const twinLang = (out) => (out.teacher ? { PLNT0E: 'en', PLNT0U: 'ur' }[out.teacher.code] : null);
const libL = (out) => (out.lib ? /[?&]l=(en|ur)(&|$)/.exec(out.lib.href)[1] : null);

beforeEach(() => {
  jest.clearAllMocks();
  process.env.WEB_QUIZ_TOKEN_SECRET = 'hub-test-secret';
  process.env.PORTAL_URL = 'https://portal.example.test';
  redis._store.clear();
});

/** Every language the child meets on one open of the home: the page, the teacher's twin, the library link, the library's own read. */
async function readers(settings, opts, { token = T.signHub([KID]), lang = undefined } = {}) {
  seed(settings, opts);
  const out = await Hub.hub(token, { ...A, kid: CHIP, ...(lang ? { lang } : {}) });
  const who = await Hub.kidFromHub(token, CHIP, A.device);
  return { page: out.lang, teacher: twinLang(out), lib: libL(out), libKid: who && who.lang };
}

// [case, seed, the page's ?lang=, the one language (switch on), today's teacher pick and library read (switch off)]
const CASES = [
  ['just joined in Urdu, 0 quizzes', { kept: { language: 'ur', source: 'join' } }, null, 'ur', { page: 'en', teacher: 'en', libKid: null }],
  ['joined in Urdu, only an English library lesson', { quizLang: 'en', lesson: true, kept: { language: 'ur', source: 'join' } }, null, 'ur', { page: 'en', teacher: 'en', libKid: 'en' }],
  ['an English class quiz (joined in Urdu)', { quizLang: 'en', kept: { language: 'ur', source: 'join' } }, null, 'en', { page: 'en', teacher: 'en', libKid: 'en' }],
  ['a grown-up kept «اردو», an English class quiz', { quizLang: 'en', kept: { language: 'ur', source: 'chosen' } }, null, 'ur', { page: 'en', teacher: 'en', libKid: 'en' }],
];

describe('switch on: every reader on one open speaks the one language', () => {
  test.each(CASES)('%s', async (_c, opts, asked, want) => {
    expect(await readers(ON, opts, { lang: asked })).toEqual({ page: want, teacher: want, lib: want, libKid: want });
  });

  test('the page asked «اردو» (?lang=ur), an English class quiz: page, teacher pick and library link Urdu', async () => {
    const r = await readers(ON, { quizLang: 'en' }, { lang: 'ur' });
    expect(r).toMatchObject({ page: 'ur', teacher: 'ur', lib: 'ur' });
    // the library is opened with the hub's l=ur, which wins over its own read of the child (the class quiz's "en")
    expect(r.libKid).toBe('en');
  });

  test('the link\'s `l` sits before the join\'s: l "en", joined in Urdu, 0 quizzes → English', async () => {
    const r = await readers(ON, { kept: { language: 'ur', source: 'join' } }, { token: T.signHub([KID], undefined, { lang: 'en' }) });
    expect(r).toEqual({ page: 'en', teacher: 'en', lib: 'en', libKid: 'en' });
  });
});

describe('switch off: each reader is today\'s, and the kept row is never read', () => {
  const rows = [];
  OFFS.forEach(([label, settings]) => CASES.forEach(([c, opts, asked, , today]) => rows.push([label, c, settings, opts, asked, today])));
  test.each(rows)('switch row %s — %s', async (_l, _c, settings, opts, asked, today) => {
    const r = await readers(settings, opts, { lang: asked });
    expect(r).toEqual({ ...today, lib: today.page });
    expect(langCalls()).toEqual([]);
  });
});

// A phone not trusted for the child sees the locked page: its language reads the kept row by the id the child is known
// by, so a link that names a merged record still finds the grown-up's choice.
describe('the locked page of a merged child', () => {
  const RAW = '44444444-4444-4444-8444-0000000000d9';
  const lockedOf = async (settings) => {
    seed(settings, { quizLang: 'en', kept: { language: 'ur', source: 'chosen' }, canon: true });
    db.students.push({ id: RAW, student_name: 'Zara Testwala', student_name_urdu: null, self_reported_class: '2', list_id: null, is_active: true, status: 'merged', merged_into: KID, created_at: ago(72) });
    const t = T.signHub([RAW]);
    await Hub.hub(t, A); // phone A holds the link
    return Hub.hub(t, B);
  };
  test('switch on: the chosen "ur"', async () => {
    expect(await lockedOf(ON)).toMatchObject({ locked: true, lang: 'ur' });
  });
  test('switch off: today\'s "en", the row not read', async () => {
    expect(await lockedOf(OFFS[1][1])).toMatchObject({ locked: true, lang: 'en' });
    expect(langCalls()).toEqual([]);
  });
});

// The grown-ups corner's tap is kept only for the child the request names.
describe('keep names its child', () => {
  const KID2 = '44444444-4444-4444-8444-0000000000d2';
  test('a request naming another chip keeps nothing (the phone holds one child)', async () => {
    seed(ON, { quizLang: 'en' });
    await Hub.hub(T.signHub([KID]), { ...A, kid: Hub._parts.kidChip(KID2), lang: 'ur', keep: true });
    expect(db.child_language).toEqual([]);
    await Hub.hub(T.signHub([KID]), { ...A, kid: CHIP, lang: 'ur', keep: true });
    expect(db.child_language).toEqual([expect.objectContaining({ canonical_id: KID, language: 'ur', source: 'chosen' })]);
  });
});

// The switch's own read failing is off: every reader today's, the kept row never read.
describe('the switch read throws', () => {
  test.each(CASES)('%s → today\'s', async (_c, opts, asked, _want, today) => {
    seed(ON, opts);
    // every read that names this switch fails (its own, and the hub's one switch read that carries it); the hub's
    // other switches are read as usual
    supabase.from = require('../../helpers/switch-off-matrix').throwOn(supabase.from, 'web_quiz_return_lang');
    const Ret2 = require('../../../shared/services/quiz/web-quiz-return-lang');
    Ret2._resetCache();
    expect(await Ret2.on()).toBe(false);
    const out = await Hub.hub(T.signHub([KID]), { ...A, kid: CHIP, ...(asked ? { lang: asked } : {}) });
    expect(out.lang).toBe(today.page);
    expect(langCalls()).toEqual([]);
  });
});
