'use strict';
/**
 * Test children stay out of the weekly health numbers (web-quiz-strip.js, the rule in web-quiz-fixture.js): a row the
 * serve marked meta.test, a child named "... Testwala", a child on a configured seed list and a child in a configured
 * test teacher's class are dropped from the week's AND the month's rows before any line is computed; one line,
 * fixtures_excluded (value = rows dropped, n = rows read), shows the drop.
 * Faked boundaries only: Supabase (the in-memory fake that applies filters), Redis and the logger.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('../../../shared/services/cache/railway-redis.service', () => ({ isAvailable: jest.fn(() => false), scanValues: jest.fn(async () => null) }));

const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const Strip = require('../../../shared/services/quiz/web-quiz-strip');

const WEEK = '2026-W42';
const IN = '2026-10-14T08:00:00Z';
const NOW = Date.parse('2026-10-19T06:00:00Z');
const RUNS = 'web_quiz_challenge_runs';
const REAL = 'stu-real';
const MARKED = 'stu-marked';
const NAMED = 'stu-named';
const LISTED = 'stu-listed';
const TAUGHT = 'stu-taught';
const LIST = 'list-1';
const SEED_LIST = 'list-seed';
const TEACHER = 'tch-seed';
const SEED_CLASS = 'cls-seed';

let n = 0;
const run = (child, extra = {}) => {
  n += 1;
  return {
    id: `run-${n}`, student_id: child, canonical_id: child, exercise: 'read', grade: 3, lang: 'ur', status: 'scored', created_at: IN,
    mode: 'check', bank_version: 'v3', form: 'G3', period_id: '2026-10', exposure_no: 1, band: 2, id_src: 'roster_pick',
    id_confidence: 'high', homonym_in_list: false, helped: 'self', record: true, meta: {}, score: { correct: 30 }, ...extra,
  };
};
// one scored check reading and one lost one per child: every line has something to count
const childRows = (child, extra = {}) => [
  run(child, extra),
  run(child, { status: 'failed', exposure_no: 2, record: false, meta: { ...(extra.meta || {}), reason: 'unheard' } }),
];
const students = () => [
  { id: REAL, student_name: 'Ayesha Sample', list_id: LIST, merged_into: null, status: 'active' },
  { id: MARKED, student_name: 'Bilal Sample', list_id: LIST, merged_into: null, status: 'active' },
  { id: NAMED, student_name: 'Sana Testwala', list_id: LIST, merged_into: null, status: 'active' },
  { id: LISTED, student_name: 'Hina Sample', list_id: SEED_LIST, merged_into: null, status: 'active' },
  { id: TAUGHT, student_name: 'Zara Sample', list_id: LIST, merged_into: null, status: 'active' },
];
const tables = () => ({
  students: students(),
  class_teachers: [{ id: 'ct-1', class_id: SEED_CLASS, teacher_user_id: TEACHER, is_active: true }],
  class_enrollments: [{ id: 'ce-1', class_id: SEED_CLASS, student_id: TAUGHT, is_active: true }],
  classes: [{ id: SEED_CLASS, is_active: true }],
  child_rungs: [],
  message_ledger: [],
});
const CONFIG = [{ key: 'web_quiz_fixture_rule', value: { student_lists: [SEED_LIST], teachers: [TEACHER] } }];

let db;
const install = (runs, extra = {}) => {
  db = { [RUNS]: runs, web_quiz_strip_weekly: [], ...tables(), ...extra };
  Object.assign(supabase, makeFake(db, { uniques: { web_quiz_strip_weekly: ['week', 'line', 'cell'] } }));
};
const written = () => db.web_quiz_strip_weekly.map(({ line, cell, value, n: k }) => `${line}/${cell}=${value}/${k}`).sort();
const line = (name, cell = '') => db.web_quiz_strip_weekly.find((r) => r.line === name && r.cell === cell);

afterEach(() => { jest.clearAllMocks(); n = 0; });

test('one real child and four test children (one row each, one per rule): every line counts the real child only; fixtures_excluded = 4', async () => {
  // the reference: the real child alone, nothing to drop
  install([run(REAL)], { app_settings: CONFIG });
  await Strip.weeklyStrip({ week: WEEK, now: NOW });
  const alone = written().filter((l) => !l.startsWith('fixtures_excluded/'));
  expect(line('fixtures_excluded')).toMatchObject({ value: 0, n: 1 });

  n = 0;
  install([
    run(REAL),
    run(MARKED, { meta: { test: true } }),     // rule 1: the serve marked the row
    run(NAMED),                                // rule 2: the name
    run(LISTED),                               // rule 3: a configured seed list
    run(TAUGHT),                               // rule 4: a configured test teacher's class
  ], { app_settings: CONFIG });
  await Strip.weeklyStrip({ week: WEEK, now: NOW });
  expect(written().filter((l) => !l.startsWith('fixtures_excluded/'))).toEqual(alone);
  // rows dropped of rows read (week and month together, each run once)
  expect(line('fixtures_excluded')).toMatchObject({ value: 4, n: 5 });
  expect(line('plays', 'check')).toMatchObject({ value: 1, n: 1 });
  expect(line('roster_bound_pct')).toMatchObject({ n: 1 });
  expect(line('helped_pct', 'G23|ur|read')).toMatchObject({ n: 1 });
  expect(line('lost_readings', 'G23|ur')).toMatchObject({ value: 0, n: 1 });
  expect(line('cells_n30', 'G23|ur|reading')).toMatchObject({ value: 1, n: 1 });
  expect(line('provenance_drift', 'high_unproven')).toMatchObject({ value: 0, n: 1 });
});

test('two rows a child (a scored and a lost reading): the lost-readings cell holds the real child\'s two only', async () => {
  install([...childRows(REAL), ...childRows(MARKED, { meta: { test: true } }), ...childRows(NAMED), ...childRows(LISTED), ...childRows(TAUGHT)],
    { app_settings: CONFIG });
  await Strip.weeklyStrip({ week: WEEK, now: NOW });
  expect(line('lost_readings', 'G23|ur')).toMatchObject({ value: 0.5, n: 2 });
  expect(line('fixtures_excluded')).toMatchObject({ value: 8, n: 10 });
});

test('the month\'s rows are cleaned too: a test child\'s earlier-in-month row never reaches cells_n30', async () => {
  install([
    run(REAL),
    run(NAMED, { created_at: '2026-10-05T08:00:00Z' }),   // this month, before the week
  ], { app_settings: CONFIG });
  await Strip.weeklyStrip({ week: WEEK, now: NOW });
  expect(line('cells_n30', 'G23|ur|reading')).toMatchObject({ value: 1, n: 1 });
  expect(line('fixtures_excluded')).toMatchObject({ value: 1, n: 2 });
});

test('no config key: rules 1-2 still drop their rows; the list and class children count', async () => {
  install([...childRows(REAL), ...childRows(MARKED, { meta: { test: true } }), ...childRows(NAMED), ...childRows(LISTED), ...childRows(TAUGHT)]);
  await Strip.weeklyStrip({ week: WEEK, now: NOW });
  expect(line('fixtures_excluded')).toMatchObject({ value: 4, n: 10 });
  expect(line('plays', 'check')).toMatchObject({ value: 3, n: 3 });
});

test('students unreadable: rule 1 still applies, nothing more is dropped, and the result notes it', async () => {
  install([...childRows(REAL), ...childRows(MARKED, { meta: { test: true } }), ...childRows(NAMED)], { app_settings: CONFIG });
  const realFrom = supabase.from;
  supabase.from = (t) => {
    const q = realFrom(t);
    if (t === 'students') q.then = (res) => Promise.resolve({ data: null, error: { code: '42501', message: 'denied' } }).then(res);
    return q;
  };
  const out = await Strip.weeklyStrip({ week: WEEK, now: NOW });
  expect(line('fixtures_excluded')).toMatchObject({ value: 2, n: 6 });
  expect(out.notes.fixtures_excluded).toMatch(/students/);
});
