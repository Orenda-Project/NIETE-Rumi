/**
 * /class: ROSTER has to render for a class with nobody in it yet. (bd-2731)
 *
 * Production said it plainly. Over seven days on the live deployment, SUBJECTS →
 * ROSTER was attempted seven times and rendered zero times; the teacher got Meta's
 * generic "Something went wrong" each time. Nothing threw and nothing logged at
 * error, because the endpoint had already done its work — the class was created and
 * the teacher assigned before the screen was ever built. Eight classes existed on
 * that deployment and seven held no students, one per failed attempt.
 *
 * The one ROSTER that ever drew was on a class already holding six children, seeded
 * straight into the database. Two further attempts that entered from CLASSES onto an
 * EMPTY class died the same way — so the entry screen is not what separates them.
 * An empty roster is, ten times out of ten.
 *
 * Cause: ROSTER binds a CheckboxGroup's `data-source` to `remove_options`, and
 * `buildRosterScreen` fills that from the roster. A new class yields `[]`, and an
 * empty data-source is not renderable. The catch-22 that fell out of it: you could
 * only add students to a class that already had students.
 *
 * `one-edit-screen.test.js` covered this path and asserted `remove_options` was `[]`
 * for an empty class — reading it as a graceful empty state. It is not one; it is the
 * payload that breaks the screen. That assertion is corrected there, and the real
 * contract is pinned here.
 */

const { createFakeSupabase } = require('../fixtures/fake-supabase');
const flowJson = require('../../docs/flows/class-manager-flow.json');

