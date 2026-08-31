/**
 * ClassService.importRoster — the coach's scanned register, written the same way a
 * teacher's own class is written.
 *
 * WHY THIS EXISTS. /roster shipped on 2026-08-30 writing `classes`, `students` and
 * `class_enrollments` directly, which made it the FOURTH independent writer of the
 * students model — and it bypassed the one thing ClassService does that nothing else
 * does: maintain the legacy `student_lists` mirror. The consequence was measured on
 * a real save: 16 children were correctly enrolled in class 780b16d8 and the teacher
 * who actually teaches that class could not see a single one of them, because
 * attendance still reads `student_lists` → `students.list_id`, and every row the
 * coach wrote had `list_id` null. The coach had done the work and the teacher was
 * still going to be asked to type the class in by hand.
 *
 * So the fix is not a second mirror-writer. It is this: one entry point, on the
 * service that already owns the mirror, which /roster calls (root CLAUDE.md rule
 * 15/database-engineering §3.6 — one writer per fact).
 *
 * WHOSE MIRROR. `student_lists` is per-teacher and `students.list_id` is a single
 * FK, so the roster can be mirrored into exactly one person's legacy list. It goes
 * to the CLASS TEACHER when the coach names one — she is the person who will mark
 * the attendance. When no teacher is named it falls back to the coach, so the class
 * and the children still exist and nothing is lost; they simply are not yet in
 * anyone's attendance until a teacher is assigned.
 */

const { createFakeSupabase } = require('../fixtures/fake-supabase');

