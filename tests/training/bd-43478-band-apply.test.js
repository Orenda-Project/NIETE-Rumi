/**
 * bd-43478 — applyBandSelection: the shared write path for band selection.
 *
 * The bot Flow and the portal both gate on
 * teacher_training_assignments -> training_program_scopes, so ONE write serves
 * both surfaces. This suite pins what that write does.
 *
 * Invariants under test:
 *   - writes users.training_bands, NEVER users.levels (isolation, V1.1.8)
 *   - never touches grades_taught (operator: leave it alone)
 *   - stamps assigned_by='teacher_self_select' so the backfill can tell a
 *     teacher's own statement from a script's inference and skip it
 *   - deactivates programs the teacher dropped, activates ones they added
 *   - idempotent: saving the same selection twice is a no-op on the second run
 *   - enforces the 48h cooldown before writing anything
 */

const supabase = require('../../bot/shared/config/supabase');
const { applyBandSelection, SELF_SELECT_TAG } =
  require('../../bot/shared/services/training/band-selection.service');

jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const UID = 'user-1';
const PRIM_ID = 'prog-primary';
const MH_ID = 'prog-middle-high';

/**
 * Minimal query-builder double. Records every write so assertions can inspect
 * exactly what would hit the database.
 */
function mockDb({ user, programs, existing }) {
  const calls = { userUpdates: [], inserts: [], deactivated: [] };

  supabase.from.mockImplementation((table) => {
    if (table === 'users') {
      return {
        select: () => ({ eq: () => ({ single: async () => ({ data: user, error: null }) }) }),
        update: (patch) => {
          calls.userUpdates.push(patch);
          return { eq: async () => ({ error: null }) };
        },
      };
    }
    if (table === 'training_programs') {
      // Honour the .in('key', keys) filter the way the real query does —
      // returning every program regardless of filter would let a PRIMARY-only
      // selection resolve to both programs.
      return {
        select: () => ({
          in: async (_col, keys) => ({
            data: programs.filter(p => keys.includes(p.key)),
            error: null,
          }),
        }),
      };
    }
    if (table === 'teacher_training_assignments') {
      return {
        select: () => ({ eq: () => ({ eq: async () => ({ data: existing, error: null }) }) }),
        insert: async (rows) => { calls.inserts.push(...rows); return { error: null }; },
        update: (patch) => ({
          eq: () => ({
            in: async (col, ids) => {
              calls.deactivated.push({ patch, ids });
              return { error: null };
            },
          }),
        }),
      };
    }
    throw new Error('unexpected table ' + table);
  });

  return calls;
}

const PROGRAMS = [
  { id: PRIM_ID, key: 'niete_primary' },
  { id: MH_ID, key: 'niete_middle_high' },
];

beforeEach(() => jest.clearAllMocks());

