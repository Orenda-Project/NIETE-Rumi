'use strict';
/**
 * One recording per quiz at a time (app_settings `web_quiz_audio_claim`, default OFF, JSON true only). A quiz's clip job
 * is queued from more than one place (the teacher's link, the page open, the worker's own "come back in a minute"),
 * under different job ids, so two workers can record the same quiz at the same moment: every clip is paid twice.
 * On: the worker's job claims the quiz (and plan) in Redis before it records; a second job for it while the first runs
 * skips (the first one's own retries cover a failure); the claim is let go when the recording ends, however it ends.
 * Off: today, both record. Redis down: the job records (a rare double beats a silent quiz).
 *
 * Boundaries faked: supabase (in-memory), Redis, the queue, the loggers. The job runs for real; publish is the seam.
 */
const mockMem = new Map();
const mockRedis = {
  up: true,
  setNX: jest.fn(async (k, v) => { if (!mockRedis.up) return true; if (mockMem.has(k)) return false; mockMem.set(k, v); return true; }),
  delete: jest.fn(async (k) => { mockMem.delete(k); return true; }),
  get: jest.fn(async () => null), set: jest.fn(async () => true),
};
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/services/cache/railway-redis.service', () => mockRedis);
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('openchemlib', () => require('../../../../tests/__mocks__/openchemlib.js'));

const { makeFake } = require('./fake-supabase');
const Publish = require('../../../shared/services/quiz/web-quiz-publish.service');
const OneVoice = require('../../../shared/services/quiz/web-quiz-one-voice-flag');
const Claim = require('../../../shared/services/quiz/web-quiz-audio-claim');

const QUIZ = '22222222-2222-4222-8222-222222222222';
function seed({ claim, oneVoice = true } = {}) {
  return makeFake({
    quizzes: [{ id: QUIZ, topic: 'Months', grade: '1', subject: 'English', language: 'en', meta: {}, quiz_source: 'video' }],
    app_settings: [
      ...(oneVoice ? [{ key: 'web_quiz_one_voice', value: true }] : []),
      ...(claim === undefined ? [] : [{ key: 'web_quiz_audio_claim', value: claim }]),
    ],
  });
}
// a recording that ends when the test says so
function slowPublish() {
  const ends = [];
  const publish = jest.fn(() => new Promise((res, rej) => ends.push({ res, rej })));
  return { publish, ends };
}
const queue = { queueJob: jest.fn(async () => ({})) };

beforeEach(() => { mockMem.clear(); mockRedis.up = true; mockRedis.setNX.mockClear(); mockRedis.delete.mockClear(); queue.queueJob.mockClear(); OneVoice.reset(); Claim._resetCache(); });

describe('web_quiz_audio_claim on: one recording per quiz at a time', () => {
  test('two jobs for one quiz at once: one records, the other skips; the claim is let go when it ends', async () => {
    const fake = seed({ claim: true });
    const { publish, ends } = slowPublish();
    const a = Publish.runQuizAudioJob({ quizId: QUIZ }, { db: { from: fake.from }, publish, queue });
    await new Promise((r) => setImmediate(r));
    const b = await Publish.runQuizAudioJob({ quizId: QUIZ }, { db: { from: fake.from }, publish, queue });
    expect(b).toEqual({ skipped: 'claimed' });
    expect(publish).toHaveBeenCalledTimes(1);
    ends[0].res({ ok: true, failed: 0 });
    await a;
    expect(mockMem.size).toBe(0);
    // the claim is for this quiz under this plan, and lasts no longer than a job may run
    const [key, , ttl] = mockRedis.setNX.mock.calls[0];
    expect(key).toBe(`wq:audio:claim:${QUIZ}:${OneVoice.normalize(true).sig}`);
    expect(ttl).toBeGreaterThanOrEqual(600);
    expect(ttl).toBeLessThanOrEqual(900);
    // after it ends, a later job may record again (it would find the quiz current in real life)
    await Publish.runQuizAudioJob({ quizId: QUIZ }, { db: { from: fake.from }, publish: jest.fn(async () => ({ ok: true, failed: 0 })), queue });
    expect(mockRedis.setNX).toHaveBeenCalledTimes(3);
  });
  test('a recording that throws still lets the claim go', async () => {
    const fake = seed({ claim: true });
    const publish = jest.fn(async () => { throw new Error('vendor down'); });
    await expect(Publish.runQuizAudioJob({ quizId: QUIZ }, { db: { from: fake.from }, publish, queue })).rejects.toThrow('vendor down');
    expect(mockMem.size).toBe(0);
  });
  test('a recording with failed clips lets the claim go before its retry is queued', async () => {
    const fake = seed({ claim: true });
    const publish = jest.fn(async () => ({ ok: true, failed: 2 }));
    const out = await Publish.runQuizAudioJob({ quizId: QUIZ }, { db: { from: fake.from }, publish, queue });
    expect(out.retry).toBe(1);
    expect(mockMem.size).toBe(0);
  });
  test('Redis down: the job records (never a silent quiz for a lock)', async () => {
    const fake = seed({ claim: true });
    mockRedis.up = false;
    const { publish, ends } = slowPublish();
    const a = Publish.runQuizAudioJob({ quizId: QUIZ }, { db: { from: fake.from }, publish, queue });
    await new Promise((r) => setImmediate(r));
    const b = Publish.runQuizAudioJob({ quizId: QUIZ }, { db: { from: fake.from }, publish, queue });
    await new Promise((r) => setImmediate(r));
    expect(publish).toHaveBeenCalledTimes(2);
    ends.forEach((e) => e.res({ ok: true, failed: 0 })); await Promise.all([a, b]);
  });
});

describe('off: today, both record and Redis is never asked', () => {
  test.each([[undefined], [false], ['true'], [1]])('switch %p: two jobs at once both record', async (claim) => {
    const fake = seed({ claim });
    const { publish, ends } = slowPublish();
    const a = Publish.runQuizAudioJob({ quizId: QUIZ }, { db: { from: fake.from }, publish, queue });
    await new Promise((r) => setImmediate(r));
    const b = Publish.runQuizAudioJob({ quizId: QUIZ }, { db: { from: fake.from }, publish, queue });
    await new Promise((r) => setImmediate(r));
    expect(publish).toHaveBeenCalledTimes(2);
    expect(mockRedis.setNX).not.toHaveBeenCalled();
    ends.forEach((e) => e.res({ ok: true, failed: 0 })); await Promise.all([a, b]);
  });
});