let mockDb;
jest.mock('../../bot/shared/config/supabase', () => ({
  from: (...args) => mockDb.from(...args),
  rpc: (...args) => mockDb.rpc(...args),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const SCHOOL = 'school-uuid-1';
const COACH = 'coach-uuid-1';
const TEACHER = 'teacher-uuid-1';
const SESSION = '2026-2027';

let svc;
beforeEach(() => {
  jest.resetModules();
  mockDb = createFakeSupabase({
    grade_levels: [{ code: 'grade_3', ordinal: 3, band: 'primary', aliases: ['grade_3'], is_active: true }],
    subjects: [],
    academic_sessions: [{ code: SESSION, kind: 'annual', starts_on: '2026-04-01', ends_on: '2027-03-31', is_active: true }],
    sections: [{ code: 'A', sort_order: 1, is_active: true }],
    shifts: [{ code: 'morning', sort_order: 1, is_active: true }],
    student_lists: [],
    classes: [],
    class_teachers: [],
    class_teacher_subjects: [],
    class_enrollments: [],
    students: [],
  });
  svc = require('../../bot/shared/services/classes/class.service');
});

const KIDS = [
  { roll_number: '1', student_name: 'Ayesha', father_name: 'Bilal', parent_phone: '923001234567' },
  { roll_number: '2', student_name: 'Minahil', father_name: 'Asif', parent_phone: null },
  { roll_number: null, student_name: 'Hooria', father_name: null, parent_phone: null },
];

const importIt = (over = {}) => svc.importRoster({
  runId: 'run-2026-08-31-test1',
  schoolId: SCHOOL,
  gradeCode: 'grade_3',
  section: 'A',
  sessionCode: SESSION,
  classTeacherUserId: TEACHER,
  createdByUserId: COACH,
  students: KIDS,
  ...over,
});

const table = (name) => mockDb._tables[name];

describe('importRoster', () => {
  it('creates the class and enrols every child', async () => {
    const res = await importIt();
    expect(res.error).toBeUndefined();
    expect(res.added).toBe(3);
    expect(table('class_enrollments').filter((e) => e.class_id === res.classId)).toHaveLength(3);
  });

  it('THE POINT: every child is attached to the class TEACHER’S legacy list', async () => {
    const res = await importIt();
    const mirror = table('student_lists').find((l) => l.class_id === res.classId);
    expect(mirror).toBeDefined();
    expect(mirror.user_id).toBe(TEACHER);
    // list_id null on all 16 rows is exactly what the field test produced.
    expect(table('students').map((s) => s.list_id)).toEqual([mirror.id, mirror.id, mirror.id]);
  });

  it('records the named class teacher on the class', async () => {
    const res = await importIt();
    const assignment = table('class_teachers').find((a) => a.class_id === res.classId);
    expect(assignment).toMatchObject({ teacher_user_id: TEACHER, is_class_teacher: true });
  });

  it('stores the roll number as the integer the column actually is', async () => {
    await importIt();
    const ayesha = table('students').find((s) => s.student_name === 'Ayesha');
    expect(ayesha.roll_number).toBe(1);
    const hooria = table('students').find((s) => s.student_name === 'Hooria');
    expect(hooria.roll_number).toBeNull();
  });

  it('keeps the father name and a parent phone when the register carried them', async () => {
    await importIt();
    expect(table('students').find((s) => s.student_name === 'Ayesha')).toMatchObject({
      father_name: 'Bilal', parent_phone: '923001234567',
    });
  });

  it('is idempotent — re-scanning the same register writes nothing the second time', async () => {
    const first = await importIt();
    const second = await importIt();
    expect(second.classId).toBe(first.classId);
    expect(second.added).toBe(0);
    expect(second.skipped).toBe(3);
    expect(table('students')).toHaveLength(3);
  });

  it('still creates the class when no teacher is named, and says the mirror is the coach’s', async () => {
    const res = await importIt({ classTeacherUserId: null });
    expect(res.classId).toBeTruthy();
    expect(res.classTeacherAssigned).toBe(false);
    const mirror = table('student_lists').find((l) => l.class_id === res.classId);
    expect(mirror.user_id).toBe(COACH);
  });

  it('refuses a grade the vocabulary does not know, rather than inventing a class', async () => {
    const res = await importIt({ gradeCode: 'grade_99' });
    expect(res.error).toBe('unknown_grade');
    expect(table('classes')).toHaveLength(0);
  });

  it('writes nothing at all when the list is empty', async () => {
    const res = await importIt({ students: [] });
    expect(res.error).toBe('no_students');
    expect(table('classes')).toHaveLength(0);
  });
});

/**
 * The duplication P0 (2026-08-31, first live day): 460 surplus children across 24
 * classes because the save was neither idempotent nor serialized, and its 2N
 * round-trips took 25-38s — long past the point where a coach presses Save again.
 * The fix moves the whole student write into ONE database function; these tests
 * pin the JS side of that contract.
 */
describe('importRoster — the P0 duplication contract', () => {
  it('the student write is ONE database call, and it carries the run id', async () => {
    await importIt();
    const calls = mockDb._rpcCalls.filter((c) => c.name === 'roster_import_students');
    expect(calls).toHaveLength(1);
    expect(calls[0].args.p_run_id).toBe('run-2026-08-31-test1');
    expect(calls[0].args.p_students).toHaveLength(3);
    expect(calls[0].args.p_enrolled_by).toBe(COACH);
  });

  it('refuses to run without a run id — an unidentifiable write cannot be made idempotent', async () => {
    const res = await importIt({ runId: null });
    expect(res.error).toBe('missing_run');
    expect(table('students')).toHaveLength(0);
  });

  it('a replayed run (the coach pressed Save again) writes nothing and says so', async () => {
    const first = await importIt();
    expect(first.added).toBe(3);
    const second = await importIt(); // same runId — the exact production failure
    expect(second.added).toBe(0);
    expect(second.replay).toBe(true);
    expect(table('students')).toHaveLength(3);
    expect(table('class_enrollments')).toHaveLength(3);
  });

  it('a lock timeout (someone else mid-save on this class) maps to save_in_progress', async () => {
    mockDb._failRpc('roster_import_students', { code: '55P03', message: 'canceling statement due to lock timeout' });
    const res = await importIt();
    expect(res.error).toBe('save_in_progress');
    expect(table('students')).toHaveLength(0);
  });
});

/**
 * Recognition, not fuzzy matching (Phase 1). The admission number the register
 * prints is the school's own permanent id for the child. A re-scan next term —
 * new class, new roll numbers — must find the SAME child, not mint a second one.
 * Name is never how that happens: 18 same-name pairs were measured inside single
 * reviewed registers.
 */
describe('importRoster — recognition by (school, admission number)', () => {
  it('sends the school with the payload so the function can recognise', async () => {
    await importIt();
    const call = mockDb._rpcCalls.find((c) => c.name === 'roster_import_students');
    expect(call.args.p_school_id).toBe(SCHOOL);
  });

  it('a known admission number is the SAME child — enrolled, not duplicated', async () => {
    // She was scanned last term into another class, admission no 4818.
    table('students').push({
      id: 'existing-ayesha', student_name: 'Ayesha', father_name: null,
      parent_phone: null, roll_number: 7, list_id: null, school_id: SCHOOL,
      admission_no: '4818', status: 'active', is_active: true, import_run_id: 'old-run',
    });
    const res = await importIt({
      runId: 'run-new-term',
      students: [{ roll_number: '1', student_name: 'Aisha', father_name: 'Bilal', parent_phone: null, admission_no: '4818' }],
    });
    expect(res.added).toBe(1); // on THIS roster now
    const rows = table('students').filter((s) => s.admission_no === '4818');
    expect(rows).toHaveLength(1); // still one child
    const enr = table('class_enrollments').filter((e) => e.student_id === 'existing-ayesha');
    expect(enr).toHaveLength(1);
  });

  it('recognition fills blanks and never overwrites what the child already has', async () => {
    table('students').push({
      id: 'existing-k', student_name: 'Kinza', father_name: 'Tariq',
      parent_phone: null, roll_number: null, list_id: null, school_id: SCHOOL,
      admission_no: '5155', status: 'active', is_active: true, import_run_id: 'old-run',
    });
    await importIt({
      runId: 'run-new-term-2',
      students: [{ roll_number: '3', student_name: 'Kinza Bibi', father_name: 'Different Man', parent_phone: '923001112223', admission_no: '5155' }],
    });
    const k = table('students').find((s) => s.id === 'existing-k');
    expect(k.father_name).toBe('Tariq');            // never overwritten
    expect(k.parent_phone).toBe('923001112223');    // blank, so filled
    expect(k.student_name).toBe('Kinza');           // the record keeps its name
  });
});
