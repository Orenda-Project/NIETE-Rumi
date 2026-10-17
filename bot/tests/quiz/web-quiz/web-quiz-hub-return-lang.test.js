'use strict';
/**
 * A child who joined on their own comes back by WhatsApp /quiz to a home in the family's language
 * (app_settings web_quiz_return_lang, JSON true only, 30 s cache, fails closed). The /quiz reply already speaks the
 * language the bot resolved (the child's newest quiz, else the family's own); with the switch on the hub link carries
 * it (`l`, as the join link does) and the hub falls back to it when the child has no quiz yet, before English.
 * `?lang=` still wins; a child with a quiz keeps their quiz's language. Switch off (absent, false, the string 'true',
 * a failed read): the link and the page are today's, byte for byte. Supabase, Redis and WhatsApp are the boundaries
 * and are faked; every first-party module on the path runs for real.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/services/cache/railway-redis.service', () => {
  const store = new Map();
  return {
    _store: store, _up: true,
    isAvailable() { return this._up; },
    get: jest.fn(async function get(k) { return this._up && store.has(k) ? store.get(k) : null; }),
    set: jest.fn().mockResolvedValue(true), delete: jest.fn().mockResolvedValue(true),
    setNX: jest.fn(async function setNX(k, v) { if (!this._up) return true; if (store.has(k)) return false; store.set(k, v); return true; }),
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
const redis = require('../../../shared/services/cache/railway-redis.service');
const { fixturePhone } = require('./fixture-phone');

const PHONE = fixturePhone(1);
const KID = '44444444-4444-4444-8444-0000000000a1';
const TEACHER = '11111111-1111-4111-8111-000000000001';
const LIST = '55555555-5555-4555-8555-000000000001';
const NOW = Date.now();
const ago = (h) => new Date(NOW - h * 3600000).toISOString();
const ahead = (h) => new Date(NOW + h * 3600000).toISOString();
const A = { device: 'AAAAAAAAAAAAAAAAAAAAAA' };
const HUB = [{ key: 'web_quiz_hub', value: 'true' }];
const RET = (value) => ({ key: 'web_quiz_return_lang', value });
const ON = [...HUB, RET(true)];
const V2 = [...ON, { key: 'web_quiz_challenge', value: 'true' }, { key: 'web_quiz_challenge_v2', value: 'true' }];

let db;
// A child who just joined on their own: a name and a grade, no class, no quiz yet.
function seed(settings, { quizLang = null, lessonOnly = false, failSettings = false } = {}) {
  db = {
    app_settings: settings,
    students: [{ id: KID, student_name: 'Zara Testwala', student_name_urdu: 'زارا', self_reported_class: '2', list_id: null, is_active: true, phone: PHONE, created_at: ago(1) }],
    student_lists: [{ id: LIST, user_id: TEACHER, class_name: '2', section: 'A', is_active: true }],
    quizzes: [], quiz_share_codes: [], quiz_sessions: [],
  };
  if (quizLang) {
    db.quizzes.push({ id: 'q-1', topic: 'Shapes', subject: 'Maths', language: quizLang, grade: '2', video_id: null });
    // lessonOnly: a library lesson code (the only kind a self-joined child gets from the home's videos)
    db.quiz_share_codes.push({ id: 'sc-1', code: 'SHAP01', quiz_id: 'q-1', active: true, expires_at: ahead(240), topic: 'Shapes', language: quizLang, teacher_user_id: TEACHER, parent_share_code_id: lessonOnly ? 'sc-root' : null, invited_by_student_id: null, created_at: ago(30) });
    db.quiz_sessions.push({ id: 's1', share_code_id: 'sc-1', quiz_id: 'q-1', student_id: KID, status: 'completed', correct_answers: 4, total_questions_answered: 5, mastery_percentage: 80, completed_at: ago(20), created_at: ago(20), student_class: '2' });
  }
  const fake = makeFake(db);
  const from = (t) => {
    if (failSettings && t === 'app_settings') {
      const err = { data: null, error: { message: 'settings down' } };
      const chain = new Proxy({}, { get: (_, k) => (k === 'then' ? (res) => res(err) : () => chain) });
      return chain;
    }
    return fake.from(t);
  };
  Object.assign(supabase, { from, rpc: fake.rpc });
  Hub._resetCache();
  Play._resetCache();
  try { require('../../../shared/services/quiz/web-quiz-return-lang')._resetCache(); } catch (_) { /* the base has no switch module */ }
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.WEB_QUIZ_TOKEN_SECRET = 'hub-test-secret';
  process.env.PORTAL_URL = 'https://portal.example.test';
  delete process.env.WEB_QUIZ_BASE_URL;
  delete process.env.STUDENT_QUIZ_FLOW_ID;
  redis._store.clear();
});

