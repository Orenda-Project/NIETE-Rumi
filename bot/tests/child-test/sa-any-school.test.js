'use strict';

/**
 * Any school (app_settings sa_any_school, default OFF): ON for a user (JSON true, or a list of users.id), the coach
 * app's Learning assessment lists every live programme school (active, not a probable test school) with its EMIS and
 * sector, not only the user's own (leader_schools), and opens a list or seats a child at any of them. For the people
 * who support the visits and have no schools of their own. OFF, a test or closed school, or a practice-only coach:
 * unchanged. Any failure reading the switch is off.
 */

jest.mock('../../shared/services/settings/settings-snapshot', () => ({ rows: jest.fn() }));

const Snap = require('../../shared/services/settings/settings-snapshot');
const anySchool = require('../../shared/services/child-test/app/any-school-switch');
const sa = require('../../shared/services/child-test/app/sa-api.service');

const COACH = 'aaaaaaaa-0000-4000-8000-000000000001';
const OTHER_USER = 'aaaaaaaa-0000-4000-8000-000000000002';
const OWN = 'bbbbbbbb-0000-4000-8000-000000000001';
const ELSEWHERE = 'bbbbbbbb-0000-4000-8000-000000000002';
const TESTWALA = 'bbbbbbbb-0000-4000-8000-000000000003';
const CLOSED = 'bbbbbbbb-0000-4000-8000-000000000004';
const KID = '0a0a0a0a-0000-4000-8000-000000000001';
const NOW = new Date('2026-10-27T05:00:00Z');

function chain(data) {
  const q = {
    select: () => q, eq: () => q, in: () => q, gte: () => q, order: () => q, limit: () => q,
    then: (res, rej) => Promise.resolve({ data, error: null }).then(res, rej),
  };
  return q;
}

const SCHOOLS = [
  { id: OWN, name: 'Model School Own', emis: '101', region: 'Urban-I', is_active: true, is_probable_test: false },
  { id: ELSEWHERE, name: 'Another School', emis: '202', region: 'Tarnol', is_active: true, is_probable_test: null },
  { id: TESTWALA, name: 'SIM Practice School', emis: 'SIM-1', region: 'Urban-I', is_active: true, is_probable_test: true },
  { id: CLOSED, name: 'Closed School', emis: '303', region: 'Nilore', is_active: false, is_probable_test: false },
];

function world({ any = false, practice = null } = {}) {
  const calls = { todaysList: [], addChild: [] };
  const LIST = { ok: true, cycleId: 'ICT-2026-Q4', grade: 3, gradeFallback: false, reused: false, children: [], alternates: [] };
  const tables = { leader_schools: [{ school_id: OWN, school_name: 'Model School Own' }], schools: SCHOOLS, observation_field_forms: [] };
  const deps = {
    enabled: async () => !practice,
    practice: async () => practice,
    supabase: { from: (t) => chain(tables[t] || []) },
    store: { listSessionsForVisit: async () => ({ ok: true, sessions: [] }), listVisitDraws: async () => ({ ok: true, draws: [] }) },
    saStore: { findByClient: async () => ({ ok: true }), statusOf: async () => ({ ok: true }) },
    draw: {
      todaysList: async (a) => { calls.todaysList.push(a); return LIST; },
      addChild: async (a) => { calls.addChild.push(a); return LIST; },
      resolveVisitSchool: async () => ({ ok: false }),
    },
    now: () => NOW,
    log: () => {}, logError: () => {},
    anySchool: any,
    addChild: true,
  };
  return { deps, calls };
}