let mockDb;
jest.mock('../../bot/shared/config/supabase', () => ({ from: (...a) => mockDb.from(...a) }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const TEACHER = 'teacher-uuid-1';
const SCHOOL = 'school-uuid-1';
const CLASS_ID = 'class-uuid-1';

const REF = {
  grade_levels: [{ code: 'grade_4', ordinal: 4, band: 'primary', aliases: ['grade_4'], sort_order: 4, is_active: true }],
  subjects: [{ code: 'maths', parent_code: null, aliases: ['maths'], is_active: true }],
  academic_sessions: [
    { code: '2026-2027', kind: 'annual', starts_on: '2026-08-01', ends_on: '2027-07-31', is_active: true },
  ],
  sections: [{ code: 'A', sort_order: 1, is_active: true }],
  shifts: [{ code: 'morning', sort_order: 1, is_active: true }],
};

const kid = (n, roll) => ({ id: `s${n}`, student_name: `Child ${n}`, roll_number: roll, is_active: true });
const enrolled = (n, roll) => ({
  id: `e${n}`, class_id: CLASS_ID, student_id: `s${n}`, roll_number: roll, is_active: true,
});

let ep;
function boot({ students = [], enrollments = [], withClass = true } = {}) {
  jest.resetModules();
  mockDb = createFakeSupabase({
    users: [{ id: TEACHER, school_id: SCHOOL, preferred_language: 'en' }],
    ...REF,
    classes: withClass ? [{
      id: CLASS_ID, school_id: SCHOOL, grade_code: 'grade_4', section: 'A',
      shift_code: 'morning', session_code: '2026-2027', is_active: true,
    }] : [],
    class_teachers: withClass ? [{
      id: 'ct1', class_id: CLASS_ID, teacher_user_id: TEACHER,
      is_class_teacher: true, is_active: true, ended_on: null,
    }] : [],
    class_teacher_subjects: [],
    class_enrollments: enrollments,
    student_lists: [],
    students,
  });
  ep = require('../../bot/shared/routes/class-manager-endpoint');
}

beforeEach(() => boot());

describe('an empty class still produces a renderable ROSTER', () => {
  it('never emits an empty data-source, whatever the roster holds', async () => {
    const res = await ep.handleClassManagerDataExchange(TEACHER, 'CLASSES', { target: CLASS_ID });

    expect(res.screen).toBe('ROSTER');
    // The defect in one line: `[]` here is what Meta refuses to draw.
    expect(res.data.remove_options.length).toBeGreaterThan(0);
    expect(res.data.has_students).toBe(false);
    // The teacher is still told the class is empty — in the text, not by an absence.
    expect(res.data.roster).toMatch(/no students/i);
  });

  it('marks the placeholder as something no student id could collide with', async () => {
    const res = await ep.handleClassManagerDataExchange(TEACHER, 'CLASSES', { target: CLASS_ID });
    res.data.remove_options.forEach((o) => expect(o.id).toBe(ep.NO_STUDENTS_OPTION.id));
  });

  it('reports has_students once there is somebody to remove', async () => {
    boot({ students: [kid(1, 1), kid(2, 2)], enrollments: [enrolled(1, 1), enrolled(2, 2)] });
    const res = await ep.handleClassManagerDataExchange(TEACHER, 'CLASSES', { target: CLASS_ID });

    expect(res.data.has_students).toBe(true);
    expect(res.data.remove_options.map((o) => o.id)).toEqual(['s1', 's2']);
  });
});

describe('the path that actually failed in production: create, then fill', () => {
  it('creating a class lands on a ROSTER that can be drawn', async () => {
    boot({ withClass: false });

    await ep.handleClassManagerDataExchange(TEACHER, 'ADD', {
      grade: 'grade_4', section: 'A', shift: 'morning',
    });
    const res = await ep.handleClassManagerDataExchange(TEACHER, 'SUBJECTS', {
      subjects: ['maths'], is_class_teacher: true,
    });

    // Creation always chains into ROSTER, and a class one second old is empty by
    // definition — so this is the exact payload that stranded every class made.
    expect(res.screen).toBe('ROSTER');
    expect(res.data.has_students).toBe(false);
    expect(res.data.remove_options.length).toBeGreaterThan(0);
    // The "saved" confirmation still rides along as the hint.
    expect(res.data.hint).toBeTruthy();
  });

  it('lets a teacher add the first students — the catch-22 is gone', async () => {
    boot({ withClass: false });
    await ep.handleClassManagerDataExchange(TEACHER, 'ADD', {
      grade: 'grade_4', section: 'A', shift: 'morning',
    });
    await ep.handleClassManagerDataExchange(TEACHER, 'SUBJECTS', {
      subjects: ['maths'], is_class_teacher: true,
    });

    const res = await ep.handleClassManagerDataExchange(TEACHER, 'ROSTER', {
      add: 'Aleeha Noor\nBilal Hussain', remove: [],
    });

    expect(res.screen).toBe('SAVED');
    expect(mockDb._tables.students.map((s) => s.student_name).sort())
      .toEqual(['Aleeha Noor', 'Bilal Hussain']);
  });
});

describe('the placeholder is inert on the way back', () => {
  it('is not mistaken for a student to remove', async () => {
    boot({ students: [kid(1, 1)], enrollments: [enrolled(1, 1)] });
    await ep.handleClassManagerDataExchange(TEACHER, 'CLASSES', { target: CLASS_ID });

    // The group is hidden when it holds only the placeholder, so this should never
    // arrive — but a Flow already delivered to a handset is a durable artifact and
    // can post back anything at all.
    const res = await ep.handleClassManagerDataExchange(TEACHER, 'ROSTER', {
      remove: [ep.NO_STUDENTS_OPTION.id], add: '',
    });

    expect(res.screen).toBe('SAVED');
    const live = mockDb._tables.class_enrollments.filter((e) => e.is_active);
    expect(live.map((e) => e.student_id)).toEqual(['s1']);
  });
});

describe('the Flow asset has to agree, or none of the above reaches a handset', () => {
  const roster = flowJson.screens.find((s) => s.id === 'ROSTER');

  it('declares has_students on the ROSTER screen', () => {
    expect(roster.data.has_students).toBeDefined();
    expect(roster.data.has_students.type).toBe('boolean');
  });

  it('guards the remove group with it, so an empty group is never drawn', () => {
    const form = roster.layout.children.find((c) => c.type === 'Form');
    const group = form.children.find((c) => c.type === 'CheckboxGroup' && c.name === 'remove');

    expect(group['data-source']).toBe('${data.remove_options}');
    expect(group.visible).toBe('${data.has_students}');
  });

  it('declares every key the endpoint sends — an undeclared one fails just as hard', async () => {
    const res = await ep.handleClassManagerDataExchange(TEACHER, 'CLASSES', { target: CLASS_ID });
    Object.keys(res.data).forEach((key) => expect(Object.keys(roster.data)).toContain(key));
  });
});
