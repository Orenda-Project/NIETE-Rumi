/**
 * L20 (bd-s1oo0.38) — each child on a visit's list has a number: its place in the list as first sent
 * (main list 1–5, alternates after them). It is derived from the draw rows (this visit's "listed"
 * history entries: when, which slot, list order) — no migration — and it never moves: an absence, a
 * promoted alternate, a top-up alternate or a reopened list keeps every number already given.
 * Real draw engine; only the Supabase client is replaced.
 */
const { createFakeSupabase, CHILD_TEST_UNIQUE } = require('../L3/helpers/fake-supabase');
const { buildRoster } = require('../L3/helpers/roster');

let mockFake;
jest.mock('../../../bot/shared/config/supabase', () => ({ from: (...a) => mockFake.from(...a) }));
jest.mock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
const draw = require('../../../bot/shared/services/child-test/draw');

const NOW = new Date('2026-10-05T06:00:00Z');
const later = (min) => new Date(NOW.getTime() + min * 60000);
const list = (visit, now = NOW) => draw.todaysList({ coachUserId: 'coach-1', schoolId: 'school-1', visitId: visit, observedGrade: 3, now });
const nos = (l) => Object.fromEntries([...l.children, ...l.alternates].map((c) => [c.drawId, c.childNo]));

beforeEach(() => {
  process.env.CHILD_TEST_DRAW_SECRET = 'test-secret';
  mockFake = createFakeSupabase(buildRoster({ classes: [
    { id: 'g3a', grade: 3, section: 'A', size: 25 }, { id: 'g3b', grade: 3, section: 'B', size: 25 },
  ] }), { unique: CHILD_TEST_UNIQUE });
});
afterAll(() => { delete process.env.CHILD_TEST_DRAW_SECRET; });

test('the first list: main 1–5 in list order, alternates 6 and 7', async () => {
  const r = await list('visit-1');
  expect(r.ok).toBe(true);
  expect(r.children.map((c) => c.childNo)).toEqual([1, 2, 3, 4, 5]);
  expect(r.alternates.map((c) => c.childNo)).toEqual([6, 7]);
});

test('an absence: every number stays; the promoted alternate keeps its own; a top-up alternate is new', async () => {
  const first = await list('visit-1');
  const before = nos(first);
  const absent = first.children[0];
  const m = await draw.markOutcome({ drawId: absent.drawId, outcome: 'absent', visitId: 'visit-1', now: later(5) });
  expect(m.ok).toBe(true);
  const after = nos(m.list);
  for (const [id, n] of Object.entries(before)) expect(after[id]).toBe(n);
  const promoted = m.list.children.find((c) => !first.children.some((x) => x.drawId === c.drawId));
  expect(first.alternates.map((c) => c.drawId)).toContain(promoted.drawId);
  expect(promoted.childNo).toBe(before[promoted.drawId]);
  expect(m.list.children.find((c) => c.drawId === absent.drawId).childNo).toBe(1);
  const topUp = m.list.alternates.filter((c) => !(c.drawId in before));
  expect(topUp.map((c) => c.childNo)).toEqual([8]);
  // numbers are unique on the visit
  const all = Object.values(after);
  expect(new Set(all).size).toBe(all.length);
});

test('a reopened list carries the same numbers', async () => {
  const first = await list('visit-1');
  const again = await list('visit-1', later(30));
  expect(nos(again)).toEqual(nos(first));
});
