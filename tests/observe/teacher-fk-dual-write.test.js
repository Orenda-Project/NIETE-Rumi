/**
 * Every new observation booking carries teacher_user_id.
 *
 * The backfill gave observation_schedules a real FK, but nothing WRITES it, so
 * every booking made since has landed with NULL. Measured on production this
 * morning, one day after the backfill: 89 null rows, 22 of them `upcoming` —
 * real teachers with live visits booked, invisible to any lookup by identity.
 * Re-running the backfill rescued 35 of them, which is a mop rather than a fix.
 *
 * This is the fix: the FK is written at insert time, beside the phone string.
 *
 * WHY NOT DROP teacher_ext_id IN THE SAME BREATH
 * Both columns are written for now — that is what makes this step safe to ship
 * on its own. Readers still use the text key, so nothing has to change at once;
 * the flip and the drop are separate steps, each revertible.
 */

const {
  buildObservationRecord,
} = require('../../bot/shared/services/observe/observe-who.service');

describe('buildObservationRecord — the FK rides along with the phone', () => {
  const base = {
    leaderUserId: 'leader-1',
    sessionId: 'sess-1',
    today: '2026-09-15',
  };

  it('writes teacher_user_id when the picked teacher carries one', () => {
    const rec = buildObservationRecord({
      ...base,
      teacher: {
        userId: 'user-42',
        teacher_ext_id: '923001234567',
        teacher_name: 'Fatima Rehman',
      },
    });
    expect(rec.teacher_user_id).toBe('user-42');
  });

  it('still writes the phone string — readers have not moved yet', () => {
    const rec = buildObservationRecord({
      ...base,
      teacher: { userId: 'user-42', teacher_ext_id: '923001234567' },
    });
    // Dropping this before the read flip would orphan every existing consumer.
    expect(rec.teacher_ext_id).toBe('923001234567');
  });

  it('accepts the id under either spelling the pickers use', () => {
    // observe-who's stash carries `userId`; the patch resolver shapes rows with
    // `user_id`. Both reach this builder, and a booking must not lose its FK
    // because the caller happened to use the other one.
    expect(buildObservationRecord({
      ...base, teacher: { user_id: 'user-9', teacher_ext_id: '923001234567' },
    }).teacher_user_id).toBe('user-9');
  });

  it('writes NULL rather than a guess when the teacher carries no id', () => {
    // A booking with no resolvable teacher is still a booking; it keeps the
    // phone and the backfill can bind it later. Inventing an id here would be
    // the one failure mode worse than a NULL.
    const rec = buildObservationRecord({
      ...base, teacher: { teacher_ext_id: '923001234567', teacher_name: 'X' },
    });
    expect(rec.teacher_user_id).toBeNull();
    expect(rec.teacher_ext_id).toBe('923001234567');
  });

  it('never writes an empty string as an id', () => {
    // '' would satisfy a NOT NULL check and fail every uuid join silently.
    expect(buildObservationRecord({
      ...base, teacher: { userId: '   ', teacher_ext_id: '923001234567' },
    }).teacher_user_id).toBeNull();
  });

  it('keeps the rest of the record unchanged', () => {
    const rec = buildObservationRecord({
      ...base,
      teacher: {
        userId: 'u1', teacher_ext_id: '92300', teacher_name: 'N',
        school_ext_id: 'niete:411', school_name: 'S',
      },
    });
    expect(rec).toMatchObject({
      leader_user_id: 'leader-1',
      session_id: 'sess-1',
      teacher_ext_id: '92300',
      teacher_name: 'N',
      school_ext_id: 'niete:411',
      school_name: 'S',
      scheduled_for: '2026-09-15',
      status: 'done',
    });
  });

  it('still refuses the arguments it always refused', () => {
    expect(() => buildObservationRecord({ ...base, teacher: null })).toThrow(/teacher/i);
    expect(() => buildObservationRecord({ ...base, leaderUserId: null, teacher: {} })).toThrow(/leaderUserId/i);
  });
});
