/**
 * LP Engagement — Active / Non-Active (schools analytics v8, FDE feedback 2026-10-19).
 *
 * The FDE asked for two categories in place of On-Schedule / Moderate / Off-Schedule: Active (the teacher used a
 * lesson plan) and Non-Active (she did not), everywhere on the tab, for Primary and Mid / High, on the RDF's numbers:
 *   population  the RDF teacher population of the band (analytics-lists: primary / midHigh, userId → sector);
 *   Active      at least one lesson plan used in the selected period, by the RDF's rule for the band —
 *               Primary: a lesson_plans row OR a niete_lp_opens row with plan_kind 'k5';
 *               Mid / High: a g612 app open, a WhatsApp delivery, or the U1 floor (a render she requested, a 6-12
 *               survey answer);
 *   Non-Active  the rest of the band's population;
 *   %           active ÷ population, one decimal (the RDF's: 357 of 3,552 = 10.1%).
 * Sector = the RDF's sector for the teacher; a teacher with no school on FDE's list is "No school" in her sector.
 * FAIL-CLOSED (lib/analytics-lists): a list that is not loaded (sandbox) is null, never empty — the tab then keeps the
 * v7 rule for it: schools = active, non-test, in the six sectors; teachers = today's roster with the band's level.
 */

const {
  summarizeLpEngagement,
  loadLpEngagementRows,
  parsePlanRef,
  lpSubjectKey,
  parseBandFilter,
  activePct,
} = require('../../dashboard/services/lp-engagement.service');
const { REGION_BUCKETS } = require('../../dashboard/services/schools-analytics.service');

const school = (id, emis, extra = {}) => ({ id, name: `School ${id}`, emis, ...extra });
// The fixture's schools sit in these sectors (a school is listed only under its own sector).
const REGION_OF = { s0: 'B.K', s1: 'B.K', s3: 'Sihala', s7: 'Nilore' };
const at = (id, schoolId) => ({ id, school_id: schoolId });
const lp = (user, grade, subject) => ({ user_id: user, grade, subject, ref: null });
const ref = (user, planRef) => ({ user_id: user, grade: null, subject: null, ref: planRef });

function primaryFixture() {
  return {
    population: new Map([
      ['t1', 'B.K'], ['t2', 'B.K'], ['t4', 'B.K'],
      ['t5', 'Sihala'],
      ['t9', 'Urban-I'], // no school on record
      ['t10', 'Nilore'], // at a school that is not on FDE's list
    ]),
    fdeSchoolEmis: new Set(['101', '303']),
    schools: [school('s1', '101', { region: 'B.K' }), school('s3', '303', { region: 'Sihala' }), school('s7', '707', { region: 'Nilore' })],
    teachers: [at('t1', 's1'), at('t2', 's1'), at('t4', 's1'), at('t5', 's3'), at('t9', null), at('t10', 's7')],
    activity: [
      // t1: a WhatsApp plan (Grade 4 Maths) and an app open (Grade 4 English).
      lp('t1', '4', 'math'),
      ref('t1', 'grade_4_english_ch2_seg1'),
      // t2: only an app open — still Active.
      ref('t2', 'grade_2_urdu_ch1_seg1'),
      // t4: a lesson_plans row for a grade outside 1-5 — Active (the RDF counts every lesson_plans row), in no grade
      // or subject row.
      lp('t4', '7', 'english'),
      // t9 has no school: Active, in Urban-I and on its "No school" line.
      lp('t9', '1', 'english'),
      // Not in the population: never counted.
      lp('nobody', '1', 'english'),
      ref('nobody', 'grade_1_maths_ch1_seg1'),
    ],
  };
}

const primary = (opts = {}) => summarizeLpEngagement(primaryFixture(), { band: 'primary', ...opts });
const card = (out, r) => out.regions.find((x) => x.region === r);
const row = (rows, k) => rows.find((x) => x.subject === k || x.grade === k);

