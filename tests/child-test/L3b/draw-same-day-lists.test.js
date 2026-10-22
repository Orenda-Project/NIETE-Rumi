/**
 * Child test draw — same-day lists are disjoint (switch sa_all_grades; the caller passes allGrades). With every grade a
 * coach can hold several lists at one school on one day: the observe visit's, today's un-graded day key's, and one per
 * named grade (`:g<N>`). A child listed and not yet reached on one of them is never listed on another of the same
 * coach that day, so the children on the phone match the list the coach was sent. A child listed on an earlier day,
 * or by another coach, goes back in the queue as before. Without the switch the draw is unchanged.
 * Only the Supabase client is replaced.
 */
const { createFakeSupabase, CHILD_TEST_UNIQUE } = require('../L3/helpers/fake-supabase');
const { buildRoster } = require('../L3/helpers/roster');

let mockFake;
jest.mock('../../../bot/shared/config/supabase', () => ({ from: (...a) => mockFake.from(...a) }));
jest.mock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
const draw = require('../../../bot/shared/services/child-test/draw');

const NOW = new Date('2026-10-05T06:00:00Z'); // 11:00 PKT, 5 Oct
const LATER = new Date('2026-10-05T09:00:00Z'); // 14:00 PKT, same day
const NEXT_DAY = new Date('2026-10-06T04:00:00Z');
const COACH = '11111111-1111-4111-8111-111111111111';
const OTHER_COACH = '33333333-3333-4333-8333-333333333333';
const SCHOOL = '22222222-2222-4222-8222-222222222222';
const DAY_KEY = `day:${COACH}:${SCHOOL}:2026-10-05`;

function setup(classes = [{ id: 'g3a', grade: 3, section: 'A', size: 20 }, { id: 'g5a', grade: 5, section: 'A', size: 20 }]) {
  mockFake = createFakeSupabase(buildRoster({ schoolId: SCHOOL, coachId: COACH, classes }), { unique: CHILD_TEST_UNIQUE });
  return mockFake;
}
const T = () => mockFake.__tables;
const ids = (l) => [...l.children, ...l.alternates].map((k) => k.studentId);
const byKey = (visitKey, extra = {}) => draw.todaysList({ coachUserId: COACH, schoolId: SCHOOL, visitKey, now: LATER, ...extra });
const graded = (g, extra = {}) => byKey(`${DAY_KEY}:g${g}`, { grade: g, allGrades: true, ...extra });

beforeEach(() => { process.env.CHILD_TEST_DRAW_SECRET = 'test-secret'; process.env.CHILD_TEST_FORM_POLICY = 'returning_b'; jest.clearAllMocks(); });
afterAll(() => { delete process.env.CHILD_TEST_DRAW_SECRET; delete process.env.CHILD_TEST_FORM_POLICY; });

