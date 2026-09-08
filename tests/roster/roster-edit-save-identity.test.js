'use strict';
/**
 * THE CORRUPTION REACHES THE DATABASE — bd-a05gc, at the endpoint.
 *
 * roster-identity-not-position.test.js pins reconcile(). This one proves the
 * consequence: saveRosterEdits() hands diff.updated to roster_apply_edits's
 * p_updates (an UPDATE of student_name on an existing row) and diff.removed to
 * p_removes (which CLOSES the enrolment). On an all-roll-less class a single
 * deleted line therefore renamed every child below it and closed the wrong
 * child's enrolment.
 *
 * Only the network boundary is mocked — ClassService, the roster bucket, the
 * Supabase client and the logger. The endpoint's own code runs.
 */

let mockApply;
jest.mock('../../bot/shared/services/classes/class.service', () => ({
  applyRosterEdits: (...a) => mockApply(...a),
}));
jest.mock('../../bot/shared/services/roster/roster-storage', () => ({
  newRunId: () => 'edit-run-fixed',
  putPage: jest.fn(async () => ({})),
  putManifest: jest.fn(async () => ({})),
}));
jest.mock('../../bot/shared/services/roster/roster-extraction.service', () => ({
  extractPages: jest.fn(async () => ({ students: [], problems: [] })),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn(), rpc: jest.fn() }));

const endpoint = require('../../bot/shared/routes/roster-flow-endpoint');
const { toChunks } = require('../../bot/shared/services/roster/roster-lines');

const CLASS = [
  { id: 's1', roll_number: null, student_name: 'Ayesha Noor', father_name: 'Iqbal' },
  { id: 's2', roll_number: null, student_name: 'Bilal Ahmed', father_name: 'Javed' },
  { id: 's3', roll_number: null, student_name: 'Chand Bibi', father_name: 'Kamran' },
  { id: 's4', roll_number: null, student_name: 'Danish Ali', father_name: 'Latif' },
  { id: 's5', roll_number: null, student_name: 'Eman Fatima', father_name: 'Mansoor' },
  { id: 's6', roll_number: null, student_name: 'Farhan Shah', father_name: 'Nadeem' },
];

const stateFor = (roster) => ({
  user: { id: 'coach-1' },
  schoolId: 'school-1',
  schoolName: 'GPS Test',
  editRunId: 'edit-run-1',
  viewClass: { id: 'class-1', label: 'Grade 3 A' },
  viewRoster: roster,
});

/** The six TextArea values the ROSTER_EDIT screen would come back with. */
function screenDataFor(roster, mutate) {
  const lines = toChunks(roster).chunks.filter(Boolean).join('\n').split('\n');
  mutate(lines);
  const data = {};
  // One box is enough for six children; the rest come back empty, as they do live.
  data.chunk1 = lines.join('\n');
  for (let i = 2; i <= 6; i += 1) data[`chunk${i}`] = '';
  return data;
}

describe('saveRosterEdits — a delete removes the child the coach deleted', () => {
  beforeEach(() => { mockApply = jest.fn(async () => ({ updated: 0, moved: 0, added: 0, removed: 1 })); });

  it('closes the deleted child\'s enrolment and renames nobody', async () => {
    const res = await endpoint.saveRosterEdits(
      stateFor(CLASS),
      screenDataFor(CLASS, (lines) => lines.splice(2, 1)), // delete Chand Bibi
    );

    expect(mockApply).toHaveBeenCalledTimes(1);
    const call = mockApply.mock.calls[0][0];
    expect(call.removes).toEqual([{ id: 's3' }]);
    expect(call.updates).toEqual([]);
    expect(call.adds).toEqual([]);
    expect(call.moves).toEqual([]);
    expect(JSON.stringify(res)).toMatch(/1 removed/);
  });

  it('tells the coach when a child could not be matched, and keeps her', async () => {
    const res = await endpoint.saveRosterEdits(
      stateFor(CLASS),
      screenDataFor(CLASS, (lines) => {
        // Two adjacent children replaced by one line nothing resembles.
        lines.splice(2, 2, 'Zubaida Khatoon / Yousaf');
      }),
    );
    const call = mockApply.mock.calls[0][0];
    expect(call.removes).toEqual([]);
    expect(call.adds).toEqual([
      { roll: null, student_name: 'Zubaida Khatoon', father_name: 'Yousaf' },
    ]);
    expect(JSON.stringify(res)).toMatch(/could not tell which line/i);
    expect(JSON.stringify(res)).toMatch(/still on the roster/i);
  });

  it('an untouched roster is still "unchanged" — the common case writes nothing', async () => {
    const res = await endpoint.saveRosterEdits(stateFor(CLASS), screenDataFor(CLASS, () => {}));
    expect(mockApply).not.toHaveBeenCalled();
    expect(JSON.stringify(res)).toMatch(/unchanged/);
  });
});
