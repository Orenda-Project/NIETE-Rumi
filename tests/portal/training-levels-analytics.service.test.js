/**
 * The Trainings tab (schools analytics v8, FDE feedback 2026-10-19): the RDF's training numbers, NIETE's level rule
 * for the rest, the RDF's sectors, FDE's school list. The pure summariser, the band / region filters, the SQL's
 * shape, and the 30-minute snapshot.
 *
 * Population (the RDF certificate card, rdf_niete/render.py training_certificates_block): live users — no deleted_at,
 * phone not a `merged:` tombstone — holding an ACTIVE assignment on the programme, any role, any school or none.
 *   Primary   niete_primary       NIETE levels 1-4
 *   Mid/High  niete_middle_high   NIETE Skilled Practitioner + Teacher Leader, GBTLA (Oxbridge), AI-Powered Subject
 *                                 Pedagogy (Beaconhouse), and the Teacher Development Programme (I-SAPS) for those
 *                                 assigned it
 * Passed = a certificate for the level (the RDF's numerator). Without one: In Progress when the bot's level rule has
 * the level under way (in progress, ready for its exam, exam passed); Not Started otherwise (incl. locked, or not on
 * her programme). Every level's denominator is the whole population, as the RDF's.
 * Sector = the RDF allocation sector (loadAnalyticsLists: the primary Map, then midHigh); none → the noSector block.
 * School = the member's school when its EMIS is on FDE's list, else a "No school" row in her sector.
 */

const {
  summarizeTrainingLevels,
  parseBandFilter,
  createSnapshot,
  trainingStatesSql,
  loadTrainingLevelRows,
  BANDS,
} = require('../../dashboard/services/training-levels-analytics.service');
const { REGION_BUCKETS } = require('../../dashboard/services/schools-analytics.service');

// The NIETE ladder as prod holds it (training_levels, vendor TALEEMABAD): ids are bigints, so they arrive as strings.
const LEVELS = [
  { id: '1', name: 'Aspiring Teacher', order_index: 0 },
  { id: '2', name: 'Emerging Practitioner', order_index: 1 },
  { id: '3', name: 'Skilled Practitioner', order_index: 2 },
  { id: '4', name: 'Teacher Leader', order_index: 3 },
];

const school = (id, region, extra = {}) => ({
  id, name: `School ${id}`, emis: `E-${id}`, region, is_active: true, is_probable_test: false, ...extra,
});

const CATALOGUE = [
  ...[1, 2, 3, 4, 5, 6, 7].map((n) => ({ partner: 'oxbridge', bit: n - 1, name: `SESSION#${n}` })),
  { partner: 'beaconhouse', bit: 1, name: 'English' },
  { partner: 'beaconhouse', bit: 2, name: 'Mathematics' },
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => ({ partner: 'isaps', bit: n - 1, name: `Module ${n}` })),
];

/** One row of the members read: a programme member and her facts. Level ids arrive as strings (bigint). */
const mem = (user_id, extra = {}) => ({
  user_id,
  school_id: null,
  primary_cohort: false,
  mh_cohort: false,
  middle_band: false,
  high_band: false,
  cert_levels: null,
  active_levels: null,
  ox_mask: 0,
  ox_cert: false,
  ox_active: false,
  bh_mask: 0,
  bh_active: false,
  isaps_assigned: false,
  isaps_cert: false,
  isaps_mask: 0,
  isaps_active: false,
  ...extra,
});
const ids = (...n) => n.map(String);

/** loadAnalyticsLists' answer (dashboard/lib/analytics-lists.js, the v8 shared contract). */
function lists(extra = {}) {
  return {
    fdeSchoolEmis: new Set(['E-s1', 'E-s2', 'E-s3']),
    primary: new Map([['p1', 'B.K'], ['p2', 'B.K'], ['p3', 'B.K'], ['p4', 'Sihala'], ['b1', 'Sihala']]),
    midHigh: new Map([['m1', 'Urban-I'], ['m2', 'Urban-I'], ['m4', 'Urban-I'], ['b1', 'Tarnol']]),
    coaches: [],
    asOf: { schools: '2026-10-19', teachers: '2026-08-04', coaches: '2026-09-24' },
    missing: { schools: false, teachers: false, coaches: false },
    ...extra,
  };
}

/** The lists when their app_settings rows are not usable (sandbox): null, never empty (FAIL-CLOSED). */
const MISSING = {
  fdeSchoolEmis: null, primary: null, midHigh: null, coaches: null,
  asOf: { schools: null, teachers: null, coaches: null },
  missing: { schools: true, teachers: true, coaches: true },
};

const P = { primary_cohort: true };
const MH = { mh_cohort: true };

