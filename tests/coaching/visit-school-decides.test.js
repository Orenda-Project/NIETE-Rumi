'use strict';
/**
 * bd-dsu5mq.2 (queue #291) — the VISIT'S SCHOOL decides ICT vs GB for every observe switch and rubric, never the
 * observer's profile users.region. Operator, 26 Nov ~21:40: "Your suggestion looks better": the rubric and every
 * region-based observe / DC switch (FICO-S vs FICO17, fico_s_coach / fico_s_dc, obs612, the Digital Coach pre-fill,
 * fde-region's rules) decide from the visit's school; the coach-made region fill stays as data hygiene only.
 *
 * Why: coach Misbah made teacher Muhammad Ayyaz Nawaz a Principal at IMCB I-8/3 (an ICT school) on 26 Nov. His profile
 * region was blank, so "role:principal@ict" missed him and his grade 6 lesson got FDE's hand-scored form, while the coach
 * and another principal observing the SAME lesson got FICO-S with the Digital Coach's pre-fill.
 *
 * Real: fde-region, fico-s-switch, obs612-switch, fico-rubric-switch, obs612/visit.js asksClass,
 * observe-fico17-v6 decideVisitFramework, region-registry. Faked: the Supabase client (in memory), logger, WhatsApp.
 * The switch rows are prod's own shapes (26 Nov): role:<role>@ict keys, obs612's role:principal@gb off.
 */

jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({ sendMessage: jest.fn(), sendFlow: jest.fn(), sendInteractiveButtons: jest.fn() }));
jest.mock('../../bot/shared/services/observe/observe-state.service', () => ({ setState: jest.fn(), getState: jest.fn(), clearState: jest.fn() }));

let mockTables;
let mockFail;
jest.mock('../../bot/shared/config/supabase', () => ({
  from(table) {
    const filters = [];
    let lim = null;
    let single = false;
    const run = () => {
      if (mockFail.has(table)) return { data: null, error: { message: `${table} read refused` } };
      let rows = (mockTables[table] || []).filter((r) => filters.every(([k, c, v]) => (k === 'in' ? v.includes(r[c]) : r[c] === v)));
      if (lim != null) rows = rows.slice(0, lim);
      return single ? { data: rows[0] || null, error: null } : { data: rows.map((r) => ({ ...r })), error: null };
    };
    const b = {
      select() { return b; },
      eq(c, v) { filters.push(['eq', c, v]); return b; },
      in(c, vs) { filters.push(['in', c, vs]); return b; },
      order() { return b; },
      limit(n) { lim = n; return b; },
      maybeSingle() { single = true; return b; },
      single() { single = true; return b; },
      then(res, rej) { return Promise.resolve(run()).then(res, rej); },
    };
    return b;
  },
}));

const ROLLOUT = { 'role:coach@ict': 'on', 'role:principal@ict': 'on' };

beforeEach(() => {
  jest.resetModules();
  mockFail = new Set();
  mockTables = {
    region_features: [
      { region: 'urban-ii', organization: 'niete', display_name: 'Urban-II', sort_order: 5, is_active: true },
      { region: 'gilgit-baltistan', organization: 'moawin', display_name: 'Gilgit-Baltistan', sort_order: 8, is_active: true },
    ],
    schools: [
      { id: 's-ict', name: 'IMCB, I-8/3', region: 'Urban-II', is_probable_test: false },
      { id: 's-gb', name: 'Moawin School Chilas', region: 'Gilgit-Baltistan', is_probable_test: false },
      { id: 's-unlisted', name: 'A school in a region the registry does not list', region: 'federal', is_probable_test: false },
    ],
    leader_schools: [],
    users: [],
    app_settings: [
      { key: 'fico_s_coach', value: ROLLOUT },
      { key: 'fico_s_dc', value: ROLLOUT },
      { key: 'obs612_coach', value: { 'role:principal': 'on', 'role:principal@gb': 'off', 'role:coach@ict': 'on' } },
      { key: 'fico_coach_rubric', value: { 'role:principal': 'v6', 'role:coach': 'v6' } },
    ],
  };
});

const person = (over) => {
  const u = { id: 'u-1', role: 'principal', region: null, source: null, school_id: null, organization: null, ...over };
  mockTables.users.push(u);
  return u;
};
const ficoS = () => require('../../bot/shared/services/coaching/fico-s-switch');
const asksClass = (u, v) => require('../../bot/shared/services/observe/obs612/visit').asksClass(u, v);
const FR = () => require('../../bot/shared/services/coaching/fde-region');

describe("Ayyaz's case: blank profile region, ICT school", () => {
  it('a principal with NO users.region observing at an ICT school gets FICO-S, the Digital Coach and the class question', async () => {
    const ayyaz = person({ id: 'u-ayyaz', region: null, school_id: 's-ict' });
    const visit = { schoolId: 's-ict' };
    expect(await ficoS().forVisit(ayyaz, visit)).toBe(true);
    expect(await ficoS().dcForVisit(ayyaz, visit)).toBe(true);
    expect(await asksClass(ayyaz, visit)).toBe(true);
  });

  it('the same, with no school on his own row: the VISIT\'s school decides (the school the coach picked)', async () => {
    const p = person({ id: 'u-p', region: null, school_id: null });
    mockTables.leader_schools.push({ leader_user_id: 'u-p', school_ext_id: 'niete:910', school_id: 's-ict' });
    expect(await ficoS().dcForVisit(p, { schoolExtId: 'niete:910' })).toBe(true);
  });

  it('the observed teacher\'s school decides when that is all the visit names', async () => {
    const p = person({ id: 'u-p', region: null });
    mockTables.users.push({ id: 't-1', role: 'teacher', region: null, source: null, school_id: 's-ict' });
    expect(await ficoS().dcForVisit(p, { teacherUserId: 't-1' })).toBe(true);
  });
});

