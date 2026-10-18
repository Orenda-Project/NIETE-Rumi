'use strict';
/**
 * The quiz page in a grown-up's chosen language (app_settings web_quiz_return_lang, web-quiz-quiz-lang.js): the quiz
 * answer for /quiz/<code>?k=<chip> names `child_lang` when the chip is a child of this class whose child_language row is
 * a grown-up's choice ('chosen'); a join language never (the quiz's own language wins over it). No k, an unknown chip,
 * the switch off, or any read error: no field, and the quiz still answers. Supabase and Redis are the boundaries and are
 * faked; every first-party module on the path runs for real. Invented children only.
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

describe('getQuiz with the child\'s chip (switch on)', () => {
  test('a grown-up chose Urdu: child_lang ur', async () => {
    seed({ langs: [{ canonical_id: KID, language: 'ur', source: 'chosen' }] });
    const out = await WQ.getQuiz('AB12CD', { k: chip(KID) });
    expect(out.child_lang).toBe('ur');
    expect(out.quiz.lang).toBe('en');
  });
  test('a grown-up chose English on an Urdu-chosen family\'s other child: child_lang en', async () => {
    seed({ langs: [{ canonical_id: KID, language: 'en', source: 'chosen' }, { canonical_id: SIB, language: 'ur', source: 'chosen' }] });
    expect((await WQ.getQuiz('AB12CD', { k: chip(KID) })).child_lang).toBe('en');
  });
  test('a chip minted on another code of this teacher (an alias) is the same child', async () => {
    seed({ langs: [{ canonical_id: SIB, language: 'ur', source: 'chosen' }] });
    expect((await WQ.getQuiz('AB12CD', { k: chip(SIB, OLD) })).child_lang).toBe('ur');
  });
  test('the language the child joined in is not a grown-up\'s choice: no field', async () => {
    seed({ langs: [{ canonical_id: KID, language: 'ur', source: 'join' }] });
    expect(await WQ.getQuiz('AB12CD', { k: chip(KID) })).not.toHaveProperty('child_lang');
  });
  test('no row, an unknown chip, a chip of the wrong shape: no field', async () => {
    seed({ langs: [{ canonical_id: KID, language: 'ur', source: 'chosen' }] });
    for (const k of [chip('44444444-4444-4444-8444-444444444499'), 'abc', `${chip(KID)}0`, ['x'], null]) {
      expect(await WQ.getQuiz('AB12CD', { k })).not.toHaveProperty('child_lang');
    }
    seed({ langs: [] });
    expect(await WQ.getQuiz('AB12CD', { k: chip(KID) })).not.toHaveProperty('child_lang');
  });
  test('no k: no child_language read and no extra class read', async () => {
    seed({ sw: 'absent', langs: [{ canonical_id: KID, language: 'ur', source: 'chosen' }] });
    await WQ.getQuiz('AB12CD');
    const base = reads('quiz_sessions');
    R._resetCache(); Flags._resetCache();
    seed({ langs: [{ canonical_id: KID, language: 'ur', source: 'chosen' }] });
    const out = await WQ.getQuiz('AB12CD');
    expect(out).not.toHaveProperty('child_lang');
    expect(reads('child_language')).toBe(0);
    expect(reads('quiz_sessions')).toBe(base);
  });
});

describe('a read error: no field, and the quiz still answers', () => {
  test('the child_language read fails', async () => {
    seed({ langs: [{ canonical_id: KID, language: 'ur', source: 'chosen' }] });
    const from = supabase.from;
    supabase.from = (t) => { if (t === 'child_language') throw new Error('boom'); return from(t); };
    const out = await WQ.getQuiz('AB12CD', { k: chip(KID) });
    expect(out.quiz.n).toBe(2);
    expect(out).not.toHaveProperty('child_lang');
  });
  test('the chip lookup fails', async () => {
    seed({ langs: [{ canonical_id: KID, language: 'ur', source: 'chosen' }] });
    jest.spyOn(WQ, 'classChips').mockRejectedValue(new Error('boom'));
    const out = await WQ.getQuiz('AB12CD', { k: chip(KID) });
    expect(out.quiz.n).toBe(2);
    expect(out).not.toHaveProperty('child_lang');
  });
  test('field() never throws', async () => {
    seed({ langs: [] });
    jest.spyOn(WQ, 'classChips').mockRejectedValue(new Error('boom'));
    await expect(QL().field({ shareCodeId: SC, teacherUserId: TEACHER }, chip(KID))).resolves.toEqual({});
    await expect(QL().field(null, chip(KID))).resolves.toEqual({});
  });
});

describe('switch off, absent or the string "true": no field and nothing read', () => {
  test.each([['off', false], ['absent', 'absent'], ['the string true', 'true']])('%s', async (_n, sw) => {
    seed({ sw, langs: [{ canonical_id: KID, language: 'ur', source: 'chosen' }] });
    const out = await WQ.getQuiz('AB12CD', { k: chip(KID) });
    expect(out).not.toHaveProperty('child_lang');
    expect(reads('child_language')).toBe(0);
    expect(await QL().field({ shareCodeId: SC, teacherUserId: TEACHER }, chip(KID))).toEqual({});
  });
});

// ── the route ─────────────────────────────────────────────────────────────────────────────────────────
async function serve(fn) {
  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use('/api/internal/wq', require('../../../shared/routes/web-quiz-internal.routes'));
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api/internal/wq`;
  const ask = async (q = '') => {
    const res = await fetch(`${base}/quiz/AB12CD${q}`, { headers: { 'x-api-key': 'test-key' } });
    return { status: res.status, text: await res.text() };
  };
  try { return await fn(ask); } finally { await new Promise((r) => server.close(r)); }
}
const fresh = (o) => { Flags._resetCache(); R._resetCache(); seed(o); };

describe('the route GET /quiz/:code', () => {
  test('on: ?k=<chip> answers child_lang, and nothing else changes', async () => {
    await serve(async (ask) => {
      fresh({ langs: [{ canonical_id: KID, language: 'ur', source: 'chosen' }] });
      const plain = await ask();
      fresh({ langs: [{ canonical_id: KID, language: 'ur', source: 'chosen' }] });
      const withK = await ask(`?k=${chip(KID)}`);
      expect(withK.status).toBe(200);
      expect(JSON.parse(withK.text).child_lang).toBe('ur');
      expect(withK.text.replace(/,"child_lang":"ur"/, '')).toBe(plain.text);
    });
  });
  test.each([['off', false], ['absent', 'absent'], ['the string true', 'true']])('%s: ?k=<chip> is byte for byte the golden (no k)', async (_n, sw) => {
    await serve(async (ask) => {
      fresh({ sw, langs: [{ canonical_id: KID, language: 'ur', source: 'chosen' }] });
      const golden = await ask();
      fresh({ sw, langs: [{ canonical_id: KID, language: 'ur', source: 'chosen' }] });
      const withK = await ask(`?k=${chip(KID)}`);
      expect(withK.status).toBe(200);
      expect(withK.text).toBe(golden.text);
    });
  });
  test('on, a read error: the quiz still answers 200, without the field', async () => {
    await serve(async (ask) => {
      fresh({ langs: [{ canonical_id: KID, language: 'ur', source: 'chosen' }] });
      const from = supabase.from;
      supabase.from = (t) => { if (t === 'child_language') throw new Error('boom'); return from(t); };
      const r = await ask(`?k=${chip(KID)}`);
      expect(r.status).toBe(200);
      expect(JSON.parse(r.text)).not.toHaveProperty('child_lang');
    });
  });
});
