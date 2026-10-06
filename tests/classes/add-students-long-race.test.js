/**
 * A second paste on one class must still land when the OTHER writer is still adding
 * its own, longer list.
 *
 * Live sandbox: replica A added 20 children; replica B started a second later with 5.
 * B's first child clashed on the roll unique index six times, and every clash was on
 * A's NEXT roll: B re-read maxRoll = N, tried N + 1, and A was already writing N + 1.
 * The retry budget ran out, B returned { error, added: 0 }, none of its 5 children were
 * enrolled, six inactive students rows were left behind, and the teacher was shown
 * "Nothing changed".
 *
 * The fake database here enforces idx_enrollments_class_roll and plays writer A: just
 * before each of B's enrolment inserts lands, A commits its next child at the class's
 * current max roll + 1 (once, or twice for a faster writer). That is the interleaving
 * QA measured, for longer than the old retry budget.
 */

const { createFakeSupabase } = require('../fixtures/fake-supabase');

let mockDb;
jest.mock('../../bot/shared/config/supabase', () => ({
  from: (...args) => mockDb.from(...args),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const CLASS_ID = 'class-1';
const TEACHER = 'teacher-1';

const A_NAMES = Array.from({ length: 20 }, (_, i) => `Aleem${i + 1} Testwala`);
const B_NAMES = ['Bano Testwala', 'Bilal Testwala', 'Bushra Testwala', 'Basit Testwala', 'Benish Testwala'];

/**
 * The real constraint, plus writer A: before each of B's enrolment inserts is checked,
 * A commits `perAttempt` more of its own children at max roll + 1.
 */
function racingDb(seed, { perAttempt }) {
  const real = createFakeSupabase(seed);
  const t = real._tables;
  let aLeft = A_NAMES.slice();
  const maxRoll = () => t.class_enrollments
    .filter((e) => e.class_id === CLASS_ID && e.is_active)
    .reduce((m, e) => Math.max(m, e.roll_number || 0), 0);
  const writerAStep = () => {
    for (let i = 0; i < perAttempt && aLeft.length; i += 1) {
      const name = aLeft.shift();
      const roll = maxRoll() + 1;
      const id = `a-${roll}-${name}`;
      t.students.push({ id, student_name: name, roll_number: roll, list_id: 'list-1', is_active: true });
      t.class_enrollments.push({ id: `ae-${id}`, class_id: CLASS_ID, student_id: id, roll_number: roll, is_active: true });
    }
  };
  const from = (name) => {
    const b = real.from(name);
    if (name !== 'class_enrollments') return b;
    let payload = null;
    const origInsert = b.insert;
    const origSingle = b.single;
    b.insert = (p) => { payload = p; return origInsert.call(b, p); };
    b.single = async () => {
      if (!payload) return origSingle.call(b);
      writerAStep();
      const taken = payload.is_active && payload.roll_number != null
        && t.class_enrollments.some((e) => e.class_id === payload.class_id
          && e.is_active && e.roll_number === payload.roll_number);
      if (taken) {
        return {
          data: null,
          error: { code: '23505', message: 'duplicate key value violates unique constraint "idx_enrollments_class_roll"' },
        };
      }
      return origSingle.call(b);
    };
    return b;
  };
  return { ...real, from, finishA: () => { while (aLeft.length) writerAStep(); } };
}

function seed() {
  return {
    classes: [{ id: CLASS_ID, is_active: true }],
    class_teachers: [{ id: 'ct-1', class_id: CLASS_ID, teacher_user_id: TEACHER, is_class_teacher: true, is_active: true }],
    student_lists: [{ id: 'list-1', user_id: TEACHER, class_id: CLASS_ID, is_active: true }],
    students: [],
    class_enrollments: [],
  };
}

beforeEach(() => { jest.resetModules(); });

describe.each([1, 2])('a paste racing a longer paste on another replica (A writes %i per B attempt)', (perAttempt) => {
  it('enrols every one of B\'s children with distinct rolls, no orphan, no leftover rows', async () => {
    mockDb = racingDb(seed(), { perAttempt });
    const svc = require('../../bot/shared/services/classes/class.service');

    const res = await svc.addStudents({ classId: CLASS_ID, teacherUserId: TEACHER, rawText: B_NAMES.join('\n') });
    mockDb.finishA();

    expect(res.error).toBeUndefined();
    expect(res.added).toBe(B_NAMES.length);

    const t = mockDb._tables;
    const active = t.class_enrollments.filter((e) => e.is_active);
    const enrolledIds = new Set(active.map((e) => e.student_id));
    const byId = new Map(t.students.map((s) => [s.id, s]));

    // every one of B's children is enrolled, once
    const enrolledNames = active.map((e) => byId.get(e.student_id).student_name).sort();
    expect(enrolledNames).toEqual([...A_NAMES, ...B_NAMES].sort());
    // distinct rolls
    const rolls = active.map((e) => e.roll_number);
    expect(new Set(rolls).size).toBe(rolls.length);
    // no active orphan
    expect(t.students.filter((s) => s.is_active && !enrolledIds.has(s.id))).toEqual([]);
    // a clash does not leave a taken-back students row per attempt
    expect(t.students.filter((s) => !s.is_active)).toEqual([]);
    // the students row carries the roll its enrolment holds
    for (const e of active) expect(byId.get(e.student_id).roll_number).toBe(e.roll_number);
  });
});
