'use strict';
/**
 * bd-v0toag.32.1 — Saturday and Sunday count only for the lesson-plan count and for activation
 * (Amena, 2026-10-16). The report reads from the Saturday before the school week; days used,
 * recordings and thumbs stay Monday to Friday.
 */

const { weekOf } = require('../../../shared/services/coaching/weekly-report/week');
const { summarise, isQuietWeek } = require('../../../shared/services/coaching/weekly-report/summarise');

const empty = () => ({ messages: [], deliveries: [], opens: [], sessions: [], ratings: [] });
// PKT is UTC+5. Sat 10 Oct and Sun 11 Oct are the weekend before the week of Mon 12 Oct.
const SAT = '2026-10-10T05:00:00Z';
const SUN = '2026-10-11T05:00:00Z';
const MON = '2026-10-12T05:00:00Z';

describe('weekOf — the weekend before the school week', () => {
  test('weekendFromIso is the Saturday 00:00 PKT before the Monday', () => {
    const w = weekOf(new Date('2026-10-17T04:30:00Z')); // Sat 17 Oct 09:30 PKT
    expect(w.weekendFromIso).toBe('2026-10-09T19:00:00.000Z'); // Sat 10 Oct 00:00 PKT
    expect(w.fromIso).toBe('2026-10-11T19:00:00.000Z'); // Mon 12 Oct 00:00 PKT, unchanged
  });
});

describe('summarise — weekend rows', () => {
  test('a lesson plan received or opened at the weekend counts', () => {
    const s = summarise({
      ...empty(),
      deliveries: [{ lesson_id: 'L1', created_at: SAT }],
      opens: [{ plan_ref: 'L2', opened_at: SUN }, { plan_ref: 'L3', opened_at: MON }],
    });
    expect(s.lessonPlans).toBe(3);
  });

  test('a weekend day is not a day used', () => {
    const s = summarise({
      ...empty(),
      messages: [{ created_at: '2026-10-10 05:00:00' }],
      deliveries: [{ lesson_id: 'L1', created_at: SUN }],
      opens: [{ plan_ref: 'L2', opened_at: MON }],
    });
    expect(s.daysUsed).toBe(1);
  });

  test('a weekend recording and its thumbs are not counted', () => {
    const s = summarise({
      ...empty(),
      sessions: [{ id: 's1', created_at: SAT }, { id: 's2', created_at: MON }],
      ratings: [
        { coaching_session_id: 's1', user_satisfaction_rating: 1 },
        { coaching_session_id: 's2', user_satisfaction_rating: 0 },
      ],
    });
    expect(s.recordings).toBe(1);
    expect(s.thumbs).toEqual({ up: 0, down: 1 });
  });

  test('a teacher who only messaged at the weekend is active, so the week is not quiet', () => {
    const s = summarise({ ...empty(), messages: [{ created_at: '2026-10-11 06:00:00' }] });
    expect(s.active).toBe(true);
    expect(s.daysUsed).toBe(0);
    expect(isQuietWeek(s)).toBe(false);
  });

  test('no rows at all: not active, quiet', () => {
    const s = summarise(empty());
    expect(s.active).toBe(false);
    expect(isQuietWeek(s)).toBe(true);
  });
});