function baseRows() {
  return {
    levels: LEVELS,
    schools: [
      school('s1', 'B.K'), school('s2', 'Urban-I'), school('s3', 'Sihala'), school('x9', 'B.K'),
      // v7's rule (used only when the school list is missing) does not count these
      school('t1', 'B.K', { is_probable_test: true }), school('t2', 'Durbeen'),
    ],
    partners: CATALOGUE,
    lists: lists(),
    members: [
      // Primary
      mem('p1', { ...P, school_id: 's1', cert_levels: ids(1, 2, 3, 4) }),
      mem('p2', { ...P, school_id: 's1', cert_levels: ids(1), active_levels: ids(2) }),
      // her school is not on FDE's list: a "No school" row in her sector
      mem('p3', { ...P, school_id: 'x9', cert_levels: ids(1, 2) }),
      mem('p4', { ...P, school_id: 's3', active_levels: ids(1) }),
      // a principal with no allocation sector, and someone with nothing at all and no school
      mem('p5', { ...P, school_id: 's1', cert_levels: ids(1), active_levels: ids(1) }),
      mem('p6', { ...P }),
      // Mid/High
      mem('m1', {
        ...MH, middle_band: true, school_id: 's2', cert_levels: ids(3, 4), ox_mask: 127, ox_cert: true, ox_active: true,
        bh_mask: 2, bh_active: true, isaps_assigned: true, isaps_cert: true, isaps_mask: 511, isaps_active: true,
      }),
      mem('m2', {
        ...MH, high_band: true, school_id: 's2', cert_levels: ids(3), active_levels: ids(4), ox_mask: 7, ox_active: true,
        bh_active: true, isaps_assigned: true, isaps_mask: 3, isaps_active: true,
      }),
      mem('m3', { ...MH, high_band: true, isaps_assigned: true }),
      // a migrated Oxbridge certificate with no session on record; not assigned I-SAPS
      mem('m4', { ...MH, middle_band: true, school_id: 's2', cert_levels: ids(3, 4), ox_cert: true }),
    ],
  };
}

const lvl = (block, order) => block.levels.find((l) => l.levelOrder === order);
const cells = (block) => block.levels.map((l) => [l.levelOrder, l.passed, l.inProgress, l.notStarted, l.teachers]);