describe('Active / Non-Active — Primary', () => {
  it('overview: Active = used ≥1 lesson plan in the period; Non-Active = the rest of the band population', () => {
    expect(primary().overview).toEqual({ teachers: 6, active: 4, nonActive: 2, activePct: 66.7, activeSectors: 2 });
  });

  it('carries no On-Schedule / Moderate / Off-Schedule and no LP ratio anywhere', () => {
    const json = JSON.stringify(primary());
    expect(json).not.toMatch(/onSchedule|moderate|offSchedule|onPct|moderatePct|offPct|lpRatio|lpPct|"status"/);
  });

  it('the % is the RDF\'s: one decimal, so 357 of 3,552 reads 10.1', () => {
    expect(activePct(357, 3552)).toBe(10.1);
    expect(activePct(1, 3)).toBe(33.3);
    expect(activePct(2, 3)).toBe(66.7);
    expect(activePct(0, 5)).toBe(0);
    expect(activePct(0, 0)).toBeNull();
  });

  it('sector cards: the six, each from the RDF sector of its teachers; a sector with no teacher has no %', () => {
    const out = primary();
    expect(out.regions.map((r) => r.region)).toEqual([...REGION_BUCKETS]);
    expect(card(out, 'B.K')).toEqual({ region: 'B.K', teachers: 3, active: 3, nonActive: 0, activePct: 100 });
    expect(card(out, 'Sihala')).toEqual({ region: 'Sihala', teachers: 1, active: 0, nonActive: 1, activePct: 0 });
    expect(card(out, 'Urban-I')).toEqual({ region: 'Urban-I', teachers: 1, active: 1, nonActive: 0, activePct: 100 });
    expect(card(out, 'Nilore')).toEqual({ region: 'Nilore', teachers: 1, active: 0, nonActive: 1, activePct: 0 });
    expect(card(out, 'Urban-II')).toEqual({ region: 'Urban-II', teachers: 0, active: 0, nonActive: 0, activePct: null });
    // Sectors sum to the total.
    expect(out.regions.reduce((n, r) => n + r.teachers, 0)).toBe(out.overview.teachers);
  });

  it('school breakdown: schools on FDE\'s list; no school, or one off the list, is the sector\'s "No school" line', () => {
    expect(primary().schools).toEqual([
      { region: 'B.K', schoolId: 's1', emis: '101', name: 'School s1', noSchool: false, teachers: 3, active: 3, nonActive: 0, activePct: 100 },
      { region: 'Sihala', schoolId: 's3', emis: '303', name: 'School s3', noSchool: false, teachers: 1, active: 0, nonActive: 1, activePct: 0 },
      { region: 'Urban-I', schoolId: 'no-school:Urban-I', emis: null, name: null, noSchool: true, teachers: 1, active: 1, nonActive: 0, activePct: 100 },
      { region: 'Nilore', schoolId: 'no-school:Nilore', emis: null, name: null, noSchool: true, teachers: 1, active: 0, nonActive: 1, activePct: 0 },
    ]);
  });

  it('a school\'s line comes before its sector\'s "No school" line; schools by name', () => {
    const f = primaryFixture();
    f.population.set('t11', 'B.K');
    f.teachers.push(at('t11', null));
    f.schools.push(school('s0', '303', { name: 'AAA School', region: 'B.K' }));
    f.population.set('t12', 'B.K');
    f.teachers.push(at('t12', 's0'));
    const out = summarizeLpEngagement(f, { band: 'primary' });
    expect(out.schools.filter((s) => s.region === 'B.K').map((s) => s.name)).toEqual(['AAA School', 'School s1', null]);
  });

  it('a teacher whose school is in another sector than her RDF sector is on her sector\'s No school line', () => {
    const f = primaryFixture();
    f.population.set('t13', 'Tarnol');
    f.teachers.push(at('t13', 's1')); // s1 is a B.K school
    const out = summarizeLpEngagement(f, { band: 'primary' });
    expect(out.schools.find((s) => s.region === 'Tarnol')).toMatchObject({ schoolId: 'no-school:Tarnol', noSchool: true, teachers: 1 });
    expect(out.schools.find((s) => s.schoolId === 's1').teachers).toBe(3);
  });

  it('FDE\'s list not loaded (null, never empty): the v7 school rule — active, non-test, in the six sectors', () => {
    const f = primaryFixture();
    f.fdeSchoolEmis = null;
    f.schools = [
      school('s1', '101', { region: 'B.K', is_active: true, is_probable_test: false }),
      school('s3', '303', { region: 'Sihala', is_active: false, is_probable_test: false }), // closed: not listed
      school('s7', '707', { region: 'nilore', is_active: true, is_probable_test: false }), // any spelling of a sector
    ];
    const out = summarizeLpEngagement(f, { band: 'primary' });
    expect(out.schools.map((s) => [s.region, s.schoolId])).toEqual([
      ['B.K', 's1'], ['Sihala', 'no-school:Sihala'], ['Urban-I', 'no-school:Urban-I'], ['Nilore', 's7'],
    ]);
    expect(out.overview.teachers).toBe(6);
  });

  it('by subject: teachers Active in that subject ÷ the band population; Overall = the tab\'s overall', () => {
    const { bySubject } = primary();
    expect(bySubject.rows.map((r) => r.name)).toEqual(['English', 'Mathematics', 'Urdu']);
    expect(row(bySubject.rows, 'english')).toEqual({ subject: 'english', name: 'English', teachers: 6, active: 2, nonActive: 4, activePct: 33.3 });
    expect(row(bySubject.rows, 'maths')).toMatchObject({ teachers: 6, active: 1, nonActive: 5, activePct: 16.7 });
    expect(row(bySubject.rows, 'urdu')).toMatchObject({ active: 1 });
    expect(bySubject.overall).toEqual({ teachers: 6, active: 4, nonActive: 2, activePct: 66.7 });
  });

  it('by grade: every grade of the band, Active in that grade ÷ the band population', () => {
    const { byGrade } = primary();
    expect(byGrade.rows.map((r) => r.grade)).toEqual([1, 2, 3, 4, 5]);
    expect(byGrade.rows.map((r) => r.active)).toEqual([1, 1, 0, 1, 0]);
    expect(row(byGrade.rows, 3)).toEqual({ grade: 3, teachers: 6, active: 0, nonActive: 6, activePct: 0 });
    expect(byGrade.overall).toEqual({ teachers: 6, active: 4, nonActive: 2, activePct: 66.7 });
  });

  it('the grouped bars: each sector\'s Active % in each subject and grade, all six sectors', () => {
    const out = primary();
    const bk = out.sectorSubjects.find((s) => s.region === 'B.K').values;
    expect(bk).toEqual({ english: 33.3, maths: 33.3, urdu: 33.3 });
    expect(out.sectorSubjects.find((s) => s.region === 'Urban-I').values).toEqual({ english: 100, maths: 0, urdu: 0 });
    expect(out.sectorSubjects.find((s) => s.region === 'Urban-II').values).toEqual({ english: null, maths: null, urdu: null });
    expect(out.sectorGrades.find((s) => s.region === 'B.K').values).toEqual({ 1: 0, 2: 33.3, 3: 0, 4: 33.3, 5: 0 });
    expect(out.sectorSubjects.map((s) => s.region)).toEqual([...REGION_BUCKETS]);
  });

  it('a region filter scopes overview, schools and the tables; the six cards and the bars stay', () => {
    const out = primary({ region: 'B.K' });
    expect(out.overview).toEqual({ teachers: 3, active: 3, nonActive: 0, activePct: 100, activeSectors: 1 });
    expect(out.schools.map((s) => s.region)).toEqual(['B.K']);
    expect(row(out.bySubject.rows, 'english')).toMatchObject({ teachers: 3, active: 1 });
    expect(out.bySubject.overall).toEqual({ teachers: 3, active: 3, nonActive: 0, activePct: 100 });
    expect(out.regions).toHaveLength(6);
    expect(out.sectorSubjects).toHaveLength(6);
  });

  it('a teacher Active twice over (WhatsApp and app, several plans) counts once', () => {
    const f = primaryFixture();
    f.activity.push(lp('t1', '4', 'math'), ref('t1', 'grade_4_math_ch1_seg1'), ref('t1', 'grade_4_math_ch1_seg2'));
    const out = summarizeLpEngagement(f, { band: 'primary' });
    expect(out.overview.active).toBe(4);
    expect(row(out.bySubject.rows, 'maths').active).toBe(1);
  });

  it('carries no teacher identity', () => {
    expect(JSON.stringify(primary())).not.toMatch(/"t\d+"|nobody|user_id|userId/);
  });

  it('no teachers in the band: no %, never a 0 that is not true', () => {
    const out = summarizeLpEngagement({ population: new Map(), fdeSchoolEmis: new Set(), schools: [], teachers: [], activity: [] }, { band: 'midhigh' });
    expect(out.overview).toEqual({ teachers: 0, active: 0, nonActive: 0, activePct: null, activeSectors: 0 });
    expect(out.schools).toEqual([]);
    expect(out.byGrade.rows.map((r) => r.activePct)).toEqual([null, null, null, null, null, null, null]);
  });
});

