'use strict';
/**
 * The binding funnel's server events carry the v2 envelope (EVENTS §4): with web_quiz_events_v2 on, bind_confirm
 * (the page's mint: dk + kid), bind_bound, bind_refused (kid null for code_unknown / child_unknown) and bind_undo
 * (per child, the binder's STOP and the page's undo) carry {w:'s', ev_v:2, kid_v, kid} — a keyed child key, never a
 * phone, a code or a session id — so a dcount(kid) over 'web_quiz.bind_' counts children. With the switch off every
 * event is today's, byte for byte. Real binder, real page module, real repos; Supabase, Redis, the WhatsApp send and
 * the loggers are the faked boundaries; the switch module and the canonical-id helper are faked for the page path.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/services/cache/railway-redis.service', () => {
  const keys = new Map();
  return {
    __keys: keys,
    _store: keys,
    get: jest.fn(async (k) => (keys.has(k) ? keys.get(k) : null)),
    set: jest.fn(async (k, v) => { keys.set(k, v); return true; }),
    setNX: jest.fn(async (k, v) => { if (keys.has(k)) return false; keys.set(k, v); return true; }),
    delete: jest.fn(async (k) => keys.delete(k)),
    incr: jest.fn(async (k) => { const v = (Number(keys.get(k)) || 0) + 1; keys.set(k, v); return v; }),
    expire: jest.fn(async () => true),
    isAvailable: () => true,
  };
});
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('../../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(async () => true), sendCtaUrl: jest.fn(async () => true), sendInteractiveButtons: jest.fn(async () => true),
  sendFlow: jest.fn(async () => false), sendReaction: jest.fn(async () => true),
}));
jest.mock('../../../shared/services/quiz/web-quiz-identity-roster', () => ({
  ...jest.requireActual('../../../shared/services/quiz/web-quiz-identity-roster'),
  canonicalStudentId: jest.fn(async (id) => id),
  canonicalStudentIds: jest.fn(async (ids) => new Map((ids || []).map((id) => [String(id), String(id)]))),
}));
jest.mock('openchemlib', () => require('../../../../tests/__mocks__/openchemlib.js'));

const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const redis = require('../../../shared/services/cache/railway-redis.service');
const { logEvent } = require('../../../shared/utils/structured-logger');
const IdFlags = require('../../../shared/services/quiz/web-quiz-identity-flags');
const HubFlags = require('../../../shared/services/quiz/web-quiz-hub-flags');
const K = require('../../../shared/services/quiz/web-quiz-kid');
const T = require('../../../shared/services/quiz/web-quiz-token');
const Binder = require('../../../shared/services/quiz/web-quiz-bind.service');
const Page = require('../../../shared/services/quiz/web-quiz-bind-page');
const Hub = require('../../../shared/services/quiz/web-quiz-hub');
const { fixturePhone } = require('./fixture-phone');

const PHONE = fixturePhone(612);
const KID = 'f0000000-0000-4000-8000-000000000011';
const SIB = 'f0000000-0000-4000-8000-000000000012';
const LIST = 'f0000000-0000-4000-8000-0000000000aa';
const DEV = 'AAAAAAAAAAAAAAAAAAAAAA';
const KEY = 'unit-kid-key-not-a-secret-32-bytes!!';
const USER = { id: 'u-family', registration_completed: false, registration_state: 'unregistered', name: null, role: 'teacher', preferred_language: 'en' };
const iso = (ms) => new Date(Date.now() + ms).toISOString();
const student = (id, name) => ({ id, student_name: name, phone: null, list_id: LIST, is_active: true, status: 'active', self_reported_class: '3', created_at: iso(-600000) });
const code = (c, kid) => ({ code: c, canonical_id: kid, minted_at: iso(-60000), expires_at: iso(59 * 60000), used_at: null, outcome: null });
const binding = (kid, extra = {}) => ({ id: `b-${kid.slice(-2)}`, canonical_id: kid, phone_norm: PHONE, phone_tomb: 'tomb', via: 'save', bound_at: iso(-86400000),
  confirmed_at: iso(-86400000), last_played_at: null, expires_at: '2027-03-31T18:59:59.000Z', revoked_at: null, revoked_by: null, rebind_of: null, code_id: null, ...extra });
let fake;

function seed({ eventsV2, students = [], codes = [], bindings = [] }) {
  fake = makeFake({
    app_settings: [{ key: 'web_quiz_hub', value: true }, { key: 'web_quiz_identity_canon', value: true }, { key: 'web_quiz_phone_bind', value: true },
      { key: 'web_quiz_events_v2', value: eventsV2 }, { key: 'web_quiz_challenge', value: true }],
    students, child_bind_codes: codes, child_phone_bindings: bindings, message_ledger: [],
    student_lists: [{ id: LIST, user_id: 't1', class_name: '3', section: 'A', is_active: true }],
    quiz_sessions: [], class_enrollments: [], class_teachers: [], quiz_share_codes: [], quizzes: [], student_videos: [], web_quiz_challenge_runs: [],
  }, { uniques: { child_bind_codes: ['code'] } });
  supabase.from = (t) => { const b = fake.from(t); b.or = () => b; return b; };
  supabase.rpc = fake.rpc;
  fake.rpcResult = { data: null, error: { code: '42883', message: 'function message_ledger_add does not exist' } };
  IdFlags._resetCache();
  HubFlags._resetCache();
  Hub._resetCache();
  const Ledger = require('../../../shared/services/quiz/message-ledger');
  if (typeof Ledger._resetCap === 'function') Ledger._resetCap();
}
const events = (name) => logEvent.mock.calls.filter(([n]) => n === name).map(([, d]) => d);
const flat = () => JSON.stringify(logEvent.mock.calls);
const hubOf = (ids) => T.sign({ k: 'h', ids, exp: 2000000000 });
const chip = (id) => T.chipId('h', id);

const SAVED = { ...process.env };
beforeEach(() => {
  process.env = { ...SAVED, STUDENT_MODE_ENABLED: 'true', WQ_TOMB_SALT: 'unit-salt-not-a-secret', WEB_QUIZ_KID_KEY: KEY, WEB_QUIZ_KID_KEY_V: '2026',
    WEB_QUIZ_TOKEN_SECRET: 'unit-token-secret', WEB_QUIZ_BASE_URL: 'https://portal.example.test', WHATSAPP_BOT_NUMBER: '+92 000 0000000' };
  jest.clearAllMocks();
  redis.__keys.clear();
  K._reset();
});
afterAll(() => { process.env = SAVED; });

describe('web_quiz_events_v2 ON: the binding events carry the envelope', () => {
  test('bind_bound: {w, ev_v, kid_v, kid} beside via/kids_n/renewed/rebind; no phone, code or session id', async () => {
    seed({ eventsV2: true, students: [student(KID, 'Ayesha Testwala')], codes: [code('JUGNU-AB2CD', KID)] });
    expect((await Binder.handleCode({ phone: PHONE, body: 'JUGNU-AB2CD', user: USER })).outcome).toBe('bound');
    expect(events('web_quiz.bind_bound')).toEqual([{ w: 's', ev_v: 2, kid_v: '2026', kid: K.kid(KID), via: 'save', kids_n: 1, renewed: false, rebind: false }]);
    expect(flat()).not.toContain(PHONE);
    expect(flat()).not.toContain('JUGNU-AB2CD');
  });

  test('bind_refused: max_kids carries the kid and kids_n; code_unknown carries kid null', async () => {
    const four = ['f0000000-0000-4000-8000-000000000021', 'f0000000-0000-4000-8000-000000000022', 'f0000000-0000-4000-8000-000000000023', 'f0000000-0000-4000-8000-000000000024'];
    seed({ eventsV2: true, students: [student(KID, 'Ayesha Testwala'), ...four.map((k, i) => student(k, `Child${i} Testwala`))], codes: [code('JUGNU-AB2CD', KID)],
      bindings: four.map((k) => binding(k)) });
    expect((await Binder.handleCode({ phone: PHONE, body: 'JUGNU-AB2CD', user: USER })).reason).toBe('max_kids');
    expect(events('web_quiz.bind_refused')).toEqual([{ w: 's', ev_v: 2, kid_v: '2026', kid: K.kid(KID), reason: 'max_kids', kids_n: 4 }]);
    logEvent.mockClear();
    expect((await Binder.handleCode({ phone: PHONE, body: 'JUGNU-ZZZZZ', user: USER })).reason).toBe('code_unknown');
    expect(events('web_quiz.bind_refused')).toEqual([{ w: 's', ev_v: 2, kid_v: '2026', kid: null, reason: 'code_unknown' }]);
  });

  test('bind_undo on STOP: one event per child, each with its kid', async () => {
    seed({ eventsV2: true, students: [student(KID, 'Ayesha Testwala'), student(SIB, 'Bilal Testwala')], bindings: [binding(KID), binding(SIB)] });
    expect(await Binder.handleStop({ phone: PHONE, user: USER, persona: 'student' })).toEqual({ n: 2, children: 2 });
    expect(events('web_quiz.bind_undo')).toEqual([
      { w: 's', ev_v: 2, kid_v: '2026', kid: K.kid(KID), via: 'stop', n: 1, audio_n: 0 },
      { w: 's', ev_v: 2, kid_v: '2026', kid: K.kid(SIB), via: 'stop', n: 1, audio_n: 0 },
    ]);
    expect(flat()).not.toContain(PHONE);
  });

  test('bind_confirm (the page mint over the real repo): dk + kid; bind_undo on the page undo: kid', async () => {
    seed({ eventsV2: true, students: [student(KID, 'Ayesha Testwala')] });
    const out = await Page.mint({ hub: hubOf([KID]), kid: chip(KID), device: DEV, lang: 'en' });
    expect(out.ok).toBe(true);
    expect(events('web_quiz.bind_confirm')).toEqual([{ w: 's', ev_v: 2, kid_v: '2026', kid: K.kid(KID), dk: K.dk(DEV) }]);
    expect(flat()).not.toContain(DEV);
    expect(flat()).not.toContain(out.code);
    // the family sends it, the binder binds it, the page undoes the one binding this code made
    expect((await Binder.handleCode({ phone: PHONE, body: `keep my place ${out.code}`, user: USER })).outcome).toBe('bound');
    logEvent.mockClear();
    expect(await Page.undo({ code: out.code })).toEqual({ ok: true });
    expect(events('web_quiz.bind_undo')).toEqual([{ w: 's', ev_v: 2, kid_v: '2026', kid: K.kid(KID), via: 'page', n: 1 }]);
  });
});

describe('golden: web_quiz_events_v2 OFF: today\'s events, byte for byte', () => {
  test('bind_bound, bind_refused, bind_undo (STOP) and the page\'s bind_confirm / bind_undo have no envelope', async () => {
    seed({ eventsV2: false, students: [student(KID, 'Ayesha Testwala'), student(SIB, 'Bilal Testwala')], codes: [code('JUGNU-AB2CD', KID)] });
    await Binder.handleCode({ phone: PHONE, body: 'JUGNU-AB2CD', user: USER });
    expect(events('web_quiz.bind_bound')).toEqual([{ via: 'save', kids_n: 1, renewed: false, rebind: false, w: 's' }]);
    await Binder.handleCode({ phone: PHONE, body: 'JUGNU-ZZZZZ', user: USER });
    expect(events('web_quiz.bind_refused')).toEqual([{ reason: 'code_unknown', w: 's' }]);
    const out = await Page.mint({ hub: hubOf([SIB]), kid: chip(SIB), device: DEV, lang: 'en' });
    expect(events('web_quiz.bind_confirm')).toEqual([{ w: 's' }]);
    await Binder.handleCode({ phone: PHONE, body: `keep my place ${out.code}`, user: USER });
    logEvent.mockClear();
    expect(await Page.undo({ code: out.code })).toEqual({ ok: true });
    expect(events('web_quiz.bind_undo')).toEqual([{ w: 's', via: 'page', n: 1 }]);
    logEvent.mockClear();
    await Binder.handleStop({ phone: PHONE, user: USER, persona: 'student' });
    expect(events('web_quiz.bind_undo')).toEqual([{ via: 'stop', n: 1, audio_n: 0, w: 's' }]);
  });
});
