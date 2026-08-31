/**
 * The coach-requested pre-prod journeys, endpoint half.
 *
 * A coach who returns to a school she has scanned must SEE that: which grades of
 * 1-5 are done, which are missing (the completion nudge the operator asked for),
 * and she must be able to open a saved roster, inspect it, and correct it. A
 * school with nothing scanned keeps the old zero-friction path straight to the
 * camera.
 */

const { createFakeSupabase } = require('../fixtures/fake-supabase');

let mockDb;
let mockImport;
let mockApplyEdits;
jest.mock('../../bot/shared/config/supabase', () => ({
  from: (...a) => mockDb.from(...a),
  rpc: (...a) => mockDb.rpc(...a),
}));
jest.mock('../../bot/shared/services/classes/class.service', () => ({
  importRoster: (...a) => mockImport(...a),
  applyRosterEdits: (...a) => mockApplyEdits(...a),
}));
jest.mock('../../bot/shared/services/roster/roster-storage', () => ({
  newRunId: jest.fn(() => 'edit-run-1'),
  putPage: jest.fn(async () => ({})),
  putManifest: jest.fn(async () => ({})),
}));
jest.mock('../../bot/shared/services/roster/roster-extraction.service', () => ({
  extractPages: jest.fn(async () => ({ students: [], problems: [] })),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const SCHOOL = 'school-1';
const COACH = { id: 'coach-1' };

function seed() {
  return createFakeSupabase({
    schools: [{ id: SCHOOL, name: 'IMSG (I-8/4)' }],
    grade_levels: [
      { code: 'grade_1', ordinal: 1, band: 'primary', is_active: true },
      { code: 'grade_2', ordinal: 2, band: 'primary', is_active: true },
      { code: 'grade_3', ordinal: 3, band: 'primary', is_active: true },
      { code: 'grade_4', ordinal: 4, band: 'primary', is_active: true },
      { code: 'grade_5', ordinal: 5, band: 'primary', is_active: true },
    ],
    sections: [{ code: 'A', sort_order: 1, is_active: true }],
    classes: [
      { id: 'cls-1', school_id: SCHOOL, grade_code: 'grade_1', section: 'A', is_active: true },
      { id: 'cls-2', school_id: SCHOOL, grade_code: 'grade_2', section: 'A', is_active: true },
    ],
    class_enrollments: [
      { id: 'e1', class_id: 'cls-1', student_id: 'st-1', roll_number: 1, is_active: true },
      { id: 'e2', class_id: 'cls-1', student_id: 'st-2', roll_number: 2, is_active: true },
      { id: 'e3', class_id: 'cls-2', student_id: 'st-3', roll_number: 1, is_active: true },
    ],
    students: [
      { id: 'st-1', student_name: 'Ayesha', father_name: 'Bilal', is_active: true },
      { id: 'st-2', student_name: 'Minahil', father_name: 'Asif', is_active: true },
      { id: 'st-3', student_name: 'Hooria', father_name: null, is_active: true },
    ],
    student_lists: [],
    users: [],
    leader_teachers: [],
  });
}

let endpoint;
function boot(state) {
  jest.resetModules();
  endpoint = require('../../bot/shared/routes/roster-flow-endpoint');
  endpoint._pending.set('u1', {
    user: COACH, schools: [{ id: SCHOOL, title: 'IMSG (I-8/4)' }], ...state,
  });
}

beforeEach(() => {
  mockDb = seed();
  mockImport = jest.fn();
  mockApplyEdits = jest.fn();
});

describe('SCHOOL submit — status when there is history, camera when there is none', () => {
  it('a school with rosters shows the status screen: done grades, missing grades, 1-5 nudge', async () => {
    boot({});
    const res = await endpoint.handleRosterDataExchange('u1', 'SCHOOL', { school_id: SCHOOL });
    expect(res.screen).toBe('SCHOOL_STATUS');
    expect(res.data.coverage_text).toMatch(/2 of 5/);
    expect(res.data.coverage_text).toMatch(/Grade 1-A — 2 children/);
    expect(res.data.coverage_text).toMatch(/Grade 4 — not yet scanned/);
    const ids = res.data.actions.map((a) => a.id);
    expect(ids).toContain('scan');
    expect(ids).toContain('open:cls-1');
  });

  it('a school with NO rosters goes straight to the camera, as before', async () => {
    boot({});
    mockDb._tables.class_enrollments.length = 0;
    const res = await endpoint.handleRosterDataExchange('u1', 'SCHOOL', { school_id: SCHOOL });
    expect(res.screen).toBe('PHOTOS');
  });
});

describe('SCHOOL_STATUS submit', () => {
  it('scan continues to the camera', async () => {
    boot({ schoolId: SCHOOL, schoolName: 'IMSG (I-8/4)' });
    const res = await endpoint.handleRosterDataExchange('u1', 'SCHOOL_STATUS', { next_action: 'scan' });
    expect(res.screen).toBe('PHOTOS');
  });

  it('open shows the saved roster, read from the database with identities kept', async () => {
    boot({ schoolId: SCHOOL, schoolName: 'IMSG (I-8/4)' });
    const res = await endpoint.handleRosterDataExchange('u1', 'SCHOOL_STATUS', { next_action: 'open:cls-1' });
    expect(res.screen).toBe('ROSTER_VIEW');
    expect(res.data.roster_text).toMatch(/Ayesha/);
    expect(res.data.roster_text).toMatch(/Minahil/);
    expect(res.data.heading).toMatch(/2 children/);
  });
});

describe('ROSTER_VIEW → ROSTER_EDIT → save', () => {
  const VIEW_STATE = {
    schoolId: SCHOOL, schoolName: 'IMSG (I-8/4)',
    viewClass: { id: 'cls-1', label: 'Grade 1-A' },
    viewRoster: [
      { id: 'st-1', roll_number: 1, student_name: 'Ayesha', father_name: 'Bilal' },
      { id: 'st-2', roll_number: 2, student_name: 'Minahil', father_name: 'Asif' },
    ],
  };

  it('edit opens the six-chunk editor pre-filled from the database roster', async () => {
    boot(VIEW_STATE);
    const res = await endpoint.handleRosterDataExchange('u1', 'ROSTER_VIEW', { action: 'edit' });
    expect(res.screen).toBe('ROSTER_EDIT');
    expect(res.data.chunk1).toMatch(/1\. Ayesha \/ Bilal/);
  });

  it('a save applies the reconciled diff through ONE service call carrying the edit run id', async () => {
    mockApplyEdits.mockResolvedValue({ updated: 1, added: 0, removed: 0, moved: 0 });
    boot({ ...VIEW_STATE, editRunId: 'edit-run-1' });
    const res = await endpoint.handleRosterDataExchange('u1', 'ROSTER_EDIT',
      { chunk1: '1. Ayesha Bibi / Bilal\n2. Minahil / Asif' });
    expect(mockApplyEdits).toHaveBeenCalledTimes(1);
    const arg = mockApplyEdits.mock.calls[0][0];
    expect(arg.classId).toBe('cls-1');
    expect(arg.runId).toBe('edit-run-1');
    expect(arg.updates).toEqual([{ id: 'st-1', student_name: 'Ayesha Bibi', father_name: 'Bilal' }]);
    expect(res.screen).toBe('SAVED');
  });

  it('no changes = no write at all, said honestly', async () => {
    boot({ ...VIEW_STATE, editRunId: 'edit-run-1' });
    const res = await endpoint.handleRosterDataExchange('u1', 'ROSTER_EDIT',
      { chunk1: '1. Ayesha / Bilal\n2. Minahil / Asif' });
    expect(mockApplyEdits).not.toHaveBeenCalled();
    expect(res.screen).toBe('SAVED');
    expect(JSON.stringify(res.data)).toMatch(/[Nn]othing.*changed|unchanged/);
  });

  it('the edit confirmation carries the grade 1-5 coverage nudge', async () => {
    mockApplyEdits.mockResolvedValue({ updated: 1, added: 0, removed: 0, moved: 0 });
    boot({ ...VIEW_STATE, editRunId: 'edit-run-1' });
    const res = await endpoint.handleRosterDataExchange('u1', 'ROSTER_EDIT',
      { chunk1: '1. Ayesha Bibi / Bilal\n2. Minahil / Asif' });
    expect(res.data.body).toMatch(/2 of 5 grades/);
  });
});
