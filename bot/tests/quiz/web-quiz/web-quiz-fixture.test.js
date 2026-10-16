'use strict';
/**
 * The test-child rule (web-quiz-fixture.js): one rule, one home, read by the weekly strip and the fixture-students
 * script. A child is a test child when, in this order: a run row says so (meta.test), the name ends in "Testwala", the
 * child is on a configured seed list, or the child is in a class of a configured test teacher. The configured ids
 * come from app_settings web_quiz_fixture_rule; a missing or malformed key leaves only the first two rules.
 * Faked boundaries only: Supabase (the in-memory fake that applies filters) and the logger.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));

const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const { logError } = require('../../../shared/utils/logger');
const F = require('../../../shared/services/quiz/web-quiz-fixture');

const KEY = 'web_quiz_fixture_rule';
const REAL = 'stu-real';
const NAMED = 'stu-named';
const LISTED = 'stu-listed';
const TAUGHT = 'stu-taught';
const SEED_LIST = 'list-seed';
const OTHER_LIST = 'list-other';
const TEACHER = 'tch-seed';
const SEED_CLASS = 'cls-seed';
const OTHER_CLASS = 'cls-other';

const students = () => [
  { id: REAL, student_name: 'Ayesha Sample', list_id: OTHER_LIST },
  { id: NAMED, student_name: 'Sana Testwala', list_id: OTHER_LIST },
  { id: LISTED, student_name: 'Bilal Sample', list_id: SEED_LIST },
  { id: TAUGHT, student_name: 'Hina Sample', list_id: OTHER_LIST },
];
const setting = (value) => [{ key: KEY, value }];
const CONFIG = { student_lists: [SEED_LIST], teachers: [TEACHER] };

let db;
let fake;
const install = (extra = {}) => {
  db = {
    app_settings: setting(CONFIG),
    students: students(),
    class_teachers: [
      { id: 'ct-1', class_id: SEED_CLASS, teacher_user_id: TEACHER, is_active: true },
      { id: 'ct-2', class_id: OTHER_CLASS, teacher_user_id: 'tch-real', is_active: true },
    ],
    class_enrollments: [
      { id: 'ce-1', class_id: SEED_CLASS, student_id: TAUGHT, is_active: true },
      { id: 'ce-2', class_id: OTHER_CLASS, student_id: REAL, is_active: true },
    ],
    ...extra,
  };
  fake = makeFake(db);
  Object.assign(supabase, fake);
};

afterEach(() => jest.clearAllMocks());

describe('isTestName: the one name rule', () => {
  test('a name ending in Testwala (any case, trailing space) is a test name; others are not', () => {
    expect(F.isTestName('Sana Testwala')).toBe(true);
    expect(F.isTestName('sana TESTWALA  ')).toBe(true);
    expect(F.isTestName('Testwala Sana')).toBe(false);
    expect(F.isTestName('Ayesha Sample')).toBe(false);
    expect(F.isTestName(null)).toBe(false);
  });
});

describe('isFixtureRow', () => {
  test('rule 1: the run row says so (meta.test === true); a truthy non-true value does not', () => {
    expect(F.isFixtureRow({ student_id: REAL, meta: { test: true } })).toBe(true);
    expect(F.isFixtureRow({ student_id: REAL, meta: { test: 'yes' } })).toBe(false);
    expect(F.isFixtureRow({ student_id: REAL, meta: {} })).toBe(false);
    expect(F.isFixtureRow({ student_id: REAL })).toBe(false);
  });
  test('rules 2-4: the row\'s child (canonical id, else student id) is on the fixture set', () => {
    const ids = new Set([NAMED]);
    expect(F.isFixtureRow({ student_id: 'x', canonical_id: NAMED, meta: {} }, ids)).toBe(true);
    expect(F.isFixtureRow({ student_id: NAMED, canonical_id: null, meta: {} }, ids)).toBe(true);
    expect(F.isFixtureRow({ student_id: REAL, canonical_id: REAL, meta: {} }, ids)).toBe(false);
  });
});

describe('fixtureConfig', () => {
  test('the app_settings key as a JSON object or a JSON string', async () => {
    install();
    expect(await F.fixtureConfig()).toEqual({ student_lists: new Set([SEED_LIST]), teachers: new Set([TEACHER]) });
    install({ app_settings: setting(JSON.stringify(CONFIG)) });
    expect(await F.fixtureConfig()).toEqual({ student_lists: new Set([SEED_LIST]), teachers: new Set([TEACHER]) });
  });
  test.each([
    ['absent', []],
    ['not JSON', setting('{nope')],
    ['an array', setting([SEED_LIST])],
    ['lists not an array', setting({ student_lists: SEED_LIST, teachers: 7 })],
  ])('%s: empty sets', async (_, rows) => {
    install({ app_settings: rows });
    expect(await F.fixtureConfig()).toEqual({ student_lists: new Set(), teachers: new Set() });
  });
  test('an unreadable app_settings: empty sets, no throw', async () => {
    install();
    supabase.from = () => { throw new Error('pooler down'); };
    expect(await F.fixtureConfig()).toEqual({ student_lists: new Set(), teachers: new Set() });
  });
});

describe('fixtureStudentIds', () => {
  test('no ids given: the whole population (Testwala names, the seed lists, the test teachers\' classes)', async () => {
    install({ students: [...students(), { id: 'stu-trail', student_name: 'Omar Testwala ', list_id: null }, { id: 'stu-mid', student_name: 'Testwala Omar', list_id: null }] });
    const ids = await F.fixtureStudentIds();
    expect([...ids].sort()).toEqual([LISTED, NAMED, TAUGHT, 'stu-trail'].sort());
    expect(ids.counts).toEqual({ meta_test: 0, name: 2, list: 1, teacher: 1 });
  });

  const ALL = [REAL, NAMED, LISTED, TAUGHT];

  test('each rule alone excludes its child; a real-named child on no seed list and in no seed class stays', async () => {
    install();
    const ids = await F.fixtureStudentIds({ ids: ALL });
    expect([...ids].sort()).toEqual([LISTED, NAMED, TAUGHT].sort());
    expect(ids.has(REAL)).toBe(false);
    expect(ids.counts).toEqual({ meta_test: 0, name: 1, list: 1, teacher: 1 });
    expect(ids.unreadable).toEqual([]);
  });

  test('rule 1 from given rows: a child with a meta.test row is a fixture child (all of its ids)', async () => {
    install();
    const rows = [{ student_id: REAL, canonical_id: 'stu-canon', meta: { test: true } }];
    const ids = await F.fixtureStudentIds({ ids: [], rows });
    expect(ids.has(REAL)).toBe(true);
    expect(ids.has('stu-canon')).toBe(true);
    expect(ids.counts.meta_test).toBe(1);
  });

  test('a child matching several rules counts once, under the first rule in order', async () => {
    install({ students: [{ id: NAMED, student_name: 'Sana Testwala', list_id: SEED_LIST }] });
    const ids = await F.fixtureStudentIds({ ids: [NAMED], rows: [{ student_id: NAMED, meta: { test: true } }] });
    expect(ids.counts).toEqual({ meta_test: 1, name: 0, list: 0, teacher: 0 });
  });

  test('rule 4 also reads a run row\'s class: a row played in a test teacher\'s class', async () => {
    install();
    const ids = await F.fixtureStudentIds({ ids: [], rows: [{ student_id: REAL, class_id: SEED_CLASS, meta: {} }] });
    expect(ids.has(REAL)).toBe(true);
    expect(ids.counts.teacher).toBe(1);
  });

  test('malformed config: rules 1-2 only (the list and teacher children stay)', async () => {
    install({ app_settings: setting('{nope') });
    const ids = await F.fixtureStudentIds({ ids: ALL, rows: [{ student_id: 'stu-x', meta: { test: true } }] });
    expect([...ids].sort()).toEqual([NAMED, 'stu-x'].sort());
    expect(fake.calls.filter((c) => c.table === 'class_teachers' || c.table === 'class_enrollments')).toEqual([]);
  });

  test('more than 450 ids: the students table is read in 3 chunks of at most 200 (never over the header cap)', async () => {
    const many = Array.from({ length: 450 }, (_, i) => `stu-${String(i).padStart(4, '0')}`);
    install({ app_settings: [], students: many.map((id) => ({ id, student_name: 'Ayesha Sample', list_id: OTHER_LIST })) });
    const ids = await F.fixtureStudentIds({ ids: many });
    const reads = fake.calls.filter((c) => c.table === 'students');
    expect(reads).toHaveLength(3);
    expect(reads.some((c) => c.overflow)).toBe(false);
    expect(ids.size).toBe(0);
  });

  test('an unreadable students table: no throw, nothing extra excluded, the gap is named and logged (code only)', async () => {
    install();
    const realFrom = supabase.from;
    supabase.from = (t) => {
      if (t !== 'students') return realFrom(t);
      const q = realFrom(t);
      q.then = (res) => Promise.resolve({ data: null, error: { code: '42501', message: 'permission denied for Sana Testwala' } }).then(res);
      return q;
    };
    const ids = await F.fixtureStudentIds({ ids: ALL, rows: [{ student_id: 'stu-x', meta: { test: true } }] });
    expect([...ids].sort()).toEqual([TAUGHT, 'stu-x'].sort());       // rule 1 and rule 4 still apply
    expect(ids.unreadable).toEqual(['students']);
    expect(logError).toHaveBeenCalledWith('web_quiz.fixture_read_failed', { what: 'students', code: '42501' });
    expect(JSON.stringify(logError.mock.calls)).not.toMatch(/Testwala/);
  });

  // Rule 4 also holds for a child a configured test teacher CREATED (students.enrolled_by_user_id), enrolled or not.
  const LOOSE = 'stu-loose';
  const MADE_BY_REAL = 'stu-made-by-real';
  const looseRows = () => [
    ...students(),
    { id: LOOSE, student_name: 'Rafay Sample', list_id: null, enrolled_by_user_id: TEACHER },
    { id: MADE_BY_REAL, student_name: 'Nida Sample', list_id: null, enrolled_by_user_id: 'tch-real' },
  ];
  // one run row with no class, as a loose child plays
  const looseRun = (id) => ({ student_id: id, canonical_id: id, class_id: null, meta: {} });

  test('a loose child made by a test teacher, no enrolment, no list, class_id null: in the set, counted under teacher', async () => {
    install({ students: looseRows() });
    const all = await F.fixtureStudentIds();
    expect(all.has(LOOSE)).toBe(true);
    expect(all.counts).toEqual({ meta_test: 0, name: 1, list: 1, teacher: 2 });
    const some = await F.fixtureStudentIds({ ids: [], rows: [looseRun(LOOSE)] });
    expect([...some]).toEqual([LOOSE]);
    expect(some.counts).toEqual({ meta_test: 0, name: 0, list: 0, teacher: 1 });
    expect(some.unreadable).toEqual([]);
    const given = await F.fixtureStudentIds({ ids: [LOOSE, REAL] });
    expect([...given]).toEqual([LOOSE]);
  });

  test('a loose child made by a teacher who is not a configured test teacher: not in the set', async () => {
    install({ students: looseRows() });
    const all = await F.fixtureStudentIds();
    expect(all.has(MADE_BY_REAL)).toBe(false);
    const some = await F.fixtureStudentIds({ ids: [MADE_BY_REAL], rows: [looseRun(MADE_BY_REAL)] });
    expect(some.size).toBe(0);
    expect(some.counts).toEqual({ meta_test: 0, name: 0, list: 0, teacher: 0 });
  });

  test('the created-by read failing: students noted unreadable (once), no throw, the other rules still apply', async () => {
    install({ students: looseRows() });
    const realFrom = supabase.from;
    supabase.from = (t) => {
      const q = realFrom(t);
      if (t !== 'students') return q;
      const realIn = q.in;
      q.in = (c, vs) => {
        if (c === 'enrolled_by_user_id') q.then = (res) => Promise.resolve({ data: null, error: { code: '42501', message: 'permission denied' } }).then(res);
        return realIn(c, vs);
      };
      return q;
    };
    const ids = await F.fixtureStudentIds({ ids: [REAL, NAMED, LISTED, TAUGHT, LOOSE], rows: [{ student_id: 'stu-x', meta: { test: true } }] });
    expect([...ids].sort()).toEqual([LISTED, NAMED, TAUGHT, 'stu-x'].sort());
    expect(ids.has(LOOSE)).toBe(false);
    expect(ids.unreadable).toEqual(['students']);
    expect(logError).toHaveBeenCalledWith('web_quiz.fixture_read_failed', { what: 'students', code: '42501' });
  });

  test('golden: with no test teachers configured, the result and the reads are exactly today\'s (no created-by read)', async () => {
    const lists = { student_lists: [SEED_LIST], teachers: [] };
    install({ app_settings: setting(lists), students: looseRows() });
    const all = await F.fixtureStudentIds();
    expect(JSON.stringify({ ids: [...all], counts: all.counts, unreadable: all.unreadable }))
      .toBe('{"ids":["stu-named","stu-listed"],"counts":{"meta_test":0,"name":1,"list":1,"teacher":0},"unreadable":[]}');
    expect(JSON.stringify(fake.calls)).toBe(JSON.stringify([
      { table: 'app_settings', op: 'select', payload: null },
      { table: 'students', op: 'select', payload: null },
      { table: 'students', op: 'select', payload: null },
    ]));
    install({ app_settings: setting(lists), students: looseRows() });
    const some = await F.fixtureStudentIds({ ids: [LOOSE, NAMED], rows: [looseRun(LOOSE)] });
    expect(JSON.stringify({ ids: [...some], counts: some.counts, unreadable: some.unreadable }))
      .toBe('{"ids":["stu-named"],"counts":{"meta_test":0,"name":1,"list":0,"teacher":0},"unreadable":[]}');
    expect(JSON.stringify(fake.calls)).toBe(JSON.stringify([
      { table: 'app_settings', op: 'select', payload: null },
      { table: 'students', op: 'select', payload: null },
    ]));
  });

  test('an empty id list and no rows: no read of the students table', async () => {
    install();
    const ids = await F.fixtureStudentIds({ ids: [] });
    expect(ids.size).toBe(0);
    expect(fake.calls.filter((c) => c.table === 'students')).toEqual([]);
  });
});
