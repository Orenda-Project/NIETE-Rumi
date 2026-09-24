'use strict';
/**
 * bd-60174 (STEPS v1.1, principal-dashboard feedback item 3).
 *
 * "All features engagement data should be visible on this view." The landing
 * view shows headline tiles across the whole patch, so each feature needs a
 * patch-wide total beside the per-teacher counts — otherwise the principal can
 * see one teacher's attendance but not her school's.
 *
 * summarizePatch is a pure aggregation over getPatchTeachers' output, so these
 * totals cost no extra round-trip.
 *
 * The reach counts (how many teachers have touched a feature AT ALL) matter
 * more than the totals for this view: "21 registers" across 19 teachers reads
 * as healthy right up until you learn one teacher took all 21.
 */

const { summarizePatch } = require('../../dashboard/services/leader-overview.service');

const teacher = (over = {}) => ({
  onRumi: true,
  coachingSessions: 0,
  observations: 0,
  lessonPlans: 0,
  attendanceSessions: 0,
  trainingModules: 0,
  lastScore: null,
  ...over,
});

describe('the patch summary speaks for every feature', () => {
  test('totals attendance registers and completed training across the patch', () => {
    const out = summarizePatch([
      teacher({ attendanceSessions: 12, trainingModules: 3 }),
      teacher({ attendanceSessions: 9, trainingModules: 1 }),
      teacher({ attendanceSessions: 0, trainingModules: 0 }),
    ]);
    expect(out.totalAttendanceSessions).toBe(21);
    expect(out.totalTrainingModules).toBe(4);
  });

  test('counts how many teachers have actually touched each feature', () => {
    // One teacher taking every register is a different school from three
    // teachers taking seven each, and the totals alone cannot tell them apart.
    const out = summarizePatch([
      teacher({ attendanceSessions: 21, trainingModules: 0 }),
      teacher({ attendanceSessions: 0, trainingModules: 2 }),
      teacher({ attendanceSessions: 0, trainingModules: 0 }),
    ]);
    expect(out.teachersMarkingAttendance).toBe(1);
    expect(out.teachersInTraining).toBe(1);
  });

  test('an empty patch reports zeroes, never NaN or null', () => {
    const out = summarizePatch([]);
    expect(out.totalAttendanceSessions).toBe(0);
    expect(out.totalTrainingModules).toBe(0);
    expect(out.teachersMarkingAttendance).toBe(0);
    expect(out.teachersInTraining).toBe(0);
  });

  test('a teacher missing the new fields is counted as zero, not skipped', () => {
    const legacy = teacher();
    delete legacy.attendanceSessions;
    delete legacy.trainingModules;
    const out = summarizePatch([legacy, teacher({ attendanceSessions: 5 })]);
    expect(out.totalAttendanceSessions).toBe(5);
    expect(Number.isNaN(out.totalTrainingModules)).toBe(false);
    expect(out.totalTrainingModules).toBe(0);
  });

  test('the figures it already reported are unchanged', () => {
    const out = summarizePatch([
      teacher({ coachingSessions: 2, lessonPlans: 4, lastScore: 60 }),
      teacher({ coachingSessions: 1, lessonPlans: 1, lastScore: 80 }),
    ]);
    expect(out.totalTeachers).toBe(2);
    expect(out.totalCoachingSessions).toBe(3);
    expect(out.totalLessonPlans).toBe(5);
    expect(out.avgLastScore).toBe(70);
  });
});
