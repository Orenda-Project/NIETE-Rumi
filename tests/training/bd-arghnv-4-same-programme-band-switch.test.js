/**
 * bd-arghnv.4 — a band change that keeps the same training programme is still a change.
 *
 * THE BUG
 * On the portal profile a teacher unticked Middle, ticked High and tapped Save.
 * The app said "Saved", then showed Middle again: nothing had been stored.
 * Ticking High next to Middle did the same.
 *
 * applyBandSelection decided "unchanged" by comparing PROGRAMMES — the
 * teacher_training_assignments it would add or drop. MIDDLE and HIGH both map
 * to niete_middle_high, so a Middle <-> High switch had nothing to add or drop
 * and returned { ok: true, unchanged: true } before the users write.
 *
 * WHAT THIS SUITE PINS
 *   - "unchanged" is decided on the BANDS (order- and case-insensitive), not
 *     the programmes: the same bands again is still a no-op with no stamp.
 *   - different bands, same programmes: training_bands is written WITHOUT
 *     touching training_bands_updated_at. The 48-hour lock protects access
 *     changes; her training does not change, so no new lock starts.
 *   - the cooldown gate still applies first: a same-programme switch while an
 *     earlier real change's lock is running is refused and writes nothing.
 *   - a programme change behaves as before: assignments reconciled, stamped.
 *   - when the users write is the ONLY write and it fails, the save reports a
 *     failure instead of "Saved".
 */

const supabase = require('../../bot/shared/config/supabase');
const { applyBandSelection } =
  require('../../bot/shared/services/training/band-selection.service');

jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));

const UID = 'user-1';
const PRIM_ID = 'prog-primary';
const MH_ID = 'prog-middle-high';
const PROGRAMS = [
  { id: PRIM_ID, key: 'niete_primary' },
  { id: MH_ID, key: 'niete_middle_high' },
];

/** Query-builder double that records every write. `userUpdateError` fails the users update. */
function mockDb({ user, existing, userUpdateError = null }) {
  const calls = { userUpdates: [], inserts: [], deactivated: [] };

  supabase.from.mockImplementation((table) => {
    if (table === 'users') {
      return {
        select: () => ({ eq: () => ({ single: async () => ({ data: user, error: null }) }) }),
        update: (patch) => {
          calls.userUpdates.push(patch);
          return { eq: async () => ({ error: userUpdateError }) };
        },
      };
    }
    if (table === 'training_programs') {
      return {
        select: () => ({
          in: async (_col, keys) => ({ data: PROGRAMS.filter(p => keys.includes(p.key)), error: null }),
        }),
      };
    }
    if (table === 'teacher_training_assignments') {
      return {
        select: () => ({ eq: () => ({ eq: async () => ({ data: existing, error: null }) }) }),
        insert: async (rows) => { calls.inserts.push(...rows); return { error: null }; },
        update: (patch) => ({
          eq: () => ({
            in: async (_col, ids) => { calls.deactivated.push({ patch, ids }); return { error: null }; },
          }),
        }),
      };
    }
    throw new Error('unexpected table ' + table);
  });

  return calls;
}

const THREE_DAYS_AGO = () => new Date(Date.now() - 72 * 3_600_000).toISOString();

beforeEach(() => jest.clearAllMocks());

