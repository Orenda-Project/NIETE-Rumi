'use strict';
/**
 * "Keep my place" is idempotent per child × device: a second Yes within the code's hour (a double tap, a reopened
 * card after the WhatsApp detour) answers the SAME live code, writes no second row and logs `bind_confirm` once per
 * live code. A spent, expired or other-device code never comes back. Runs over the REAL code repo on the shared fake
 * Supabase (no repo mock); faked: Supabase, Redis, the loggers, the switch module and the canonical-id helper.
 * A code with under ten minutes left is not handed out again (the family would send a dead code).
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
const hubOf = (ids) => T.sign({ k: 'h', ids, exp: 2000000000 });
const chip = (id) => T.chipId('h', id);
const iso = (ms) => new Date(Date.now() + ms).toISOString();
let fake;

beforeEach(() => {
  jest.clearAllMocks();
  process.env.WEB_QUIZ_TOKEN_SECRET = 'bind-reuse-test-secret';
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

const tap = () => Bind.mint({ hub: hubOf([KID]), kid: chip(KID), device: DEV, lang: 'en' });
const confirms = () => logEvent.mock.calls.filter((c) => c[0] === 'web_quiz.bind_confirm').length;
const liveRow = (over = {}) => ({ code: 'JUGNU-LIVE7', canonical_id: KID, device_ref: T.cleanDeviceRef(DEV), minted_at: iso(-10 * 60000), expires_at: iso(50 * 60000), used_at: null, outcome: null, ...over });

describe('a second Yes within the hour, same child, same device', () => {
  test('answers the SAME code and expiry, writes no second row, logs bind_confirm once', async () => {
    const a = await tap();
    const b = await tap();
    expect(a.ok && b.ok).toBe(true);
    expect(b.code).toBe(a.code);
    expect(b.expires_at).toBe(a.expires_at);
    expect(b.href).toBe(a.href);
    expect(fake.db.child_bind_codes).toHaveLength(1);
    expect(confirms()).toBe(1);
  });

  test('the repo reuses the live code it already holds for this child on this device', async () => {
    fake.db.child_bind_codes.push(liveRow());
    const minted = await Codes.mint(KID, T.cleanDeviceRef(DEV));
    expect(minted).toEqual({ code: 'JUGNU-LIVE7', expires_at: fake.db.child_bind_codes[0].expires_at, reused: true });
    expect(fake.db.child_bind_codes).toHaveLength(1);
  });
});

describe('a code that is not live again is never reused', () => {
  test.each([
    ['spent', { used_at: iso(-60000), outcome: 'bound' }],
    ['expired', { minted_at: iso(-120 * 60000), expires_at: iso(-60 * 60000) }],
    ['about to expire (under ten minutes left)', { minted_at: iso(-55 * 60000), expires_at: iso(5 * 60000) }],
    ['another device', { device_ref: 'ZZZZZZZZZZZZZZZZZZZZZZ' }],
    ['another child', { canonical_id: 'c0000001-0000-4000-8000-000000000009' }],
  ])('%s -> a new code, a second row', async (_name, over) => {
    fake.db.child_bind_codes.push(liveRow(over));
    const out = await tap();
    expect(out.ok).toBe(true);
    expect(out.code).not.toBe('JUGNU-LIVE7');
    expect(fake.db.child_bind_codes).toHaveLength(2);
    expect(confirms()).toBe(1);
  });
});
