'use strict';
/**
 * A child who joins on their own keeps the language they joined in (app_settings web_quiz_return_lang, JSON true only):
 * the join writes the join link's language (en|ur) on the child's own row (child_language, source 'join'), and
 * childLang() reads it back for a child with no class quiz yet. A child with a class quiz keeps that quiz's language;
 * a grown-up's choice ('chosen') outranks both. Switch off (absent, false, the string 'true'): nothing is written, the
 * identity row is today's, and childLang() reads nothing and answers null. Real join service, binder, repos and resolver; Supabase, Redis, the WhatsApp send and the
 * loggers are the faked boundaries.
 */
process.env.STUDENT_MODE_ENABLED = 'true';

jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/services/cache/railway-redis.service', () => {
  const keys = new Map();
  return {
    __keys: keys,
    get: jest.fn(async (k) => (keys.has(k) ? keys.get(k) : null)),
    set: jest.fn(async (k, v) => { keys.set(k, v); return true; }),
    setNX: jest.fn(async (k, v) => { if (keys.has(k)) return false; keys.set(k, v); return true; }),
    delete: jest.fn(async (k) => keys.delete(k)),
    incr: jest.fn(async (k) => { const v = (Number(keys.get(k)) || 0) + 1; keys.set(k, v); return v; }),
    expire: jest.fn(async () => true),
    isAvailable: () => true,
    redis: { get: jest.fn(async (k) => (keys.has(k) ? JSON.stringify(keys.get(k)) : null)) },
  };
});
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('../../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(async () => true), sendCtaUrl: jest.fn(async () => true), sendInteractiveButtons: jest.fn(async () => true),
  sendFlow: jest.fn(async () => false), sendReaction: jest.fn(async () => true),
}));

const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const redis = require('../../../shared/services/cache/railway-redis.service');
const { logToFile } = require('../../../shared/utils/logger');
const IdFlags = require('../../../shared/services/quiz/web-quiz-identity-flags');
const HubFlags = require('../../../shared/services/quiz/web-quiz-hub-flags');
const Ret = require('../../../shared/services/quiz/web-quiz-return-lang');
const GoNonce = require('../../../shared/services/first-touch/go-nonce');
const Join = require('../../../shared/services/quiz/web-quiz-student-join');
const { fixturePhone } = require('./fixture-phone');

const PHONE = fixturePhone(731);
const DEVICE = 'AAAAAAAAAAAAAAAAAAAAAA';
const USER = { id: 'u-new', registration_completed: false, registration_state: 'unregistered', name: null,
  teacher_uuid: null, school_id: null, portal_activated: false, role: 'teacher', preferred_language: 'en' };
// today's identity row: exactly these columns (child_identity.sql), nothing else
const TODAY_KEYS = ['canonical_id', 'year_code', 'fixed_grade', 'grade_source', 'fixed_at'];
const CL = () => ({ ...require('../../../shared/services/quiz/child-language.repo'), ...require('../../../shared/services/quiz/web-quiz-child-lang') });

let fake;
function seed(ret) {
  const settings = { web_quiz_hub: true, web_quiz_identity_canon: true, web_quiz_phone_bind: true, quiz_student_join: true };
  if (ret !== undefined) settings.web_quiz_return_lang = ret;
  fake = makeFake({
    app_settings: Object.entries(settings).map(([key, value]) => ({ key, value })),
    users: [USER], students: [], child_phone_bindings: [], child_identity: [], child_language: [], user_feature_first_use: [],
    quiz_sessions: [], quiz_share_codes: [], class_enrollments: [], student_lists: [], class_teachers: [], quizzes: [], coaching_sessions: [],
    lesson_plans: [], training_assessment_attempts: [], assessment_requests: [], message_ledger: [],
  }, { uniques: { child_language: ['canonical_id'] } });
  supabase.from = (t) => {
    if (t === 'students') (fake.db.students || []).forEach((r) => { if (!('is_active' in r)) r.is_active = true; if (!('status' in r)) r.status = 'active'; });
    const b = fake.from(t);
    b.or = () => b;
    b.upsert = (row) => b.insert(row);
    // child_language's upsert on its primary key (the grown-up's choice): an update when the child has a row
    if (t === 'child_language') b.upsert = (row) => upsertLang(row);
    return b;
  };
  supabase.rpc = fake.rpc;
  fake.rpcResult = { data: null, error: { code: '42883', message: 'absent' } };
  IdFlags._resetCache();
  HubFlags._resetCache();
  Join._resetCache();
  Ret._resetCache();
}
function upsertLang(row) {
  const at = fake.db.child_language.findIndex((r) => r.canonical_id === row.canonical_id);
  fake.calls.push({ table: 'child_language', op: 'upsert', payload: [row] });
  if (at >= 0) Object.assign(fake.db.child_language[at], row);
  else fake.db.child_language.push({ ...row });
  return Promise.resolve({ data: null, error: null });
}
const identityInserts = () => fake.calls.filter((c) => c.table === 'child_identity' && c.op === 'insert').map((c) => c.payload).flat();
const langWrites = () => fake.calls.filter((c) => c.table === 'child_language' && c.op !== 'select');
const reads = (table) => fake.calls.filter((c) => c.table === table && c.op === 'select');