describe('applyBandSelection — same programme, different bands (bd-arghnv.4)', () => {
  test('Middle -> High stores HIGH and does not stamp training_bands_updated_at', async () => {
    const stamp = THREE_DAYS_AGO();
    const calls = mockDb({
      user: { id: UID, training_bands: ['MIDDLE'], training_bands_updated_at: stamp },
      existing: [{ program_id: MH_ID }],
    });

    const res = await applyBandSelection(UID, ['HIGH']);

    expect(res.ok).toBe(true);
    expect(res.unchanged).toBeFalsy();
    expect(calls.userUpdates).toHaveLength(1);
    expect(calls.userUpdates[0].training_bands).toEqual(['HIGH']);
    // No new 48-hour lock: her access did not change.
    expect(calls.userUpdates[0]).not.toHaveProperty('training_bands_updated_at');
    // Her programme is the same, so no assignment row moves.
    expect(calls.inserts).toEqual([]);
    expect(calls.deactivated).toEqual([]);
  });

  test('ticking High beside Middle stores both, without a stamp', async () => {
    const calls = mockDb({
      user: { id: UID, training_bands: ['MIDDLE'], training_bands_updated_at: null },
      existing: [{ program_id: MH_ID }],
    });

    const res = await applyBandSelection(UID, ['MIDDLE', 'HIGH']);

    expect(res.ok).toBe(true);
    expect(res.unchanged).toBeFalsy();
    expect(calls.userUpdates).toHaveLength(1);
    expect(calls.userUpdates[0].training_bands).toEqual(['MIDDLE', 'HIGH']);
    expect(calls.userUpdates[0]).not.toHaveProperty('training_bands_updated_at');
    expect(calls.inserts).toEqual([]);
    expect(calls.deactivated).toEqual([]);
  });

  test('a teacher with no stored bands whose programme already matches gets her bands stored', async () => {
    // Assigned niete_middle_high by the backfill, training_bands never written.
    // Saving MIDDLE used to be a silent no-op; it must now record her answer.
    const calls = mockDb({
      user: { id: UID, training_bands: null, training_bands_updated_at: null },
      existing: [{ program_id: MH_ID }],
    });

    const res = await applyBandSelection(UID, ['MIDDLE']);

    expect(res.ok).toBe(true);
    expect(calls.userUpdates).toHaveLength(1);
    expect(calls.userUpdates[0].training_bands).toEqual(['MIDDLE']);
    expect(calls.userUpdates[0]).not.toHaveProperty('training_bands_updated_at');
  });

  test('if that users write fails, the save is reported as failed, never "Saved"', async () => {
    // The users row is the ONLY write on this path, so a failure means nothing
    // was stored — exactly the "Saved, then Middle again" the teacher saw.
    mockDb({
      user: { id: UID, training_bands: ['MIDDLE'], training_bands_updated_at: null },
      existing: [{ program_id: MH_ID }],
      userUpdateError: { message: 'boom' },
    });

    const res = await applyBandSelection(UID, ['HIGH']);

    expect(res.ok).toBe(false);
    expect(res.reason).toBe('write_failed');
  });
});

describe('applyBandSelection — the same bands again stays a no-op', () => {
  test('identical bands in another order and case: unchanged, nothing written, no stamp', async () => {
    const calls = mockDb({
      user: { id: UID, training_bands: ['high', 'MIDDLE'], training_bands_updated_at: null },
      existing: [{ program_id: MH_ID }],
    });

    const res = await applyBandSelection(UID, ['MIDDLE', 'HIGH']);

    expect(res.ok).toBe(true);
    expect(res.unchanged).toBe(true);
    expect(calls.userUpdates).toEqual([]);
    expect(calls.inserts).toEqual([]);
    expect(calls.deactivated).toEqual([]);
  });
});

describe('applyBandSelection — the 48-hour lock around a same-programme switch', () => {
  test('a Middle -> High switch inside a running lock is refused and writes nothing', async () => {
    // The gate is checked before any write, as for every other change. The fix
    // only stops a same-programme switch from STARTING a lock.
    const twoHoursAgo = new Date(Date.now() - 2 * 3_600_000).toISOString();
    const calls = mockDb({
      user: { id: UID, training_bands: ['MIDDLE'], training_bands_updated_at: twoHoursAgo },
      existing: [{ program_id: MH_ID }],
    });

    const res = await applyBandSelection(UID, ['HIGH']);

    expect(res.ok).toBe(false);
    expect(res.reason).toBe('cooldown');
    expect(calls.userUpdates).toEqual([]);
  });

  test('a programme change still stamps and reconciles, as before', async () => {
    const now = Date.now();
    const calls = mockDb({
      user: { id: UID, training_bands: ['MIDDLE'], training_bands_updated_at: null },
      existing: [{ program_id: MH_ID }],
    });

    const res = await applyBandSelection(UID, ['PRIMARY'], now);

    expect(res.ok).toBe(true);
    expect(calls.inserts.map(r => r.program_id)).toEqual([PRIM_ID]);
    expect(calls.deactivated[0].ids).toEqual([MH_ID]);
    expect(calls.userUpdates).toHaveLength(1);
    expect(calls.userUpdates[0]).toEqual({
      training_bands: ['PRIMARY'],
      training_bands_updated_at: new Date(now).toISOString(),
    });
  });
});
