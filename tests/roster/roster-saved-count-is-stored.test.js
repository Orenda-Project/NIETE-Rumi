/**
 * bd-37lyd — the SAVED screen reports what is ON the roster, not what was typed.
 *
 * `onRoster = (saved.added || 0) + (saved.skipped || 0)` counts a SKIPPED line as
 * if it had been saved. A skipped line on a RE-SCAN is a child who was already
 * enrolled, so the sum happens to be right; a skipped line on a FRESH class is a
 * line that was NOT stored, and the sum is then an over-count the coach has no
 * way to notice.
 *
 * Proven on prod: a 13 Sep save logged `students: 36, added: 35, skipped: 1` and
 * told the coach 36. Fleet-wide, 32 first-saves carry a `skipped` of 1-3 — 41
 * children reported onto rosters they are not on.
 *
 * The copy was wrong in the same place and for the same reason: ":1391 said the
 * skipped lines "were already there", which on a class created by this very save
 * cannot be true of anything.
 *
 * So: re-READ the stored count (the same `class_enrollments` count the coverage
 * screen trusts), and on a fresh class say plainly that N lines were not saved.
 * Supabase is mocked at the network boundary; the real saveRoster runs.
 */

const { createFakeSupabase } = require('../fixtures/fake-supabase');

let mockDb;
let mockImport;
jest.mock('../../bot/shared/services/classes/class.service', () => ({
  importRoster: (...a) => mockImport(...a),
  applyRosterEdits: jest.fn(),
  handOverClass: jest.fn(),
  normalizeSection: (s) => (s ? String(s).trim().toUpperCase() : null),
}));
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

const endpoint = require('../../bot/shared/routes/roster-flow-endpoint');

const SCHOOL = 'school-1';
const COACH = 'coach-1';
const CLASS = 'c1';

/** 36 lines, exactly the shape of the 13 Sep save. */
const LINES = Array.from({ length: 36 }, (_, i) => `${i + 1}. Child ${i + 1}`).join('\n');

/** `enrolled` active enrolment rows on CLASS — what the register really holds. */
function db(enrolled) {
  mockDb = createFakeSupabase({
    schools: [{ id: SCHOOL, name: 'Test School' }],
    grade_levels: [{ code: 'grade_3', ordinal: 3, band: 'primary', is_active: true }],
    sections: [{ code: 'A', sort_order: 1, is_active: true }],
    shifts: [{ code: 'morning', sort_order: 1, is_active: true }],
    users: [{ id: COACH, role: 'coach', school_id: SCHOOL, name: 'Coach Ali' }],
    leader_teachers: [],
    classes: [{
      id: CLASS, school_id: SCHOOL, grade_code: 'grade_3', section: 'A',
      shift_code: 'morning', session_code: '2026-2027', is_active: true,
    }],
    class_enrollments: Array.from({ length: enrolled }, (_, i) => ({
      id: `e${i}`, class_id: CLASS, student_id: `s${i}`, is_active: true,
    })),
  });
}

function boot() {
  endpoint._pending.set('u1', {
    user: { id: COACH, role: 'coach' },
    schools: [{ id: SCHOOL, title: 'Test School' }],
    schoolId: SCHOOL,
    schoolName: 'Test School',
    runId: 'run-fixed',
    gradeCode: 'grade_3',
    section: 'A',
    shiftCode: 'morning',
    classTeacherUserId: null,
    stored: [],
    rendered: [],
    extraction: { model: 'test', raw: [], problems: [], students: [] },
  });
  return endpoint._pending.get('u1');
}

beforeEach(() => jest.clearAllMocks());

describe('a FRESH class where a line was skipped', () => {
  beforeEach(() => {
    // 36 lines in, 35 rows stored. This is the live 13 Sep shape.
    db(35);
    mockImport = jest.fn().mockResolvedValue({
      classId: CLASS, added: 35, skipped: 1, created: true,
      mirrored: true, classTeacherAssigned: true,
    });
  });

  it('reports the STORED count, not added + skipped', async () => {
    const saved = await endpoint.saveRoster(boot(), { chunk1: LINES });

    expect(saved.screen).toBe('SAVED');
    expect(saved.data.roster_count).toBe('35');
    expect(saved.data.body).toMatch(/\b35\b/);
    // The over-count is what the coach was told for three weeks.
    expect(saved.data.body).not.toMatch(/36 students are on the roster/);
  });

  it('says the skipped line was NOT saved — it cannot have been "already there"', async () => {
    const saved = await endpoint.saveRoster(boot(), { chunk1: LINES });

    expect(saved.data.body).not.toMatch(/already there/);
    expect(saved.data.body).toMatch(/not saved/i);
    expect(saved.data.body).toMatch(/\b1\b/);
  });
});

describe('a RE-SCAN where the children were already enrolled', () => {
  beforeEach(() => {
    db(36);
    mockImport = jest.fn().mockResolvedValue({
      classId: CLASS, added: 0, skipped: 36, created: false,
      mirrored: true, classTeacherAssigned: true,
    });
  });

  it('still reports the whole roster — a re-scan that adds nobody is a confirmation', async () => {
    const saved = await endpoint.saveRoster(boot(), { chunk1: LINES });

    expect(saved.data.roster_count).toBe('36');
    expect(saved.data.body).toMatch(/36/);
  });

  it('keeps the honest wording for a class that already existed', async () => {
    const saved = await endpoint.saveRoster(boot(), { chunk1: LINES });

    expect(saved.data.body).toMatch(/already there/);
    expect(saved.data.body).not.toMatch(/not saved/i);
  });
});

describe('nothing skipped', () => {
  beforeEach(() => {
    db(36);
    mockImport = jest.fn().mockResolvedValue({
      classId: CLASS, added: 36, skipped: 0, created: true,
      mirrored: true, classTeacherAssigned: true,
    });
  });

  it('says the count and nothing about skipping', async () => {
    const saved = await endpoint.saveRoster(boot(), { chunk1: LINES });

    expect(saved.data.roster_count).toBe('36');
    expect(saved.data.body).not.toMatch(/already there/);
    expect(saved.data.body).not.toMatch(/not saved/i);
  });
});

describe('the stored count cannot be read', () => {
  beforeEach(() => {
    db(35);
    mockDb = createFakeSupabase({
      schools: [{ id: SCHOOL, name: 'Test School' }],
      grade_levels: [{ code: 'grade_3', ordinal: 3, band: 'primary', is_active: true }],
      users: [{ id: COACH, role: 'coach', school_id: SCHOOL, name: 'Coach Ali' }],
      classes: [],
      class_enrollments: [],
    }, { failOn: { class_enrollments: 'boom' } });
    mockImport = jest.fn().mockResolvedValue({
      classId: CLASS, added: 35, skipped: 1, created: true,
      mirrored: true, classTeacherAssigned: true,
    });
  });

  it('falls back to the old sum rather than claiming zero children were saved', async () => {
    // A failed count is NOT zero — the same rule enrollmentCounts already follows.
    const saved = await endpoint.saveRoster(boot(), { chunk1: LINES });

    expect(saved.screen).toBe('SAVED');
    expect(saved.data.roster_count).toBe('36');
  });
});
