/**
 * Child test draw — a child added on the spot (switch sa_add_child; the caller reads it). The coach types a first
 * name, the grade and (optionally) the section: the child is written to the roster (students + an enrolment in that
 * class, the class made if the school has none for that grade and section) and seated on the open list as a main
 * row. Their draw row is marked as added (algo_version, a rank above any frame), so a class framed later is still
 * drawn in full and never collides with it. A double tap (the same client id) adds the child once. Names are never
 * logged. Only the Supabase client is replaced.
 */
const { createFakeSupabase, CHILD_TEST_UNIQUE } = require('./helpers/fake-supabase');
const { buildRoster } = require('./helpers/roster');

let mockFake;
jest.mock('../../../bot/shared/config/supabase', () => ({ from: (...a) => mockFake.from(...a) }));
jest.mock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
const { logToFile } = require('../../../bot/shared/utils/logger');
const draw = require('../../../bot/shared/services/child-test/draw');

const NOW = new Date('2026-10-05T06:00:00Z');
const KID = '0a0a0a0a-0000-4000-8000-000000000001';
const KID2 = '0a0a0a0a-0000-4000-8000-000000000002';

function setup(classes = [{ id: 'g3a', grade: 3, section: 'A', size: 20 }, { id: 'g5a', grade: 5, section: 'A', size: 20 }]) {
  mockFake = createFakeSupabase(buildRoster({ classes }), { unique: CHILD_TEST_UNIQUE });
  return mockFake;
}
const T = () => mockFake.__tables;
const list = (visit, extra = {}) => draw.todaysList({ coachUserId: 'coach-1', schoolId: 'school-1', visitId: visit, observedGrade: 3, now: NOW, ...extra });
const add = (extra = {}) => draw.addChild({ schoolId: 'school-1', visitId: 'visit-1', grade: 3, firstName: 'Zara', section: 'A', clientChildId: KID, now: NOW, ...extra });

beforeEach(() => { process.env.CHILD_TEST_DRAW_SECRET = 'test-secret'; process.env.CHILD_TEST_FORM_POLICY = 'returning_b'; jest.clearAllMocks(); });
afterAll(() => { delete process.env.CHILD_TEST_DRAW_SECRET; delete process.env.CHILD_TEST_FORM_POLICY; });

describe('a child added on the spot', () => {
  test('seated on the open list as a main row, in the named class, on the roster', async () => {
    setup();
    await list('visit-1');
    const r = await add();
    expect(r.ok).toBe(true);
    const kid = r.children.find((k) => k.studentId === KID);
    expect(kid).toMatchObject({ displayName: 'Zara', classId: 'g3a', grade: 3, status: 'listed', role: 'new' });
    expect(r.children).toHaveLength(6);
    expect(T().students.find((s) => s.id === KID)).toMatchObject({ student_name: 'Zara', school_id: 'school-1', status: 'active' });
    expect(T().class_enrollments.find((e) => e.student_id === KID)).toMatchObject({ class_id: 'g3a', is_active: true });
    const row = T().child_test_draws.find((d) => d.student_id === KID);
    expect(row).toMatchObject({ algo_version: draw.ADDED_ALGO, list_slot: 'main', status: 'listed', grade: 3 });
    expect(row.draw_rank).toBeGreaterThan(1000);
  });

  test('a double tap adds the child once', async () => {
    setup();
    await list('visit-1');
    await add();
    const again = await add();
    expect(again.ok).toBe(true);
    expect(T().students.filter((s) => s.id === KID)).toHaveLength(1);
    expect(T().class_enrollments.filter((e) => e.student_id === KID)).toHaveLength(1);
    expect(T().child_test_draws.filter((d) => d.student_id === KID)).toHaveLength(1);
  });

  test('no class for that grade and section: the class is made (this session, morning) and the child seated in it', async () => {
    setup();
    await list('visit-1');
    const r = await add({ grade: 3, section: 'C', clientChildId: KID2, firstName: 'Bilal' });
    expect(r.ok).toBe(true);
    const made = T().classes.find((c) => c.grade_code === 'grade_3' && c.section === 'C');
    expect(made).toMatchObject({ school_id: 'school-1', session_code: '2026-2027', shift_code: 'morning', is_active: true });
    expect(r.children.find((k) => k.studentId === KID2).classId).toBe(made.id);
  });

  test('no section named: the grade\'s first morning class', async () => {
    setup();
    await list('visit-1');
    const r = await add({ section: null });
    expect(r.children.find((k) => k.studentId === KID).classId).toBe('g3a');
  });

  test('a class not yet framed is still framed in full later, without the added child', async () => {
    setup();
    await list('visit-1');
    await add({ grade: 5, section: 'A' });
    const g5 = await list('visit-2', { observedGrade: 5 });
    expect(g5.ok).toBe(true);
    const frame = T().child_test_draws.filter((d) => d.class_id === 'g5a' && d.algo_version !== draw.ADDED_ALGO);
    expect(frame).toHaveLength(20);
    expect(frame.some((d) => d.student_id === KID)).toBe(false);
  });

  test('no open list for the visit: refused, nothing written', async () => {
    setup();
    expect(await add()).toEqual({ ok: false, reason: 'no_list' });
    expect(T().students.some((s) => s.id === KID)).toBe(false);
  });

  test('the name is never logged', async () => {
    setup();
    await list('visit-1');
    await add();
    expect(JSON.stringify(logToFile.mock.calls)).not.toContain('Zara');
  });
});
