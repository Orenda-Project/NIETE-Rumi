/**
 * bd-ff2e9 — one real class, through the real writer.
 *
 * The sibling suite (roster-shift-endpoint.test.js) proves the CLASS payload reaches
 * ClassService. This one lets ClassService actually run — only Supabase is mocked —
 * and replays the real 8 Sep sequence at one ICT school: the teacher registered her
 * evening class at 11:11, the coach scanned the same register at 11:32 and NAMED her
 * as the class teacher, and at 11:36 she opened her class to an empty roster.
 *
 * /roster cannot express a SHIFT, so an evening class is scanned into a
 * second, morning class row and the teacher's own class stays empty.
 *
 * A class's identity is (school, grade, section, shift, session): createClass is
 * idempotent on exactly that tuple (class.service.js:137-155). `/class` lets the
 * teacher pick her shift (class-manager-endpoint.js:462-463). `/roster` collects
 * grade, section and class teacher and nothing else — the word "shift" does not
 * occur once in roster-flow-endpoint.js — so saveRoster calls importRoster with no
 * shiftCode and it takes the parameter default 'morning' (class.service.js:1074).
 *
 * Measured on prod (ihzciabopbttygxxgrkm, 8 Sep 2026, read-only): 11,647 children
 * were created by a scan and 11,356 active enrolments of those children are in a
 * morning class — 100% of them. Not one scanned child sits in any of the 22 evening
 * classes. 13 teachers are standing on an empty twin of their own class today,
 * 374 children on the other side.
 *
 * These tests drive the REAL endpoint path — the CLASS data_exchange that reads the
 * screen payload, and saveRoster which hands it to the one writer. Supabase is mocked
 * at the network boundary; nothing inside roster-flow-endpoint.js is stubbed.
 */

const { createFakeSupabase } = require('../fixtures/fake-supabase');

