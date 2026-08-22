/**
 * The resume sweep's most likely failure must be visible (bd-43520).
 *
 * sweepAndOffer() acquires a lock that fails CLOSED — no cache, no sweep — which is
 * the right direction, because sweeping without the lock double-messages a teacher
 * while skipping one only delays an offer. But the worker logged only when work
 * happened:
 *
 *   if (res.offered || res.expired || res.failed) { logToFile('🔄 …', res); }
 *
 * `skippedLocked` is absent from that condition, so a sweeper that is lock-blocked
 * or cache-starved on EVERY interval emits no line at all and is indistinguishable
 * from a healthy idle one. This is the sibling of pre-merge-checklist Class N:
 * there a real failure is logged where nobody looks, here it is not logged at all
 * because the field describing it was left out of the condition.
 *
 * A static guard rather than a behavioural one: the condition lives inside a
 * setInterval inside startWorker(), which needs the whole worker booted (AWS, redis,
 * queue driver) to reach. The repo already uses source-level guards for exactly this
 * shape — see tests/conversation-state/no-legacy-state-stores.test.js, whose header
 * explains why a NAMED guard cannot be waved away the way a generic one can.
 */

const fs = require('fs');
const path = require('path');

const WORKER = path.resolve(__dirname, '../../bot/workers/sqs-worker.js');

describe('resume sweep observability (bd-43520)', () => {
  const src = fs.readFileSync(WORKER, 'utf8');

  it('the resume sweep is still driven from this worker (NIETE has no Railway Cron)', () => {
    // If this moves to Cron the guard below should move with it rather than being
    // deleted — the log condition is the thing being protected, not its address.
    expect(src).toMatch(/ConversationResume\.sweepAndOffer\(/);
  });

  it('every tally field the sweep can return can produce a log line', () => {
    // Find the sweep call and read the condition that follows it.
    const idx = src.indexOf('ConversationResume.sweepAndOffer(');
    expect(idx).toBeGreaterThan(-1);
    const window = src.slice(idx, idx + 600);

    const condition = window.match(/if\s*\(([^)]*res\.[^)]*)\)/);
    expect(condition).not.toBeNull();

    const guarded = condition[1];
    // The four outcomes sweepAndOffer reports. `skippedLocked` is the one that was
    // missing, and it is the only one that can be true on every single interval.
    for (const field of ['offered', 'expired', 'failed', 'skippedLocked']) {
      expect(guarded).toContain(field);
    }
  });

  it('sweepAndOffer really does report skippedLocked — the guard is not pinning a fiction', () => {
    // A guard that asserts a field the service never sets would be worse than no
    // guard: permanently green and permanently meaningless.
    const svc = fs.readFileSync(
      path.resolve(__dirname, '../../bot/shared/services/conversation-resume.service.js'),
      'utf8'
    );
    expect(svc).toMatch(/skippedLocked\s*[:=]/);
    expect(svc).toMatch(/tally\.skippedLocked\s*=\s*true/);
  });
});