describe('the switch', () => {
  afterEach(() => { Snap.rows.mockReset(); anySchool.__reset(); });
  const row = (value) => Snap.rows.mockResolvedValue({ data: [{ key: 'sa_any_school', value }], error: null });

  test('JSON true: on for every user', async () => {
    row(true);
    expect(await anySchool.onFor(COACH)).toBe(true);
    expect(await anySchool.onFor(OTHER_USER)).toBe(true);
  });
  test('a list of users.id: on for those users only', async () => {
    row([COACH]);
    expect(await anySchool.onFor(COACH)).toBe(true);
    expect(await anySchool.onFor(OTHER_USER)).toBe(false);
  });
  test('no row, any other value, no user, or a failed read: off', async () => {
    Snap.rows.mockResolvedValue({ data: [], error: null });
    expect(await anySchool.onFor(COACH)).toBe(false);
    anySchool.__reset(); row('true');
    expect(await anySchool.onFor(COACH)).toBe(false);
    anySchool.__reset(); row([]);
    expect(await anySchool.onFor(COACH)).toBe(false);
    anySchool.__reset(); row(true);
    expect(await anySchool.onFor(null)).toBe(false);
    anySchool.__reset(); Snap.rows.mockRejectedValue(new Error('down'));
    expect(await anySchool.onFor(COACH)).toBe(false);
  });
  test('a handler\'s own supabase client is read directly: the global config and the snapshot are never touched', async () => {
    const client = (value) => ({ from: (t) => chain(t === 'app_settings' ? (value === undefined ? [] : [{ key: 'sa_any_school', value }]) : []) });
    expect(await anySchool.enabledFor(COACH, { supabase: client([COACH]) })).toBe(true);
    expect(await anySchool.enabledFor(OTHER_USER, { supabase: client([COACH]) })).toBe(false);
    expect(await anySchool.enabledFor(COACH, { supabase: client(true) })).toBe(true);
    expect(await anySchool.enabledFor(COACH, { supabase: client(undefined) })).toBe(false);
    expect(Snap.rows).not.toHaveBeenCalled();
  });
  test('a test\'s deps answer first: a boolean, or a function of the user', async () => {
    expect(await anySchool.enabledFor(COACH, { anySchool: true })).toBe(true);
    expect(await anySchool.enabledFor(COACH, { anySchool: false })).toBe(false);
    expect(await anySchool.enabledFor(COACH, { anySchool: async (id) => id === COACH })).toBe(true);
    expect(await anySchool.enabledFor(OTHER_USER, { anySchool: async (id) => id === COACH })).toBe(false);
  });
});

describe('the school list', () => {
  test('OFF: the user\'s own schools only, each with its EMIS and sector', async () => {
    const { deps } = world();
    const out = await sa.listSchools({ userId: COACH }, deps);
    expect(out.status).toBe('ok');
    expect(out.schools).toEqual([
      { schoolId: OWN, name: 'Model School Own', emis: '101', region: 'Urban-I', visitId: null, observedGrade: null, visitToday: false },
    ]);
  });

  test('ON: every live programme school (no test or closed school), by name, each with its EMIS and sector', async () => {
    const { deps } = world({ any: true });
    const out = await sa.listSchools({ userId: COACH }, deps);
    expect(out.status).toBe('ok');
    expect(out.schools.map((s) => [s.schoolId, s.emis, s.region])).toEqual([
      [ELSEWHERE, '202', 'Tarnol'],
      [OWN, '101', 'Urban-I'],
    ]);
  });

  test('ON for a practice-only coach: still their practice schools only', async () => {
    const { deps } = world({ any: true, practice: new Set([TESTWALA]) });
    const out = await sa.listSchools({ userId: COACH }, deps);
    expect(out.schools.map((s) => s.schoolId)).toEqual([]);
  });
});

describe('opening a list and seating a child', () => {
  test('ON: a live school the user is not linked to opens today\'s list', async () => {
    const { deps, calls } = world({ any: true });
    const out = await sa.dayList({ userId: COACH, schoolId: ELSEWHERE }, deps);
    expect(out.status).toBe('ok');
    expect(calls.todaysList[0]).toMatchObject({ coachUserId: COACH, schoolId: ELSEWHERE });
  });

  test('ON: a child can be added there too', async () => {
    const { deps, calls } = world({ any: true });
    const out = await sa.addChild({ userId: COACH, schoolId: ELSEWHERE, grade: 3, firstName: 'Zara', clientChildId: KID }, deps);
    expect(out.status).toBe('ok');
    expect(calls.addChild[0]).toMatchObject({ schoolId: ELSEWHERE });
  });

  test('OFF: an unlinked school is not found, nothing drawn', async () => {
    const { deps, calls } = world();
    expect(await sa.dayList({ userId: COACH, schoolId: ELSEWHERE }, deps)).toEqual({ status: 'not_found' });
    expect(calls.todaysList).toEqual([]);
  });

  test('ON: a test school or a closed school is still not found', async () => {
    const { deps, calls } = world({ any: true });
    expect(await sa.dayList({ userId: COACH, schoolId: TESTWALA }, deps)).toEqual({ status: 'not_found' });
    expect(await sa.dayList({ userId: COACH, schoolId: CLOSED }, deps)).toEqual({ status: 'not_found' });
    expect(calls.todaysList).toEqual([]);
  });

  test('ON for a practice-only coach: a real school is not found', async () => {
    const { deps, calls } = world({ any: true, practice: new Set([TESTWALA]) });
    expect(await sa.dayList({ userId: COACH, schoolId: ELSEWHERE }, deps)).toEqual({ status: 'not_found' });
    expect(calls.todaysList).toEqual([]);
  });
});
