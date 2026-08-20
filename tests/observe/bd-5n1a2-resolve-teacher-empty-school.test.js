'use strict';
/**
 * bd-5n1a2 — the observe visit picker silently failed to bind the teacher when
 * the schedule row carried school_ext_id = "" (live 2026-08-21, staging leader
 * b2d42789…: teacher "name:test-bilal-ahmed" exists in leader_teachers under
 * school "test:9001", but `.eq('school_ext_id', '')` filtered the roster to
 * zero rows because '' != null in JS). The capture then ran UNBOUND: the report
 * went to the coach instead of the teacher and the bd-2668 "who did you
 * observe?" list fired even though the coach had just picked the teacher.
 *
 * Contract locked here:
 *  1. '' / undefined school → NO school filter (the ext-id is already
 *     leader-scoped, so this is safe).
 *  2. A school-filtered miss retries once WITHOUT the filter before giving up —
 *     a stale/wrong school value must not cost the binding.
 */

const rows = {
  // leader_teachers fixture: the test teacher lives under school "test:9001"
  teachers: [
    { teacher_ext_id: 'name:test-bilal-ahmed', teacher_name: 'Bilal Ahmed (TEST)', teacher_phone_e164: '923365709413', school_ext_id: 'test:9001', level: null },
    { teacher_ext_id: '923165100453', teacher_name: 'Adeela Gulshan', teacher_phone_e164: '923165100453', school_ext_id: 'niete:909', level: null },
  ],
};

function chain(result) {
  const q = {
    eq: jest.fn(() => q),
    in: jest.fn(() => q),
    then: (resolve) => resolve(result),
  };
  return q;
}

const mockSupabase = { from: jest.fn() };
jest.mock('../../bot/shared/config/supabase', () => mockSupabase);
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const LeaderSource = require('../../bot/shared/services/observe/assignment/leader-source');

beforeEach(() => {
  mockSupabase.from.mockReset();
  mockSupabase.from.mockImplementation((table) => {
    if (table === 'leader_teachers') {
      // emulate PostgREST: eq('school_ext_id', X) filters rows literally
      const state = { school: undefined };
      const q = {
        select: jest.fn(() => q),
        eq: jest.fn((col, val) => { if (col === 'school_ext_id') state.school = val; return q; }),
        then: (resolve) => {
          const data = state.school === undefined
            ? rows.teachers
            : rows.teachers.filter(t => t.school_ext_id === state.school);
          resolve({ data, error: null });
        },
      };
      return q;
    }
    if (table === 'users') {
      const q = { select: jest.fn(() => q), in: jest.fn(() => q), then: (r) => r({ data: [], error: null }) };
      return q;
    }
    return chain({ data: [], error: null });
  });
});

describe('resolveTeacher survives bad school values (bd-5n1a2)', () => {
  test("school_ext_id '' → treated as no filter, teacher binds", async () => {
    const t = await LeaderSource.resolveTeacher('leader-1', 'name:test-bilal-ahmed', '');
    expect(t).not.toBeNull();
    expect(t.teacher_name).toBe('Bilal Ahmed (TEST)');
  });

  test('wrong school value → unfiltered retry still binds', async () => {
    const t = await LeaderSource.resolveTeacher('leader-1', 'name:test-bilal-ahmed', 'niete:999');
    expect(t).not.toBeNull();
    expect(t.teacher_ext_id).toBe('name:test-bilal-ahmed');
  });

  test('genuinely unknown teacher → still null', async () => {
    const t = await LeaderSource.resolveTeacher('leader-1', 'name:not-a-teacher', 'test:9001');
    expect(t).toBeNull();
  });
});
