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
