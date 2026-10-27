/**
 * bd-37lyd — the WRITE half of "a principal can be the class teacher".
 *
 * `teachersFor` now offers principals on BOTH pickers it feeds: the CLASS screen
 * of a fresh scan, and the CLASS_TEACHER hand-over of a class already saved. The
 * two have DIFFERENT writers:
 *
 *   · the scan save goes through ClassService.importRoster -> assignTeacher, which
 *     has never looked at a role. A principal named there is written today.
 *   · the hand-over goes through ClassService.handOverClass -> the
 *     `roster_hand_over_class` SQL function, which refuses every LEADER_ROLES
 *     entry — principal included — with `not_a_teacher`.
 *
 * So Fix 1 on its own would offer, on the repair screen, someone the repair then
 * refuses. That is worse than hiding them: the coach taps the obvious answer and
 * gets "A coach or principal cannot be named as the class teacher."
 *
 * This pins all three halves of the correction — the SQL, the in-memory twin the
 * suite runs against, and the sentence the coach would have read.
 *
 * NOTE FOR THE DEPLOY: the SQL here is a `CREATE OR REPLACE FUNCTION`. It is NOT
 * applied by merging. Until somebody runs it against the NIETE database, the
 * hand-over path still answers `not_a_teacher` for a principal in production; the
 * scan-save path does not and needs nothing.
 */

const fs = require('fs');
const path = require('path');
const { createFakeSupabase } = require('../fixtures/fake-supabase');

let mockDb;
jest.mock('../../bot/shared/config/supabase', () => ({
  from: (...a) => mockDb.from(...a),
  rpc: (...a) => mockDb.rpc(...a),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const MIGRATION = path.join(
  __dirname, '..', '..', 'bot', 'database', 'migrations', 'roster_hand_over_class.sql',
);
const sql = () => fs.readFileSync(MIGRATION, 'utf8');
/** Comments are stripped: a match on prose about the code is not a match on code. */
const code = () => sql().split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');

const SCHOOL = 'school-1';
const COACH = 'coach-1';
const PRINCIPAL = 'principal-1';
const SESSION = (() => {
  const now = new Date();
  const y = now.getFullYear();
  return now.getMonth() >= 7 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
})();

function seed() {
  return createFakeSupabase({
    schools: [{ id: SCHOOL, name: 'IMSG (I-8/4)' }],
    grade_levels: [{ code: 'grade_3', ordinal: 3, band: 'primary', is_active: true }],
    users: [
      { id: COACH, name: 'Coach One', role: 'coach', school_id: null },
      { id: PRINCIPAL, name: 'Zulfiqar Ali', role: 'principal', school_id: SCHOOL },
    ],
    classes: [{
      id: 'cls-1', school_id: SCHOOL, grade_code: 'grade_3', section: 'B',
      shift_code: 'morning', session_code: SESSION, is_active: true,
    }],
    class_teachers: [],
    student_lists: [{
      id: 'list-coach', user_id: COACH, class_name: 'Grade 3 - B',
      academic_year: SESSION, class_id: 'cls-1', is_active: true, student_count: 2,
    }],
    students: [
      { id: 'st-1', student_name: 'Ayesha', list_id: 'list-coach', is_active: true },
      { id: 'st-2', student_name: 'Minahil', list_id: 'list-coach', is_active: true },
    ],
    class_enrollments: [
      { id: 'e1', class_id: 'cls-1', student_id: 'st-1', roll_number: 1, is_active: true },
      { id: 'e2', class_id: 'cls-1', student_id: 'st-2', roll_number: 2, is_active: true },
    ],
  });
}

describe('handOverClass accepts a principal', () => {
  let ClassService;
  beforeEach(() => {
    jest.resetModules();
    mockDb = seed();
    // eslint-disable-next-line global-require
    ClassService = require('../../bot/shared/services/classes/class.service');
  });

  it('writes the assignment rather than refusing it', async () => {
    const res = await ClassService.handOverClass({
      classId: 'cls-1', schoolId: SCHOOL, teacherUserId: PRINCIPAL, actorUserId: COACH,
    });

    expect(res.error).toBeUndefined();
    expect(mockDb._tables.class_teachers.some(
      (r) => r.class_id === 'cls-1' && r.teacher_user_id === PRINCIPAL
        && r.is_class_teacher && r.is_active,
    )).toBe(true);
  });

  it('gives the principal the attendance mirror, and the children with it', async () => {
    // The whole point of naming somebody: /attendance reads students.list_id.
    await ClassService.handOverClass({
      classId: 'cls-1', schoolId: SCHOOL, teacherUserId: PRINCIPAL, actorUserId: COACH,
    });

    const mine = mockDb._tables.student_lists.find(
      (l) => l.user_id === PRINCIPAL && l.class_id === 'cls-1' && l.is_active,
    );
    expect(mine).toBeTruthy();
    expect(mockDb._tables.students.filter((s) => s.list_id === mine.id)).toHaveLength(2);
  });

  it('still refuses a coach — only the principal moved', async () => {
    const res = await ClassService.handOverClass({
      classId: 'cls-1', schoolId: SCHOOL, teacherUserId: COACH, actorUserId: COACH,
    });
    expect(res.error).toBe('not_a_teacher');
  });
});

describe('the SQL function itself', () => {
  it('no longer lists principal among the roles it refuses', () => {
    const src = code();
    // The guard is still there, for the four roles that cannot teach a class.
    expect(src).toMatch(/'not_a_teacher'/);
    expect(src).toMatch(/'school_leader'/);
    expect(src).toMatch(/'supervisor'/);
    expect(src).toMatch(/'coach'/);
    expect(src).toMatch(/'aeo'/);
    // And principal is not one of them.
    const guard = src.match(/v_role IN \(([^)]*)\)/);
    expect(guard).toBeTruthy();
    expect(guard[1]).not.toMatch(/principal/);
  });

  it('is re-appliable, so the deploy step is one statement', () => {
    expect(code()).toMatch(/CREATE OR REPLACE FUNCTION public\.roster_hand_over_class/);
  });
});

describe('the sentence a coach would have read', () => {
  it('no longer tells them a principal cannot be named', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', '..', 'bot', 'shared', 'routes', 'roster-flow-endpoint.js'),
      'utf8',
    );
    const copy = src.match(/not_a_teacher:\s*'([^']*)'/);
    expect(copy).toBeTruthy();
    expect(copy[1]).not.toMatch(/principal/i);
    expect(copy[1]).toMatch(/coach/i);
  });
});
