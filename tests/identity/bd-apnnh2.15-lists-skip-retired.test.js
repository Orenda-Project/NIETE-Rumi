/**
 * bd-apnnh2.15 — four more teacher lists skip a retired account.
 *
 * A fold retires a teacher's spare account (bot/shared/utils/soft-delete.js:
 * deleted_at set, phone_number 'merged:<id>') and leaves its school_id and role
 * as they were. bd-apnnh2.11 made every patch list skip it. These four lists read
 * users by school_id (and role) too, and still showed the retired copy beside the
 * live teacher:
 *
 *   1. the /roster class-teacher picker    roster-flow-endpoint teachersFor
 *   2. a principal's /remark teachers      remark-cycle.repository listSchoolTeachers
 *   3. the staff attendance roster         attendance-write loadStaffRoster: the marking
 *      screen, the voice matcher, the monthly register and the mark-by-exception write,
 *      which wrote the retired copy down as present every day the principal marked staff
 *   4. the portal's teacher attendance     attendance-repository getTeachersBySchool,
 *      the Supabase repository and its in-memory twin; it also feeds the school-wide
 *      presence rollup
 *
 * The migrated source system also left rows with deleted_at set, and such a row can
 * still hold a real phone, so the picker's phone-matched source (the coach's mapped
 * list) is filtered too.
 *
 * Each list: a retired copy is absent, and an account restored to live is back.
 * Supabase is the in-memory fake (tests/fixtures/fake-supabase.js), which applies
 * .is(col, null) as PostgREST does: a column the row does not carry reads as NULL.
 */

const { createFakeSupabase } = require('../fixtures/fake-supabase');

