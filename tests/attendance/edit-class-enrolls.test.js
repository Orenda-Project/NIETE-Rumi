/**
 * bd-dz6qb.2 — "edit class" must ENROL the child it adds, not just list her.
 *
 * WHAT WAS MEASURED. On ICT production, 4 Sep 2026: 415 active children hold a
 * `students.list_id` and have no `class_enrollments` row at all. `/class` reads
 * enrolments and nothing else, so it cannot see one of them. `/attendance` falls back
 * to the legacy list ONLY when a class has zero enrolments, so in a class that has any,
 * they are invisible there too — 20 children across 18 classes are in exactly that
 * state right now.
 *
 * They are not stale rows. Almost every one was created in the SAME MINUTE as the
 * enrolled cohort of its class (Grade 4-A enrolled 05:36, `Haya Anwar` added 05:36;
 * Grade 3 enrolled 06:14, `Hamid Ali` added 06:15), and two still carry the roll number
 * the paste parser left glued to the name — `12 Kalsoom Bibi`, `20 Syeda Rija Batool`.
 * These are children a teacher typed in seconds after the class was built, and the app
 * dropped them out of both screens.
 *
 * The cause is that this endpoint writes ONE of the two facts. It inserts a `students`
 * row carrying `list_id` and stops. Where the list is class-backed, membership lives in
 * `class_enrollments`, so the add is only half-applied.
 *
 * WHY THE ENROLMENT WRITE GOES THROUGH ClassService. `class_enrollments` already has an
 * owner (root rule 15 / database-engineering §3.6 — one writer per fact) and inlining an
 * insert here would make this the fourth. `ClassService.enrollStudent` is exported for
 * exactly this. Note it is NOT `addStudents`: that one refuses unless the caller is
 * assigned to the class, and this Flow is reached by anyone holding the list — routing
 * through it would turn a half-written add into a silently-written-nothing add.
 *
 * A legacy list with no `class_id` is unchanged: there is no class to enrol into, and
 * inventing one is what /class exists for.
 */

const { createFakeSupabase } = require('../fixtures/fake-supabase');

let mockDb;
jest.mock('../../bot/shared/config/supabase', () => ({
  from: (...args) => mockDb.from(...args),
  rpc: (...args) => mockDb.rpc(...args),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const TEACHER = 'teacher-1';
const CLASS_ID = 'class-1';
const CLASS_LIST = 'list-classbacked';
const LEGACY_LIST = 'list-legacy';

let endpoint;

function setup() {
  jest.resetModules();
  mockDb = createFakeSupabase({
    student_lists: [
      { id: CLASS_LIST, user_id: TEACHER, class_name: 'Grade 4', section: 'A', class_id: CLASS_ID, is_active: true, student_count: 1, academic_year: '2026-2027' },
      { id: LEGACY_LIST, user_id: TEACHER, class_name: 'Grade 9', section: null, class_id: null, is_active: true, student_count: 0, academic_year: '2026-2027' },
    ],
    classes: [{ id: CLASS_ID, school_id: 'school-1', grade_code: 'grade_4', section: 'A', shift_code: 'morning', session_code: '2026-2027', is_active: true }],
    class_teachers: [{ id: 'ct-1', class_id: CLASS_ID, teacher_user_id: TEACHER, is_class_teacher: true, is_active: true }],
    class_enrollments: [{ id: 'ce-1', class_id: CLASS_ID, student_id: 'kid-existing', roll_number: 1, is_active: true }],
    students: [{ id: 'kid-existing', student_name: 'Already Here', roll_number: 1, list_id: CLASS_LIST, is_active: true }],
    class_teacher_subjects: [],
    grade_levels: [{ code: 'grade_4', ordinal: 4, band: 'primary', aliases: ['grade_4'], is_active: true }],
    sections: [{ code: 'A', sort_order: 1, is_active: true }],
    shifts: [{ code: 'morning', sort_order: 1, is_active: true }],
    academic_sessions: [{ code: '2026-2027', kind: 'annual', starts_on: '2026-04-01', ends_on: '2027-03-31', is_active: true }],
    subjects: [],
  });
  endpoint = require('../../bot/shared/routes/edit-class-endpoint');
}

beforeEach(setup);

const table = (name) => mockDb._tables[name];
const addTo = (listId, text) =>
  endpoint.handleEditClassDataExchange(`${TEACHER}:${listId}`, 'ADD', { roster: text });

describe('edit class — adding a child to a class-backed list', () => {
  it('THE BUG: the child is enrolled, not only listed', async () => {
    await addTo(CLASS_LIST, 'Haya Anwar');

    const added = table('students').find((s) => s.student_name === 'Haya Anwar');
    expect(added).toBeDefined();
    expect(added.list_id).toBe(CLASS_LIST);

    const enrolment = table('class_enrollments')
      .find((e) => e.student_id === added.id && e.class_id === CLASS_ID && e.is_active);
    expect(enrolment).toBeDefined();
  });

  it('every child of a multi-name paste is enrolled, not just the first', async () => {
    await addTo(CLASS_LIST, 'Haya Anwar\nMazhar Ali\nIbrar');

    const ids = table('students')
      .filter((s) => ['Haya Anwar', 'Mazhar Ali', 'Ibrar'].includes(s.student_name))
      .map((s) => s.id);
    expect(ids).toHaveLength(3);

    const enrolled = table('class_enrollments')
      .filter((e) => ids.includes(e.student_id) && e.is_active);
    expect(enrolled).toHaveLength(3);
  });

  it('she is visible to /class, which reads enrolments and nothing else', async () => {
    await addTo(CLASS_LIST, 'Haya Anwar');
    const ClassService = require('../../bot/shared/services/classes/class.service');
    const roster = await ClassService.listStudents({ classId: CLASS_ID, teacherUserId: TEACHER });
    expect(roster.map((s) => s.studentName)).toContain('Haya Anwar');
  });

  it('a name already on the roster is still skipped, and enrols nobody twice', async () => {
    await addTo(CLASS_LIST, 'Already Here');
    expect(table('students').filter((s) => s.student_name === 'Already Here')).toHaveLength(1);
    expect(table('class_enrollments').filter((e) => e.student_id === 'kid-existing' && e.is_active))
      .toHaveLength(1);
  });

  it('a legacy list with no class is untouched — listed only, exactly as before', async () => {
    await addTo(LEGACY_LIST, 'Solo Child');
    const added = table('students').find((s) => s.student_name === 'Solo Child');
    expect(added).toBeDefined();
    expect(added.list_id).toBe(LEGACY_LIST);
    expect(table('class_enrollments').filter((e) => e.student_id === added.id)).toHaveLength(0);
  });
});