async function joinIn(lang, name = 'Sara Testwala') {
  const n = await GoNonce.mint({ phoneNorm: PHONE, userId: USER.id });
  const t = Join.signJoin({ n, lang });
  const out = await Join.join({ t, grade: 2, name, device: DEVICE });
  expect(out.next).toMatch(/^\/h\//);
  return String(fake.db.students[fake.db.students.length - 1].id);
}

const SAVED = { ...process.env };
beforeEach(() => {
  process.env = { ...SAVED, STUDENT_MODE_ENABLED: 'true', WQ_TOMB_SALT: 'unit-salt-not-a-secret', WEB_QUIZ_KID_KEY: 'unit-kid-key-not-a-secret',
    WEB_QUIZ_TOKEN_SECRET: 'unit-token-secret', WEB_QUIZ_BASE_URL: 'https://portal.example.test' };
  jest.clearAllMocks();
  redis.__keys.clear();
  seed(true);
});
afterAll(() => { process.env = SAVED; });

describe('switch on: the join keeps the language on the child', () => {
  test('an Urdu join link → child_language {ur, join}; the identity row is today\'s; childLang() → "ur" with 0 quizzes', async () => {
    const kid = await joinIn('ur');
    expect(fake.db.child_language).toEqual([expect.objectContaining({ canonical_id: kid, language: 'ur', source: 'join' })]);
    expect(Object.keys(identityInserts()[0]).sort()).toEqual([...TODAY_KEYS].sort());
    expect(await CL().childLang(kid)).toBe('ur');
  });

  test('an English join link → "en"', async () => {
    const kid = await joinIn('en');
    expect(fake.db.child_language[0]).toMatchObject({ language: 'en', source: 'join' });
    expect(await CL().childLang(kid)).toBe('en');
  });

  test('a child with a class quiz keeps that quiz\'s language over the one they joined in', async () => {
    const kid = await joinIn('ur');
    fake.db.quizzes.push({ id: 'q-1', topic: 'Shapes', subject: 'Maths', language: 'en', grade: '2', video_id: null });
    fake.db.quiz_share_codes.push({ id: 'sc-1', code: 'SHAP01', quiz_id: 'q-1', active: true, language: 'en', parent_share_code_id: null, invited_by_student_id: null, created_at: new Date().toISOString() });
    fake.db.quiz_sessions.push({ id: 's1', share_code_id: 'sc-1', quiz_id: 'q-1', student_id: kid, status: 'completed', created_at: new Date().toISOString() });
    expect(await CL().childLang(kid)).toBe('en');
  });

  test('a grown-up\'s choice outranks the class quiz; choose() is the one update', async () => {
    const kid = await joinIn('en');
    fake.db.quizzes.push({ id: 'q-1', topic: 'Shapes', subject: 'Maths', language: 'en', grade: '2', video_id: null });
    fake.db.quiz_share_codes.push({ id: 'sc-1', code: 'SHAP01', quiz_id: 'q-1', active: true, language: 'en', parent_share_code_id: null, invited_by_student_id: null, created_at: new Date().toISOString() });
    fake.db.quiz_sessions.push({ id: 's1', share_code_id: 'sc-1', quiz_id: 'q-1', student_id: kid, status: 'completed', created_at: new Date().toISOString() });
    expect(await CL().choose(kid, 'ur')).toBe(true);
    expect(fake.db.child_language).toEqual([expect.objectContaining({ canonical_id: kid, language: 'ur', source: 'chosen' })]);
    expect(await CL().childLang(kid)).toBe('ur');
    expect(await CL().chosenOf(['f0000000-0000-4000-8000-0000000000ff', kid])).toBe('ur');
    // a second join write never overwrites a choice
    expect(await CL().joined(kid, 'en')).toBe(false);
    expect(fake.db.child_language[0]).toMatchObject({ language: 'ur', source: 'chosen' });
  });

  test('a library lesson code is not the child\'s language: an Urdu joiner who only watched an English lesson stays "ur"', async () => {
    const kid = await joinIn('ur');
    fake.db.quizzes.push({ id: 'q-2', topic: 'Plants', subject: 'Science', language: 'en', grade: '2', video_id: 'v1' });
    fake.db.quiz_share_codes.push({ id: 'sc-2', code: 'LESS01', quiz_id: 'q-2', active: true, language: 'en', parent_share_code_id: 'sc-root', invited_by_student_id: null, created_at: new Date().toISOString() });
    fake.db.quiz_sessions.push({ id: 's2', share_code_id: 'sc-2', quiz_id: 'q-2', student_id: kid, status: 'completed', created_at: new Date().toISOString() });
    expect(await CL().childLang(kid)).toBe('ur');
  });

  test('one request resolves a child once (memo); a read error is null and logs no id', async () => {
    const kid = await joinIn('ur');
    const memo = new Map();
    expect(await CL().childLang(kid, { memo })).toBe('ur');
    const before = reads('child_language').length;
    expect(await CL().childLang(kid, { memo })).toBe('ur');
    expect(reads('child_language').length).toBe(before);
    const from = supabase.from;
    supabase.from = (t) => (t === 'child_language'
      ? new Proxy({}, { get: (_, k) => (k === 'then' ? (res) => res({ data: null, error: { code: '42P01', message: 'relation "child_language" does not exist' } }) : () => supabase.from(t)) })
      : from(t));
    expect(await CL().childLang(kid)).toBeNull();
    expect(await CL().choose(kid, 'ur')).toBe(false);
    expect(JSON.stringify(logToFile.mock.calls)).not.toContain(kid);
    expect(JSON.stringify(logToFile.mock.calls)).not.toContain(PHONE);
  });
});

describe('switch on before the table exists (the migration not yet applied)', () => {
  test('the join goes on and the child\'s identity row is written; nothing is kept; childLang() null', async () => {
    const from = supabase.from;
    const missing = new Proxy({}, { get: (_, k) => (k === 'then' ? (res) => res({ data: null, error: { code: '42P01', message: 'relation "child_language" does not exist' } }) : () => missing) });
    supabase.from = (t) => (t === 'child_language' ? missing : from(t));
    const kid = await joinIn('ur');
    expect(fake.db.child_identity).toEqual([expect.objectContaining({ canonical_id: kid, fixed_grade: 2, grade_source: 'tapped' })]);
    expect(await CL().childLang(kid)).toBeNull();
  });
});

describe('switch off: nothing kept, today\'s identity row, and nothing read', () => {
  test.each([['absent', undefined], ['false', false], ['the string "true"', 'true'], ['the JSON string "\\"true\\""', '"true"']])('switch row %s → 0 child_language calls; childLang()/stored()/chosenOf()/choose() null or false', async (_l, value) => {
    seed(value);
    const kid = await joinIn('ur');
    expect(Object.keys(identityInserts()[0]).sort()).toEqual([...TODAY_KEYS].sort());
    expect(await CL().childLang(kid)).toBeNull();
    expect(await CL().stored(kid)).toBeNull();
    expect(await CL().chosenOf([kid])).toBeNull();
    expect(await CL().choose(kid, 'ur')).toBe(false);
    expect(fake.calls.filter((c) => c.table === 'child_language')).toEqual([]);
    expect(langWrites()).toEqual([]);
  });
});

describe('with the join\'s one switch read on (quiz_join_fast): the child\'s language switch rides that read', () => {
  // every app_settings read the join makes, by the keys it asks for (`.eq('key', …)` or `.in('key', […])`)
  function settingsReads() {
    const asked = [];
    const from = supabase.from;
    supabase.from = (t) => {
      const b = from(t);
      if (t !== 'app_settings') return b;
      const eq = b.eq; const inn = b.in;
      b.eq = (c, v) => { if (c === 'key') asked.push([v]); return eq.call(b, c, v); };
      b.in = (c, vs) => { if (c === 'key') asked.push([...vs]); return inn.call(b, c, vs); };
      return b;
    };
    return asked;
  }
  function fast(ret) {
    seed(ret);
    fake.db.app_settings.push({ key: 'quiz_join_fast', value: true });
    return settingsReads();
  }

  test('an English join link → child_language {en, join}; web_quiz_return_lang is read only inside the join\'s one read', async () => {
    const asked = fast(true);
    const kid = await joinIn('en');
    expect(fake.db.child_language).toEqual([expect.objectContaining({ canonical_id: kid, language: 'en', source: 'join' })]);
    expect(asked.filter((keys) => keys.includes('web_quiz_return_lang'))).toEqual([expect.arrayContaining(['quiz_join_fast', 'web_quiz_return_lang'])]);
  });

  test.each([['absent', undefined], ['false', false], ['the string "true"', 'true']])('switch row %s → nothing kept and no read of its own', async (_l, value) => {
    const asked = fast(value);
    await joinIn('en');
    expect(fake.calls.filter((c) => c.table === 'child_language')).toEqual([]);
    expect(asked.filter((keys) => keys.length === 1 && keys[0] === 'web_quiz_return_lang')).toEqual([]);
  });
});
