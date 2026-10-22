'use strict';

/**
 * Every grade on the coach's list (app_settings sa_all_grades, default OFF). ON and a grade 1–5 named: the list is
 * that grade's (todaysList gets `grade` and `allGrades`), on a day key with `:g<N>`, and an outcome for that list
 * names the same key. OFF, or no grade: today's call, today's key, the grade ignored.
 */

const sa = require('../../shared/services/child-test/app/sa-api.service');

const COACH = 'aaaaaaaa-0000-4000-8000-000000000001';
const SCHOOL = 'bbbbbbbb-0000-4000-8000-000000000002';
const NOW = new Date('2026-10-22T05:00:00Z'); // 10:00 PKT
const DAY_KEY = `day:${COACH}:${SCHOOL}:2026-10-22`;

function chain(data) {
  const q = {
    select: () => q, eq: () => q, in: () => q, gte: () => q, order: () => q, limit: () => q,
    then: (res, rej) => Promise.resolve({ data, error: null }).then(res, rej),
  };
  return q;
}

function world({ on } = {}) {
  const calls = { todaysList: [], markOutcome: [] };
  const LIST = { ok: true, cycleId: 'ICT-2026-Q4', grade: 1, gradeFallback: false, reused: false, children: [], alternates: [] };
  const deps = {
    enabled: async () => true,
    supabase: { from: (t) => chain(t === 'leader_schools' ? [{ school_id: SCHOOL, school_name: 'Testwala School' }] : []) },
    store: { listSessionsForVisit: async () => ({ ok: true, sessions: [] }), listVisitDraws: async () => ({ ok: true, draws: [] }) },
    draw: {
      todaysList: async (a) => { calls.todaysList.push(a); return LIST; },
      markOutcome: async (a) => { calls.markOutcome.push(a); return { ok: true, list: null }; },
    },
    now: () => NOW,
    log: () => {}, logError: () => {},
    ...(on === undefined ? {} : { allGrades: on }),
  };
  return { deps, calls };
}

describe('every grade on the coach\'s list', () => {
  test('ON, Grade 1: todaysList is asked for Grade 1 on the :g1 day key', async () => {
    const { deps, calls } = world({ on: true });
    const out = await sa.dayList({ userId: COACH, schoolId: SCHOOL, grade: 1 }, deps);
    expect(out.status).toBe('ok');
    expect(calls.todaysList[0]).toMatchObject({ visitKey: `${DAY_KEY}:g1`, grade: 1, allGrades: true });
    expect(out.list.visit.visitKey).toBe(`${DAY_KEY}:g1`);
  });

  test('ON, the grade as the page sends it ("4"): Grade 4', async () => {
    const { deps, calls } = world({ on: true });
    await sa.dayList({ userId: COACH, schoolId: SCHOOL, grade: '4' }, deps);
    expect(calls.todaysList[0]).toMatchObject({ visitKey: `${DAY_KEY}:g4`, grade: 4 });
  });

  test('ON, a grade outside 1–5 is refused before any draw', async () => {
    const { deps, calls } = world({ on: true });
    expect(await sa.dayList({ userId: COACH, schoolId: SCHOOL, grade: 7 }, deps)).toEqual({ status: 'invalid', reason: 'bad_grade' });
    expect(calls.todaysList).toEqual([]);
  });

  test('ON, no grade: today\'s call and key', async () => {
    const { deps, calls } = world({ on: true });
    await sa.dayList({ userId: COACH, schoolId: SCHOOL }, deps);
    expect(calls.todaysList[0].visitKey).toBe(DAY_KEY);
    expect(calls.todaysList[0]).not.toHaveProperty('grade');
    expect(calls.todaysList[0]).not.toHaveProperty('allGrades');
  });

  test('ON, an outcome for the Grade 1 list names the :g1 key', async () => {
    const { deps, calls } = world({ on: true });
    await sa.dayOutcome({ userId: COACH, schoolId: SCHOOL, drawId: 'd-1', outcome: 'absent', grade: 1 }, deps);
    expect(calls.markOutcome[0]).toMatchObject({ drawId: 'd-1', outcome: 'absent', visitKey: `${DAY_KEY}:g1` });
  });

  test('OFF: the grade is ignored, today\'s call and key', async () => {
    const { deps, calls } = world({ on: false });
    await sa.dayList({ userId: COACH, schoolId: SCHOOL, grade: 1 }, deps);
    expect(calls.todaysList[0].visitKey).toBe(DAY_KEY);
    expect(calls.todaysList[0]).not.toHaveProperty('grade');
    expect(calls.todaysList[0]).not.toHaveProperty('allGrades');
    await sa.dayOutcome({ userId: COACH, schoolId: SCHOOL, drawId: 'd-1', outcome: 'absent', grade: 1 }, deps);
    expect(calls.markOutcome[0].visitKey).toBe(DAY_KEY);
  });
});
