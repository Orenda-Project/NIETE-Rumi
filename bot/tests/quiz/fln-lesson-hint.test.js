/**
 * bd-chz35n.26 — a quiz made from a recorded Grades 1-2 lesson carries the Reading Hour / Numeracy (FLN) plan's
 * lesson + skill key when the teacher opened exactly ONE FLN plan of the lesson's subject in the lp-hint window
 * (36 h before to 6 h after the recording). Two different plans, a missing key, or another subject → no key:
 * only a certain mapping is stored. The key is stored for evals; it never reaches the prompt or the teacher.
 *
 * Real: fln-lesson-hint, fln-lesson-key. Mocked: the database client only.
 */

const mockTables = {};
const mockReadErrors = {};
function mockBuilderFor(table) {
  let rows = [...(mockTables[table] || [])];
  const result = () => (mockReadErrors[table] ? { data: null, error: { message: mockReadErrors[table] } } : { data: rows, error: null });
  const b = {
    select: () => b,
    eq: (col, val) => { rows = rows.filter((r) => String(r[col]) === String(val)); return b; },
    gte: (col, val) => { rows = rows.filter((r) => String(r[col]) >= String(val)); return b; },
    lte: (col, val) => { rows = rows.filter((r) => String(r[col]) <= String(val)); return b; },
    order: () => b,
    limit: (n) => { rows = rows.slice(0, n); return b; },
    then: (f, r) => Promise.resolve(result()).then(f, r),
  };
  return b;
}
jest.mock('../../shared/config/supabase', () => ({ from: jest.fn((t) => mockBuilderFor(t)) }));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));

const { flnLessonFor } = require('../../shared/services/quiz/fln-lesson-hint');

const AT = new Date('2026-11-10T08:00:00.000Z');
const hoursFrom = (h) => new Date(AT.getTime() + h * 3600 * 1000).toISOString();
const UR1 = 'fln1:rh-ur:daily:u1:l2:letter_sounds:p10152';
const UR2 = 'fln1:rh-ur:daily:u1:l3:letter_sounds:p10157';
const EN1 = 'fln1:rh-en:daily:u1:l2:letter_sounds:p10153';
const open = (key, h, extra = {}) => ({
  user_id: 'u1', plan_kind: 'fln', plan_ref: key ? key.split(':p')[1] : '999', lesson_key: key, opened_at: hoursFrom(h), ...extra,
});
const lesson = (subject) => flnLessonFor({ userId: 'u1', sessionCreatedAt: AT.toISOString(), subject });

beforeEach(() => {
  for (const k of Object.keys(mockTables)) delete mockTables[k];
  for (const k of Object.keys(mockReadErrors)) delete mockReadErrors[k];
});

test('one FLN plan of the subject in the window → its key, parsed, with when it was opened', async () => {
  mockTables.niete_lp_opens = [open(UR1, -3), open(UR1, -20), open(EN1, -2)];
  expect(await lesson('urdu')).toEqual({
    v: 1, key: UR1, book: 'rh-ur', strand: 'daily', unit_no: 1, lesson_no: 2, skill: 'letter_sounds', plan_id: '10152',
    opened_at: hoursFrom(-3), match: 'only_plan_in_window',
  });
  expect((await lesson('english')).key).toBe(EN1);
});

test('two different plans of the subject, or none, or a non-FLN subject → null', async () => {
  mockTables.niete_lp_opens = [open(UR1, -3), open(UR2, -5)];
  expect(await lesson('urdu')).toBeNull();
  expect(await lesson('maths')).toBeNull();
  expect(await lesson('science')).toBeNull();
});

test('outside the window, another teacher, another kind, or a row with no key never counts', async () => {
  mockTables.niete_lp_opens = [
    open(UR1, -40), open(UR1, 7), open(UR2, -1, { user_id: 'u2' }), open(UR2, -1, { plan_kind: 'k5' }), open(null, -1),
  ];
  expect(await lesson('urdu')).toBeNull();
});

test('a failed read, or no user/time, is null — never a throw', async () => {
  mockReadErrors.niete_lp_opens = 'column niete_lp_opens.lesson_key does not exist';
  expect(await lesson('urdu')).toBeNull();
  expect(await flnLessonFor({ userId: null, sessionCreatedAt: AT.toISOString(), subject: 'urdu' })).toBeNull();
  expect(await flnLessonFor({ userId: 'u1', sessionCreatedAt: null, subject: 'urdu' })).toBeNull();
});
