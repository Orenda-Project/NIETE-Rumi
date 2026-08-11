/**
 * attendance-write.service — the ONE write path.
 *
 * Deliberately a service, not logic buried in a Flow handler: the portal will hit
 * the same function through an HTTP route later, and the whole point of a single
 * write path is that WhatsApp and the portal cannot disagree about a day's numbers.
 *
 * Also encodes the two rules the old flow got wrong:
 *   - mark by EXCEPTION — anyone not named is present, so a 30-student class is
 *     a couple of taps rather than thirty;
 *   - re-marking a day REPLACES it instead of dead-ending on a duplicate.
 */

const mockSupabase = { from: jest.fn() };
jest.mock('../../bot/shared/config/supabase', () => mockSupabase);
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const svc = require('../../bot/shared/services/attendance-write.service');

/** Minimal chainable Supabase double: records every insert/update/delete. */
function harness({ existingSession = null } = {}) {
  const calls = { inserts: {}, updates: {}, deletes: [] };
  mockSupabase.from.mockImplementation((table) => ({
    select: () => ({
      eq: () => ({
        eq: () => ({
          eq: () => ({ maybeSingle: () => Promise.resolve({ data: existingSession, error: null }) }),
          maybeSingle: () => Promise.resolve({ data: existingSession, error: null }),
          order: () => Promise.resolve({ data: [], error: null }),
        }),
        order: () => Promise.resolve({ data: [], error: null }),
        maybeSingle: () => Promise.resolve({ data: existingSession, error: null }),
      }),
    }),
    insert: (rows) => {
      calls.inserts[table] = (calls.inserts[table] || []).concat(rows);
      return {
        select: () => ({ single: () => Promise.resolve({ data: { id: `${table}-1` }, error: null }) }),
        then: (r) => r({ data: null, error: null }),
      };
    },
    // Teachers go through upsert (one row per teacher per day), students through
    // insert — record both the same way so assertions read alike.
    upsert: (rows) => {
      calls.inserts[table] = (calls.inserts[table] || []).concat(rows);
      return Promise.resolve({ data: null, error: null });
    },
    update: (patch) => ({
      eq: () => {
        calls.updates[table] = (calls.updates[table] || []).concat(patch);
        return Promise.resolve({ data: null, error: null });
      },
    }),
    delete: () => ({
      eq: (col, val) => { calls.deletes.push({ table, col, val }); return Promise.resolve({ error: null }); },
    }),
  }));
  return calls;
}

const ROSTER = [
  { id: 's1', student_name: 'Ayesha Bibi' },
  { id: 's2', student_name: 'Ahmed Raza' },
  { id: 's3', student_name: 'Fatima Noor' },
  { id: 's4', student_name: 'Bilal Hussain' },
];

beforeEach(() => jest.clearAllMocks());

