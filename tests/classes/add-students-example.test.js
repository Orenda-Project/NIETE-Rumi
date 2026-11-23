/**
 * bd-r2uzg1.18.11 — the Add students box shows a worked example, and the example parses.
 *
 * Teachers did not know how to type their class into the /class Flow's Add students box.
 * Under it sat a rule only ("One name per line. Father's name after a comma or "s/o" …"),
 * with nothing to copy. The box is a Flow TextArea, and a Flow TextArea has no placeholder:
 * its helper-text is the one grey line under it. That line is served live by the endpoint
 * (`add_hint`, bound as `${data.add_hint}` in docs/flows/class-manager-flow.json), so the
 * example can live there without republishing the Flow on Meta.
 *
 * An example is a promise. Whatever it shows, the parser has to read back as one child with
 * a father, or the example teaches a format that silently glues the father into the child's
 * name. So this test takes the example out of the SERVED hint exactly as shown, submits it
 * through the same ROSTER screen a teacher uses, and reads the stored row back.
 */

const { createFakeSupabase } = require('../fixtures/fake-supabase');

let mockDb;
jest.mock('../../bot/shared/config/supabase', () => ({ from: (...a) => mockDb.from(...a) }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const TEACHER = 'teacher-uuid-1';
const SCHOOL = 'school-uuid-1';
const CLASS_ID = 'class-uuid-1';

/** Meta's cap on a Flow TextArea helper-text, in code points. */
const HELPER_TEXT_CAP = 80;

const REF = {
  grade_levels: [{ code: 'grade_4', ordinal: 4, band: 'primary', aliases: ['grade_4'], sort_order: 4, is_active: true }],
  subjects: [{ code: 'maths', parent_code: null, aliases: ['maths'], is_active: true }],
  academic_sessions: [
    { code: '2026-2027', kind: 'annual', starts_on: '2026-08-01', ends_on: '2027-07-31', is_active: true },
  ],
  sections: [{ code: 'A', sort_order: 1, is_active: true }],
  shifts: [{ code: 'morning', sort_order: 1, is_active: true }],
};

let ep;
function boot(language) {
  jest.resetModules();
  mockDb = createFakeSupabase({
    users: [{ id: TEACHER, school_id: SCHOOL, preferred_language: language }],
    ...REF,
    classes: [{
      id: CLASS_ID, school_id: SCHOOL, grade_code: 'grade_4', section: 'A',
      shift_code: 'morning', session_code: '2026-2027', is_active: true,
    }],
    class_teachers: [{
      id: 'ct1', class_id: CLASS_ID, teacher_user_id: TEACHER,
      is_class_teacher: true, is_active: true, ended_on: null,
    }],
    class_teacher_subjects: [],
    class_enrollments: [],
    student_lists: [],
    students: [],
  });
  ep = require('../../bot/shared/routes/class-manager-endpoint');
}

const parse = (text) => require('../../bot/shared/services/student-list.service').parseStudentText(text);

const cp = (s) => [...s].length;
/** Direction marks and isolates are invisible: a teacher never types them. */
const visible = (s) => s.replace(/[‎‏⁦-⁩]/g, '');
/** The words between a child and her father, in either script, plus both commas. */
const SEPARATOR = /(?:^|\s)(?:[sd]\/o|ولد|بنت)(?:\s|$)|[,،]/i;

/** The worked example is everything after the hint's last colon. */
function exampleOf(hint) {
  const at = hint.lastIndexOf(':');
  return at < 0 ? '' : visible(hint.slice(at + 1)).trim();
}

describe.each([
  ['en', /^[\x20-\x7e]+$/],
  // Urdu names in Urdu script: no Latin letter anywhere in the Urdu example.
  ['ur', /^[^A-Za-z]+$/],
])('the Add students box in %s', (language, script) => {
  beforeEach(() => boot(language));

  async function servedHint() {
    const res = await ep.handleClassManagerDataExchange(TEACHER, 'CLASSES', { target: CLASS_ID });
    expect(res.screen).toBe('ROSTER');
    return res.data.add_hint;
  }

  it('fits the helper-text cap', async () => {
    const hint = await servedHint();
    expect(cp(hint)).toBeLessThanOrEqual(HELPER_TEXT_CAP);
  });

  it('shows a worked example of a child with a father, in the teacher\'s own script', async () => {
    const example = exampleOf(await servedHint());
    expect(example).not.toBe('');
    expect(example).toMatch(SEPARATOR);
    expect(example).toMatch(script);
  });

  it('reads the example back, exactly as shown, as one child and her father', async () => {
    const example = exampleOf(await servedHint());
    expect(example).not.toBe('');

    const res = await ep.handleClassManagerDataExchange(TEACHER, 'ROSTER', { add: example, remove: [] });
    expect(res.screen).toBe('SAVED');

    const rows = mockDb._tables.students;
    expect(rows).toHaveLength(1);
    const [{ student_name: child, father_name: father }] = rows;
    expect(child).toBeTruthy();
    expect(father).toBeTruthy();
    // Nothing of the separator is left on either name, and both came from the example.
    expect(child).not.toMatch(SEPARATOR);
    expect(father).not.toMatch(SEPARATOR);
    expect(example.startsWith(child)).toBe(true);
    expect(example.endsWith(father)).toBe(true);
  });
});

describe('a class typed the way the example shows parses as the teacher meant', () => {
  it('English: numbered lines, s/o and d/o, and a child with no father', () => {
    expect(parse('1. Ali Raza s/o Imran Raza\n2. Sana Bibi d/o Tariq Mehmood\n3. Usman Ghani')).toEqual([
      { studentName: 'Ali Raza', fatherName: 'Imran Raza' },
      { studentName: 'Sana Bibi', fatherName: 'Tariq Mehmood' },
      { studentName: 'Usman Ghani', fatherName: null },
    ]);
  });

  it('Urdu: ولد and بنت, as a register writes them', () => {
    expect(parse('1. علی رضا ولد عمران رضا\n2. ثنا بی بی بنت طارق محمود\n3. عثمان غنی')).toEqual([
      { studentName: 'علی رضا', fatherName: 'عمران رضا' },
      { studentName: 'ثنا بی بی', fatherName: 'طارق محمود' },
      { studentName: 'عثمان غنی', fatherName: null },
    ]);
  });

  it('Urdu comma: an Urdu keyboard\'s comma separates the father like an English one', () => {
    expect(parse('علی رضا، عمران رضا')).toEqual([{ studentName: 'علی رضا', fatherName: 'عمران رضا' }]);
  });

  it('a comma AND s/o together (what the old hint read as) leave no comma on the child', () => {
    expect(parse('Ali Raza, s/o Imran Raza')).toEqual([{ studentName: 'Ali Raza', fatherName: 'Imran Raza' }]);
    expect(parse('علی رضا، ولد عمران رضا')).toEqual([{ studentName: 'علی رضا', fatherName: 'عمران رضا' }]);
  });

  it('keeps what already worked', () => {
    expect(parse('Ali Raza, Imran Raza')).toEqual([{ studentName: 'Ali Raza', fatherName: 'Imran Raza' }]);
    expect(parse('Ali Raza, Imran, Raza')).toEqual([{ studentName: 'Ali Raza', fatherName: 'Imran, Raza' }]);
    expect(parse('2) Ali Raza')).toEqual([{ studentName: 'Ali Raza', fatherName: null }]);
    expect(parse('علی رضا')).toEqual([{ studentName: 'علی رضا', fatherName: null }]);
  });
});