/** WhatsApp /quiz for the family's language (the users row the ingress passes), then the page it links to. */
async function returnVisit(settings, family, { quizLang = null, lessonOnly = false, page = {} } = {}) {
  redis._store.clear();
  seed(settings, { quizLang, lessonOnly });
  expect(await SQ.open(PHONE, { language: family })).toBe(true);
  const [, msg] = WhatsAppService.sendCtaUrl.mock.calls[WhatsAppService.sendCtaUrl.mock.calls.length - 1];
  const token = /\/h\/([^/?#]+)$/.exec(msg.url)[1];
  return { msg, token, out: await Hub.hub(token, { ...A, ...page }) };
}

describe('switch on: the home opens in the language the reply spoke', () => {
  test('joined child, 0 quizzes, Urdu family → /quiz → hubPayload.lang === "ur"', async () => {
    const { token, out } = await returnVisit(ON, 'ur');
    expect(T.verify(token, 'h')).toMatchObject({ k: 'h', ids: [KID], l: 'ur' });
    expect(out.lang).toBe('ur');
    expect(out.kids[0].first).toBe('زارا');
  });

  test('joined child, 0 quizzes, English family → stays "en" (the link says en)', async () => {
    const { token, out } = await returnVisit(ON, 'en');
    expect(T.verify(token, 'h').l).toBe('en');
    expect(out.lang).toBe('en');
    expect(out.kids[0].first).toBe('Zara');
  });

  test('a child with a quiz keeps their quiz\'s language (the reply speaks it too)', async () => {
    const { token, out } = await returnVisit(ON, 'ur', { quizLang: 'en' });
    expect(T.verify(token, 'h').l).toBe('en');
    expect(out.lang).toBe('en');
  });

  test('?lang= on the page still wins over the link\'s language (under web_quiz_challenge_v2)', async () => {
    const { out } = await returnVisit(V2, 'ur', { page: { lang: 'en' } });
    expect(out.lang).toBe('en');
  });

  test('a token `l` that is not en/ur is ignored (English)', async () => {
    seed(ON);
    const forged = T.sign({ k: 'h', ids: [KID], l: 'fr', exp: Math.floor(Date.now() / 1000) + 600 });
    expect((await Hub.hub(forged, A)).lang).toBe('en');
  });

  test('another phone opening the link: the locked page is in the link\'s language too', async () => {
    const { token } = await returnVisit(ON, 'ur');
    const out = await Hub.hub(token, { device: 'BBBBBBBBBBBBBBBBBBBBBB' });
    expect(out).toMatchObject({ locked: true, lang: 'ur', kids: [] });
  });

  test('the token carries a two-letter code only: never a name, never the phone', async () => {
    const { token } = await returnVisit(ON, 'ur');
    expect(Object.keys(T.verify(token, 'h')).sort()).toEqual(['exp', 'ids', 'k', 'l']);
    const raw = Buffer.from(token.split('.')[0], 'base64url').toString('utf8');
    expect(raw).not.toContain('Zara');
    expect(raw).not.toContain(String(PHONE).replace(/\D/g, '').slice(-7));
  });
});

describe('GOLDEN: switch off, the link and the page are today\'s, byte for byte', () => {
  const OFFS = [
    ['absent', HUB],
    ['false', [...HUB, RET(false)]],
    ['the string \'true\' (JSON true only)', [...HUB, RET('true')]],
    ['a JSON-encoded string "true"', [...HUB, RET('"true"')]],
  ];

  test.each(OFFS)('%s: Urdu family, 0 quizzes → no `l` in the link, an English home (today)', async (_n, settings) => {
    const { token, out } = await returnVisit(settings, 'ur');
    expect(T.verify(token, 'h')).not.toHaveProperty('l');
    expect(out.lang).toBe('en');
  });

  test.each(OFFS)('%s: the link is byte-identical to today\'s hub token for these ids', async (_n, settings) => {
    const realNow = Date.now;
    Date.now = () => NOW; // one second for both signatures
    try {
      const { msg } = await returnVisit(settings, 'ur');
      expect(msg.url).toBe(`https://portal.example.test/h/${T.signHub([KID])}`);
    } finally { Date.now = realNow; }
  });

  test('switch off: the page payload is deep-equal to the one for today\'s token', async () => {
    const { out } = await returnVisit(HUB, 'ur');
    redis._store.clear();
    seed(HUB);
    expect(out).toEqual(await Hub.hub(T.signHub([KID]), A));
  });

  test('switch off, a token that carries `l` anyway (signed while on): today\'s English page', async () => {
    const { token } = await returnVisit(ON, 'ur');
    redis._store.clear();
    seed([...HUB, RET(false)]);
    const out = await Hub.hub(token, A);
    redis._store.clear();
    seed(HUB);
    expect(out).toEqual(await Hub.hub(T.signHub([KID]), A));
  });

  test('the switch read fails: closed (no `l`, English)', async () => {
    seed(ON);
    const R = require('../../../shared/services/quiz/web-quiz-return-lang');
    const spy = jest.spyOn(supabase, 'from');
    spy.mockImplementation((t) => {
      if (t !== 'app_settings') return makeFake(db).from(t);
      const err = { data: null, error: { message: 'down' } };
      const chain = new Proxy({}, { get: (_, k) => (k === 'then' ? (res) => res(err) : () => chain) });
      return chain;
    });
    try {
      expect(await R.on()).toBe(false);
    } finally { spy.mockRestore(); }
  });

  test('switch on, a child with a quiz: the page payload equals today\'s (the history decides)', async () => {
    const { out } = await returnVisit(ON, 'ur', { quizLang: 'en' });
    redis._store.clear();
    seed(HUB, { quizLang: 'en' });
    expect(out).toEqual(await Hub.hub(T.signHub([KID]), A));
  });
});

describe('the one-door landing (/go): a known child\'s home link carries the landing\'s language', () => {
  const Targets = require('../../../shared/services/first-touch/go.targets');
  const tokenOf = (path) => /^\/h\/([^/?#]+)\?from=quiz$/.exec(path)[1];

  test('switch on, an Urdu landing: the token carries l=ur and the home opens in Urdu', async () => {
    seed(ON);
    const path = await Targets.child([KID], 'quiz', 'ur');
    expect(T.verify(tokenOf(path), 'h')).toMatchObject({ ids: [KID], l: 'ur' });
    expect((await Hub.hub(tokenOf(path), A)).lang).toBe('ur');
  });

  test('switch on, a bilingual landing (bi) or none: no `l`', async () => {
    seed(ON);
    expect(T.verify(tokenOf(await Targets.child([KID], 'quiz', 'bi')), 'h')).not.toHaveProperty('l');
    expect(T.verify(tokenOf(await Targets.child([KID], 'quiz')), 'h')).not.toHaveProperty('l');
  });

  test('GOLDEN: switch off, an Urdu landing: today\'s link, byte for byte', async () => {
    const realNow = Date.now;
    Date.now = () => NOW;
    try {
      for (const settings of [HUB, [...HUB, RET('true')]]) {
        seed(settings);
        expect(await Targets.child([KID], 'quiz', 'ur')).toBe(`/h/${T.signHub([KID], 'one_door')}?from=quiz`);
      }
    } finally { Date.now = realNow; }
  });
});

describe('?lang= (the join\'s first home): honoured with web_quiz_return_lang on, even without web_quiz_challenge_v2', () => {
  const page = async (settings, opts, quizLang = null) => {
    redis._store.clear();
    seed(settings, { quizLang });
    return Hub.hub(T.signHub([KID], 'student_join_join'), { ...A, ...opts });
  };

  test('v2 off, switch on, ?lang=ur on a just-joined child: an Urdu home', async () => {
    const out = await page(ON, { lang: 'ur' });
    expect(out.lang).toBe('ur');
    expect(out.kids[0].first).toBe('زارا');
  });

  test('v2 off, switch on, ?lang=en over an Urdu quiz: English (the asked language wins, as under v2)', async () => {
    expect((await page(ON, { lang: 'en' }, 'ur')).lang).toBe('en');
  });

  test('v2 off, switch on, a ?lang= that is not en/ur: today\'s page', async () => {
    for (const lang of ['', 'fr', 'UR', ['ur']]) expect(await page(ON, { lang })).toEqual(await page(ON, {}));
  });

  test.each([
    ['absent', HUB],
    ['false', [...HUB, RET(false)]],
    ['the string \'true\'', [...HUB, RET('true')]],
  ])('GOLDEN: v2 off and the switch %s: ?lang=ur changes nothing (today\'s page, deep-equal)', async (_n, settings) => {
    const base = await page(settings, {});
    const asked = await page(settings, { lang: 'ur' });
    expect(asked).toEqual(base);
    expect(asked.lang).toBe('en');
  });
});

describe('a child whose only quizzes are library lessons: the lesson\'s language never outvotes the family\'s', () => {
  const { resolveUx } = require('../../../shared/config/ux-strings');
  const Words = require('../../../shared/services/first-touch/one-door.strings');
  const replyBody = (lang) => [resolveUx('sqHubBody', { language: lang }), Words.str('od.child.body', lang)];

  test('switch on, Urdu family, one English lesson code: an Urdu reply, l=ur, an Urdu home', async () => {
    const { msg, token, out } = await returnVisit(ON, 'ur', { quizLang: 'en', lessonOnly: true });
    expect(replyBody('ur')).toContain(msg.body);
    expect(T.verify(token, 'h').l).toBe('ur');
    expect(out.lang).toBe('ur');
  });

  test('switch on, a lesson code beside a class quiz: the class quiz decides (today)', async () => {
    seed(ON, { quizLang: 'en' });
    db.quizzes.push({ id: 'q-2', topic: 'Birds', subject: 'Science', language: 'ur', grade: '2', video_id: null });
    db.quiz_share_codes.push({ id: 'sc-2', code: 'BIRD01', quiz_id: 'q-2', active: true, expires_at: ahead(240), topic: 'Birds', language: 'ur', teacher_user_id: TEACHER, parent_share_code_id: 'sc-1', invited_by_student_id: null, created_at: ago(2) });
    db.quiz_sessions.push({ id: 's2', share_code_id: 'sc-2', quiz_id: 'q-2', student_id: KID, status: 'completed', correct_answers: 3, total_questions_answered: 5, mastery_percentage: 60, completed_at: ago(1), created_at: ago(1), student_class: '2' });
    expect(await SQ.open(PHONE, { language: 'ur' })).toBe(true);
    const [, msg] = WhatsAppService.sendCtaUrl.mock.calls[0];
    const token = /\/h\/([^/?#]+)$/.exec(msg.url)[1];
    expect(T.verify(token, 'h').l).toBe('en');
    expect((await Hub.hub(token, A)).lang).toBe('en');
  });

  test.each([
    ['absent', HUB],
    ['the string \'true\'', [...HUB, RET('true')]],
  ])('GOLDEN: switch %s, the same child: today\'s English reply, today\'s link, today\'s page', async (_n, settings) => {
    const realNow = Date.now;
    Date.now = () => NOW;
    try {
      const { msg, out } = await returnVisit(settings, 'ur', { quizLang: 'en', lessonOnly: true });
      expect(replyBody('en')).toContain(msg.body);
      expect(msg.url).toBe(`https://portal.example.test/h/${T.signHub([KID])}`);
      expect(out.lang).toBe('en');
      redis._store.clear();
      seed(HUB, { quizLang: 'en', lessonOnly: true });
      expect(out).toEqual(await Hub.hub(T.signHub([KID]), A));
    } finally { Date.now = realNow; }
  });

  test('classLanguage: the newest class quiz\'s language, else null; with childLanguage it is childLanguage', () => {
    const h = [{ lessonCode: true, language: 'en' }, { lessonCode: false, language: 'ur' }];
    expect(SQ.classLanguage(h)).toBe('ur');
    expect(SQ.classLanguage([{ lessonCode: true, language: 'en' }])).toBeNull();
    expect(SQ.classLanguage([])).toBeNull();
    for (const x of [h, [{ lessonCode: true, language: 'en' }], [], null]) expect(SQ.classLanguage(x) || SQ.childLanguage(x)).toBe(SQ.childLanguage(x));
  });
});
