/**
 * saveRoster passes the run id through — the endpoint half of the P0 contract.
 *
 * The runId is minted once, at PHOTOS, and lives in the flow state; every REVIEW
 * submit for that scan carries the same one. That is the whole idempotency story:
 * the database refuses to apply one run twice, so a second Save press (measured
 * live: three submits in 59s while the first took 24.2s to answer) becomes a
 * harmless replay instead of 97 duplicate children.
 */

let mockImport;
jest.mock('../../bot/shared/services/classes/class.service', () => ({
  importRoster: (...a) => mockImport(...a),
}));
jest.mock('../../bot/shared/services/roster/roster-storage', () => ({
  newRunId: () => 'run-fixed',
  putPage: jest.fn(async () => ({})),
  putManifest: jest.fn(async () => ({})),
}));
jest.mock('../../bot/shared/services/roster/roster-extraction.service', () => ({
  extractPages: jest.fn(async () => ({ students: [], problems: [] })),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn(), rpc: jest.fn() }));

const endpoint = require('../../bot/shared/routes/roster-flow-endpoint');

const STATE = {
  user: { id: 'coach-1' },
  runId: 'run-abc123',
  schoolId: 'school-1',
  schoolName: 'GPS Test',
  gradeCode: 'grade_3',
  section: 'A',
  classTeacherUserId: 'teacher-1',
  rendered: [{ roll_number: '1', student_name: 'Ayesha', father_name: null, parent_phone: null }],
  stored: [],
  extraction: { model: 'test', raw: [], problems: [] },
};

const SCREEN_DATA = { chunk1: '1. Ayesha' };

describe('saveRoster — the endpoint half of the idempotency contract', () => {
  beforeEach(() => { mockImport = jest.fn(); });

  it('passes state.runId into the one writer', async () => {
    mockImport.mockResolvedValue({ classId: 'c1', added: 1, skipped: 0 });
    await endpoint.saveRoster({ ...STATE }, SCREEN_DATA);
    expect(mockImport).toHaveBeenCalledTimes(1);
    expect(mockImport.mock.calls[0][0].runId).toBe('run-abc123');
  });

  it('a save already in progress gets honest copy, not a failure', async () => {
    mockImport.mockResolvedValue({ error: 'save_in_progress' });
    const res = await endpoint.saveRoster({ ...STATE }, SCREEN_DATA);
    const text = JSON.stringify(res);
    expect(text).toMatch(/already being saved/i);
    expect(text).not.toMatch(/could not be saved/i);
  });

  it('a replay reaches the SAVED screen — the coach still gets her confirmation', async () => {
    mockImport.mockResolvedValue({ classId: 'c1', added: 0, skipped: 1, replay: true });
    const res = await endpoint.saveRoster({ ...STATE }, SCREEN_DATA);
    expect(res.screen).toBe('SAVED');
  });
});

describe('saveRoster — identity fields survive the review screen', () => {
  beforeEach(() => { mockImport = jest.fn(); });

  it('admission number and DOB are carried across by roll, like the parent phone', async () => {
    mockImport.mockResolvedValue({ classId: 'c1', added: 1, skipped: 0 });
    const state = {
      ...STATE,
      rendered: [{
        roll_number: '1', student_name: 'Abu Bakar', father_name: 'Arshad Khan',
        parent_phone: '923125185888', admission_no: '4818', date_of_birth: '2014-01-14',
      }],
    };
    await endpoint.saveRoster(state, { chunk1: '1. Abu Bakar / Arshad Khan' });
    const sent = mockImport.mock.calls[0][0].students[0];
    expect(sent.admission_no).toBe('4818');
    expect(sent.date_of_birth).toBe('2014-01-14');
    expect(sent.parent_phone).toBe('923125185888');
  });
});
