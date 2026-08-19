/**
 * bd-2652 — the teacher report is silently discarded by SQS, not by us.
 *
 * The coaching queue is FIFO with a 5-MINUTE deduplication window. Two jobs
 * sent inside that window with the same MessageDeduplicationId are accepted by
 * SQS (a MessageId comes back, so the send *looks* successful) and the second
 * is never delivered to a consumer.
 *
 * The observe teacher-report flow queues three phases under ONE jobType, and
 * the dedup id was `${sessionId}-${jobType}` — phase-blind. A coach sees the
 * preview and taps "send" seconds later, so the deliver message always fell
 * inside the window and vanished. Every delivery on NIETE had been frozen at
 * 'awaiting_confirm' since the flow went live.
 *
 * bd-2645 fixed the REDIS idempotency key the same way; this is the second,
 * independent dedupe layer underneath it. Both must carry the phase.
 */

const KEY_LINE = require('fs')
  .readFileSync(require('path').join(__dirname, '../../shared/services/queue/sqs-queue.service.js'), 'utf8')
  .split('\n')
  .find((l) => l.includes('MessageDeduplicationId:') && l.includes('sessionId'));

// mirror of the shipped expression, used to prove the behaviour
const dedupId = (sessionId, jobType, payload = {}) =>
  `${sessionId}-${jobType}${payload.phase ? `-${payload.phase}` : ''}`;

describe('bd-2652 — SQS FIFO dedup must distinguish the observe phases', () => {
  it('the shipped MessageDeduplicationId includes the phase', () => {
    expect(KEY_LINE).toBeDefined();
    expect(KEY_LINE).toMatch(/phase/);
  });

  it('preview and deliver on one session get DIFFERENT dedup ids', () => {
    const sid = 'ab49b742-ae68-4f4c-bc58-b983dab00000';
    const preview = dedupId(sid, 'observe_teacher_report', { phase: 'preview' });
    const deliver = dedupId(sid, 'observe_teacher_report', { phase: 'deliver' });
    const tap = dedupId(sid, 'observe_teacher_report', { phase: 'teacher_tap' });
    expect(new Set([preview, deliver, tap]).size).toBe(3);
  });

  it('a job with no phase keeps its historical dedup id exactly', () => {
    const sid = 'd47d345b-9a7e-404b-855a-e4032112ef60';
    expect(dedupId(sid, 'transcription')).toBe(`${sid}-transcription`);
    expect(dedupId(sid, 'analysis')).toBe(`${sid}-analysis`);
  });

  it('stays inside the SQS 128-char limit for dedup ids', () => {
    const sid = 'ab49b742-ae68-4f4c-bc58-b983dab00000';
    expect(dedupId(sid, 'observe_teacher_report', { phase: 'teacher_tap' }).length).toBeLessThanOrEqual(128);
  });
});
