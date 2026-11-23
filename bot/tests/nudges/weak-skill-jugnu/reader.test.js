'use strict';
/**
 * bd-ptl6x9.7 — the reads behind the nudge, against the in-memory Supabase double: who is reached, which class
 * lists, and the per-child counting (latest scored attempt, sa-battery only, completed only, window, test coaches).
 */
const { tableDouble } = require('../../helpers/table-double');

let mockDb;
jest.mock('../../../shared/config/supabase', () => new Proxy({}, { get: (_, k) => mockDb[k] }));
const R = require('../../../shared/services/nudges/weak-skill-jugnu/reader');

const SCH = 'sch-1';
const sess = (id, student, extra = {}) => ({
  id, student_id: student, coach_user_id: 'coach', school_id: SCH, grade: 3, item_bank_version: 'sa-battery',
  status: 'completed', created_at: '2026-11-10T05:00:00Z', ...extra,
});
const blk = (session, block, correct, mode = 'keypad') => ({
  session_id: session, block, response_mode: mode, ai_status: 'scored',
  ai_marks: mode === 'tap' ? { tap_correct: correct } : { keypad_correct: correct },
});
const WIN = { schoolId: SCH, grade: 3, sinceIso: '2026-10-01T00:00:00Z', untilIso: '2026-11-21T00:00:00Z' };

beforeEach(() => {
  mockDb = tableDouble({
    users: [
      { id: 't-test', role: 'teacher', phone_number: '9230', is_test_user: true, deleted_at: null },
      { id: 't-real', role: 'teacher', phone_number: '9231', is_test_user: null, deleted_at: null },
      { id: 't-nophone', role: 'teacher', phone_number: null, is_test_user: true, deleted_at: null },
      { id: 'coach', is_test_user: null },
      { id: 'coach-test', is_test_user: true },
    ],
    student_lists: [
      { id: 'L2', user_id: 't-test', class_name: 'Grade 3', section: 'B', class_id: 'c3', is_active: true },
      { id: 'L1', user_id: 't-test', class_name: 'Grade 3', section: 'A', class_id: 'c3', is_active: true },
      { id: 'L6', user_id: 't-test', class_name: 'Grade 6', section: null, class_id: 'c6', is_active: true },
      { id: 'Lx', user_id: 't-real', class_name: 'Grade 3', section: null, class_id: 'c3', is_active: true },
      { id: 'Ly', user_id: 't-nophone', class_name: 'Grade 3', section: null, class_id: 'c3', is_active: true },
    ],
    classes: [{ id: 'c3', school_id: SCH, grade_code: 'grade_3', is_active: true }, { id: 'c6', school_id: SCH, grade_code: 'grade_6', is_active: true }],
    child_test_sessions: [],
    child_test_blocks: [],
  });
});

test('test audience → test teachers with a phone; all → real teachers only', async () => {
  expect(await R.teachers({ testOnly: true })).toEqual(['t-test']);
  expect(await R.teachers({ testOnly: false })).toEqual(['t-real']);
});

test('a teacher\'s lists: grades 1–5 only, sorted by label, with school and grade', async () => {
  expect(await R.listsOf('t-test')).toEqual([
    { listId: 'L1', label: 'Grade 3 A', classId: 'c3', schoolId: SCH, grade: 3 },
    { listId: 'L2', label: 'Grade 3 B', classId: 'c3', schoolId: SCH, grade: 3 },
  ]);
});

test('one child counts once per task: the latest scored attempt decides', async () => {
  mockDb = tableDouble({
    users: [{ id: 'coach', is_test_user: null }],
    child_test_sessions: [sess('s1', 'k1', { created_at: '2026-11-03T05:00:00Z' }), sess('s2', 'k1'), sess('s3', 'k2')],
    child_test_blocks: [blk('s1', 'ma.missing4', 4), blk('s2', 'ma.missing4', 1), blk('s3', 'ma.missing4', 3)],
  });
  const r = await R.groupResults(WIN);
  expect(r.find((x) => x.egma === 'ma.missing4')).toEqual({ egma: 'ma.missing4', scored: 2, passing: 1 });
});

test('other banks, unfinished tests, other schools, other grades and tests outside the window do not count', async () => {
  mockDb = tableDouble({
    users: [{ id: 'coach', is_test_user: null }],
    child_test_sessions: [
      sess('a', 'k1', { item_bank_version: 'v2' }), sess('b', 'k2', { status: 'in_progress' }),
      sess('c', 'k3', { school_id: 'other' }), sess('d', 'k4', { grade: 4 }), sess('e', 'k5', { created_at: '2026-09-01T00:00:00Z' }),
    ],
    child_test_blocks: ['a', 'b', 'c', 'd', 'e'].map((s) => blk(s, 'ma.missing4', 4)),
  });
  expect((await R.groupResults(WIN)).every((x) => x.scored === 0)).toBe(true);
});

test('test coaches count only when asked (the test audience)', async () => {
  mockDb = tableDouble({
    users: [{ id: 'coach-test', is_test_user: true }],
    child_test_sessions: [sess('s1', 'k1', { coach_user_id: 'coach-test' })],
    child_test_blocks: [blk('s1', 'ma.number_id8', 2)],
  });
  const n = async (inc) => (await R.groupResults({ ...WIN, includeTestCoaches: inc })).find((x) => x.egma === 'ma.number_id8').scored;
  expect(await n(false)).toBe(0);
  expect(await n(true)).toBe(1);
});

test('the pass line is 0.75 of the task\'s items; tap reads tap_correct', () => {
  const S = [sess('s1', 'k1'), sess('s2', 'k2'), sess('s3', 'k3')];
  const r = R.countResults(S, [blk('s1', 'ma.number_id8', 6), blk('s2', 'ma.number_id8', 5), blk('s3', 'ma.discrimination2', 2, 'tap')]);
  expect(r.find((x) => x.egma === 'ma.number_id8')).toEqual({ egma: 'ma.number_id8', scored: 2, passing: 1 });
  expect(r.find((x) => x.egma === 'ma.discrimination2')).toEqual({ egma: 'ma.discrimination2', scored: 1, passing: 1 });
});

test('an unscored recording is not a 0', () => {
  const r = R.countResults([sess('s1', 'k1')], [{ session_id: 's1', block: 'ma.missing4', response_mode: 'record', ai_status: 'pending', ai_marks: null }]);
  expect(r.find((x) => x.egma === 'ma.missing4').scored).toBe(0);
});

test('a failed read throws (never a false empty group)', async () => {
  mockDb = tableDouble({}, { failTables: { child_test_sessions: 'down' } });
  await expect(R.groupResults(WIN)).rejects.toThrow(/child tests read failed/);
});
