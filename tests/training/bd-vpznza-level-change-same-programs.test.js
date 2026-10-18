/**
 * bd-vpznza — a level change whose PROGRAMMES happen to be unchanged must
 * still write users.teacher_level.
 *
 * THE BUG (production, Supabase ihzciabopbttygxxgrkm)
 * leader_roster_audit carried 330 action='edit_level' rows while
 * record_history — which watches users and is demonstrably live, recording
 * name/school_id/region/language_locked edits continuously — held ZERO rows
 * whose changed_cols contained teacher_level. Coaches were told "Saved" and
 * nothing was saved.
 *
 * WHY
 * MIDDLE and HIGH both map to the single programme niete_middle_high
 * (bandsToPrograms). So a coach moving a teacher between any two band sets
 * that collapse to the same programme set — ['MIDDLE'] -> ['MIDDLE','HIGH'],
 * ['HIGH'] -> ['MIDDLE'], ['PRIMARY','MIDDLE'] -> ['PRIMARY','HIGH'] — leaves
 * toAdd and toDrop both empty. applyBandSelection's early return then exits
 * BEFORE the users.teacher_level write further down, discarding the edit while
 * still returning ok:true. The handler reads ok, writes the audit row, and
 * replies "Saved".
 *
 * THE INTENT THAT MUST SURVIVE
 * The early return exists so that re-saving a genuinely identical selection
 * does not stamp a fresh teacher_level_updated_at and open a spurious 48h
 * cooldown. That is correct and is pinned below. The guard simply asked the
 * wrong question: it tested "are the assignments the same?" when it meant
 * "did anything change at all?".
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

/** Same query-builder double as bd-43478-band-apply, recording every write. */
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
      return {
        select: () => ({
          in: async (_col, keys) => ({
            data: programs.filter((p) => keys.includes(p.key)),
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
            in: async (col, ids) => { calls.deactivated.push({ patch, ids }); return { error: null }; },
          }),
        }),
      };
    }
    throw new Error('unexpected table ' + table);
  });

  return calls;
}

beforeEach(() => jest.clearAllMocks());

describe('bd-vpznza — level changed, programmes identical', () => {
  test('MIDDLE -> MIDDLE+HIGH writes teacher_level even though programmes do not move', async () => {
    // Both selections collapse to niete_middle_high alone, so toAdd/toDrop are
    // empty. The level itself HAS changed and must reach the database.
    const calls = mockDb({
      user: { id: UID, teacher_level: ['MIDDLE'], teacher_level_updated_at: null },
      programs: PROGRAMS,
      existing: [{ program_id: MH_ID }],
    });

    const res = await applyBandSelection(UID, ['MIDDLE', 'HIGH']);

    expect(res.ok).toBe(true);
    // The write the production data proved was never happening.
    expect(calls.userUpdates).toHaveLength(1);
    expect(calls.userUpdates[0].teacher_level).toEqual(['MIDDLE', 'HIGH']);
    expect(calls.userUpdates[0]).toHaveProperty('teacher_level_updated_at');
    // A real change must not be reported as a no-op, or the coach-facing
    // handler says "No change" for an edit that did happen.
    expect(res.unchanged).toBeFalsy();
    // Programmes genuinely did not move.
    expect(calls.inserts).toEqual([]);
    expect(calls.deactivated).toEqual([]);
  });

  test('HIGH -> MIDDLE writes teacher_level (same single programme)', async () => {
    const calls = mockDb({
      user: { id: UID, teacher_level: ['HIGH'], teacher_level_updated_at: null },
      programs: PROGRAMS,
      existing: [{ program_id: MH_ID }],
    });

    const res = await applyBandSelection(UID, ['MIDDLE']);

    expect(res.ok).toBe(true);
    expect(calls.userUpdates).toHaveLength(1);
    expect(calls.userUpdates[0].teacher_level).toEqual(['MIDDLE']);
  });

  test('PRIMARY+MIDDLE -> PRIMARY+HIGH writes teacher_level (both programmes stay)', async () => {
    const calls = mockDb({
      user: { id: UID, teacher_level: ['PRIMARY', 'MIDDLE'], teacher_level_updated_at: null },
      programs: PROGRAMS,
      existing: [{ program_id: PRIM_ID }, { program_id: MH_ID }],
    });

    const res = await applyBandSelection(UID, ['PRIMARY', 'HIGH']);

    expect(res.ok).toBe(true);
    expect(calls.userUpdates).toHaveLength(1);
    expect(calls.userUpdates[0].teacher_level).toEqual(['PRIMARY', 'HIGH']);
  });
});

describe('bd-vpznza — the cooldown intent the early return protects', () => {
  test('re-saving a genuinely identical selection still stamps NOTHING', async () => {
    // This is why the early return exists. Re-saving the same thing must not
    // open a spurious 48h cooldown, so no users.update may be issued.
    const calls = mockDb({
      user: { id: UID, teacher_level: ['MIDDLE'], teacher_level_updated_at: null },
      programs: PROGRAMS,
      existing: [{ program_id: MH_ID }],
    });

    const res = await applyBandSelection(UID, ['MIDDLE']);

    expect(res.ok).toBe(true);
    expect(res.unchanged).toBe(true);
    expect(calls.userUpdates).toEqual([]);
    expect(calls.inserts).toEqual([]);
    expect(calls.deactivated).toEqual([]);
  });

  test('order and case noise is not a change', async () => {
    // normalizeBands upper-cases and de-dupes; a differently ordered or
    // differently cased repeat of the same set is still the same set.
    const calls = mockDb({
      user: { id: UID, teacher_level: ['MIDDLE', 'HIGH'], teacher_level_updated_at: null },
      programs: PROGRAMS,
      existing: [{ program_id: MH_ID }],
    });

    const res = await applyBandSelection(UID, ['high', 'middle']);

    expect(res.unchanged).toBe(true);
    expect(calls.userUpdates).toEqual([]);
  });

  test('a null stored level with a real selection is a change, not a no-op', async () => {
    // A teacher who has never had a level set must get one written even if the
    // programme row already exists (seeded by an import or backfill).
    const calls = mockDb({
      user: { id: UID, teacher_level: null, teacher_level_updated_at: null },
      programs: PROGRAMS,
      existing: [{ program_id: MH_ID }],
    });

    const res = await applyBandSelection(UID, ['MIDDLE']);

    expect(res.ok).toBe(true);
    expect(calls.userUpdates).toHaveLength(1);
    expect(calls.userUpdates[0].teacher_level).toEqual(['MIDDLE']);
  });
});
