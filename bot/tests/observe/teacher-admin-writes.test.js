/**
 * Adding and removing a teacher, on the derived model (TDD, red-first).
 *
 * The patch is now leader_schools × users.school_id, so "add a teacher to my
 * school" is one write: set her school. There is no assignment row to create
 * and none to tombstone.
 *
 * Operator, 2026-08-28: "when we add a new teacher by their phone number, just
 * let the coach know this already exists and you are adding them to xyz school.
 * That's fine." So the confirm names the person and the destination, and says
 * where she is coming from — no coach-by-coach accounting.
 *
 * What the model deletes, verified against prod:
 *   · `users.phone_number` is UNIQUE, so one number is one person. The whole
 *     "this number carries two teachers, refuse" branch is gone — it only ever
 *     existed because leader_teachers allowed duplicate phones.
 *   · Removal no longer soft-deletes anything: she leaves the patch by her
 *     school changing, and the history lives in leader_roster_audit.
 */

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';

const {
  planAdd, commitAdd, commitRemoval, addPlanAck,
} = require('../../shared/services/observe/observe-teacher-admin.service');

const RAWAL = { school_ext_id: 'niete:409', school_id: 's409', school_name: 'IMSB (VI-X), Rawal Dam', emis: '409' };
const SAID  = { school_ext_id: 'niete:411', school_id: 's411', school_name: 'IMSB (I-X), SAID PUR', emis: '411' };

const user = (over = {}) => ({
  id: 'u1', phone_number: '923001234567', first_name: 'Tahira Manzoor',
  role: 'teacher', school_id: SAID.school_id, ...over,
});

function fakeDb(over = {}) {
  const calls = { setSchool: [], created: [], audit: [] };
  return {
    calls,
    myschool: jest.fn(async (leaderId, ext) =>
      (over.holdsSchool === false ? null : (ext === RAWAL.school_ext_id ? RAWAL : SAID))),
    schoolOf: jest.fn(async (schoolId) =>
      (schoolId === RAWAL.school_id ? RAWAL : schoolId === SAID.school_id ? SAID : null)),
    userByPhone: jest.fn(async () => ('user' in over ? over.user : user())),
    setUserSchool: jest.fn(async (a) => { calls.setSchool.push(a); return true; }),
    createTeacher: jest.fn(async (a) => { calls.created.push(a); return { id: 'new-user', ...a }; }),
    writeAudit: jest.fn(async (rows) => { calls.audit.push(...rows); return rows.length; }),
    cancelUpcoming: jest.fn(async () => (over.cancelled == null ? 0 : over.cancelled)),
  };
}

const ADD = (over = {}) => ({
  actorLeaderUserId: 'coach-a', schoolExtId: RAWAL.school_ext_id,
  rawPhone: '0300 1234567', ...over,
});

// ── planning: nothing is written ───────────────────────────────────────

describe('planAdd · what the coach is shown before anything happens', () => {
  it('a teacher at another school -> a move, naming both ends', async () => {
    const p = await planAdd(ADD(), { db: fakeDb() });
    expect(p.outcome).toBe('move');
    expect(p.person.name).toBe('Tahira Manzoor');
    expect(p.fromSchoolName).toBe('IMSB (I-X), SAID PUR');
    expect(p.toSchoolName).toBe('IMSB (VI-X), Rawal Dam');
  });

  it('a teacher already at this school -> nothing to do', async () => {
    const p = await planAdd(ADD(), { db: fakeDb({ user: user({ school_id: RAWAL.school_id }) }) });
    expect(p.outcome).toBe('already_here');
  });

  it('a number nobody holds -> a new teacher', async () => {
    const p = await planAdd(ADD(), { db: fakeDb({ user: null }) });
    expect(p.outcome).toBe('new');
  });

  it('refuses a number that is not a PK mobile', async () => {
    const p = await planAdd(ADD({ rawPhone: '12345' }), { db: fakeDb() });
    expect(p.outcome).toBe('invalid_phone');
  });

  it('refuses a school the coach does not actually coach', async () => {
    // Otherwise a coach could move any teacher in the district into a school
    // she has nothing to do with.
    const p = await planAdd(ADD(), { db: fakeDb({ holdsSchool: false }) });
    expect(p.outcome).toBe('not_my_school');
  });

  it('refuses to file another COACH as a teacher', async () => {
    const p = await planAdd(ADD(), { db: fakeDb({ user: user({ role: 'coach' }) }) });
    expect(p.outcome).toBe('is_coach');
  });

  it('a principal is allowed, and the plan says so', async () => {
    const p = await planAdd(ADD(), { db: fakeDb({ user: user({ role: 'principal' }) }) });
    expect(p.outcome).toBe('move');
    expect(p.person.isPrincipal).toBe(true);
  });

  it('a teacher with no school at all is an add, not a move', async () => {
    const p = await planAdd(ADD(), { db: fakeDb({ user: user({ school_id: null }) }) });
    expect(p.outcome).toBe('move');
    expect(p.fromSchoolName).toBeNull();
  });
});

