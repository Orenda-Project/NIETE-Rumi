/**
 * Attendance reads the ENROLLMENT system, and falls back to the legacy roster.
 *
 * Operator decision 2026-08-14: `/class` is the primary and only way to manage
 * classes; attendance consumes rosters and never creates them.
 *
 * Membership now lives in `class_enrollments (class_id, student_id, roll_number)`.
 * The legacy location is `students.list_id`. Both exist right now, and on staging
 * they are perfectly disjoint:
 *
 *   3 legacy lists   -> 12/10/14 students, student_lists.class_id NULL
 *   3 /class classes -> 0 students,        student_lists.class_id SET
 *
 * So `student_lists.class_id` is an exact discriminator rather than a guess.
 *
 * The rule locked here is PREFER-THEN-FALL-BACK, not switch:
 *
 *   enrollments for this class  ->  use them
 *   none                        ->  use students.list_id
 *
 * That ordering is what makes the change safe in any sequence. Enrollment is not
 * populated yet and the backfill has not run, so a hard switch would read zero
 * students for every class — including the 29 real students on production whose
 * membership exists ONLY as students.list_id. With the fallback this is correct
 * before, during, and after the backfill, so attendance and the enrollment work
 * do not have to land in a particular order.
 */

const mockSupabase = { from: jest.fn() };
jest.mock('../../bot/shared/config/supabase', () => mockSupabase);
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const router = require('../../bot/shared/services/attendance-router.service');
const marking = require('../../bot/shared/routes/attendance-marking-endpoint');

const LEGACY_LIST = 'list-legacy';
const CLASS_LIST = 'list-classbacked';
const CLASS_ID = 'cls-1';

/**
 * @param {object} p
 * @param {Array} p.lists            student_lists rows (class_id null or set)
 * @param {object} p.legacyStudents   listId -> [{id, student_name, roll_number}]
 * @param {object} p.enrollments      classId -> [{student_id, roll_number}]
 * @param {Array} p.students          the students table (person records)
 * @param {Array} p.classes           canonical classes rows
 */
/**
 * A PostgREST builder is thenable AND chainable — `await q.eq(...)` and
 * `await q.eq(...).limit(1)` both work. The mock has to be both, or a caller that
 * awaits directly gets the builder object and reads `data: undefined`.
 */
function builder(rows) {
  const p = Promise.resolve({ data: rows, error: null });
  p.eq = () => builder(rows);
  p.order = () => builder(rows);
  p.limit = (n) => builder(rows.slice(0, n));
  p.maybeSingle = () => Promise.resolve({ data: rows[0] || null, error: null });
  return p;
}

function db({ lists = [], legacyStudents = {}, enrollments = {}, students = [], classes = [] } = {}) {
  mockSupabase.from.mockImplementation((table) => {
    if (table === 'users') {
      return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { id: 't1', role: 'teacher' }, error: null }) }) }) };
    }

    if (table === 'student_lists') {
      return {
        select: () => ({
          eq: (col, val) => ({
            eq: () => ({ order: () => Promise.resolve({ data: lists, error: null }) }),
            maybeSingle: () => Promise.resolve({ data: lists.find((l) => l.id === val) || null, error: null }),
          }),
        }),
      };
    }

    if (table === 'class_enrollments') {
      return {
        select: () => ({
          eq: (col, val) => builder(col === 'class_id' ? (enrollments[val] || []) : []),
        }),
      };
    }

    if (table === 'students') {
      return {
        select: () => ({
          // legacy path: .eq('list_id', x).eq('is_active', true)[.order()|.limit()]
          eq: (col, val) => builder(col === 'list_id' ? (legacyStudents[val] || []) : []),
          // enrollment path: .in('id', [...])
          in: (col, ids) => builder(students.filter((s) => ids.includes(s.id))),
        }),
      };
    }

    if (table === 'classes') {
      return {
        select: () => ({
          eq: (col, val) => ({
            maybeSingle: () => Promise.resolve({ data: classes.find((c) => c.id === val) || null, error: null }),
          }),
        }),
      };
    }

    return {};
  });
}

beforeEach(() => jest.clearAllMocks());