describe('applyBandSelection — the Row 6 fix, end to end', () => {
  test('a Primary-only teacher adding MIDDLE gains niete_middle_high', async () => {
    // Exactly the row 6 teacher: holds niete_primary, needs middle_high so
    // Oxbridge and Beacon House become visible.
    const calls = mockDb({
      user: { id: UID, training_bands: ['PRIMARY'], training_bands_updated_at: null },
      programs: PROGRAMS,
      existing: [{ program_id: PRIM_ID }],
    });

    const res = await applyBandSelection(UID, ['PRIMARY', 'MIDDLE']);

    expect(res.ok).toBe(true);
    expect(calls.inserts).toHaveLength(1);
    expect(calls.inserts[0]).toMatchObject({
      user_id: UID, program_id: MH_ID, is_active: true, assigned_by: SELF_SELECT_TAG,
    });
    // The program she already had is NOT re-inserted (no duplicate rows).
    expect(calls.inserts.map(r => r.program_id)).not.toContain(PRIM_ID);
  });

  test('training_bands is written and users.levels is NOT touched', async () => {
    const calls = mockDb({
      user: { id: UID, training_bands: null, training_bands_updated_at: null },
      programs: PROGRAMS,
      existing: [],
    });

    await applyBandSelection(UID, ['MIDDLE']);

    expect(calls.userUpdates).toHaveLength(1);
    const patch = calls.userUpdates[0];
    expect(patch.training_bands).toEqual(['MIDDLE']);
    expect(patch).toHaveProperty('training_bands_updated_at');
    // The isolation guarantee — if this ever fails, band choice has started
    // leaking into the role-backfill heuristics and any other levels reader.
    expect(patch).not.toHaveProperty('levels');
    expect(patch).not.toHaveProperty('grades_taught');
  });

  test('dropping a band deactivates that program', async () => {
    const calls = mockDb({
      user: { id: UID, training_bands: ['PRIMARY', 'MIDDLE'], training_bands_updated_at: null },
      programs: PROGRAMS,
      existing: [{ program_id: PRIM_ID }, { program_id: MH_ID }],
    });

    await applyBandSelection(UID, ['MIDDLE']);

    expect(calls.deactivated).toHaveLength(1);
    expect(calls.deactivated[0].patch).toMatchObject({ is_active: false });
    expect(calls.deactivated[0].ids).toEqual([PRIM_ID]);
  });

  test('saving the identical selection inserts and deactivates nothing', async () => {
    const calls = mockDb({
      user: { id: UID, training_bands: ['PRIMARY'], training_bands_updated_at: null },
      programs: PROGRAMS,
      existing: [{ program_id: PRIM_ID }],
    });

    const res = await applyBandSelection(UID, ['PRIMARY']);

    expect(res.ok).toBe(true);
    expect(res.unchanged).toBe(true);
    expect(calls.inserts).toEqual([]);
    expect(calls.deactivated).toEqual([]);
  });
});

describe('applyBandSelection — the 48h cooldown gates the write', () => {
  test('a change inside the window writes NOTHING and explains why', async () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 3_600_000).toISOString();
    const calls = mockDb({
      user: { id: UID, training_bands: ['PRIMARY'], training_bands_updated_at: twoHoursAgo },
      programs: PROGRAMS,
      existing: [{ program_id: PRIM_ID }],
    });

    const res = await applyBandSelection(UID, ['PRIMARY', 'MIDDLE']);

    expect(res.ok).toBe(false);
    expect(res.reason).toBe('cooldown');
    expect(res.message).toMatch(/NIETE Support/i);
    expect(calls.inserts).toEqual([]);
    expect(calls.userUpdates).toEqual([]);
    expect(calls.deactivated).toEqual([]);
  });

  test('a first-ever selection is never blocked', async () => {
    const calls = mockDb({
      user: { id: UID, training_bands: null, training_bands_updated_at: null },
      programs: PROGRAMS,
      existing: [],
    });

    const res = await applyBandSelection(UID, ['PRIMARY']);

    expect(res.ok).toBe(true);
    expect(calls.inserts).toHaveLength(1);
  });

  test('a change after the window is allowed', async () => {
    const threeDaysAgo = new Date(Date.now() - 72 * 3_600_000).toISOString();
    const calls = mockDb({
      user: { id: UID, training_bands: ['PRIMARY'], training_bands_updated_at: threeDaysAgo },
      programs: PROGRAMS,
      existing: [{ program_id: PRIM_ID }],
    });

    const res = await applyBandSelection(UID, ['MIDDLE']);

    expect(res.ok).toBe(true);
    expect(calls.inserts).toHaveLength(1);
  });
});

describe('applyBandSelection — refuses to strand a teacher', () => {
  test('an empty selection is rejected, not written as "no access"', async () => {
    const calls = mockDb({
      user: { id: UID, training_bands: ['PRIMARY'], training_bands_updated_at: null },
      programs: PROGRAMS,
      existing: [{ program_id: PRIM_ID }],
    });

    const res = await applyBandSelection(UID, []);

    expect(res.ok).toBe(false);
    expect(res.reason).toBe('empty_selection');
    // Critically: it must not have deactivated her existing program and left
    // her with nothing.
    expect(calls.deactivated).toEqual([]);
    expect(calls.userUpdates).toEqual([]);
  });

  test('a missing user is reported, not silently ignored', async () => {
    mockDb({ user: null, programs: PROGRAMS, existing: [] });
    const res = await applyBandSelection(UID, ['PRIMARY']);
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('user_not_found');
  });
});
