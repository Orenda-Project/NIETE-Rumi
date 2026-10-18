'use strict';
/**
 * The /quiz reply speaks the child's language in the one order (web-quiz-child-lang.js ladder(), app_settings
 * web_quiz_return_lang, JSON true only): a grown-up's choice → the newest class quiz's → the language the child joined
 * in → the newest library lesson's (not with the switch on) → the family's. So a child who joined in Urdu on an
 * English family row is answered in Urdu, and the reply's link carries it, until a class quiz says otherwise. Two
 * children whose joins disagree: the family's. Switch off (absent, false, the string 'true'): today's reply, nothing
 * read. The switch is still read only for a lessons-only phone when the home is off. Supabase, Redis and WhatsApp are
 * the boundaries and are faked; every first-party module on the path runs for real.
 */
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
jest.mock('../../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  sendFlow: jest.fn().mockResolvedValue(true),
  sendCtaUrl: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));

const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const WhatsAppService = require('../../../shared/services/whatsapp.service');
const T = require('../../../shared/services/quiz/web-quiz-token');
const Hub = require('../../../shared/services/quiz/web-quiz-hub');
const Play = require('../../../shared/services/quiz/web-quiz-hub-play');
const SQ = require('../../../shared/services/quiz/student-quiz.service');
const Ret = require('../../../shared/services/quiz/web-quiz-return-lang');
const redis = require('../../../shared/services/cache/railway-redis.service');
const { fixturePhone } = require('./fixture-phone');

const PHONE = fixturePhone(742);
const KID = '44444444-4444-4444-8444-0000000000d1';
const SIB = '44444444-4444-4444-8444-0000000000d2';
const TEACHER = '11111111-1111-4111-8111-000000000001';
const LIST = '55555555-5555-4555-8555-000000000001';
const NOW = Date.now();
const ago = (h) => new Date(NOW - h * 3600000).toISOString();
const ahead = (h) => new Date(NOW + h * 3600000).toISOString();
const HUB = [{ key: 'web_quiz_hub', value: true }];
const ON = [...HUB, { key: 'web_quiz_return_lang', value: true }];
const URDU = /[؀-ۿ]/;

let db;
let fake;
/** Children on this phone (`kids`); `quizLang`: one quiz for the first (a class quiz, or a library lesson with
 * `lesson`); `kept`: child_language rows. */
function seed(settings, { kids = [KID], quizLang = null, lesson = false, kept = [] } = {}) {
  db = {
    app_settings: settings,
    students: kids.map((id, i) => ({ id, student_name: `Kid${i} Testwala`, student_name_urdu: 'بچہ', self_reported_class: '2', list_id: null, is_active: true, phone: PHONE, created_at: ago(1 + i) })),
    student_lists: [{ id: LIST, user_id: TEACHER, class_name: '2', section: 'A', is_active: true }],
    quizzes: [], quiz_share_codes: [], quiz_sessions: [],
    child_language: kept.map((r) => ({ ...r })),
  };
  if (quizLang) {
    db.quizzes.push({ id: 'q-1', topic: 'Shapes', subject: 'Maths', language: quizLang, grade: '2', video_id: null });
    db.quiz_share_codes.push({ id: 'sc-1', code: 'SHAP02', quiz_id: 'q-1', active: true, expires_at: ahead(240), topic: 'Shapes', language: quizLang, teacher_user_id: TEACHER, parent_share_code_id: lesson ? 'sc-root' : null, invited_by_student_id: null, created_at: ago(30) });
    db.quiz_sessions.push({ id: 's1', share_code_id: 'sc-1', quiz_id: 'q-1', student_id: kids[0], status: 'completed', correct_answers: 4, total_questions_answered: 5, mastery_percentage: 80, completed_at: ago(20), created_at: ago(20), student_class: '2', device_ref: 'AAAAAAAAAAAAAAAAAAAAAA' });
  }
  fake = makeFake(db, { uniques: { child_language: ['canonical_id'], quiz_share_codes: ['code'] } });
  Object.assign(supabase, { from: (t) => fake.from(t), rpc: fake.rpc });
  Hub._resetCache();
  Play._resetCache();
  Ret._resetCache();
}
const langCalls = () => fake.calls.filter((c) => c.table === 'child_language');

beforeEach(() => {
  jest.clearAllMocks();
  process.env.WEB_QUIZ_TOKEN_SECRET = 'hub-test-secret';
  process.env.PORTAL_URL = 'https://portal.example.test';
  delete process.env.WEB_QUIZ_BASE_URL;
  delete process.env.STUDENT_QUIZ_FLOW_ID;
  redis._store.clear();
});

