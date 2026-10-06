'use strict';
/**
 * The teacher's two reconcile actions on a typed (provisional) child, and what
 * they leave behind in the class list:
 *
 *   "Add to 4-A"      the typed child is enrolled WITH the next free list number
 *                     (the class's highest + 1), on the enrolment and on the
 *                     students row, so the next quiz's "list number" question can
 *                     find them and the register shows a number. A roll another
 *                     writer took first is retried, never shared, never left blank.
 *   "This is <child>" the finish moves onto the roster child, and the typed
 *                     students row it replaced is closed as merged into that child
 *                     (status 'merged', merged_into, not active) — a typed row only:
 *                     a class-list child or a child enrolled anywhere is never merged.
 *
 * Supabase is the faked boundary (with the partial unique index on
 * class_enrollments (class_id, roll_number) WHERE is_active); the class resolver,
 * the roster read and ClassService's enrolment run for real.
 */

jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/services/queue/sqs-queue.service', () => ({ queueJob: jest.fn().mockResolvedValue({ MessageId: 'm1' }) }));
jest.mock('../../../shared/services/cache/railway-redis.service', () => ({
  setNX: jest.fn(async () => true), get: jest.fn(async () => null), set: jest.fn(async () => true), delete: jest.fn(async () => true),
}));
jest.mock('../../../shared/services/whatsapp.service', () => ({ sendMessage: jest.fn(), sendImageFromBuffer: jest.fn(), sendDocument: jest.fn() }));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('openchemlib', () => require('../../../../tests/__mocks__/openchemlib.js'));

const { makeFake } = require('./fake-supabase');
const F = require('./web-quiz-identity-fixture');
const supabase = require('../../../shared/config/supabase');
const T = require('../../../shared/services/quiz/web-quiz-token');
const WQ = require('../../../shared/services/quiz/web-quiz.service');
const IdRoster = require('../../../shared/services/quiz/web-quiz-identity-roster');
const Identity = require('../../../shared/services/quiz/web-quiz-identity');

const { kid, done } = F;
const SESSIONS = () => [
  done('s1', kid(1), 'Ayesha Testwala', 4, 5),
  done('sT', F.TYPED, 'Gulnaz Testwala', 3, 2), // QA's repro: a typed child the list does not have
];

// The real index is partial (active rows with a roll); the fake's key-uniques match it here
// because every enrolment in the fixture is active and every insert under test carries a roll.
const UNIQUES = {
  quiz_answers: ['session_id', 'question_id'],
  quiz_share_codes: ['code'],
  class_enrollments: ['class_id', 'roll_number', 'is_active'],
};

let fake;
function seed() {
  const db = F.db({ sessions: SESSIONS() });
  db.students.find((s) => s.id === F.TYPED).student_name = 'Gulnaz Testwala';
  fake = makeFake(db, { uniques: UNIQUES });
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
  IdRoster._resetCache();
}
const SAVED = { ...process.env };
let P;
beforeEach(() => {
  process.env = { ...SAVED, INTERNAL_API_KEY: 'test-key' };
  delete process.env.WEB_QUIZ_TOKEN_SECRET;
  jest.clearAllMocks();
  seed();
  P = T.signPreview({ shareCodeId: F.SC, teacherUserId: F.TEACHER });
});
afterAll(() => { process.env = SAVED; });

const enrolOf = (studentId) => fake.db.class_enrollments.filter((e) => e.student_id === studentId && e.class_id === F.CLS_A && e.is_active);
const studentRow = (id) => fake.db.students.find((s) => s.id === id);

