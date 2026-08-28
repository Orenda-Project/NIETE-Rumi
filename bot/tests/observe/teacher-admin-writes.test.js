/**
 * The WRITE half: what actually happens to rows when a coach confirms
 * (TDD, red-first).
 *
 * Operator, 2026-08-28:
 *   · removing a teacher CANCELS her upcoming visits, and that is audited;
 *   · every other coach who loses her gets a TEMPLATE message — they did not
 *     do this and must not simply find her gone.
 *
 * Live shape (NIETE prod `ihzciabopbttygxxgrkm`, queried 2026-08-28):
 *   · 45 upcoming observation_schedules rows, 43 of them backed by a live
 *     leader_teachers row — so removal orphaning a visit is the common case,
 *     not the corner case.
 *   · 1,155 (school,teacher) pairs are co-held, max 4 coaches on one school.
 *   · `source` is pinned by CHECK (source='niete_ict'); a fake db cannot catch
 *     a 23514, so the constant is asserted here on every written row instead.
 *
 * The service takes an injectable `db` port so the orchestration — what is
 * written, in what order, and to whom — is provable without a live database.
 */

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';

const {
  commitAdd,
  commitRemoval,
  ROW_SOURCE,
} = require('../../shared/services/observe/observe-teacher-admin.service');

const SCHOOL_A = { school_ext_id: 'niete:273', school_name: 'IMS(I-V) No.2 G-10/2', emis: '273' };
const SCHOOL_B = { school_ext_id: 'niete:916', school_name: 'IMCG, G-10/2', emis: '916' };

const row = (over = {}) => ({
  id: 'row-1',
  leader_user_id: 'coach-a',
  teacher_ext_id: '923001234567',
  teacher_name: 'Tahira Manzoor',
  teacher_phone_e164: '923001234567',
  school_ext_id: SCHOOL_A.school_ext_id,
  school_name: SCHOOL_A.school_name,
  ...over,
});

/** A recording fake of the service's db port. */
function fakeDb(over = {}) {
  const calls = { inserted: [], softDeleted: [], cancelled: [], audit: [], userSchool: [] };
  return {
    calls,
    liveRowsByPhone: jest.fn(async () => over.live || []),
    // Removal addresses a teacher by (school, ext id) — she may have no phone.
    liveRowsAtSchool: jest.fn(async (schoolExtId) => (over.live || []).filter((r) => r.school_ext_id === schoolExtId)),
    resolveSchool: jest.fn(async (extId) => (extId === SCHOOL_A.school_ext_id ? SCHOOL_A : SCHOOL_B)),
    userByPhone: jest.fn(async () => over.user || { id: 'user-t', phone_number: '923001234567' }),
    insertAssignment: jest.fn(async (r) => { calls.inserted.push(r); return { ...r, id: 'new-row' }; }),
    softDeleteRows: jest.fn(async (ids, by) => { calls.softDeleted.push({ ids, by }); return ids.length; }),
    cancelUpcoming: jest.fn(async (a) => { calls.cancelled.push(a); return over.cancelled == null ? 1 : over.cancelled; }),
    setUserSchool: jest.fn(async (a) => { calls.userSchool.push(a); return true; }),
    writeAudit: jest.fn(async (rows) => { calls.audit.push(...rows); return rows.length; }),
  };
}

const fakeNotify = () => { const sent = []; return { sent, send: jest.fn(async (a) => { sent.push(a); return true; }) }; };

// ── adding ─────────────────────────────────────────────────────────────

describe('commitAdd · a teacher nobody holds', () => {
  it('writes one assignment for the acting coach and stamps the school truth', async () => {
    const db = fakeDb({ live: [] });
    const notify = fakeNotify();
    const res = await commitAdd({
      actorLeaderUserId: 'coach-a', schoolExtId: SCHOOL_B.school_ext_id,
      rawPhone: '0300 1234567', teacherName: 'Tahira Manzoor',
    }, { db, notify });

    expect(res.outcome).toBe('new');
    expect(db.calls.inserted).toHaveLength(1);
    expect(db.calls.inserted[0]).toMatchObject({
      leader_user_id: 'coach-a',
      school_ext_id: SCHOOL_B.school_ext_id,
      teacher_phone_e164: '923001234567',
      source: ROW_SOURCE,
    });
    // users.school_id is the school truth and nothing else writes it.
    expect(db.calls.userSchool).toHaveLength(1);
    expect(db.calls.audit[0]).toMatchObject({ action: 'add', actor_user_id: 'coach-a' });
  });

  it('refuses a number that is not a PK mobile, and writes nothing at all', async () => {
    const db = fakeDb({ live: [] });
    const res = await commitAdd({
      actorLeaderUserId: 'coach-a', schoolExtId: SCHOOL_B.school_ext_id,
      rawPhone: '12345', teacherName: 'X',
    }, { db, notify: fakeNotify() });

    expect(res.outcome).toBe('invalid_phone');
    expect(db.calls.inserted).toHaveLength(0);
    expect(db.calls.audit).toHaveLength(0);
  });

  it('refuses a new teacher with no name rather than writing a nameless row', async () => {
    // leader_teachers.teacher_name is NOT NULL on the live schema.
    const db = fakeDb({ live: [] });
    const res = await commitAdd({
      actorLeaderUserId: 'coach-a', schoolExtId: SCHOOL_B.school_ext_id,
      rawPhone: '03001234567', teacherName: '   ',
    }, { db, notify: fakeNotify() });

    expect(res.outcome).toBe('name_required');
    expect(db.calls.inserted).toHaveLength(0);
  });
});

