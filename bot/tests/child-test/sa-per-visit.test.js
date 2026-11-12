'use strict';

/**
 * Children per visit (app_settings sa_per_visit, absent = 5): the caller reads the setting and passes `perVisit` to
 * todaysList, on the SA day list and on the observe2 app list. The value is a whole number clamped to 1–5; anything
 * else, no row, or a read error is 5.
 */

const sa = require('../../shared/services/child-test/app/sa-api.service');
const app = require('../../shared/services/child-test/app/app-api.service');
const perVisit = require('../../shared/services/child-test/app/per-visit-switch');

const COACH = 'aaaaaaaa-0000-4000-8000-000000000001';
const SCHOOL = 'bbbbbbbb-0000-4000-8000-000000000002';
const VISIT = 'cccccccc-0000-4000-8000-000000000003';
const NOW = new Date('2026-10-22T05:00:00Z');

function chain(data, error = null) {
  const q = {
    select: () => q, eq: () => q, in: () => q, gte: () => q, order: () => q, limit: () => q,
    then: (res, rej) => Promise.resolve({ data, error }).then(res, rej),
  };
  return q;
}

function world({ list: listExtra = {}, ...extra } = {}) {
  const calls = { todaysList: [] };
  const LIST = { ok: true, cycleId: 'ICT-2026-Q4', grade: 3, gradeFallback: false, reused: false, children: [], alternates: [], ...listExtra };
  const deps = {
    enabled: async () => true,
    supabase: {
      from: (t) => chain(t === 'leader_schools' ? [{ school_id: SCHOOL, school_name: 'Testwala School' }]
        : t === 'observation_field_forms' ? [{ id: VISIT, observer_user_id: COACH, answers: {} }] : []),
    },
    store: { listSessionsForVisit: async () => ({ ok: true, sessions: [] }), listVisitDraws: async () => ({ ok: true, draws: [] }) },
    draw: {
      todaysList: async (a) => { calls.todaysList.push(a); return LIST; },
      resolveVisitSchool: async () => ({ ok: true, schoolId: SCHOOL }),
    },
    now: () => NOW,
    log: () => {}, logError: () => {},
    ...extra,
  };
  return { deps, calls };
}

const Snap = require('../../shared/services/settings/settings-snapshot');

beforeEach(() => Snap._reset());

describe('the switch value', () => {
  const settings = (rows, error = null) => ({ from: () => chain(rows, error) });
  let at = 1e12;
  const read = (client) => { at += 60 * 1000; return perVisit.count({ supabase: client }, at); };

  test.each([
    ['no row', [], 5],
    ['3', [{ key: 'sa_per_visit', value: 3 }], 3],
    ['"3" as text', [{ key: 'sa_per_visit', value: '3' }], 3],
    ['9 → 5', [{ key: 'sa_per_visit', value: 9 }], 5],
    ['0 → 1', [{ key: 'sa_per_visit', value: 0 }], 1],
    ['2.5 → 5', [{ key: 'sa_per_visit', value: 2.5 }], 5],
    ['true → 5', [{ key: 'sa_per_visit', value: true }], 5],
    ['an object → 5', [{ key: 'sa_per_visit', value: { n: 3 } }], 5],
  ])('%s', async (_, rows, n) => {
    expect(await read(settings(rows))).toBe(n);
  });

  test('a read error → 5', async () => {
    expect(await read(settings(null, { message: 'boom' }))).toBe(5);
  });

  test('a test override wins', async () => {
    expect(await perVisit.count({ perVisit: 3 })).toBe(3);
    expect(await perVisit.count({ perVisit: async () => 2 })).toBe(2);
    expect(await perVisit.count({ perVisit: 'x' })).toBe(5);
  });
});

describe('the callers pass it to the draw', () => {
  test('SA day list, switch 3 → todaysList gets perVisit 3', async () => {
    const { deps, calls } = world({ perVisit: 3 });
    const out = await sa.dayList({ userId: COACH, schoolId: SCHOOL }, deps);
    expect(out.status).toBe('ok');
    expect(calls.todaysList[0]).toMatchObject({ perVisit: 3 });
  });

  test('SA day list: a list drawn at 3 tells the page its size; a list of 5 carries none', async () => {
    const three = world({ list: { perVisit: 3 } });
    expect((await sa.dayList({ userId: COACH, schoolId: SCHOOL }, three.deps)).list.perVisit).toBe(3);
    const five = world();
    expect((await sa.dayList({ userId: COACH, schoolId: SCHOOL }, five.deps)).list).not.toHaveProperty('perVisit');
  });

  test('SA day list, no row → today\'s call, no perVisit (the draw uses 5)', async () => {
    const { deps, calls } = world();
    await sa.dayList({ userId: COACH, schoolId: SCHOOL }, deps);
    expect(calls.todaysList[0]).not.toHaveProperty('perVisit');
  });

  test('SA day list, switch 5 → today\'s call, no perVisit', async () => {
    const { deps, calls } = world({ perVisit: 5 });
    await sa.dayList({ userId: COACH, schoolId: SCHOOL }, deps);
    expect(calls.todaysList[0]).not.toHaveProperty('perVisit');
  });

  test('SA day list, every grade named, switch 3 → grade, allGrades and perVisit 3', async () => {
    const { deps, calls } = world({ perVisit: 3, allGrades: true });
    await sa.dayList({ userId: COACH, schoolId: SCHOOL, grade: 1 }, deps);
    expect(calls.todaysList[0]).toMatchObject({ grade: 1, allGrades: true, perVisit: 3 });
  });

  test('observe2 app list, switch 3 → todaysList gets perVisit 3', async () => {
    const { deps, calls } = world({ perVisit: 3 });
    const out = await app.todaysList({ userId: COACH, visitId: VISIT }, deps);
    expect(out.status).toBe('ok');
    expect(calls.todaysList[0]).toMatchObject({ perVisit: 3 });
  });

  test('observe2 app list, no row → today\'s call, no perVisit', async () => {
    const { deps, calls } = world();
    await app.todaysList({ userId: COACH, visitId: VISIT }, deps);
    expect(calls.todaysList[0]).not.toHaveProperty('perVisit');
  });
});
