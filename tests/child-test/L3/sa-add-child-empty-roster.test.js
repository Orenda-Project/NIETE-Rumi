'use strict';
/**
 * "Add a child" at a school with nobody on its roster (switch sa_add_child). Every Gilgit-Baltistan school on NIETE has
 * 0 students and 0 enrolments today, so the day list cannot be drawn (`no_class_list`) and, until now, "Add a child"
 * refused too (`no_list`): a coach there could not seat a single child. Now the first child added opens the day list,
 * and the coach carries on from it as from any list (it comes back on the next read, the child can be marked present).
 *
 * Driven through the coach app's own API (sa-api.service addChild / dayList / dayOutcome) with the REAL gate, the REAL
 * draw and the REAL store; only the Supabase client is replaced (the L3 in-memory tables).
 *
 * The rule is narrow on purpose: an empty day list opens from "Add a child" only when the school has no child on its
 * roster in that grade, the draw's own "nothing to list" case. A school WITH a roster keeps today's rule (the draw
 * lists first, then the coach adds), and a day key for another school or another day is still refused.
 */
const { createFakeSupabase, CHILD_TEST_UNIQUE } = require('./helpers/fake-supabase');

let mockFake;
jest.mock('../../../bot/shared/config/supabase', () => ({ from: (...a) => mockFake.from(...a) }));
jest.mock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));

const COACH = 'aaaaaaaa-0000-4000-8000-0000000000c1';
const SCHOOL = 'bbbbbbbb-0000-4000-8000-0000000000b1';
const OTHER = 'bbbbbbbb-0000-4000-8000-0000000000b2';
const KID = '0a0a0a0a-0000-4000-8000-0000000000a1';
const KID2 = '0a0a0a0a-0000-4000-8000-0000000000a2';
const NOW = new Date('2026-11-26T05:00:00Z'); // 10:00 PKT
const ENV = { ...process.env };

function seed({ roster = [], schoolRegion = 'Gilgit-Baltistan' } = {}) {
  const tables = {
    users: [{ id: COACH, role: 'coach', region: 'Gilgit-Baltistan' }],
    schools: [
      { id: SCHOOL, name: 'GB School', region: schoolRegion, is_active: true, is_probable_test: false },
      { id: OTHER, name: 'Other School', region: schoolRegion, is_active: true, is_probable_test: false },
    ],
    leader_schools: [{ id: 'ls-1', leader_user_id: COACH, school_id: SCHOOL, school_name: 'GB School' }],
    region_features: [
      { region: 'gilgit-baltistan', organization: 'moawin', display_name: 'Gilgit-Baltistan', is_active: true },
      { region: 'urban', organization: 'niete', display_name: 'Urban', is_active: true },
    ],
    app_settings: [{ key: 'sa_add_child', value: true }, { key: 'sa_all_grades', value: true }],
    classes: [], class_enrollments: [], students: [], observation_field_forms: [],
    child_test_draws: [], child_test_sessions: [], child_test_blocks: [],
  };
  for (const c of roster) {
    tables.classes.push({ id: c.id, school_id: SCHOOL, grade_code: `grade_${c.grade}`, section: 'A', session_code: '2026-2027', shift_code: 'morning', is_active: true });
    for (let r = 1; r <= c.size; r++) {
      const sid = `${c.id}-st${r}`;
      tables.students.push({ id: sid, school_id: SCHOOL, student_name: `Child ${r}`, status: 'active', is_active: true });
      tables.class_enrollments.push({ id: `${sid}-e`, class_id: c.id, student_id: sid, is_active: true });
    }
  }
  mockFake = createFakeSupabase(tables, { unique: CHILD_TEST_UNIQUE });
  return mockFake;
}

let sa;
beforeEach(() => {
  jest.resetModules();
  process.env = {
    ...ENV,
    CHILD_TEST_ENABLED: 'true',
    CHILD_TEST_REGIONS: 'niete,ict,gilgit-baltistan',
    CHILD_TEST_COACH_IDS: COACH,
    CHILD_TEST_DRAW_SECRET: 'test-secret',
    CHILD_TEST_FORM_POLICY: 'returning_b',
  };
  sa = require('../../../bot/shared/services/child-test/app/sa-api.service');
});
afterAll(() => { process.env = ENV; });

const T = () => mockFake.__tables;
const deps = { now: () => NOW };
const add = (extra = {}) => sa.addChild({
  userId: COACH, schoolId: SCHOOL, grade: 3, listGrade: 3, firstName: 'Zara', section: null, clientChildId: KID, ...extra,
}, deps);

