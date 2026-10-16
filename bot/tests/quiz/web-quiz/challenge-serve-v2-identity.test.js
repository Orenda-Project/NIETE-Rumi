'use strict';
/**
 * The Challenge served under web_quiz_challenge_v2: the identity pick written on the served row, and a finished stop
 * renewing the child's phone bindings under web_quiz_phone_bind (the identity change's modules, required lazily: the
 * tests that need them run where they exist; their absence is tested too). Faked boundaries only.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('../../../shared/storage/r2', () => ({
  getPresignedUploadUrl: jest.fn(async (key, type, ttl) => `https://r2.test/put/${key}?ct=${encodeURIComponent(type)}&ttl=${ttl}&X-Amz-Signature=x`),
  headObject: jest.fn(async () => ({ exists: true, sizeBytes: 400000, contentType: 'audio/webm' })),
  downloadFromR2: jest.fn(),
  getPresignedUrl: jest.fn(async (u) => `${u}?X-Amz-Signature=x`),
  buildR2PublicUrl: jest.fn((k) => `https://r2.test/${k}`),
  uploadBuffer: jest.fn(async () => 'ok'),
  presignKey: jest.fn(async (key, ttl, { bucket } = {}) => `https://signed.test/${key}?b=${bucket}`),
  deleteAudio: jest.fn(async () => true),
  deleteKey: jest.fn(async () => true),
  listKeys: jest.fn(async () => []),
}));
jest.mock('../../../shared/services/audio.service', () => ({ transcribe: jest.fn() }));
jest.mock('../../../shared/services/tts', () => ({ synthesize: jest.fn(async () => ({ audio: Buffer.from('OggS'), provider: 'soniox', voice: 'Grace', durationSec: 2 })) }));
jest.mock('../../../shared/services/llm-client', () => {
  const create = jest.fn();
  return { __create: create, getClient: () => ({ chat: { completions: { create } } }) };
});
jest.mock('../../../shared/services/cache/railway-redis.service', () => {
  const store = new Map();
  return { _store: store, isAvailable: () => true, get: async (k) => (store.has(k) ? store.get(k) : null), setNX: async (k, v) => { if (store.has(k)) return false; store.set(k, v); return true; } };
});
jest.mock('openchemlib', () => require('../../../../tests/__mocks__/openchemlib.js'));


const { makeFake } = require('./fake-supabase');
const { guardColumns } = require('./registry-columns');   // a select naming a column the table lacks is 42703
const supabase = require('../../../shared/config/supabase');
const { logError } = require('../../../shared/utils/logger');
const T = require('../../../shared/services/quiz/web-quiz-token');
const Bank = require('../../../shared/services/child-test/item-bank');
const Ch = require('../../../shared/services/quiz/web-quiz-challenge');

// The identity change's modules are lazily required by the service; a test that needs the real one runs only where it exists.
const has = (m) => { try { require.resolve(m); return true; } catch (_) { return false; } };
const BIND_PAGE = '../../../shared/services/quiz/web-quiz-bind-page';
const ID_FLAGS = '../../../shared/services/quiz/web-quiz-identity-flags';
const BIND_REPO = '../../../shared/services/quiz/child-phone-bindings.repo';
const itIf = (ok) => (ok ? test : test.skip);

const K3 = '44444444-4444-4444-8444-444444444444';
const L3 = 'a0000000-0000-4000-8000-000000000003';
const DAY = 24 * 3600 * 1000;
const iso = (t) => new Date(t).toISOString();
const flagsOf = (...keys) => keys.map((key) => ({ key, value: true }));
const BASE = ['web_quiz_challenge', 'web_quiz_challenge_record', 'web_quiz_challenge_trail', 'web_quiz_challenge_missing'];
const BIND = ['web_quiz_hub', 'web_quiz_identity_canon', 'web_quiz_phone_bind'];
const OLD_EXPIRY = iso(Date.now() + 20 * DAY);

let db;
const reset = (settings) => {
  db = {
    app_settings: flagsOf(...settings),
    student_lists: [{ id: L3, class_name: '3', is_active: true }],
    students: [{ id: K3, list_id: L3, student_name: 'Sana Testwala' }],
    web_quiz_challenge_runs: [],
    challenge_periods: [{ period_id: '2026-11', starts_at: iso(Date.now() - DAY), ends_at: iso(Date.now() + 29 * DAY), anchor_block_version: 'A1', weights_v: 'w1', bank_version: 'child-test-items-v4' }],
    challenge_passages: [],
    challenge_draws: [],
    child_phone_bindings: [{ id: 'b1', canonical_id: K3, phone_norm: '+92300FIXTURE1', via: 'save', bound_at: iso(Date.now() - 5 * DAY), last_played_at: null, expires_at: OLD_EXPIRY, revoked_at: null }],
  };
  Object.assign(supabase, guardColumns(makeFake(db)));
  Ch.__reset();
  for (const m of [ID_FLAGS, '../../../shared/services/quiz/web-quiz-hub-flags']) if (has(m)) { const x = require(m); if (x._resetCache) x._resetCache(); }
  jest.clearAllMocks();
};
// WQ_TOMB_SALT is web_quiz_phone_bind's hard parent (web-quiz-identity-flags): a test-only value, so the switch can be on
beforeAll(() => { process.env.INTERNAL_API_KEY = 'test-internal-key'; process.env.CHILD_TEST_R2_ENV = 'sandbox'; process.env.WQ_TOMB_SALT = 'test-only-salt'; });
const D = { device: 'FamilyPhoneDeviceRef_1', lang: 'en' };
const hub = () => T.sign({ k: 'h', ids: [K3], exp: Math.floor(Date.now() / 1000) + 3600 });
const answers = (items) => items.map((it, i) => ({ i, value: String(it.answer), ms: 3000, first_key_ms: 1200, keys: 1 }));
const finishWarmUp = async () => {
  const ex = await Ch.exercise(hub(), 'missing', D);
  await Ch.submit({ ct: ex.ct, answers: answers(ex.items), ms: 30000 });
  return ex;
};

describe('the identity pick on the served row (web-quiz-bind-page.pickFor)', () => {
  itIf(has(BIND_PAGE))('pickFor gets {sessionId, canonicalId, device}; its answer fills id_src, id_confidence, homonym_in_list', async () => {
    reset([...BASE, 'web_quiz_challenge_v2']);
    const BP = require(BIND_PAGE);
    const spy = jest.spyOn(BP, 'pickFor').mockResolvedValue({ id_src: 'roster_pick', id_confidence: 'high', homonym_in_list: false });
    const ex = await Ch.exercise(hub(), 'bigger', D);
    expect(spy).toHaveBeenCalledWith({ sessionId: null, canonicalId: K3, device: D.device });
    expect(db.web_quiz_challenge_runs.find((r) => r.id === T.verify(ex.ct, 'c').r)).toMatchObject({ id_src: 'roster_pick', id_confidence: 'high', homonym_in_list: false, canonical_id: K3, meta: expect.objectContaining({ pick_src: 'pick' }) });
    spy.mockRestore();
  });

  test('no pick (null, or the module absent): the three identity columns NULL and meta.pick_src absent', async () => {
    reset([...BASE, 'web_quiz_challenge_v2']);
    const restore = has(BIND_PAGE) ? jest.spyOn(require(BIND_PAGE), 'pickFor').mockResolvedValue(null) : null;
    const ex = await Ch.exercise(hub(), 'bigger', D);
    expect(db.web_quiz_challenge_runs.find((r) => r.id === T.verify(ex.ct, 'c').r)).toMatchObject({ id_src: null, id_confidence: null, homonym_in_list: null, canonical_id: K3, meta: expect.objectContaining({ pick_src: 'absent' }) });
    if (restore) restore.mockRestore();
  });
});

describe('a finished stop renews the child\'s phone bindings (web_quiz_phone_bind)', () => {
  itIf(has(ID_FLAGS) && has(BIND_REPO))('a bound child: the finished warm-up moves expires_at and last_played_at', async () => {
    reset([...BASE, ...BIND]);
    await finishWarmUp();
    const b = db.child_phone_bindings[0];
    expect(b.expires_at).not.toBe(OLD_EXPIRY);
    expect(b.expires_at).toBe(iso(require(BIND_REPO).expiresAtFor(new Date(b.last_played_at))));
  });

  itIf(has(ID_FLAGS) && has(BIND_REPO))('an unbound child: no write', async () => {
    reset([...BASE, ...BIND]);
    db.child_phone_bindings[0].canonical_id = '99999999-9999-4999-8999-999999999999';
    await finishWarmUp();
    expect(db.child_phone_bindings[0]).toMatchObject({ expires_at: OLD_EXPIRY, last_played_at: null });
    expect(supabase.calls.filter((c) => c.table === 'child_phone_bindings' && c.op === 'update')).toEqual([]);
  });

  itIf(has(ID_FLAGS) && has(BIND_REPO))('the switch off: no read, no write', async () => {
    reset([...BASE, 'web_quiz_hub', 'web_quiz_identity_canon']);
    await finishWarmUp();
    expect(db.child_phone_bindings[0].expires_at).toBe(OLD_EXPIRY);
    expect(supabase.calls.filter((c) => c.table === 'child_phone_bindings')).toEqual([]);
  });

  test('the binder\'s modules absent: the stop is scored, nothing renewed, nothing thrown', async () => {
    reset([...BASE, ...BIND]);
    jest.doMock(ID_FLAGS, () => { throw new Error("Cannot find module './web-quiz-identity-flags'"); }, { virtual: true });
    try {
      const ex = await Ch.exercise(hub(), 'missing', D);
      const r = await Ch.submit({ ct: ex.ct, answers: answers(ex.items), ms: 30000 });
      expect(r.score.correct).toBe(10);
      expect(db.child_phone_bindings[0].expires_at).toBe(OLD_EXPIRY);
    } finally { jest.dontMock(ID_FLAGS); }
  });

  itIf(has(ID_FLAGS) && has(BIND_REPO))('a failing renewal is logged and the result still comes back', async () => {
    reset([...BASE, ...BIND]);
    const repo = require(BIND_REPO);
    const spy = jest.spyOn(repo, 'activeForChild').mockRejectedValue(new Error('pool down'));
    const ex = await Ch.exercise(hub(), 'bigger', D);
    const r = await Ch.submit({ ct: ex.ct, taps: ex.items.map((it, i) => ({ i, pick: Math.max(it.a, it.b), ms: 2000 })), ms: 20000 });
    expect(r.score.correct).toBe(10);
    expect(logError).toHaveBeenCalledWith('web_quiz.ch_bind_renew_failed', expect.objectContaining({ error: 'pool down' }));
    spy.mockRestore();
  });
});
