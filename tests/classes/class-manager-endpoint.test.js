/**
 * Class manager Flow endpoint — screens, language, and the paths that must never
 * dead-end.
 *
 * Runs the real ClassService against the in-memory client, so these are closer to
 * integration tests than unit tests: a screen assertion here fails if the service
 * underneath it changes shape.
 *
 * The invariants worth the most:
 *
 *   - INIT always answers with CLASSES. Meta refuses to OPEN a Flow on a screen
 *     that has incoming routes, so an INIT that returned ADD or SUBJECTS would
 *     strand the teacher with her taps already spent — and the branch most likely
 *     to do it is the "graceful" empty-state one.
 *   - An empty class list is a sentence, not an error.
 *   - An expired in-flight choice sends her back to the start of the add path,
 *     never to a mid-flow screen with no context.
 */

const { createFakeSupabase } = require('../fixtures/fake-supabase');
const flowJson = require('../../docs/flows/class-manager-flow.json');

let mockDb;
jest.mock('../../bot/shared/config/supabase', () => ({
  from: (...args) => mockDb.from(...args),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const TEACHER = 'teacher-uuid-1';
const SCHOOL = 'school-uuid-1';
const OTHER_TEACHER_ID = 'teacher-uuid-9';

const GRADE_ROWS = [
  { code: 'early_years', ordinal: 0, band: 'early_years', aliases: ['early_years'], sort_order: 0, is_active: true },
  { code: 'grade_4', ordinal: 4, band: 'primary', aliases: ['grade_4'], sort_order: 4, is_active: true },
  { code: 'grade_10', ordinal: 10, band: 'high', aliases: ['grade_10'], sort_order: 10, is_active: true },
];
const SUBJECT_ROWS = [
  { code: 'maths', parent_code: null, aliases: ['maths'], is_active: true },
  { code: 'urdu', parent_code: null, aliases: ['urdu'], is_active: true },
];
const SECTION_ROWS = [
  { code: 'A', sort_order: 1, is_active: true },
  { code: 'B', sort_order: 2, is_active: true },
];
const SHIFT_ROWS = [
  { code: 'morning', sort_order: 1, is_active: true },
  { code: 'evening', sort_order: 2, is_active: true },
];
const SESSION_ROWS = [
  { code: '2025-2026', kind: 'annual', starts_on: '2025-08-01', ends_on: '2026-07-31', is_active: true },
  { code: '2026-2027', kind: 'annual', starts_on: '2026-08-01', ends_on: '2027-07-31', is_active: true },
];

let ep;
function boot({ language = 'en', schoolId = SCHOOL, extra = {} } = {}) {
  jest.resetModules();
  mockDb = createFakeSupabase({
    users: [{ id: TEACHER, school_id: schoolId, preferred_language: language }],
    grade_levels: GRADE_ROWS,
    subjects: SUBJECT_ROWS,
    academic_sessions: SESSION_ROWS,
    sections: SECTION_ROWS,
    shifts: SHIFT_ROWS,
    classes: [],
    class_teachers: [],
    class_teacher_subjects: [],
    class_enrollments: [],
    student_lists: [],
    students: [],
    ...extra,
  });
  ep = require('../../bot/shared/routes/class-manager-endpoint');
}

/** Screens with no incoming edges — the only ones a Flow may be OPENED on. */
function entryScreens() {
  const incoming = new Set(Object.values(flowJson.routing_model).flat());
  return flowJson.screens.map((s) => s.id).filter((id) => !incoming.has(id));
}

beforeEach(() => boot());

describe('INIT — the entry screen', () => {
  it('opens on a screen the Flow has no incoming routes to', async () => {
    const res = await ep.handleClassesInit(TEACHER);
    expect(entryScreens()).toContain(res.screen);
  });

  it('opens on CLASSES', async () => {
    await expect(ep.handleClassesInit(TEACHER)).resolves.toMatchObject({ screen: 'CLASSES' });
  });

  it('renders an empty list as a sentence, with the add affordance still offered', async () => {
    const res = await ep.handleClassesInit(TEACHER);
    expect(res.data.summary).toBe('You have not added a class yet.');
    expect(res.data.add_label).toBe('Add a class');
  });

  it('still opens on CLASSES for a teacher with no school on file', async () => {
    // The school check belongs to the caller, but if the Flow is somehow opened
    // anyway it must not fail — it must show the list.
    boot({ schoolId: null });
    await expect(ep.handleClassesInit(TEACHER)).resolves.toMatchObject({ screen: 'CLASSES' });
  });

  it('still opens on CLASSES for an unknown user', async () => {
    await expect(ep.handleClassesInit('nobody')).resolves.toMatchObject({ screen: 'CLASSES' });
  });

  it('lists a class with its grade label, session and subjects', async () => {
    const svc = require('../../bot/shared/services/classes/class.service');
    const { class: cls } = await svc.createClass({
      schoolId: SCHOOL, gradeCode: 'grade_4', section: 'A',
      sessionCode: '2026-2027', teacherUserId: TEACHER,
    });
    await svc.assignTeacher({ classId: cls.id, teacherUserId: TEACHER, subjectCodes: ['maths'] });

    const res = await ep.handleClassesInit(TEACHER);
    expect(res.data.summary).toBe('Grade 4 - A · 2026-2027 · Mathematics');
  });

  it('answers an Urdu teacher in Urdu', async () => {
    boot({ language: 'ur' });
    const res = await ep.handleClassesInit(TEACHER);
    expect(res.data.heading).toBe('آپ کی جماعتیں');
    expect(res.data.add_label).toBe('نئی جماعت شامل کریں');
  });
});

describe('CLASSES → ADD', () => {
  it('offers the grades ordered by ordinal, not alphabetically', async () => {
    const res = await ep.handleClassManagerDataExchange(TEACHER, 'CLASSES', {});
    expect(res.screen).toBe('ADD');
    expect(res.data.grades.map((g) => g.id)).toEqual(['early_years', 'grade_4', 'grade_10']);
  });

  it('labels the grades for the teacher\'s language', async () => {
    boot({ language: 'ur' });
    const res = await ep.handleClassManagerDataExchange(TEACHER, 'CLASSES', {});
    expect(res.data.grades.find((g) => g.id === 'grade_4').title).toBe('جماعت چہارم');
  });
});

describe('ADD → SUBJECTS', () => {
  it('carries the chosen class into the heading', async () => {
    const res = await ep.handleClassManagerDataExchange(TEACHER, 'ADD', { grade: 'grade_4', section: 'a' });
    expect(res.screen).toBe('SUBJECTS');
    expect(res.data.heading).toBe('What do you teach in Grade 4 - A?');
  });

  it('offers only the subjects the catalog and the seed both know', async () => {
    const res = await ep.handleClassManagerDataExchange(TEACHER, 'ADD', { grade: 'grade_4' });
    expect(res.data.subjects.map((s) => s.id).sort()).toEqual(
      ['english', 'general_knowledge', 'maths', 'science', 'social_studies', 'urdu'],
    );
  });

  it('re-asks rather than proceeding with a grade it cannot store', async () => {
    const res = await ep.handleClassManagerDataExchange(TEACHER, 'ADD', { grade: 'grade_99' });
    expect(res.screen).toBe('ADD');
    expect(mockDb._tables.classes).toHaveLength(0);
  });

  it('re-asks when no grade was chosen at all', async () => {
    const res = await ep.handleClassManagerDataExchange(TEACHER, 'ADD', {});
    expect(res.screen).toBe('ADD');
  });
});

describe('SUBJECTS → ADD_STUDENTS', () => {
  it('creates the class, assigns the teacher, and hands her the roster (bd-43483)', async () => {
    await ep.handleClassManagerDataExchange(TEACHER, 'ADD', { grade: 'grade_4', section: 'A' });
    const res = await ep.handleClassManagerDataExchange(TEACHER, 'SUBJECTS', {
      subjects: ['maths'], is_class_teacher: true,
    });

    // Was SAVED (terminal) until bd-43483; the confirmation now rides as the hint
    // on the screen that lets her fill the class she just made.
    expect(res.screen).toBe('ADD_STUDENTS');
    expect(res.data.hint).toBe('Grade 4 - A, 2026-2027.');

    expect(mockDb._tables.classes).toHaveLength(1);
    expect(mockDb._tables.classes[0]).toMatchObject({
      school_id: SCHOOL, grade_code: 'grade_4', section: 'A', session_code: '2026-2027',
    });
    expect(mockDb._tables.class_teachers[0]).toMatchObject({
      teacher_user_id: TEACHER, is_class_teacher: true,
    });
    expect(mockDb._tables.class_teacher_subjects.map((r) => r.subject_code)).toEqual(['maths']);
  });

  it('writes the legacy mirror so attendance can still see the class', async () => {
    await ep.handleClassManagerDataExchange(TEACHER, 'ADD', { grade: 'grade_4', section: 'A' });
    await ep.handleClassManagerDataExchange(TEACHER, 'SUBJECTS', { subjects: [] });

    expect(mockDb._tables.student_lists).toHaveLength(1);
    expect(mockDb._tables.student_lists[0]).toMatchObject({
      user_id: TEACHER, class_name: 'Grade 4 - A', academic_year: '2026-2027',
      class_id: mockDb._tables.classes[0].id,
    });
  });

  it('accepts a class teacher with no subjects selected', async () => {
    await ep.handleClassManagerDataExchange(TEACHER, 'ADD', { grade: 'grade_4' });
    const res = await ep.handleClassManagerDataExchange(TEACHER, 'SUBJECTS', {
      subjects: [], is_class_teacher: true,
    });
    expect(res.screen).toBe('ADD_STUDENTS');
    expect(mockDb._tables.class_teacher_subjects).toHaveLength(0);
  });

  it('sends her back to the ADD form when the in-flight choice has expired', async () => {
    // Straight to SUBJECTS with nothing remembered — the Flow sat open too long.
    const res = await ep.handleClassManagerDataExchange(TEACHER, 'SUBJECTS', { subjects: ['maths'] });
    expect(res.screen).toBe('ADD');
    expect(mockDb._tables.classes).toHaveLength(0);
  });

  it('does not create a class for a teacher with no school, and does not dead-end', async () => {
    boot({ schoolId: null });
    await ep.handleClassManagerDataExchange(TEACHER, 'ADD', { grade: 'grade_4' });
    const res = await ep.handleClassManagerDataExchange(TEACHER, 'SUBJECTS', { subjects: [] });

    expect(mockDb._tables.classes).toHaveLength(0);
    expect(entryScreens()).toContain(res.screen);
  });
});

describe('bd-43483: creating a class leads straight to its students', () => {
  /**
   * The dead-end Hasnat hit on staging (2026-08-18): SUBJECTS returned the
   * terminal SAVED screen and dropped the pending choice, so the class she had
   * just made had no route to a roster. ADD_STUDENTS is only reachable via
   * CLASSES → ROSTER, which meant re-sending /class and picking the class again
   * to do the one thing she was obviously about to do.
   */
  it('lands on ADD_STUDENTS after the class is created, not on the terminal screen', async () => {
    await ep.handleClassManagerDataExchange(TEACHER, 'ADD', { grade: 'grade_4', section: 'A' });
    const res = await ep.handleClassManagerDataExchange(TEACHER, 'SUBJECTS', {
      subjects: ['maths'], is_class_teacher: true,
    });

    expect(res.screen).toBe('ADD_STUDENTS');
    const terminal = flowJson.screens.find((s) => s.terminal).id;
    expect(res.screen).not.toBe(terminal);
    // The class was still really created — chaining must not cost her the save.
    expect(mockDb._tables.classes).toHaveLength(1);
  });

  it('names the class she just made on that screen', async () => {
    await ep.handleClassManagerDataExchange(TEACHER, 'ADD', { grade: 'grade_4', section: 'A' });
    const res = await ep.handleClassManagerDataExchange(TEACHER, 'SUBJECTS', { subjects: [] });

    expect(String(res.data.heading)).toContain('Grade 4 - A');
  });

  it('remembers the new class, so the pasted roster reaches it without re-picking', async () => {
    await ep.handleClassManagerDataExchange(TEACHER, 'ADD', { grade: 'grade_4', section: 'A' });
    await ep.handleClassManagerDataExchange(TEACHER, 'SUBJECTS', { subjects: [] });

    // Straight on to the paste box — no second /class, no re-pick.
    const saved = await ep.handleClassManagerDataExchange(TEACHER, 'ADD_STUDENTS', {
      roster: 'Ayesha Bibi\nBilal Ahmed',
    });

    expect(saved.screen).toBe(flowJson.screens.find((s) => s.terminal).id);
    const created = mockDb._tables.classes[0];
    const enrolled = mockDb._tables.class_enrollments.filter((r) => r.class_id === created.id);
    expect(enrolled).toHaveLength(2);
  });

  it('declares the SUBJECTS → ADD_STUDENTS route, or WhatsApp refuses the hop', async () => {
    expect(flowJson.routing_model.SUBJECTS).toContain('ADD_STUDENTS');
  });
});

describe('normalizeSubjectSelection — Flow payloads are not always arrays', () => {
  it.each([
    [['maths', 'urdu'], ['maths', 'urdu']],
    ['["maths","urdu"]', ['maths', 'urdu']],
    ['maths', ['maths']],
    ['', []],
    [undefined, []],
    [null, []],
    [42, []],
  ])('normalizes %s', (input, expected) => {
    expect(ep.normalizeSubjectSelection(input)).toEqual(expected);
  });

  it('drops a code the subjects catalog does not know', async () => {
    // A stale published Flow asset could still offer a removed subject.
    expect(ep.normalizeSubjectSelection(['maths', 'islamiat'])).toEqual(['maths']);
  });
});

describe('BACK', () => {
  it('returns from SUBJECTS to the ADD form', async () => {
    await expect(ep.handleClassManagerBack(TEACHER, 'SUBJECTS')).resolves.toMatchObject({ screen: 'ADD' });
  });

  it('returns from ADD to the class list', async () => {
    await expect(ep.handleClassManagerBack(TEACHER, 'ADD')).resolves.toMatchObject({ screen: 'CLASSES' });
  });
});

describe('every screen this endpoint returns is declared by the Flow', () => {
  it('matches the Flow JSON', async () => {
    const declared = new Set(flowJson.screens.map((s) => s.id));
    const returned = [
      (await ep.handleClassesInit(TEACHER)).screen,
      (await ep.handleClassManagerDataExchange(TEACHER, 'CLASSES', {})).screen,
      (await ep.handleClassManagerDataExchange(TEACHER, 'ADD', { grade: 'grade_4' })).screen,
      (await ep.handleClassManagerDataExchange(TEACHER, 'SUBJECTS', { subjects: [] })).screen,
      (await ep.handleClassManagerDataExchange(TEACHER, 'NONSENSE', {})).screen,
    ];
    expect(returned.filter((s) => !declared.has(s))).toEqual([]);
  });
});

describe('the ADD screen offers closed vocabularies, not free text', () => {
  it('offers the seeded sections as a picker', async () => {
    // A typed section would now be REFUSED by the database, so the picker is not a
    // nicety — free text here would be an error loop.
    const res = await ep.handleClassManagerDataExchange(TEACHER, 'CLASSES', {});
    expect(res.data.sections.map((s) => s.id)).toEqual(['A', 'B']);
  });

  it('tells her what to do when her section is not listed', async () => {
    const res = await ep.handleClassManagerDataExchange(TEACHER, 'CLASSES', {});
    expect(res.data.section_helper).toMatch(/support/i);
  });

  it('offers both shifts, labelled', async () => {
    const res = await ep.handleClassManagerDataExchange(TEACHER, 'CLASSES', {});
    expect(res.data.shifts).toEqual([
      { id: 'morning', title: 'Morning' },
      { id: 'evening', title: 'Evening' },
    ]);
  });

  it('labels the shifts in Urdu for an Urdu teacher', async () => {
    boot({ language: 'ur' });
    const res = await ep.handleClassManagerDataExchange(TEACHER, 'CLASSES', {});
    expect(res.data.shifts.find((s) => s.id === 'evening').title).toBe('شام');
  });
});

describe('shift reaches the class', () => {
  it('names the evening shift on the subjects heading', async () => {
    const res = await ep.handleClassManagerDataExchange(TEACHER, 'ADD', {
      grade: 'grade_4', section: 'A', shift: 'evening',
    });
    expect(res.data.heading).toBe('What do you teach in Grade 4 - A (Evening)?');
  });

  it('leaves morning unmarked, since it is the default', async () => {
    const res = await ep.handleClassManagerDataExchange(TEACHER, 'ADD', {
      grade: 'grade_4', section: 'A', shift: 'morning',
    });
    expect(res.data.heading).toBe('What do you teach in Grade 4 - A?');
  });

  it('stores the evening shift on the class', async () => {
    await ep.handleClassManagerDataExchange(TEACHER, 'ADD', { grade: 'grade_4', section: 'A', shift: 'evening' });
    await ep.handleClassManagerDataExchange(TEACHER, 'SUBJECTS', { subjects: [] });
    expect(mockDb._tables.classes[0].shift_code).toBe('evening');
  });

  it('falls back to morning when the Flow sends a shift we do not know', async () => {
    // A stale published asset could offer a shift the table has since lost.
    await ep.handleClassManagerDataExchange(TEACHER, 'ADD', { grade: 'grade_4', shift: 'night' });
    await ep.handleClassManagerDataExchange(TEACHER, 'SUBJECTS', { subjects: [] });
    expect(mockDb._tables.classes[0].shift_code).toBe('morning');
  });
});

describe('the confirmation tells the truth when a claim is declined', () => {
  const OTHER = 'teacher-uuid-2';

  async function colleagueAlreadyTeachesMaths() {
    const svc = require('../../bot/shared/services/classes/class.service');
    const { class: cls } = await svc.createClass({
      schoolId: SCHOOL, gradeCode: 'grade_4', section: 'A',
      sessionCode: '2026-2027', teacherUserId: OTHER,
    });
    await svc.assignTeacher({
      classId: cls.id, teacherUserId: OTHER, isClassTeacher: true, subjectCodes: ['maths'],
    });
    return cls;
  }

  it('says the class was saved AND that the subject is taken', async () => {
    await colleagueAlreadyTeachesMaths();
    await ep.handleClassManagerDataExchange(TEACHER, 'ADD', { grade: 'grade_4', section: 'A' });
    const res = await ep.handleClassManagerDataExchange(TEACHER, 'SUBJECTS', { subjects: ['maths'] });

    expect(res.screen).toBe('ADD_STUDENTS');
    // Additive, not a replacement: the class WAS saved, and copy that reads as
    // failure would send her back to create it again.
    expect(res.data.hint).toContain('Grade 4 - A, 2026-2027.');
    expect(res.data.hint).toMatch(/already teaches Mathematics/);
  });

  it('says the class was saved AND that the class-teacher role is taken', async () => {
    await colleagueAlreadyTeachesMaths();
    await ep.handleClassManagerDataExchange(TEACHER, 'ADD', { grade: 'grade_4', section: 'A' });
    const res = await ep.handleClassManagerDataExchange(TEACHER, 'SUBJECTS', {
      subjects: ['urdu'], is_class_teacher: true,
    });

    expect(res.data.hint).toContain('Grade 4 - A, 2026-2027.');
    expect(res.data.hint).toMatch(/already the class teacher/);
  });

  it('still joins her to the class, with the subject that was free', async () => {
    const cls = await colleagueAlreadyTeachesMaths();
    await ep.handleClassManagerDataExchange(TEACHER, 'ADD', { grade: 'grade_4', section: 'A' });
    await ep.handleClassManagerDataExchange(TEACHER, 'SUBJECTS', { subjects: ['maths', 'urdu'] });

    expect(mockDb._tables.classes).toHaveLength(1);
    const mine = mockDb._tables.class_teachers.find((r) => r.teacher_user_id === TEACHER);
    expect(mine).toBeTruthy();
    const hers = mockDb._tables.class_teacher_subjects.filter((r) => r.class_teacher_id === mine.id);
    expect(hers.map((r) => r.subject_code)).toEqual(['urdu']);
  });
});

describe('the class picker', () => {
  const svcOf = () => require('../../bot/shared/services/classes/class.service');

  async function withOneClass() {
    const svc = svcOf();
    const { class: cls } = await svc.createClass({
      schoolId: SCHOOL, gradeCode: 'grade_4', section: 'A',
      sessionCode: '2026-2027', teacherUserId: TEACHER,
    });
    await svc.assignTeacher({ classId: cls.id, teacherUserId: TEACHER, subjectCodes: ['maths'] });
    return cls;
  }

  it('offers her classes, with "add a new one" LAST', async () => {
    // Pick the class you teach; creating one is the fallback, not the front door.
    const cls = await withOneClass();
    const res = await ep.handleClassesInit(TEACHER);
    const ids = res.data.options.map((o) => o.id);
    expect(ids[0]).toBe(cls.id);
    expect(ids[ids.length - 1]).toBe('__add__');
  });

  it('offers only "add a new one" to a teacher with no classes', async () => {
    const res = await ep.handleClassesInit(TEACHER);
    expect(res.data.options.map((o) => o.id)).toEqual(['__add__']);
  });

  it('caps item titles in CODE POINTS, since radio titles are a capped field', async () => {
    const res = await ep.handleClassesInit(TEACHER);
    for (const o of res.data.options) expect([...o.title].length).toBeLessThanOrEqual(30);
  });

  it('goes to the add form when she picks "add a new one"', async () => {
    await withOneClass();
    const res = await ep.handleClassManagerDataExchange(TEACHER, 'CLASSES', { target: '__add__' });
    expect(res.screen).toBe('ADD');
  });

  it('opens the roster when she picks a class', async () => {
    const cls = await withOneClass();
    const res = await ep.handleClassManagerDataExchange(TEACHER, 'CLASSES', { target: cls.id });
    expect(res.screen).toBe('ROSTER');
    expect(res.data.heading).toBe('Grade 4 - A');
  });

  it('refuses a class id she is not assigned to — the picker is not authorisation', async () => {
    const svc = svcOf();
    // grade_10, because this file's fixture seeds early_years / grade_4 / grade_10.
    const { class: hers } = await svc.createClass({
      schoolId: SCHOOL, gradeCode: 'grade_10', section: 'B',
      sessionCode: '2026-2027', teacherUserId: OTHER_TEACHER_ID,
    });
    await svc.assignTeacher({ classId: hers.id, teacherUserId: OTHER_TEACHER_ID });

    const res = await ep.handleClassManagerDataExchange(TEACHER, 'CLASSES', { target: hers.id });
    expect(res.screen).toBe('CLASSES');
  });
});

describe('the roster screens', () => {
  const svcOf = () => require('../../bot/shared/services/classes/class.service');

  async function onRoster(students = []) {
    const svc = svcOf();
    const { class: cls } = await svc.createClass({
      schoolId: SCHOOL, gradeCode: 'grade_4', section: 'A',
      sessionCode: '2026-2027', teacherUserId: TEACHER,
    });
    await svc.assignTeacher({ classId: cls.id, teacherUserId: TEACHER, subjectCodes: ['maths'] });
    if (students.length) {
      await svc.addStudents({ classId: cls.id, teacherUserId: TEACHER, rawText: students.join('\n') });
    }
    await ep.handleClassManagerDataExchange(TEACHER, 'CLASSES', { target: cls.id });
    return cls;
  }

  it('says so plainly when the roster is empty', async () => {
    await onRoster();
    const res = await ep.handleClassManagerDataExchange(TEACHER, 'CLASSES', {
      target: mockDb._tables.classes[0].id,
    });
    expect(res.data.roster).toBe('No students yet.');
  });

  it('lists the children with their roll numbers', async () => {
    await onRoster(['Ayesha Bibi', 'Bilal Ahmed']);
    const res = await ep.handleClassManagerDataExchange(TEACHER, 'CLASSES', {
      target: mockDb._tables.classes[0].id,
    });
    expect(res.data.roster).toBe('1. Ayesha Bibi\n2. Bilal Ahmed');
  });

  it('goes to the paste box', async () => {
    await onRoster();
    const res = await ep.handleClassManagerDataExchange(TEACHER, 'ROSTER', { action: 'add' });
    expect(res.screen).toBe('ADD_STUDENTS');
    expect(res.data.heading).toBe('Add students to Grade 4 - A');
  });

  it('adds a pasted register and reports duplicates', async () => {
    await onRoster(['Ayesha Bibi']);
    await ep.handleClassManagerDataExchange(TEACHER, 'ROSTER', { action: 'add' });
    const res = await ep.handleClassManagerDataExchange(TEACHER, 'ADD_STUDENTS', {
      roster: '1. Ayesha Bibi\n2) Bilal Ahmed\n- Fatima Noor',
    });

    expect(res.screen).toBe('SAVED');
    expect(res.data.detail).toContain('2 added to Grade 4 - A.');
    expect(res.data.detail).toContain('1 were already on the roster.');
  });

  it('re-asks rather than saving nothing when the paste is empty', async () => {
    await onRoster();
    await ep.handleClassManagerDataExchange(TEACHER, 'ROSTER', { action: 'add' });
    const res = await ep.handleClassManagerDataExchange(TEACHER, 'ADD_STUDENTS', { roster: '   ' });
    expect(res.screen).toBe('ADD_STUDENTS');
  });

  it('offers the children to remove, and warns it affects colleagues', async () => {
    await onRoster(['Ayesha Bibi', 'Bilal Ahmed']);
    const res = await ep.handleClassManagerDataExchange(TEACHER, 'ROSTER', { action: 'remove' });

    expect(res.screen).toBe('REMOVE_STUDENTS');
    expect(res.data.students.map((s) => s.title)).toEqual(['1. Ayesha Bibi', '2. Bilal Ahmed']);
    expect(res.data.hint).toMatch(/Every teacher on this class/i);
  });

  it('sends her back to the roster instead of a checkbox group with no boxes', async () => {
    // WhatsApp renders an empty CheckboxGroup as a dead screen.
    await onRoster();
    const res = await ep.handleClassManagerDataExchange(TEACHER, 'ROSTER', { action: 'remove' });
    expect(res.screen).toBe('ROSTER');
  });

  it('closes the enrollments she ticked', async () => {
    await onRoster(['Ayesha Bibi', 'Bilal Ahmed']);
    const pick = await ep.handleClassManagerDataExchange(TEACHER, 'ROSTER', { action: 'remove' });
    const first = pick.data.students[0].id;

    const res = await ep.handleClassManagerDataExchange(TEACHER, 'REMOVE_STUDENTS', { remove: [first] });
    expect(res.screen).toBe('SAVED');
    expect(res.data.detail).toContain('1 removed from Grade 4 - A.');

    const closed = mockDb._tables.class_enrollments.find((e) => e.student_id === first);
    expect(closed.is_active).toBe(false);
    expect(closed.outcome).toBe('left');
  });

  it('accepts a checkbox payload sent as a JSON string', async () => {
    await onRoster(['Ayesha Bibi']);
    const pick = await ep.handleClassManagerDataExchange(TEACHER, 'ROSTER', { action: 'remove' });
    const id = pick.data.students[0].id;
    const res = await ep.handleClassManagerDataExchange(TEACHER, 'REMOVE_STUDENTS', {
      remove: JSON.stringify([id]),
    });
    expect(res.data.detail).toContain('1 removed');
  });

  it('BACK from the paste box returns to the roster, not to the top', async () => {
    await onRoster(['Ayesha Bibi']);
    await ep.handleClassManagerDataExchange(TEACHER, 'ROSTER', { action: 'add' });
    const res = await ep.handleClassManagerBack(TEACHER, 'ADD_STUDENTS');
    expect(res.screen).toBe('ROSTER');
  });

  it('every roster screen it can return is declared by the Flow JSON', async () => {
    const declared = new Set(flowJson.screens.map((s) => s.id));
    await onRoster(['Ayesha Bibi']);
    const seen = [
      (await ep.handleClassManagerDataExchange(TEACHER, 'ROSTER', { action: 'add' })).screen,
      (await ep.handleClassManagerDataExchange(TEACHER, 'ADD_STUDENTS', { roster: 'Zara Khan' })).screen,
      (await ep.handleClassManagerDataExchange(TEACHER, 'CLASSES', { target: mockDb._tables.classes[0].id })).screen,
      (await ep.handleClassManagerDataExchange(TEACHER, 'ROSTER', { action: 'remove' })).screen,
      (await ep.handleClassManagerBack(TEACHER, 'REMOVE_STUDENTS')).screen,
    ];
    expect(seen.filter((s) => !declared.has(s))).toEqual([]);
  });
});
