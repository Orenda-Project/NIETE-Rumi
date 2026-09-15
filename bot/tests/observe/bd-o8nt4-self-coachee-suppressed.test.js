/**
 * A leader is never her own coachee.
 *
 * The patch is DERIVED — everyone at the leader's schools whose role is
 * teacher/principal. A principal who teaches at her own school therefore lands
 * in her own patch, so the picker offers her her own name and she can bind her
 * own recording to herself as an observation. Measured 15 Sep 2026: 27
 * leader_teachers rows across 21 leaders name the leader as her own coachee, and
 * one reported principal used exactly that as a workaround — it produced a FICO
 * observation of himself owing himself a debrief instead of a coaching report.
 *
 * Suppressed at the observe derivation only (`_teachers`), which is what the
 * picker, the visit resolve and the school counts read. The teacher-admin
 * screens and the portal read `listPatchViaSupabase` / PATCH_SQL directly and
 * are deliberately untouched: removing yourself from your own roster view is a
 * different question from being offered as your own observation target.
 */

jest.mock('../../shared/config/supabase', () => ({
  from: () => {
    const api = {
      select: () => api,
      eq: () => api,
      in: () => api,
      is: () => api,
      not: () => api,
      order: () => api,
      limit: () => api,
      maybeSingle: () => Promise.resolve({ data: null, error: null }),
      then: (ok, bad) => Promise.resolve({ data: [], error: null }).then(ok, bad),
    };
    return api;
  },
}));
jest.mock('../../shared/services/coaching/coaching-trend.service', () => ({
  loadTrendData: jest.fn(async () => null),
}));
jest.mock('../../shared/services/observe/patch-resolver.service', () => {
  const actual = jest.requireActual('../../shared/services/observe/patch-resolver.service');
  return { ...actual, listPatchViaSupabase: jest.fn() };
});

const Patch = require('../../shared/services/observe/patch-resolver.service');
const LeaderSource = require('../../shared/services/observe/assignment/leader-source');

const LEADER = 'u-principal';

const person = (over = {}) => ({
  userId: 'u-other',
  name: 'Ayesha Khan',
  displayName: 'Ayesha Khan',
  phone: '923001111111',
  emis: '291',
  school_name: 'IMS I-10/2',
  band: 'PRIMARY',
  isPrincipal: false,
  ...over,
});

beforeEach(() => jest.clearAllMocks());

it('RED: listTeachers does not offer the leader herself', async () => {
  Patch.listPatchViaSupabase.mockResolvedValue([
    person({ userId: LEADER, name: 'Abdul Amam Khan', displayName: 'Abdul Amam Khan', phone: '923150583765', isPrincipal: true }),
    person(),
  ]);
  const rows = await LeaderSource.listTeachers(LEADER, null, { today: '2026-09-15' });
  expect(rows.map((r) => r.phone_e164)).not.toContain('923150583765');
  expect(rows.map((r) => r.phone_e164)).toContain('923001111111');
});

it('RED: resolveTeacher refuses to resolve the leader as her own coachee', async () => {
  Patch.listPatchViaSupabase.mockResolvedValue([
    person({ userId: LEADER, name: 'Abdul Amam Khan', displayName: 'Abdul Amam Khan', phone: '923150583765', isPrincipal: true }),
  ]);
  const t = await LeaderSource.resolveTeacher(LEADER, '923150583765', null);
  expect(t).toBeNull();
});

it('another principal at the same school is still a valid coachee', async () => {
  Patch.listPatchViaSupabase.mockResolvedValue([
    person({ userId: 'u-peer', name: 'Naveed Ahmed', displayName: 'Naveed Ahmed', phone: '923315545807', isPrincipal: true }),
  ]);
  const rows = await LeaderSource.listTeachers(LEADER, null, { today: '2026-09-15' });
  expect(rows.map((r) => r.phone_e164)).toContain('923315545807');
});