describe('a GB observer at a GB school: FICO17 v6 at every grade', () => {
  it('no FICO-S, no Digital Coach FICO-S visit, no class question (so no FDE form); the coach rubric is v6', async () => {
    const gb = person({ id: 'u-gb', region: 'Gilgit-Baltistan', school_id: 's-gb' });
    const visit = { schoolId: 's-gb' };
    expect(await ficoS().forVisit(gb, visit)).toBe(false);
    expect(await ficoS().dcForVisit(gb, visit)).toBe(false);
    expect(await asksClass(gb, visit)).toBe(false);
    process.env.OBSERVE_FRAMEWORK = 'fico';
    process.env[require('../../bot/shared/services/observe/observe-fico17-v6').READY_ENV] = 'true';
    try {
      const V = require('../../bot/shared/services/observe/observe-fico17-v6');
      expect(await V.decideVisitFramework({ userId: 'u-gb', schoolExtId: null, teacherUserId: null })).toBe(V.V6);
    } finally {
      delete process.env.OBSERVE_FRAMEWORK;
      delete process.env[require('../../bot/shared/services/observe/observe-fico17-v6').READY_ENV];
    }
  });
});

describe('the profile region never decides', () => {
  it('a profile that says GB, observing at an ICT school: FICO-S and the Digital Coach (the school is ICT)', async () => {
    const p = person({ id: 'u-x', region: 'Gilgit-Baltistan', school_id: null });
    expect(await ficoS().dcForVisit(p, { schoolId: 's-ict' })).toBe(true);
    expect(await asksClass(p, { schoolId: 's-ict' })).toBe(true);
  });

  it('a profile that says Urban-II (ICT), observing at a GB school: no FICO-S, no FDE (the school is GB)', async () => {
    const p = person({ id: 'u-y', region: 'Urban-II', school_id: 's-ict' });
    expect(await ficoS().forVisit(p, { schoolId: 's-gb' })).toBe(false);
    expect(await asksClass(p, { schoolId: 's-gb' })).toBe(false);
  });

  it('fde-region: a visit that names no school and no teacher is NOT decided by the observer\'s profile region', async () => {
    const p = person({ id: 'u-z', region: 'Gilgit-Baltistan', school_id: null });
    expect(await FR().visitRegion({ observer: p })).toBe('unknown');
  });

  it('fde-region: the GB import source still says GB, and the observer\'s own school still decides when nothing else does', async () => {
    const gbImport = person({ id: 'u-imp', source: 'main_rumi_gb' });
    expect(await FR().visitRegion({ observer: gbImport })).toBe('gb');
    const atGb = person({ id: 'u-own', school_id: 's-gb' });
    expect(await FR().visitRegion({ observer: atGb })).toBe('gb');
  });
});

describe('a visit that names no school yet (the portal\'s class question): the schools she holds, never her profile', () => {
  it('a coach holding only GB schools is not asked the class; one holding only ICT schools is', async () => {
    const gb = person({ id: 'c-gb', role: 'coach', region: null });
    mockTables.leader_schools.push({ leader_user_id: 'c-gb', school_ext_id: 'niete:gb-1', school_id: 's-gb' });
    expect(await asksClass(gb, {})).toBe(false);
    const ict = person({ id: 'c-ict', role: 'coach', region: 'Gilgit-Baltistan' }); // a profile that says GB: ignored
    mockTables.leader_schools.push({ leader_user_id: 'c-ict', school_ext_id: 'niete:910', school_id: 's-ict' });
    expect(await asksClass(ict, {})).toBe(true);
  });

  it('a coach holding schools on both sides has nothing to go on: this deployment\'s side, ICT', async () => {
    const both = person({ id: 'c-both', role: 'coach', region: null });
    mockTables.leader_schools.push(
      { leader_user_id: 'c-both', school_ext_id: 'niete:910', school_id: 's-ict' },
      { leader_user_id: 'c-both', school_ext_id: 'niete:gb-1', school_id: 's-gb' },
    );
    expect(await FR().visitRegion({ observer: both })).toBe('unknown');
    expect(await asksClass(both, {})).toBe(true);
  });
});

describe('who the observer is still decides first, and failures fail closed', () => {
  it('her own "user:" key beats the place (an observer switched off stays off at an ICT school)', async () => {
    const p = person({ id: 'u-off', region: null });
    mockTables.app_settings.find((r) => r.key === 'fico_s_dc').value = { ...ROLLOUT, 'user:u-off': 'off' };
    expect(await ficoS().dcForVisit(p, { schoolId: 's-ict' })).toBe(false);
    expect(await ficoS().forVisit(p, { schoolId: 's-ict' })).toBe(true);
  });

  it('a school the registry does not list is this deployment\'s side (ICT), as fdeAllowed treats it', async () => {
    const p = person({ id: 'u-f', region: null });
    expect(await ficoS().dcForVisit(p, { schoolId: 's-unlisted' })).toBe(true);
  });

  it('a visit whose school cannot be read gets no FICO-S and no class question', async () => {
    const p = person({ id: 'u-e', region: 'Urban-II' });
    mockFail.add('schools');
    expect(await ficoS().forVisit(p, { schoolId: 's-ict' })).toBe(false);
    expect(await asksClass(p, { schoolId: 's-ict' })).toBe(false);
  });

  it('switchWho carries the visit\'s school region and organization, never the profile region', () => {
    const who = FR().switchWho({ id: 'u-1', role: 'principal', region: 'Gilgit-Baltistan' }, { side: 'ict', region: 'Urban-II' });
    expect(who).toEqual({ userId: 'u-1', role: 'principal', region: 'Urban-II', organization: 'niete' });
  });
});
