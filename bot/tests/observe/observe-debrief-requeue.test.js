/**
 * bd-56 — every debrief recording is its OWN job.
 *
 * BUG (2026-07-16, Fidelis/TZ prod): observe_debrief jobs were deduped on
 * sessionId+jobType alone, so an FO's re-recording within the Redis TTL was
 * silently swallowed while the bot promised "feedback in a few minutes".
 * FIX: queueObserveDebrief folds the recording's audioId into the queue
 * layer's dedupNonce — a new recording always queues; a webhook/SQS retry of
 * the SAME recording still dedups.
 */
jest.mock('../../shared/services/queue/sqs-queue.service', () => ({
  queueCoachingJob: jest.fn().mockResolvedValue('msg-1'),
}));

const SQSQueueService = require('../../shared/services/queue/sqs-queue.service');
const CoachingJobQueueService = require('../../shared/services/coaching/coaching-job-queue.service');

beforeEach(() => jest.clearAllMocks());

describe('bd-56 — queueObserveDebrief carries a per-recording dedupNonce', () => {
  test('audioId becomes the dedupNonce — hashed short (SQS dedup id caps at 128 chars, wamids are long)', async () => {
    await CoachingJobQueueService.queueObserveDebrief('sess-1', { from: '255700', audioId: 'wamid.AUDIO1' });
    const payload = SQSQueueService.queueCoachingJob.mock.calls[0][2];
    expect(SQSQueueService.queueCoachingJob).toHaveBeenCalledWith('sess-1', 'observe_debrief', expect.anything());
    expect(payload.audioId).toBe('wamid.AUDIO1');
    expect(payload.dedupNonce).toMatch(/^[0-9a-f]{16}$/);
  });

  test('deterministic per recording: same audio → same nonce; new audio → new nonce', async () => {
    await CoachingJobQueueService.queueObserveDebrief('sess-1', { from: '255700', audioId: 'a1' });
    await CoachingJobQueueService.queueObserveDebrief('sess-1', { from: '255700', audioId: 'a1' });
    await CoachingJobQueueService.queueObserveDebrief('sess-1', { from: '255700', audioId: 'a2' });
    const nonces = SQSQueueService.queueCoachingJob.mock.calls.map((c) => c[2].dedupNonce);
    expect(nonces[0]).toBe(nonces[1]);       // retry of the SAME recording still dedups downstream
    expect(nonces[2]).not.toBe(nonces[0]);   // a NEW recording is a NEW job
  });

  test('missing audioId degrades to the old session-level key (never crashes)', async () => {
    await CoachingJobQueueService.queueObserveDebrief('sess-1', { from: '255700' });
    const payload = SQSQueueService.queueCoachingJob.mock.calls[0][2];
    expect(payload.dedupNonce).toBeUndefined();
  });
});