let mockDb;
let mockImport;
jest.mock('../../bot/shared/config/supabase', () => ({
  from: (...a) => mockDb.from(...a),
  rpc: (...a) => mockDb.rpc(...a),
}));
jest.mock('../../bot/shared/services/roster/roster-storage', () => ({
  newRunId: jest.fn(() => 'run-fixed'),
  putPage: jest.fn(async () => ({})),
  putManifest: jest.fn(async () => ({})),
}));
jest.mock('../../bot/shared/services/roster/roster-extraction.service', () => ({
  extractPages: jest.fn(async () => ({ students: [], problems: [] })),
}));
jest.mock('../../bot/shared/services/roster/roster-media', () => ({
  decryptMedia: jest.fn(async () => ({ data: Buffer.from('x'), fileName: 'p.jpg' })),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const SCHOOL = 'school-1';
const COACH = 'coach-1';
const TEACHER = 'teacher-1';
const SESSION = (() => {
  const now = new Date();
  const y = now.getFullYear();
  return now.getMonth() >= 7 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
})();

const KIDS = [
  { roll_number: '1', student_name: 'M. Ayyan', father_name: null, parent_phone: null },
  { roll_number: '2', student_name: 'Fiza Khan', father_name: null, parent_phone: null },
  { roll_number: '3', student_name: 'Hooria', father_name: null, parent_phone: null },
];
const CHUNK = KIDS.map((k, i) => `${i + 1}. ${k.student_name}`).join('\n');

function seed() {
  return createFakeSupabase({
    schools: [{ id: SCHOOL, name: 'Test School' }],
    grade_levels: [{ code: 'grade_5', ordinal: 5, band: 'primary', aliases: ['grade_5'], is_active: true }],
    academic_sessions: [{
      code: SESSION, kind: 'annual', starts_on: `${SESSION.slice(0, 4)}-04-01`, ends_on: `${SESSION.slice(5)}-03-31`, is_active: true,
    }],
    sections: [
      { code: 'A', sort_order: 1, is_active: true },
      { code: 'B', sort_order: 2, is_active: true },
    ],
    // Both shifts are seeded in prod: shifts = [morning(1), evening(2)], both active.
    shifts: [
      { code: 'morning', sort_order: 1, is_active: true },
      { code: 'evening', sort_order: 2, is_active: true },
    ],
    users: [
      { id: TEACHER, first_name: 'Test', last_name: 'Teacher', role: 'teacher', school_id: SCHOOL },
    ],
    leader_teachers: [],
    subjects: [],
    classes: [],
    class_teachers: [],
    class_teacher_subjects: [],
    class_enrollments: [],
    students: [],
    student_lists: [],
  });
}

// ---------------------------------------------------------------------------
// B. THE OUTCOME — one real class, through the real writer
// ---------------------------------------------------------------------------

describe('a coach scans a register for a class the teacher registered as EVENING', () => {
  let endpoint;
  let svc;

  function boot() {
    jest.resetModules();
    // eslint-disable-next-line global-require
    svc = require('../../bot/shared/services/classes/class.service');
    // eslint-disable-next-line global-require
    endpoint = require('../../bot/shared/routes/roster-flow-endpoint');
    endpoint._pending.set('u1', {
      user: { id: COACH, role: 'coach' },
      schools: [{ id: SCHOOL, title: 'Test School' }],
      schoolId: SCHOOL,
      schoolName: 'Test School',
      runId: 'run-scan-1',
      stored: [],
      extraction: { model: 'test', raw: [], problems: [], students: KIDS },
    });
    return endpoint._pending.get('u1');
  }

  beforeEach(() => { mockDb = seed(); });

  /** 11:11 — what /class does when the teacher adds her own evening class. */
  async function teacherAddsHerEveningClass() {
    const made = await svc.createClass({
      schoolId: SCHOOL,
      gradeCode: 'grade_5',
      section: 'A',
      shiftCode: 'evening',
      sessionCode: SESSION,
      teacherUserId: TEACHER,
    });
    expect(made.error).toBeUndefined();
    await svc.assignTeacher({ classId: made.class.id, teacherUserId: TEACHER, isClassTeacher: true });
    return made.class.id;
  }

  /** 11:32 — what /roster does: CLASS submit, then Save. */
  async function coachScansTheRegister(state) {
    await endpoint.handleRosterDataExchange('u1', 'CLASS', {
      grade_code: 'grade_5', section: 'A', shift_code: 'evening', teacher_user_id: TEACHER,
    });
    return endpoint.saveRoster(state, { chunk1: CHUNK });
  }

  it('the scan lands in HER class, not a second one', async () => {
    const state = boot();
    const hers = await teacherAddsHerEveningClass();
    const res = await coachScansTheRegister(state);

    expect(mockDb._tables.classes.filter((c) => c.is_active)).toHaveLength(1);
    expect(JSON.stringify(res)).toMatch(/3 students are on the roster/);
    expect(mockDb._tables.classes[0].id).toBe(hers);
  });

  it('she sees ONE class, and the children are in it', async () => {
    const state = boot();
    const hers = await teacherAddsHerEveningClass();
    await coachScansTheRegister(state);

    const listed = await svc.listClassesForTeacher(TEACHER);
    expect(listed.map((c) => `${c.gradeCode}-${c.section}-${c.shiftCode}`)).toEqual(['grade_5-A-evening']);

    const roster = await svc.listStudents({ classId: hers, teacherUserId: TEACHER });
    expect(roster.map((s) => s.studentName)).toEqual(['M. Ayyan', 'Fiza Khan', 'Hooria']);
  });

  it('and /attendance offers her one list, with the children on it', async () => {
    const state = boot();
    const hers = await teacherAddsHerEveningClass();
    await coachScansTheRegister(state);

    const mine = mockDb._tables.student_lists.filter((l) => l.user_id === TEACHER && l.is_active);
    expect(mine).toHaveLength(1);
    expect(mine[0].class_id).toBe(hers);
    expect(mockDb._tables.students.filter((s) => s.list_id === mine[0].id)).toHaveLength(3);
  });

  it('a morning class at the same school stays a DIFFERENT class', async () => {
    const state = boot();
    await teacherAddsHerEveningClass();
    await coachScansTheRegister(state);

    // Same grade, same section, other shift — a real second class, not a duplicate.
    endpoint._pending.get('u1').runId = 'run-morning';
    await endpoint.handleRosterDataExchange('u1', 'CLASS', {
      grade_code: 'grade_5', section: 'A', shift_code: 'morning', teacher_user_id: TEACHER,
    });
    await endpoint.saveRoster(state, { chunk1: CHUNK });

    const shifts = mockDb._tables.classes.filter((c) => c.is_active).map((c) => c.shift_code).sort();
    expect(shifts).toEqual(['evening', 'morning']);
  });
});

