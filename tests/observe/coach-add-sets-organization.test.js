'use strict';
/**
 * A TEACHER A COACH PLACES AT A SECTOR SCHOOL GETS THE DEPLOYMENT'S ORGANIZATION.
 *
 * Teachers are counted by `users.organization`: one value, `niete`, across FDE's six ICT sectors.
 * Registration writes it and scripts/set-organization.py fills it in on existing rows, but a coach
 * adding a teacher (attaching an account to her school, or creating one) wrote only the school, so
 * every teacher a coach added arrived blank and dropped out of the count.
 *
 * The rule is the backfill script's own, so the two never disagree about a row:
 *   · only a BLANK is filled; a value already there stays, whatever it is;
 *   · only at a school whose region the region registry gives to `niete` (the six sectors), and
 *     never at a probable-test school or a NIETE-named (head-office) school;
 *   · never on a test or deleted account;
 *   · anywhere else the column is left exactly as it was.
 * A registry that cannot be read leaves it blank too: the add itself never fails over this.
 */

const fs = require('fs');
const path = require('path');

const T = require('../../bot/shared/services/observe/observe-teacher-admin.service');

const NIETE = 'niete';
const SERVICE = '../../bot/shared/services/observe/observe-teacher-admin.service';

const school = (over = {}) => ({
  school_ext_id: 'niete:901', school_id: 's901', school_name: 'IMS (I-V), Example Sector School',
  emis: '901', region: 'Tarnol', is_probable_test: false, ...over,
});

const account = (over = {}) => ({
  id: 'u1', phone_number: '923001234567', name: 'Example Teacher', role: 'teacher',
  school_id: null, organization: null, is_test_user: false, deleted_at: null, ...over,
});

// The registry as the region-registry migration seeds it: the six sectors are niete's,
// Gilgit-Baltistan is moawin's, and Durbeen is not listed at all.
const OWNERS = { tarnol: NIETE, 'urban-ii': NIETE, 'b.k': NIETE, 'gilgit-baltistan': 'moawin' };

function fakeDb({ target = school(), user = account(), registry = 'ok' } = {}) {
  const calls = { setSchool: [], created: [], filled: [] };
  return {
    calls,
    myschool: jest.fn(async () => target),
    schoolOf: jest.fn(async () => null),
    userByPhone: jest.fn(async () => user),
    regionOwner: jest.fn(async (region) => (registry === 'unreadable'
      ? null : (OWNERS[String(region || '').trim().toLowerCase()] || null))),
    setUserSchool: jest.fn(async (a) => { calls.setSchool.push(a); return true; }),
    fillOrganization: jest.fn(async (a) => { calls.filled.push(a); return true; }),
    createTeacher: jest.fn(async (a) => { calls.created.push(a); return { id: 'new-user' }; }),
    writeAudit: jest.fn(async (rows) => rows.length),
  };
}

const ADD = { actorLeaderUserId: 'coach-a', schoolExtId: 'niete:901', rawPhone: '0300 1234567' };
const NEW = { ...ADD, name: 'New Teacher' };

const OUT_OF_SCOPE = [
  ['a probable-test school', school({ is_probable_test: true })],
  ['a NIETE-named school', school({ school_name: 'NIETE, Example Office' })],
  ['Durbeen, which the registry does not list', school({ region: 'Durbeen' })],
  ['a region another organization owns', school({ region: 'Gilgit-Baltistan' })],
  ['a school with no region', school({ region: null })],
];

// ── attaching an account that already exists ───────────────────────────

