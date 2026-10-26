/**
 * bd-ql2j3p — a teacher removes a class from My Classes (the teacher app).
 *
 * The service already knew both halves — leaveClass (she goes, the class stays) and
 * deactivateClass (the class goes, only when it is hers alone and empty) — but nothing
 * called them. "Remove" is ONE action for her, so the service picks the half:
 *
 *   hers alone, no students  → the class is retired (added by mistake, nothing to keep)
 *   a colleague on it        → she leaves; the class and the colleague are untouched
 *   students enrolled        → she leaves; the roster and its history survive, and
 *                              adding the same class again brings them back
 *
 * Chain under test: the real internal route → the real ClassService → a fake Supabase
 * (the network boundary, the only mock).
 */

const { createFakeSupabase } = require('../fixtures/fake-supabase');

let mockDb;
jest.mock('../../bot/shared/config/supabase', () => ({
  from: (...args) => mockDb.from(...args),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));

const SCHOOL = 'school-uuid-1';
const TEACHER = 'teacher-uuid-1';
const OTHER_TEACHER = 'teacher-uuid-2';

const SEED = {
  grade_levels: [{ code: 'grade_4', ordinal: 4, band: 'primary', aliases: ['grade_4', 'Grade 4', '4'], is_active: true }],
  subjects: [
    { code: 'maths', parent_code: null, aliases: ['maths', 'Math'], is_active: true },
    { code: 'urdu', parent_code: null, aliases: ['urdu'], is_active: true },
  ],
  academic_sessions: [{ code: '2026-2027', kind: 'annual', starts_on: '2026-04-01', ends_on: '2027-03-31', is_active: true }],
  sections: [{ code: 'A', sort_order: 1, is_active: true }],
  shifts: [{ code: 'morning', sort_order: 1, is_active: true }],
  student_lists: [],
  classes: [],
  class_teachers: [],
  class_teacher_subjects: [],
  class_enrollments: [],
  students: [],
};

let svc;
beforeEach(() => {
  jest.resetModules();
  mockDb = createFakeSupabase(JSON.parse(JSON.stringify(SEED)));
  svc = require('../../bot/shared/services/classes/class.service');
});

async function herClass() {
  const { class: cls } = await svc.createClass({
    schoolId: SCHOOL, gradeCode: 'grade_4', section: 'A', sessionCode: '2026-2027', teacherUserId: TEACHER,
  });
  await svc.assignTeacher({ classId: cls.id, teacherUserId: TEACHER, isClassTeacher: true, subjectCodes: ['maths'] });
  return cls;
}

const classRow = (id) => mockDb._tables.classes.find((c) => c.id === id);
const activeTeachers = (id) => mockDb._tables.class_teachers
  .filter((r) => r.class_id === id && r.is_active).map((r) => r.teacher_user_id);

describe('ClassService.removeClassForTeacher', () => {
  it('a class that is hers alone and empty is retired, and leaves her list', async () => {
    const cls = await herClass();
    const res = await svc.removeClassForTeacher({ classId: cls.id, teacherUserId: TEACHER });

    expect(res).toEqual({ removed: true, how: 'retired' });
    expect(classRow(cls.id).is_active).toBe(false);
    await expect(svc.listClassesForTeacher(TEACHER)).resolves.toEqual([]);
  });

  it('a class a colleague also teaches: she leaves, the class and the colleague stay', async () => {
    const cls = await herClass();
    await svc.assignTeacher({ classId: cls.id, teacherUserId: OTHER_TEACHER, subjectCodes: ['urdu'] });

    const res = await svc.removeClassForTeacher({ classId: cls.id, teacherUserId: TEACHER });

    expect(res).toEqual({ removed: true, how: 'left' });
    expect(classRow(cls.id).is_active).toBe(true);
    expect(activeTeachers(cls.id)).toEqual([OTHER_TEACHER]);
    await expect(svc.listClassesForTeacher(TEACHER)).resolves.toEqual([]);
    await expect(svc.listClassesForTeacher(OTHER_TEACHER)).resolves.toHaveLength(1);
  });

  it('a class with students: she leaves, the roster survives, and adding it again brings it back', async () => {
    const cls = await herClass();
    mockDb._tables.students.push({ id: 'kid-1', student_name: 'Ayesha', is_active: true });
    await svc.enrollStudent({ classId: cls.id, studentId: 'kid-1' });

    const res = await svc.removeClassForTeacher({ classId: cls.id, teacherUserId: TEACHER });

    expect(res).toEqual({ removed: true, how: 'left' });
    expect(classRow(cls.id).is_active).toBe(true);
    expect(mockDb._tables.class_enrollments.filter((e) => e.class_id === cls.id && e.is_active)).toHaveLength(1);
    await expect(svc.listClassesForTeacher(TEACHER)).resolves.toEqual([]);

    const again = await svc.createClass({
      schoolId: SCHOOL, gradeCode: 'grade_4', section: 'A', sessionCode: '2026-2027', teacherUserId: TEACHER,
    });
    expect(again.class.id).toBe(cls.id);
    await svc.assignTeacher({ classId: cls.id, teacherUserId: TEACHER, subjectCodes: ['maths'] });
    const roster = await svc.listStudents({ classId: cls.id, teacherUserId: TEACHER });
    expect(roster.map((s) => s.studentId)).toEqual(['kid-1']);
  });

  it('is idempotent: a class she is not on is removed:false, not an error', async () => {
    const cls = await herClass();
    await svc.removeClassForTeacher({ classId: cls.id, teacherUserId: TEACHER });
    await expect(svc.removeClassForTeacher({ classId: cls.id, teacherUserId: TEACHER }))
      .resolves.toEqual({ removed: false });
  });

  it('never touches a class she is not on', async () => {
    const cls = await herClass();
    const res = await svc.removeClassForTeacher({ classId: cls.id, teacherUserId: 'stranger' });

    expect(res).toEqual({ removed: false });
    expect(classRow(cls.id).is_active).toBe(true);
    expect(activeTeachers(cls.id)).toEqual([TEACHER]);
  });

  it('refuses without a class or a teacher', async () => {
    await expect(svc.removeClassForTeacher({ teacherUserId: TEACHER })).resolves.toEqual({ error: 'missing_class' });
    await expect(svc.removeClassForTeacher({ classId: 'c1' })).resolves.toEqual({ error: 'missing_teacher' });
  });
});

/* ── POST /api/internal/classes/remove ─────────────────────────────────────── */

function invoke(path, { body = {}, key = 'secret' } = {}) {
  const router = require('../../bot/shared/routes/internal-api.routes');
  const layer = router.stack.find((l) => l.route && l.route.path === path && l.route.methods.post);
  if (!layer) throw new Error(`no POST ${path}`);
  const handlers = layer.route.stack.map((s) => s.handle);
  const req = { body, headers: key ? { 'x-api-key': key } : {}, path, ip: '127.0.0.1' };
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      status(c) { this.statusCode = c; return this; },
      json(payload) { resolve({ status: this.statusCode, body: payload }); return this; },
    };
    const run = (i) => {
      if (i >= handlers.length) return resolve({ status: 404, body: null });
      return handlers[i](req, res, () => run(i + 1));
    };
    run(0);
  });
}

