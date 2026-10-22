/**
 * Child test draw — every grade (switch sa_all_grades, default OFF). ON, the caller names the grade (1–5):
 * that grade is the only one tried (no 3↔5 fallback), its classes are framed and drawn as Grade 3 / 5 are, and
 * an absent child's top-up comes from the same grade. OFF, or no grade named, the draw is today's: Grade 3 and
 * Grade 5 only. Only the Supabase client is replaced.
 */
const { createFakeSupabase, CHILD_TEST_UNIQUE } = require('./helpers/fake-supabase');
const { buildRoster } = require('./helpers/roster');

let mockFake;
jest.mock('../../../bot/shared/config/supabase', () => ({ from: (...a) => mockFake.from(...a) }));
jest.mock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
const draw = require('../../../bot/shared/services/child-test/draw');

const NOW = new Date('2026-10-05T06:00:00Z');
const CLASSES = [
  { id: 'g1a', grade: 1, section: 'A', size: 20 },
  { id: 'g3a', grade: 3, section: 'A', size: 20 },
  { id: 'g5a', grade: 5, section: 'A', size: 20 },
];

function setup(classes = CLASSES) {
  mockFake = createFakeSupabase(buildRoster({ classes }), { unique: CHILD_TEST_UNIQUE });
  return mockFake;
}
const T = () => mockFake.__tables;
const list = (visit, extra = {}) => draw.todaysList({ coachUserId: 'coach-1', schoolId: 'school-1', visitId: visit, now: NOW, ...extra });

beforeEach(() => { process.env.CHILD_TEST_DRAW_SECRET = 'test-secret'; process.env.CHILD_TEST_FORM_POLICY = 'returning_b'; jest.clearAllMocks(); });
afterAll(() => { delete process.env.CHILD_TEST_DRAW_SECRET; delete process.env.CHILD_TEST_FORM_POLICY; });

describe('ON: the coach names the grade', () => {
  test('Grade 1: 5 + 2 from the Grade 1 class, framed like any grade, no fallback flag', async () => {
    setup();
    const r = await list('visit-1', { allGrades: true, grade: 1 });
    expect(r.ok).toBe(true);
    expect(r.grade).toBe(1);
    expect(r.gradeFallback).toBe(false);
    expect(r.children).toHaveLength(5);
    expect(r.alternates).toHaveLength(2);
    for (const k of [...r.children, ...r.alternates]) expect(k).toMatchObject({ classId: 'g1a', grade: 1, role: 'new' });
    expect(T().child_test_draws.filter((d) => d.class_id === 'g1a')).toHaveLength(20);
    expect(T().child_test_draws.some((d) => d.class_id === 'g3a' || d.class_id === 'g5a')).toBe(false);
  });

  test('Grade 4 with no Grade 4 class: no list, and no fallback to Grade 3 or 5', async () => {
    setup();
    const r = await list('visit-1', { allGrades: true, grade: 4 });
    expect(r).toEqual({ ok: false, reason: 'no_class_list', grade: 4 });
    expect(T().child_test_draws).toHaveLength(0);
  });

  test('Grade 5 named on the first visit (where the alternation would give Grade 3)', async () => {
    setup();
    const r = await list('visit-1', { allGrades: true, grade: 5 });
    expect(r.grade).toBe(5);
    expect(r.children.every((k) => k.classId === 'g5a')).toBe(true);
  });

  test('an absent Grade 1 child: the alternate moves up and the top-up is Grade 1', async () => {
    setup();
    const r = await list('visit-1', { allGrades: true, grade: 1 });
    const out = await draw.markOutcome({ drawId: r.children[0].drawId, outcome: 'absent', now: NOW });
    expect(out.ok).toBe(true);
    expect(out.list.children.filter((k) => k.status === 'listed')).toHaveLength(5);
    expect(out.list.alternates).toHaveLength(2);
    for (const k of [...out.list.children, ...out.list.alternates]) expect(k.classId).toBe('g1a');
  });

  test('no grade named: today\'s alternation (Grade 3 first)', async () => {
    setup();
    const r = await list('visit-1', { allGrades: true });
    expect(r.grade).toBe(3);
  });

  test('a grade outside 1–5 is refused', async () => {
    setup();
    expect(await list('visit-1', { allGrades: true, grade: 6 })).toEqual({ ok: false, reason: 'bad_grade' });
  });
});

describe('OFF: Grade 3 and Grade 5 only, as today', () => {
  test('a named grade is ignored: the observed / alternating grade is drawn', async () => {
    setup();
    const r = await list('visit-1', { grade: 1 });
    expect(r.grade).toBe(3);
    expect(T().child_test_draws.some((d) => d.class_id === 'g1a')).toBe(false);
  });

  test('a school with only Grade 1 has no list', async () => {
    setup([{ id: 'g1a', grade: 1, section: 'A', size: 20 }]);
    const r = await list('visit-1', { grade: 1 });
    expect(r).toEqual({ ok: false, reason: 'no_class_list', grade: 3 });
  });
});