describe('a coach attaches an existing account to her school', () => {
  it('fills a blank organization at a sector school', async () => {
    const db = fakeDb();
    const out = await T.commitAdd(ADD, { db });
    expect(out).toMatchObject({ outcome: 'move', wrote: true });
    expect(db.calls.setSchool).toHaveLength(1);
    expect(db.calls.filled).toEqual([{ userId: 'u1', organization: NIETE }]);
  });

  it('fills it for a principal too: the rule is the school, not the role', async () => {
    const db = fakeDb({ user: account({ role: 'principal' }) });
    await T.commitAdd(ADD, { db });
    expect(db.calls.filled).toEqual([{ userId: 'u1', organization: NIETE }]);
  });

  it('fills it when she moves in from another school', async () => {
    const db = fakeDb({ user: account({ school_id: 's777' }), target: school({ region: 'Urban-II' }) });
    await T.commitAdd(ADD, { db });
    expect(db.calls.filled).toEqual([{ userId: 'u1', organization: NIETE }]);
  });

  it.each([
    ['niete already', NIETE],
    ['another organization', 'moawin'],
    ['an older spelling', 'fde'],
  ])('leaves %s alone, and still moves her', async (_, value) => {
    const db = fakeDb({ user: account({ organization: value }) });
    const out = await T.commitAdd(ADD, { db });
    expect(out.wrote).toBe(true);
    expect(db.calls.setSchool).toHaveLength(1);
    expect(db.fillOrganization).not.toHaveBeenCalled();
  });

  it.each(OUT_OF_SCOPE)('leaves a blank at %s', async (_, target) => {
    const db = fakeDb({ target });
    const out = await T.commitAdd(ADD, { db });
    expect(out.wrote).toBe(true);
    expect(db.fillOrganization).not.toHaveBeenCalled();
  });

  it.each([
    ['a test account', account({ is_test_user: true })],
    ['a deleted account', account({ deleted_at: '2026-10-01T00:00:00Z' })],
  ])('never fills %s', async (_, user) => {
    const db = fakeDb({ user });
    await T.commitAdd(ADD, { db });
    expect(db.fillOrganization).not.toHaveBeenCalled();
  });

  it('leaves it blank, and still moves her, when the registry cannot be read', async () => {
    const db = fakeDb({ registry: 'unreadable' });
    const out = await T.commitAdd(ADD, { db });
    expect(out).toMatchObject({ outcome: 'move', wrote: true });
    expect(db.calls.setSchool).toHaveLength(1);
    expect(db.fillOrganization).not.toHaveBeenCalled();
  });

  it('fills nothing when the school write itself failed', async () => {
    const db = fakeDb();
    db.setUserSchool.mockResolvedValueOnce(false);
    await T.commitAdd(ADD, { db });
    expect(db.fillOrganization).not.toHaveBeenCalled();
  });

  it('writes nothing at all for someone already at this school', async () => {
    const db = fakeDb({ user: account({ school_id: 's901' }) });
    const out = await T.commitAdd(ADD, { db });
    expect(out).toMatchObject({ outcome: 'already_here', wrote: false });
    expect(db.setUserSchool).not.toHaveBeenCalled();
    expect(db.fillOrganization).not.toHaveBeenCalled();
  });
});

// ── creating a new teacher ─────────────────────────────────────────────

describe('a coach creates a new teacher at her school', () => {
  it('creates her with niete at a sector school', async () => {
    const db = fakeDb({ user: null });
    const out = await T.commitAdd(NEW, { db });
    expect(out).toMatchObject({ outcome: 'new', wrote: true });
    expect(db.calls.created).toEqual([
      expect.objectContaining({ schoolId: 's901', role: 'teacher', organization: NIETE }),
    ]);
  });

  it.each(OUT_OF_SCOPE)('creates her with no organization at %s', async (_, target) => {
    const db = fakeDb({ target, user: null });
    const out = await T.commitAdd(NEW, { db });
    expect(out.wrote).toBe(true);
    expect(db.calls.created).toHaveLength(1);
    expect(db.calls.created[0]).not.toHaveProperty('organization');
  });

  it('creates her with no organization when the registry cannot be read', async () => {
    const db = fakeDb({ user: null, registry: 'unreadable' });
    const out = await T.commitAdd(NEW, { db });
    expect(out.wrote).toBe(true);
    expect(db.calls.created[0]).not.toHaveProperty('organization');
  });
});

// ── the real port: what reaches the database ──────────────────────────

/** A chainable stand-in for the supabase client that records every query and answers by table. */
function fakeSupabase(answer) {
  const queries = [];
  const from = (table) => {
    const q = { table, ops: [] };
    queries.push(q);
    const b = {};
    for (const op of ['select', 'update', 'insert', 'eq', 'is', 'in', 'limit']) {
      b[op] = (...args) => { q.ops.push([op, ...args]); return b; };
    }
    b.then = (res, rej) => Promise.resolve(answer(q)).then(res, rej);
    return b;
  };
  return { client: { from }, queries };
}

const has = (q, op) => q.ops.find((o) => o[0] === op);