describe('POST /api/internal/classes/remove', () => {
  const OLD = process.env.INTERNAL_API_KEY;
  beforeEach(() => { process.env.INTERNAL_API_KEY = 'secret'; });
  afterAll(() => { process.env.INTERNAL_API_KEY = OLD; });

  it('takes the class off her list and says how', async () => {
    const cls = await herClass();
    const out = await invoke('/classes/remove', { body: { userId: TEACHER, classId: cls.id } });

    expect(out).toEqual({ status: 200, body: { success: true, removed: true, how: 'retired' } });
    expect(classRow(cls.id).is_active).toBe(false);
  });

  it('a class she is not on is a success with removed:false (a second tap, a stale page)', async () => {
    const cls = await herClass();
    const out = await invoke('/classes/remove', { body: { userId: 'stranger', classId: cls.id } });

    expect(out).toEqual({ status: 200, body: { success: true, removed: false } });
    expect(classRow(cls.id).is_active).toBe(true);
  });

  it('400 without a user or a class', async () => {
    const out = await invoke('/classes/remove', { body: { userId: TEACHER } });
    expect(out.status).toBe(400);
    expect(out.body.success).toBe(false);
  });

  it('401 without the shared secret, and nothing changes', async () => {
    const cls = await herClass();
    const out = await invoke('/classes/remove', { body: { userId: TEACHER, classId: cls.id }, key: 'nope' });
    expect(out.status).toBe(401);
    expect(classRow(cls.id).is_active).toBe(true);
  });
});