describe('a school with no children on its roster', () => {
  test('the day list itself cannot be drawn (today, unchanged): no_class_list', async () => {
    seed();
    expect(await sa.dayList({ userId: COACH, schoolId: SCHOOL, grade: 3 }, deps)).toEqual({ status: 'invalid', reason: 'no_class_list' });
  });

  test('RED on the base: "Add a child" opens the day list with that child, on the roster, in a new Grade 3 class', async () => {
    seed();
    const out = await add();
    expect(out.status).toBe('ok');
    expect(out.list.children).toHaveLength(1);
    expect(out.list.children[0]).toMatchObject({ firstName: 'Zara', grade: 3, status: 'listed', role: 'new', childNo: 1 });
    expect(out.list.visit.visitKey).toBe(`day:${COACH}:${SCHOOL}:2026-11-26:g3`);
    expect(T().students.find((s) => s.id === KID)).toMatchObject({ school_id: SCHOOL, student_name: 'Zara' });
    const made = T().classes.find((c) => c.school_id === SCHOOL && c.grade_code === 'grade_3');
    expect(made).toMatchObject({ section: 'A', shift_code: 'morning', is_active: true });
    expect(T().class_enrollments.find((e) => e.student_id === KID)).toMatchObject({ class_id: made.id, is_active: true });
    // the row is the school's programme's, not ICT's
    expect(T().child_test_draws.find((d) => d.student_id === KID)).toMatchObject({ region: 'gilgit-baltistan', list_slot: 'main' });
  });

  test('the list is then the day\'s list: the next read returns it, a second child joins it, and a child can be marked present', async () => {
    seed();
    await add();
    const again = await sa.dayList({ userId: COACH, schoolId: SCHOOL, grade: 3 }, deps);
    expect(again.status).toBe('ok');
    expect(again.list.reused).toBe(true);
    expect(again.list.children.map((c) => c.firstName)).toEqual(['Zara']);
    const two = await add({ firstName: 'Bilal', clientChildId: KID2 });
    expect(two.list.children.map((c) => c.firstName)).toEqual(['Zara', 'Bilal']);
    const present = await sa.dayOutcome({ userId: COACH, schoolId: SCHOOL, grade: 3, drawId: two.list.children[0].drawId, outcome: 'present' }, deps);
    expect(present.status).toBe('ok');
    expect(typeof present.sessionId).toBe('string');
  });

  test('a double tap adds the child once', async () => {
    seed();
    await add();
    const again = await add();
    expect(again.list.children).toHaveLength(1);
    expect(T().students.filter((s) => s.id === KID)).toHaveLength(1);
    expect(T().child_test_draws.filter((d) => d.student_id === KID)).toHaveLength(1);
  });
});

describe('everything else keeps today\'s rule', () => {
  test('a school WITH children in that grade: an empty list is still refused (the draw lists first)', async () => {
    seed({ roster: [{ id: 'g3a', grade: 3, size: 8 }] });
    expect(await add()).toEqual({ status: 'invalid', reason: 'no_list' });
    expect(T().students.some((s) => s.id === KID)).toBe(false);
  });

  test('a roster in another grade only: the grade with nobody opens from "Add a child"', async () => {
    seed({ roster: [{ id: 'g5a', grade: 5, size: 8 }] });
    expect((await add()).status).toBe('ok');
  });

  test('a school not linked to the coach: not found, nothing written', async () => {
    seed();
    expect(await add({ schoolId: OTHER })).toEqual({ status: 'not_found' });
    expect(T().students).toHaveLength(0);
  });

  test('the draw refuses a day key for another school or another day', async () => {
    seed();
    const draw = require('../../../bot/shared/services/child-test/draw');
    const base = { schoolId: SCHOOL, grade: 3, firstName: 'Zara', clientChildId: KID, now: NOW };
    expect(await draw.addChild({ ...base, visitKey: `day:${COACH}:${OTHER}:2026-11-26:g3` })).toEqual({ ok: false, reason: 'no_list' });
    expect(await draw.addChild({ ...base, visitKey: `day:${COACH}:${SCHOOL}:2026-11-25:g3` })).toEqual({ ok: false, reason: 'no_list' });
    expect(T().students).toHaveLength(0);
  });

  test('a grade\'s own day list opens only with a child of that grade (the list keeps its grade)', async () => {
    seed();
    const draw = require('../../../bot/shared/services/child-test/draw');
    const g3 = `day:${COACH}:${SCHOOL}:2026-11-26:g3`;
    expect(await draw.addChild({ schoolId: SCHOOL, visitKey: g3, grade: 1, firstName: 'Zara', clientChildId: KID, now: NOW })).toEqual({ ok: false, reason: 'no_list' });
    expect((await draw.addChild({ schoolId: SCHOOL, visitKey: g3, grade: 3, firstName: 'Zara', clientChildId: KID, now: NOW })).ok).toBe(true);
  });

  test('an observe visit at another school does not open an empty list here', async () => {
    seed();
    T().observation_field_forms.push({ id: 'visit-x', observer_user_id: COACH, visit_context: { school_ext_id: 'niete:999' } });
    const draw = require('../../../bot/shared/services/child-test/draw');
    expect(await draw.addChild({ schoolId: SCHOOL, visitId: 'visit-x', grade: 3, firstName: 'Zara', clientChildId: KID, now: NOW })).toEqual({ ok: false, reason: 'no_list' });
    expect(T().students).toHaveLength(0);
  });
});
