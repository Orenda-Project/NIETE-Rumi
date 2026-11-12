/**
 * bd-97daxo.29 — the WhatsApp /observe school list said "0 teachers" for a school with no EMIS.
 *
 * Two Gilgit-Baltistan schools came from main Rumi without an EMIS (MF Community School Hoto, Deosai Community
 * School Dapa Kharmang), and the Rumi QA test schools have none either. Their coach holdings are keyed by name
 * (leader_schools.school_ext_id = 'niete:gb-mf-community-school-hoto-mf-community'). The patch row keyed each
 * teacher's school as 'niete:' + emis, so an EMIS-less school's teachers were counted under null: the school list
 * said 0 teachers, 0 due, while tapping the school listed them (listTeachers filters by the holding).
 *
 * Prod 12 Nov (queue #112): all 11 of 605 holdings whose key is not 'niete:' + the school's EMIS are EMIS-less
 * schools (Hoto x3, Deosai x3, GB test schools x5). The rule is the portal's (bd-97daxo.22, leader-patch):
 * COALESCE('niete:' || emis, the coach's own holding key). A school with an EMIS keeps its key.
 */

const mockRows = { leader_schools: [], schools: [], users: [], coaching_sessions: [], app_settings: [] };

function mockChain(table) {
  const state = { table, filters: [] };
  const api = {
    select: () => api,
    eq: (col, val) => { state.filters.push(['eq', col, val]); return api; },
    in: (col, vals) => { state.filters.push(['in', col, vals]); return api; },
    is: (col, val) => { state.filters.push(['is', col, val]); return api; },
    order: () => api,
    maybeSingle: () => Promise.resolve({ data: mockApplyFilters(state)[0] || null, error: null }),
    then: (onFulfilled, onRejected) =>
      Promise.resolve({ data: mockApplyFilters(state), error: null }).then(onFulfilled, onRejected),
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

const { listSchools, listTeachers, resolveTeacher } = require('../../shared/services/observe/assignment/leader-source');
const { listPatchViaSupabase, toLeaderSourceRow } = require('../../shared/services/observe/patch-resolver.service');

const COACH = 'coach-gb-1';
const HOTO = 'niete:gb-mf-community-school-hoto-mf-community';

beforeEach(() => {
  mockRows.leader_schools = [
    // An ICT school with an EMIS: its key is 'niete:' + EMIS, as before.
    { leader_user_id: COACH, school_ext_id: 'niete:401', school_id: 's401', school_name: 'IMCB Bhara Kau', emis: '401' },
    // A GB school with no EMIS: the holding is keyed by the school's name.
    { leader_user_id: COACH, school_ext_id: HOTO, school_id: 'sHoto', school_name: 'MF Community School Hoto - MF community', emis: null },
  ];
  mockRows.schools = [
    { id: 's401', name: 'IMCB Bhara Kau', emis: '401' },
    { id: 'sHoto', name: 'MF Community School Hoto - MF community', emis: null },
  ];
  mockRows.users = [
    { id: 't401', phone_number: '923330000401', name: 'Abid Ullah', role: 'teacher', school_id: 's401', teacher_level: ['PRIMARY'] },
    { id: 'tH1', phone_number: '923550000001', name: 'Hoto Teacher One', role: 'teacher', school_id: 'sHoto', teacher_level: ['PRIMARY'] },
    { id: 'tH2', phone_number: '923550000002', name: 'Hoto Teacher Two', role: 'teacher', school_id: 'sHoto', teacher_level: ['MIDDLE'] },
    { id: 'pH', phone_number: '923550000003', name: 'Hoto Head', role: 'principal', school_id: 'sHoto', teacher_level: null },
    { id: COACH, phone_number: '923550009999', name: 'GB Coach', role: 'coach', preferred_language: 'en' },
  ];
  mockRows.coaching_sessions = [];
  mockRows.app_settings = [];
});

describe('the school list counts the teachers of a school with no EMIS', () => {
  test('Hoto shows its 3 people, all due; the EMIS school is unchanged', async () => {
    const schools = await listSchools(COACH, { today: '2026-11-12' });
    const byKey = Object.fromEntries(schools.map((s) => [s.school_ext_id, s]));
    expect(byKey[HOTO]).toMatchObject({ teacherCount: 3, dueCount: 3 });
    expect(byKey['niete:401']).toMatchObject({ teacherCount: 1, dueCount: 1 });
  });

  test('the count matches what tapping the school lists', async () => {
    const schools = await listSchools(COACH, { today: '2026-11-12' });
    const hoto = schools.find((s) => s.school_ext_id === HOTO);
    const tapped = await listTeachers(COACH, HOTO, { today: '2026-11-12' });
    expect(tapped).toHaveLength(3);
    expect(hoto.teacherCount).toBe(tapped.length);
  });

  test('every teacher row names the holding it came from', async () => {
    const people = await listPatchViaSupabase(require('../../shared/config/supabase'), COACH);
    const rows = people.map(toLeaderSourceRow);
    const hotoRows = rows.filter((r) => r.teacher_ext_id && r.teacher_ext_id.startsWith('92355'));
    expect(hotoRows.map((r) => r.school_ext_id)).toEqual([HOTO, HOTO, HOTO]);
    expect(rows.find((r) => r.teacher_ext_id === '923330000401').school_ext_id).toBe('niete:401');
  });

  test('a teacher at the EMIS-less school resolves with the school filter, first time', async () => {
    const t = await resolveTeacher(COACH, '923550000001', HOTO);
    expect(t).toMatchObject({ teacher_ext_id: '923550000001', user_id: 'tH1' });
  });
});

describe('toLeaderSourceRow keys the school as the portal does', () => {
  test("an EMIS wins: 'niete:' + EMIS, whatever the holding is called", () => {
    expect(toLeaderSourceRow({ phone: '1', emis: '409', schoolExtId: 'niete:something-else' }).school_ext_id).toBe('niete:409');
  });

  test("no EMIS: the coach's own holding key", () => {
    expect(toLeaderSourceRow({ phone: '1', emis: null, schoolExtId: HOTO }).school_ext_id).toBe(HOTO);
  });

  test('neither: null, as before', () => {
    expect(toLeaderSourceRow({ phone: '1', emis: null }).school_ext_id).toBeNull();
  });
});
