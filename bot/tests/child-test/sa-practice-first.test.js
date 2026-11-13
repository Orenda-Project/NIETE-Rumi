'use strict';

/**
 * Practice school first (app_settings sa_r19_practice_first, default OFF): ON, every coach's school list for the
 * Learning assessment puts the practice school (schools.is_probable_test) at the top, above today's visit and above
 * schools earlier in the alphabet, and marks each school `practice`. The WhatsApp /egra picker follows the same order.
 * OFF (no row, any other value, a failed read): the list and its order are exactly as before.
 */

const mockTables = {};
function mockChain(t) {
  const q = {
    select: () => q, eq: () => q, in: () => q, gte: () => q, order: () => q, limit: () => q,
    then: (res, rej) => Promise.resolve({ data: mockTables[t] || [], error: null }).then(res, rej),
  };
  return q;
}
jest.mock('../../shared/config/supabase', () => ({ from: (t) => mockChain(t) }));
jest.mock('../../shared/services/settings/settings-snapshot', () => ({ rows: jest.fn() }));

const Snap = require('../../shared/services/settings/settings-snapshot');
const practiceFirst = require('../../shared/services/child-test/app/practice-first-switch');
const sa = require('../../shared/services/child-test/app/sa-api.service');
const C = require('../../shared/services/child-test/conversation/context');

const COACH = 'aaaaaaaa-0000-4000-8000-000000000001';
const ALPHA = 'bbbbbbbb-0000-4000-8000-000000000001';
const VISITED = 'bbbbbbbb-0000-4000-8000-000000000002';
const SIM = 'bbbbbbbb-0000-4000-8000-000000000003';
const SIM2 = 'bbbbbbbb-0000-4000-8000-000000000004';
const ELSEWHERE = 'bbbbbbbb-0000-4000-8000-000000000005';
const VISIT = 'cccccccc-0000-4000-8000-000000000001';
const NOW = new Date('2026-11-13T05:00:00Z');

const SCHOOLS = [
  { id: ALPHA, name: 'Abbot Model School', emis: '101', region: 'Urban-I', is_active: true, is_probable_test: false },
  { id: VISITED, name: 'Model School Visited', emis: '202', region: 'Tarnol', is_active: true, is_probable_test: null },
  { id: SIM, name: 'SIM Child Test School', emis: 'SIM-CT-0001', region: 'Urban-I', is_active: true, is_probable_test: true },
  { id: SIM2, name: 'Practice School Two', emis: 'SIM-CT-0002', region: 'Urban-I', is_active: true, is_probable_test: true },
  { id: ELSEWHERE, name: 'Bari Imam School', emis: '303', region: 'Nilore', is_active: true, is_probable_test: false },
];

function chain(data) {
  const q = {
    select: () => q, eq: () => q, in: () => q, gte: () => q, order: () => q, limit: () => q,
    then: (res, rej) => Promise.resolve({ data, error: null }).then(res, rej),
  };
  return q;
}

function world({ first, any = false, links = [ALPHA, VISITED, SIM] } = {}) {
  const tables = {
    leader_schools: links.map((id) => ({ school_id: id, school_name: SCHOOLS.find((s) => s.id === id).name })),
    schools: SCHOOLS,
    observation_field_forms: [{ id: VISIT, observer_user_id: COACH, created_at: NOW.toISOString(), answers: {} }],
  };
  return {
    enabled: async () => true,
    practice: async () => null,
    supabase: { from: (t) => chain(tables[t] || []) },
    draw: { resolveVisitSchool: async ({ visitId }) => (visitId === VISIT ? { ok: true, schoolId: VISITED } : { ok: false }) },
    now: () => NOW,
    log: () => {}, logError: () => {},
    anySchool: any,
    ...(first === undefined ? {} : { practiceFirst: first }),
  };
}

