'use strict';
/**
 * The two WhatsApp replies that carry a child's page link after a "keep my place" code — the saved reply
 * (web-quiz-bind.service.js) and the way back (web-quiz-bind-way-back.js) — open the child's home in the child's own
 * language (app_settings web_quiz_return_lang): the hub link carries childLang() — the newest class quiz's language,
 * else the language the child joined in — and, with neither, the language the reply itself speaks. Switch off: the
 * link is byte-identical to today's (both signed at the same second). Real binder, way back, repos, token signer and
 * resolver; Supabase, Redis, the WhatsApp send and the loggers are the faked boundaries.
 */
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
const WhatsApp = require('../../../shared/services/whatsapp.service');
const IdFlags = require('../../../shared/services/quiz/web-quiz-identity-flags');
const HubFlags = require('../../../shared/services/quiz/web-quiz-hub-flags');
const Ret = require('../../../shared/services/quiz/web-quiz-return-lang');
const T = require('../../../shared/services/quiz/web-quiz-token');
const Binder = require('../../../shared/services/quiz/web-quiz-bind.service');
const WayBack = require('../../../shared/services/quiz/web-quiz-bind-way-back');
const { fixturePhone } = require('./fixture-phone');

const PHONE = fixturePhone(614);
const KID = 'f0000000-0000-4000-8000-000000000061';
const QUIZ = 'f0000000-0000-4000-8000-0000000000d1';
const SC = 'f0000000-0000-4000-8000-0000000000d2';
const BASE = 'https://portal.example.test';
// the family's own users row speaks English: only the child's own language can make the link Urdu
const USER = { id: 'u-family', registration_completed: false, registration_state: 'unregistered', name: null, role: 'teacher', preferred_language: 'en' };
const NOW_MS = Date.UTC(2026, 9, 17, 2, 0, 0);
const iso = (ms) => new Date(NOW_MS + ms).toISOString();
let fake;

/** A self-joined child (no class), the language they joined in kept on their own row (child_language); `quizLang`: one class quiz. */
function seed({ ret = true, joined = 'ur', quizLang = null } = {}) {
  const settings = [{ key: 'web_quiz_hub', value: true }, { key: 'web_quiz_identity_canon', value: true }, { key: 'web_quiz_phone_bind', value: true },
    { key: 'web_quiz_bind_way_back', value: true }];
  if (ret !== 'absent') settings.push({ key: 'web_quiz_return_lang', value: ret });
  fake = makeFake({
    app_settings: settings,
    students: [{ id: KID, student_name: 'Iqra Testwala', phone: null, list_id: null, is_active: true, status: 'active', self_reported_class: 'Grade 2', created_at: iso(-600000) }],
    child_language: joined ? [{ canonical_id: KID, language: joined, source: 'join' }] : [],
    child_bind_codes: [{ code: 'JUGNU-AB2CD', canonical_id: KID, minted_at: iso(-60000), expires_at: iso(59 * 60000), used_at: null, outcome: null, device_ref: 'AAAAAAAAAAAAAAAAAAAAAA' }],
    child_phone_bindings: [], message_ledger: [], student_lists: [], class_enrollments: [], class_teachers: [],
    quizzes: quizLang ? [{ id: QUIZ, topic: 'Fractions', grade: '2', subject: 'maths', video_id: null, language: quizLang }] : [],
    quiz_share_codes: quizLang ? [{ id: SC, code: 'AB12CD', quiz_id: QUIZ, teacher_user_id: 't1', language: quizLang, active: true, expires_at: iso(864000000), parent_share_code_id: null, invited_by_student_id: null }] : [],
    quiz_sessions: quizLang ? [{ id: 's1', quiz_id: QUIZ, share_code_id: SC, student_id: KID, status: 'completed', user_id: null, invited_by_student_id: null, created_at: iso(-3600000) }] : [],
  }, { uniques: { child_bind_codes: ['code'] } });
  supabase.from = (t) => { const b = fake.from(t); b.or = () => b; return b; };
  supabase.rpc = fake.rpc;
  fake.rpcResult = { data: null, error: { code: '42883', message: 'function message_ledger_add does not exist' } };
  IdFlags._resetCache();
  HubFlags._resetCache();
  WayBack._resetCache();
  Ret._resetCache();
  const Ledger = require('../../../shared/services/quiz/message-ledger');
  if (typeof Ledger._resetCap === 'function') Ledger._resetCap();
}
const linkUrl = () => WhatsApp.sendCtaUrl.mock.calls[WhatsApp.sendCtaUrl.mock.calls.length - 1][1].url;
const tokenOf = (url) => T.verify(url.split('/h/')[1], 'h');
// today's link for these children, signed at the same second
const todays = (ids, caller) => `${BASE}/h/${T.signHub(ids, caller)}`;