describe('commitAdd · she is already at this school', () => {
  it('under ANOTHER coach — the caller gains a row, nobody is notified', async () => {
    const db = fakeDb({ live: [row({ leader_user_id: 'coach-b', school_ext_id: SCHOOL_B.school_ext_id })] });
    const notify = fakeNotify();
    const res = await commitAdd({
      actorLeaderUserId: 'coach-a', schoolExtId: SCHOOL_B.school_ext_id, rawPhone: '03001234567',
    }, { db, notify });

    expect(res.outcome).toBe('already_here');
    expect(db.calls.inserted).toHaveLength(1);
    expect(db.calls.softDeleted).toHaveLength(0);   // nobody loses her
    expect(notify.sent).toHaveLength(0);
  });

  it('under the caller herself — nothing is written twice', async () => {
    const db = fakeDb({ live: [row({ leader_user_id: 'coach-a', school_ext_id: SCHOOL_B.school_ext_id })] });
    const res = await commitAdd({
      actorLeaderUserId: 'coach-a', schoolExtId: SCHOOL_B.school_ext_id, rawPhone: '03001234567',
    }, { db, notify: fakeNotify() });

    expect(res.outcome).toBe('already_here');
    expect(db.calls.inserted).toHaveLength(0);
  });
});

describe('commitAdd · a move', () => {
  const live = [
    row({ id: 'r1', leader_user_id: 'coach-b' }),
    row({ id: 'r2', leader_user_id: 'coach-c' }),
  ];

  it('tombstones the old school, adds the new one, and re-points the school truth', async () => {
    const db = fakeDb({ live });
    const res = await commitAdd({
      actorLeaderUserId: 'coach-a', schoolExtId: SCHOOL_B.school_ext_id, rawPhone: '03001234567',
    }, { db, notify: fakeNotify() });

    expect(res.outcome).toBe('move');
    expect(db.calls.softDeleted[0].ids.sort()).toEqual(['r1', 'r2']);
    expect(db.calls.softDeleted[0].by).toBe('coach-a');      // who did it, not whose row it was
    expect(db.calls.inserted).toHaveLength(1);
    expect(db.calls.inserted[0].school_ext_id).toBe(SCHOOL_B.school_ext_id);
    expect(db.calls.userSchool[0]).toMatchObject({ schoolExtId: SCHOOL_B.school_ext_id });
  });

  it('cancels the upcoming visits the old coaches had booked', async () => {
    const db = fakeDb({ live });
    await commitAdd({
      actorLeaderUserId: 'coach-a', schoolExtId: SCHOOL_B.school_ext_id, rawPhone: '03001234567',
    }, { db, notify: fakeNotify() });

    expect(db.calls.cancelled[0]).toMatchObject({
      schoolExtId: SCHOOL_A.school_ext_id, teacherExtId: '923001234567',
    });
  });

  it('writes ONE audit row per coach who lost her, naming both schools', async () => {
    const db = fakeDb({ live });
    await commitAdd({
      actorLeaderUserId: 'coach-a', schoolExtId: SCHOOL_B.school_ext_id, rawPhone: '03001234567',
    }, { db, notify: fakeNotify() });

    const moves = db.calls.audit.filter((a) => a.action === 'move');
    expect(moves.map((a) => a.affected_leader_user_id).sort()).toEqual(['coach-a', 'coach-b', 'coach-c']);
    for (const a of moves) {
      expect(a.from_school_ext_id).toBe(SCHOOL_A.school_ext_id);
      expect(a.to_school_ext_id).toBe(SCHOOL_B.school_ext_id);
      expect(a.actor_user_id).toBe('coach-a');
    }
  });

  it('templates every coach who lost her, and never the one who did it', async () => {
    const db = fakeDb({ live });
    const notify = fakeNotify();
    await commitAdd({
      actorLeaderUserId: 'coach-a', schoolExtId: SCHOOL_B.school_ext_id, rawPhone: '03001234567',
    }, { db, notify });

    expect(notify.sent.map((n) => n.leaderUserId).sort()).toEqual(['coach-b', 'coach-c']);
    expect(notify.sent[0]).toMatchObject({ teacherName: 'Tahira Manzoor', schoolName: SCHOOL_A.school_name });
  });

  it('a failed notification never rolls back the move', async () => {
    // The rows are the record; a template is a courtesy. Throwing here would
    // leave a half-applied move, which is the R41 failure shape all over again.
    const db = fakeDb({ live });
    const notify = { sent: [], send: jest.fn(async () => { throw new Error('Meta 131047'); }) };
    const res = await commitAdd({
      actorLeaderUserId: 'coach-a', schoolExtId: SCHOOL_B.school_ext_id, rawPhone: '03001234567',
    }, { db, notify });

    expect(res.outcome).toBe('move');
    expect(db.calls.inserted).toHaveLength(1);
    expect(res.notifyFailed).toBe(2);
  });

  it('REFUSES an ambiguous number and writes nothing', async () => {
    const db = fakeDb({
      live: [row({ id: 'r1', teacher_ext_id: 'name:ayesha' }), row({ id: 'r2', teacher_ext_id: 'name:bilal' })],
    });
    const res = await commitAdd({
      actorLeaderUserId: 'coach-a', schoolExtId: SCHOOL_B.school_ext_id, rawPhone: '03001234567',
    }, { db, notify: fakeNotify() });

    expect(res.outcome).toBe('ambiguous');
    expect(db.calls.inserted).toHaveLength(0);
    expect(db.calls.softDeleted).toHaveLength(0);
  });
});

