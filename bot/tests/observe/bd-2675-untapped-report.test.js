/**
 * bd-2675 — a report that is waiting on the teacher's tap (TDD, red-first).
 *
 * Riffat R30 said Rumi "does not send the report" to a teacher who isn't in the
 * ICT database. That premise is wrong — there is no registration gate. What
 * actually happens: a teacher outside the 24-hour window gets an approved
 * UTILITY template she must TAP, and only then does the report itself arrive.
 * The coach is told it was sent and never learns it is sitting unopened.
 *
 * Operator decision (2026-08-13): nudge the teacher — "but please make sure
 * that we have events that tell her when the teacher has tapped, otherwise we
 * end up trapping them forever."
 *
 * So this is deliberately BOUNDED and EVENT-CLOSED:
 *   • the tap is recorded (tapped_at) and the coach is told when it happens;
 *   • at most ONE nudge, and only after a day of silence;
 *   • after that we stop and tell the coach plainly, rather than nudging a
 *     teacher forever or leaving the coach guessing.
 *
 * Pure planner + worker execution, mirroring coaching-stale-recovery.js.
 */

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';
process.env.OBSERVE_FRAMEWORK = 'fico';

const {
  classifyUntappedDelivery, NUDGE_AFTER_MS, GIVE_UP_AFTER_MS,
} = require('../../shared/services/observe/observe-untapped.service');
const { parseTeacherDetails } = require('../../shared/services/observe/observe-send.service');

const HOUR = 60 * 60 * 1000;
const T0 = Date.parse('2026-08-13T09:00:00Z');
const at = (h) => T0 + h * HOUR;

const waiting = (over = {}) => ({
  status: 'awaiting_teacher_tap',
  template_sent_at: new Date(T0).toISOString(),
  ...over,
});

describe('bd-2675 — when to nudge, and when to stop', () => {
  it('leaves a fresh send alone', () => {
    expect(classifyUntappedDelivery(waiting(), at(1)).action).toBe('skip');
  });

  it('nudges once after a day of silence', () => {
    const out = classifyUntappedDelivery(waiting(), at(25));
    expect(out.action).toBe('nudge');
  });

  it('never nudges twice — this is the trap the operator called out', () => {
    const nudged = waiting({ nudged_at: new Date(at(25)).toISOString(), nudge_count: 1 });
    expect(classifyUntappedDelivery(nudged, at(26)).action).toBe('skip');
    expect(classifyUntappedDelivery(nudged, at(40)).action).toBe('skip');
    // …and eventually gives up rather than nudging again
    expect(classifyUntappedDelivery(nudged, at(200)).action).toBe('give_up');
  });

  it('stops entirely once the teacher has tapped', () => {
    for (const t of [at(1), at(25), at(200)]) {
      expect(classifyUntappedDelivery(waiting({ tapped_at: new Date(at(0.5)).toISOString() }), t).action).toBe('skip');
    }
  });

  it('ignores deliveries that are not waiting on a tap', () => {
    for (const status of ['sent', 'cancelled', 'awaiting_confirm', 'previewing', 'operator_review']) {
      expect(classifyUntappedDelivery(waiting({ status }), at(200)).action).toBe('skip');
    }
  });

  it('never acts on a delivery with no send timestamp (no guessing)', () => {
    expect(classifyUntappedDelivery(waiting({ template_sent_at: null }), at(200)).action).toBe('skip');
    expect(classifyUntappedDelivery(waiting({ template_sent_at: 'not-a-date' }), at(200)).action).toBe('skip');
  });

  it('gives up only after the nudge has had time to land', () => {
    const nudged = waiting({ nudged_at: new Date(at(25)).toISOString(), nudge_count: 1 });
    expect(classifyUntappedDelivery(nudged, at(25) + GIVE_UP_AFTER_MS - HOUR).action).toBe('skip');
    expect(classifyUntappedDelivery(nudged, at(25) + GIVE_UP_AFTER_MS + HOUR).action).toBe('give_up');
  });

  it('gives up once, not repeatedly', () => {
    const done = waiting({ nudged_at: new Date(at(25)).toISOString(), nudge_count: 1, gave_up_at: new Date(at(100)).toISOString() });
    expect(classifyUntappedDelivery(done, at(300)).action).toBe('skip');
  });

  it('exposes sane windows', () => {
    expect(NUDGE_AFTER_MS).toBeGreaterThanOrEqual(12 * HOUR);
    expect(GIVE_UP_AFTER_MS).toBeGreaterThan(NUDGE_AFTER_MS);
  });
});

describe('bd-2675 — the number a coach types', () => {
  it('still accepts the formats it always did', () => {
    expect(parseTeacherDetails('Ayesha 03001234567')).toEqual({ name: 'Ayesha', phone: '923001234567' });
    expect(parseTeacherDetails('Ayesha +92 300 1234567')).toEqual({ name: 'Ayesha', phone: '923001234567' });
  });

  it('accepts a number written with the country code and no plus', () => {
    expect(parseTeacherDetails('Ayesha 923001234567')).toEqual({ name: 'Ayesha', phone: '923001234567' });
  });

  it('accepts a bare 10-digit mobile (no leading zero) — a common way to type it', () => {
    expect(parseTeacherDetails('Ayesha 3001234567')).toEqual({ name: 'Ayesha', phone: '923001234567' });
  });

  it('accepts dashes and brackets', () => {
    expect(parseTeacherDetails('Ayesha (0300) 123-4567')).toEqual({ name: 'Ayesha', phone: '923001234567' });
  });

  it('still refuses something that is not a mobile number', () => {
    expect(parseTeacherDetails('Ayesha 051 9201234')).toBeNull();   // landline
    expect(parseTeacherDetails('03001234567')).toBeNull();          // no name
    expect(parseTeacherDetails('Ayesha')).toBeNull();               // no number
  });
});
