'use strict';
/**
 * scripts/web-quiz/fixture-students.js: prints the test children (web-quiz-fixture.js, the same rule the weekly strip
 * uses) as JSON for a reader outside the bot, read-only. Ids and counts only: never a name or a phone.
 * Faked boundaries only: Supabase (the in-memory fake that applies filters) and the logger.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));

const fs = require('fs');
const os = require('os');
const path = require('path');
const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const Cli = require('../../../../scripts/web-quiz/fixture-students');

const PHONE_SHAPE = /\d{9,}/;
let db;
const install = () => {
  db = {
    app_settings: [{ key: 'web_quiz_fixture_rule', value: { student_lists: ['list-seed'], teachers: ['tch-seed'] } }],
    students: [
      { id: 'stu-real', student_name: 'Ayesha Sample', list_id: 'list-1', parent_phone: 'PHONE-REDACTED' },
      { id: 'stu-named', student_name: 'Sana Testwala', list_id: 'list-1', parent_phone: 'PHONE-REDACTED' },
      { id: 'stu-listed', student_name: 'Hina Sample', list_id: 'list-seed' },
      { id: 'stu-taught', student_name: 'Zara Sample', list_id: 'list-1' },
    ],
    class_teachers: [{ id: 'ct-1', class_id: 'cls-seed', teacher_user_id: 'tch-seed', is_active: true }],
    class_enrollments: [{ id: 'ce-1', class_id: 'cls-seed', student_id: 'stu-taught', is_active: true }],
  };
  Object.assign(supabase, makeFake(db));
};
const capture = () => {
  const out = { stdout: '', stderr: '' };
  return { out, io: { stdout: { write: (s) => { out.stdout += s; } }, stderr: { write: (s) => { out.stderr += s; } } } };
};
const ENV = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'test-key' };

afterEach(() => jest.clearAllMocks());

test('prints {rule, student_ids, counts} for the four rules, ids only (no name, no phone), from a --runs pull too', async () => {
  install();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fixture-cli-'));
  const runs = path.join(dir, 'runs.json');
  fs.writeFileSync(runs, JSON.stringify([
    { student_id: 'stu-marked', canonical_id: 'stu-marked', meta: { test: true } },
    { student_id: 'stu-real', canonical_id: 'stu-real', meta: {} },
    { student_id: 'stu-named', canonical_id: 'stu-named', meta: {} },
  ]));
  const { out, io } = capture();
  const code = await Cli.main({ argv: ['--runs', runs], env: ENV, io });
  expect(code).toBe(0);
  const got = JSON.parse(out.stdout);
  expect(Object.keys(got)).toEqual(['rule', 'student_ids', 'counts']);
  expect(got.rule).toBe('meta.test|name|list|teacher');
  expect(got.student_ids).toEqual(['stu-listed', 'stu-marked', 'stu-named', 'stu-taught']);
  expect(got.counts).toEqual({ meta_test: 1, name: 1, list: 1, teacher: 1 });
  expect(out.stdout + out.stderr).not.toMatch(/Testwala|Sample|PHONE|example\.supabase/);
  expect(out.stdout).not.toMatch(PHONE_SHAPE);
  // read-only: nothing written
  expect(supabase.calls.filter((c) => c.op !== 'select')).toEqual([]);
});

test('without --runs: the children of the configured lists and classes and the Testwala names', async () => {
  install();
  const { out, io } = capture();
  expect(await Cli.main({ argv: [], env: ENV, io })).toBe(0);
  expect(JSON.parse(out.stdout).student_ids).toEqual(['stu-listed', 'stu-named', 'stu-taught']);
});

test('a loose child a configured test teacher created (no class, no list) is printed under teacher', async () => {
  install();
  db.students.push({ id: 'stu-loose', student_name: 'Rafay Sample', list_id: null, enrolled_by_user_id: 'tch-seed' });
  db.students.push({ id: 'stu-other', student_name: 'Nida Sample', list_id: null, enrolled_by_user_id: 'tch-real' });
  const { out, io } = capture();
  expect(await Cli.main({ argv: [], env: ENV, io })).toBe(0);
  const got = JSON.parse(out.stdout);
  expect(got.student_ids).toEqual(['stu-listed', 'stu-loose', 'stu-named', 'stu-taught']);
  expect(got.counts).toEqual({ meta_test: 0, name: 1, list: 1, teacher: 2 });
});

test('refuses to run without the Supabase env (exit 2, nothing on stdout, no read)', async () => {
  install();
  const { out, io } = capture();
  expect(await Cli.main({ argv: [], env: {}, io })).toBe(2);
  expect(out.stdout).toBe('');
  expect(out.stderr).toMatch(/SUPABASE_URL/);
  expect(supabase.calls).toEqual([]);
});

test('an unreadable students table: the JSON still prints, stderr names the gap, exit 3', async () => {
  install();
  const realFrom = supabase.from;
  supabase.from = (t) => {
    const q = realFrom(t);
    if (t === 'students') q.then = (res) => Promise.resolve({ data: null, error: { code: '42501', message: 'denied' } }).then(res);
    return q;
  };
  const { out, io } = capture();
  expect(await Cli.main({ argv: [], env: ENV, io })).toBe(3);
  expect(JSON.parse(out.stdout).student_ids).toEqual(['stu-taught']);
  expect(out.stderr).toMatch(/students/);
});
