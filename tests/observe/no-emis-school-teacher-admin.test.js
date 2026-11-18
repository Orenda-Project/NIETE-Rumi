'use strict';
/**
 * A COACH CAN MANAGE TEACHERS AT A SCHOOL THAT HAS NO EMIS.
 *
 * Reported from Gilgit-Baltistan, 18 Nov: a coach adding a teacher at Deosai Community School Dapa Kharmang in the
 * portal got "Not your school", though the school is on her list. Deosai and MF Community School Hoto have no EMIS;
 * a coach holds them under a key made from the name ('niete:gb-deosai-community-school-dapa-kharmang'), with
 * leader_schools.school_id pointing at the school.
 *
 * The bot's teacher admin found "her school" by cutting the key at ':' and looking the tail up as an EMIS. For these
 * schools that finds nothing, so every add, move, edit and removal there was refused as not her school — on the
 * portal and on WhatsApp alike (one writer serves both). The rule everywhere else (patch-resolver, leader-patch) is
 * the holding's school_id, the declared foreign key; the EMIS reading stays only for a holding written without one.
 *
 * Production, 18 Nov: of 682 holdings, the EMIS reading and school_id name the same school for 663 and never
 * disagree; school_id alone names the 14 no-EMIS holdings (3 coaches at Deosai, 3 at Hoto, the GB test schools).
 *
 * Adding such a school had the same reading: the search offers Deosai under its name key, the EMIS lookup missed,
 * and the "only in the assignment table" branch would have inserted a SECOND Deosai into `schools`, leaving the new
 * holding pointed at an empty copy. It now takes the school another coach's holding already names.
 */

const SUPABASE = '../../bot/shared/config/supabase';

// ── a small supabase stand-in: select / eq / is / in / limit / insert / update, awaited ─────────────

const mockState = { tables: {}, inserted: [], updated: [] };

function mockTable(name) {
  const rows = mockState.tables[name] || (mockState.tables[name] = []);
  let out = [...rows];
  let op = 'select';
  let patch = null;
  const q = {
    select() { return q; },
    eq(c, v) { out = out.filter((r) => r[c] === v); return q; },
    is(c, v) { out = out.filter((r) => (v === null ? r[c] == null : r[c] === v)); return q; },
    in(c, vs) { out = out.filter((r) => vs.includes(r[c])); return q; },
    limit(n) { out = out.slice(0, n); return q; },
    maybeSingle() { return Promise.resolve({ data: out[0] || null, error: null }); },
    insert(row) {
      const made = { id: `new-${name}-${mockState.inserted.length + 1}`, ...row };
      mockState.inserted.push({ table: name, row });
      rows.push(made);
      const done = { data: [made], error: null };
      return { select: () => ({ limit: async () => done }), then: (res) => res(done) };
    },
    update(p) { op = 'update'; patch = p; return q; },
    delete() { op = 'delete'; return q; },
    then(res, rej) {
      if (op === 'update') { mockState.updated.push({ table: name, patch, ids: out.map((r) => r.id) }); }
      return Promise.resolve({ data: out, error: null, count: out.length }).then(res, rej);
    },
  };
  return q;
}

jest.mock('../../bot/shared/config/supabase', () => ({ from: (n) => mockTable(n) }));

const T = require('../../bot/shared/services/observe/observe-teacher-admin.service');
const S = require('../../bot/shared/services/observe/observe-school-admin.service');

const DEOSAI_KEY = 'niete:gb-deosai-community-school-dapa-kharmang';
const DEOSAI = { id: 's-deosai', name: 'Deosai Community school Dapa Kharmang', emis: null, region: 'Gilgit-Baltistan', is_probable_test: false };
const SECTOR = { id: 's-901', name: 'IMS (I-V), Example Sector School', emis: '901', region: 'Tarnol', is_probable_test: false };

function seed({ schools = [DEOSAI, SECTOR], leaderSchools = [], users = [] } = {}) {
  mockState.tables = {
    schools: schools.map((s) => ({ ...s })),
    leader_schools: leaderSchools.map((r) => ({ ...r })),
    users: users.map((u) => ({ ...u })),
    leader_teachers: [],
    leader_roster_audit: [],
    observation_schedules: [],
  };
  mockState.inserted = [];
  mockState.updated = [];
}