describe('Primary — the RDF primary-programme population, certificates passed, NIETE rule for the rest', () => {
  const out = summarizeTrainingLevels(baseRows(), { band: 'primary' });

  it('four levels over every primary-programme member: Passed = certificate, In Progress = under way, else Not Started', () => {
    expect(out.overview.levels.map((l) => l.name)).toEqual(LEVELS.map((l) => l.name));
    expect(cells(out.overview)).toEqual([
      [0, 4, 1, 1, 6],
      [1, 2, 1, 3, 6],
      [2, 1, 0, 5, 6],
      [3, 1, 0, 5, 6],
    ]);
    expect(lvl(out.overview, 0).pctPassed).toBe(66.7);
  });

  it('a certificate wins over the level rule (the RDF counts the certificate, never the state)', () => {
    // p5 holds the Aspiring Teacher certificate and the rule still has the level under way
    expect(lvl(out.overview, 0).passed).toBe(4);
  });

  it('passed all levels = holds the Teacher Leader certificate, of the whole population', () => {
    expect(out.overview).toMatchObject({ teachers: 6, passedAll: 1 });
  });

  it('Mid/High-only members are in no Primary number', () => {
    expect(JSON.stringify(out)).not.toMatch(/m1|m2/);
    expect(out.overview.teachers).toBe(6);
  });

  it('per sector by the RDF allocation; members with none are the noSector block, and the parts sum to the whole', () => {
    expect(out.regions.map((r) => r.region)).toEqual(REGION_BUCKETS);
    const bk = out.regions.find((r) => r.region === 'B.K');
    expect(cells(bk)).toEqual([[0, 3, 0, 0, 3], [1, 2, 1, 0, 3], [2, 1, 0, 2, 3], [3, 1, 0, 2, 3]]);
    expect(out.regions.find((r) => r.region === 'Sihala')).toMatchObject({ teachers: 1, passedAll: 0 });
    expect(out.noSector).toMatchObject({ teachers: 2, passedAll: 0 });
    expect(lvl(out.noSector, 0)).toMatchObject({ passed: 1, inProgress: 0, notStarted: 1 });
    const sum = out.regions.reduce((n, r) => n + r.teachers, 0) + out.noSector.teachers;
    expect(sum).toBe(out.overview.teachers);
    for (const o of [0, 1, 2, 3]) {
      const passed = out.regions.reduce((n, r) => n + lvl(r, o).passed, 0) + lvl(out.noSector, o).passed;
      expect(passed).toBe(lvl(out.overview, o).passed);
    }
  });

  it("schools are FDE's list: a member at a school off the list is her sector's 'No school' row (the shared no-school id)", () => {
    expect(out.schools.map((s) => [s.region, s.schoolId, s.name, s.noSchool, s.teachers, s.passedAll])).toEqual([
      ['B.K', 's1', 'School s1', false, 2, 1],
      ['B.K', 'no-school:B.K', null, true, 1, 0],
      ['Sihala', 's3', 'School s3', false, 1, 0],
    ]);
    const none = out.schools.find((s) => s.noSchool);
    expect(none).toMatchObject({ emis: null });
    expect(none.levels.map((l) => [l.levelOrder, l.passed, l.teachers])).toEqual([[0, 1, 1], [1, 1, 1], [2, 0, 1], [3, 0, 1]]);
  });

  it("sectorByUser (every allocation-file user, any role) places a principal outside both teacher Maps in her RDF sector", () => {
    const rows = baseRows();
    // p5 is a principal: in neither teacher Map, on the allocation file in Nilore
    rows.lists = lists({ sectorByUser: new Map([['p1', 'B.K'], ['p2', 'B.K'], ['p3', 'B.K'], ['p4', 'Sihala'], ['p5', 'Nilore']]) });
    const out = summarizeTrainingLevels(rows, { band: 'primary' });
    expect(out.regions.find((r) => r.region === 'Nilore')).toMatchObject({ teachers: 1 });
    expect(lvl(out.regions.find((r) => r.region === 'Nilore'), 0).passed).toBe(1);
    expect(out.noSector.teachers).toBe(1);
    expect(out.schools.map((s) => [s.region, s.schoolId, s.teachers])).toContainEqual(['Nilore', 's1', 1]);
  });

  it('sectorByUser wins over the teacher Maps (it is the RDF\'s uid2sect); null falls back to them', () => {
    const rows = baseRows();
    rows.members = [mem('b1', { ...P, cert_levels: ids(1) })];
    rows.lists = lists({ sectorByUser: new Map([['b1', 'Urban-II']]) });
    expect(summarizeTrainingLevels(rows, { band: 'primary' }).regions.find((r) => r.region === 'Urban-II').teachers).toBe(1);
    rows.lists = lists({ sectorByUser: null });
    expect(summarizeTrainingLevels(rows, { band: 'primary' }).regions.find((r) => r.region === 'Sihala').teachers).toBe(1);
  });

  it('sectorByUser stands even when a teacher Map is missing; with neither, v7\'s school sector', () => {
    const rows = baseRows();
    rows.lists = lists({ primary: null, midHigh: null, missing: { schools: false, teachers: true, coaches: false },
      sectorByUser: new Map([['p5', 'Tarnol']]) });
    const out = summarizeTrainingLevels(rows, { band: 'primary' });
    expect(out.regions.find((r) => r.region === 'Tarnol').teachers).toBe(1);
    // the rest are not on the allocation file: the RDF's "no sector"
    expect(out.noSector.teachers).toBe(5);
  });

  it('the sector comes from the primary Map first, then midHigh', () => {
    const rows = baseRows();
    rows.members = [mem('b1', { ...P, mh_cohort: true, cert_levels: ids(1) })];
    expect(summarizeTrainingLevels(rows, { band: 'primary' }).regions.find((r) => r.region === 'Sihala').teachers).toBe(1);
    rows.lists = lists({ primary: new Map() });
    expect(summarizeTrainingLevels(rows, { band: 'primary' }).regions.find((r) => r.region === 'Tarnol').teachers).toBe(1);
  });
});

