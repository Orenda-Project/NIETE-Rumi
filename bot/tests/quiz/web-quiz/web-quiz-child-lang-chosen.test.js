'use strict';
/**
 * A grown-up's language tap on the home's grown-ups corner lasts (app_settings web_quiz_return_lang, JSON true only):
 * the corner's link opens the home with `?lang=` and `keep=1`; the hub keeps that language for the chosen child
 * (child_language, source 'chosen') — only on a phone trusted for that child — and from then on the /quiz reply, its
 * link and the home speak it before any quiz. The join's kept language sits where the link's `l` does: after a class
 * quiz, before a library lesson. Switch off (absent, false, the string 'true'): `keep` is ignored, nothing is written,
 * the payload and the next reply's link are today's. Supabase, Redis and WhatsApp are the boundaries and are faked;
 * every first-party module on the path runs for real, the internal route included.
 */
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

const PHONE = fixturePhone(741);
const KID = '44444444-4444-4444-8444-0000000000c1';
const TEACHER = '11111111-1111-4111-8111-000000000001';
const LIST = '55555555-5555-4555-8555-000000000001';
const NOW = Date.now();
const ago = (h) => new Date(NOW - h * 3600000).toISOString();
const ahead = (h) => new Date(NOW + h * 3600000).toISOString();
const A = { device: 'AAAAAAAAAAAAAAAAAAAAAA' };
const B = { device: 'BBBBBBBBBBBBBBBBBBBBBB' };
const HUB = [{ key: 'web_quiz_hub', value: true }];
const ON = [...HUB, { key: 'web_quiz_return_lang', value: true }];
const off = (value) => (value === 'absent' ? HUB : [...HUB, { key: 'web_quiz_return_lang', value }]);
const CHIP = T.chipId('h', KID);

