'use strict';
/**
 * "Keep my place" way back through its real seams: web-quiz-bind-way-back.js runs over the REAL code table repo
 * (child-bind-codes.repo.js) and the REAL bindings repo (child-phone-bindings.repo.js) on the shared fake Supabase, so
 * the rows the repos return are the rows the module reads. Faked: Supabase (in-memory, applies filters), the loggers,
 * the identity switches, the chat-children lookup, the canonical-id helper, the ledger and the WhatsApp send.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('../../../shared/services/quiz/web-quiz-identity-flags', () => ({ flags: jest.fn(async () => ({ canon: true, phoneBind: true })) }));
jest.mock('../../../shared/services/student-mode.service', () => ({ quizStudentsForPhone: jest.fn(async () => []) }));
jest.mock('../../../shared/services/quiz/web-quiz-identity-roster', () => ({
  canonicalStudentIds: jest.fn(async (ids) => new Map((ids || []).map((id) => [String(id), String(id)]))),
}));
jest.mock('../../../shared/services/quiz/message-ledger', () => ({ record: jest.fn(async () => true) }));
jest.mock('../../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(async () => true),
  sendCtaUrl: jest.fn(async () => true),
}));
jest.mock('openchemlib', () => require('../../../../tests/__mocks__/openchemlib.js'));

const { makeFake } = require('./fake-supabase');
const { fixturePhone } = require('./fixture-phone');
const supabase = require('../../../shared/config/supabase');
const Codes = require('../../../shared/services/quiz/child-bind-codes.repo');
const Bindings = require('../../../shared/services/quiz/child-phone-bindings.repo');
const Ledger = require('../../../shared/services/quiz/message-ledger');
const WhatsApp = require('../../../shared/services/whatsapp.service');
const HubFlags = require('../../../shared/services/quiz/web-quiz-hub-flags');
const T = require('../../../shared/services/quiz/web-quiz-token');
const WayBack = require('../../../shared/services/quiz/web-quiz-bind-way-back');

const KID = 'c0000001-0000-4000-8000-000000000001';
const DEV = 'AAAAAAAAAAAAAAAAAAAAAA';
const PHONE = fixturePhone(612);
const NOW = new Date();
const iso = (ms) => new Date(ms).toISOString();
const codeRow = (extra = {}) => ({ code: 'JUGNU-AB2CD', canonical_id: KID, device_ref: DEV, minted_at: iso(NOW.getTime() - 60000),
  expires_at: iso(NOW.getTime() + 59 * 60000), used_at: null, outcome: null, ...extra });
const bindingRow = (extra = {}) => ({ id: 'b-1', canonical_id: KID, phone_norm: Bindings.normalisePhone(PHONE), phone_tomb: 'tomb', via: 'save',
  confirmed_at: iso(NOW.getTime() - 3600000), bound_at: iso(NOW.getTime() - 3600000), last_played_at: null,
  expires_at: iso(NOW.getTime() + 86400000 * 30), revoked_at: null, revoked_by: null, rebind_of: null, code_id: 'JUGNU-AB2CD', ...extra });

let fake;
function seed({ codes = [], bindings = [], students = [] } = {}) {
  fake = makeFake({
    app_settings: [{ key: 'web_quiz_bind_way_back', value: true }, { key: 'web_quiz_hub', value: true }],
    child_bind_codes: codes, child_phone_bindings: bindings, students,
  }, { uniques: { child_bind_codes: ['code'] } });
  supabase.from = (t) => fake.from(t);
  supabase.rpc = fake.rpc;
}

const SAVED = { ...process.env };
beforeEach(() => {
  jest.clearAllMocks();
  process.env = { ...SAVED, WQ_TOMB_SALT: 'seam-salt-not-a-secret', WEB_QUIZ_TOKEN_SECRET: 'way-back-seam-secret',
    WEB_QUIZ_BASE_URL: 'https://portal.example.test' };
  WayBack._resetCache();
  HubFlags._resetCache();
  seed();
});
afterAll(() => { process.env = SAVED; });

describe('the way back over the real code and bindings repos', () => {
  test('reply with only the code: the real code repo reads the row, and the button opens that child\'s page', async () => {
    seed({ codes: [codeRow({ used_at: iso(NOW.getTime() - 1000), outcome: 'teacher_phone' })] });
    expect(await WayBack.reply({ phone: PHONE, reason: 'teacher_phone', code: 'JUGNU-AB2CD', language: 'en', now: NOW })).toBe(true);
    expect((await Codes.get('JUGNU-AB2CD')).canonical_id).toBe(KID);
    expect(fake.calls.some((c) => c.table === 'child_bind_codes')).toBe(true);
    const [[, cta]] = WhatsApp.sendCtaUrl.mock.calls;
    expect(cta.url.startsWith('https://portal.example.test/h/')).toBe(true);
    expect(T.verify(cta.url.split('/h/')[1], 'h').ids).toEqual([KID]);
  });

  test('reply for a code the real repo does not know: the line alone, no button', async () => {
    expect(await WayBack.reply({ phone: PHONE, reason: 'code_unknown', code: 'JUGNU-ZZ9ZZ', language: 'en', now: NOW })).toBe(true);
    expect(WhatsApp.sendCtaUrl).not.toHaveBeenCalled();
    expect(WhatsApp.sendMessage).toHaveBeenCalledTimes(1);
  });

  test('cardState: a bound code whose binding the real bindings repo still holds → bound; revoked → none', async () => {
    seed({ codes: [codeRow({ used_at: iso(NOW.getTime() - 1000), outcome: 'bound' })], bindings: [bindingRow()] });
    expect(await WayBack.cardState({ canonicalId: KID, device: DEV, now: NOW })).toEqual({ state: 'bound' });
    seed({ codes: [codeRow({ used_at: iso(NOW.getTime() - 1000), outcome: 'bound' })],
      bindings: [bindingRow({ phone_norm: null, revoked_at: iso(NOW.getTime() - 500), revoked_by: 'family' })] });
    expect(await WayBack.cardState({ canonicalId: KID, device: DEV, now: NOW })).toEqual({ state: 'none' });
  });

  test('cardState: a live code from the real code table → pending', async () => {
    seed({ codes: [codeRow()] });
    expect(await WayBack.cardState({ canonicalId: KID, device: DEV, now: NOW })).toEqual({ state: 'pending' });
  });

  test('alreadySaved: the real bindings repo finds this phone\'s active place → the saved reply with the phone\'s children', async () => {
    seed({ bindings: [bindingRow()], students: [{ id: KID, student_name: 'Ayesha Testwala', self_reported_class: '3', created_at: iso(NOW.getTime() - 86400000), is_active: true }] });
    const sendSaved = jest.fn(async () => true);
    const done = await WayBack.alreadySaved({ phone: PHONE, norm: Bindings.normalisePhone(PHONE), row: { ...codeRow(), outcome: 'bound' },
      resolveChild: async () => ({ id: KID }), now: NOW, sendSaved, languageFor: async () => 'en' });
    expect(done).toBe(true);
    expect(sendSaved).toHaveBeenCalledTimes(1);
    expect(sendSaved.mock.calls[0][1].map((k) => String(k.id))).toEqual([KID]);
  });

  test('alreadySaved: no active place for this phone in the real bindings repo → false (the caller answers as today)', async () => {
    const sendSaved = jest.fn();
    expect(await WayBack.alreadySaved({ phone: PHONE, norm: Bindings.normalisePhone(PHONE), row: { ...codeRow(), outcome: 'bound' },
      resolveChild: async () => ({ id: KID }), now: NOW, sendSaved, languageFor: async () => 'en' })).toBe(false);
    expect(sendSaved).not.toHaveBeenCalled();
  });

  test('every reply is counted on the ledger as the bot\'s own reply to the family\'s message (ownReply)', async () => {
    seed({ codes: [codeRow({ used_at: iso(NOW.getTime() - 1000), outcome: 'max_kids' })], bindings: [bindingRow()] });
    await WayBack.reply({ phone: PHONE, reason: 'max_kids', code: 'JUGNU-AB2CD', language: 'en', now: NOW });
    await WayBack.alreadySaved({ phone: PHONE, norm: Bindings.normalisePhone(PHONE), row: { ...codeRow(), outcome: 'bound' },
      resolveChild: async () => ({ id: KID }), now: NOW, sendSaved: jest.fn(async () => true), languageFor: async () => 'en' });
    expect(Ledger.record).toHaveBeenCalledTimes(2);
    for (const [arg] of Ledger.record.mock.calls) expect(arg.ownReply).toBe(true);
  });
});