describe('Mid/High — the RDF middle/high-programme population', () => {
  const out = summarizeTrainingLevels(baseRows(), { band: 'midhigh' });
  const { oxbridge, beaconhouse, isaps } = out.overview.partners;

  it('NIETE Skilled Practitioner and Teacher Leader over every middle/high member, certificates passed', () => {
    expect(cells(out.overview)).toEqual([[2, 3, 0, 1, 4], [3, 2, 1, 1, 4]]);
  });

  it('GBTLA (Oxbridge) passed = its certificate, even with no session on record; sessions only move In Progress', () => {
    expect(oxbridge).toMatchObject({ passed: 2, inProgress: 1, notStarted: 1, teachers: 4, pctPassed: 50 });
    expect(oxbridge.sessions.map((s) => [s.name, s.middle, s.high, s.total])[0]).toEqual(['SESSION#1', 1, 1, 2]);
    expect(oxbridge.sessions[6]).toMatchObject({ middle: 1, high: 0, total: 1 });
    expect(oxbridge.completedAll).toEqual({ middle: 1, high: 0, total: 1 });
  });

  it('AI-Powered Subject Pedagogy (Beaconhouse) passed = a certificate for any subject; per subject middle / high / total', () => {
    expect(beaconhouse).toMatchObject({ passed: 1, inProgress: 1, notStarted: 2, teachers: 4 });
    expect(beaconhouse.levels.map((l) => [l.name, l.middle, l.high, l.total])).toEqual([['English', 1, 0, 1], ['Mathematics', 0, 0, 0]]);
  });

  it('passed all levels = NIETE Skilled Practitioner + Teacher Leader + GBTLA + Beaconhouse certificates; I-SAPS is not in it', () => {
    expect(out.overview).toMatchObject({ teachers: 4, passedAll: 1 });
    const rows = baseRows();
    rows.members = rows.members.map((m) => (m.user_id === 'm1' ? { ...m, isaps_cert: false, isaps_assigned: false } : m));
    expect(summarizeTrainingLevels(rows, { band: 'midhigh' }).overview.passedAll).toBe(1);
  });

  it('per sector, each partner with its own denominator; noSector carries partners too', () => {
    const ui = out.regions.find((r) => r.region === 'Urban-I');
    expect(ui.teachers).toBe(3);
    expect(ui.partners.oxbridge).toMatchObject({ passed: 2, teachers: 3 });
    expect(ui.partners.isaps).toMatchObject({ passed: 1, inProgress: 1, notStarted: 0, teachers: 2 });
    expect(out.noSector.partners.isaps).toMatchObject({ passed: 0, notStarted: 1, teachers: 1 });
    expect(ui.partners.isaps.modules).toBeUndefined();
  });

  it('Primary carries no partners', () => {
    const pr = summarizeTrainingLevels(baseRows(), { band: 'primary' });
    expect(pr.overview.partners).toBeUndefined();
    expect(pr.noSector.partners).toBeUndefined();
  });

  it('a member of both programmes counts in both tabs', () => {
    const rows = baseRows();
    rows.members = [mem('b1', { primary_cohort: true, mh_cohort: true, cert_levels: ids(1, 2, 3, 4) })];
    expect(summarizeTrainingLevels(rows, { band: 'primary' }).overview).toMatchObject({ teachers: 1, passedAll: 1 });
    expect(summarizeTrainingLevels(rows, { band: 'midhigh' }).overview.teachers).toBe(1);
  });
});

describe('band "all" — every member of either programme, once', () => {
  it('counts each member once', () => {
    const out = summarizeTrainingLevels(baseRows(), { band: 'all' });
    expect(out.overview.teachers).toBe(10);
  });
});

describe('the region filter', () => {
  it('scopes the overview and the schools to that sector; the six sectors and noSector stay', () => {
    const out = summarizeTrainingLevels(baseRows(), { band: 'primary', region: 'B.K' });
    expect(out.overview.teachers).toBe(3);
    expect(out.schools.every((s) => s.region === 'B.K')).toBe(true);
    expect(out.regions).toHaveLength(6);
    expect(out.noSector.teachers).toBe(2);
  });
});

describe('empty and odd input', () => {
  it('no rows: zeros, never null counts, % passed null', () => {
    const out = summarizeTrainingLevels({ levels: LEVELS }, { band: 'primary' });
    expect(cells(out.overview)).toEqual([[0, 0, 0, 0, 0], [1, 0, 0, 0, 0], [2, 0, 0, 0, 0], [3, 0, 0, 0, 0]]);
    expect(lvl(out.overview, 0).pctPassed).toBeNull();
    expect(out.noSector.teachers).toBe(0);
  });

  it('lists not usable (null, FAIL-CLOSED): v7 rules — sector = her counted school\'s region, rows = counted schools; never zeros', () => {
    for (const theLists of [MISSING, undefined]) {
      const rows = baseRows();
      rows.lists = theLists;
      rows.members = rows.members.concat([mem('p7', { ...P, school_id: 't1', cert_levels: ids(1) }), mem('p8', { ...P, school_id: 't2' })]);
      const out = summarizeTrainingLevels(rows, { band: 'primary' });
      // the population and its numbers do not depend on the lists
      expect(out.overview.teachers).toBe(8);
      expect(lvl(out.overview, 0).passed).toBe(5);
      expect(out.regions.find((r) => r.region === 'B.K').teachers).toBe(4);
      expect(out.regions.find((r) => r.region === 'Sihala').teachers).toBe(1);
      // no school (p6), a probable-test school (p7), a school outside the six (p8)
      expect(out.noSector.teachers).toBe(3);
      expect(out.schools.map((s) => [s.region, s.name, s.teachers])).toEqual([
        ['B.K', 'School s1', 3], ['B.K', 'School x9', 1], ['Sihala', 'School s3', 1],
      ]);
    }
  });

  it('only the school list missing: the RDF sectors stand, every counted school is a row', () => {
    const rows = baseRows();
    rows.lists = lists({ fdeSchoolEmis: null, missing: { schools: true, teachers: false, coaches: false } });
    const out = summarizeTrainingLevels(rows, { band: 'primary' });
    expect(out.regions.find((r) => r.region === 'B.K').teachers).toBe(3);
    expect(out.schools.map((s) => [s.region, s.name, s.teachers])).toEqual([
      ['B.K', 'School s1', 2], ['B.K', 'School x9', 1], ['Sihala', 'School s3', 1],
    ]);
  });

  it('only the teacher lists missing: sectors from the counted school, FDE\'s list still decides the rows', () => {
    const rows = baseRows();
    rows.lists = lists({ primary: null, midHigh: null, missing: { schools: false, teachers: true, coaches: false } });
    const out = summarizeTrainingLevels(rows, { band: 'primary' });
    expect(out.regions.find((r) => r.region === 'B.K').teachers).toBe(4);
    expect(out.schools.map((s) => [s.region, s.schoolId, s.teachers])).toEqual([
      ['B.K', 's1', 3], ['B.K', 'no-school:B.K', 1], ['Sihala', 's3', 1],
    ]);
  });

  it('carries no member identity', () => {
    const out = summarizeTrainingLevels(baseRows(), { band: 'midhigh' });
    expect(JSON.stringify(out)).not.toMatch(/"m[1-4]"|"p[1-6]"|user_id|userId/);
  });
});

