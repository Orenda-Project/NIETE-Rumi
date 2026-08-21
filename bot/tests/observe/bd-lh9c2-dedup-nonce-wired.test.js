'use strict';
/**
 * bd-lh9c2 — a re-sent observe debrief recording is silently swallowed TWICE.
 *
 * Live 2026-08-21 08:16→08:19 PKT (session aa25c93e…): the coach's first clip
 * was rejected as too short, she sent the real 4:39 debrief 3 minutes later,
 * the bot logged "queued" — and no worker ever executed it.
 *
 * queueObserveDebrief DOES stamp payload.dedupNonce = sha1(audioId), and
 * buildDedupId DOES fold the nonce in — but buildDedupId had ZERO callers:
 * queueCoachingJob built MessageDeduplicationId inline (phase only), and the
 * Redis idempotency key was nonce-blind too (1h TTL, fires before SQS). Either
 * layer alone swallows the retry; the existing bd-rkofm test asserted only the
 * un-called helper, so it could never go red.
 *
 * This test locks the SEND PATH itself: mocked Redis + captured SQS params.
 */

process.env.SQS_QUEUE_URL = 'https://sqs.us-east-1.amazonaws.com/000000000000/test-queue.fifo';

jest.mock('../../shared/services/cache/railway-redis.service', () => {
  const store = new Map();
  return {
    __store: store,
    get: jest.fn(async (k) => (store.has(k) ? store.get(k) : null)),
    set: jest.fn(async (k, v, ttl) => { store.set(k, v); }),
    setex: jest.fn(async (k, ttl, v) => { store.set(k, v); }),
    setexWithCeiling: jest.fn(async (k, ttl, v) => { store.set(k, v); }),
  };
});
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));

const redisStore = require('../../shared/services/cache/railway-redis.service').__store;
const svc = require('../../shared/services/queue/sqs-queue.service');

const SID = 'aa25c93e-f017-4b0c-ae86-4f8091f4b4a8';
const sent = [];

beforeEach(() => {
  redisStore.clear();
  sent.length = 0;
  svc.sqs = { sendMessage: (params) => { sent.push(params); return { promise: async () => ({ MessageId: `m${sent.length}` }) }; } };
});

function debriefPayload(audioId) {
  // exactly what queueObserveDebrief builds
  const crypto = require('crypto');
  return {
    audioId, from: '923365709413',
    dedupNonce: crypto.createHash('sha1').update(String(audioId)).digest('hex').slice(0, 16),
  };
}

describe('bd-lh9c2 — the dedupNonce actually reaches both dedupe layers', () => {
  test('two debrief recordings on one session produce DIFFERENT SQS dedup ids', async () => {
    await svc.queueCoachingJob(SID, 'observe_debrief', debriefPayload('1537082747740319'));
    await svc.queueCoachingJob(SID, 'observe_debrief', debriefPayload('2203449390451026'));
    expect(sent).toHaveLength(2); // the second must REACH SQS at all (Redis layer)
    expect(sent[0].MessageDeduplicationId).not.toBe(sent[1].MessageDeduplicationId);
    // and each id is the buildDedupId shape (the helper is the single source of truth)
    const { buildDedupId } = svc;
    expect(sent[1].MessageDeduplicationId).toBe(
      buildDedupId(SID, 'observe_debrief', debriefPayload('2203449390451026')));
  });

  test('the Redis idempotency key is nonce-aware (second send is not "duplicate")', async () => {
    await svc.queueCoachingJob(SID, 'observe_debrief', debriefPayload('audio-A'));
    const r = await svc.queueCoachingJob(SID, 'observe_debrief', debriefPayload('audio-B'));
    expect(r).toBe('m2'); // a fresh MessageId, not the cached one from send #1
  });

  test('a true duplicate (same audio twice) IS still deduped by Redis', async () => {
    const first = await svc.queueCoachingJob(SID, 'observe_debrief', debriefPayload('audio-A'));
    const second = await svc.queueCoachingJob(SID, 'observe_debrief', debriefPayload('audio-A'));
    expect(second).toBe(first);
    expect(sent).toHaveLength(1);
  });

  test('phase jobs and nonce-less jobs keep their historical ids exactly', async () => {
    await svc.queueCoachingJob(SID, 'observe_teacher_report', { phase: 'deliver' });
    await svc.queueCoachingJob(SID, 'transcription', { audioIdIgnored: true });
    expect(sent[0].MessageDeduplicationId).toBe(`${SID}-observe_teacher_report-deliver`);
    expect(sent[1].MessageDeduplicationId).toBe(`${SID}-transcription`);
  });

  test('dedup id stays within the SQS 128-char cap with a nonce', async () => {
    await svc.queueCoachingJob(SID, 'observe_debrief', debriefPayload('x'.repeat(500)));
    expect(sent[0].MessageDeduplicationId.length).toBeLessThanOrEqual(128);
  });
});