describe('roster source: prefer enrollments, fall back to legacy', () => {
  it('a legacy list (class_id null) still reads students.list_id', async () => {
    db({
      lists: [{ id: LEGACY_LIST, class_name: '4th', section: 'A', class_id: null }],
      legacyStudents: { [LEGACY_LIST]: [{ id: 's1', student_name: 'Aleeha Noor', roll_number: 1 }] },
    });

    const res = await marking.handleMarkingInit(`t1:student:${LEGACY_LIST}`);

    expect(res.screen).toBe('MARK');
    expect(res.data.roster.map((r) => r.title)).toEqual(['Aleeha Noor']);
  });

  it('a class-backed list reads class_enrollments, not the legacy roster', async () => {
    db({
      lists: [{ id: CLASS_LIST, class_name: 'Grade 11 - B', section: 'B', class_id: CLASS_ID }],
      // A stale legacy row that must be ignored once enrollments exist.
      legacyStudents: { [CLASS_LIST]: [{ id: 'ghost', student_name: 'Ghost Row', roll_number: 99 }] },
      enrollments: { [CLASS_ID]: [{ student_id: 's9', roll_number: 7 }] },
      students: [{ id: 's9', student_name: 'Amna Rafiq' }],
      classes: [{ id: CLASS_ID, grade_code: 'grade_11', section: 'B', shift_code: 'morning' }],
    });

    const res = await marking.handleMarkingInit(`t1:student:${CLASS_LIST}`);

    const titles = res.data.roster.map((r) => r.title);
    expect(titles).toEqual(['Amna Rafiq']);
    expect(titles).not.toContain('Ghost Row');
    expect(res.data.roster[0].description).toMatch(/7/);
  });

  it('a class-backed list with NO enrollments yet falls back to the legacy roster', async () => {
    // The backfill window. A hard switch would read zero here and silently mark
    // a full class present.
    db({
      lists: [{ id: CLASS_LIST, class_name: 'Grade 11 - B', section: 'B', class_id: CLASS_ID }],
      legacyStudents: { [CLASS_LIST]: [{ id: 's1', student_name: 'Danish Iqbal', roll_number: 3 }] },
      enrollments: { [CLASS_ID]: [] },
      classes: [{ id: CLASS_ID, grade_code: 'grade_11', section: 'B', shift_code: 'morning' }],
    });

    const res = await marking.handleMarkingInit(`t1:student:${CLASS_LIST}`);

    expect(res.data.roster.map((r) => r.title)).toEqual(['Danish Iqbal']);
  });

  it('empty in BOTH places is still an empty class, not a blank register', async () => {
    db({
      lists: [{ id: CLASS_LIST, class_name: 'Grade 5 - C', section: 'C', class_id: CLASS_ID }],
      enrollments: { [CLASS_ID]: [] },
      classes: [{ id: CLASS_ID, grade_code: 'grade_5', section: 'C', shift_code: 'morning' }],
    });

    const res = await marking.handleMarkingInit(`t1:student:${CLASS_LIST}`);

    expect(res.screen).toBe('MARK');           // entry screen, per bd-2713
    expect(res.data.roster).toEqual([]);
    expect(JSON.stringify(res.data)).toMatch(/no students/i);
  });
});

describe('the router agrees with the endpoint about who counts', () => {
  it('sees a class-backed roster through enrollments', async () => {
    db({
      lists: [{ id: CLASS_LIST, class_name: 'Grade 11 - B', section: 'B', class_id: CLASS_ID }],
      enrollments: { [CLASS_ID]: [{ student_id: 's9', roll_number: 1 }] },
      students: [{ id: 's9', student_name: 'Amna Rafiq' }],
    });

    const r = await router.route('t1');

    expect(r.action).toBe('MARK_STUDENTS');
  });

  it('offers to add students when a class-backed roster is empty in both places', async () => {
    db({
      lists: [{ id: CLASS_LIST, class_name: 'Grade 5 - C', section: 'C', class_id: CLASS_ID }],
      enrollments: { [CLASS_ID]: [] },
    });

    const r = await router.route('t1');

    expect(r.action).toBe('EMPTY_CLASS');
  });
});

describe('labels for class-backed rosters (bd-2725)', () => {
  it('does not render the section twice', async () => {
    // mirrorLabel() puts the section INTO class_name and the row also stores
    // section, so naive concatenation yields "Grade 11 - B - B".
    db({
      lists: [{ id: CLASS_LIST, class_name: 'Grade 11 - B', section: 'B', class_id: CLASS_ID }],
      enrollments: { [CLASS_ID]: [{ student_id: 's9', roll_number: 1 }] },
      students: [{ id: 's9', student_name: 'Amna Rafiq' }],
      classes: [{ id: CLASS_ID, grade_code: 'grade_11', section: 'B', shift_code: 'morning' }],
    });

    const res = await marking.handleMarkingInit(`t1:student:${CLASS_LIST}`);

    expect(res.data.heading).not.toMatch(/- B - B/);
    expect(res.data.heading).toMatch(/B/);
  });
});