const holding = (leader, key, schoolId, over = {}) => ({
  leader_user_id: leader, school_ext_id: key, school_id: schoolId, school_name: null, emis: null, ...over,
});

const NEW_NUMBER = '0300 1234567';

beforeEach(() => seed());

// ── the reported case: add a teacher ─────────────────────────────────────────────────────────

describe('adding a teacher at a school with no EMIS', () => {
  it('is allowed for a coach who holds it: a new number is a new teacher there', async () => {
    seed({ leaderSchools: [holding('coach-gb', DEOSAI_KEY, 's-deosai')] });
    const plan = await T.planAdd({ actorLeaderUserId: 'coach-gb', schoolExtId: DEOSAI_KEY, rawPhone: NEW_NUMBER });
    expect(plan.outcome).toBe('new');
    expect(plan.toSchoolName).toBe('Deosai Community school Dapa Kharmang');
    expect(plan.target).toMatchObject({ school_id: 's-deosai', school_ext_id: DEOSAI_KEY, region: 'Gilgit-Baltistan' });
  });

  it('the school it reports has no EMIS: null, never the text "null"', async () => {
    seed({ leaderSchools: [holding('coach-gb', DEOSAI_KEY, 's-deosai')] });
    const plan = await T.planAdd({ actorLeaderUserId: 'coach-gb', schoolExtId: DEOSAI_KEY, rawPhone: NEW_NUMBER });
    expect(plan.target.emis).toBeNull();
  });

  it('commits: the new teacher is created AT Deosai, and the audit names its key', async () => {
    seed({ leaderSchools: [holding('coach-gb', DEOSAI_KEY, 's-deosai')] });
    const out = await T.commitAdd({ actorLeaderUserId: 'coach-gb', schoolExtId: DEOSAI_KEY, rawPhone: NEW_NUMBER, name: 'New Teacher' });
    expect(out).toMatchObject({ outcome: 'new', wrote: true });
    const created = mockState.inserted.find((i) => i.table === 'users');
    expect(created.row).toMatchObject({ school_id: 's-deosai', role: 'teacher' });
    const audit = mockState.inserted.find((i) => i.table === 'leader_roster_audit');
    expect(JSON.stringify(audit.row)).toContain(DEOSAI_KEY);
  });

  it('an existing teacher elsewhere is moved there', async () => {
    seed({
      leaderSchools: [holding('coach-gb', DEOSAI_KEY, 's-deosai')],
      users: [{ id: 'u1', phone_number: '923001234567', role: 'teacher', school_id: 's-901', name: 'Existing Teacher' }],
    });
    const plan = await T.planAdd({ actorLeaderUserId: 'coach-gb', schoolExtId: DEOSAI_KEY, rawPhone: NEW_NUMBER });
    expect(plan).toMatchObject({ outcome: 'move', fromSchoolExtId: 'niete:901', toSchoolName: DEOSAI.name });
  });

  it('a teacher already at Deosai is "already here", not a refusal', async () => {
    seed({
      leaderSchools: [holding('coach-gb', DEOSAI_KEY, 's-deosai')],
      users: [{ id: 'u1', phone_number: '923001234567', role: 'teacher', school_id: 's-deosai', name: 'Deosai Teacher' }],
    });
    const plan = await T.planAdd({ actorLeaderUserId: 'coach-gb', schoolExtId: DEOSAI_KEY, rawPhone: NEW_NUMBER });
    expect(plan.outcome).toBe('already_here');
  });

  it('a teacher moving OUT of Deosai is recorded from its key, never "niete:null"', async () => {
    seed({
      leaderSchools: [holding('coach-gb', DEOSAI_KEY, 's-deosai'), holding('coach-sector', 'niete:901', 's-901')],
      users: [{ id: 'u1', phone_number: '923001234567', role: 'teacher', school_id: 's-deosai', name: 'Deosai Teacher' }],
    });
    const plan = await T.planAdd({ actorLeaderUserId: 'coach-sector', schoolExtId: 'niete:901', rawPhone: NEW_NUMBER });
    expect(plan.outcome).toBe('move');
    expect(plan.fromSchoolName).toBe(DEOSAI.name);
    expect(plan.fromSchoolExtId).toBe(DEOSAI_KEY);
    expect(plan.fromSchoolExtId).not.toMatch(/null/);
  });
});

// ── the guard it must keep ───────────────────────────────────────────────────────────────────

