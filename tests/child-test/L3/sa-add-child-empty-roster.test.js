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
 * The rule is the draw's own answer for that visit: "Add a child" on an empty day list asks the draw first, with the
 * visit's own grades, at a Gilgit-Baltistan school only. Children to list → they are listed and the child joins them.
 * Nobody to list because nobody is on the roster (no_class_list) → the first child opens the list. Every child already
 * tested (frame_exhausted) → the first child opens it (the coach's second visit). At an ICT school every one of these is
 * exactly sandbox: the day list's answer carries nothing new, and "Add a child" on an empty list is no_list with
 * nothing written.
 * The draw itself, called without the visit's draw, keeps today's rule (no_list), and a day key for another school
 * or another day is still refused. The coach app's clock is the draw's clock: Date is faked, and one case moves it.
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
// Date only: the draw's timers, promises and setImmediate stay real.
const FAKE_DATE = { doNotFake: ['hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame',
  'requestIdleCallback', 'cancelIdleCallback', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] };

function seed({ roster = [], schoolRegion = 'Gilgit-Baltistan', allGrades = true } = {}) {
  const tables = {
    users: [{ id: COACH, role: 'coach', region: schoolRegion }],
    schools: [
      { id: SCHOOL, name: 'GB School', region: schoolRegion, is_active: true, is_probable_test: false },
      { id: OTHER, name: 'Other School', region: schoolRegion, is_active: true, is_probable_test: false },
    ],
    leader_schools: [{ id: 'ls-1', leader_user_id: COACH, school_id: SCHOOL, school_name: 'GB School' }],
    region_features: [
      { region: 'gilgit-baltistan', organization: 'moawin', display_name: 'Gilgit-Baltistan', is_active: true },
      { region: 'urban', organization: 'niete', display_name: 'Urban', is_active: true },
      { region: 'sihala', organization: 'niete', display_name: 'Sihala', is_active: true },
    ],
    app_settings: [{ key: 'sa_add_child', value: true }, ...(allGrades ? [{ key: 'sa_all_grades', value: true }] : [])],
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
  jest.useFakeTimers({ now: NOW, ...FAKE_DATE });
  jest.resetModules();
  process.env = {
    ...ENV,
    CHILD_TEST_ENABLED: 'true',
    CHILD_TEST_REGIONS: 'niete,ict,gilgit-baltistan,urban,sihala',
    CHILD_TEST_COACH_IDS: COACH,
    CHILD_TEST_DRAW_SECRET: 'test-secret',
    CHILD_TEST_FORM_POLICY: 'returning_b',
  };
  sa = require('../../../bot/shared/services/child-test/app/sa-api.service');
});
afterEach(() => { jest.useRealTimers(); });
afterAll(() => { process.env = ENV; });

const T = () => mockFake.__tables;
const deps = { now: () => NOW };
const add = (extra = {}) => sa.addChild({
  userId: COACH, schoolId: SCHOOL, grade: 3, listGrade: 3, firstName: 'Zara', section: null, clientChildId: KID, ...extra,
}, deps);

describe('a school with no children on its roster', () => {
  test('the day list itself cannot be drawn (today, unchanged): no_class_list', async () => {
    seed();
    // the answer also tells the page that "Add a child" opens the list here
    expect(await sa.dayList({ userId: COACH, schoolId: SCHOOL, grade: 3 }, deps)).toEqual({ status: 'invalid', reason: 'no_class_list', addOpens: true });
  });

  test('RED on the head before this fix: the coach app\'s clock is the draw\'s clock (a wall clock on another day does not refuse the list)', async () => {
    seed();
    jest.setSystemTime(new Date('2026-11-27T05:00:00Z')); // the server's own clock, a day on from the coach's day
    // the day list is the coach's day (deps.now), so the draw answers for that day: nobody to list, not a bad key
    expect(await sa.dayList({ userId: COACH, schoolId: SCHOOL, grade: 3 }, deps)).toMatchObject({ status: 'invalid', reason: 'no_class_list' });
    expect((await add()).status).toBe('ok');
    const again = await sa.dayList({ userId: COACH, schoolId: SCHOOL, grade: 3 }, deps);
    expect(again).toMatchObject({ status: 'ok', list: { reused: true } });
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
  test('a school WITH children in that grade: the draw lists them first, and the added child joins that list, last', async () => {
    seed({ roster: [{ id: 'g3a', grade: 3, size: 8 }] });
    const out = await add();
    expect(out.status).toBe('ok');
    expect(out.list.children).toHaveLength(6);
    expect(out.list.children[5]).toMatchObject({ firstName: 'Zara' });
    expect(out.list.children.slice(0, 5).every((c) => c.role === 'new' && c.firstName !== 'Zara')).toBe(true);
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

  // These call the draw as the coach app does: with the visit's own draw (visitDraw), so an empty list asks it first.
  const visitDraw = { coachUserId: COACH, grade: 3, allGrades: true };

  test('the draw refuses a day key for another school or another day', async () => {
    seed();
    const draw = require('../../../bot/shared/services/child-test/draw');
    const base = { schoolId: SCHOOL, grade: 3, firstName: 'Zara', clientChildId: KID, now: NOW, visitDraw };
    expect(await draw.addChild({ ...base, visitKey: `day:${COACH}:${OTHER}:2026-11-26:g3` })).toEqual({ ok: false, reason: 'no_list' });
    expect(await draw.addChild({ ...base, visitKey: `day:${COACH}:${SCHOOL}:2026-11-25:g3` })).toEqual({ ok: false, reason: 'no_list' });
    expect(T().students).toHaveLength(0);
  });

  test('a grade\'s own day list opens only with a child of that grade (the list keeps its grade)', async () => {
    seed();
    const draw = require('../../../bot/shared/services/child-test/draw');
    const g3 = `day:${COACH}:${SCHOOL}:2026-11-26:g3`;
    expect(await draw.addChild({ schoolId: SCHOOL, visitKey: g3, grade: 1, firstName: 'Zara', clientChildId: KID, now: NOW, visitDraw })).toEqual({ ok: false, reason: 'no_list' });
    expect((await draw.addChild({ schoolId: SCHOOL, visitKey: g3, grade: 3, firstName: 'Zara', clientChildId: KID, now: NOW, visitDraw })).ok).toBe(true);
  });

  test('an observe visit at another school does not open an empty list here', async () => {
    seed();
    T().observation_field_forms.push({ id: 'visit-x', observer_user_id: COACH, visit_context: { school_ext_id: 'niete:999' } });
    const draw = require('../../../bot/shared/services/child-test/draw');
    expect(await draw.addChild({ schoolId: SCHOOL, visitId: 'visit-x', grade: 3, firstName: 'Zara', clientChildId: KID, now: NOW, visitDraw: { coachUserId: COACH } })).toEqual({ ok: false, reason: 'no_list' });
    expect(T().students).toHaveLength(0);
  });
});

describe('the draw decides whether anybody is listed, across the grades it would list', () => {
  test('RED on the head before this fix: the draw itself, with nobody listed yet, keeps today\'s rule; the visit then draws its Grade 5 list', async () => {
    // the reviewer's probe: 12 children in Grade 5, none in Grade 3, an observe visit whose list is not drawn yet
    const { buildRoster } = require('./helpers/roster');
    const tables = buildRoster({ classes: [{ id: 'g5a', grade: 5, section: 'A', size: 12 }] });
    tables.schools[0].region = 'Urban';
    tables.region_features = [{ region: 'urban', organization: 'niete', display_name: 'Urban', is_active: true }];
    mockFake = createFakeSupabase(tables, { unique: CHILD_TEST_UNIQUE });
    const draw = require('../../../bot/shared/services/child-test/draw');
    const added = await draw.addChild({ schoolId: 'school-1', visitId: 'visit-1', grade: 3, firstName: 'Zara', clientChildId: KID, now: NOW });
    expect(added).toEqual({ ok: false, reason: 'no_list' });
    const list = await draw.todaysList({ coachUserId: 'coach-1', schoolId: 'school-1', visitId: 'visit-1', observedGrade: 5, now: NOW });
    expect(list).toMatchObject({ ok: true, grade: 5 });
    expect(list.children).toHaveLength(5);
    expect(T().child_test_draws.some((d) => d.student_id === KID)).toBe(false);
  });

  test('RED on the head before this fix: without every grade, a Grade 3 child added before the list is drawn joins the Grade 5 list the draw makes', async () => {
    seed({ roster: [{ id: 'g5a', grade: 5, size: 12 }], allGrades: false });
    const out = await add({ listGrade: undefined });
    expect(out.status).toBe('ok');
    expect(out.list.grade).toBe(5);
    expect(out.list.children.filter((c) => c.grade === 5)).toHaveLength(5);
    expect(out.list.children.map((c) => c.firstName)).toContain('Zara');
  });
});

describe('the second visit: every child on the list already tested', () => {
  // Day 1: two children added and tested. Day 2: the draw has nobody left (frame_exhausted).
  const DAY2 = new Date('2026-11-27T05:00:00Z');
  async function dayOneThenTwo(schoolRegion) {
    seed({ schoolRegion });
    await add();
    await add({ firstName: 'Bilal', clientChildId: KID2 });
    for (const r of T().child_test_draws) { r.status = 'tested'; r.tested_at = NOW.toISOString(); }
    jest.setSystemTime(DAY2);
    const d2 = { now: () => new Date(DAY2) };
    const list = await sa.dayList({ userId: COACH, schoolId: SCHOOL, grade: 3 }, d2);
    const added = await sa.addChild({ userId: COACH, schoolId: SCHOOL, grade: 3, listGrade: 3, firstName: 'Sana', clientChildId: '0a0a0a0a-0000-4000-8000-0000000000a3' }, d2);
    return { list, added };
  }

  test('RED on the head before this fix: at a Gilgit-Baltistan school, "Add a child" opens day 2\'s list', async () => {
    const { list, added } = await dayOneThenTwo('Gilgit-Baltistan');
    expect(list).toEqual({ status: 'invalid', reason: 'frame_exhausted', addOpens: true });
    expect(added.status).toBe('ok');
    expect(added.list.children.map((c) => c.firstName)).toEqual(['Sana']);
  });

  test('at an ICT school, unchanged: the roster drawn and tested on day 1, day 2 tells the page nothing new and refuses the add', async () => {
    seed({ schoolRegion: 'Urban', roster: [{ id: 'g3a', grade: 3, size: 4 }] });
    expect((await sa.dayList({ userId: COACH, schoolId: SCHOOL, grade: 3 }, deps)).status).toBe('ok');
    for (const r of T().child_test_draws) { r.status = 'tested'; r.tested_at = NOW.toISOString(); }
    jest.setSystemTime(DAY2);
    const d2 = { now: () => new Date(DAY2) };
    expect(await sa.dayList({ userId: COACH, schoolId: SCHOOL, grade: 3 }, d2)).toEqual({ status: 'invalid', reason: 'frame_exhausted' });
    const before = T().child_test_draws.length;
    expect(await sa.addChild({ userId: COACH, schoolId: SCHOOL, grade: 3, listGrade: 3, firstName: 'Sana', clientChildId: '0a0a0a0a-0000-4000-8000-0000000000a3' }, d2))
      .toEqual({ status: 'invalid', reason: 'no_list' });
    expect(T().students.some((st) => st.student_name === 'Sana')).toBe(false);
    expect(T().child_test_draws).toHaveLength(before);
  });
});

describe('an ICT school is exactly sandbox: nothing new on the page\'s answer, nothing written by "Add a child"', () => {
  const rows = () => ({ classes: T().classes.length, students: T().students.length, enrolments: T().class_enrollments.length, draws: T().child_test_draws.length });

  test('RED on the second review\'s head: no class for Grade 3: dayList is sandbox\'s answer, and addChild is no_list with 0 rows written', async () => {
    seed({ schoolRegion: 'Sihala' });
    const before = rows();
    expect(await sa.dayList({ userId: COACH, schoolId: SCHOOL, grade: 3 }, deps)).toEqual({ status: 'invalid', reason: 'no_class_list' });
    expect(await add()).toEqual({ status: 'invalid', reason: 'no_list' });
    expect(rows()).toEqual(before);
  });

  test('RED on the second review\'s head: the same with every grade off', async () => {
    seed({ schoolRegion: 'Urban', allGrades: false });
    const before = rows();
    expect(await sa.dayList({ userId: COACH, schoolId: SCHOOL }, deps)).toEqual({ status: 'invalid', reason: 'no_class_list' });
    expect(await add({ listGrade: undefined })).toEqual({ status: 'invalid', reason: 'no_list' });
    expect(rows()).toEqual(before);
  });

  test('RED on the second review\'s head: rosters in Grades 3 and 5 but none in Grade 1: no "Grade 1 A" class is made', async () => {
    seed({ schoolRegion: 'Sihala', roster: [{ id: 'g3a', grade: 3, size: 6 }, { id: 'g5a', grade: 5, size: 6 }] });
    const before = rows();
    expect(await sa.dayList({ userId: COACH, schoolId: SCHOOL, grade: 1 }, deps)).toEqual({ status: 'invalid', reason: 'no_class_list' });
    expect(await add({ grade: 1, listGrade: 1 })).toEqual({ status: 'invalid', reason: 'no_list' });
    expect(rows()).toEqual(before);
  });

  test('RED on the second review\'s head: 12 children in Grade 5, a Grade 3 child added before any list: no_list, nothing drawn', async () => {
    seed({ schoolRegion: 'Urban', roster: [{ id: 'g5a', grade: 5, size: 12 }], allGrades: false });
    const before = rows();
    expect(await add({ listGrade: undefined })).toEqual({ status: 'invalid', reason: 'no_list' });
    expect(rows()).toEqual(before);
  });

  test('the normal order at an ICT school (list first, then add) is today\'s: the drawn list, then the child last', async () => {
    seed({ schoolRegion: 'Sihala', roster: [{ id: 'g3a', grade: 3, size: 8 }] });
    const list = await sa.dayList({ userId: COACH, schoolId: SCHOOL, grade: 3 }, deps);
    expect(list.status).toBe('ok');
    const out = await add();
    expect(out.status).toBe('ok');
    expect(out.list.children.map((c) => c.drawId).slice(0, list.list.children.length)).toEqual(list.list.children.map((c) => c.drawId));
    expect(out.list.children[out.list.children.length - 1].firstName).toBe('Zara');
  });
});
