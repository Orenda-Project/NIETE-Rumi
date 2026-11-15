/**
 * bd-u4etvq — a principal observes in their OWN school, whether or not they hold it in leader_schools.
 *
 * Operator, 15 Nov: "a principal linked to a school (users.school_id or any leader_schools row) sees ALL teachers of
 * that school in the /observe picker." The picker read only leader_schools, and on prod 15 Nov 477 of 522 principals
 * held no row there (287 of them have a users.school_id with teachers): they saw no school and no teacher.
 *
 *   - a principal's users.school_id counts as one of their schools, beside any leader_schools rows (no duplicate when
 *     they also hold it); the school list counts its teachers and tapping it lists them
 *   - the principal is never in their own list (leader-source: a leader is never her own coachee)
 *   - a coach reads exactly what they read before: their users.school_id is never added
 *   - a failed or missing read adds nothing and never throws
 */

// Phone-shaped fixtures are built at runtime from parts: the repo is public (tests/setup/phone-shaped-fixtures).
const mockPh = (rest) => `92${rest}`;

const mockRows = { leader_schools: [], schools: [], users: [], coaching_sessions: [], app_settings: [] };
const mockFail = { users: false };

function mockChain(table) {
  const state = { table, filters: [] };
  const result = () => (mockFail[table]
    ? { data: null, error: { message: `${table} read failed` } }
    : { data: mockApplyFilters(state), error: null });
  const api = {
    select: () => api,
    eq: (col, val) => { state.filters.push(['eq', col, val]); return api; },
    in: (col, vals) => { state.filters.push(['in', col, vals]); return api; },
    is: (col, val) => { state.filters.push(['is', col, val]); return api; },
    order: () => api,
    limit: () => api,
    maybeSingle: () => {
      const r = result();
      return Promise.resolve({ data: r.data ? (r.data[0] || null) : null, error: r.error });
    },
    then: (onFulfilled, onRejected) => Promise.resolve(result()).then(onFulfilled, onRejected),
  };
  return api;
}

function mockApplyFilters(state) {
  let out = mockRows[state.table] || [];
  for (const [op, col, val] of state.filters) {
    if (op === 'eq') out = out.filter((r) => r[col] === val);
    if (op === 'in') out = out.filter((r) => val.includes(r[col]));
    if (op === 'is') out = out.filter((r) => r[col] == null);
  }
  return out;
}

jest.mock('../../shared/config/supabase', () => ({ from: (t) => mockChain(t) }));
jest.mock('../../shared/services/coaching/coaching-trend.service', () => ({
  loadTrendData: jest.fn(async () => []),
  loadPriorAction: jest.fn(async () => null),
}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));

const LeaderSource = require('../../shared/services/observe/assignment/leader-source');
const { listPatchViaSupabase } = require('../../shared/services/observe/patch-resolver.service');

const TODAY = { today: '2026-11-15' };
const P_OWN = 'principal-own-only';      // users.school_id, no leader_schools row
const P_BOTH = 'principal-held-and-own'; // a leader_schools row for another school, plus their own
const P_HELD_OWN = 'principal-holds-own';// holds their own school in leader_schools too
const P_NONE = 'principal-no-school';    // neither
const COACH = 'coach-with-school-id';    // a coach whose users row happens to carry a school_id

