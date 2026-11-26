'use strict';
/**
 * bd-dsu5mq.1 (queue #291) — A COACH PLACES A SCHOOL-LESS PRINCIPAL: THE PRINCIPAL TAKES THE SCHOOL'S REGION.
 *
 * ICT call 17 (26 Nov): 179 principals on prod have no school. The operator: "that is a piece of data coaches can
 * fix". They can: Add a teacher with the principal's phone (WhatsApp /observe Flow, or the portal's People > + Add
 * teacher) finds the account, puts it on her school and keeps it a Principal. It also fills a blank organization.
 * It did NOT fill the region, and the FICO-S / Digital Coach switches reach principals through "role:principal@ict",
 * which needs users.region: 33 of the 179 have a blank region and no per-person key, so once placed they would still
 * get FDE's hand-scored form instead of the Digital Coach's pre-fill.
 *
 * The rule:
 *   · a PRINCIPAL placed at a school takes that school's region, only where users.region is blank (the guard is in the
 *     write, as fillOrganization's is), so a region already there is never overwritten;
 *   · not at a probable-test school or a NIETE-named (head-office) school, never on a test or deleted account, and not
 *     from a school that has no region; the same exclusions the organization fill uses;
 *   · a teacher's region is left as it is (the region decides other things for teachers, e.g. their books);
 *   · a failed fill never undoes the placement, and the audit row says when the region was filled.
 */

const T = require('../../bot/shared/services/observe/observe-teacher-admin.service');

const school = (over = {}) => ({
  school_ext_id: 'niete:910', school_id: 's910', school_name: 'IMCB, I-8/3',
  emis: '910', region: 'Urban-II', is_probable_test: false, ...over,
});

const principal = (over = {}) => ({
  id: 'u-p', phone_number: '+92300FIXTURE1', name: 'School-less Principal', role: 'principal',
  school_id: null, region: null, organization: 'niete', is_test_user: false, deleted_at: null, ...over,
});

function fakeDb({ target = school(), user = principal() } = {}) {
  const calls = { setSchool: [], region: [], audit: [] };
  return {
    calls,
    myschool: jest.fn(async () => target),
    schoolOf: jest.fn(async () => null),
    userByPhone: jest.fn(async () => user),
    regionOwner: jest.fn(async () => 'niete'),
    setUserSchool: jest.fn(async (a) => { calls.setSchool.push(a); return true; }),
    fillOrganization: jest.fn(async () => true),
    fillRegion: jest.fn(async (a) => { calls.region.push(a); return true; }),
    createTeacher: jest.fn(async () => ({ id: 'new-user' })),
    writeAudit: jest.fn(async (rows) => { calls.audit.push(...rows); return rows.length; }),
  };
}

const ADD = { actorLeaderUserId: 'coach-a', schoolExtId: 'niete:910', rawPhone: ['0300', '1234567'].join(' ') }; // digits built from parts (tests/setup/phone-shaped-fixtures)

describe('a coach places a school-less principal at her school', () => {
  it('puts the principal on the school, keeps the role, and fills the blank region from the school', async () => {
    const db = fakeDb();
    const out = await T.commitAdd(ADD, { db });
    expect(out).toMatchObject({ outcome: 'move', wrote: true });
    expect(db.calls.setSchool).toEqual([{ userId: 'u-p', schoolId: 's910', promoteToTeacher: false }]);
    expect(db.calls.region).toEqual([{ userId: 'u-p', region: 'Urban-II' }]);
  });

  it('the move audit row says the region was filled', async () => {
    const db = fakeDb();
    await T.commitAdd(ADD, { db });
    expect(db.calls.audit[0]).toMatchObject({ action: 'move', detail: expect.objectContaining({ regionFilled: 'Urban-II' }) });
  });

  it('never overwrites a region already there', async () => {
    const db = fakeDb({ user: principal({ region: 'Sihala' }) });
    const out = await T.commitAdd(ADD, { db });
    expect(out.wrote).toBe(true);
    expect(db.fillRegion).not.toHaveBeenCalled();
  });

  it.each([
    ['a probable-test school', school({ is_probable_test: true })],
    ['a NIETE-named school', school({ school_name: 'NIETE, Example Office' })],
    ['a school with no region', school({ region: null })],
  ])('leaves a blank region at %s, and still places the principal', async (_, target) => {
    const db = fakeDb({ target });
    const out = await T.commitAdd(ADD, { db });
    expect(out.wrote).toBe(true);
    expect(db.calls.setSchool).toHaveLength(1);
    expect(db.fillRegion).not.toHaveBeenCalled();
  });

  it.each([
    ['a test account', principal({ is_test_user: true })],
    ['a deleted account', principal({ deleted_at: '2026-10-01T00:00:00Z' })],
  ])('never fills %s', async (_, user) => {
    const db = fakeDb({ user });
    await T.commitAdd(ADD, { db });
    expect(db.fillRegion).not.toHaveBeenCalled();
  });

  it('a teacher placed at the school keeps her region as it is (blank stays blank)', async () => {
    const db = fakeDb({ user: principal({ role: 'teacher' }) });
    const out = await T.commitAdd(ADD, { db });
    expect(out.wrote).toBe(true);
    expect(db.fillRegion).not.toHaveBeenCalled();
  });

  it('fills nothing when the school write itself failed', async () => {
    const db = fakeDb();
    db.setUserSchool.mockResolvedValueOnce(false);
    await T.commitAdd(ADD, { db });
    expect(db.fillRegion).not.toHaveBeenCalled();
  });

  it('a region fill that fails does not undo the placement', async () => {
    const db = fakeDb();
    db.fillRegion.mockResolvedValueOnce(false);
    const out = await T.commitAdd(ADD, { db });
    expect(out).toMatchObject({ outcome: 'move', wrote: true });
    expect(db.calls.audit[0].detail.regionFilled).toBeUndefined();
  });
});

