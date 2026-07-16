/**
 * Unit tests for the attendance repository (Mock implementation) + the
 * computePresence math helper. Focuses on the shape + edge cases Hasnat
 * approved verbatim in the STEPS-P Round 1 spec:
 *   presence_pct = round(present_days / working_days * 100, 1dp)
 *   working_days === 0 → presence_pct = 0
 *   status ∈ {present, absent, leave}
 *   leave_type ∈ {casual, sick, official} when status='leave', else null
 */

const {
  MockAttendanceRepository,
  computePresence,
  validateStatusAndLeaveType,
} = require('../../dashboard/services/attendance-repository.service');

describe('computePresence', () => {
  test('returns zeros for empty input', () => {
    expect(computePresence([])).toEqual({
      present_days: 0, absent_days: 0, leave_days: 0,
      working_days: 0, presence_pct: 0,
    });
  });

  test('handles working_days=0 → presence_pct=0 (division guard)', () => {
    expect(computePresence(null).presence_pct).toBe(0);
    expect(computePresence(undefined).presence_pct).toBe(0);
  });

  test('computes 1dp presence_pct — 2 present / 3 marked = 66.7%', () => {
    const rec = computePresence([
      { date: '2026-07-14', status: 'present' },
      { date: '2026-07-15', status: 'absent' },
      { date: '2026-07-16', status: 'present' },
    ]);
    expect(rec.present_days).toBe(2);
    expect(rec.absent_days).toBe(1);
    expect(rec.leave_days).toBe(0);
    expect(rec.working_days).toBe(3);
    expect(rec.presence_pct).toBe(66.7);
  });

  test('leave days count as marked (working) but not present', () => {
    const rec = computePresence([
      { date: '2026-07-14', status: 'present' },
      { date: '2026-07-15', status: 'leave' },
      { date: '2026-07-16', status: 'leave' },
      { date: '2026-07-17', status: 'present' },
    ]);
    expect(rec.leave_days).toBe(2);
    expect(rec.working_days).toBe(4);
    expect(rec.presence_pct).toBe(50); // 2/4 * 100
  });

  test('duplicate dates counted once for working_days', () => {
    const rec = computePresence([
      { date: '2026-07-14', status: 'present' },
      { date: '2026-07-14', status: 'present' }, // dup
    ]);
    expect(rec.working_days).toBe(1);
    expect(rec.present_days).toBe(2); // status counts unfiltered
  });
});

describe('validateStatusAndLeaveType', () => {
  test('accepts present/absent with no leave_type', () => {
    expect(() => validateStatusAndLeaveType('present', null)).not.toThrow();
    expect(() => validateStatusAndLeaveType('absent', null)).not.toThrow();
  });

  test('rejects unknown status', () => {
    expect(() => validateStatusAndLeaveType('half-day', null)).toThrow(/Invalid status/);
  });

  test('rejects leave without leave_type', () => {
    expect(() => validateStatusAndLeaveType('leave', null)).toThrow(/leave_type required/);
    expect(() => validateStatusAndLeaveType('leave', 'other')).toThrow(/leave_type required/);
  });

  test('accepts leave with valid leave_type', () => {
    expect(() => validateStatusAndLeaveType('leave', 'casual')).not.toThrow();
    expect(() => validateStatusAndLeaveType('leave', 'sick')).not.toThrow();
    expect(() => validateStatusAndLeaveType('leave', 'official')).not.toThrow();
  });

  test('rejects leave_type when status != leave', () => {
    expect(() => validateStatusAndLeaveType('present', 'casual')).toThrow(/must be null/);
  });
});

