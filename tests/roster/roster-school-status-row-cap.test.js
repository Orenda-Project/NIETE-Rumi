/**
 * bd-p3bs1 — /roster school status must not lose a class to PostgREST's row cap.
 *
 * gradeCoverage() counted a school's children by READING every active enrolment
 * row for every class and tallying them in JS. PostgREST answers at most 1,000
 * rows and says nothing about the ones it dropped, so past 1,000 enrolments the
 * per-class counts come from an arbitrary truncated slice: a class whose rows
 * fall in the discarded tail counts 0, is filtered out by the `> 0` test, and
 * disappears from BOTH the status list and the open-roster actions. The coach is
 * told the grade is unscanned and has no way to open the roster she already made.
 *
 * Measured on NIETE prod 2026-09-08: school 'ICG, F-6/2' holds 1,060 active
 * enrolments across 24 classes. Grade 3-E's 41 children read as 0 and the class
 * vanished; Grade 2-D showed 23 of its 42. This fixture reproduces that shape
 * exactly — 977 filler rows, then 42, then 41 — against a fake client that
 * applies the same 1,000-row cap the real server does.
 */

const { createFakeSupabase } = require('../fixtures/fake-supabase');

let mockDb;
jest.mock('../../bot/shared/config/supabase', () => ({
  from: (...a) => mockDb.from(...a),
  rpc: (...a) => mockDb.rpc(...a),
}));
jest.mock('../../bot/shared/services/classes/class.service', () => ({
  importRoster: jest.fn(), applyRosterEdits: jest.fn(),
}));
jest.mock('../../bot/shared/services/roster/roster-storage', () => ({
  newRunId: jest.fn(() => 'run-1'), putPage: jest.fn(async () => ({})), putManifest: jest.fn(async () => ({})),
}));
jest.mock('../../bot/shared/services/roster/roster-extraction.service', () => ({
  extractPages: jest.fn(async () => ({ students: [], problems: [] })),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const SCHOOL = 'school-big';
const COACH = { id: 'coach-1' };

/** The live shape: 24 classes, 1,060 active enrolments, the last class in the tail. */
function seedBigSchool() {
  const classes = [];
  const class_enrollments = [];
  let n = 0;
  const enrol = (classId, count) => {
    for (let i = 0; i < count; i += 1) {
      n += 1;
      class_enrollments.push({
        id: `e${n}`, class_id: classId, student_id: `st${n}`, roll_number: i + 1, is_active: true,
      });
    }
  };

  // 22 filler classes carrying 977 children between them — everything below the cap.
  const fillerSections = ['A', 'B', 'C', 'D', 'E'];
  let placed = 0;
  for (let g = 1; g <= 5 && classes.length < 22; g += 1) {
    for (const s of fillerSections) {
      if (classes.length >= 22) break;
      if (g === 2 && s === 'D') continue;   // reserved for the straddling class
      if (g === 3 && s === 'E') continue;   // reserved for the vanishing class
      const id = `cls-${g}${s}`;
      classes.push({ id, school_id: SCHOOL, grade_code: `grade_${g}`, section: s, is_active: true });
      const take = Math.min(45, 977 - placed);
      enrol(id, take);
      placed += take;
    }
  }
  if (placed < 977) enrol(classes[classes.length - 1].id, 977 - placed);

  // Grade 2-D straddles the cap: 42 children, only 23 of them inside the first 1,000.
  classes.push({ id: 'cls-2D', school_id: SCHOOL, grade_code: 'grade_2', section: 'D', is_active: true });
  enrol('cls-2D', 42);

  // Grade 3-E is entirely in the discarded tail: 41 children, none of them returned.
  classes.push({ id: 'cls-3E', school_id: SCHOOL, grade_code: 'grade_3', section: 'E', is_active: true });
  enrol('cls-3E', 41);

  return createFakeSupabase({
    schools: [{ id: SCHOOL, name: 'ICG, F-6/2' }],
    grade_levels: [1, 2, 3, 4, 5].map((o) => ({ code: `grade_${o}`, ordinal: o, band: 'primary', is_active: true })),
    sections: fillerSections.map((c, i) => ({ code: c, sort_order: i + 1, is_active: true })),
    classes,
    class_enrollments,
    students: [],
    student_lists: [],
    users: [],
    leader_teachers: [],
  });
}

let endpoint;
function boot() {
  jest.resetModules();
  endpoint = require('../../bot/shared/routes/roster-flow-endpoint');
  endpoint._pending.set('u1', { user: COACH, schools: [{ id: SCHOOL, title: 'ICG, F-6/2' }] });
}

beforeEach(() => { mockDb = seedBigSchool(); });

describe('school status at a school past PostgREST\'s 1,000-row cap', () => {
  it('the fixture really is the live shape — 1,060 enrolments, and a raw read is truncated', async () => {
    expect(mockDb._tables.class_enrollments).toHaveLength(1060);
    const ids = mockDb._tables.classes.map((c) => c.id);
    const { data } = await mockDb.from('class_enrollments').select('class_id').in('class_id', ids).eq('is_active', true);
    expect(data).toHaveLength(1000);                       // the cap, silently
    expect(data.filter((r) => r.class_id === 'cls-3E')).toHaveLength(0);   // the whole class is gone
  });

  it('a class whose enrolments fall past the cap is still listed, with its real count', async () => {
    boot();
    const res = await endpoint.handleRosterDataExchange('u1', 'SCHOOL', { school_id: SCHOOL });
    expect(res.screen).toBe('SCHOOL_STATUS');
    expect(res.data.coverage_text).toMatch(/Grade 3-E — 41 children/);
  });

  it('a class straddling the cap shows all 42 of its children, not the 23 inside the slice', async () => {
    boot();
    const res = await endpoint.handleRosterDataExchange('u1', 'SCHOOL', { school_id: SCHOOL });
    expect(res.data.coverage_text).toMatch(/Grade 2-D — 42 children/);
    expect(res.data.coverage_text).not.toMatch(/Grade 2-D — 23 children/);
  });

  it('the coach can still open the roster of the class in the tail', async () => {
    boot();
    const res = await endpoint.handleRosterDataExchange('u1', 'SCHOOL', { school_id: SCHOOL });
    expect(res.data.actions.map((a) => a.id)).toContain('open:cls-3E');
  });
});
