import { describe, it, expect } from 'vitest';
import type { RemarkReceived, SchoolAnalytics, SchoolPresence } from '../../types/portal';
import type { ProgressCounts } from '../../newui/home/progressApi';
import {
  activityKpis, areaRows, bandTrend, BAND_ROWS, observationKpis, presenceRows, previousRange, remarkItems,
} from './model';
import { ANALYTICS_V2_COPY as C } from './copy';

/**
 * bd-fmf24g.8 — Analytics (v28 canvas): every number from the existing GET /progress (this period and
 * the one before) and GET /my-analytics; ratings shown as BANDS, never numbers.
 */

const cur: ProgressCounts = {
  lessonPlans: { used: 14 }, training: { completed: 6 }, assessments: { made: 4 },
  attendance: { days: 18 }, coaching: { total: 12, digitalCoach: 9, observations: 3 },
};
const prev: ProgressCounts = {
  lessonPlans: { used: 11 }, training: { completed: 6 }, assessments: { made: 5 },
  attendance: { days: 18 }, coaching: { digitalCoach: 7, observations: 3 },
};

describe('activityKpis / observationKpis', () => {
  it('lesson plans, modules, papers and attendance days, each with its change against the period before', () => {
    expect(activityKpis(cur, prev)).toEqual([
      { value: 14, label: C.lessonPlansUsed, delta: 3 },
      { value: 6, label: C.modulesDone, delta: 0 },
      { value: 4, label: C.papersMade, delta: -1 },
      { value: 18, label: C.attendanceDays, delta: 0 },
    ]);
    expect(observationKpis(cur, prev)).toEqual([
      { value: 3, label: C.observations, delta: 0 },
      { value: 9, label: C.digitalCoaching, delta: 2 },
    ]);
  });

  it('no period before (All time) → no change; a missing count → no value, never a made-up 0', () => {
    expect(activityKpis(cur, null).map((k) => k.delta)).toEqual([undefined, undefined, undefined, undefined]);
    const [lp, mod] = activityKpis({ training: {} }, prev);
    expect(lp).toEqual({ value: null, label: C.lessonPlansUsed });
    expect(mod).toEqual({ value: null, label: C.modulesDone });
  });
});

describe('previousRange', () => {
  it('the period before, as a custom range for GET /progress; none for All time', () => {
    expect(previousRange({ prevFrom: '2026-09-01', prevTo: '2026-09-08' })).toEqual({ key: 'custom', from: '2026-09-01', to: '2026-09-08' });
    expect(previousRange({ prevFrom: null, prevTo: null })).toBeNull();
  });
});

describe('bandTrend', () => {
  it('oldest first, each point on its band row (Excellent on top); a point with no score is left out', () => {
    const trend = [
      { date: '2026-09-28', percentage: 66, points: null, maxPoints: null, teacherName: null },
      { date: '2026-08-12', percentage: 45, points: null, maxPoints: null, teacherName: null },
      { date: '2026-09-03', percentage: 82, points: null, maxPoints: null, teacherName: null },
      { date: '2026-09-10', percentage: null as unknown as number, points: null, maxPoints: null, teacherName: null },
    ];
    expect(BAND_ROWS.map((b) => b.label)).toEqual(['Excellent', 'Good', 'Average', 'Below average', 'Needs support']);
    expect(bandTrend(trend)).toEqual([
      { date: '2026-08-12', row: 2, band: 'Average' },
      { date: '2026-09-03', row: 0, band: 'Excellent' },
      { date: '2026-09-28', row: 1, band: 'Good' },
    ]);
  });
});

describe('areaRows', () => {
  it('strongest to weakest with each band; the weakest is the focus', () => {
    const areas: NonNullable<SchoolAnalytics['areas']> = [
      { key: 'e', name: 'Engagement', pct: 64, band: 'good', observations: 3 },
      { key: 's', name: 'Subject knowledge', pct: 51, band: 'average', observations: 3 },
      { key: 't', name: 'Teaching skills', pct: 72, band: 'good', observations: 3 },
    ];
    expect(areaRows(areas)).toEqual([
      { key: 't', name: 'Teaching skills', band: 'Good', width: 72, focus: false },
      { key: 'e', name: 'Engagement', band: 'Good', width: 64, focus: false },
      { key: 's', name: 'Subject knowledge', band: 'Average', width: 51, focus: true },
    ]);
    expect(areaRows([areas[0]])[0].focus).toBe(false);
    expect(areaRows(undefined)).toEqual([]);
  });
});

describe('presenceRows', () => {
  it('her own days (leave left out of "of") and her students, each only when something was marked', () => {
    const p: SchoolPresence = {
      teacher: { records: 21, present: 19, absent: 1, leave: 1, presentPct: 95 },
      student: { sessions: 40, totalMarked: 1200, present: 1044, presentPct: 87 },
    };
    expect(presenceRows(p)).toEqual({ teacher: { pct: 95, present: 19, of: 20 }, students: { pct: 87 } });
    expect(presenceRows({ teacher: { ...p.teacher, presentPct: null }, student: { ...p.student, presentPct: null } }))
      .toEqual({ teacher: null, students: null });
  });
});

describe('remarkItems', () => {
  it('newest first: its date, the cycle, the comment; with no comment, each area and its band', () => {
    const remarks: RemarkReceived[] = [
      { cycleName: 'Q1', submittedAt: '2026-07-02T09:00:00Z', comment: null, areas: [{ ordinal: 1, name: 'Planning', score: 3 }] },
      { cycleName: 'Q2', submittedAt: '2026-09-28T09:00:00Z', comment: 'Good use of the board.', areas: [] },
    ];
    expect(remarkItems(remarks)).toEqual([
      { key: '2026-09-28T09:00:00Z-1', date: '28 Sep', cycle: 'Q2', comment: 'Good use of the board.', areas: [] },
      { key: '2026-07-02T09:00:00Z-0', date: '2 Jul', cycle: 'Q1', comment: null, areas: [{ name: 'Planning', band: 'Good' }] },
    ]);
  });
});
