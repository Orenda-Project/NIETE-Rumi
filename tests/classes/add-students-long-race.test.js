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
 *
 * A roll is the child's register position, so retries are gap-free first: a jittered wait, a
 * re-read, max + 1 again, for up to 20 tries and at most 3 s of waiting per paste (the add runs
 * inside a WhatsApp Flow data_exchange). Only past that budget does a child leap (max + 2^n).
 * The service's `_timing.sleep` seam is stubbed so the jittered path runs without waiting.
 */

const { createFakeSupabase } = require('../fixtures/fake-supabase');

let mockDb;
let mockLog;
jest.mock('../../bot/shared/config/supabase', () => ({
  from: (...args) => mockDb.from(...args),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: (...a) => mockLog(...a) }));

const CLASS_ID = 'class-1';
const TEACHER = 'teacher-1';

const aNames = (n) => Array.from({ length: n }, (_, i) => `Aleem${i + 1} Testwala`);
const A_NAMES = aNames(20);
const B_NAMES = ['Bano Testwala', 'Bilal Testwala', 'Bushra Testwala', 'Basit Testwala', 'Benish Testwala'];

/**
 * The real constraint, plus writer A: before each of B's enrolment inserts is checked,
 * A commits `perAttempt` more of its own children at max roll + 1.
 */
function racingDb(seed, { perAttempt, names = A_NAMES }) {
  const real = createFakeSupabase(seed);
  const t = real._tables;
  const aLeft = names.slice();
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

let sleeps;
beforeEach(() => { jest.resetModules(); mockLog = jest.fn(); sleeps = []; });

/** The service, with the time seam stubbed: no real waiting, every requested wait recorded. */
function service({ random = 0.5 } = {}) {
  const svc = require('../../bot/shared/services/classes/class.service');
  svc._timing.sleep = async (ms) => { sleeps.push(ms); };
  svc._timing.random = () => random;
  return svc;
}
const slept = () => sleeps.reduce((a, b) => a + b, 0);

function consistency() {
  const t = mockDb._tables;
  const active = t.class_enrollments.filter((e) => e.is_active);
  const enrolledIds = new Set(active.map((e) => e.student_id));
  const byId = new Map(t.students.map((s) => [s.id, s]));
  const rolls = active.map((e) => e.roll_number).sort((x, y) => x - y);
  return { t, active, enrolledIds, byId, rolls };
}
const contiguous = (n) => Array.from({ length: n }, (_, i) => i + 1);
const leapt = () => mockLog.mock.calls.some((c) => /jittered roll retries exhausted/.test(c[0]));

function expectClean(allNames) {
  const { t, active, enrolledIds, byId, rolls } = consistency();
  expect(active.map((e) => byId.get(e.student_id).student_name).sort()).toEqual([...allNames].sort());
  expect(new Set(rolls).size).toBe(rolls.length);                                       // distinct
  expect(t.students.filter((s) => s.is_active && !enrolledIds.has(s.id))).toEqual([]); // no active orphan
  expect(t.students.filter((s) => !s.is_active)).toEqual([]);                          // no leftovers
  for (const e of active) expect(byId.get(e.student_id).roll_number).toBe(e.roll_number);
  return rolls;
}

describe('rolls are list numbers: no gaps', () => {
  it('(a) writers that do NOT overlap leave 1..N contiguous, with no waiting', async () => {
    mockDb = racingDb(seed(), { perAttempt: 0 });
    const svc = service();
    const a = await svc.addStudents({ classId: CLASS_ID, teacherUserId: TEACHER, rawText: A_NAMES.join('\n') });
    const b = await svc.addStudents({ classId: CLASS_ID, teacherUserId: TEACHER, rawText: B_NAMES.join('\n') });
    expect(a.added).toBe(20);
    expect(b.added).toBe(5);
    expect(expectClean([...A_NAMES, ...B_NAMES])).toEqual(contiguous(25));
    expect(sleeps).toEqual([]);
  });

  it('(b) when the other writer takes the next roll on the first k retries, no number is left empty', async () => {
    const k = 3;
    const names = aNames(k);
    mockDb = racingDb(seed(), { perAttempt: 1, names });
    const res = await service().addStudents({ classId: CLASS_ID, teacherUserId: TEACHER, rawText: B_NAMES.join('\n') });
    expect(res.error).toBeUndefined();
    expect(res.added).toBe(5);
    expect(expectClean([...names, ...B_NAMES])).toEqual(contiguous(k + 5));
    // k clashes, each waited a jitter inside 50..300 ms, well within the 20-try budget
    expect(sleeps).toHaveLength(k);
    for (const ms of sleeps) { expect(ms).toBeGreaterThanOrEqual(50); expect(ms).toBeLessThanOrEqual(300); }
    expect(leapt()).toBe(false);
  });
});

describe('(c) a paste racing a 20-child paste on another replica', () => {
  it('A writes 2 per B attempt: lands on the jittered, gap-free path', async () => {
    mockDb = racingDb(seed(), { perAttempt: 2 });
    const res = await service().addStudents({ classId: CLASS_ID, teacherUserId: TEACHER, rawText: B_NAMES.join('\n') });
    mockDb.finishA();
    expect(res.error).toBeUndefined();
    expect(res.added).toBe(5);
    expect(expectClean([...A_NAMES, ...B_NAMES])).toEqual(contiguous(25));
    expect(leapt()).toBe(false);
    expect(slept()).toBeLessThanOrEqual(3000);
  });

  it('A writes 1 per B attempt (QA\'s repro): the 3 s wait cap is reached, the leap fallback enrols all 5', async () => {
    mockDb = racingDb(seed(), { perAttempt: 1 });
    const res = await service().addStudents({ classId: CLASS_ID, teacherUserId: TEACHER, rawText: B_NAMES.join('\n') });
    mockDb.finishA();
    expect(res.error).toBeUndefined();
    expect(res.added).toBe(5);
    expectClean([...A_NAMES, ...B_NAMES]);
    expect(leapt()).toBe(true);
    expect(slept()).toBe(3000);
  });
});

describe('(d) a writer that outlasts the whole jittered budget', () => {
  it('still enrols the paste, by the last-resort leap: contention alone never fails a paste', async () => {
    const names = aNames(40);
    mockDb = racingDb(seed(), { perAttempt: 1, names });
    const res = await service().addStudents({ classId: CLASS_ID, teacherUserId: TEACHER, rawText: B_NAMES.join('\n') });
    mockDb.finishA();

    expect(res.error).toBeUndefined();
    expect(res.added).toBe(B_NAMES.length);
    expectClean([...names, ...B_NAMES]);   // distinct, no orphan, no leftovers (a gap is the accepted cost here)
    expect(leapt()).toBe(true);
  });
});

describe.each([0, 0.5, 1])('(e) the whole paste waits at most 3 s (jitter draw %p)', (random) => {
  it('never sums more than 3000 ms of sleep, even with every child contended', async () => {
    mockDb = racingDb(seed(), { perAttempt: 1, names: aNames(200) });
    const res = await service({ random }).addStudents({ classId: CLASS_ID, teacherUserId: TEACHER, rawText: B_NAMES.join('\n') });
    expect(res.error).toBeUndefined();
    expect(slept()).toBeLessThanOrEqual(3000);
    expect(sleeps.length).toBeLessThanOrEqual(20 * B_NAMES.length);
    for (const ms of sleeps) expect(ms).toBeLessThanOrEqual(300);
  });
});
