'use strict';
/**
 * The students read of the weekly numbers' provenance (web-quiz-provenance.js) against the columns the table really
 * has. Faked: supabase transport. Real: the column list (the students CREATE TABLE in
 * infrastructure/supabase/00_complete-schema.sql, parsed by strict-columns.js).
 * A read naming a column the table lacks is refused by PostgREST (42703); the read side then reads as "students
 * unreadable" and the strip skips cells_n30, anchor_retest_gap and provenance_drift on every tier.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));

const { makeFake } = require('./fake-supabase');
const { strictFrom, COLUMNS } = require('./strict-columns');
const supabase = require('../../../shared/config/supabase');
const { logError } = require('../../../shared/utils/logger');
const P = require('../../../shared/services/quiz/web-quiz-provenance');
const F = require('../../../shared/services/quiz/web-quiz-fixture');

const ON_LIST = 'stu-1';
const MATE = 'stu-2';
const LOOSE = 'stu-3';
const L1 = 'list-1';
const students = () => [
  { id: ON_LIST, student_name: 'Hina Sample', list_id: L1, merged_into: null, status: 'active' },
  { id: MATE, student_name: 'Hina Bano Sample', list_id: L1, merged_into: null, status: 'active' },
  { id: LOOSE, student_name: 'Omar Sample', list_id: null, merged_into: null, status: 'active' },
];

let fake;
let selects;
const install = () => {
  fake = makeFake({ students: students(), app_settings: [], class_teachers: [], class_enrollments: [] });
  selects = [];
  const strict = strictFrom(fake.from, ['students', 'class_teachers', 'class_enrollments', 'app_settings']);
  Object.assign(supabase, fake, {
    from: (t) => {
      const b = strict(t);
      const sel = b.select;
      b.select = (cols, ...rest) => { selects.push({ table: t, cols }); return sel(cols, ...rest); };
      return b;
    },
  });
};
const columnsOf = (t) => selects.filter((s) => s.table === t).flatMap((s) => String(s.cols).split(',').map((c) => c.trim())).filter(Boolean);

beforeEach(install);
afterEach(() => jest.clearAllMocks());

test('the mirror has a students table (the parse is real, not empty)', () => {
  expect(COLUMNS.students).toBeDefined();
  expect(COLUMNS.students.has('student_name')).toBe(true);
  expect(COLUMNS.students.has('list_id')).toBe(true);
});

test('every column loadStudents and loadListMates select from students exists in the schema', async () => {
  await P.loadStudents([ON_LIST, LOOSE]);
  await P.loadListMates([L1]);
  await P.driftCounts([{ id: 'r1', canonical_id: ON_LIST, id_src: 'roster_pick', id_confidence: 'high', homonym_in_list: false }]);
  const cols = columnsOf('students');
  expect(cols.length).toBeGreaterThan(0);
  expect(cols.filter((c) => !COLUMNS.students.has(c))).toEqual([]);
});

test('every column the test-child rule selects exists in the schema', async () => {
  await F.fixtureStudentIds({ ids: [ON_LIST], config: { student_lists: new Set([L1]), teachers: new Set(['tch-1']) } });
  await F.fixtureStudentIds({ config: { student_lists: new Set([L1]), teachers: new Set(['tch-1']) } });
  for (const t of ['students', 'class_teachers', 'class_enrollments']) {
    expect(columnsOf(t).filter((c) => !COLUMNS[t].has(c))).toEqual([]);
  }
});

test('against a fake that refuses an unknown column (42703): loadStudents reads, with the first name folded', async () => {
  const got = await P.loadStudents([ON_LIST, LOOSE]);
  expect(got).not.toBeNull();
  expect(got.get(ON_LIST)).toEqual({ list_id: L1, merged_into: null, status: 'active', first: expect.any(String) });
  expect(got.get(ON_LIST).first).toBeTruthy();
  expect(logError).not.toHaveBeenCalled();
});

test('against the same fake: loadListMates and driftCounts read (not null), homonyms found by the stored name', async () => {
  const mates = await P.loadListMates([L1]);
  expect(mates).not.toBeNull();
  expect([...mates.get(L1).values()]).toEqual([2]);          // two active Hinas on list-1
  const drift = await P.driftCounts([{ id: 'r1', canonical_id: ON_LIST, id_src: 'roster_pick', id_confidence: 'high', homonym_in_list: false }]);
  expect(drift).toEqual({ high_unproven: 0, homonym_missed: 1, n: 1 });
});
