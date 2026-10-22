'use strict';

/**
 * Every grade on the coach's list (sa_all_grades) at a school where the coach has today's observe visit: the picked
 * grade was dropped, because the list was keyed on the visit and the visit's list (Grade 3) came back whatever grade
 * was named. Now, with a grade named:
 *  - the visit's own list serves only when it is that grade;
 *  - any other grade (or a visit with no list yet) is drawn on the day key with `:g<N>`, so the observe visit keeps its
 *    own un-graded list and each other grade has its own;
 *  - an outcome for that list names the same key;
 *  - the server never answers with a list of another grade.
 * OFF, or no grade named: the visit's list as before.
 */

const sa = require('../../shared/services/child-test/app/sa-api.service');

const COACH = 'aaaaaaaa-0000-4000-8000-000000000011';
const SCHOOL = 'bbbbbbbb-0000-4000-8000-000000000012';
const VISIT = 'eeeeeeee-0000-4000-8000-000000000013';
const NOW = new Date('2026-10-22T05:00:00Z'); // 10:00 PKT
const DAY_KEY = `day:${COACH}:${SCHOOL}:2026-10-22`;

function chain(data) {
  const q = {
    select: () => q, eq: () => q, in: () => q, gte: () => q, order: () => q, limit: () => q,
    then: (res, rej) => Promise.resolve({ data, error: null }).then(res, rej),
  };
  return q;
}

/** A coach with today's observe visit at the school; the visit's list is `visitGrade` (null: not drawn yet). */
function world({ on = true, visitGrade = 3 } = {}) {
  const calls = { todaysList: [], markOutcome: [] };
  const draws = visitGrade == null ? [] : [
    { id: 'd-1', list_slot: 'main', grade: visitGrade, status: 'listed' },
    { id: 'd-2', list_slot: 'alternate', grade: visitGrade, status: 'listed' },
  ];
  const deps = {
    enabled: async () => true,
    supabase: {
      from: (t) => chain(t === 'observation_field_forms'
        ? [{ id: VISIT, observer_user_id: COACH, created_at: NOW.toISOString(), answers: { lp_ref: { grade: 'Grade 3' } } }]
        : t === 'leader_schools' ? [{ school_id: SCHOOL, school_name: 'Testwala School' }] : []),
    },
    store: {
      listSessionsForVisit: async () => ({ ok: true, sessions: [] }),
      listVisitDraws: async (v) => ({ ok: true, draws: v === VISIT ? draws : [] }),
    },
    draw: {
      resolveVisitSchool: async () => ({ ok: true, schoolId: SCHOOL }),
      todaysList: async (a) => {
        calls.todaysList.push(a);
        const grade = a.visitId ? (visitGrade || a.grade || 3) : a.grade;
        return { ok: true, cycleId: 'ICT-2026-Q4', grade, gradeFallback: false, reused: !!a.visitId, children: [], alternates: [] };
      },
      markOutcome: async (a) => { calls.markOutcome.push(a); return { ok: true, list: null }; },
    },
    now: () => NOW,
    log: () => {}, logError: () => {},
    allGrades: on,
  };
  return { deps, calls };
}

describe('a named grade at a school with today\'s observe visit', () => {
  test('a visit with a G3 list + grade 1 → a G1 list, keyed …:g1', async () => {
    const { deps, calls } = world();
    const out = await sa.dayList({ userId: COACH, schoolId: SCHOOL, visitId: VISIT, grade: 1 }, deps);
    expect(out.status).toBe('ok');
    expect(calls.todaysList).toHaveLength(1);
    expect(calls.todaysList[0]).toMatchObject({ visitKey: `${DAY_KEY}:g1`, grade: 1, allGrades: true });
    expect(calls.todaysList[0]).not.toHaveProperty('visitId');
    expect(out.list).toMatchObject({ grade: 1, visit: { visitId: null, visitKey: `${DAY_KEY}:g1` } });
  });

  test('grade 3 → the visit\'s list unchanged', async () => {
    const { deps, calls } = world();
    const out = await sa.dayList({ userId: COACH, schoolId: SCHOOL, visitId: VISIT, grade: 3 }, deps);
    expect(calls.todaysList[0]).toMatchObject({ visitId: VISIT });
    expect(out.list).toMatchObject({ grade: 3, visit: { visitId: VISIT, visitKey: null } });
  });

  test('a visit with no list yet + a grade → that grade on the graded day key; the visit\'s own list is not drawn', async () => {
    const { deps, calls } = world({ visitGrade: null });
    const out = await sa.dayList({ userId: COACH, schoolId: SCHOOL, visitId: VISIT, grade: 3 }, deps);
    expect(calls.todaysList[0]).toMatchObject({ visitKey: `${DAY_KEY}:g3`, grade: 3 });
    expect(out.list.grade).toBe(3);
  });

  test('an outcome for the G1 list names the same :g1 key, not the visit', async () => {
    const { deps, calls } = world();
    await sa.dayOutcome({ userId: COACH, schoolId: SCHOOL, visitId: VISIT, drawId: 'd-9', outcome: 'absent', grade: 1 }, deps);
    expect(calls.markOutcome[0]).toMatchObject({ drawId: 'd-9', visitKey: `${DAY_KEY}:g1` });
    expect(calls.markOutcome[0]).not.toHaveProperty('visitId');
  });

  test('the server never answers with another grade: a list that comes back as the wrong grade is redrawn on the graded key', async () => {
    const { deps, calls } = world();
    // the visit's draws say Grade 1, but the list the draw returns is Grade 3 (a stale or mixed visit list)
    deps.store.listVisitDraws = async (v) => (v !== VISIT ? { ok: true, draws: [] } : { ok: true, draws: [{ id: 'd-1', list_slot: 'main', grade: 1, status: 'listed' }] });
    deps.draw.todaysList = async (a) => { calls.todaysList.push(a); return { ok: true, cycleId: 'c', grade: a.visitId ? 3 : a.grade, children: [], alternates: [] }; };
    const out = await sa.dayList({ userId: COACH, schoolId: SCHOOL, visitId: VISIT, grade: 1 }, deps);
    expect(out.list.grade).toBe(1);
    expect(calls.todaysList.map((a) => a.visitKey || a.visitId)).toEqual([VISIT, `${DAY_KEY}:g1`]);
  });

  test('OFF: the grade is ignored and the visit\'s list serves (byte-identical call)', async () => {
    const { deps, calls } = world({ on: false });
    const out = await sa.dayList({ userId: COACH, schoolId: SCHOOL, visitId: VISIT, grade: 1 }, deps);
    expect(calls.todaysList[0]).toEqual({ coachUserId: COACH, schoolId: SCHOOL, observedGrade: 3, visitId: VISIT });
    expect(out.list.grade).toBe(3);
  });

  test('ON, no grade named: the visit\'s list as before', async () => {
    const { deps, calls } = world();
    await sa.dayList({ userId: COACH, schoolId: SCHOOL, visitId: VISIT }, deps);
    expect(calls.todaysList[0]).toEqual({ coachUserId: COACH, schoolId: SCHOOL, observedGrade: 3, visitId: VISIT });
  });
});
