'use strict';
/**
 * bd-60174 (STEPS v1.1, principal-dashboard feedback item 3).
 *
 * Asked for: "it should be organised by STEPS features and teachers list so the
 * principal can track each teachers progress feature by feature… All features
 * engagement data should be visible on this view."
 *
 * The patch row could not answer that. It carried coaching sessions,
 * observations, lesson plans, a last score and a focus area — and nothing for
 * attendance or training, two of the features the principal is being asked to
 * track. A view cannot be organised by feature while the row has no per-feature
 * numbers on it.
 *
 * So the row gains two counts, from tables that already exist:
 *
 *   attendanceSessions — registers SHE took (attendance_sessions.user_id): her
 *                        students' attendance, an act she performed. NOT
 *                        teacher_attendance_records, which is somebody marking
 *                        HER present — a different question on a different key.
 *
 *   trainingModules    — modules she COMPLETED
 *                        (teacher_training_progress.completed_at IS NOT NULL).
 *                        Assignment is not engagement: 89 people were assigned
 *                        I-SAPS on prod and 88 could not reach it, so counting
 *                        assignments reports a busy school where nothing
 *                        happened.
 *
 * Both live in the shared LATERAL block, which is deliberately ONE constant and
 * not two copies: the moment a stat is defined twice the definitions drift, and
 * "the principal's numbers disagree with the coach's for the same teacher" is an
 * unfalsifiable bug report.
 *
 * `getPatchTeachers` takes an injected `query(sql, params)`, so the real
 * resolver runs here against a fake at the database boundary.
 */

const {
  getPatchTeachers,
  PATCH_TEACHERS_SQL,
  PRINCIPAL_PATCH_SQL,
} = require('../../dashboard/services/leader-patch.service');

/** A teacher who uses every feature — counts arrive from pg as strings. */
const ENGAGED = {
  teacher_ext_id: '923001234567',
  name: 'Irene Khan',
  phone: '923001234567',
  role: 'teacher',
  rumi_user_id: 'u-engaged',
  coaching_sessions: '3',
  observations: '1',
  lesson_plans: '12',
  attendance_sessions: '21',
  training_modules: '4',
  last_analysis_data: null,
  last_session_at: '2026-09-15T06:00:00Z',
  school_name: 'IMSG (I-V) Humak',
  school_ext_id: 'niete:1234',
};

/** Nobody has touched a feature: every LATERAL COALESCEs to 0, never null. */
const UNTOUCHED = {
  ...ENGAGED,
  teacher_ext_id: '923009999999',
  phone: '923009999999',
  rumi_user_id: 'u-untouched',
  coaching_sessions: '0',
  observations: '0',
  lesson_plans: '0',
  attendance_sessions: '0',
  training_modules: '0',
};

/**
 * An older response, or a caller on a stale deploy, sends no such columns. A
 * missing count must read as 0 — never NaN, never undefined, both of which
 * render as a broken tile rather than an empty one.
 */
const LEGACY_ROW = {
  ...ENGAGED,
  teacher_ext_id: '923008888888',
  phone: '923008888888',
  rumi_user_id: 'u-legacy',
  attendance_sessions: undefined,
  training_modules: undefined,
};

function fakeQuery(rows) {
  const calls = [];
  const fn = async (sql, params) => { calls.push({ sql, params }); return { rows }; };
  fn.calls = calls;
  return fn;
}

const byId = (list, id) => list.find((t) => t.rumiUserId === id);

describe('the patch SQL asks for the per-feature counts', () => {
  test('both entry points count the attendance registers she took', () => {
    expect(PATCH_TEACHERS_SQL).toMatch(/attendance_sessions/);
    expect(PRINCIPAL_PATCH_SQL).toMatch(/attendance_sessions/);
  });

  test('both entry points count COMPLETED training modules, not assignments', () => {
    expect(PATCH_TEACHERS_SQL).toMatch(/teacher_training_progress/);
    expect(PRINCIPAL_PATCH_SQL).toMatch(/teacher_training_progress/);
    expect(PATCH_TEACHERS_SQL).toMatch(/completed_at/);
  });

  test('the coach and the principal share one definition of every stat', () => {
    for (const fragment of ['attendance_sessions', 'teacher_training_progress']) {
      const re = new RegExp(fragment, 'g');
      const inCoach = (PATCH_TEACHERS_SQL.match(re) || []).length;
      const inPrincipal = (PRINCIPAL_PATCH_SQL.match(re) || []).length;
      expect(inCoach).toBe(inPrincipal);
    }
  });
});

describe('every teacher row carries her per-feature engagement', () => {
  test('the counts reach the row as numbers, not pg strings', async () => {
    const out = await getPatchTeachers(fakeQuery([ENGAGED]), 'coach-1');
    const her = byId(out, 'u-engaged');
    expect(her.attendanceSessions).toBe(21);
    expect(her.trainingModules).toBe(4);
  });

  test('a teacher who has used nothing reads 0, not null', async () => {
    const out = await getPatchTeachers(fakeQuery([UNTOUCHED]), 'coach-1');
    const her = byId(out, 'u-untouched');
    expect(her.attendanceSessions).toBe(0);
    expect(her.trainingModules).toBe(0);
  });

  test('a row without the new columns degrades to 0 rather than NaN', async () => {
    const out = await getPatchTeachers(fakeQuery([LEGACY_ROW]), 'coach-1');
    const her = byId(out, 'u-legacy');
    expect(her.attendanceSessions).toBe(0);
    expect(her.trainingModules).toBe(0);
    expect(Number.isNaN(her.attendanceSessions)).toBe(false);
  });

  test('the counts it already had are untouched', async () => {
    const out = await getPatchTeachers(fakeQuery([ENGAGED]), 'coach-1');
    const her = byId(out, 'u-engaged');
    expect(her.coachingSessions).toBe(3);
    expect(her.observations).toBe(1);
    expect(her.lessonPlans).toBe(12);
  });
});