describe('the real database port: only a blank region is written, by id, after the school write', () => {
  const SERVICE = '../../bot/shared/services/observe/observe-teacher-admin.service';
  const has = (q, op) => q.ops.find((o) => o[0] === op);

  function loadWithPort(user) {
    const queries = [];
    const answer = (q) => {
      if (q.table === 'leader_schools') return { data: [{ school_ext_id: 'niete:910', school_id: 's910' }], error: null };
      if (q.table === 'schools') return { data: [{ id: 's910', name: 'IMCB, I-8/3', emis: '910', region: 'Urban-II', is_probable_test: false }], error: null };
      if (q.table === 'users' && has(q, 'select') && !has(q, 'update')) return { data: [user], error: null };
      return { data: null, error: null };
    };
    const from = (table) => {
      const q = { table, ops: [] };
      queries.push(q);
      const b = {};
      for (const op of ['select', 'update', 'insert', 'eq', 'is', 'in', 'limit']) b[op] = (...a) => { q.ops.push([op, ...a]); return b; };
      b.then = (res, rej) => Promise.resolve(answer(q)).then(res, rej);
      return b;
    };
    jest.resetModules();
    jest.doMock('../../bot/shared/config/supabase', () => ({ from }));
    jest.doMock('../../bot/shared/services/region-registry', () => ({ organizationForRegion: jest.fn(async () => 'niete') }));
    jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
    return { svc: require(SERVICE), queries };
  }

  afterEach(() => {
    for (const m of ['config/supabase', 'services/region-registry', 'utils/logger']) jest.dontMock(`../../bot/shared/${m}`);
    jest.resetModules();
  });

  it('a principal: school write, then region filled only where region IS NULL', async () => {
    const { svc, queries } = loadWithPort(principal());
    const out = await svc.commitAdd(ADD);
    expect(out).toMatchObject({ outcome: 'move', wrote: true });
    const writes = queries.filter((q) => q.table === 'users' && has(q, 'update'));
    expect(has(writes[0], 'update')[1]).toEqual({ school_id: 's910' });
    const regionWrite = writes.find((q) => has(q, 'update')[1].region !== undefined);
    expect(has(regionWrite, 'update')[1]).toEqual({ region: 'Urban-II' });
    expect(regionWrite.ops).toContainEqual(['eq', 'id', 'u-p']);
    expect(regionWrite.ops).toContainEqual(['is', 'region', null]);
  });

  it('reads the person\'s region when it looks the number up', async () => {
    const { svc, queries } = loadWithPort(principal());
    await svc.commitAdd(ADD);
    const userRead = queries.find((q) => q.table === 'users' && has(q, 'select'));
    expect(has(userRead, 'select')[1]).toEqual(expect.stringMatching(/\bregion\b/));
  });

  it('a teacher: no region write at all', async () => {
    const { svc, queries } = loadWithPort(principal({ role: 'teacher' }));
    await svc.commitAdd(ADD);
    const writes = queries.filter((q) => q.table === 'users' && has(q, 'update'));
    expect(writes.some((q) => has(q, 'update')[1].region !== undefined)).toBe(false);
  });
});
