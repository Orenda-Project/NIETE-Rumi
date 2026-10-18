'use strict';
/**
 * quiz_report_fold_by_child: a child NOT on the class list is one row per CHILD, not per typed name.
 *
 * Today the report folds every off-list finish with the same typed name into one row (the played rows and the
 * provisional list alike), so two different children who type "Dansh" read as one. With the switch on, two off-list
 * records are the same child when the system already says so (`merged_into ?? student_id`), or when they typed the
 * same name AND share a phone (child_phone_bindings.phone_tomb) or one has no binding at all (the fresh-browser
 * "I don't know" twice case). The same name on two DIFFERENT phones is two children, two rows. Children on the list
 * are untouched. Off — absent, false, "yes", 1, {}, or an unreadable switch — the report is today's, byte for byte
 * (golden recorded on the base). A failed read of the child facts with the switch on falls back to today's fold.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const fs = require('fs');
const path = require('path');
const { makeFake } = require('./fake-supabase');
const F = require('./web-quiz-identity-fixture');
const { OFF_VALUES, throwOn } = require('../../helpers/switch-off-matrix');

const KEY = 'quiz_report_fold_by_child';
const NOW = Date.parse('2026-10-16T09:00:00Z');
const ago = (h) => new Date(NOW - h * 3600000).toISOString();
const done = (id, studentId, name, correct, h) => ({
  id, quiz_id: F.QUIZ, share_code_id: F.SC, student_id: studentId, student_name: name, user_id: null, status: 'completed',
  correct_answers: correct, total_questions_answered: 5, mastery_percentage: correct * 20, completed_at: ago(h), created_at: ago(h + 0.1),
  invited_by_student_id: null, device_ref: `dev-${id}`,
});
const TYPED2 = '44444444-4444-4444-8444-444444444445';
const loose = (id, name, extra = {}) => ({ id, student_name: name, self_reported_class: '4-A', list_id: null, is_active: true, status: 'active',
  created_at: '2026-10-02T00:00:00Z', merged_into: null, ...extra });
const bind = (canonicalId, tomb) => ({ id: `b-${canonicalId.slice(-2)}-${tomb}`, canonical_id: canonicalId, phone_norm: null, phone_tomb: tomb,
  via: 'guest', revoked_at: null, expires_at: '2099-03-31T18:59:59.000Z', bound_at: ago(30) });

// Ayesha + Bilal on the list; "Dansh" typed twice by two records (F.TYPED, then TYPED2), off the list.
const SESSIONS = [
  done('s1', F.kid(1), 'Ayesha Testwala', 4, 20),
  done('s2', F.kid(9), 'Bilal Testwala', 3, 19),
  done('s3', F.TYPED, 'Dansh', 5, 18),
  done('s4', TYPED2, 'dansh ', 2, 10),
];

let Data;
function wire({ on, bindings = [], second = {}, secondName = null, extra = [] } = {}) {
  const sessions = [...(secondName ? SESSIONS.map((x) => (x.id === 's4' ? { ...x, student_name: secondName } : x)) : SESSIONS), ...extra];
  const tables = F.db({ sessions });
  tables.quizzes = tables.quizzes.map((q) => ({ ...q, teacher_id: F.TEACHER, status: 'sent', created_at: ago(30), meta: { share_code_id: F.SC } }));
  const fake = makeFake(tables);
  fake.db.students.push(loose(TYPED2, secondName || 'dansh ', second));
  fake.db.child_phone_bindings = bindings;
  if (on !== null && on !== undefined) fake.db.app_settings = [...(fake.db.app_settings || []), { key: KEY, value: on }];
  jest.resetModules();
  process.env.INTERNAL_API_KEY = 'test-key';
  Object.assign(require('../../../shared/config/supabase'), { from: fake.from, rpc: fake.rpc });
  Data = require('../../../shared/services/quiz/teacher-report.data');
  return fake;
}
const dansh = (r) => r.played.filter((p) => p.first.toLowerCase() === 'dansh');
const shape = (r) => ({ played: r.summary.played, dansh: dansh(r).length, provisional: r.provisional.map((p) => [p.sessionId, p.repeats]) });

beforeAll(() => { jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate', 'clearImmediate', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask', 'hrtime', 'performance'] }); });
afterAll(() => { jest.useRealTimers(); });

describe('on: off-list rows fold by child', () => {
  test('the same typed name on two DIFFERENT phones is two children: two played rows, two provisional rows', async () => {
    wire({ on: true, bindings: [bind(F.TYPED, 'tomb-a'), bind(TYPED2, 'tomb-b')] });
    const r = await Data.quizReport(F.TEACHER, F.QUIZ);
    expect(shape(r)).toEqual({ played: 4, dansh: 2, provisional: [['s3', 1], ['s4', 1]] });
  });

  test('one child twice on ONE phone is one row, the first finish, repeats 2', async () => {
    wire({ on: true, bindings: [bind(F.TYPED, 'tomb-a'), bind(TYPED2, 'tomb-a')] });
    const r = await Data.quizReport(F.TEACHER, F.QUIZ);
    expect(shape(r)).toEqual({ played: 3, dansh: 1, provisional: [['s3', 2]] });
    expect(dansh(r)[0]).toMatchObject({ correct: 5 });
  });

  test('the same name with no binding at all is one row (the fresh-browser case), as today', async () => {
    wire({ on: true });
    const r = await Data.quizReport(F.TEACHER, F.QUIZ);
    expect(shape(r)).toEqual({ played: 3, dansh: 1, provisional: [['s3', 2]] });
  });

  test('one bound, one not: one row (the unbound record cannot be told apart)', async () => {
    wire({ on: true, bindings: [bind(F.TYPED, 'tomb-a')] });
    const r = await Data.quizReport(F.TEACHER, F.QUIZ);
    expect(shape(r)).toEqual({ played: 3, dansh: 1, provisional: [['s3', 2]] });
  });

  test('a merged pair is one child even with another typed name on another phone (merged_into names the child)', async () => {
    wire({ on: true, bindings: [bind(F.TYPED, 'tomb-a'), bind(TYPED2, 'tomb-b')], second: { merged_into: F.TYPED, status: 'merged' }, secondName: 'Danish' });
    const r = await Data.quizReport(F.TEACHER, F.QUIZ);
    expect(shape(r)).toEqual({ played: 3, dansh: 1, provisional: [['s3', 2]] });
    expect(r.played.filter((p) => p.first === 'Danish')).toHaveLength(0);
  });

  test('children on the list are untouched: the same on-list rows, not-played list and class tile as with the switch off', async () => {
    const listed = (r) => ({ rows: r.played.filter((p) => p.onList), notPlayed: r.notPlayed, onList: r.summary.onList, of: r.summary.of });
    wire({ on: false, bindings: [bind(F.TYPED, 'tomb-a'), bind(TYPED2, 'tomb-b')] });
    const off = listed(await Data.quizReport(F.TEACHER, F.QUIZ));
    wire({ on: true, bindings: [bind(F.TYPED, 'tomb-a'), bind(TYPED2, 'tomb-b')] });
    const on = listed(await Data.quizReport(F.TEACHER, F.QUIZ));
    expect(on).toEqual(off);
    expect(on).toMatchObject({ onList: 2, of: 8 });
  });

  test.each([['on', true], ['off', false]])('%s: two children ON the list who share a first name (Ali, rolls 2 and 3) stay two rows', async (_, on) => {
    wire({ on, extra: [done('s6', F.kid(2), 'Ali Raza Testwala', 4, 9), done('s7', F.kid(3), 'Ali Hamza Testwala', 3, 8)] });
    const r = await Data.quizReport(F.TEACHER, F.QUIZ);
    expect(r.played.filter((p) => p.first === 'Ali').map((p) => [p.onList, p.roll]).sort()).toEqual([[true, 2], [true, 3]]);
  });

  test('a merged record carries the phones of the record it was merged into', async () => {
    // TYPED2 has no binding of its own but was merged into SURV, bound to another phone: the same typed name on two
    // phones is two children (without the merged-into record's phone it would read as "unbound" and fold)
    const SURV = '44444444-4444-4444-8444-4444444444aa';
    const fake = wire({ on: true, bindings: [bind(F.TYPED, 'tomb-a'), bind(SURV, 'tomb-b')], second: { merged_into: SURV, status: 'merged' } });
    fake.db.students.push(loose(SURV, 'Dansh'));
    const r = await Data.quizReport(F.TEACHER, F.QUIZ);
    expect(shape(r)).toEqual({ played: 4, dansh: 2, provisional: [['s3', 1], ['s4', 1]] });
  });

  test('on, the child facts are read once per report (one bindings read for the played rows and the provisional list)', async () => {
    const fake = wire({ on: true, bindings: [bind(F.TYPED, 'tomb-a'), bind(TYPED2, 'tomb-b')] });
    await Data.quizReport(F.TEACHER, F.QUIZ);
    expect(fake.calls.filter((c) => c.table === 'child_phone_bindings')).toHaveLength(1);
  });

  test('an off-list record merged into a child ON the list is that child: counted once, as the listed row', async () => {
    // TYPED2 typed another name and was merged into Ayesha (on the list): not a second child
    wire({ on: true, second: { merged_into: F.kid(1), status: 'merged' }, secondName: 'Aisha' });
    const r = await Data.quizReport(F.TEACHER, F.QUIZ);
    expect(r.summary.played).toBe(3);   // Ayesha (listed), Bilal (listed), Dansh (off the list) — never "Aisha" as a 4th
    expect(r.played.filter((p) => p.first === 'Aisha')).toHaveLength(0);
    expect(r.provisional.map((p) => p.sessionId)).toEqual(['s3']);
  });

  test('a facts read that does not answer in time: today\'s fold (the report never waits on it)', async () => {
    const fake = wire({ on: true, bindings: [bind(F.TYPED, 'tomb-a'), bind(TYPED2, 'tomb-b')] });
    const from = fake.from;
    require('../../../shared/config/supabase').from = (t) => {
      if (t === 'child_phone_bindings') return { select() { return { in() { return new Promise(() => {}); } }; } };
      return from(t);
    };
    const r = await Data.quizReport(F.TEACHER, F.QUIZ);
    expect(shape(r)).toEqual({ played: 3, dansh: 1, provisional: [['s3', 2]] });
  });

  test('a failed read of the child facts: today\'s fold, and the failure is logged', async () => {
    const fake = wire({ on: true, bindings: [bind(F.TYPED, 'tomb-a'), bind(TYPED2, 'tomb-b')] });
    const from = fake.from;
    require('../../../shared/config/supabase').from = (t) => {
      if (t === 'child_phone_bindings') return { select() { return { in() { return Promise.resolve({ data: null, error: { message: 'bindings down' } }); } }; } };
      return from(t);
    };
    const r = await Data.quizReport(F.TEACHER, F.QUIZ);
    expect(shape(r)).toEqual({ played: 3, dansh: 1, provisional: [['s3', 2]] });
    const { logToFile } = require('../../../shared/utils/logger');
    expect(logToFile.mock.calls.some(([m]) => String(m).includes('child facts unreadable'))).toBe(true);
  });
});

describe('off: today\'s report, byte for byte (golden recorded on the base)', () => {
  const GOLDEN = path.join(__dirname, '__golden__', 'teacher-report-fold-by-child.off.json');
  const BINDINGS = () => [bind(F.TYPED, 'tomb-a'), bind(TYPED2, 'tomb-b')];
  const record = async () => JSON.stringify(await Data.quizReport(F.TEACHER, F.QUIZ));

  test.each(OFF_VALUES)('quiz_report_fold_by_child %s: the report is today\'s (two phones still fold to one row)', async (_, value) => {
    wire({ on: value, bindings: BINDINGS() });
    const got = await record();
    if (process.env.GOLDEN_WRITE === '1') fs.writeFileSync(GOLDEN, `${got}\n`);
    expect(got).toBe(fs.readFileSync(GOLDEN, 'utf8').trim());
  });

  test.each([['"TRUE"', 'TRUE'], ['" true "', ' true '], ['JSON "TRUE"', '"TRUE"'], ['the string "true"', 'true'], ['the JSON string "\\"true\\""', '"true"']])('quiz_report_fold_by_child %s is not a real true: today\'s report', async (_, value) => {
    wire({ on: value, bindings: BINDINGS() });
    expect(await record()).toBe(fs.readFileSync(GOLDEN, 'utf8').trim());
  });

  test('an unreadable switch: the report is today\'s', async () => {
    const fake = wire({ on: true, bindings: BINDINGS() });
    require('../../../shared/config/supabase').from = throwOn(fake.from, KEY);
    expect(await record()).toBe(fs.readFileSync(GOLDEN, 'utf8').trim());
  });

  test('off makes no extra read: no child_phone_bindings read', async () => {
    const fake = wire({ on: false, bindings: BINDINGS() });
    await record();
    expect(fake.calls.filter((c) => c.table === 'child_phone_bindings')).toHaveLength(0);
  });
});

describe('a storybook send\'s 12 h WhatsApp report counts the children its web report counts', () => {
  const kids = async () => (await Data.storySendChildren(F.TEACHER, F.QUIZ, F.SC, SESSIONS)).map((s) => s.id).sort();

  test('on: the same typed name on two different phones is two children, as on the web report', async () => {
    wire({ on: true, bindings: [bind(F.TYPED, 'tomb-a'), bind(TYPED2, 'tomb-b')] });
    expect(await kids()).toEqual(['s1', 's2', 's3', 's4']);
    expect((await Data.quizReport(F.TEACHER, F.QUIZ)).summary.played).toBe(4);
  });

  test('off: today\'s count, the same typed name is one child (the first finish)', async () => {
    wire({ on: false, bindings: [bind(F.TYPED, 'tomb-a'), bind(TYPED2, 'tomb-b')] });
    expect(await kids()).toEqual(['s1', 's2', 's3']);
  });
});