describe('Active / Non-Active — Mid / High', () => {
  const fixture = () => ({
    population: new Map([['m1', 'Sihala'], ['m2', 'Sihala'], ['m3', 'Tarnol'], ['m4', 'Tarnol']]),
    fdeSchoolEmis: ['303'], // an array works as well as a Set
    schools: [school('s3', '303', { region: 'Sihala' })],
    teachers: [at('m1', 's3'), at('m2', 's3'), at('m3', 's3'), at('m4', 's3')],
    activity: [
      // Every 6-12 trace is a segment id: app open, WhatsApp delivery, render requested, survey answered.
      ref('m1', 'grade_10_urdu.p1c01.p007-012.tafheem'),
      ref('m2', 'grade_9_pak_studies_english.c01.p001-002'),
      ref('m2', 'grade_9_pak_studies_urdu.c01.p003-004'),
      // A trace that does not parse is still a use: Active, in no subject or grade row.
      ref('m3', 'nonsense'),
    ],
  });

  it('Active over the Mid / High population, grades 6-12', () => {
    const out = summarizeLpEngagement(fixture(), { band: 'midhigh' });
    expect(out.overview).toEqual({ teachers: 4, active: 3, nonActive: 1, activePct: 75, activeSectors: 2 });
    expect(out.byGrade.rows.map((r) => r.grade)).toEqual([6, 7, 8, 9, 10, 11, 12]);
    expect(row(out.byGrade.rows, 9)).toMatchObject({ active: 1, activePct: 25 });
    expect(row(out.byGrade.rows, 10)).toMatchObject({ active: 1 });
    expect(out.bySubject.rows.map((r) => r.subject)).toEqual(['pakistan_studies', 'urdu']);
    expect(row(out.bySubject.rows, 'pakistan_studies')).toMatchObject({ active: 1 });
    expect(card(out, 'Tarnol')).toEqual({ region: 'Tarnol', teachers: 2, active: 1, nonActive: 1, activePct: 50 });
  });
});

