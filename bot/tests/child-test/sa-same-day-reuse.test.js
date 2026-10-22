'use strict';

/**
 * Every grade on the coach's list (sa_all_grades) at a school with no observe visit today, where the coach already has
 * today's UN-GRADED day list (drawn before the switch, or with no grade named). A named grade equal to that list's
 * grade is that list (reused), not a fresh `:g<N>` twin; another grade is its own `:g<N>` list. An outcome or an added
 * child names the same key the list was served on. OFF, or no grade named: today's key as before.
 */

const sa = require('../../shared/services/child-test/app/sa-api.service');

const COACH = 'aaaaaaaa-0000-4000-8000-000000000021';
const SCHOOL = 'bbbbbbbb-0000-4000-8000-000000000022';
const KID = '0a0a0a0a-0000-4000-8000-000000000023';
const NOW = new Date('2026-10-22T06:00:00Z'); // 11:00 PKT
const DAY_KEY = `day:${COACH}:${SCHOOL}:2026-10-22`;

function chain(data) {
  const q = {
    select: () => q, eq: () => q, in: () => q, gte: () => q, order: () => q, limit: () => q,
    then: (res, rej) => Promise.resolve({ data, error: null }).then(res, rej),
  };
  return q;
}

/** The coach's un-graded day list today is `dayGrade` (null: none drawn). */
function world({ on = true, dayGrade = 3 } = {}) {
  const calls = { todaysList: [], markOutcome: [], addChild: [] };
  const dayRows = dayGrade == null ? [] : [
    { id: 'd-1', list_slot: 'main', grade: dayGrade, status: 'listed' },
    { id: 'd-2', list_slot: 'alternate', grade: dayGrade, status: 'listed' },
  ];
  const deps = {
    enabled: async () => true,
    supabase: { from: (t) => chain(t === 'leader_schools' ? [{ school_id: SCHOOL, school_name: 'Testwala School' }] : []) },
    store: {
      listSessionsForVisit: async () => ({ ok: true, sessions: [] }),
      listVisitDraws: async (v) => ({ ok: true, draws: v === DAY_KEY ? dayRows : [] }),
    },
    draw: {
      todaysList: async (a) => {
        calls.todaysList.push(a);
        const reused = a.visitKey === DAY_KEY && dayGrade != null;
        return { ok: true, cycleId: 'ICT-2026-Q4', grade: reused ? dayGrade : (a.grade || 3), gradeFallback: false, reused, children: [], alternates: [] };
      },
      markOutcome: async (a) => { calls.markOutcome.push(a); return { ok: true, list: null }; },
      addChild: async (a) => { calls.addChild.push(a); return { ok: true, cycleId: 'c', grade: 3, children: [], alternates: [] }; },
    },
    now: () => NOW,
    log: () => {}, logError: () => {},
    allGrades: on,
    addChild: true,
  };
  return { deps, calls };
}

describe('a named grade where the coach has today\'s un-graded day list', () => {
  test('grade 3 = the un-graded list\'s grade → that same list (reused), no :g3 twin', async () => {
    const { deps, calls } = world();
    const out = await sa.dayList({ userId: COACH, schoolId: SCHOOL, grade: 3 }, deps);
    expect(out.status).toBe('ok');
    expect(calls.todaysList).toHaveLength(1);
    expect(calls.todaysList[0].visitKey).toBe(DAY_KEY);
    expect(out.list).toMatchObject({ grade: 3, reused: true, visit: { visitId: null, visitKey: DAY_KEY } });
  });

  test('grade 5 → its own :g5 list (with allGrades, so the draw keeps it disjoint)', async () => {
    const { deps, calls } = world();
    const out = await sa.dayList({ userId: COACH, schoolId: SCHOOL, grade: 5 }, deps);
    expect(calls.todaysList[0]).toMatchObject({ visitKey: `${DAY_KEY}:g5`, grade: 5, allGrades: true });
    expect(out.list.visit.visitKey).toBe(`${DAY_KEY}:g5`);
  });

  test('an outcome with grade 3 names the un-graded key, and passes allGrades for a disjoint top-up', async () => {
    const { deps, calls } = world();
    await sa.dayOutcome({ userId: COACH, schoolId: SCHOOL, drawId: 'd-1', outcome: 'absent', grade: 3 }, deps);
    expect(calls.markOutcome[0]).toMatchObject({ drawId: 'd-1', visitKey: DAY_KEY, allGrades: true });
  });

  test('an outcome with grade 5 names the :g5 key', async () => {
    const { deps, calls } = world();
    await sa.dayOutcome({ userId: COACH, schoolId: SCHOOL, drawId: 'd-9', outcome: 'absent', grade: 5 }, deps);
    expect(calls.markOutcome[0]).toMatchObject({ visitKey: `${DAY_KEY}:g5`, allGrades: true });
  });

  test('add a child to the grade-3 list → the un-graded key', async () => {
    const { deps, calls } = world();
    await sa.addChild({ userId: COACH, schoolId: SCHOOL, grade: 3, listGrade: 3, firstName: 'Zara', clientChildId: KID }, deps);
    expect(calls.addChild[0].visitKey).toBe(DAY_KEY);
  });

  test('no un-graded list today → grade 3 is the :g3 list', async () => {
    const { deps, calls } = world({ dayGrade: null });
    await sa.dayList({ userId: COACH, schoolId: SCHOOL, grade: 3 }, deps);
    expect(calls.todaysList[0]).toMatchObject({ visitKey: `${DAY_KEY}:g3`, grade: 3 });
  });

  test('OFF: today\'s key, the same call as before; an outcome carries no allGrades', async () => {
    const { deps, calls } = world({ on: false });
    await sa.dayList({ userId: COACH, schoolId: SCHOOL, grade: 5 }, deps);
    expect(calls.todaysList[0]).toEqual({ coachUserId: COACH, schoolId: SCHOOL, observedGrade: null, visitKey: DAY_KEY });
    await sa.dayOutcome({ userId: COACH, schoolId: SCHOOL, drawId: 'd-1', outcome: 'absent', grade: 5 }, deps);
    expect(calls.markOutcome[0]).toEqual({ drawId: 'd-1', outcome: 'absent', note: undefined, visitKey: DAY_KEY });
  });
});