function loadWithPort({ owner = NIETE, registryThrows = false, user = account() } = {}) {
  const sb = fakeSupabase((q) => {
    if (q.table === 'leader_schools') return { data: [{ school_ext_id: 'niete:901' }], error: null };
    if (q.table === 'schools') {
      return { data: [{ id: 's901', name: 'IMS (I-V), Example Sector School', emis: '901', region: 'Tarnol', is_probable_test: false }], error: null };
    }
    if (q.table === 'users' && has(q, 'select') && !has(q, 'insert')) return { data: user ? [user] : [], error: null };
    if (q.table === 'users' && has(q, 'insert')) return { data: [{ id: 'new-user' }], error: null };
    return { data: null, error: null };
  });
  // The port requires the client and the registry lazily, at call time, so the registry is reset
  // rather than isolated: an isolated one is gone by the time those calls run.
  jest.resetModules();
  jest.doMock('../../bot/shared/config/supabase', () => sb.client);
  jest.doMock('../../bot/shared/services/region-registry', () => ({
    organizationForRegion: jest.fn(async () => {
      if (registryThrows) throw new Error('region registry unreadable: column does not exist');
      return owner;
    }),
  }));
  jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
  return { svc: require(SERVICE), sb };
}

describe('the database port', () => {
  afterEach(() => {
    for (const m of ['config/supabase', 'services/region-registry', 'utils/logger']) jest.dontMock(`../../bot/shared/${m}`);
    jest.resetModules();
  });

  it('fills only a row whose organization is still NULL, by id, after the school write', async () => {
    const { svc, sb } = loadWithPort();
    const out = await svc.commitAdd(ADD);
    expect(out).toMatchObject({ outcome: 'move', wrote: true });
    const writes = sb.queries.filter((q) => q.table === 'users' && has(q, 'update'));
    expect(writes).toHaveLength(2);
    expect(has(writes[0], 'update')[1]).not.toHaveProperty('organization');
    expect(has(writes[1], 'update')[1]).toEqual({ organization: NIETE });
    expect(writes[1].ops).toContainEqual(['eq', 'id', 'u1']);
    expect(writes[1].ops).toContainEqual(['is', 'organization', null]);
  });

  it('reads what the rule needs: the school row and the account', async () => {
    const { svc, sb } = loadWithPort();
    await svc.commitAdd(ADD);
    const schoolRead = sb.queries.find((q) => q.table === 'schools');
    expect(has(schoolRead, 'select')[1]).toEqual(expect.stringMatching(/\bregion\b.*\bis_probable_test\b|\bis_probable_test\b.*\bregion\b/));
    const userRead = sb.queries.find((q) => q.table === 'users' && has(q, 'select'));
    for (const col of ['organization', 'is_test_user', 'deleted_at']) {
      expect(has(userRead, 'select')[1]).toEqual(expect.stringContaining(col));
    }
  });

  it('creates a new teacher with niete in the same insert', async () => {
    const { svc, sb } = loadWithPort({ user: null });
    const out = await svc.commitAdd(NEW);
    expect(out).toMatchObject({ outcome: 'new', wrote: true });
    const insert = sb.queries.find((q) => q.table === 'users' && has(q, 'insert'));
    expect(has(insert, 'insert')[1]).toMatchObject({ school_id: 's901', role: 'teacher', organization: NIETE });
  });

  it('a registry that throws leaves the organization alone and the move still lands', async () => {
    const { svc, sb } = loadWithPort({ registryThrows: true });
    const out = await svc.commitAdd(ADD);
    expect(out).toMatchObject({ outcome: 'move', wrote: true });
    const writes = sb.queries.filter((q) => q.table === 'users' && has(q, 'update'));
    expect(writes).toHaveLength(1);
    expect(has(writes[0], 'update')[1]).not.toHaveProperty('organization');
  });
});

// ── one value, one source ──────────────────────────────────────────────

describe('one organization value, declared once', () => {
  it('registration and the coach flow both take niete from the same constant', () => {
    const { NIETE_ORGANIZATION } = require('../../bot/shared/config/registration-data');
    expect(NIETE_ORGANIZATION).toBe(NIETE);
    for (const f of ['bot/shared/routes/registration-endpoint.js', 'bot/shared/services/observe/observe-teacher-admin.service.js']) {
      const src = fs.readFileSync(path.join(__dirname, '../..', f), 'utf8');
      expect(src).toMatch(/\bNIETE_ORGANIZATION\b/);
      expect(src).not.toMatch(/const NIETE_ORGANIZATION\s*=/);
    }
  });
});
