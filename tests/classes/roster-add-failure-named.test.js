/**
 * /class ROSTER save: a paste that did not land must never read as "Nothing changed".
 *
 * Live sandbox: a second paste lost its race on the roll index, addStudents returned
 * { error, added: 0 }, and the endpoint, finding nothing to report, put
 * classNoChanges on the SAVED screen. The teacher was told nothing changed while
 * their children were dropped. The screen must name what did not land, in their
 * language, on the existing SAVED fields (heading, detail, done_label).
 */

const { createFakeSupabase } = require('../fixtures/fake-supabase');
const flowJson = require('../../docs/flows/class-manager-flow.json');

let mockDb;
jest.mock('../../bot/shared/config/supabase', () => ({ from: (...a) => mockDb.from(...a) }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const TEACHER = 'teacher-uuid-1';
const SCHOOL = 'school-uuid-1';
const CLASS_ID = 'class-uuid-1';
const PASTE = ['Bano Testwala', 'Bilal Testwala', 'Bushra Testwala'].join('\n');

/** Every enrolment insert is refused, as a roll clash that never clears would be. */
function refusingDb(seed) {
  const real = createFakeSupabase(seed);
  const from = (name) => {
    const b = real.from(name);
    if (name !== 'class_enrollments') return b;
    let inserting = false;
    const origInsert = b.insert;
    const origSingle = b.single;
    b.insert = (p) => { inserting = true; return origInsert.call(b, p); };
    b.single = async () => {
      if (!inserting) return origSingle.call(b);
      return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "idx_enrollments_class_roll"' } };
    };
    return b;
  };
  return { ...real, from };
}

let ep;
let ux;
function boot(language) {
  jest.resetModules();
  mockDb = refusingDb({
    users: [{ id: TEACHER, school_id: SCHOOL, preferred_language: language }],
    grade_levels: [{ code: 'grade_4', ordinal: 4, band: 'primary', aliases: ['grade_4'], sort_order: 4, is_active: true }],
    subjects: [{ code: 'maths', parent_code: null, aliases: ['maths'], is_active: true }],
    academic_sessions: [{ code: '2026-2027', kind: 'annual', starts_on: '2026-08-01', ends_on: '2027-07-31', is_active: true }],
    sections: [{ code: 'A', sort_order: 1, is_active: true }],
    shifts: [{ code: 'morning', sort_order: 1, is_active: true }],
    classes: [{
      id: CLASS_ID, school_id: SCHOOL, grade_code: 'grade_4', section: 'A',
      shift_code: 'morning', session_code: '2026-2027', is_active: true,
    }],
    class_teachers: [{
      id: 'ct1', class_id: CLASS_ID, teacher_user_id: TEACHER, is_class_teacher: true, is_active: true, ended_on: null,
    }],
    class_teacher_subjects: [],
    class_enrollments: [],
    student_lists: [],
    students: [],
  });
  ep = require('../../bot/shared/routes/class-manager-endpoint');
  ux = require('../../bot/shared/config/ux-strings');
}

async function saveRoster(language) {
  boot(language);
  await ep.handleClassManagerDataExchange(TEACHER, 'CLASSES', { target: CLASS_ID });
  return ep.handleClassManagerDataExchange(TEACHER, 'ROSTER', { add: PASTE });
}

describe.each(['en', 'ur'])('a paste that could not be added (%s)', (language) => {
  it('lands on SAVED with only the fields the Flow declares', async () => {
    const res = await saveRoster(language);
    expect(res.screen).toBe('SAVED');
    const declared = Object.keys(flowJson.screens.find((s) => s.id === 'SAVED').data).sort();
    expect(Object.keys(res.data).sort()).toEqual(declared);
  });

  it('names how many were not added, never "nothing changed"', async () => {
    const res = await saveRoster(language);
    const pieces = (tpl) => tpl.split(/\{\w+\}/).map((x) => x.trim()).filter((x) => x.length > 3);
    for (const p of pieces(ux.UX_STRINGS.classNoChanges[language])) expect(res.data.detail).not.toContain(p);
    for (const p of pieces(ux.UX_STRINGS.classStudentsNotAdded[language])) expect(res.data.detail).toContain(p);
    expect(res.data.detail).toContain('3');
    expect(res.data.heading).not.toBe(ux.resolveUx('classSavedHeading', { language }));
    expect(res.data.heading).toBe(ux.resolveUx('classStudentsNotAddedHeading', { language }));
  });
});