// ── removing ───────────────────────────────────────────────────────────

describe('commitRemoval · she comes off the school, her history does not', () => {
  const live = [
    row({ id: 'r1', leader_user_id: 'coach-a' }),
    row({ id: 'r2', leader_user_id: 'coach-b' }),
  ];

  it('soft-deletes every coach row for that school — never a hard delete', async () => {
    const db = fakeDb({ live });
    const res = await commitRemoval({
      actorLeaderUserId: 'coach-a', schoolExtId: SCHOOL_A.school_ext_id, teacherExtId: '923001234567',
    }, { db, notify: fakeNotify() });

    expect(res.ok).toBe(true);
    expect(db.calls.softDeleted[0].ids.sort()).toEqual(['r1', 'r2']);
    expect(res.coachesAffected).toBe(2);
  });

  it('cancels her upcoming visits and reports how many', async () => {
    const db = fakeDb({ live, cancelled: 3 });
    const res = await commitRemoval({
      actorLeaderUserId: 'coach-a', schoolExtId: SCHOOL_A.school_ext_id, teacherExtId: '923001234567',
    }, { db, notify: fakeNotify() });

    expect(db.calls.cancelled).toHaveLength(1);
    expect(res.visitsCancelled).toBe(3);
  });

  it('records the cancellation in the audit, not just the removal', async () => {
    const db = fakeDb({ live, cancelled: 3 });
    await commitRemoval({
      actorLeaderUserId: 'coach-a', schoolExtId: SCHOOL_A.school_ext_id,
      teacherExtId: '923001234567', reason: 'left the school',
    }, { db, notify: fakeNotify() });

    const a = db.calls.audit.find((x) => x.action === 'remove');
    expect(a.detail).toMatchObject({ visitsCancelled: 3, reason: 'left the school' });
    expect(a.to_school_ext_id).toBeNull();               // a removal has no destination
    expect(a.from_school_ext_id).toBe(SCHOOL_A.school_ext_id);
  });

  it('does NOT touch users.school_id — she still works somewhere', async () => {
    const db = fakeDb({ live });
    await commitRemoval({
      actorLeaderUserId: 'coach-a', schoolExtId: SCHOOL_A.school_ext_id, teacherExtId: '923001234567',
    }, { db, notify: fakeNotify() });

    expect(db.calls.userSchool).toHaveLength(0);
  });

  it('templates the other coaches only', async () => {
    const db = fakeDb({ live });
    const notify = fakeNotify();
    await commitRemoval({
      actorLeaderUserId: 'coach-a', schoolExtId: SCHOOL_A.school_ext_id, teacherExtId: '923001234567',
    }, { db, notify });

    expect(notify.sent.map((n) => n.leaderUserId)).toEqual(['coach-b']);
  });

  it('refuses when she is not on that school at all', async () => {
    const db = fakeDb({ live: [] });
    const res = await commitRemoval({
      actorLeaderUserId: 'coach-a', schoolExtId: SCHOOL_A.school_ext_id, teacherExtId: '923001234567',
    }, { db, notify: fakeNotify() });

    expect(res.ok).toBe(false);
    expect(res.reason).toBe('not_found');
    expect(db.calls.softDeleted).toHaveLength(0);
  });
});
