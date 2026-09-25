'use strict';
/**
 * One class-report chain per share code, not one per child who joins.
 *
 * scheduleForShareCode() runs on EVERY join. It relied on the SQS deduplication
 * id to make the second call a no-op — but queueJob only sends that id to a FIFO
 * queue, and the quiz queue is STANDARD, so each join started its own 12-hour
 * chain that re-queues itself every 15 minutes. Production, 7 days: 11,488 chains
 * for 1,020 share codes (median 6 per code, max 92), ~250k re-queue executions —
 * enough to saturate the quiz queue and leave teacher-tapped quizzes waiting
 * 20+ minutes behind them. The duplicate chains also reached generate() a second
 * time after the report went out and sent follow-up reports.
 *
 * Boundaries mocked: the SQS client, Redis, the logger. The module under test runs.
 */

jest.mock('../../shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendDocument: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../shared/services/queue/sqs-queue.service', () => ({
  queueJob: jest.fn().mockResolvedValue('m1'),
}));
jest.mock('../../shared/services/cache/railway-redis.service', () => {
  const store = new Map();
  return {
    _store: store,
    setNX: jest.fn(async (key, value) => {
      if (store.has(key)) return false;
      store.set(key, value);
      return true;
    }),
    delete: jest.fn(async (key) => { store.delete(key); return true; }),
  };
});
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const SQSQueueService = require('../../shared/services/queue/sqs-queue.service');
const redis = require('../../shared/services/cache/railway-redis.service');
const { logEvent } = require('../../shared/utils/structured-logger');
const report = require('../../shared/services/quiz/video-quiz-report.service');

const CODE = '6b1c0f0e-0000-4000-8000-00000000c0de';

beforeEach(() => {
  jest.clearAllMocks();
  redis._store.clear();
  delete process.env.VIDEO_REPORT_SCHEDULE_ONCE;
});

describe('class report — one chain per share code', () => {
  test('the second, third … child to join queues nothing', async () => {
    await report.scheduleForShareCode(CODE);
    await report.scheduleForShareCode(CODE);
    await report.scheduleForShareCode(CODE);

    expect(SQSQueueService.queueJob).toHaveBeenCalledTimes(1);
    // The chain that exists is the FIRST join's: 12 h after the first child, as documented.
    const [groupId, jobType, payload] = SQSQueueService.queueJob.mock.calls[0];
    expect(groupId).toBe(CODE);
    expect(jobType).toBe('quiz_video_report');
    expect(new Date(payload.targetAt).getTime()).toBeGreaterThan(Date.now());
    expect(logEvent).toHaveBeenCalledWith('video_quiz.report_schedule_skipped',
      expect.objectContaining({ shareCodeId: CODE, why: 'already_scheduled' }));
  });

  test('two different share codes each get their chain', async () => {
    await report.scheduleForShareCode(CODE);
    await report.scheduleForShareCode('6b1c0f0e-0000-4000-8000-00000000beef');
    expect(SQSQueueService.queueJob).toHaveBeenCalledTimes(2);
  });

  test('the claim outlives the longest possible wait for the report', async () => {
    await report.scheduleForShareCode(CODE);
    const [key, , ttl] = redis.setNX.mock.calls[0];
    expect(key).toContain(CODE);
    // A join at 10:00 PKT targets 22:00, pushed to 07:00 next day: 21 h. The
    // claim must not lapse before the chain fires or a later join starts a second one.
    expect(ttl).toBeGreaterThanOrEqual(22 * 3600);
  });

  test('a failed queue write releases the claim, so the next join can still schedule', async () => {
    SQSQueueService.queueJob.mockRejectedValueOnce(new Error('sqs down'));
    await report.scheduleForShareCode(CODE);          // swallowed (best-effort), claim released
    await report.scheduleForShareCode(CODE);
    expect(SQSQueueService.queueJob).toHaveBeenCalledTimes(2);
    expect(redis._store.size).toBe(1);
  });

  test('Redis unavailable (setNX fails open) → the report is still scheduled', async () => {
    redis.setNX.mockResolvedValue(true);               // the service's documented fail-open
    await report.scheduleForShareCode(CODE);
    await report.scheduleForShareCode(CODE);
    expect(SQSQueueService.queueJob).toHaveBeenCalledTimes(2);
    redis.setNX.mockReset();
  });

  test.each(['off', 'false', '0'])('VIDEO_REPORT_SCHEDULE_ONCE=%s → every join queues, as before', async (v) => {
    process.env.VIDEO_REPORT_SCHEDULE_ONCE = v;
    await report.scheduleForShareCode(CODE);
    await report.scheduleForShareCode(CODE);
    expect(SQSQueueService.queueJob).toHaveBeenCalledTimes(2);
    expect(redis.setNX).not.toHaveBeenCalled();
  });
});
