'use strict';
/**
 * "Keep my place" through its real seam: the page's mint() runs over the REAL code table repo
 * (child-bind-codes.repo.js) and the REAL bindings repo on the shared fake Supabase — no sibling repo is mocked, so
 * the shape the repo returns is the shape the page reads. Faked: Supabase (in-memory), Redis (a Map), the loggers,
 * the switch module and the canonical-id helper. The hub token and the device trust run for real.
 *
 * Why this file exists: the unit suite mocked the repo with the shape the page wanted ({code, expires_at}) while
 * the repo returned a bare string, so the page answered `unavailable` on every tap on sandbox and the family never
 * got a code. A test that mocks the module's own adapter is not the seam's test.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/services/cache/railway-redis.service', () => {
  const store = new Map();
  return {
    _store: store,
    isAvailable: () => true,
    get: jest.fn(async (k) => (store.has(k) ? store.get(k) : null)),
    set: jest.fn(async (k, v) => { store.set(k, v); return true; }),
    delete: jest.fn(async () => true),
    setNX: jest.fn(async (k, v) => { if (store.has(k)) return false; store.set(k, v); return true; }),
  };
});
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('../../../shared/services/quiz/web-quiz-identity-flags', () => ({ flags: jest.fn() }));
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
const Codes = require('../../../shared/services/quiz/child-bind-codes.repo');
const T = require('../../../shared/services/quiz/web-quiz-token');
const Bind = require('../../../shared/services/quiz/web-quiz-bind-page');
const Hub = require('../../../shared/services/quiz/web-quiz-hub');

const KID = 'c0000001-0000-4000-8000-000000000001';
const LIST = 'c0000001-0000-4000-8000-0000000000aa';
const DEV = 'AAAAAAAAAAAAAAAAAAAAAA';
const ON = { canon: true, phoneBind: true, guestHome: false };
const OFF = { canon: true, phoneBind: false, guestHome: false };
const CODE_RX = /^JUGNU-[A-HJ-NP-Z2-9]{5}$/;
const hubOf = (ids, extra = {}) => T.sign({ k: 'h', ids, exp: 2000000000, ...extra });
const chip = (id) => T.chipId('h', id);
let fake;

beforeEach(() => {
  jest.clearAllMocks();
  process.env.WEB_QUIZ_TOKEN_SECRET = 'bind-seam-test-secret';
  process.env.WHATSAPP_BOT_NUMBER = '+92 000 0000000';
  redis._store.clear();
  Hub._resetCache();
  IdFlags.flags.mockResolvedValue(ON);
  fake = makeFake({
    app_settings: [{ key: 'web_quiz_hub', value: 'true' }, { key: 'web_quiz_challenge', value: true }],
    students: [{ id: KID, student_name: 'Zara Testwala', student_name_urdu: null, father_name: null, self_reported_class: '3', list_id: LIST, is_active: true }],
    student_lists: [{ id: LIST, user_id: 't1', class_name: '3', section: 'A', is_active: true }],
    child_bind_codes: [], child_phone_bindings: [],
    quiz_sessions: [], quiz_share_codes: [], quizzes: [], student_videos: [], web_quiz_challenge_runs: [],
  }, { uniques: { child_bind_codes: ['code'], quiz_share_codes: ['code'] } });
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
});

const codeCalls = () => fake.calls.filter((c) => c.table === 'child_bind_codes');

describe('keep my place over the real code repo (no repo mock)', () => {
  test('Keep my place -> Yes: the reply carries the code and its expiry; the row is written with outcome and used_at NULL', async () => {
    const before = Date.now();
    const out = await Bind.mint({ hub: hubOf([KID]), kid: chip(KID), device: DEV, lang: 'en' });

    expect(out.ok).toBe(true);
    expect(out.code).toMatch(CODE_RX);
    expect(out.prefill.en).toBe(`Jugnu ✨ keep my place ${out.code}`);
    expect(out.href).toContain(encodeURIComponent(out.code));

    // the one row the tap wrote, as the bot will read it
    expect(fake.db.child_bind_codes).toHaveLength(1);
    const row = fake.db.child_bind_codes[0];
    expect(row.code).toBe(out.code);
    expect(row.canonical_id).toBe(KID);
    expect(row.device_ref).toBe(T.cleanDeviceRef(DEV));
    expect(row.outcome == null).toBe(true);
    expect(row.used_at == null).toBe(true);

    // the expiry in the reply is the row's: one hour after the mint, as an ISO instant
    expect(out.expires_at).toBe(row.expires_at);
    const ttl = Date.parse(row.expires_at) - Date.parse(row.minted_at);
    expect(ttl).toBe(Codes.TTL_MS);
    expect(Date.parse(row.minted_at)).toBeGreaterThanOrEqual(before - 1000);

    // the page's status read, same real repo: pending until the bot spends it
    expect(await Bind.status({ code: out.code })).toEqual({ state: 'pending' });
    expect(logEvent).toHaveBeenCalledWith('web_quiz.bind_confirm', { w: 's' });
    expect(JSON.stringify(logEvent.mock.calls)).not.toContain(DEV);
  });

  test('the repo itself answers { code, expires_at } (the shape the page reads), never a bare string', async () => {
    const now = new Date('2026-10-16T02:00:00Z');
    const minted = await Codes.mint(KID, 'dev-1', now);
    expect(minted).toEqual({ code: expect.stringMatching(CODE_RX), expires_at: '2026-10-16T03:00:00.000Z' });
    expect(fake.db.child_bind_codes[0]).toMatchObject({ code: minted.code, expires_at: minted.expires_at, minted_at: now.toISOString() });
  });

  test('golden: the phone-bind switch off -> {off:true}; no code table read or write, nothing logged', async () => {
    IdFlags.flags.mockResolvedValue(OFF);
    expect(await Bind.mint({ hub: hubOf([KID]), kid: chip(KID), device: DEV })).toEqual({ off: true });
    expect(codeCalls()).toHaveLength(0);
    expect(fake.db.child_bind_codes).toHaveLength(0);
    expect(logEvent).not.toHaveBeenCalled();
  });
});
