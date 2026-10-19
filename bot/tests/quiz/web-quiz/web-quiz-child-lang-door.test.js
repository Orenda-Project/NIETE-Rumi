'use strict';
/**
 * A friend who comes in through an Urdu card keeps the door's language (app_settings web_quiz_share_link_lang, on top of
 * the one share): the card's link opens the quiz door with ?lang=ur, the page names it on the new child's start
 * (`door_lang`), and the start keeps it on the new child's own row (child_language) as strongly as a grown-up's choice,
 * so the results card's Home, the hub's first answer and every later link open in Urdu until a grown-up changes it.
 * An English card's link carries no ?lang=, so nothing is kept and the friend's home is today's. Switch off: nothing is
 * written and the Home link is byte-identical to today's. Supabase and Redis are the boundaries and are faked; every
 * first-party module on the path runs for real.
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
const Switch = require('../../../shared/services/quiz/web-quiz-card-switch');
const Door = require('../../../shared/services/quiz/web-quiz-hub-door');
const Hub = require('../../../shared/services/quiz/web-quiz-hub');
const CL = require('../../../shared/services/quiz/web-quiz-child-lang');

const TEACHER = '11111111-1111-4111-8111-111111111111';
const QUIZ = '22222222-2222-4222-8222-222222222222';
const SC = '33333333-3333-4333-8333-333333333333';
const Q = (n) => `cccccc${String(n).padStart(2, '0')}-cccc-4ccc-8ccc-cccccccccccc`;
const D2 = 'BBBBBBBBBBBBBBBBBBBBBB';
const NOW_MS = Date.UTC(2026, 9, 19, 10, 0, 0);
const at = (h) => new Date(NOW_MS + h * 3600000).toISOString();

// An English class quiz (code AB12CD) a classmate shared on an Urdu card; nobody on the friend's phone D2 yet.
function seed({ linkLang = true, ret = true } = {}) {
  const settings = [{ key: 'web_quiz_teachers', value: '"all"' }, { key: 'web_quiz_hub', value: true }, { key: 'web_quiz_hub_door', value: true },
    { key: 'web_quiz_return_lang', value: ret }, { key: 'web_quiz_card_v3', value: true }, { key: 'web_quiz_share_v4', value: true }];
  if (linkLang !== 'absent') settings.push({ key: 'web_quiz_share_link_lang', value: linkLang });
  const fake = makeFake({
    app_settings: settings,
    quizzes: [{ id: QUIZ, topic: 'Using A, An and The', grade: '3', subject: 'english', quiz_source: 'transcript', video_id: null, meta: {}, language: 'en' }],
    quiz_share_codes: [{ id: SC, code: 'AB12CD', quiz_id: QUIZ, video_id: null, teacher_user_id: TEACHER, language: 'en', active: true,
      expires_at: new Date(NOW_MS + 240 * 3600000).toISOString(), invited_by_student_id: null, parent_share_code_id: null, created_at: at(-30) }],
    quiz_questions: [1, 2].map((n) => ({ id: Q(n), quiz_id: QUIZ, external_id: `q${n}`, sort_order: n, question_text: `Q${n}`,
      option_a: 'A', option_b: 'B', option_c: null, option_d: null, correct_option: 'A', explanation: null, option_feedback: null, media: {}, render_pattern: null })),
    quiz_sessions: [], quiz_answers: [], students: [], student_lists: [], child_language: [],
  }, { uniques: { child_language: ['canonical_id'] } });
  // child_language's upsert on its primary key (a grown-up's choice): an update when the child has a row
  const from = (t) => {
    const b = fake.from(t);
    if (t === 'child_language') {
      b.upsert = (row) => {
        const hit = fake.db.child_language.find((r) => r.canonical_id === row.canonical_id);
        if (hit) Object.assign(hit, row); else fake.db.child_language.push({ ...row });
        return Promise.resolve({ data: null, error: null });
      };
    }
    return b;
  };
  Object.assign(supabase, { from, rpc: fake.rpc });
  Flags._resetCache();
  Ret._resetCache();
  Switch._reset();
  Hub._resetCache();
  require('../../../shared/services/quiz/web-quiz-identity-flags')._resetCache();
  redis._store.clear();
  return fake;
}

// The friend types their name on the door and plays to the end; → the run's session token and the new child's id.
async function friendJoins(fake, doorLang) {
  const body = { code: 'AB12CD', new: { name: 'Abdul Testwala', force: true }, device_ref: D2 };
  if (doorLang !== undefined) body.door_lang = doorLang;
  const out = await WQ.startSession(body);
  const s = fake.db.quiz_sessions[fake.db.quiz_sessions.length - 1];
  Object.assign(s, { status: 'completed', completed_at: at(0) });
  return { st: out.st, kid: String(s.student_id) };
}
const tokOf = (href) => T.verify(href.replace(/^\/h\//, '').split('?')[0], 'h');

const SAVED = { ...process.env };
beforeEach(() => {
  process.env = { ...SAVED, INTERNAL_API_KEY: 'test-key', WEB_QUIZ_TOKEN_SECRET: 'door-lang-test-secret', PORTAL_URL: 'https://portal.example.test' };
  jest.clearAllMocks();
  jest.spyOn(Date, 'now').mockReturnValue(NOW_MS);
});
afterEach(() => { jest.restoreAllMocks(); });
afterAll(() => { process.env = SAVED; });

describe('switch on: a friend who joins through an Urdu card stays in Urdu', () => {
  test('the stored child language is ur, the Home link carries ur, the hub\'s first answer is ur', async () => {
    const fake = seed();
    const { st, kid } = await friendJoins(fake, 'ur');
    expect(fake.db.child_language).toEqual([expect.objectContaining({ canonical_id: kid, language: 'ur', source: 'chosen' })]);
    expect(await CL.childLang(kid)).toBe('ur');
    const href = (await Door.door({ st }, WQ.WqError)).href;
    expect(tokOf(href)).toMatchObject({ k: 'h', ids: [kid], l: 'ur' });
    const hub = await Hub.hub(href.replace(/^\/h\//, ''), { device: D2 });
    expect(hub.lang).toBe('ur');
  });
  test('a grown-up\'s later choice still changes it', async () => {
    const fake = seed();
    const { kid } = await friendJoins(fake, 'ur');
    expect(await require('../../../shared/services/quiz/child-language.repo').choose(kid, 'en')).toBe(true);
    expect(await CL.childLang(kid)).toBe('en');
  });
  test('a kept row is never overwritten by a door', async () => {
    const fake = seed();
    const { kid } = await friendJoins(fake, 'ur');
    fake.db.child_language[0].language = 'en';
    await require('../../../shared/services/quiz/child-language.repo').doorKept(kid, 'ur');
    expect(fake.db.child_language).toEqual([expect.objectContaining({ canonical_id: kid, language: 'en' })]);
  });
});

describe('the English control and anything else: nothing kept, today\'s home', () => {
  test.each([['an English card (no ?lang=)', undefined], ['a made-up language', 'fr'], ['not a string', { x: 1 }]])('%s', async (_l, doorLang) => {
    const fake = seed();
    const { st, kid } = await friendJoins(fake, doorLang);
    expect(fake.db.child_language).toEqual([]);
    expect(tokOf((await Door.door({ st }, WQ.WqError)).href).l).toBe('en');
    expect(await CL.childLang(kid)).toBe('en');
  });
});

describe('switch off: nothing written, the Home link byte-identical to today\'s', () => {
  test.each([['absent', 'absent'], ['false', false], ['the string "true"', 'true']])('web_quiz_share_link_lang %s', async (_l, linkLang) => {
    const fake = seed({ linkLang });
    const { st, kid } = await friendJoins(fake, 'ur');
    expect(fake.db.child_language).toEqual([]);
    expect((await Door.door({ st }, WQ.WqError)).href).toBe(`/h/${T.signHub([kid], undefined, { lang: 'en' })}`);
  });
  test('web_quiz_return_lang off: nothing written either', async () => {
    const fake = seed({ ret: false });
    await friendJoins(fake, 'ur');
    expect(fake.db.child_language).toEqual([]);
  });
});