describe('parsing a plan', () => {
  it.each([
    ['k5', 'grade_4_math_ch8_seg3', { grade: 4, subject: 'maths' }],
    ['k5', 'grade_1_maths_ch4_seg4', { grade: 1, subject: 'maths' }],
    ['k5', 'grade_4_social_studies_en_ch5_seg2', { grade: 4, subject: 'social_studies' }],
    ['k5', 'grade_1_general_knowledge_en_ch7_seg1', { grade: 1, subject: 'general_knowledge' }],
    ['k5', 'grade_5_general_science_ch3_seg5', { grade: 5, subject: 'science' }],
    ['k5', 'grade_2_english_ch9_seg995', { grade: 2, subject: 'english' }],
    ['k5', 'grade_3_urdu_ch3_seg1b', { grade: 3, subject: 'urdu' }],
    ['g612', 'grade_10_urdu.p1c01.p007-012.tafheem', { grade: 10, subject: 'urdu' }],
    ['g612', 'grade_12_computer_science.c05.p126-128', { grade: 12, subject: 'computer_science' }],
    ['g612', 'grade_9_pak_studies_english.c01.p001-002', { grade: 9, subject: 'pakistan_studies' }],
    ['g612', 'grade_10_pak_studies_urdu.c03.p010-012', { grade: 10, subject: 'pakistan_studies' }],
    ['g612', 'grade_7_english.s903', { grade: 7, subject: 'english' }],
    ['g612', 'grade_8_mathematics.c05.p071-073', { grade: 8, subject: 'maths' }],
    ['g612', 'grade_6_general_science.c09.p113-113', { grade: 6, subject: 'science' }],
    ['g612', 'grade_9_10_chemistry_experiment.c01.p026-028', { grade: 9, subject: 'chemistry_experiment' }],
    ['g612', 'nonsense', { grade: null, subject: null }],
    ['k5', '', { grade: null, subject: null }],
  ])('%s %s', (kind, planRef, want) => {
    expect(parsePlanRef(kind, planRef)).toEqual(want);
  });

  it('subject spellings merge to one key (math/maths/Mathematics, the _en/_ur mediums)', () => {
    for (const t of ['math', 'maths', 'Mathematics']) expect(lpSubjectKey(t)).toBe('maths');
    for (const t of ['social_studies', 'social_studies_en', 'social_studies_ur']) expect(lpSubjectKey(t)).toBe('social_studies');
    for (const t of ['general_knowledge', 'general_knowledge_en', 'general_knowledge_ur']) expect(lpSubjectKey(t)).toBe('general_knowledge');
    for (const t of ['pak_studies_english', 'pak_studies_urdu']) expect(lpSubjectKey(t)).toBe('pakistan_studies');
    expect(lpSubjectKey('english')).toBe('english');
    expect(lpSubjectKey(null)).toBeNull();
    expect(lpSubjectKey('  ')).toBeNull();
  });
});

