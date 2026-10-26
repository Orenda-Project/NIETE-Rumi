'use strict';
/** NIGHTLY_JOB §4 stage 8: one circle moment per coach per sector-week, on the sector's rank-1 W. */
const { pickCircle } = require('../../lib/insights/circle');
const X = require('./fixtures/rollups');

const JOB = X.uuid('a', 1);
const [A, B, Cc, D] = [X.uuid('c', 1), X.uuid('c', 2), X.uuid('c', 3), X.uuid('c', 4)];
const m = (n, w, kind, confidence, at) => ({ id: X.uuid('d', n), w_id: w, kind, confidence, recorded_at: `${at}T05:00:00.000Z` });

describe('pickCircle', () => {
  const momentsByCoach = new Map([
    [A, [m(1, 'W-IP', 'missing', 'medium', '2026-10-28'), m(2, 'W-IP', 'missing', 'high', '2026-10-20'), m(3, 'W-IP', 'missing', 'high', '2026-10-22'),
      m(4, 'W-EXIT', 'missing', 'high', '2026-10-29')]],
    [B, [m(5, 'W-IP', 'good', 'high', '2026-10-21'), m(6, 'W-IP', 'good', 'high', '2026-10-27'), m(7, 'W-EXIT', 'missing', 'high', '2026-10-29')]],
    [Cc, [m(8, 'W-EXIT', 'missing', 'high', '2026-10-29')]],
    [D, [m(9, 'W-IP', 'missing', 'none', '2026-10-29'), m(10, 'W-IP', 'missing', 'medium', '2026-10-01')]],
  ]);
  const rows = pickCircle({ sector: 'Sihala', weekStart: '2026-11-02', coachIds: [A, B, Cc, D], rank1W: 'W-IP', momentsByCoach, jobRunId: JOB });
  const of = (coach) => rows.find((r) => r.coach_user_id === coach);

  test('rows carry exactly the coachip_circle_items columns', () => {
    for (const r of rows) expect(Object.keys(r).sort()).toEqual(['coach_user_id', 'job_run_id', 'moment_id', 'sector', 'week_start']);
    expect(rows.every((r) => r.sector === 'Sihala' && r.week_start === '2026-11-02' && r.job_run_id === JOB)).toBe(true);
  });

  test('highest-confidence missing moment on the rank-1 W, newest among equals', () => {
    expect(of(A).moment_id).toBe(X.uuid('d', 3));
  });

  test('else the newest good moment', () => {
    expect(of(B).moment_id).toBe(X.uuid('d', 6));
  });

  test('else none: a coach with no moment on the W gets no row', () => {
    expect(of(Cc)).toBeUndefined();
    expect(rows).toHaveLength(3);
  });

  test('medium beats none even when older', () => {
    expect(of(D).moment_id).toBe(X.uuid('d', 10));
  });

  test('no rank-1 W, no rows; a coach missing from the map is skipped', () => {
    expect(pickCircle({ sector: 'Sihala', weekStart: '2026-11-02', coachIds: [A], rank1W: null, momentsByCoach, jobRunId: JOB })).toEqual([]);
    expect(pickCircle({ sector: 'Sihala', weekStart: '2026-11-02', coachIds: [X.uuid('c', 9)], rank1W: 'W-IP', momentsByCoach, jobRunId: JOB })).toEqual([]);
  });

  test('a week that does not start on a Monday, or an unknown sector, throws', () => {
    expect(() => pickCircle({ sector: 'Sihala', weekStart: '2026-11-03', coachIds: [A], rank1W: 'W-IP', momentsByCoach, jobRunId: JOB })).toThrow();
    expect(() => pickCircle({ sector: 'Elsewhere', weekStart: '2026-11-02', coachIds: [A], rank1W: 'W-IP', momentsByCoach, jobRunId: JOB })).toThrow();
  });
});