beforeEach(() => {
  mockFail.users = false;
  mockRows.schools = [
    { id: 'sOwn', name: 'IMSG Own School', emis: '501', region: 'ict' },
    { id: 'sHeld', name: 'IMCB Held School', emis: '502', region: 'ict' },
    { id: 'sCoachHome', name: 'Coach Home School', emis: '503', region: 'ict' },
    { id: 'sBothOwn', name: 'IMSB Both Own', emis: '504', region: 'ict' },
    { id: 'sHeldOwn', name: 'IMSG Held Own', emis: '505', region: 'ict' },
  ];
  mockRows.leader_schools = [
    { leader_user_id: P_BOTH, school_ext_id: 'niete:502', school_id: 'sHeld', school_name: 'IMCB Held School', emis: '502' },
    { leader_user_id: P_HELD_OWN, school_ext_id: 'niete:505', school_id: 'sHeldOwn', school_name: 'IMSG Held Own', emis: '505' },
    { leader_user_id: COACH, school_ext_id: 'niete:502', school_id: 'sHeld', school_name: 'IMCB Held School', emis: '502' },
  ];
  mockRows.users = [
    // the observers
    { id: P_OWN, phone_number: mockPh('3000000001'), name: 'Head Own', role: 'principal', school_id: 'sOwn', preferred_language: 'ur' },
    { id: P_BOTH, phone_number: mockPh('3000000002'), name: 'Head Both', role: 'principal', school_id: 'sBothOwn', preferred_language: 'ur' },
    { id: P_HELD_OWN, phone_number: mockPh('3000000003'), name: 'Head Held', role: 'principal', school_id: 'sHeldOwn', preferred_language: 'en' },
    { id: P_NONE, phone_number: mockPh('3000000004'), name: 'Head None', role: 'principal', school_id: null, preferred_language: 'ur' },
    { id: COACH, phone_number: mockPh('3000000005'), name: 'Coach One', role: 'coach', school_id: 'sCoachHome', preferred_language: 'en' },
    // the own school's teachers
    { id: 'tO1', phone_number: mockPh('3110000001'), name: 'Own Teacher One', role: 'teacher', school_id: 'sOwn', teacher_level: ['PRIMARY'] },
    { id: 'tO2', phone_number: mockPh('3110000002'), name: 'Own Teacher Two', role: 'teacher', school_id: 'sOwn', teacher_level: ['MIDDLE'] },
    { id: 'tOgone', phone_number: 'merged:tO1', name: 'Own Teacher One', role: 'teacher', school_id: 'sOwn', deleted_at: '2026-11-01' },
    { id: 'tB1', phone_number: mockPh('3440000001'), name: 'Both Own Teacher', role: 'teacher', school_id: 'sBothOwn' },
    { id: 'tHO1', phone_number: mockPh('3550000001'), name: 'Held Own Teacher A', role: 'teacher', school_id: 'sHeldOwn' },
    { id: 'tHO2', phone_number: mockPh('3550000002'), name: 'Held Own Teacher B', role: 'teacher', school_id: 'sHeldOwn' },
    // the held school's teacher
    { id: 'tH1', phone_number: mockPh('3220000001'), name: 'Held Teacher', role: 'teacher', school_id: 'sHeld', teacher_level: ['PRIMARY'] },
    // the coach's home school (must never reach the coach's picker)
    { id: 'tC1', phone_number: mockPh('3330000001'), name: 'Coach Home Teacher', role: 'teacher', school_id: 'sCoachHome' },
  ];
  mockRows.coaching_sessions = [];
  mockRows.app_settings = [];
});

const keys = (schools) => schools.map((s) => s.school_ext_id).sort();
const phones = (teachers) => teachers.map((t) => t.teacher_ext_id).sort();

describe('a principal with a users.school_id and no leader_schools row', () => {
  test('sees their own school in the school list, with its teachers counted (never themselves)', async () => {
    const schools = await LeaderSource.listSchools(P_OWN, TODAY);
    expect(schools).toEqual([
      expect.objectContaining({ school_ext_id: 'niete:501', school_name: 'IMSG Own School', teacherCount: 2, dueCount: 2 }),
    ]);
  });

  test('tapping their school lists ALL its live teachers, and not the principal', async () => {
    const teachers = await LeaderSource.listTeachers(P_OWN, 'niete:501', TODAY);
    expect(phones(teachers)).toEqual([mockPh('3110000001'), mockPh('3110000002')]);
  });

  test('the whole roster (search, binding list) is the same people', async () => {
    expect(phones(await LeaderSource.listTeachers(P_OWN, null, TODAY))).toEqual([mockPh('3110000001'), mockPh('3110000002')]);
  });

  test('a picked teacher resolves for the Start step, with the school filter', async () => {
    const t = await LeaderSource.resolveTeacher(P_OWN, mockPh('3110000002'), 'niete:501');
    expect(t).toMatchObject({ teacher_ext_id: mockPh('3110000002'), user_id: 'tO2' });
  });

  test('the brief names their school', async () => {
    const brief = await LeaderSource.buildBrief(P_OWN, mockPh('3110000001'), 'niete:501');
    expect(brief.teacher.school_name).toBe('IMSG Own School');
  });
});