describe('it is still HER school or nothing', () => {
  it('a coach who does not hold Deosai is refused', async () => {
    seed({ leaderSchools: [holding('someone-else', DEOSAI_KEY, 's-deosai')] });
    const plan = await T.planAdd({ actorLeaderUserId: 'coach-gb', schoolExtId: DEOSAI_KEY, rawPhone: NEW_NUMBER });
    expect(plan.outcome).toBe('not_my_school');
  });

  it('a holding whose school_id names no school is refused', async () => {
    seed({ leaderSchools: [holding('coach-gb', DEOSAI_KEY, 's-gone')] });
    const plan = await T.planAdd({ actorLeaderUserId: 'coach-gb', schoolExtId: DEOSAI_KEY, rawPhone: NEW_NUMBER });
    expect(plan.outcome).toBe('not_my_school');
  });

  it('removing teachers at Deosai checks the same school and clears only its teachers', async () => {
    seed({
      leaderSchools: [holding('coach-gb', DEOSAI_KEY, 's-deosai')],
      users: [{ id: 'u1', phone_number: '923001234567', role: 'teacher', school_id: 's-deosai', name: 'Deosai Teacher' }],
    });
    const out = await T.commitRemovals({ actorLeaderUserId: 'coach-gb', schoolExtId: DEOSAI_KEY, userIds: ['u1'] });
    expect(out.ok).toBe(true);
    expect(out.removed).toHaveLength(1);
  });
});

// ── schools with an EMIS: unchanged ───────────────────────────────────────────────────────────

describe('a school with an EMIS behaves as before', () => {
  it('a holding with school_id: allowed, EMIS reported as it is', async () => {
    seed({ leaderSchools: [holding('coach-sector', 'niete:901', 's-901')] });
    const plan = await T.planAdd({ actorLeaderUserId: 'coach-sector', schoolExtId: 'niete:901', rawPhone: NEW_NUMBER });
    expect(plan.outcome).toBe('new');
    expect(plan.target).toMatchObject({ school_id: 's-901', emis: '901', school_ext_id: 'niete:901' });
  });

  it('an old holding written before school_id existed still finds its school by EMIS', async () => {
    seed({ leaderSchools: [holding('coach-sector', 'niete:901', null)] });
    const plan = await T.planAdd({ actorLeaderUserId: 'coach-sector', schoolExtId: 'niete:901', rawPhone: NEW_NUMBER });
    expect(plan.outcome).toBe('new');
    expect(plan.target).toMatchObject({ school_id: 's-901', emis: '901' });
  });
});

// ── adding the school itself ─────────────────────────────────────────────────────────────────

describe('adding a school with no EMIS to her list', () => {
  it('takes the school another coach already holds: no second Deosai is created', async () => {
    seed({ leaderSchools: [holding('coach-other', DEOSAI_KEY, 's-deosai', { school_name: DEOSAI.name })] });
    const school = await S.resolveOrCreateSchool(require(SUPABASE), DEOSAI_KEY);
    expect(school).toMatchObject({ school_id: 's-deosai', name: DEOSAI.name });
    expect(school.emis).toBeNull();
    expect(mockState.inserted.filter((i) => i.table === 'schools')).toHaveLength(0);
  });

  it('the new holding points at the real school and stores no "null" EMIS', async () => {
    seed({ leaderSchools: [holding('coach-other', DEOSAI_KEY, 's-deosai', { school_name: DEOSAI.name })] });
    const out = await S.addSchoolForCoach('coach-gb', DEOSAI_KEY);
    expect(out).toMatchObject({ ok: true, schoolName: DEOSAI.name });
    const made = mockState.inserted.filter((i) => i.table === 'leader_schools').map((i) => i.row);
    expect(made).toHaveLength(1);
    expect(made[0]).toMatchObject({ leader_user_id: 'coach-gb', school_ext_id: DEOSAI_KEY, school_id: 's-deosai' });
    expect(made[0].emis).toBeNull();
    expect(mockState.inserted.filter((i) => i.table === 'schools')).toHaveLength(0);
  });

  it('a school with an EMIS still resolves by it, and its holding keeps the EMIS', async () => {
    const school = await S.resolveOrCreateSchool(require(SUPABASE), 'niete:901');
    expect(school).toMatchObject({ school_id: 's-901', emis: '901' });
    expect(mockState.inserted).toHaveLength(0);
  });
});
