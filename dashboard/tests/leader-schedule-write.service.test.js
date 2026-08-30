/**
 * bd-2676 — schedule a visit from the portal (TDD, red-first).
 *
 * Riffat R33: visits can only be scheduled in WhatsApp, so a coach who clears
 * her chats to free storage loses the record. The portal has only ever READ
 * observation_schedules.
 *
 * Operator decision (2026-08-13): create + cancel, no edit — two writers on one
 * table is where conflicts start, and an edit path doubles the surface for no
 * clear gain.
 *
 * The rules that matter here are safety ones:
 *   • a coach may only schedule teachers in HER OWN patch (never another
 *     coach's, and never an arbitrary id posted by hand);
 *   • cancel only ever touches HER OWN row, and only while it is 'upcoming';
 *   • a 'done' row is NEVER cancellable — since bd-2668 those rows ARE the
 *     record of who was observed, so cancelling one would erase a teacher's
 *     identity from a completed observation.
 */

const {
  createSchedule, cancelSchedule,
} = require('../services/leader-schedule-write.service');

const LEADER = 'leader-uuid-1';
const TODAY = '2026-08-13';

const PATCH_ROW = {
  teacher_ext_id: 'p1', teacher_name: 'Tahira Manzoor',
  school_ext_id: 'niete:509', school_name: 'IMSG Mohra Nagial',
};

/** query stub: patch lookup, existing-row lookup, then the write. */
function makeQuery({ patch = [PATCH_ROW], existing = [], writes = [] } = {}) {
  return jest.fn(async (sql, params) => {
    // The patch is derived: leader_schools x schools x users.school_id.
    if (/leader_schools/i.test(sql)) return { rows: patch };
    if (/select/i.test(sql) && /observation_schedules/i.test(sql)) return { rows: existing };
    writes.push({ sql, params });
    return { rows: [{ id: 'new-sched-1' }] };
  });
}

describe('createSchedule', () => {
  it('refuses a teacher who is not in the coach\'s patch', async () => {
    const q = makeQuery({ patch: [] });
    await expect(createSchedule(q, LEADER, {
      schoolExtId: 'niete:509', teacherExtId: 'not-mine', date: '2026-08-20', slot: '09:00',
    }, { today: TODAY })).rejects.toThrow(/patch/i);
  });

  it('refuses a malformed date rather than writing a bad row', async () => {
    for (const date of ['20-08-2026', 'tomorrow', '', null, '2026-13-01']) {
      await expect(createSchedule(makeQuery(), LEADER, {
        schoolExtId: 'niete:509', teacherExtId: 'p1', date, slot: '09:00',
      }, { today: TODAY })).rejects.toThrow(/date/i);
    }
  });

  it('refuses a date in the past', async () => {
    await expect(createSchedule(makeQuery(), LEADER, {
      schoolExtId: 'niete:509', teacherExtId: 'p1', date: '2026-08-01', slot: '09:00',
    }, { today: TODAY })).rejects.toThrow(/past/i);
  });

  it('allows today', async () => {
    const writes = [];
    await createSchedule(makeQuery({ writes }), LEADER, {
      schoolExtId: 'niete:509', teacherExtId: 'p1', date: TODAY, slot: '09:00',
    }, { today: TODAY });
    expect(writes.length).toBe(1);
  });

  it('writes the teacher and school names from the patch, not from the caller', async () => {
    const writes = [];
    await createSchedule(makeQuery({ writes }), LEADER, {
      schoolExtId: 'niete:509', teacherExtId: 'p1', date: '2026-08-20', slot: '09:00',
      teacherName: 'INJECTED', schoolName: 'INJECTED',
    }, { today: TODAY });
    const flat = JSON.stringify(writes[0].params);
    expect(flat).toContain('Tahira Manzoor');
    expect(flat).toContain('IMSG Mohra Nagial');
    expect(flat).not.toContain('INJECTED');
  });

  it('scopes every write to the session leader', async () => {
    const writes = [];
    await createSchedule(makeQuery({ writes }), LEADER, {
      schoolExtId: 'niete:509', teacherExtId: 'p1', date: '2026-08-20', slot: '09:00',
    }, { today: TODAY });
    expect(writes[0].params).toContain(LEADER);
  });

  it('updates the existing active visit rather than stacking duplicates', async () => {
    const writes = [];
    const q = makeQuery({ existing: [{ id: 'sched-existing' }], writes });
    await createSchedule(q, LEADER, {
      schoolExtId: 'niete:509', teacherExtId: 'p1', date: '2026-08-20', slot: '11:30',
    }, { today: TODAY });
    expect(writes[0].sql).toMatch(/update/i);
    expect(writes[0].params).toContain('sched-existing');
  });
});

