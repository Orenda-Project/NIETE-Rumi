'use strict';
/**
 * "Faster than last time" compares like with like (web_quiz_read_feedback on): the child's last scored read at the SAME
 * text level (the run's form) is "last time"; with none at that level, the last read of any level, as before. One query
 * either way (the last few reads, newest first). Off: today's query (one row, no form) and today's answer.
 * Supabase is the faked boundary (the runs table in memory; app_settings answered by key).
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
}));
jest.mock('../../../shared/services/audio.service', () => ({ transcribe: jest.fn() }));
// The voice gateway's provider calls are the network boundary for the mascot's clips.
jest.mock('../../../shared/services/tts', () => ({ synthesize: jest.fn(async () => ({ audio: Buffer.from('OggS'), provider: 'soniox', voice: 'Grace', durationSec: 2 })) }));
jest.mock('../../../shared/services/llm-client', () => {
  const create = jest.fn();
  return { __create: create, getClient: () => ({ chat: { completions: { create } } }) };
});
// Redis is a boundary: an in-memory SET NX / GET, so the hub's first-device binding (web-quiz-hub deviceTrusted) runs for real.
jest.mock('../../../shared/services/cache/railway-redis.service', () => {
  const store = new Map();
  return {
    _store: store,
    isAvailable: () => true,
    get: async (k) => (store.has(k) ? store.get(k) : null),
    setNX: async (k, v) => { if (store.has(k)) return false; store.set(k, v); return true; },
  };
});
jest.mock('openchemlib', () => require('../../../../tests/__mocks__/openchemlib.js'));

const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const Ch = require('../../../shared/services/quiz/web-quiz-challenge');
const RF = require('../../../shared/services/quiz/web-quiz-read-feedback');

const KID = '44444444-4444-4444-8444-444444444444';
const settings = [];
let fake;
function seed(rows) {
  fake = makeFake({ web_quiz_challenge_runs: rows });
  Object.assign(supabase, {
    from: (t) => (t === 'app_settings'
      ? { select: () => ({ eq: (_k, key) => Promise.resolve({ data: settings.filter((r) => r.key === key), error: null }) }) }
      : fake.from(t)),
  });
  RF._reset();
}
const row = (n, form, wcpm, status = 'scored') => ({ id: `r${n}`, student_id: KID, exercise: 'read', lang: 'en', status, form, wcpm, score: { correct: wcpm }, created_at: `2026-10-1${n}T10:00:00Z` });
// newest first: G4 yesterday (an easier/harder text), G3 the day before
const ROWS = () => [row(1, 'G3', 30), row(2, 'G3', 34), row(3, 'G4', 20)];

describe('previous read for the moment\'s growth line', () => {
  beforeEach(() => { settings.length = 0; });
  test('key on, a G3 read: the last G3 read, not yesterday\'s G4', async () => {
    settings.push({ key: 'web_quiz_read_feedback', value: true });
    seed(ROWS());
    expect(await Ch._previousRun(KID, 'read', 'en', '3')).toMatchObject({ wcpm: 34 });
    expect(await Ch._previousRun(KID, 'read', 'en', 'G3')).toMatchObject({ wcpm: 34 });
  });
  test('key on, no read at this level yet: the last read of any level', async () => {
    settings.push({ key: 'web_quiz_read_feedback', value: true });
    seed(ROWS());
    expect(await Ch._previousRun(KID, 'read', 'en', '5')).toMatchObject({ wcpm: 20 });
  });
  test('key off: the last read, whatever its level (today)', async () => {
    seed(ROWS());
    expect(await Ch._previousRun(KID, 'read', 'en', '3')).toMatchObject({ wcpm: 20 });
  });
  test('one query either way', async () => {
    settings.push({ key: 'web_quiz_read_feedback', value: true });
    seed(ROWS());
    await Ch._previousRun(KID, 'read', 'en', '3');
    expect(fake.calls.filter((c) => c.table === 'web_quiz_challenge_runs').length).toBe(1);
  });
});