describe('markStudents — by exception', () => {
  it('marks everyone not named as present', async () => {
    const calls = harness();

    await svc.markStudents({
      userId: 'u1', listId: 'c1', date: '2026-08-10',
      roster: ROSTER, absentIds: ['s2'], leaveIds: [],
    });

    const records = calls.inserts.attendance_records;
    expect(records).toHaveLength(4);
    const byName = Object.fromEntries(records.map((r) => [r.student_name, r.status]));
    expect(byName).toEqual({
      'Ayesha Bibi': 'present',
      'Ahmed Raza': 'absent',
      'Fatima Noor': 'present',
      'Bilal Hussain': 'present',
    });
  });

  it('records leave as its own status, not folded into absent', async () => {
    const calls = harness();

    await svc.markStudents({
      userId: 'u1', listId: 'c1', date: '2026-08-10',
      roster: ROSTER, absentIds: ['s2'], leaveIds: ['s4'], leaveType: 'sick',
    });

    const records = calls.inserts.attendance_records;
    expect(records.find((r) => r.student_name === 'Bilal Hussain').status).toBe('leave');
    expect(records.find((r) => r.student_name === 'Ahmed Raza').status).toBe('absent');
  });

  it('writes the three tallies onto the session', async () => {
    const calls = harness();

    await svc.markStudents({
      userId: 'u1', listId: 'c1', date: '2026-08-10',
      roster: ROSTER, absentIds: ['s2'], leaveIds: ['s4'], leaveType: 'casual',
    });

    const [session] = calls.inserts.attendance_sessions;
    expect(session).toMatchObject({
      total_students: 4, present_count: 2, absent_count: 1, leave_count: 1,
    });
  });

  it('a student in both lists counts once, as leave', async () => {
    const calls = harness();

    await svc.markStudents({
      userId: 'u1', listId: 'c1', date: '2026-08-10',
      roster: ROSTER, absentIds: ['s2'], leaveIds: ['s2'], leaveType: 'sick',
    });

    const records = calls.inserts.attendance_records;
    expect(records.filter((r) => r.student_name === 'Ahmed Raza')).toHaveLength(1);
    expect(records.find((r) => r.student_name === 'Ahmed Raza').status).toBe('leave');
    const [session] = calls.inserts.attendance_sessions;
    expect(session).toMatchObject({ absent_count: 0, leave_count: 1, present_count: 3 });
  });

  it('returns a summary that names who was marked, for the confirmation screen', async () => {
    harness();

    const res = await svc.markStudents({
      userId: 'u1', listId: 'c1', date: '2026-08-10',
      roster: ROSTER, absentIds: ['s2'], leaveIds: ['s4'], leaveType: 'official',
    });

    expect(res.summary).toMatchObject({ present: 2, absent: 1, leave: 1 });
    expect(res.absentNames).toEqual(['Ahmed Raza']);
    expect(res.leaveNames).toEqual(['Bilal Hussain']);
    expect(res.leaveType).toBe('official');
  });

  it('refuses an empty roster rather than writing a meaningless session', async () => {
    harness();
    await expect(svc.markStudents({
      userId: 'u1', listId: 'c1', date: '2026-08-10', roster: [], absentIds: [], leaveIds: [],
    })).rejects.toThrow(/roster/i);
  });
});

describe('re-marking a day replaces it', () => {
  it('deletes the old records and updates the session in place', async () => {
    const calls = harness({ existingSession: { id: 'old-1', total_students: 4 } });

    const res = await svc.markStudents({
      userId: 'u1', listId: 'c1', date: '2026-08-10',
      roster: ROSTER, absentIds: ['s1'], leaveIds: [],
    });

    expect(calls.deletes).toEqual([
      { table: 'attendance_records', col: 'session_id', val: 'old-1' },
    ]);
    expect(calls.updates.attendance_sessions[0]).toMatchObject({
      was_manually_edited: true, absent_count: 1, present_count: 3,
    });
    expect(res.replaced).toBe(true);
    expect(calls.inserts.attendance_sessions).toBeUndefined();   // no second session row
  });
});

describe('markTeachers — the principal path, same shape', () => {
  const STAFF = [
    { id: 't1', first_name: 'Rubina', last_name: 'Idress' },
    { id: 't2', first_name: 'Ume', last_name: 'kulsoom' },
    { id: 't3', first_name: null, last_name: null, phone_number: '923051686049' },
  ];

  it('writes one row per teacher through the shared teacher table', async () => {
    const calls = harness();

    await svc.markTeachers({
      principalUserId: 'p1', schoolId: 'sch1', date: '2026-08-10',
      staff: STAFF, absentIds: ['t2'], leaveIds: [],
    });

    const rows = calls.inserts.teacher_attendance_records;
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.school_id === 'sch1')).toBe(true);
    expect(rows.every((r) => r.marked_by_user_id === 'p1')).toBe(true);
    expect(rows.find((r) => r.teacher_id === 't2').status).toBe('absent');
  });

  it('falls back to the phone number when a migrated teacher has no name', async () => {
    harness();

    const res = await svc.markTeachers({
      principalUserId: 'p1', schoolId: 'sch1', date: '2026-08-10',
      staff: STAFF, absentIds: ['t3'], leaveIds: [],
    });

    // A blank row on the confirmation screen reads as a bug; show something real.
    expect(res.absentNames).toEqual(['923051686049']);
  });

  it('carries leave_type onto the leave rows only', async () => {
    const calls = harness();

    await svc.markTeachers({
      principalUserId: 'p1', schoolId: 'sch1', date: '2026-08-10',
      staff: STAFF, absentIds: [], leaveIds: ['t1'], leaveType: 'casual',
    });

    const rows = calls.inserts.teacher_attendance_records;
    expect(rows.find((r) => r.teacher_id === 't1')).toMatchObject({ status: 'leave', leave_type: 'casual' });
    expect(rows.find((r) => r.teacher_id === 't2').leave_type).toBeNull();
  });
});