describe('MockAttendanceRepository', () => {
  const SCHOOL = 'school-uuid-1';
  const PRINCIPAL = 'user-uuid-p';
  const T1 = 'user-uuid-t1';
  const T2 = 'user-uuid-t2';

  function seedRepo() {
    return new MockAttendanceRepository({
      teachers: [
        { id: T1, first_name: 'Aisha', last_name: 'Rehman', phone_number: '923001111111', role: 'teacher', school_id: SCHOOL },
        { id: T2, first_name: 'Bilal', last_name: 'Khan', phone_number: '923002222222', role: 'teacher', school_id: SCHOOL },
        { id: PRINCIPAL, first_name: 'Sana', last_name: 'Iqbal', phone_number: '923003333333', role: 'principal', school_id: SCHOOL },
      ],
      records: [],
    });
  }

  test('getTeachersBySchool returns only teachers (not principals)', async () => {
    const repo = seedRepo();
    const teachers = await repo.getTeachersBySchool(SCHOOL);
    expect(teachers).toHaveLength(2);
    expect(teachers.map((t) => t.id).sort()).toEqual([T1, T2].sort());
  });

  test('saveAttendance upserts one row per (teacher, date)', async () => {
    const repo = seedRepo();
    await repo.saveAttendance({
      teacher_id: T1, school_id: SCHOOL, date: '2026-07-16',
      status: 'present', leave_type: null, marked_by_user_id: PRINCIPAL,
    });
    await repo.saveAttendance({
      teacher_id: T1, school_id: SCHOOL, date: '2026-07-16',
      status: 'absent', leave_type: null, marked_by_user_id: PRINCIPAL,
    });
    const recs = await repo.getAttendanceForTeacher(T1, null, null);
    expect(recs).toHaveLength(1); // upsert: not two rows
    expect(recs[0].status).toBe('absent');
  });

  test('saveAttendance rejects leave without leave_type', async () => {
    const repo = seedRepo();
    await expect(repo.saveAttendance({
      teacher_id: T1, school_id: SCHOOL, date: '2026-07-16',
      status: 'leave', leave_type: null, marked_by_user_id: PRINCIPAL,
    })).rejects.toThrow(/leave_type required/);
  });

  test('getPresence by teacher_id returns the approved Hasnat shape', async () => {
    const repo = seedRepo();
    await repo.saveAttendance({ teacher_id: T1, school_id: SCHOOL, date: '2026-07-14', status: 'present', marked_by_user_id: PRINCIPAL });
    await repo.saveAttendance({ teacher_id: T1, school_id: SCHOOL, date: '2026-07-15', status: 'absent', marked_by_user_id: PRINCIPAL });
    await repo.saveAttendance({ teacher_id: T1, school_id: SCHOOL, date: '2026-07-16', status: 'leave', leave_type: 'sick', marked_by_user_id: PRINCIPAL });

    const p = await repo.getPresence({ teacher_id: T1 });
    expect(p).toEqual({
      teacher_id: T1,
      mobile: '923001111111',
      school_id: SCHOOL,
      period_start: null,
      period_end: null,
      present_days: 1,
      absent_days: 1,
      leave_days: 1,
      working_days: 3,
      presence_pct: 33.3,
    });
  });

  test('getPresence by mobile resolves to teacher', async () => {
    const repo = seedRepo();
    await repo.saveAttendance({ teacher_id: T2, school_id: SCHOOL, date: '2026-07-16', status: 'present', marked_by_user_id: PRINCIPAL });
    const p = await repo.getPresence({ mobile: '923002222222' });
    expect(p.teacher_id).toBe(T2);
    expect(p.present_days).toBe(1);
    expect(p.presence_pct).toBe(100);
  });

  test('getPresence by school_id returns array — one row per teacher', async () => {
    const repo = seedRepo();
    await repo.saveAttendance({ teacher_id: T1, school_id: SCHOOL, date: '2026-07-16', status: 'present', marked_by_user_id: PRINCIPAL });
    await repo.saveAttendance({ teacher_id: T2, school_id: SCHOOL, date: '2026-07-16', status: 'absent', marked_by_user_id: PRINCIPAL });
    const rows = await repo.getPresence({ school_id: SCHOOL });
    expect(Array.isArray(rows)).toBe(true);
    expect(rows).toHaveLength(2);
    const t1row = rows.find((r) => r.teacher_id === T1);
    const t2row = rows.find((r) => r.teacher_id === T2);
    expect(t1row.presence_pct).toBe(100);
    expect(t2row.presence_pct).toBe(0);
  });

  test('getPresence with no selector throws', async () => {
    const repo = seedRepo();
    await expect(repo.getPresence({})).rejects.toThrow(/one of teacher_id/);
  });
});