describe('the band filter', () => {
  it('primary by default; primary | midhigh; anything else refused', () => {
    expect(parseBandFilter(undefined)).toEqual({ ok: true, band: 'primary' });
    expect(parseBandFilter('')).toEqual({ ok: true, band: 'primary' });
    expect(parseBandFilter('Primary')).toEqual({ ok: true, band: 'primary' });
    expect(parseBandFilter('midhigh')).toEqual({ ok: true, band: 'midhigh' });
    expect(parseBandFilter('mid_high')).toEqual({ ok: true, band: 'midhigh' });
    expect(parseBandFilter('high')).toEqual({ ok: false });
    expect(parseBandFilter(['primary'])).toEqual({ ok: false });
  });
});

describe('the reads', () => {
  const LISTS = {
    fdeSchoolEmis: new Set(['101']),
    primary: new Map([['11111111-0000-4000-8000-000000000001', 'B.K']]),
    midHigh: new Map([['22222222-0000-4000-8000-000000000002', 'Sihala'], ['33333333-0000-4000-8000-000000000003', 'Tarnol']]),
    coaches: [],
    asOf: {},
  };

  function fakeQuery() {
    const calls = [];
    const q = async (sql, params) => {
      calls.push({ sql, params });
      if (/FROM schools/.test(sql)) return { rows: [school('s1', '101')] };
      if (/FROM users/.test(sql)) return { rows: [at('11111111-0000-4000-8000-000000000001', 's1')] };
      return { rows: [lp('11111111-0000-4000-8000-000000000001', '1', 'urdu')] };
    };
    q.calls = calls;
    return q;
  }
  const activityCall = (q) => q.calls.find((c) => /lesson_plans|niete_lp612/.test(c.sql));

  it('the population is the band\'s RDF list from analytics-lists (loaded once by the route)', async () => {
    const q = fakeQuery();
    const rows = await loadLpEngagementRows(q, { from: '2026-10-04', to: '2026-10-13' }, 'primary', { lists: LISTS });
    expect(rows.population).toBe(LISTS.primary);
    expect(rows.fdeSchoolEmis).toBe(LISTS.fdeSchoolEmis);
    expect(rows.schools).toHaveLength(1);
    expect(rows.teachers).toHaveLength(1);
    expect(rows.activity).toHaveLength(1);
    // schools, the population's schools, the activity — three reads
    expect(q.calls).toHaveLength(3);
    const users = q.calls.find((c) => /FROM users/.test(c.sql));
    expect(users.params).toEqual([['11111111-0000-4000-8000-000000000001']]);

    const q2 = fakeQuery();
    const mh = await loadLpEngagementRows(q2, {}, 'midhigh', { lists: LISTS });
    expect(mh.population).toBe(LISTS.midHigh);
    expect(activityCall(q2).params[0]).toEqual([...LISTS.midHigh.keys()]);
  });

  it('Primary activity: lesson_plans rows OR k5 app opens, in the window\'s Pakistan days, population only', async () => {
    const q = fakeQuery();
    await loadLpEngagementRows(q, { from: '2026-10-04', to: '2026-10-13' }, 'primary', { lists: LISTS });
    const a = activityCall(q);
    expect(a.sql).toMatch(/FROM lesson_plans l/);
    expect(a.sql).toMatch(/FROM niete_lp_opens o/);
    expect(a.sql).toMatch(/o\.plan_kind = 'k5'/);
    expect(a.sql).not.toMatch(/g612|niete_lp612|lp_feedback/);
    // lesson_plans.created_at is a timestamp WITHOUT time zone holding UTC
    expect(a.sql).toMatch(/l\.created_at >= \(\$2::timestamptz AT TIME ZONE 'UTC'\)/);
    expect(a.sql).toMatch(/o\.opened_at < \$3::timestamptz/);
    // [from 00:00 PKT, to+1 00:00 PKT) as UTC instants
    expect(a.params).toEqual([['11111111-0000-4000-8000-000000000001'], '2026-10-03T19:00:00.000Z', '2026-10-13T19:00:00.000Z']);
  });

  it('Mid / High activity: the RDF 6-12 rule — g612 open, WhatsApp delivery (not a portal claim), render requested, 6-12 survey', async () => {
    const q = fakeQuery();
    await loadLpEngagementRows(q, { from: '2026-10-04', to: '2026-10-13' }, 'midhigh', { lists: LISTS });
    const a = activityCall(q);
    expect(a.sql).toMatch(/o\.plan_kind = 'g612'/);
    expect(a.sql).toMatch(/FROM niete_lp612_deliveries g[\s\S]*g\.surface <> 'portal'/);
    expect(a.sql).toMatch(/rr\.requested_by[\s\S]*FROM niete_lp612_renders rr/);
    expect(a.sql).toMatch(/FROM lp_feedback f[\s\S]*f\.lp612_segment_id IS NOT NULL/);
    expect(a.sql).not.toMatch(/lesson_plans|'k5'/);
    for (const col of ['o.opened_at', 'g.delivered_at', 'rr.created_at', 'f.created_at']) {
      expect(a.sql).toContain(`${col} >= $2::timestamptz`);
      expect(a.sql).toContain(`${col} < $3::timestamptz`);
    }
  });

  it('teacher lists not loaded (sandbox: null, never empty): the v7 roster — role teacher, a school, not a test user, the band\'s level, at a counted school, in its sector', async () => {
    const calls = [];
    const q = async (sql, params) => {
      calls.push({ sql, params });
      if (/FROM schools/.test(sql)) {
        return { rows: [
          school('s1', '101', { region: 'B.K', is_active: true, is_probable_test: false }),
          school('s2', '202', { region: 'Durbeen', is_active: true, is_probable_test: false }),
        ] };
      }
      if (/teacher_level/.test(sql)) {
        return { rows: [
          { id: 'p1', school_id: 's1', bands: ['PRIMARY'] },
          { id: 'p2', school_id: 's1', bands: ['primary', 'HIGH'] },
          { id: 'h1', school_id: 's1', bands: ['HIGH'] },
          { id: 'p3', school_id: 's2', bands: ['PRIMARY'] }, // her school is outside the six
          { id: 'p4', school_id: 's1', bands: null },
        ] };
      }
      return { rows: [lp('p1', '1', 'urdu')] };
    };
    const lists = { fdeSchoolEmis: null, primary: null, midHigh: null, coaches: null, asOf: {}, missing: { schools: true, teachers: true, coaches: true } };
    const rows = await loadLpEngagementRows(q, { from: '2026-10-04', to: '2026-10-13' }, 'primary', { lists });
    const roster = calls.find((c) => /teacher_level/.test(c.sql));
    expect(roster.sql).toMatch(/u\.role = 'teacher'/);
    expect(roster.sql).toMatch(/u\.school_id IS NOT NULL/);
    expect(roster.sql).toMatch(/u\.is_test_user IS NOT TRUE/);
    expect([...rows.population]).toEqual([['p1', 'B.K'], ['p2', 'B.K']]);
    expect(activityCall({ calls }).params[0]).toEqual(['p1', 'p2']);
    const out = summarizeLpEngagement(rows, { band: 'primary' });
    expect(out.overview).toEqual({ teachers: 2, active: 1, nonActive: 1, activePct: 50, activeSectors: 1 });
    expect(out.schools.map((s) => s.schoolId)).toEqual(['s1']);

    // one band missing is enough to fall back (the lists say "teachers missing")
    const half = { ...LISTS, midHigh: null, missing: { schools: false, teachers: true, coaches: false } };
    const mh = await loadLpEngagementRows(q, {}, 'midhigh', { lists: half });
    expect([...mh.population]).toEqual([['p2', 'B.K'], ['h1', 'B.K']]);
  });

  it('no window: no bounds, only the population', async () => {
    const q = fakeQuery();
    await loadLpEngagementRows(q, { from: null, to: null }, 'primary', { lists: LISTS });
    const a = activityCall(q);
    expect(a.params).toEqual([['11111111-0000-4000-8000-000000000001']]);
    expect(a.sql).not.toMatch(/\$2/);
  });
});
