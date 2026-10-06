/**
 * Two bulk adds on ONE class that overlap must both finish, with distinct rolls,
 * and must never leave a student row that is not enrolled.
 *
 * Production: a teacher submitted the same paste twice while the first call was
 * still writing (one child per ~1 s). The second call read the half-built roster,
 * took max roll + 1, inserted the students row, then the enrolment hit the unique
 * index idx_enrollments_class_roll. addStudents stopped part-way, and because
 * addStudent never undid its students row, an ACTIVE student with no enrolment
 * stayed on the teacher's legacy list: a same-name duplicate.
 *
 * The fake database here enforces that unique index and yields on every
 * operation, so overlapping callers interleave the way they do against Postgres.
 * Two service instances sharing one database stand for two replicas: an
 * in-process lock cannot save them, only the database's constraint can.
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
const tick = () => new Promise((r) => setImmediate(r));

/** The real constraint, plus a yield on every call so overlapping callers interleave. */
function interleavingDb(seed) {
  const real = createFakeSupabase(seed);
  const from = (name) => {
    const b = real.from(name);
    const origThen = b.then;
    b.then = (ok, bad) => tick().then(() => origThen.call(b, ok, bad));
    const origSingle = b.single;
    b.single = async () => {
      await tick();
      return origSingle.call(b);
    };
    if (name === 'class_enrollments') {
      let payload = null;
      const origInsert = b.insert;
      b.insert = (p) => { payload = p; return origInsert.call(b, p); };
      b.single = async () => {
        await tick();
        const taken = payload && payload.is_active && payload.roll_number != null
          && real._tables.class_enrollments.some((e) => e.class_id === payload.class_id
            && e.is_active && e.roll_number === payload.roll_number);
        if (taken) {
          return {
            data: null,
            error: { code: '23505', message: 'duplicate key value violates unique constraint "idx_enrollments_class_roll"' },
          };
        }
        return origSingle.call(b);
      };
    }
    return b;
  };
  return { ...real, from };
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

/** A fresh copy of the service, as a second replica would load it. */
function replica() {
  let svc;
  jest.isolateModules(() => { svc = require('../../bot/shared/services/classes/class.service'); });
  return svc;
}

const NAMES = Array.from({ length: 8 }, (_, i) => `Child Number${i + 1}`);
const PASTE = NAMES.join('\n');

function expectConsistent() {
  const kids = mockDb._tables.students;
  const enrols = mockDb._tables.class_enrollments.filter((e) => e.is_active);
  // no orphan: every ACTIVE student row is enrolled
  const enrolled = new Set(enrols.map((e) => e.student_id));
  expect(kids.filter((k) => k.is_active && !enrolled.has(k.id))).toEqual([]);
  // no duplicate child, no duplicate roll
  const active = kids.filter((k) => k.is_active).map((k) => k.student_name).sort();
  expect(active).toEqual([...NAMES].sort());
  const rolls = enrols.map((e) => e.roll_number);
  expect(new Set(rolls).size).toBe(rolls.length);
}

beforeEach(() => {
  jest.resetModules();
  mockLog = jest.fn();
  mockDb = interleavingDb(seed());
});

describe('two overlapping addStudents on one class', () => {
  it('on ONE replica: both complete, one child per name, distinct rolls, no orphan', async () => {
    const svc = replica();
    const [a, b] = await Promise.all([
      svc.addStudents({ classId: CLASS_ID, teacherUserId: TEACHER, rawText: PASTE }),
      svc.addStudents({ classId: CLASS_ID, teacherUserId: TEACHER, rawText: PASTE }),
    ]);
    expect(a.error).toBeUndefined();
    expect(b.error).toBeUndefined();
    expect(a.added + b.added).toBe(NAMES.length);
    expectConsistent();
  });

  it('on TWO replicas (no shared process state): both complete, no duplicate, no orphan', async () => {
    const one = replica();
    const two = replica();
    const [a, b] = await Promise.all([
      one.addStudents({ classId: CLASS_ID, teacherUserId: TEACHER, rawText: PASTE }),
      two.addStudents({ classId: CLASS_ID, teacherUserId: TEACHER, rawText: PASTE }),
    ]);
    expect(a.error).toBeUndefined();
    expect(b.error).toBeUndefined();
    expect(a.added + b.added).toBe(NAMES.length);
    expectConsistent();
  });

  it('a second paste that arrives half-way (different replica, offset start) also finishes cleanly', async () => {
    const one = replica();
    const two = replica();
    const first = one.addStudents({ classId: CLASS_ID, teacherUserId: TEACHER, rawText: PASTE });
    for (let i = 0; i < 40; i += 1) await tick();
    const second = two.addStudents({ classId: CLASS_ID, teacherUserId: TEACHER, rawText: PASTE });
    const [a, b] = await Promise.all([first, second]);
    expect(a.error).toBeUndefined();
    expect(b.error).toBeUndefined();
    expectConsistent();
  });
});

describe('addStudent when the enrolment is refused', () => {
  it('takes the students row it just wrote back out of service', async () => {
    const svc = replica();
    mockDb._tables.class_enrollments.push({ id: 'e0', class_id: CLASS_ID, student_id: 'x', roll_number: 5, is_active: true });
    const res = await svc.addStudent({
      classId: CLASS_ID, teacherUserId: TEACHER, studentName: 'Late Child', rollNumber: 5,
    });
    expect(res.error).toBe('insert_failed');
    const row = mockDb._tables.students.find((s) => s.student_name === 'Late Child');
    expect(row.is_active).toBe(false);
  });

  it('logs the database message at error level', async () => {
    const svc = replica();
    mockDb._tables.class_enrollments.push({ id: 'e0', class_id: CLASS_ID, student_id: 'x', roll_number: 5, is_active: true });
    await svc.addStudent({ classId: CLASS_ID, teacherUserId: TEACHER, studentName: 'Late Child', rollNumber: 5 });
    const hit = mockLog.mock.calls.find((c) => /enrollStudent: insert failed/.test(c[0]));
    expect(hit).toBeDefined();
    expect(hit[2]).toBe('error');
    expect(JSON.stringify(hit[1])).toMatch(/idx_enrollments_class_roll/);
  });
});