describe('the members read (set-based; one statement)', () => {
  const code = trainingStatesSql().replace(/--[^\n]*/g, '');

  it('the population is the RDF\'s: an ACTIVE niete_primary / niete_middle_high assignment, live users, any role or school', () => {
    expect(code).toMatch(/'niete_primary'/);
    expect(code).toMatch(/'niete_middle_high'/);
    expect(code).toMatch(/a\.is_active/);
    expect(code).toMatch(/u\.deleted_at IS NULL/);
    expect(code).toMatch(/NOT LIKE 'merged%'/);
    expect(code).not.toMatch(/u\.role = 'teacher'/);
    expect(code).not.toMatch(/is_test_user/);
    expect(code).not.toMatch(/u\.school_id IS NOT NULL/);
  });

  it('Passed is the certificate: cert_levels from training_certificates; the rule\'s states only feed active_levels', () => {
    expect(code).toMatch(/FROM training_certificates/);
    expect(code).toMatch(/cert_levels/);
    expect(code).toMatch(/active_levels/);
    expect(code).toMatch(/state IN \('in_progress', 'ready_for_quiz', 'certified'\)/);
  });

  it('one row per member, folded by UNION ALL + GROUP BY: no LATERAL, no JOIN between two big CTEs', () => {
    expect(code).not.toMatch(/LATERAL/i);
    expect((code.match(/AS MATERIALIZED/g) || []).length).toBeGreaterThanOrEqual(5);
    const big = ['members', 'visible', 'done', 'exams', 'certs', 'facts', 'judged', 'ordered', 'states', 'member_facts'];
    const joined = [...code.matchAll(/JOIN\s+([a-z_]+)/g)].map((m) => m[1]);
    expect(joined.filter((t) => big.includes(t))).toEqual([]);
    expect(code).toMatch(/GROUP BY f\.user_id/);
  });

  it('keeps the bot\'s level rule for In Progress / Not Started: chain lock first, then the five states in order', () => {
    expect(code).toMatch(/level_unlock_logic/);
    expect(code).toMatch(/prev_order = o\.order_index - 1 AND NOT o\.prev_certified/);
    const at = (s) => code.indexOf(`THEN '${s}'`);
    expect(at('locked')).toBeGreaterThan(-1);
    expect(at('locked')).toBeLessThan(at('certified'));
    expect(at('certified')).toBeLessThan(at('ready_for_quiz'));
    expect(at('ready_for_quiz')).toBeLessThan(at('in_progress'));
  });

  it('partners: Oxbridge / Beaconhouse certificates; I-SAPS by vendor KEY, its assignment through the programme scopes', () => {
    expect(code).toMatch(/v\.key = 'OXBRIDGE'/);
    expect(code).toMatch(/v\.key = 'BEACONHOUSE'/);
    expect(code).toMatch(/v\.key = 'ISAPS'/);
    expect(code).not.toMatch(/Teacher Development Programme|'I-SAPS'/);
    for (const col of ['ox_cert', 'ox_mask', 'bh_mask', 'bh_active', 'isaps_assigned', 'isaps_cert', 'isaps_mask', 'isaps_active']) {
      expect(code).toMatch(new RegExp(`AS ${col}`));
    }
    expect(code).toMatch(/isaps_exams AS MATERIALIZED/);
    expect(code).toMatch(/training_program_scopes/);
  });
});