/** The /quiz reply for a family row in `family` (English unless named): its words, its link's token and the raw token. */
async function reply(family = 'en') {
  expect(await SQ.open(PHONE, { language: family })).toBe(true);
  const [, msg] = WhatsAppService.sendCtaUrl.mock.calls[WhatsAppService.sendCtaUrl.mock.calls.length - 1];
  const raw = /\/h\/([^/?#]+)$/.exec(msg.url)[1];
  return { urdu: URDU.test(JSON.stringify(msg)), tok: T.verify(raw, 'h'), raw };
}
const joined = (id, language) => ({ canonical_id: id, language, source: 'join' });

describe('switch on: the language the child joined in answers the /quiz reply', () => {
  test('0 quizzes, joined in Urdu, an English family row → the reply is Urdu and its link l "ur"', async () => {
    seed(ON, { kept: [joined(KID, 'ur')] });
    const r = await reply();
    expect(r.tok.l).toBe('ur');
    expect(r.urdu).toBe(true);
  });
  test('0 quizzes, joined in English, an Urdu family row (a new phone\'s row is born Urdu) → the reply is English, its link l "en", and the home it opens is English', async () => {
    seed(ON, { kept: [joined(KID, 'en')] });
    const r = await reply('ur');
    expect(r.tok.l).toBe('en');
    expect(r.urdu).toBe(false);
    expect((await Hub.hub(r.raw, { device: 'AAAAAAAAAAAAAAAAAAAAAA' })).lang).toBe('en');
  });
  test.each([['en'], ['ur']])('a new home link with no language of its own and no ?lang= (an Urdu family row on the phone) → the language the child joined in, %s', async (joinedIn) => {
    seed(ON, { kept: [joined(KID, joinedIn)] });
    await reply('ur');
    const raw = T.signHub([KID]);
    expect(T.verify(raw, 'h')).not.toHaveProperty('l');
    expect((await Hub.hub(raw, { device: 'AAAAAAAAAAAAAAAAAAAAAA' })).lang).toBe(joinedIn);
  });
  test('only an English library lesson, joined in Urdu → Urdu (a lesson is not the child\'s language)', async () => {
    seed(ON, { quizLang: 'en', lesson: true, kept: [joined(KID, 'ur')] });
    const r = await reply();
    expect(r.tok.l).toBe('ur');
    expect(r.urdu).toBe(true);
  });
  test('an English class quiz, joined in Urdu → the class quiz decides ("en")', async () => {
    seed(ON, { quizLang: 'en', kept: [joined(KID, 'ur')] });
    const r = await reply();
    expect(r.tok.l).toBe('en');
    expect(r.urdu).toBe(false);
  });
  test('a grown-up\'s choice outranks the class quiz and the join', async () => {
    seed(ON, { quizLang: 'ur', kept: [{ canonical_id: KID, language: 'en', source: 'chosen' }] });
    const r = await reply();
    expect(r.tok.l).toBe('en');
  });
  test('two children whose joins disagree → the family\'s ("en"); when they agree → theirs', async () => {
    seed(ON, { kids: [KID, SIB], kept: [joined(KID, 'ur'), joined(SIB, 'en')] });
    expect((await reply()).tok.l).toBe('en');
    seed(ON, { kids: [KID, SIB], kept: [joined(KID, 'ur'), joined(SIB, 'ur')] });
    expect((await reply()).tok.l).toBe('ur');
  });
  test('no kept row, 0 quizzes → the family\'s, and the rows are read once', async () => {
    seed(ON);
    const r = await reply();
    expect(r.tok.l).toBe('en');
    expect(langCalls().filter((c) => c.op === 'select')).toHaveLength(1);
  });
});

describe('switch off: today\'s reply, nothing read', () => {
  test.each([['absent', HUB], ['false', [...HUB, { key: 'web_quiz_return_lang', value: false }]],
    ['the string "true"', [...HUB, { key: 'web_quiz_return_lang', value: 'true' }]],
    ['the JSON string "\\"true\\""', [...HUB, { key: 'web_quiz_return_lang', value: '"true"' }]]])('switch row %s', async (_l, settings) => {
    for (const opts of [{}, { quizLang: 'en', lesson: true }, { quizLang: 'ur', lesson: true }, { quizLang: 'en' }]) {
      seed(settings, { ...opts, kept: [joined(KID, 'ur')] });
      const r = await reply();
      expect(r.tok).not.toHaveProperty('l');
      expect(r.urdu).toBe(opts.quizLang === 'ur');
      expect(langCalls()).toEqual([]);
    }
  });
  test.each([['absent', HUB], ['false', [...HUB, { key: 'web_quiz_return_lang', value: false }]]])('switch row %s: joined in English on an Urdu family row → today\'s Urdu reply, no language on its link', async (_l, settings) => {
    seed(settings, { kept: [joined(KID, 'en')] });
    const r = await reply('ur');
    expect(r.tok).not.toHaveProperty('l');
    expect(r.urdu).toBe(true);
    expect(langCalls()).toEqual([]);
  });
});
