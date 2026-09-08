/**
 * bd-n6fl1 — the age ceiling that stops the first fixed sweep becoming a storm.
 *
 * Fixing the blindness means the sweep suddenly SEES a backlog that built up
 * while it could not: measured on prod 2026-09-08, 31 reports overdue for their
 * first nudge, 21 of them 7.3 to 12.4 days old. Nudging a teacher about an
 * observation report from twelve days ago is not the bounded chase bd-2675
 * designed; it is a spam wave with our name on it.
 *
 * So a delivery that has been sitting untouched past the ceiling is CLOSED
 * SILENTLY — no template to the teacher, no message to the coach — which is
 * database-engineering §2 J6 ("rows too old to act on are closed silently, not
 * messaged"). The bounded chase itself is unchanged for anything inside the
 * ceiling, and give_up still tells the coach, because that is the closing act
 * the operator asked for and it fires once.
 */

const {
  classifyUntappedDelivery, NUDGE_AFTER_MS, GIVE_UP_AFTER_MS, EXPIRE_AFTER_MS,
} = require('../../bot/shared/services/observe/observe-untapped.service');

const HOUR = 60 * 60 * 1000;
const NOW = Date.parse('2026-09-08T12:00:00.000Z');
const at = (hoursAgo) => new Date(NOW - hoursAgo * HOUR).toISOString();
const waiting = (extra = {}) => ({ status: 'awaiting_teacher_tap', template_sent_at: at(0), ...extra });

describe('the untapped age ceiling', () => {
  it('exports a ceiling longer than the whole designed chase', () => {
    expect(EXPIRE_AFTER_MS).toBeGreaterThan(NUDGE_AFTER_MS + GIVE_UP_AFTER_MS);
  });

  it('a report never chased and older than the ceiling is expired, not nudged', () => {
    const d = waiting({ template_sent_at: at(12 * 24) });
    expect(classifyUntappedDelivery(d, NOW)).toEqual({ action: 'expire', reason: 'too_old_to_chase' });
  });

  it('a report just inside the ceiling is still nudged — the fix is a ceiling, not a mute', () => {
    const d = waiting({ template_sent_at: at(5 * 24) });
    expect(classifyUntappedDelivery(d, NOW).action).toBe('nudge');
  });

  it('an ALREADY-nudged report still ends in give_up, so the coach is told once', () => {
    const d = waiting({ template_sent_at: at(14 * 24), nudged_at: at(11 * 24), nudge_count: 1 });
    expect(classifyUntappedDelivery(d, NOW).action).toBe('give_up');
  });

  it('the grace window still wins over everything', () => {
    expect(classifyUntappedDelivery(waiting({ template_sent_at: at(3) }), NOW).action).toBe('skip');
  });
});