describe('cancelSchedule', () => {
  it('cancels the coach\'s own upcoming visit', async () => {
    const writes = [];
    const q = makeQuery({ existing: [{ id: 's1', status: 'upcoming', leader_user_id: LEADER }], writes });
    await cancelSchedule(q, LEADER, 's1');
    expect(writes[0].sql).toMatch(/update/i);
    expect(writes[0].sql).toMatch(/cancelled/);
  });

  it('refuses to cancel a visit belonging to another coach', async () => {
    const q = makeQuery({ existing: [{ id: 's1', status: 'upcoming', leader_user_id: 'someone-else' }] });
    await expect(cancelSchedule(q, LEADER, 's1')).rejects.toThrow(/not found|permitted/i);
  });

  it('NEVER cancels a done visit — that row is the record of who was observed', async () => {
    const q = makeQuery({ existing: [{ id: 's1', status: 'done', leader_user_id: LEADER }] });
    await expect(cancelSchedule(q, LEADER, 's1')).rejects.toThrow(/completed|done/i);
  });

  it('refuses an unknown id', async () => {
    const q = makeQuery({ existing: [] });
    await expect(cancelSchedule(q, LEADER, 'nope')).rejects.toThrow(/not found/i);
  });
});

/**
 * bd-43530 — a portal-scheduled visit must stamp the teacher's WHOLE name.
 *
 * `observation_schedules.teacher_name` is denormalised at write time and is the
 * name the bot later prints on My schedule, Pending debriefs and the visit
 * actions (via _withObservedTeacher). This service selected `u.first_name`, so
 * every visit booked from the portal wrote a first name into the record — the
 * same bug the coach reported in the /observe picker, just entering through the
 * other door. The comment above PATCH_SQL is explicit that this is "where the
 * names come from", so it is also where the fix belongs.
 *
 * Resolution matches patch-resolver.fullNameOf: name → first+last → NULL.
 * Measured on NIETE prod 2026-08-31: `name` is populated for 7,912 of 9,362
 * teachers+principals vs `last_name` for 4,304, and 2,531 people have a
 * one-word first_name beside a multi-word name.
 */
describe('bd-43530 · the portal writes a full name, not a first name', () => {
  const SQL = require('fs').readFileSync(
    require.resolve('../services/leader-schedule-write.service'), 'utf8');

  it('no longer takes teacher_name straight from u.first_name', () => {
    expect(SQL).not.toMatch(/u\.first_name\s+AS\s+teacher_name/i);
  });

  it('prefers users.name, falling back to first+last', () => {
    const patch = SQL.slice(SQL.indexOf('const PATCH_SQL'), SQL.indexOf('const ACTIVE_SQL'));
    expect(patch).toMatch(/AS\s+teacher_name/i);
    expect(patch).toMatch(/u\.name/);
    expect(patch).toMatch(/u\.last_name/);
    expect(patch).toMatch(/COALESCE/i);
    // A blank string must not beat the fallback — '' is not a name.
    expect(patch).toMatch(/NULLIF/i);
  });

  it('still writes whatever the patch resolved, never a caller-supplied name', async () => {
    const writes = [];
    const q = makeQuery({
      patch: [{ ...PATCH_ROW, teacher_name: 'Muhammad Kashif Rafique' }], writes,
    });
    await createSchedule(q, LEADER, {
      schoolExtId: 'niete:509', teacherExtId: 'p1', date: '2026-08-20', slot: '09:00',
      teacherName: 'SPOOFED',
    }, { today: TODAY });
    expect(writes).toHaveLength(1);
    expect(writes[0].params).toContain('Muhammad Kashif Rafique');
    expect(writes[0].params).not.toContain('SPOOFED');
  });
});