describe('"Add to 4-A" gives the typed child the next free list number', () => {
  test('a class whose highest list number is 10: the typed child is enrolled as 11, on the enrolment and the students row', async () => {
    expect(Math.max(...fake.db.class_enrollments.filter((e) => e.class_id === F.CLS_A && e.is_active).map((e) => e.roll_number))).toBe(10);
    const out = await WQ.fixWho({ code: 'AB12CD', p: P, ref: 'sT', add: true });
    expect(out.ok).toBe(true);
    const rows = enrolOf(F.TYPED);
    expect(rows).toHaveLength(1);
    expect(rows[0].roll_number).toBe(11);
    expect(studentRow(F.TYPED).roll_number).toBe(11);
    // the report's 303 names the number it assigned (?ok=added&no=11): the row carries it
    expect(out.row).toMatchObject({ on_list: true, roll: 11 });
  });

  test('the next quiz finds the child by list number: the class roster carries 11 and the "list number" question picks them', async () => {
    // A classmate of the same name, so the matcher has to ask for the list number.
    const twin = '66666666-6666-4666-8666-666666666666';
    fake.db.students.push({ id: twin, student_name: 'Gulnaz Testwala', father_name: null, roll_number: 5, list_id: F.LIST_A, is_active: true, status: 'active', created_at: '2026-09-01T00:00:00Z' });
    fake.db.class_enrollments.find((e) => e.id === 'e-5').student_id = twin; // takes list number 5's slot
    fake.db.students.find((s) => s.id === kid(5)).is_active = false;
    await WQ.fixWho({ code: 'AB12CD', p: P, ref: 'sT', add: true });
    IdRoster._resetCache();
    const kids = await IdRoster.loadClassRoster(F.CLS_A);
    expect(kids.find((k) => k.id === F.TYPED)).toMatchObject({ number: 11 });
    expect(Identity.match(kids, 'Gulnaz Testwala', {})).toMatchObject({ outcome: 'ask', need: 'number' });
    const m = Identity.match(kids, 'Gulnaz Testwala', { number: 11 });
    expect(m.outcome).toBe('one');
    expect(m.kid.id).toBe(F.TYPED);
  });

  test('a roll clash (another writer took 11 first): it re-reads the class and enrols at a distinct number', async () => {
    const other = '55555555-5555-4555-8555-555555555555';
    const realFrom = fake.from;
    let raced = false;
    supabase.from = (t) => {
      const b = realFrom(t);
      if (t !== 'class_enrollments' || raced) return b;
      const insert = b.insert;
      b.insert = (row) => {
        if (!raced) {
          raced = true;
          fake.db.students.push({ id: other, student_name: 'Rafia Testwala', list_id: F.LIST_A, roll_number: 11, is_active: true, status: 'active' });
          fake.db.class_enrollments.push({ id: 'e-race', class_id: F.CLS_A, student_id: other, roll_number: 11, is_active: true });
        }
        return insert(row);
      };
      return b;
    };
    const out = await WQ.fixWho({ code: 'AB12CD', p: P, ref: 'sT', add: true });
    expect(out.ok).toBe(true);
    const rolls = fake.db.class_enrollments.filter((e) => e.class_id === F.CLS_A && e.is_active).map((e) => e.roll_number);
    expect(new Set(rolls).size).toBe(rolls.length);
    expect(enrolOf(F.TYPED)[0].roll_number).toBe(12);
    expect(studentRow(F.TYPED).roll_number).toBe(12);
  });

  test('a child already on the class keeps their enrolment and number (no second enrolment, no new number)', async () => {
    fake.db.class_enrollments.push({ id: 'e-typed', class_id: F.CLS_A, student_id: F.TYPED, roll_number: 7, is_active: true });
    const ClassService = require('../../../shared/services/classes/class.service');
    const out = await ClassService.enrollExistingStudent({ classId: F.CLS_A, teacherUserId: F.TEACHER, studentId: F.TYPED });
    expect(out.created).toBe(false);
    expect(enrolOf(F.TYPED)).toHaveLength(1);
    expect(enrolOf(F.TYPED)[0].roll_number).toBe(7);
    expect(studentRow(F.TYPED).roll_number == null).toBe(true);
  });
});

describe('"This is <child>" closes the typed row it replaced', () => {
  test('the typed row is merged into the chosen child: status merged, merged_into set, not active', async () => {
    const out = await WQ.fixWho({ code: 'AB12CD', p: P, ref: 'sT', studentId: kid(2) });
    expect(out.ok).toBe(true);
    expect(fake.db.quiz_sessions.find((s) => s.id === 'sT').student_id).toBe(kid(2));
    expect(studentRow(F.TYPED)).toMatchObject({ status: 'merged', merged_into: kid(2), is_active: false });
    expect(studentRow(kid(2))).toMatchObject({ status: 'active', is_active: true });
  });

  test('a finish on a class-list child moved to another child never merges the list child', async () => {
    const out = await WQ.fixWho({ code: 'AB12CD', p: P, ref: 's1', studentId: kid(2) });
    expect(out.ok).toBe(true);
    expect(studentRow(kid(1))).toMatchObject({ status: 'active', is_active: true });
    expect(studentRow(kid(1)).merged_into == null).toBe(true);
  });

  test('a typed row enrolled in another class is never merged', async () => {
    fake.db.class_enrollments.push({ id: 'e-typed-b', class_id: F.CLS_B, student_id: F.TYPED, roll_number: 2, is_active: true });
    const out = await WQ.fixWho({ code: 'AB12CD', p: P, ref: 'sT', studentId: kid(2) });
    expect(out.ok).toBe(true);
    expect(studentRow(F.TYPED)).toMatchObject({ status: 'active', is_active: true });
    expect(studentRow(F.TYPED).merged_into == null).toBe(true);
  });
});