describe('ON: one coach\'s lists on one day never share a child', () => {
  test('an un-graded G3 day list + grade 5 → a :g5 list, disjoint from it', async () => {
    setup();
    const first = await draw.todaysList({ coachUserId: COACH, schoolId: SCHOOL, visitKey: DAY_KEY, now: NOW });
    expect(first.grade).toBe(3);
    const g5 = await graded(5);
    expect(g5.grade).toBe(5);
    expect(ids(g5).filter((s) => ids(first).includes(s))).toEqual([]);
  });

  test('an un-graded G3 day list + a :g3 list drawn later → no child in both, and the first list keeps all 7', async () => {
    setup();
    const first = await draw.todaysList({ coachUserId: COACH, schoolId: SCHOOL, visitKey: DAY_KEY, now: NOW });
    const g3 = await graded(3);
    expect(g3.ok).toBe(true);
    expect(ids(g3).filter((s) => ids(first).includes(s))).toEqual([]);
    const again = await draw.todaysList({ coachUserId: COACH, schoolId: SCHOOL, visitKey: DAY_KEY, now: LATER });
    expect(again.children).toHaveLength(5);
    expect(again.alternates).toHaveLength(2);
    expect(ids(again)).toEqual(ids(first));
  });

  test('a visit-id G3 list + a :g3 day list drawn later → no child in both', async () => {
    setup();
    const visit = await draw.todaysList({ coachUserId: COACH, schoolId: SCHOOL, visitId: 'visit-1', observedGrade: 3, now: NOW });
    expect(visit.grade).toBe(3);
    const g3 = await graded(3);
    expect(ids(g3).filter((s) => ids(visit).includes(s))).toEqual([]);
    const reopened = await draw.todaysList({ coachUserId: COACH, schoolId: SCHOOL, visitId: 'visit-1', observedGrade: 3, now: LATER });
    expect(ids(reopened)).toEqual(ids(visit));
  });

  test('a small class: the :g3 list takes only the children nobody holds today (fewer than 5 + 2 is fine)', async () => {
    setup([{ id: 'g3a', grade: 3, section: 'A', size: 9 }]);
    const visit = await draw.todaysList({ coachUserId: COACH, schoolId: SCHOOL, visitId: 'visit-1', observedGrade: 3, now: NOW });
    const g3 = await graded(3);
    expect(g3.children).toHaveLength(2);
    expect(g3.alternates).toHaveLength(0);
    expect(ids(g3).filter((s) => ids(visit).includes(s))).toEqual([]);
  });

  test('an absent child on the :g3 list: the top-up never takes a child the visit list holds today', async () => {
    setup([{ id: 'g3a', grade: 3, section: 'A', size: 10 }]);
    const visit = await draw.todaysList({ coachUserId: COACH, schoolId: SCHOOL, visitId: 'visit-1', observedGrade: 3, now: NOW });
    const g3 = await graded(3);
    const out = await draw.markOutcome({ drawId: g3.children[0].drawId, outcome: 'absent', visitKey: `${DAY_KEY}:g3`, allGrades: true, now: LATER });
    expect(out.ok).toBe(true);
    expect(ids(out.list).filter((s) => ids(visit).includes(s))).toEqual([]);
    const reopened = await draw.todaysList({ coachUserId: COACH, schoolId: SCHOOL, visitId: 'visit-1', observedGrade: 3, now: LATER });
    expect(ids(reopened)).toEqual(ids(visit));
  });

  test('a child listed on an EARLIER day and not reached goes back in the queue, as before', async () => {
    setup([{ id: 'g3a', grade: 3, section: 'A', size: 9 }]);
    const yesterday = await draw.todaysList({ coachUserId: COACH, schoolId: SCHOOL, visitKey: DAY_KEY, now: NOW });
    const next = await draw.todaysList({
      coachUserId: COACH, schoolId: SCHOOL, visitKey: `day:${COACH}:${SCHOOL}:2026-10-06:g3`, grade: 3, allGrades: true, now: NEXT_DAY,
    });
    expect(next.children).toHaveLength(5);
    expect(ids(next).some((s) => ids(yesterday).includes(s))).toBe(true);
  });

  test('another coach\'s list today is not this coach\'s: its untested children can be listed, as before', async () => {
    setup([{ id: 'g3a', grade: 3, section: 'A', size: 9 }]);
    T().observation_field_forms.push({ id: 'visit-other', observer_user_id: OTHER_COACH, visit_context: { school_ext_id: '9001' } });
    const theirs = await draw.todaysList({ coachUserId: OTHER_COACH, schoolId: SCHOOL, visitId: 'visit-other', observedGrade: 3, now: NOW });
    const mine = await graded(3);
    expect(mine.children).toHaveLength(5);
    expect(ids(mine).some((s) => ids(theirs).includes(s))).toBe(true);
  });
});

describe('OFF (no allGrades): the draw is unchanged', () => {
  test('a second key the same day re-lists the first key\'s untested children, as today', async () => {
    setup([{ id: 'g3a', grade: 3, section: 'A', size: 9 }]);
    const visit = await draw.todaysList({ coachUserId: COACH, schoolId: SCHOOL, visitId: 'visit-1', observedGrade: 3, now: NOW });
    const day = await draw.todaysList({ coachUserId: COACH, schoolId: SCHOOL, visitKey: DAY_KEY, now: LATER });
    expect(day.children).toHaveLength(5);
    expect(ids(day).some((s) => ids(visit).includes(s))).toBe(true);
  });
});