let mockDb;
jest.mock('../../bot/shared/config/supabase', () => ({
  from: (...a) => mockDb.from(...a),
  rpc: (...a) => mockDb.rpc(...a),
}));
jest.mock('../../bot/shared/services/classes/class.service', () => ({
  importRoster: jest.fn(),
  applyRosterEdits: jest.fn(),
  handOverClass: jest.fn(),
  normalizeSection: (s) => (s ? String(s).trim().toUpperCase() : null),
}));
jest.mock('../../bot/shared/services/roster/roster-storage', () => ({
  newRunId: jest.fn(() => 'run-fixed'),
  putPage: jest.fn(async () => ({})),
  putManifest: jest.fn(async () => ({})),
}));
jest.mock('../../bot/shared/services/roster/roster-extraction.service', () => ({
  extractPages: jest.fn(async () => ({ students: [], problems: [] })),
}));
jest.mock('../../bot/shared/services/roster/roster-media', () => ({
  decryptMedia: jest.fn(async () => ({ data: Buffer.from('x'), fileName: 'p.jpg' })),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const { teachersFor } = require('../../bot/shared/routes/roster-flow-endpoint');
const { listSchoolTeachers } = require('../../bot/shared/services/remark/remark-cycle.repository');
const { loadStaffRoster } = require('../../bot/shared/services/attendance-write.service');
const {
  RealAttendanceRepository,
  MockAttendanceRepository,
} = require('../../dashboard/services/attendance-repository.service');

const SCHOOL = 'school-1';
const RETIRED_AT = '2026-11-08T10:00:00.000Z';

// Placeholder labels and phones only: no real names or numbers.
const COACH = { id: 'coach-1', role: 'coach', school_id: null, name: 'Coach' };
const PRINCIPAL = {
  id: 'p1', role: 'principal', school_id: SCHOOL, name: 'Head Teacher', phone_number: 'ph-p1', deleted_at: null,
};
const LIVE = {
  id: 'u1', role: 'teacher', school_id: SCHOOL, name: 'Teacher One', phone_number: 'ph-u1', deleted_at: null,
};
/** u1's old account, retired when her number moved onto u1: same school, same role. */
const RETIRED = {
  id: 'u9', role: 'teacher', school_id: SCHOOL, name: 'Teacher One', phone_number: 'merged:u1', deleted_at: RETIRED_AT,
};
/** No deleted_at on the row at all: live. */
const NO_COLUMN = {
  id: 'u2', role: 'teacher', school_id: SCHOOL, name: 'Teacher Two', phone_number: 'ph-u2',
};

/** Fresh rows each time, so a test that restores an account cannot leak into the next. */
const USERS = () => [COACH, PRINCIPAL, LIVE, RETIRED, NO_COLUMN].map((u) => ({ ...u }));
const restore = (users, id) => { users.find((u) => u.id === id).deleted_at = null; return users; };
const idsOf = (rows) => rows.map((r) => r.id).sort();

describe('1. the /roster class-teacher picker (teachersFor)', () => {
  const seed = (users, leaderTeachers = []) => {
    mockDb = createFakeSupabase({ users, leader_teachers: leaderTeachers });
  };
  /** The people offered, without the "Not listed" way out. */
  const offered = async () => (await teachersFor(COACH, SCHOOL)).map((o) => o.id).filter((id) => id !== 'none');

  it('offers the teacher once, without her retired account beside her', async () => {
    seed(USERS());
    const ids = await offered();
    expect(ids).toContain(LIVE.id);
    expect(ids).toContain(NO_COLUMN.id);
    expect(ids).not.toContain(RETIRED.id);
  });

  it('an account restored to live is offered again', async () => {
    seed(restore(USERS(), RETIRED.id));
    expect(await offered()).toContain(RETIRED.id);
  });

  describe("the coach's mapped list, matched by phone", () => {
    // A migrated row retired in the source system, still on its real phone, at no school.
    const MIGRATED_RETIRED = {
      id: 'u3', role: 'teacher', school_id: null, name: 'Teacher Three', phone_number: 'ph-u3', deleted_at: RETIRED_AT,
    };
    const MAPPED = [{
      leader_user_id: COACH.id, school_id: SCHOOL, teacher_name: 'Teacher Three', teacher_phone_e164: 'ph-u3',
    }];

    it('does not offer a retired account that still holds the mapped phone', async () => {
      seed([...USERS(), { ...MIGRATED_RETIRED }], MAPPED);
      expect(await offered()).not.toContain(MIGRATED_RETIRED.id);
    });

    it('offers it once it is restored to live', async () => {
      seed([...USERS(), { ...MIGRATED_RETIRED, deleted_at: null }], MAPPED);
      expect(await offered()).toContain(MIGRATED_RETIRED.id);
    });
  });
});

describe("2. a principal's /remark teachers (listSchoolTeachers)", () => {
  it('lists her teachers without the retired copy', async () => {
    mockDb = createFakeSupabase({ users: USERS() });
    expect(idsOf(await listSchoolTeachers(PRINCIPAL))).toEqual([LIVE.id, NO_COLUMN.id]);
  });

  it('an account restored to live is listed again', async () => {
    mockDb = createFakeSupabase({ users: restore(USERS(), RETIRED.id) });
    expect(idsOf(await listSchoolTeachers(PRINCIPAL))).toEqual([LIVE.id, NO_COLUMN.id, RETIRED.id].sort());
  });
});

describe('3. the staff attendance roster (loadStaffRoster)', () => {
  it('rosters the teachers without the retired copy, so mark-by-exception never writes it present', async () => {
    mockDb = createFakeSupabase({ users: USERS() });
    expect(idsOf(await loadStaffRoster(SCHOOL, PRINCIPAL.id))).toEqual([LIVE.id, NO_COLUMN.id]);
  });

  it('an account restored to live is on the roster again', async () => {
    mockDb = createFakeSupabase({ users: restore(USERS(), RETIRED.id) });
    expect(idsOf(await loadStaffRoster(SCHOOL, PRINCIPAL.id))).toEqual([LIVE.id, NO_COLUMN.id, RETIRED.id].sort());
  });
});

describe("4. the portal's teacher attendance (getTeachersBySchool)", () => {
  describe('the Supabase repository', () => {
    const repoOver = (users) => new RealAttendanceRepository(createFakeSupabase({ users }));

    it("lists the school's teachers without the retired copy", async () => {
      expect(idsOf(await repoOver(USERS()).getTeachersBySchool(SCHOOL))).toEqual([LIVE.id, NO_COLUMN.id]);
    });

    it('the school-wide presence rollup has no row for the retired copy', async () => {
      const rows = await repoOver(USERS()).getPresence({ school_id: SCHOOL });
      expect(rows.map((r) => r.teacher_id).sort()).toEqual([LIVE.id, NO_COLUMN.id]);
    });

    it('an account restored to live is listed again', async () => {
      const repo = repoOver(restore(USERS(), RETIRED.id));
      expect(idsOf(await repo.getTeachersBySchool(SCHOOL))).toEqual([LIVE.id, NO_COLUMN.id, RETIRED.id].sort());
    });
  });

  describe('the in-memory twin (tests and demo) answers the same', () => {
    it("lists the school's teachers without the retired copy", async () => {
      const repo = new MockAttendanceRepository({ teachers: USERS() });
      expect(idsOf(await repo.getTeachersBySchool(SCHOOL))).toEqual([LIVE.id, NO_COLUMN.id]);
    });

    it('an account restored to live is listed again', async () => {
      const repo = new MockAttendanceRepository({ teachers: restore(USERS(), RETIRED.id) });
      expect(idsOf(await repo.getTeachersBySchool(SCHOOL))).toEqual([LIVE.id, NO_COLUMN.id, RETIRED.id].sort());
    });
  });
});
