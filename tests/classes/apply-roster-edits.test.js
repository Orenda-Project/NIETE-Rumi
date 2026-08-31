/**
 * ClassService.applyRosterEdits — the edit half of the one-writer rule.
 *
 * Same discipline as importRoster: the whole mutation is ONE database call,
 * serialized on the SAME per-class advisory lock (so an edit and an import can
 * never interleave on one class), idempotent on the edit-session run id, and a
 * lock timeout surfaces as honest copy, never as a failure.
 */

const { createFakeSupabase } = require('../fixtures/fake-supabase');

let mockDb;
jest.mock('../../bot/shared/config/supabase', () => ({
  from: (...a) => mockDb.from(...a),
  rpc: (...a) => mockDb.rpc(...a),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

let svc;
beforeEach(() => {
  jest.resetModules();
  mockDb = createFakeSupabase({ students: [], class_enrollments: [], student_lists: [] });
  svc = require('../../bot/shared/services/classes/class.service');
});

const CALL = {
  classId: 'cls-1',
  runId: 'edit-run-9',
  editedByUserId: 'coach-1',
  updates: [{ id: 'st-1', student_name: 'Ayesha Bibi', father_name: 'Bilal' }],
  moves: [{ id: 'st-2', roll: '7' }],
  adds: [{ roll: '9', student_name: 'Zainab', father_name: null }],
  removes: [{ id: 'st-3' }],
};

describe('applyRosterEdits', () => {
  it('is ONE rpc call carrying the whole diff and the run id', async () => {
    await svc.applyRosterEdits(CALL);
    const calls = mockDb._rpcCalls.filter((c) => c.name === 'roster_apply_edits');
    expect(calls).toHaveLength(1);
    expect(calls[0].args.p_run_id).toBe('edit-run-9');
    expect(calls[0].args.p_updates).toHaveLength(1);
    expect(calls[0].args.p_moves).toHaveLength(1);
    expect(calls[0].args.p_adds).toHaveLength(1);
    expect(calls[0].args.p_removes).toHaveLength(1);
  });

  it('refuses without a run id', async () => {
    const res = await svc.applyRosterEdits({ ...CALL, runId: null });
    expect(res.error).toBe('missing_run');
  });

  it('a lock timeout maps to save_in_progress', async () => {
    mockDb._failRpc('roster_apply_edits', { code: '55P03', message: 'lock timeout' });
    const res = await svc.applyRosterEdits(CALL);
    expect(res.error).toBe('save_in_progress');
  });
});
