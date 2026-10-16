'use strict';
/**
 * The binder's ONE reply is in the language the family wrote in (web-quiz-bind.service.js): the page's prefill is a
 * fixed Urdu or English line before the code (web-quiz-bind-page.js PREFILL), so a parent who tapped the Urdu card
 * reads an Urdu confirmation even when the child's class quiz is in English. A bare code (no prefill) keeps today's
 * order: the child's quiz language, else the user's, else English. Real binder, real repos; Supabase, Redis, the
 * WhatsApp send and the loggers are the faked boundaries.
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
const { resolveUx } = require('../../../shared/config/ux-strings');
const IdFlags = require('../../../shared/services/quiz/web-quiz-identity-flags');
const HubFlags = require('../../../shared/services/quiz/web-quiz-hub-flags');
const Binder = require('../../../shared/services/quiz/web-quiz-bind.service');
const { fixturePhone } = require('./fixture-phone');

const PHONE = fixturePhone(613);
const KID = 'f0000000-0000-4000-8000-000000000031';
const LIST = 'f0000000-0000-4000-8000-0000000000bb';
const QUIZ = 'f0000000-0000-4000-8000-0000000000c1';
const SC = 'f0000000-0000-4000-8000-0000000000c2';
const USER = { id: 'u-family', registration_completed: false, registration_state: 'unregistered', name: null, role: 'teacher', preferred_language: 'en' };
const UR_PREFILL = 'جگنو ✨ میری جگہ محفوظ کریں';
const EN_PREFILL = 'Jugnu ✨ keep my place';
const iso = (ms) => new Date(Date.now() + ms).toISOString();
let fake;

// the child's class quiz is in `quizLang`: that is what languageFor() reads today
function seed({ quizLang = 'en', codes = ['JUGNU-AB2CD', 'JUGNU-AB2CE'], bindings = [] } = {}) {
  fake = makeFake({
    app_settings: [{ key: 'web_quiz_hub', value: true }, { key: 'web_quiz_identity_canon', value: true }, { key: 'web_quiz_phone_bind', value: true }],
    students: [{ id: KID, student_name: 'Iqra Testwala', phone: null, list_id: LIST, is_active: true, status: 'active', self_reported_class: '3', created_at: iso(-600000) },
      ...bindings.map((b, i) => ({ id: b.canonical_id, student_name: `Child${i} Testwala`, phone: null, list_id: LIST, is_active: true, status: 'active', self_reported_class: '3', created_at: iso(-600000) }))],
    child_bind_codes: codes.map((c) => ({ code: c, canonical_id: KID, minted_at: iso(-60000), expires_at: iso(59 * 60000), used_at: null, outcome: null })),
    child_phone_bindings: bindings, message_ledger: [],
    student_lists: [{ id: LIST, user_id: 't1', class_name: '3', section: 'A', is_active: true }],
    quizzes: [{ id: QUIZ, topic: 'Fractions', grade: '3', subject: 'maths', quiz_source: 'transcript', video_id: null, language: quizLang }],
    quiz_share_codes: [{ id: SC, code: 'AB12CD', quiz_id: QUIZ, teacher_user_id: 't1', language: quizLang, active: true, expires_at: iso(864000000) }],
    quiz_sessions: [{ id: 's1', quiz_id: QUIZ, share_code_id: SC, student_id: KID, status: 'completed', user_id: null, invited_by_student_id: null, created_at: iso(-3600000), language: quizLang }],
    class_enrollments: [], class_teachers: [],
  }, { uniques: { child_bind_codes: ['code'] } });
  supabase.from = (t) => { const b = fake.from(t); b.or = () => b; return b; };
  supabase.rpc = fake.rpc;
  fake.rpcResult = { data: null, error: { code: '42883', message: 'function message_ledger_add does not exist' } };
  IdFlags._resetCache();
  HubFlags._resetCache();
  const Ledger = require('../../../shared/services/quiz/message-ledger');
  if (typeof Ledger._resetCap === 'function') Ledger._resetCap();
}
const binding = (kid) => ({ id: `b-${kid.slice(-2)}`, canonical_id: kid, phone_norm: PHONE, phone_tomb: 'tomb', via: 'save', bound_at: iso(-86400000),
  confirmed_at: iso(-86400000), last_played_at: null, expires_at: '2027-03-31T18:59:59.000Z', revoked_at: null, revoked_by: null, rebind_of: null, code_id: null });
const savedBody = () => WhatsApp.sendCtaUrl.mock.calls[0][1].body;
const textBody = () => WhatsApp.sendMessage.mock.calls[0][1];
const saved = (language) => resolveUx('jugnuBindSaved', { language, params: { name: 'Iqra' } });

const SAVED = { ...process.env };
beforeEach(() => {
  process.env = { ...SAVED, STUDENT_MODE_ENABLED: 'true', WQ_TOMB_SALT: 'unit-salt-not-a-secret', WEB_QUIZ_KID_KEY: 'unit-kid-key-not-a-secret-32-bytes!!',
    WEB_QUIZ_TOKEN_SECRET: 'unit-token-secret', WEB_QUIZ_BASE_URL: 'https://portal.example.test' };
  jest.clearAllMocks();
  redis.__keys.clear();
});
afterAll(() => { process.env = SAVED; });

describe('the reply is in the language the family wrote', () => {
  test('the Urdu prefill from a child whose class quiz is English -> the saved reply in Urdu, byte for byte', async () => {
    seed({ quizLang: 'en' });
    expect((await Binder.handleCode({ phone: PHONE, body: `${UR_PREFILL} JUGNU-AB2CD`, user: USER })).outcome).toBe('bound');
    expect(savedBody()).toBe(saved('ur'));
    expect(savedBody()).not.toBe(saved('en'));
  });

  test('the English prefill from a child whose class quiz is Urdu -> the saved reply in English', async () => {
    seed({ quizLang: 'ur' });
    expect((await Binder.handleCode({ phone: PHONE, body: `${EN_PREFILL} JUGNU-AB2CD`, user: USER })).outcome).toBe('bound');
    expect(savedBody()).toBe(saved('en'));
  });

  test('a bare code keeps today\'s order: the child\'s quiz language (Urdu here)', async () => {
    seed({ quizLang: 'ur' });
    expect((await Binder.handleCode({ phone: PHONE, body: 'JUGNU-AB2CD', user: USER })).outcome).toBe('bound');
    expect(savedBody()).toBe(saved('ur'));
  });

  test('the refusal reply too: the Urdu prefill on a full phone -> the full-phone line in Urdu', async () => {
    const four = ['f0000000-0000-4000-8000-000000000041', 'f0000000-0000-4000-8000-000000000042', 'f0000000-0000-4000-8000-000000000043', 'f0000000-0000-4000-8000-000000000044'];
    seed({ quizLang: 'en', bindings: four.map(binding) });
    expect((await Binder.handleCode({ phone: PHONE, body: `${UR_PREFILL} JUGNU-AB2CD`, user: USER })).reason).toBe('max_kids');
    expect(textBody()).toBe(resolveUx('jugnuBindFullRefused', { language: 'ur' }));
  });
});
