'use strict';
/**
 * The quiet-hours rule was applied where the nudge is SCHEDULED, which leaves
 * every already-queued job on its old target. Measured on production the night
 * the rule shipped: six nudges were still in flight under the old 3h schedule,
 * due to land between 23:25 and 01:36 PKT — exactly the 9pm-and-later messages
 * the rule exists to stop.
 *
 * So the worker checks too. A job that arrives inside quiet hours re-queues
 * itself to 07:00 instead of sending, whenever it was scheduled and whatever
 * target it is carrying.
 */
const Nudge = require('../../bot/shared/services/quiz/transcript-quiz-nudge.service');

const atPkt = (h, m = 0) => new Date(Date.UTC(2026, 8, 8, h - 5, m));

describe('an in-flight nudge that arrives at night waits for the morning', () => {
  test('01:36 PKT — the latest of the six — is held', () => {
    const held = Nudge.nudgeTargetUtc(atPkt(1, 36));
    expect(held.getTime()).toBeGreaterThan(atPkt(1, 36).getTime());
    expect(held.toISOString()).toBe(atPkt(7).toISOString());
  });
  test('23:25 PKT — the earliest — is held to the NEXT morning', () => {
    expect(Nudge.nudgeTargetUtc(atPkt(23, 25)).toISOString())
      .toBe(new Date(Date.UTC(2026, 8, 9, 2, 0)).toISOString());
  });
  test('a job arriving in the afternoon is not delayed by the guard', () => {
    const t = atPkt(15, 10);
    expect(Nudge.nudgeTargetUtc(t).getTime()).toBe(t.getTime());
  });
  test('the guard is idempotent — re-checking a held time does not push it again', () => {
    const once = Nudge.nudgeTargetUtc(atPkt(23, 25));
    expect(Nudge.nudgeTargetUtc(once).toISOString()).toBe(once.toISOString());
  });
});

describe('the worker consults the guard on arrival, not only at scheduling', () => {
  const d = (o) => Nudge.nudgeDispatch(o);

  test('a job whose target has not arrived re-queues, as before', () => {
    const out = d({ targetAt: atPkt(15).toISOString(), now: atPkt(13) });
    expect(out.action).toBe('requeue');
    expect(out.delaySeconds).toBe(900);              // capped at the SQS maximum
  });
  test('a job arriving at 23:25 PKT re-queues to the morning instead of sending', () => {
    const out = d({ targetAt: atPkt(23, 25).toISOString(), now: atPkt(23, 25) });
    expect(out.action).toBe('requeue');
    expect(out.targetAt).toBe(new Date(Date.UTC(2026, 8, 9, 2, 0)).toISOString());
  });
  test('a job arriving at 01:36 PKT re-queues to 07:00 the same morning', () => {
    const out = d({ targetAt: atPkt(1, 36).toISOString(), now: atPkt(1, 36) });
    expect(out.action).toBe('requeue');
    expect(out.targetAt).toBe(atPkt(7).toISOString());
  });
  test('a job arriving in the afternoon is processed', () => {
    expect(d({ targetAt: atPkt(15).toISOString(), now: atPkt(15, 1) }).action).toBe('process');
  });
  test('a job with no target at all is processed if the hour allows', () => {
    expect(d({ targetAt: null, now: atPkt(11) }).action).toBe('process');
    expect(d({ targetAt: null, now: atPkt(23) }).action).toBe('requeue');
  });
  test('the re-queue delay never exceeds the SQS cap and never goes below a minute', () => {
    const soon = d({ targetAt: new Date(atPkt(11).getTime() + 5000).toISOString(), now: atPkt(11) });
    expect(soon.delaySeconds).toBeGreaterThanOrEqual(60);
    expect(soon.delaySeconds).toBeLessThanOrEqual(900);
  });
});