describe('the switch', () => {
  afterEach(() => { Snap.rows.mockReset(); practiceFirst.__reset(); });
  const row = (value) => Snap.rows.mockResolvedValue({ data: [{ key: 'sa_r19_practice_first', value }], error: null });

  test('JSON true: on', async () => {
    row(true);
    expect(await practiceFirst.on()).toBe(true);
  });
  test('no row, any other value, or a failed read: off', async () => {
    Snap.rows.mockResolvedValue({ data: [], error: null });
    expect(await practiceFirst.on()).toBe(false);
    practiceFirst.__reset(); row('true');
    expect(await practiceFirst.on()).toBe(false);
    practiceFirst.__reset(); row([COACH]);
    expect(await practiceFirst.on()).toBe(false);
    practiceFirst.__reset(); Snap.rows.mockRejectedValue(new Error('down'));
    expect(await practiceFirst.on()).toBe(false);
  });
  test('read once per 30 s', async () => {
    row(true);
    expect(await practiceFirst.on(1000)).toBe(true);
    row(false);
    expect(await practiceFirst.on(20000)).toBe(true);
    expect(await practiceFirst.on(32000)).toBe(false);
  });
  test('a test\'s deps answer first', async () => {
    expect(await practiceFirst.enabled({ practiceFirst: true })).toBe(true);
    expect(await practiceFirst.enabled({ practiceFirst: false })).toBe(false);
    expect(await practiceFirst.enabled({ practiceFirst: async () => true })).toBe(true);
    expect(Snap.rows).not.toHaveBeenCalled();
  });
});

describe('the Learning assessment school list', () => {
  test('OFF: today\'s visit first, then by name; no `practice` field (the answer as before)', async () => {
    const out = await sa.listSchools({ userId: COACH }, world({ first: false }));
    expect(out.status).toBe('ok');
    expect(out.schools.map((s) => s.schoolId)).toEqual([VISITED, ALPHA, SIM]);
    expect(out.schools.every((s) => !('practice' in s))).toBe(true);
  });

  test('ON: the practice school first, above today\'s visit and above a school earlier in the alphabet', async () => {
    const out = await sa.listSchools({ userId: COACH }, world({ first: true }));
    expect(out.schools.map((s) => [s.schoolId, s.practice])).toEqual([[SIM, true], [VISITED, false], [ALPHA, false]]);
  });

  test('ON for an any-school user: the linked practice school is still first (the live list has no test school)', async () => {
    const out = await sa.listSchools({ userId: COACH }, world({ first: true, any: true }));
    expect(out.schools.map((s) => s.schoolId)).toEqual([SIM, VISITED, ALPHA, ELSEWHERE]);
    expect(out.schools[0]).toMatchObject({ name: 'SIM Child Test School', practice: true });
  });

  test('ON: two practice schools sort by name, both above today\'s visit and the coach\'s own', async () => {
    const out = await sa.listSchools({ userId: COACH }, world({ first: true, links: [ALPHA, SIM, SIM2] }));
    expect(out.schools.map((s) => s.schoolId)).toEqual([SIM2, SIM, VISITED, ALPHA]);
  });
});

describe('the WhatsApp /egra school picker', () => {
  beforeEach(() => {
    mockTables.leader_schools = [
      { school_id: SIM, school_name: 'SIM Child Test School', emis: 'SIM-CT-0001' },
      { school_id: ALPHA, school_name: 'Abbot Model School', emis: '101' },
      { school_id: ELSEWHERE, school_name: 'Bari Imam School', emis: '303' },
    ];
    mockTables.schools = SCHOOLS;
  });
  afterEach(() => { Snap.rows.mockReset(); practiceFirst.__reset(); });

  test('OFF: by name', async () => {
    Snap.rows.mockResolvedValue({ data: [], error: null });
    expect((await C.coachSchools(COACH)).map((s) => s.schoolId)).toEqual([ALPHA, ELSEWHERE, SIM]);
  });
  test('ON: the practice school first, then by name', async () => {
    Snap.rows.mockResolvedValue({ data: [{ key: 'sa_r19_practice_first', value: true }], error: null });
    expect((await C.coachSchools(COACH)).map((s) => s.schoolId)).toEqual([SIM, ALPHA, ELSEWHERE]);
  });
});