describe('loadTrainingLevelRows', () => {
  it('four reads (levels, schools, the partner catalogue, members) plus the lists, no parameters from the request', async () => {
    const seen = [];
    const query = jest.fn(async (sql, params) => {
      seen.push({ sql, params });
      if (/member_facts/.test(sql)) return { rows: [mem('p1', P)] };
      if (/'oxbridge' AS partner/.test(sql)) return { rows: [{ partner: 'oxbridge', bit: 0, name: 'SESSION#1' }] };
      if (/FROM training_levels l\s+JOIN training_vendors/.test(sql)) return { rows: LEVELS };
      if (/FROM schools/.test(sql)) return { rows: [school('s1', 'B.K')] };
      return { rows: [] };
    });
    const theLists = lists();
    const loadLists = jest.fn(async () => theLists);
    const rows = await loadTrainingLevelRows(query, loadLists);
    expect(query).toHaveBeenCalledTimes(4);
    expect(loadLists).toHaveBeenCalledTimes(1);
    for (const q of seen) expect(q.params === undefined || q.params.length === 0).toBe(true);
    expect(rows.levels).toEqual(LEVELS);
    expect(rows.schools).toHaveLength(1);
    expect(rows.partners).toEqual([{ partner: 'oxbridge', bit: 0, name: 'SESSION#1' }]);
    expect(rows.members).toHaveLength(1);
    expect(rows.lists).toBe(theLists);
  });
});

describe('BANDS', () => {
  it('Primary levels 1-4, Mid/High levels 3-4', () => {
    expect(BANDS.primary.orders).toEqual([0, 1, 2, 3]);
    expect(BANDS.midhigh.orders).toEqual([2, 3]);
  });
});

describe('parseBandFilter', () => {
  it('blank or absent is Primary (her default tab)', () => {
    for (const raw of [undefined, null, '', '  ']) expect(parseBandFilter(raw)).toEqual({ ok: true, band: 'primary' });
  });

  it('primary, midhigh and all in any case; her spellings mid_high and mid-high too', () => {
    expect(parseBandFilter('PRIMARY')).toEqual({ ok: true, band: 'primary' });
    expect(parseBandFilter('midhigh')).toEqual({ ok: true, band: 'midhigh' });
    expect(parseBandFilter('mid_high')).toEqual({ ok: true, band: 'midhigh' });
    expect(parseBandFilter('Mid-High')).toEqual({ ok: true, band: 'midhigh' });
    expect(parseBandFilter('all')).toEqual({ ok: true, band: 'all' });
  });

  it('anything else is refused', () => {
    for (const raw of ['secondary', 'high', ['primary'], 3, "primary'; drop"]) expect(parseBandFilter(raw)).toEqual({ ok: false });
  });

  it('the band table: Primary levels 1-4, Mid/High levels 3-4', () => {
    expect(BANDS.primary.orders).toEqual([0, 1, 2, 3]);
    expect(BANDS.midhigh.orders).toEqual([2, 3]);
    expect(BANDS.all.orders).toEqual([0, 1, 2, 3]);
  });
});