describe('a principal with leader_schools rows keeps them, and gains their own school', () => {
  test('both schools', async () => {
    const schools = await LeaderSource.listSchools(P_BOTH, TODAY);
    expect(keys(schools)).toEqual(['niete:502', 'niete:504']);
    expect(schools.find((s) => s.school_ext_id === 'niete:504')).toMatchObject({ school_name: 'IMSB Both Own', teacherCount: 1 });
  });

  test('the roster spans both schools', async () => {
    expect(phones(await LeaderSource.listTeachers(P_BOTH, null, TODAY))).toEqual([mockPh('3220000001'), mockPh('3440000001')]);
    expect(phones(await LeaderSource.listTeachers(P_BOTH, 'niete:504', TODAY))).toEqual([mockPh('3440000001')]);
  });

  test('holding their own school as well never lists it twice', async () => {
    const schools = await LeaderSource.listSchools(P_HELD_OWN, TODAY);
    expect(keys(schools)).toEqual(['niete:505']);
    expect(schools[0].teacherCount).toBe(2);
  });

  test('another principal of the same school is listed, labelled, as in a held school', async () => {
    mockRows.users.push({ id: 'pCo', phone_number: mockPh('3110000009'), name: 'Co Head', role: 'principal', school_id: 'sOwn' });
    const teachers = await LeaderSource.listTeachers(P_OWN, 'niete:501', TODAY);
    expect(phones(teachers)).toEqual([mockPh('3110000001'), mockPh('3110000002'), mockPh('3110000009')]);
    const patch = await listPatchViaSupabase(require('../../shared/config/supabase'), P_OWN);
    expect(patch.find((p) => p.userId === 'pCo')).toMatchObject({ isPrincipal: true, roleLabel: 'Principal' });
  });
});

describe('everyone else is unchanged', () => {
  test('a coach never gets their own users.school_id added: holdings only', async () => {
    expect(keys(await LeaderSource.listSchools(COACH, TODAY))).toEqual(['niete:502']);
    expect(phones(await LeaderSource.listTeachers(COACH, null, TODAY))).toEqual([mockPh('3220000001')]);
    const patch = await listPatchViaSupabase(require('../../shared/config/supabase'), COACH);
    expect(patch.map((p) => p.userId)).not.toContain('tC1');
  });

  test('a principal with no school and no holding still sees nothing (no guess)', async () => {
    expect(await LeaderSource.listSchools(P_NONE, TODAY)).toEqual([]);
    expect(await LeaderSource.listTeachers(P_NONE, null, TODAY)).toEqual([]);
  });

  test('a failed users read adds nothing and never throws: holdings only', async () => {
    mockFail.users = true;
    const schools = await LeaderSource.listSchools(P_BOTH, TODAY);
    expect(keys(schools)).toEqual(['niete:502']);
  });

  test('the School card door keeps reading leader_schools rows only (coach app pages)', async () => {
    expect(await LeaderSource._schools(P_OWN)).toEqual([]);
  });
});

describe('a principal on the portal principal app keeps that path', () => {
  test('portal_principal_app naming them: their own school, teachers only, as before', async () => {
    mockRows.app_settings = [{ key: 'portal_principal_app', value: JSON.stringify([P_OWN]) }];
    mockRows.users.push({ id: 'pCo', phone_number: mockPh('3110000009'), name: 'Co Head', role: 'principal', school_id: 'sOwn' });
    const patch = await listPatchViaSupabase(require('../../shared/config/supabase'), P_OWN);
    expect(patch.map((p) => p.userId).sort()).toEqual(['tO1', 'tO2']);
  });
});