// ── the copy ───────────────────────────────────────────────────────────

describe('addPlanAck · "this already exists and you are adding them to xyz"', () => {
  const plan = {
    outcome: 'move', person: { name: 'Tahira Manzoor', isPrincipal: false },
    phone: '923001234567', fromSchoolName: 'IMSB (I-X), SAID PUR',
    toSchoolName: 'IMSB (VI-X), Rawal Dam',
  };

  it('names her, where she is, and where she is going', () => {
    const t = addPlanAck('en', plan);
    for (const bit of ['Tahira Manzoor', 'IMSB (I-X), SAID PUR', 'IMSB (VI-X), Rawal Dam']) {
      expect(t).toContain(bit);
    }
  });

  it('says principal when she is one, so the coach is not surprised later', () => {
    expect(addPlanAck('en', { ...plan, person: { name: 'Nasir', isPrincipal: true } })).toMatch(/principal/i);
  });

  it('has an Urdu form that keeps her name untranslated', () => {
    const t = addPlanAck('ur', plan);
    expect(t).toMatch(/[؀-ۿ]/);
    expect(t).toContain('Tahira Manzoor');
  });

  it('does not say "moving" when she has no school yet', () => {
    const t = addPlanAck('en', { ...plan, fromSchoolName: null });
    expect(t).not.toMatch(/from \*\*/);
    expect(t).toContain('IMSB (VI-X), Rawal Dam');
  });
});

// ── committing ─────────────────────────────────────────────────────────

describe('commitAdd · one write, and a record of it', () => {
  it('a move sets her school and audits it', async () => {
    const db = fakeDb();
    const res = await commitAdd(ADD(), { db });
    expect(res.outcome).toBe('move');
    expect(db.calls.setSchool[0]).toMatchObject({ userId: 'u1', schoolId: RAWAL.school_id });
    expect(db.calls.audit[0]).toMatchObject({
      action: 'move', actor_user_id: 'coach-a',
      from_school_ext_id: SAID.school_ext_id, to_school_ext_id: RAWAL.school_ext_id,
    });
  });

  it('a new teacher is created, not silently skipped', async () => {
    const db = fakeDb({ user: null });
    const res = await commitAdd(ADD({ name: 'Ayesha Bibi' }), { db });
    expect(res.outcome).toBe('new');
    expect(db.calls.created[0]).toMatchObject({
      phone: '923001234567', name: 'Ayesha Bibi', schoolId: RAWAL.school_id, role: 'teacher',
    });
  });

  it('refuses a new teacher with no name rather than creating a nameless user', async () => {
    const db = fakeDb({ user: null });
    const res = await commitAdd(ADD({ name: '  ' }), { db });
    expect(res.outcome).toBe('name_required');
    expect(db.calls.created).toHaveLength(0);
  });

  it('already at this school writes nothing at all', async () => {
    const db = fakeDb({ user: user({ school_id: RAWAL.school_id }) });
    const res = await commitAdd(ADD(), { db });
    expect(res.outcome).toBe('already_here');
    expect(db.calls.setSchool).toHaveLength(0);
    expect(db.calls.audit).toHaveLength(0);
  });

  it('every refusal writes nothing', async () => {
    for (const over of [{ user: user({ role: 'coach' }) }, { holdsSchool: false }]) {
      const db = fakeDb(over);
      await commitAdd(ADD(), { db });
      expect(db.calls.setSchool).toHaveLength(0);
      expect(db.calls.created).toHaveLength(0);
    }
  });
});

describe('commitRemoval · she leaves the school, keeps everything else', () => {
  it('clears her school and cancels the visits that depended on it', async () => {
    const db = fakeDb({ cancelled: 2 });
    const res = await commitRemoval(
      { actorLeaderUserId: 'coach-a', schoolExtId: SAID.school_ext_id, userId: 'u1', reason: 'left' },
      { db },
    );
    expect(res.ok).toBe(true);
    expect(db.calls.setSchool[0]).toMatchObject({ userId: 'u1', schoolId: null });
    expect(res.visitsCancelled).toBe(2);
  });

  it('audits the removal with no destination — that is what makes it a removal', async () => {
    const db = fakeDb();
    await commitRemoval(
      { actorLeaderUserId: 'coach-a', schoolExtId: SAID.school_ext_id, userId: 'u1', reason: 'left' },
      { db },
    );
    const a = db.calls.audit.find((x) => x.action === 'remove');
    expect(a.from_school_ext_id).toBe(SAID.school_ext_id);
    expect(a.to_school_ext_id).toBeNull();
    expect(a.detail).toMatchObject({ reason: 'left' });
  });

  it('refuses to remove someone from a school the coach does not coach', async () => {
    const db = fakeDb({ holdsSchool: false });
    const res = await commitRemoval(
      { actorLeaderUserId: 'coach-a', schoolExtId: SAID.school_ext_id, userId: 'u1' }, { db },
    );
    expect(res.ok).toBe(false);
    expect(db.calls.setSchool).toHaveLength(0);
  });
});