describe('createSnapshot — at most every 30 minutes, never blocking on a refresh', () => {
  function clock(start = 1_000_000) {
    let t = start;
    return { now: () => t, advance: (ms) => { t += ms; } };
  }
  const deferred = () => {
    let resolve; let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
  };

  it('the first request computes; concurrent first requests share ONE computation', async () => {
    const c = clock();
    const d = deferred();
    const load = jest.fn(() => d.promise);
    const snap = createSnapshot({ load, now: c.now });
    const a = snap.get();
    const b = snap.get();
    d.resolve({ v: 1 });
    const [ra, rb] = await Promise.all([a, b]);
    expect(load).toHaveBeenCalledTimes(1);
    expect(ra).toBe(rb);
    expect(ra.rows).toEqual({ v: 1 });
    expect(ra.computedAt).toBe(new Date(1_000_000).toISOString());
  });

  it('within 30 minutes the snapshot is served as is', async () => {
    const c = clock();
    const load = jest.fn(async () => ({ v: load.mock.calls.length }));
    const snap = createSnapshot({ load, now: c.now });
    await snap.get();
    c.advance(30 * 60 * 1000 - 1);
    const again = await snap.get();
    expect(load).toHaveBeenCalledTimes(1);
    expect(again.rows).toEqual({ v: 1 });
  });

  it('past 30 minutes: the old snapshot comes back at once, ONE refresh runs behind it, and the next request gets the new one', async () => {
    const c = clock();
    let gate = null;
    const load = jest.fn(() => (gate ? gate.promise : Promise.resolve({ v: 1 })));
    const snap = createSnapshot({ load, now: c.now });
    await snap.get();
    c.advance(30 * 60 * 1000);
    gate = deferred();
    const stale1 = await snap.get();
    const stale2 = await snap.get();
    expect(stale1.rows).toEqual({ v: 1 });
    expect(stale2.rows).toEqual({ v: 1 });
    expect(load).toHaveBeenCalledTimes(2); // one refresh, shared
    gate.resolve({ v: 2 });
    await gate.promise;
    await new Promise((r) => setImmediate(r));
    const fresh = await snap.get();
    expect(fresh.rows).toEqual({ v: 2 });
    expect(fresh.computedAt).toBe(new Date(1_000_000 + 30 * 60 * 1000).toISOString());
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('a failed refresh keeps the old snapshot and is reported, and a later request tries again', async () => {
    const c = clock();
    const onError = jest.fn();
    let fail = false;
    const load = jest.fn(async () => { if (fail) throw new Error('timeout'); return { v: load.mock.calls.length }; });
    const snap = createSnapshot({ load, now: c.now, onError });
    await snap.get();
    c.advance(31 * 60 * 1000);
    fail = true;
    expect((await snap.get()).rows).toEqual({ v: 1 });
    await new Promise((r) => setImmediate(r));
    expect(onError).toHaveBeenCalledTimes(1);
    fail = false;
    expect((await snap.get()).rows).toEqual({ v: 1 }); // still stale: this request starts the retry
    await new Promise((r) => setImmediate(r));
    expect((await snap.get()).rows).toEqual({ v: 3 });
  });

  it('a failed FIRST computation rejects (nothing to show) and the next request computes again', async () => {
    const c = clock();
    let fail = true;
    const load = jest.fn(async () => { if (fail) throw new Error('down'); return { v: 'ok' }; });
    const snap = createSnapshot({ load, now: c.now });
    await expect(snap.get()).rejects.toThrow('down');
    fail = false;
    expect((await snap.get()).rows).toEqual({ v: 'ok' });
    expect(load).toHaveBeenCalledTimes(2);
  });
});

// ── I-SAPS — #3065's tests (0720a8f67), adapted to the v8 rule ────────────────────────────────────────────────
// v8 (operator, 2026-10-19: the RDF's numbers rule) changes two things from #3065, nothing else: Passed is the I-SAPS
// level CERTIFICATE only (a teacher who passed all nine module exams but holds no certificate is In Progress), and the
// card counts the Mid/High members ASSIGNED I-SAPS (not every Mid/High teacher). One member row per teacher now, in
// place of #3065's grouped partner rows; the module breakdown (per module middle / high / total) is unchanged.
describe('Mid/High partners — I-SAPS', () => {
  const MODULES = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => ({ partner: 'isaps', bit: n - 1, name: `Module ${n}` }));
  const ALL9 = 0b111111111;
  let n = 0;
  /** `count` Mid/High members alike, at a sector (by sectorByUser), assigned I-SAPS unless said otherwise. */
  const pr = (sector, {
    middle = true, high = false, isaps = 0, active = false, cert = false, assigned = true, extra = {},
  }, count) => Array.from({ length: count }, () => {
    n += 1;
    return mem(`i${n}`, {
      mh_cohort: true, middle_band: middle, high_band: high, isaps_assigned: assigned, isaps_mask: isaps,
      isaps_active: active || isaps !== 0 || cert, isaps_cert: cert, _sector: sector, ...extra,
    });
  });
  function rows(extra = []) {
    n = 0;
    const r = baseRows();
    const members = [
      // B.K: 2 certified with all nine passed; 1 high teacher passed modules 1-3; 1 did a unit, no exam passed
      ...pr('B.K', { isaps: ALL9, cert: true }, 2),
      ...pr('B.K', { middle: false, high: true, isaps: 0b111 }, 1),
      ...pr('B.K', { active: true }, 1),
      // B.K: 1 middle+high teacher holds the certificate though module 9's pass is not on record; 3 nothing
      ...pr('B.K', { middle: true, high: true, isaps: 0b011111111, cert: true }, 1),
      ...pr('B.K', {}, 3),
      // Sihala: 1 teacher passed all nine exams, no certificate minted yet — v8: In Progress (#3065 counted it Passed)
      ...pr('Sihala', { isaps: ALL9 }, 1),
      // not assigned I-SAPS: in no I-SAPS number, certificate or not (#3065: "an uncounted school")
      ...pr('Tarnol', { isaps: ALL9, cert: true, assigned: false }, 40),
      ...extra,
    ];
    return {
      ...r,
      partners: [{ partner: 'oxbridge', bit: 0, name: 'SESSION#1' }, { partner: 'beaconhouse', bit: 1, name: 'English' }, ...MODULES],
      members,
      lists: lists({ sectorByUser: new Map(members.map((m) => [m.user_id, m._sector])) }),
    };
  }

  it('passed = the certificate (all nine exams without it is In Progress); in progress = activity without it; of the members assigned it', () => {
    const out = summarizeTrainingLevels(rows(), { band: 'midhigh' });
    expect(out.overview.partners.isaps).toMatchObject({ passed: 3, inProgress: 3, notStarted: 3, teachers: 9, pctPassed: 33.3 });
  });

  it('per module middle / high / total, named as the catalogue names them, then completed all (= the certificate)', () => {
    const { modules, completedAll } = summarizeTrainingLevels(rows(), { band: 'midhigh' }).overview.partners.isaps;
    expect(modules.map((m) => m.name)).toEqual(MODULES.map((m) => m.name));
    // module 1: 2 (middle) + 1 (high) + 1 (middle and high) + 1 (middle, Sihala) — module exams counted as before
    expect(modules[0]).toEqual({ name: 'Module 1', middle: 4, high: 2, total: 5 });
    expect(modules[3]).toEqual({ name: 'Module 4', middle: 4, high: 1, total: 4 });
    expect(modules[8]).toEqual({ name: 'Module 9', middle: 3, high: 0, total: 3 });
    expect(completedAll).toEqual({ middle: 3, high: 1, total: 3 });
  });

  it('per sector, without the module detail', () => {
    const out = summarizeTrainingLevels(rows(), { band: 'midhigh' });
    expect(out.regions.find((r) => r.region === 'B.K').partners.isaps)
      .toEqual({ passed: 3, inProgress: 2, notStarted: 3, teachers: 8, pctPassed: 37.5 });
    expect(out.regions.find((r) => r.region === 'Sihala').partners.isaps)
      .toEqual({ passed: 0, inProgress: 1, notStarted: 0, teachers: 1, pctPassed: 0 });
  });

  it('is not part of "passed all": the NIETE two + GBTLA + Beaconhouse still pass all with no I-SAPS at all', () => {
    const extra = pr('B.K', { extra: { cert_levels: ids(3, 4), ox_cert: true, bh_mask: 0b10 } }, 1);
    const out = summarizeTrainingLevels(rows(extra), { band: 'midhigh' });
    expect(out.overview.passedAll).toBe(1);
    expect(out.overview.partners.isaps).toMatchObject({ passed: 3, notStarted: 4, teachers: 10 });
  });

  it('no I-SAPS modules in the catalogue: a certificate still passes, and there is no module row', () => {
    const r = rows();
    const out = summarizeTrainingLevels({ ...r, partners: r.partners.filter((p) => p.partner !== 'isaps') }, { band: 'midhigh' });
    expect(out.overview.partners.isaps).toMatchObject({ passed: 3, inProgress: 3, teachers: 9 });
    expect(out.overview.partners.isaps.modules).toEqual([]);
  });

  it('the region filter scopes it; Primary carries none', () => {
    const sihala = summarizeTrainingLevels(rows(), { band: 'midhigh', region: 'Sihala' }).overview.partners.isaps;
    expect(sihala).toMatchObject({ passed: 0, inProgress: 1, teachers: 1, pctPassed: 0 });
    expect(sihala.modules.every((m) => m.total === 1)).toBe(true);
    expect(summarizeTrainingLevels(rows(), { band: 'primary' }).overview.partners).toBeUndefined();
  });
});

describe('the states read — I-SAPS', () => {
  const code = trainingStatesSql().replace(/--[^\n]*/g, '');

  it('finds I-SAPS by its vendor KEY, never its display name (renamed 2026-10-13)', () => {
    expect(code).toMatch(/v\.key = 'ISAPS'/);
    expect(code).not.toMatch(/Teacher Development Programme|'I-SAPS'/);
  });

  it('a module is a course titled "Module N"; a passed attempt on its ACTIVE grand quiz 900 + N passes it', () => {
    expect(code).toMatch(/isaps_exams AS MATERIALIZED/);
    expect(code).toMatch(/Module \(\\d\+\)/);
    expect(code).toMatch(/900/);
    expect(code).toMatch(/q\.is_active/);
  });

  it('carries the assignment, the certificate, the activity and the module mask on every member row', () => {
    const facts = code.slice(code.indexOf('member_facts AS MATERIALIZED'));
    for (const [agg, col] of [['bool_or', 'isaps_assigned'], ['bool_or', 'isaps_cert'], ['bool_or', 'isaps_active'], ['bit_or', 'isaps_mask']]) {
      expect(facts).toMatch(new RegExp(`${agg}\\(f\\.${col}\\) AS ${col}`));
    }
    // assigned = an active assignment whose programme scopes the I-SAPS vendor
    expect(code).toMatch(/isaps_assigned AS MATERIALIZED/);
  });

  it('the partner catalogue lists the I-SAPS modules with the same numbering', async () => {
    let catalogue = '';
    await loadTrainingLevelRows(async (sql) => {
      if (/'oxbridge' AS partner/.test(sql)) catalogue = sql;
      return { rows: [] };
    });
    expect(catalogue).toMatch(/'isaps'/);
    expect(catalogue).toMatch(/v\.key = 'ISAPS'/);
    expect(catalogue).toMatch(/Module \(\\d\+\)/);
  });
});