const saved = () => Binder.handleCode({ phone: PHONE, body: 'JUGNU-AB2CD', user: USER, now: new Date(NOW_MS) });
const wayBack = () => WayBack.reply({ phone: PHONE, reason: 'teacher_phone', code: 'JUGNU-AB2CD', language: 'en', now: new Date(NOW_MS) });

const SAVED = { ...process.env };
beforeEach(() => {
  process.env = { ...SAVED, STUDENT_MODE_ENABLED: 'true', WQ_TOMB_SALT: 'unit-salt-not-a-secret', WEB_QUIZ_KID_KEY: 'unit-kid-key-not-a-secret-32-bytes!!',
    WEB_QUIZ_TOKEN_SECRET: 'unit-token-secret', WEB_QUIZ_BASE_URL: BASE };
  jest.clearAllMocks();
  jest.spyOn(Date, 'now').mockReturnValue(NOW_MS);
  redis.__keys.clear();
});
afterEach(() => { jest.restoreAllMocks(); });
afterAll(() => { process.env = SAVED; });

describe('switch on: the link opens in the child\'s own language', () => {
  test('saved reply: a self-joined Urdu child, 0 quizzes, an English family row → the link carries l "ur"', async () => {
    seed();
    expect((await saved()).outcome).toBe('bound');
    expect(tokenOf(linkUrl())).toMatchObject({ k: 'h', ids: [KID], l: 'ur' });
  });

  test('way back: the same child → the button\'s link carries l "ur"', async () => {
    seed();
    expect(await wayBack()).toBe(true);
    expect(tokenOf(linkUrl())).toMatchObject({ k: 'h', ids: [KID], l: 'ur' });
  });

  test('a child with a class quiz keeps that quiz\'s language (English quiz, Urdu join → l "en")', async () => {
    seed({ quizLang: 'en' });
    expect((await saved()).outcome).toBe('bound');
    expect(tokenOf(linkUrl()).l).toBe('en');
    WhatsApp.sendCtaUrl.mockClear();
    seed({ quizLang: 'en' });
    expect(await wayBack()).toBe(true);
    expect(tokenOf(linkUrl()).l).toBe('en');
  });

  test('neither a class quiz nor a joined language: the language the reply speaks (the way back\'s "en")', async () => {
    seed({ joined: null });
    expect(await wayBack()).toBe(true);
    expect(tokenOf(linkUrl()).l).toBe('en');
  });
});

describe('switch off: today\'s link, byte for byte', () => {
  test.each([['absent', 'absent'], ['false', false], ['the string "true"', 'true']])('switch row %s → saved reply and way back links equal today\'s', async (_l, ret) => {
    seed({ ret });
    expect((await saved()).outcome).toBe('bound');
    expect(linkUrl()).toBe(todays([KID], 'bind'));
    expect(tokenOf(linkUrl())).not.toHaveProperty('l');
    seed({ ret });
    expect(await wayBack()).toBe(true);
    expect(linkUrl()).toBe(todays([KID], 'bind'));
  });
});
