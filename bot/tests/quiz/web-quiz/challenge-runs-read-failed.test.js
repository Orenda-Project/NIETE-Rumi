'use strict';
/**
 * A runs read that names a column this tier does not have (PostgREST 42703: a provenance migration not applied) fails
 * CLOSED: the serve refuses (every new switch off) or answers "on its way" (_v2), writes no run row and no draw row, and
 * never claims a first attempt. The read is logged once as web_quiz.ch_runs_read_failed. A healthy store is today's.
 * Faked boundaries only (Supabase, R2, speech, the LLM client), as the other Challenge suites.
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
const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const { logError } = require('../../../shared/utils/logger');
const T = require('../../../shared/services/quiz/web-quiz-token');
const Ch = require('../../../shared/services/quiz/web-quiz-challenge');

const K3 = '44444444-4444-4444-8444-444444444444';
const L3 = 'a0000000-0000-4000-8000-000000000003';
const DAY = 24 * 3600 * 1000;
const iso = (t) => new Date(t).toISOString();
const BASE = ['web_quiz_challenge', 'web_quiz_challenge_record', 'web_quiz_challenge_trail', 'web_quiz_challenge_missing'];
const V2 = ['web_quiz_challenge_v2', 'web_quiz_challenge_period'];
const MISSING_COL = { code: '42703', message: 'column web_quiz_challenge_runs.via does not exist' };

let db;
let broken = false;
const reset = (settings) => {
  db = {
    app_settings: settings.map((key) => ({ key, value: true })),
    student_lists: [{ id: L3, class_name: '3', is_active: true }],
    students: [{ id: K3, list_id: L3, student_name: 'Sana Testwala' }],
    web_quiz_challenge_runs: [],
    challenge_periods: [{ period_id: '2026-11', starts_at: iso(Date.now() - DAY), ends_at: iso(Date.now() + 29 * DAY), anchor_block_version: 'A1', weights_v: 'w1', bank_version: 'child-test-items-v4' }],
    challenge_passages: [],
    challenge_draws: [],
  };
  const fake = makeFake(db);
  // the tier without the provenance columns: a runs select that names `via` answers 42703, like PostgREST
  const from = fake.from.bind(fake);
  fake.from = (t) => {
    const b = from(t);
    if (t !== 'web_quiz_challenge_runs') return b;
    const select = b.select;
    b.select = (cols, opts) => {
      const out = select(cols, opts);
      if (broken && /\bvia\b/.test(String(cols || ''))) b.then = (res, rej) => Promise.resolve({ data: null, error: MISSING_COL }).then(res, rej);
      return out;
    };
    return b;
  };
  Object.assign(supabase, fake);
  Ch.__reset();
  jest.clearAllMocks();
};
beforeAll(() => { process.env.INTERNAL_API_KEY = 'test-internal-key'; process.env.CHILD_TEST_R2_ENV = 'sandbox'; });
afterEach(() => { broken = false; });
const D = { device: 'FamilyPhoneDeviceRef_1', lang: 'en' };
const hub = () => T.sign({ k: 'h', ids: [K3], exp: Math.floor(Date.now() / 1000) + 3600 });
const readFailedLogs = () => logError.mock.calls.filter(([n]) => n === 'web_quiz.ch_runs_read_failed');
const taps = (items) => items.map((it, i) => ({ i, pick: Math.max(it.a, it.b), ms: 2500 }));

describe('every new switch off: the runs read fails with 42703', () => {
  test('the serve refuses 503 unavailable, writes no run row, logs ch_runs_read_failed once', async () => {
    reset(BASE);
    broken = true;
    await expect(Ch.exercise(hub(), 'bigger', D)).rejects.toMatchObject({ status: 503, body: { error: 'unavailable' } });
    expect(db.web_quiz_challenge_runs).toEqual([]);
    expect(readFailedLogs()).toEqual([['web_quiz.ch_runs_read_failed', { code: '42703', step: 's', w: 's' }]]);
  });

  test('the menu refuses too (it would show every stop not done)', async () => {
    reset(BASE);
    broken = true;
    await expect(Ch.menu(hub(), D)).rejects.toMatchObject({ status: 503, body: { error: 'unavailable' } });
    expect(readFailedLogs()).toEqual([['web_quiz.ch_runs_read_failed', { code: '42703', step: 'm', w: 's' }]]);
  });

  test('a run served before the read broke and finished after: stored, never counted, attempt unknown', async () => {
    reset(BASE);
    const ex = await Ch.exercise(hub(), 'bigger', D);
    broken = true;
    await Ch.submit({ ct: ex.ct, taps: taps(ex.items), ms: 25000 });
    expect(db.web_quiz_challenge_runs).toHaveLength(1);
    expect(db.web_quiz_challenge_runs[0].meta).toMatchObject({ counted: false, attempt_no: null, runs_read_failed: true });
    expect(readFailedLogs()).toEqual([['web_quiz.ch_runs_read_failed', { code: '42703', step: 'f', w: 's' }]]);
  });
});

describe('_v2 and _period on: the runs read fails with 42703', () => {
  test('on its way: no run row, no draw row, no record; logged once', async () => {
    reset([...BASE, ...V2]);
    broken = true;
    const ex = await Ch.exercise(hub(), 'bigger', D);
    expect(ex).toMatchObject({ on_its_way: true });
    expect(ex).not.toHaveProperty('ct');
    expect(db.web_quiz_challenge_runs).toEqual([]);
    expect(db.challenge_draws).toEqual([]);
    expect(readFailedLogs()).toEqual([['web_quiz.ch_runs_read_failed', { code: '42703', step: 's', w: 's' }]]);
  });
});

describe('a healthy store: today', () => {
  test('every new switch off and _v2 on: served as before, nothing logged', async () => {
    reset(BASE);
    const a = await Ch.exercise(hub(), 'bigger', D);
    expect(a.ct).toBeTruthy();
    reset([...BASE, ...V2]);
    const b = await Ch.exercise(hub(), 'bigger', D);
    expect(b.ct).toBeTruthy();
    expect(db.web_quiz_challenge_runs).toHaveLength(1);
    expect(readFailedLogs()).toEqual([]);
  });
});
