/**
 * bd-tsa15l (queue #322, operator 27 Nov 2026): the Trainings tab showed ~6,000 ICT primary teachers where the RDF's
 * live roster (ICT v45, rdf_niete/live_roster.py) and the data server's headcount say ~3,250. The population is now
 * the canonical one: role 'teacher', not a test account, at a school on FDE's programme list, sector = her school's.
 */
const { summarizeTrainingLevels, trainingStatesSql } = require('../../dashboard/services/training-levels-analytics.service');

const LEVELS = [0, 1, 2, 3].map((i) => ({ id: String(i + 1), name: `L${i}`, order_index: i }));
const school = (id, region, extra = {}) => ({ id, name: id, emis: `E-${id}`, region, is_active: true, is_probable_test: false, ...extra });
const mem = (user_id, school_id, extra = {}) => ({
  user_id, school_id, primary_cohort: true, mh_cohort: false, middle_band: false, high_band: false,
  cert_levels: null, active_levels: null, ox_mask: 0, ox_cert: false, ox_active: false, bh_mask: 0, bh_active: false,
  isaps_assigned: false, isaps_cert: false, isaps_mask: 0, isaps_active: false, ...extra,
});
const lists = () => ({
  fdeSchoolEmis: new Set(['E-s1']), primary: new Map(), midHigh: new Map(), coaches: [],
  asOf: {}, missing: { schools: false, teachers: false, coaches: false },
});

describe('the Trainings population is the canonical ICT teacher', () => {
  it('SQL: only role teacher, not a test account', () => {
    const code = trainingStatesSql().replace(/--[^\n]*/g, '');
    expect(code).toMatch(/u\.role = 'teacher'/);
    expect(code).toMatch(/u\.is_test_user IS NOT TRUE/);
  });

  it('a member at a school off the programme list is in no number', () => {
    const out = summarizeTrainingLevels({
      levels: LEVELS, schools: [school('s1', 'B.K'), school('x9', 'B.K')], lists: lists(),
      members: [mem('a', 's1'), mem('b', 'x9'), mem('c', null)],
    }, { band: 'primary' });
    expect(out.overview.teachers).toBe(1);
    expect(out.noSector.teachers).toBe(0);
  });

  it("sector is her school's region, not the August allocation", () => {
    const rows = {
      levels: LEVELS, schools: [school('s1', 'B.K')], lists: { ...lists(), primary: new Map([['a', 'Tarnol']]), sectorByUser: new Map([['a', 'Tarnol']]) },
      members: [mem('a', 's1')],
    };
    const out = summarizeTrainingLevels(rows, { band: 'primary' });
    expect(out.regions.find((r) => r.region === 'B.K').teachers).toBe(1);
    expect(out.regions.find((r) => r.region === 'Tarnol').teachers).toBe(0);
  });
});

describe('I-SAPS "assigned" follows the portal/bot band gate (Grades 9-12 only)', () => {
  const code = trainingStatesSql().replace(/--[^\n]*/g, '');
  it('through a band programme only for a HIGH teacher or one with earned work; the pilot is not gated', () => {
    expect(code).toMatch(/isaps_work AS MATERIALIZED/);
    expect(code).toMatch(/upper\(btrim\(gb\.v\)\) = 'HIGH'/);
    expect(code).toMatch(/gp\.key NOT IN \('niete_primary', 'niete_middle_high'\)/);
    expect(code).toMatch(/a\.user_id IN \(SELECT user_id FROM isaps_work\)/);
  });
});

describe("Hashir's seven combinations on the dashboard cards", () => {
  const L4 = [0, 1, 2, 3].map((i) => ({ id: String(i + 1), name: `L${i}`, order_index: i }));
  const CAT = [
    { partner: 'oxbridge', bit: 0, name: 'SESSION#1' }, { partner: 'beaconhouse', bit: 1, name: 'English' },
    { partner: 'isaps', bit: 0, name: 'Level 1', level_id: '27' },
  ];
  const band = (p, m, h) => ({ primary_band: p, middle_band: m, high_band: h, primary_cohort: p, mh_cohort: m || h });
  const COMBOS = {
    P: band(true, false, false), PM: band(true, true, false), PMH: band(true, true, true), PH: band(true, false, true),
    MH: band(false, true, true), M: band(false, true, false), H: band(false, false, true),
  };
  const members = Object.entries(COMBOS).map(([k, b]) => mem(k, 's1', { ...b }));
  const run = (bandKey) => summarizeTrainingLevels({
    levels: L4, schools: [school('s1', 'B.K')], lists: lists(), partners: CAT, members,
  }, { band: bandKey }).overview;

  it('Primary section = every PRIMARY teacher (P, PM, PMH, PH), NIETE 0-3', () => {
    const o = run('primary');
    expect(o.teachers).toBe(4);
    expect(o.levels.map((l) => l.teachers)).toEqual([4, 4, 4, 4]);
  });

  it('Middle/High section = every MIDDLE or HIGH teacher (PM, PMH, PH, MH, M, H)', () => {
    expect(run('midhigh').teachers).toBe(6);
  });

  it('NIETE 2-3 on the Mid/High tab: everyone required to take it, not High-only', () => {
    const o = run('midhigh');
    expect(o.levels.map((l) => l.teachers)).toEqual([5, 5]);
  });

  it('GBTLA and AI-Powered Subject Pedagogy: MIDDLE teachers only (PM, PMH, MH, M)', () => {
    const p = run('midhigh').partners;
    expect(p.oxbridge.teachers).toBe(4);
    expect(p.beaconhouse.teachers).toBe(4);
  });

  it('Teacher Development Programme: HIGH teachers only (PMH, PH, MH, H)', () => {
    const p = run('midhigh').partners;
    expect(p.isaps.teachers).toBe(4);
    expect(p.isaps.levels).toHaveLength(1);
  });

  it('AI-Powered Subject Pedagogy is Completed when any one subject is', () => {
    const rows = { levels: L4, schools: [school('s1', 'B.K')], lists: lists(), partners: CAT,
      members: [mem('a', 's1', { ...COMBOS.M, bh_mask: 2 }), mem('b', 's1', { ...COMBOS.M, bh_active: true }), mem('c', 's1', { ...COMBOS.M })] };
    const bh = summarizeTrainingLevels(rows, { band: 'midhigh' }).overview.partners.beaconhouse;
    expect([bh.passed, bh.inProgress, bh.notStarted]).toEqual([1, 1, 1]);
  });
});