let db;
let fake;
/** A child on this phone; `quizLang`: one quiz (a class quiz, or a library lesson with `lesson`); `kept`: a child_language row. */
function seed(settings, { quizLang = null, lesson = false, kept = null } = {}) {
  db = {
    app_settings: settings,
    students: [{ id: KID, student_name: 'Zara Testwala', student_name_urdu: 'زارا', self_reported_class: '2', list_id: null, is_active: true, phone: PHONE, created_at: ago(1) }],
    student_lists: [{ id: LIST, user_id: TEACHER, class_name: '2', section: 'A', is_active: true }],
    quizzes: [], quiz_share_codes: [], quiz_sessions: [],
    child_language: kept ? [{ canonical_id: KID, ...kept }] : [],
  };
  if (quizLang) {
    db.quizzes.push({ id: 'q-1', topic: 'Shapes', subject: 'Maths', language: quizLang, grade: '2', video_id: null });
    db.quiz_share_codes.push({ id: 'sc-1', code: 'SHAP01', quiz_id: 'q-1', active: true, expires_at: ahead(240), topic: 'Shapes', language: quizLang, teacher_user_id: TEACHER, parent_share_code_id: lesson ? 'sc-root' : null, invited_by_student_id: null, created_at: ago(30) });
    db.quiz_sessions.push({ id: 's1', share_code_id: 'sc-1', quiz_id: 'q-1', student_id: KID, status: 'completed', correct_answers: 4, total_questions_answered: 5, mastery_percentage: 80, completed_at: ago(20), created_at: ago(20), student_class: '2', device_ref: A.device });
  }
  fake = makeFake(db, { uniques: { child_language: ['canonical_id'], quiz_share_codes: ['code'] } });
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

/** The /quiz reply for an English family row: its link's token and the home it opens (no ?lang= on the page). */
async function nextQuiz() {
  WhatsAppService.sendCtaUrl.mockClear();
  expect(await SQ.open(PHONE, { language: 'en' })).toBe(true);
  const [, msg] = WhatsAppService.sendCtaUrl.mock.calls[WhatsAppService.sendCtaUrl.mock.calls.length - 1];
  const token = /\/h\/([^/?#]+)$/.exec(msg.url)[1];
  return { tok: T.verify(token, 'h'), home: await Hub.hub(token, A) };
}

describe('switch on: the grown-ups corner\'s «اردو» lasts', () => {
  test('a child with an ENGLISH class quiz: the tap keeps "ur" (chosen) → the next /quiz reply\'s link l "ur" → the home Urdu', async () => {
    seed(ON, { quizLang: 'en' });
    const t = T.signHub([KID]);
    const page = await Hub.hub(t, { ...A, kid: CHIP, lang: 'ur', keep: true });
    expect(page.lang).toBe('ur');
    expect(db.child_language).toEqual([expect.objectContaining({ canonical_id: KID, language: 'ur', source: 'chosen' })]);
    const { tok, home } = await nextQuiz();
    expect(tok.l).toBe('ur');
    expect(home.lang).toBe('ur');
    expect(home.kids[0].first).toBe('زارا');
  });

  test('…and back: «English» on an Urdu-chosen child keeps "en" (the one update)', async () => {
    seed(ON, { quizLang: 'ur', kept: { language: 'ur', source: 'chosen' } });
    await Hub.hub(T.signHub([KID]), { ...A, kid: CHIP, lang: 'en', keep: true });
    expect(db.child_language).toEqual([expect.objectContaining({ language: 'en', source: 'chosen' })]);
    const { tok, home } = await nextQuiz();
    expect(tok.l).toBe('en');
    expect(home.lang).toBe('en');
  });

  test('through the internal route: POST /hub/:token with keep 1 keeps it; keep "1" (a string) does not', async () => {
    seed(ON, { quizLang: 'en' });
    process.env.INTERNAL_API_KEY = 'route-key';
    const express = require('express');
    const app = express();
    app.use(express.json());
    app.use('/wq', require('../../../shared/routes/web-quiz-internal.routes'));
    const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
    try {
      const url = `http://127.0.0.1:${server.address().port}/wq/hub/${T.signHub([KID])}`;
      const H = { 'x-api-key': 'route-key', 'content-type': 'application/json' };
      await fetch(url, { method: 'POST', headers: H, body: JSON.stringify({ kid: CHIP, device_ref: A.device, lang: 'ur', keep: '1' }) });
      expect(db.child_language).toEqual([]);
      const res = await fetch(url, { method: 'POST', headers: H, body: JSON.stringify({ kid: CHIP, device_ref: A.device, lang: 'ur', keep: 1 }) });
      expect((await res.json()).lang).toBe('ur');
      expect(db.child_language).toEqual([expect.objectContaining({ language: 'ur', source: 'chosen' })]);
    } finally { await new Promise((r) => server.close(r)); }
  });

  test('never kept from a phone not trusted for the child (the locked page), nor without a language', async () => {
    seed(ON, { quizLang: 'en' });
    const t = T.signHub([KID]);
    await Hub.hub(t, A); // phone A holds the link
    const locked = await Hub.hub(t, { ...B, kid: CHIP, lang: 'ur', keep: true });
    expect(locked.locked).toBe(true);
    await Hub.hub(t, { ...A, kid: CHIP, keep: true });
    expect(langCalls().filter((c) => c.op !== 'select')).toEqual([]);
    expect(db.child_language).toEqual([]);
  });
});

describe('switch on: the join\'s kept language on the home (where the link\'s `l` sits)', () => {
  test('0 quizzes, an OLD link with no `l`: the join\'s "ur" opens the home in Urdu', async () => {
    seed(ON, { kept: { language: 'ur', source: 'join' } });
    expect((await Hub.hub(T.signHub([KID]), A)).lang).toBe('ur');
  });
  test('only an English library lesson: still "ur"', async () => {
    seed(ON, { quizLang: 'en', lesson: true, kept: { language: 'ur', source: 'join' } });
    expect((await Hub.hub(T.signHub([KID]), A)).lang).toBe('ur');
  });
  test('an English class quiz: the class quiz decides ("en")', async () => {
    seed(ON, { quizLang: 'en', kept: { language: 'ur', source: 'join' } });
    expect((await Hub.hub(T.signHub([KID]), A)).lang).toBe('en');
  });
});

describe('switch off: keep is ignored, nothing is written, today\'s payload and link', () => {
  test.each([['absent', 'absent'], ['false', false], ['the string "true"', 'true']])('switch row %s', async (_l, value) => {
    seed(off(value), { quizLang: 'en', kept: { language: 'ur', source: 'chosen' } });
    const t = T.signHub([KID]);
    const withKeep = await Hub.hub(t, { ...A, kid: CHIP, lang: 'ur', keep: true });
    redis._store.clear();
    seed(off(value), { quizLang: 'en', kept: { language: 'ur', source: 'chosen' } });
    const without = await Hub.hub(t, { ...A, kid: CHIP, lang: 'ur' });
    expect(withKeep).toEqual(without);
    expect(langCalls()).toEqual([]);
    redis._store.clear();
    seed(off(value), { quizLang: 'en', kept: { language: 'ur', source: 'chosen' } });
    const { tok, home } = await nextQuiz();
    expect(tok).not.toHaveProperty('l');
    expect(home.lang).toBe('en');
    expect(langCalls()).toEqual([]);
  });
});

// With the home on, the /quiz reply reads the switch for every phone with a child (a grown-up's kept choice outranks
// every quiz); with the home off there is no grown-ups corner and the reply reads as before.
describe('open(): the kept choice is read while the home is on', () => {
  const spyOpen = async (settings, opts) => {
    seed(settings, opts);
    const spy = jest.spyOn(Ret, 'on');
    try {
      await SQ.open(PHONE, { language: 'en' });
      return { reads: spy.mock.calls.length, kept: langCalls().filter((c) => c.op === 'select').length };
    } finally { spy.mockRestore(); }
  };
  // two asks of the switch: the kept choice's and the reply link's own (hubLink) — one settings read, 30 s cache
  test('home on, a class quiz: the switch asked by the choice and the link, the kept row read once', async () => {
    expect(await spyOpen(ON, { quizLang: 'en' })).toEqual({ reads: 2, kept: 1 });
  });
  test('home on, switch off: no kept row read', async () => {
    expect(await spyOpen(off(false), { quizLang: 'en' })).toEqual({ reads: 2, kept: 0 });
  });
  test('home off: neither read (a class quiz)', async () => {
    expect(await spyOpen([{ key: 'web_quiz_return_lang', value: true }], { quizLang: 'en' })).toEqual({ reads: 0, kept: 0 });
  });
});
