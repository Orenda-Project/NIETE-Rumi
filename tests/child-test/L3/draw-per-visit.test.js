/**
 * Child test draw — children per visit (switch sa_per_visit; the caller reads it and passes `perVisit`). Absent, or a
 * value that is not a whole number, it is 5 (today); a whole number is clamped to 1–5. With 3: 1 returning child (when
 * there is one) + new children to 3, then 2 alternates; an absent child's place is taken by the first alternate and the
 * alternates are topped up, as with 5. A list already drawn keeps its size when it is reopened. Only the Supabase client
 * is replaced.
 */
const { createFakeSupabase, CHILD_TEST_UNIQUE } = require('./helpers/fake-supabase');
const { buildRoster } = require('./helpers/roster');

let mockFake;
jest.mock('../../../bot/shared/config/supabase', () => ({ from: (...a) => mockFake.from(...a) }));
jest.mock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
const draw = require('../../../bot/shared/services/child-test/draw');

const NOW = new Date('2026-10-05T06:00:00Z');
const days = (n) => new Date(NOW.getTime() + n * 86400000);

function setup(classes = [{ id: 'g3a', grade: 3, section: 'A', size: 25 }]) {
  mockFake = createFakeSupabase(buildRoster({ classes }), { unique: CHILD_TEST_UNIQUE });
  return mockFake;
}
const T = () => mockFake.__tables;
const list = (visit, extra = {}) => draw.todaysList({ coachUserId: 'coach-1', schoolId: 'school-1', visitId: visit, observedGrade: 3, now: NOW, ...extra });
const ids = (kids) => kids.map((k) => k.studentId);

beforeEach(() => { process.env.CHILD_TEST_DRAW_SECRET = 'test-secret'; process.env.CHILD_TEST_FORM_POLICY = 'returning_b'; jest.clearAllMocks(); });
afterAll(() => { delete process.env.CHILD_TEST_DRAW_SECRET; delete process.env.CHILD_TEST_FORM_POLICY; });

describe('3 per visit', () => {
  test('3 new children, then 2 alternates: ranks 1-3 listed, 4-5 alternates', async () => {
    setup();
    const r = await list('visit-1', { perVisit: 3 });
    expect(r.ok).toBe(true);
    expect(r.children).toHaveLength(3);
    expect(r.alternates).toHaveLength(2);
    const frame = T().child_test_draws.filter((d) => d.class_id === 'g3a');
    expect(frame).toHaveLength(25);
    const rankOf = (sid) => frame.find((d) => d.student_id === sid).draw_rank;
    expect(r.children.map((k) => rankOf(k.studentId)).sort()).toEqual([1, 2, 3]);
    expect(r.alternates.map((k) => rankOf(k.studentId)).sort()).toEqual([4, 5]);
    expect(frame.filter((d) => d.status === 'listed')).toHaveLength(5);
    expect(r.perVisit).toBe(3);
    const again = await list('visit-1');
    expect(again).toMatchObject({ reused: true, perVisit: 3 });
  });

  test('a list of 5 carries no size: today\'s list, byte for byte', async () => {
    setup();
    const r = await list('visit-1', { perVisit: 5 });
    expect(r).not.toHaveProperty('perVisit');
    expect(T().child_test_draws.filter((d) => d.status === 'listed').every((d) => d.history.every((h) => !('per_visit' in h)))).toBe(true);
    const off = await list('visit-2');
    expect(off).not.toHaveProperty('perVisit');
  });

  test('absent: the first alternate moves up, the alternates are topped up to 2, the list stays at 3', async () => {
    setup();
    const r = await list('visit-1', { perVisit: 3 });
    const gone = r.children[1];
    const m = await draw.markOutcome({ drawId: gone.drawId, outcome: 'absent', now: NOW });
    expect(m.ok).toBe(true);
    const active = m.list.children.filter((k) => k.status === 'listed');
    expect(active).toHaveLength(3);
    expect(ids(active)).toContain(r.alternates[0].studentId);
    expect(m.list.alternates).toHaveLength(2);
    expect(ids(m.list.alternates)).toContain(r.alternates[1].studentId);
    const again = await list('visit-1', { perVisit: 3 });
    expect(again.reused).toBe(true);
    expect(ids(again.children).sort()).toEqual(ids(m.list.children).sort());
  });

  test('the returning child counts toward the 3: 1 returning + 2 new', async () => {
    setup();
    const first = await list('visit-1', { perVisit: 3 });
    for (const k of first.children) await draw.markOutcome({ drawId: k.drawId, outcome: 'present', now: NOW });
    const r = await list('visit-2', { perVisit: 3, now: days(43) });
    expect(r.children).toHaveLength(3);
    expect(r.children.filter((k) => k.role === 'returning')).toHaveLength(1);
    expect(r.children.filter((k) => k.role === 'new')).toHaveLength(2);
    expect(r.alternates).toHaveLength(2);
    expect(r.perVisit).toBe(3);
  });

  test('every grade (sa_all_grades), Grade 1 named: 3 + 2 from the Grade 1 class', async () => {
    setup([{ id: 'g1a', grade: 1, section: 'A', size: 20 }, { id: 'g3a', grade: 3, section: 'A', size: 20 }]);
    const r = await draw.todaysList({ coachUserId: 'coach-1', schoolId: 'school-1', visitId: 'visit-1', allGrades: true, grade: 1, perVisit: 3, now: NOW });
    expect(r.ok).toBe(true);
    expect(r.grade).toBe(1);
    expect(r.children).toHaveLength(3);
    expect(r.alternates).toHaveLength(2);
    for (const k of [...r.children, ...r.alternates]) expect(k).toMatchObject({ classId: 'g1a', grade: 1 });
  });
});

describe('a list drawn before the switch flips', () => {
  test('drawn at 5, reopened with 3: still 5 + 2, nothing released', async () => {
    setup();
    const a = await list('visit-1');
    expect(a.children).toHaveLength(5);
    const b = await list('visit-1', { perVisit: 3 });
    expect(b.reused).toBe(true);
    expect(ids(b.children)).toEqual(ids(a.children));
    expect(ids(b.alternates)).toEqual(ids(a.alternates));
    expect(b).not.toHaveProperty('perVisit');
    expect(T().child_test_draws.filter((d) => d.status === 'listed')).toHaveLength(7);
  });

  test('drawn at 5, an absence after the flip: the list stays at 5, alternates topped up to 2', async () => {
    setup();
    const a = await list('visit-1');
    const m = await draw.markOutcome({ drawId: a.children[0].drawId, outcome: 'absent', now: NOW });
    expect(m.list.children.filter((k) => k.status === 'listed')).toHaveLength(5);
    expect(m.list.alternates).toHaveLength(2);
  });
});

describe('the value', () => {
  test.each([
    ['absent', undefined, 5],
    ['null', null, 5],
    ['not a number', 'three', 5],
    ['not whole', 2.5, 5],
    ['NaN', NaN, 5],
    ['a boolean', true, 5],
    ['above 5', 9, 5],
    ['0', 0, 1],
    ['negative', -2, 1],
    ['the text "3"', '3', 3],
    ['1', 1, 1],
    ['4', 4, 4],
  ])('%s (%p) → %i listed', async (_, perVisit, n) => {
    setup();
    const r = await list('visit-1', perVisit === undefined ? {} : { perVisit });
    expect(r.children).toHaveLength(n);
    expect(r.alternates).toHaveLength(2);
  });
});
