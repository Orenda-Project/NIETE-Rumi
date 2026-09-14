/**
 * Soft delete, as one shared convention rather than a column per feature.
 *
 * The first draft of the Edit-teacher work added `users.merged_into` — a
 * merge-specific column that happened to double as a tombstone. That is the
 * wrong shape: the next feature that needs to retire a row without destroying
 * it invents its own spelling, and "is this row live?" ends up meaning four
 * different things in four places. The schema already shows the drift —
 * `is_active` on 32 tables, `deleted_at` on 10 (all inherited from the migrated
 * source system), plus one-off `superseded_at` and `superseded_by`.
 *
 * So: three columns, the same three everywhere, and one helper that reads and
 * writes them.
 *
 *   deleted_at      WHEN it was retired. NULL = live. The single predicate.
 *   deleted_reason  WHY, as a short machine token ('phone_change_merge').
 *   deleted_by      WHO or WHAT retired it — an actor id, or a process name.
 *
 * `superseded_by` is deliberately NOT part of it: "this row was replaced by
 * that one" is a different fact from "this row is retired", and only some
 * retirements have a successor.
 */

const {
  softDeletePatch,
  restorePatch,
  isDeleted,
  liveOnly,
  SOFT_DELETE_COLUMNS,
} = require('../../bot/shared/utils/soft-delete');

describe('softDeletePatch — the write', () => {
  const NOW = new Date('2026-09-14T12:00:00Z');

  it('stamps all three columns', () => {
    expect(softDeletePatch({ reason: 'phone_change_merge', by: 'u-1', now: NOW })).toEqual({
      deleted_at: '2026-09-14T12:00:00.000Z',
      deleted_reason: 'phone_change_merge',
      deleted_by: 'u-1',
    });
  });

  it('requires a reason — an unexplained tombstone is unauditable', () => {
    // The whole point of soft delete is being able to answer "why is this row
    // dead?" months later.
    expect(() => softDeletePatch({ by: 'u-1', now: NOW })).toThrow(/reason/i);
    expect(() => softDeletePatch({ reason: '  ', by: 'u-1', now: NOW })).toThrow(/reason/i);
  });

  it('accepts a process name as the actor, not just a user id', () => {
    const p = softDeletePatch({ reason: 'duplicate_import', by: 'backfill:schools', now: NOW });
    expect(p.deleted_by).toBe('backfill:schools');
  });

  it('records an unattributed deletion as such rather than silently null', () => {
    expect(softDeletePatch({ reason: 'x', now: NOW }).deleted_by).toBe('unknown');
  });
});

describe('restorePatch — the way back', () => {
  it('clears all three, so a restored row is indistinguishable from never-deleted', () => {
    expect(restorePatch()).toEqual({
      deleted_at: null,
      deleted_reason: null,
      deleted_by: null,
    });
  });
});

describe('isDeleted — the read', () => {
  it('keys on deleted_at alone', () => {
    expect(isDeleted({ deleted_at: '2026-09-14T12:00:00Z' })).toBe(true);
    expect(isDeleted({ deleted_at: null })).toBe(false);
    expect(isDeleted({})).toBe(false);
    expect(isDeleted(null)).toBe(false);
  });

  it('ignores a reason left behind without a timestamp', () => {
    // A half-written tombstone is live until deleted_at says otherwise; the
    // timestamp is the predicate, the rest is explanation.
    expect(isDeleted({ deleted_reason: 'oops', deleted_at: null })).toBe(false);
  });
});

describe('liveOnly — the filter every list should use', () => {
  it('drops retired rows', () => {
    const rows = [
      { id: 'a' },
      { id: 'b', deleted_at: '2026-09-14T12:00:00Z' },
      { id: 'c', deleted_at: null },
    ];
    expect(liveOnly(rows).map((r) => r.id)).toEqual(['a', 'c']);
  });

  it('is safe on a null or non-array input rather than throwing mid-render', () => {
    expect(liveOnly(null)).toEqual([]);
    expect(liveOnly(undefined)).toEqual([]);
  });
});

describe('SOFT_DELETE_COLUMNS', () => {
  it('names the three columns, for select lists and migrations', () => {
    expect(SOFT_DELETE_COLUMNS).toEqual(['deleted_at', 'deleted_reason', 'deleted_by']);
  });
});
