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

const GRADE_ROWS = [
  { code: 'early_years', ordinal: 0, band: 'early_years', aliases: ['early_years'], sort_order: 0, is_active: true },
  { code: 'grade_4', ordinal: 4, band: 'primary', aliases: ['grade_4'], sort_order: 4, is_active: true },
  { code: 'grade_10', ordinal: 10, band: 'high', aliases: ['grade_10'], sort_order: 10, is_active: true },
];
const SUBJECT_ROWS = [
  { code: 'maths', parent_code: null, aliases: ['maths'], is_active: true },
  { code: 'urdu', parent_code: null, aliases: ['urdu'], is_active: true },
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

describe('SUBJECTS → SAVED', () => {
  it('creates the class, assigns the teacher, and lands on the terminal screen', async () => {
    await ep.handleClassManagerDataExchange(TEACHER, 'ADD', { grade: 'grade_4', section: 'A' });
    const res = await ep.handleClassManagerDataExchange(TEACHER, 'SUBJECTS', {
      subjects: ['maths'], is_class_teacher: true,
    });

    const terminal = flowJson.screens.find((s) => s.terminal).id;
    expect(res.screen).toBe(terminal);
    expect(res.data.detail).toBe('Grade 4 - A, 2026-2027.');

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
      user_id: TEACHER, class_name: 'Grade 4', academic_year: '2026-2027',
      class_id: mockDb._tables.classes[0].id,
    });
  });

  it('accepts a class teacher with no subjects selected', async () => {
    await ep.handleClassManagerDataExchange(TEACHER, 'ADD', { grade: 'grade_4' });
    const res = await ep.handleClassManagerDataExchange(TEACHER, 'SUBJECTS', {
      subjects: [], is_class_teacher: true,
    });
    expect(res.screen).toBe('SAVED');
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
