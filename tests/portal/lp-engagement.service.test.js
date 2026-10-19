/**
 * LP Engagement (schools analytics v7, PLAN v7 "LP Engagement") — her formula, 1 to 1.
 *
 * The ICT dashboard's LP tab (ict-dashboards backend/api/management/commands/sync_lp.py:106-108,
 * backend/api/views.py LPEngagementView / LPSectorView, frontend/src/pages/LPEngagement.jsx):
 *   a ROW is teacher × Sunday-week × grade × subject; lp_ratio = min(distinct LPs / 5, 1);
 *   a teacher's ratio is the mean of her rows; overall / sector / school = Σ teacher ratios ÷ the
 *   rostered teachers of that band (a teacher with no row counts 0, and Off-Schedule);
 *   On-Schedule ≥ 0.60, Moderate ≥ 0.40, Off-Schedule below; shown ×100 as a %.
 * NIETE substitutions: LPs = plans OPENED (niete_lp_opens) + lesson plans GENERATED (lesson_plans);
 * Primary / Mid-High = the teacher's training band; K-5 plans count on Primary, 6-12 on Mid-High.
 */

const {
  summarizeLpEngagement,
  loadLpEngagementRows,
  parsePlanRef,
  lpSubjectKey,
  parseBandFilter,
  createBandColumnsMemo,
  bandsExpression,
  LP_PER_WEEK,
} = require('../../dashboard/services/lp-engagement.service');
const { REGION_BUCKETS, LP_OPENS_LOGGED_SINCE } = require('../../dashboard/services/schools-analytics.service');

const W1 = '2026-10-04'; // a Sunday
const W2 = '2026-10-11';

const school = (id, region, extra = {}) => ({
  id, name: `School ${id}`, emis: `E-${id}`, region, is_active: true, is_probable_test: false, ...extra,
});
const teacher = (id, schoolId, bands) => ({ id, school_id: schoolId, bands });
const open = (user, week, kind, ref) => ({ user_id: user, week, source: 'open', plan_kind: kind, plan_ref: ref });
const gen = (user, week, grade, subject, n) => ({ user_id: user, week, source: 'generated', grade, subject, n });

function fixture() {
  return {
    schools: [
      school('s1', 'B.K'),
      school('s2', 'b.k '), // any spelling of a sector is that sector
      school('s3', 'Sihala'),
      school('s4', null), // no region: in no number
      school('s5', 'Tarnol', { is_active: false }),
      school('s6', 'Nilore', { is_probable_test: true }),
    ],
    teachers: [
      teacher('t1', 's1', ['PRIMARY']),
      teacher('t2', 's1', ['PRIMARY', 'MIDDLE']), // both bands: in both tabs
      teacher('t3', 's1', ['HIGH']),
      teacher('t4', 's2', ['primary']),
      teacher('t5', 's3', ['PRIMARY']), // no LP at all: 0, Off-Schedule
      teacher('t6', 's3', null), // no band: in neither tab
      teacher('t7', 's4', ['PRIMARY']), // her school is not counted
      teacher('t8', 's3', ['MIDDLE']),
    ],
    activity: [
      // t1, week 1: three Maths plans opened + two generated → 5 LPs → 1.0
      open('t1', W1, 'k5', 'grade_4_math_ch1_seg1'),
      open('t1', W1, 'k5', 'grade_4_math_ch1_seg2'),
      open('t1', W1, 'k5', 'grade_4_math_ch1_seg3'),
      gen('t1', W1, '4', 'math', 2),
      // t1, week 2: one English plan → 0.2. Her mean (1.0 + 0.2) / 2 = 0.6 → On-Schedule (the boundary).
      open('t1', W2, 'k5', 'grade_4_english_ch2_seg1'),
      // t2: one Urdu plan opened and one generated in the same grade/subject/week → 2 → 0.4 → Moderate.
      open('t2', W1, 'k5', 'grade_2_urdu_ch1_seg1'),
      gen('t2', W1, '2', 'urdu', 1),
      // t4: social studies in Urdu and in English is ONE subject → one row of 2 → 0.4 → Moderate.
      open('t4', W2, 'k5', 'grade_5_social_studies_ch1_seg1'),
      gen('t4', W2, '5', 'social_studies_en', 1),
      // Not counted on Primary: a teacher whose school is out, a teacher not on the roster, a
      // Mid/High-only teacher's K-5 open, and t1's 6-12 open.
      open('t7', W1, 'k5', 'grade_1_maths_ch1_seg1'),
      open('nobody', W1, 'k5', 'grade_1_maths_ch1_seg2'),
      open('t3', W1, 'k5', 'grade_3_english_ch1_seg1'),
      open('t1', W1, 'g612', 'grade_7_english.c01.p001-002'),

      // ── Mid / High ──
      // t2: two different English plans in week 1 (one opened twice) → 2 → 0.4; the same plan again
      // in week 2 → 1 → 0.2. Mean 0.3 → Off-Schedule.
      open('t2', W1, 'g612', 'grade_7_english.c01.p001-002'),
      open('t2', W1, 'g612', 'grade_7_english.c01.p003-004'),
      open('t2', W1, 'g612', 'grade_7_english.c01.p001-002'),
      open('t2', W2, 'g612', 'grade_7_english.c01.p001-002'),
      // t3: three Grade 10 Urdu plans (the .p1c01 shape the old regex missed) → 0.6, and three
      // Pakistan Studies plans (English and Urdu medium are one subject) → 0.6. Mean 0.6 → On.
      open('t3', W1, 'g612', 'grade_10_urdu.p1c01.p007-012.tafheem'),
      open('t3', W1, 'g612', 'grade_10_urdu.p1c02.p016-018.tafheem'),
      open('t3', W1, 'g612', 'grade_10_urdu.p2c03.r990'),
      open('t3', W1, 'g612', 'grade_9_pak_studies_english.c01.p001-002'),
      open('t3', W1, 'g612', 'grade_9_pak_studies_urdu.c01.p003-004'),
      open('t3', W1, 'g612', 'grade_9_pak_studies_urdu.c02.p005-006'),
      // t8: six generated Grade 8 Maths plans and one opened → 7, capped at 5 → 1.0 → On.
      gen('t8', W1, '8', 'Mathematics', 6),
      open('t8', W1, 'g612', 'grade_8_mathematics.c05.p071-073'),
      // A K-5 generated plan never counts on Mid/High, even for a Mid/High teacher (t3 is HIGH only).
      gen('t3', W1, '4', 'english', 3),
    ],
  };
}

const primary = (opts = {}) => summarizeLpEngagement(fixture(), { band: 'primary', ...opts });
const midhigh = (opts = {}) => summarizeLpEngagement(fixture(), { band: 'midhigh', ...opts });
const card = (out, r) => out.regions.find((x) => x.region === r);
const row = (rows, k) => rows.find((x) => x.subject === k || x.grade === k);

describe('her formula — Primary', () => {
  it('overall = Σ teacher ratios ÷ rostered Primary teachers; no-data teachers count 0', () => {
    const { overview } = primary();
    // t1 0.6, t2 0.4, t4 0.4, t5 0 over 4 teachers → 0.35
    expect(overview).toEqual({
      teachers: 4, lpRatio: 0.35, lpPct: 35, activeSectors: 1, onSchedule: 1, moderate: 2, offSchedule: 1,
    });
  });

  it('a teacher on exactly 0.60 is On-Schedule and on exactly 0.40 is Moderate (no float drift)', () => {
    const out = summarizeLpEngagement({
      schools: [school('s1', 'B.K')],
      teachers: [teacher('a', 's1', ['PRIMARY']), teacher('b', 's1', ['PRIMARY']), teacher('c', 's1', ['PRIMARY'])],
      activity: [
        // a: rows 0.2 and 1.0 → 0.6
        open('a', W1, 'k5', 'grade_1_urdu_ch1_seg1'),
        gen('a', W2, '1', 'urdu', 5),
        // b: rows 0.6 and 0.2 → 0.4
        gen('b', W1, '3', 'english', 3),
        gen('b', W1, '3', 'urdu', 1),
        // c: one row of 1 → 0.2
        gen('c', W1, '3', 'english', 1),
      ],
    }, { band: 'primary' });
    expect(out.overview).toMatchObject({ onSchedule: 1, moderate: 1, offSchedule: 1 });
  });

  it("a row is capped at 5 LPs a week (ratio 1)", () => {
    expect(LP_PER_WEEK).toBe(5);
    const out = summarizeLpEngagement({
      schools: [school('s1', 'B.K')],
      teachers: [teacher('a', 's1', ['PRIMARY'])],
      activity: [gen('a', W1, '3', 'english', 9)],
    }, { band: 'primary' });
    expect(out.overview.lpRatio).toBe(1);
    expect(out.overview.lpPct).toBe(100);
  });

  it('six sector cards, always, in sector order: %, band counts and their shares, total teachers', () => {
    const out = primary();
    expect(out.regions.map((r) => r.region)).toEqual(REGION_BUCKETS);
    // B.K: t1 0.6, t2 0.4, t4 0.4 → 1.4 / 3
    expect(card(out, 'B.K')).toEqual({
      region: 'B.K', teachers: 3, lpRatio: 0.4667, lpPct: 47,
      onSchedule: 1, moderate: 2, offSchedule: 0, onPct: 33, moderatePct: 67, offPct: 0,
    });
    expect(card(out, 'Sihala')).toEqual({
      region: 'Sihala', teachers: 1, lpRatio: 0, lpPct: 0,
      onSchedule: 0, moderate: 0, offSchedule: 1, onPct: 0, moderatePct: 0, offPct: 100,
    });
    // No Primary teacher there: nothing to divide by, so no %, never a 0 that is not true.
    expect(card(out, 'Tarnol')).toEqual({
      region: 'Tarnol', teachers: 0, lpRatio: null, lpPct: null,
      onSchedule: 0, moderate: 0, offSchedule: 0, onPct: null, moderatePct: null, offPct: null,
    });
  });

  it('schools: only counted schools with a Primary teacher; LP % and her status from the rounded %', () => {
    const { schools } = primary();
    expect(schools).toEqual([
      { schoolId: 's1', emis: 'E-s1', name: 'School s1', region: 'B.K', teachers: 2, lpRatio: 0.5, lpPct: 50, status: 'moderate' },
      { schoolId: 's2', emis: 'E-s2', name: 'School s2', region: 'B.K', teachers: 1, lpRatio: 0.4, lpPct: 40, status: 'moderate' },
      { schoolId: 's3', emis: 'E-s3', name: 'School s3', region: 'Sihala', teachers: 1, lpRatio: 0, lpPct: 0, status: 'off' },
    ]);
  });

  it("a school's status reads her rounded %: 59.7% shows as 60% and is On-Schedule (LPSectorView + her table)", () => {
    // 199 teachers at 0.6 and one with nothing → 119.4 / 200 = 0.597 → shown 60% → On-Schedule, as hers rounds first.
    const edge = summarizeLpEngagement({
      schools: [school('s1', 'B.K')],
      teachers: [
        ...Array.from({ length: 199 }, (_, i) => teacher(`p${i}`, 's1', ['PRIMARY'])),
        teacher('z', 's1', ['PRIMARY']),
      ],
      activity: Array.from({ length: 199 }, (_, i) => gen(`p${i}`, W1, '1', 'urdu', 3)),
    }, { band: 'primary' });
    expect(edge.schools[0]).toMatchObject({ lpRatio: 0.597, lpPct: 60, status: 'on' });
  });

  it('by subject: every Primary teacher is in every row; a teacher with no row in it counts 0 and Off', () => {
    const { bySubject } = primary();
    expect(bySubject.rows.map((r) => [r.subject, r.name])).toEqual([
      ['english', 'English'], ['maths', 'Mathematics'], ['social_studies', 'Social Studies'], ['urdu', 'Urdu'],
    ]);
    // Maths: t1 1.0 (week 1 only) → 1.0 / 4
    expect(row(bySubject.rows, 'maths')).toEqual({
      subject: 'maths', name: 'Mathematics', teachers: 4, lpRatio: 0.25, lpPct: 25,
      onSchedule: 1, moderate: 0, offSchedule: 3, onPct: 25, moderatePct: 0, offPct: 75,
    });
    expect(row(bySubject.rows, 'english')).toMatchObject({ lpRatio: 0.05, lpPct: 5, onSchedule: 0, moderate: 0, offSchedule: 4 });
    expect(row(bySubject.rows, 'urdu')).toMatchObject({ lpPct: 10, moderate: 1, offSchedule: 3 });
    expect(row(bySubject.rows, 'social_studies')).toMatchObject({ lpPct: 10, moderate: 1, offSchedule: 3 });
  });

  it("by subject, Overall: her row — band counts summed over the subjects, LP % the mean of the subjects' ratios", () => {
    const { bySubject } = primary();
    // on 1, moderate 2, off 13 of 16; LP mean (0.25 + 0.05 + 0.1 + 0.1) / 4 = 0.125
    expect(bySubject.overall).toEqual({
      teachers: 16, lpRatio: 0.125, lpPct: 13, onSchedule: 1, moderate: 2, offSchedule: 13, onPct: 6, moderatePct: 13, offPct: 81,
    });
  });

  it('by grade: Grades 1–5 always, a grade with no LP still a row (0%, all Off)', () => {
    const { byGrade } = primary();
    expect(byGrade.rows.map((r) => r.grade)).toEqual([1, 2, 3, 4, 5]);
    // G4: t1's two rows (1.0, 0.2) → 0.6 → On; 0.6 / 4
    expect(row(byGrade.rows, 4)).toEqual({
      grade: 4, teachers: 4, lpRatio: 0.15, lpPct: 15, onSchedule: 1, moderate: 0, offSchedule: 3, onPct: 25, moderatePct: 0, offPct: 75,
    });
    expect(row(byGrade.rows, 1)).toMatchObject({ lpPct: 0, onSchedule: 0, moderate: 0, offSchedule: 4, offPct: 100 });
    expect(row(byGrade.rows, 2)).toMatchObject({ lpPct: 10, moderate: 1 });
    expect(byGrade.overall).toEqual({
      teachers: 20, lpRatio: 0.07, lpPct: 7, onSchedule: 1, moderate: 2, offSchedule: 17, onPct: 5, moderatePct: 10, offPct: 85,
    });
  });

  it('sector × subject and sector × grade: LP % per sector for the grouped bars, all six sectors', () => {
    const { sectorSubjects, sectorGrades } = primary();
    expect(sectorSubjects.map((s) => s.region)).toEqual(REGION_BUCKETS);
    // B.K maths: 1.0 / 3; english 0.2 / 3; urdu 0.4 / 3; social studies 0.4 / 3
    expect(sectorSubjects[0].values).toEqual({ english: 7, maths: 33, social_studies: 13, urdu: 13 });
    expect(sectorSubjects[1].values).toEqual({ english: 0, maths: 0, social_studies: 0, urdu: 0 });
    expect(sectorSubjects.find((s) => s.region === 'Tarnol').values).toEqual({ english: null, maths: null, social_studies: null, urdu: null });
    expect(sectorGrades[0].values).toEqual({ 1: 0, 2: 13, 3: 0, 4: 20, 5: 13 });
  });

  it('active sectors: sectors where a Primary teacher has LP data in the window', () => {
    expect(primary().overview.activeSectors).toBe(1);
    expect(midhigh().overview.activeSectors).toBe(2);
  });
});

describe('her formula — Mid / High', () => {
  it('Mid/High teachers over 6-12 plans; distinct plans per week, the same plan again next week counts again', () => {
    const out = midhigh();
    // t2 0.3 (Off), t3 0.6 (On), t8 1.0 (On) → 1.9 / 3
    expect(out.overview).toEqual({
      teachers: 3, lpRatio: 0.6333, lpPct: 63, activeSectors: 2, onSchedule: 2, moderate: 0, offSchedule: 1,
    });
    expect(card(out, 'B.K')).toMatchObject({ teachers: 2, lpRatio: 0.45, lpPct: 45, onSchedule: 1, offSchedule: 1 });
    expect(card(out, 'Sihala')).toMatchObject({ teachers: 1, lpPct: 100, onSchedule: 1 });
  });

  it('Grades 6–12 always; subjects merged (Pakistan Studies one subject; Grade 10 Urdu parsed)', () => {
    const { bySubject, byGrade } = midhigh();
    expect(byGrade.rows.map((r) => r.grade)).toEqual([6, 7, 8, 9, 10, 11, 12]);
    expect(row(byGrade.rows, 10)).toMatchObject({ lpPct: 20, onSchedule: 1 });
    expect(row(byGrade.rows, 9)).toMatchObject({ lpPct: 20, onSchedule: 1 });
    expect(row(byGrade.rows, 8)).toMatchObject({ lpPct: 33, onSchedule: 1 });
    expect(row(byGrade.rows, 7)).toMatchObject({ lpPct: 10, offSchedule: 3 });
    expect(bySubject.rows.map((r) => r.subject)).toEqual(['english', 'maths', 'pakistan_studies', 'urdu']);
    expect(row(bySubject.rows, 'pakistan_studies')).toMatchObject({ name: 'Pakistan Studies', lpPct: 20, onSchedule: 1 });
  });
});

describe('the region filter', () => {
  it('scopes the overview, schools, subjects and grades; the six cards and the chart matrices stay', () => {
    const out = primary({ region: 'B.K' });
    expect(out.overview).toEqual({
      teachers: 3, lpRatio: 0.4667, lpPct: 47, activeSectors: 1, onSchedule: 1, moderate: 2, offSchedule: 0,
    });
    expect(out.schools.map((s) => s.schoolId)).toEqual(['s1', 's2']);
    expect(row(out.bySubject.rows, 'maths')).toMatchObject({ teachers: 3, lpPct: 33 });
    expect(out.regions).toHaveLength(6);
    expect(out.sectorSubjects).toHaveLength(6);
    expect(card(out, 'Sihala').teachers).toBe(1);
  });
});

describe('what never comes out', () => {
  it('no teacher identity, no excluded school, no uncounted teacher', () => {
    for (const out of [primary(), midhigh()]) {
      const s = JSON.stringify(out);
      expect(s).not.toMatch(/"t\d"|nobody|user_id|userId|School s4|School s5|School s6/);
    }
  });

  it('an empty window: every teacher Off, 0%, never null where there are teachers', () => {
    const f = fixture();
    const out = summarizeLpEngagement({ ...f, activity: [] }, { band: 'primary' });
    expect(out.overview).toEqual({ teachers: 4, lpRatio: 0, lpPct: 0, activeSectors: 0, onSchedule: 0, moderate: 0, offSchedule: 4 });
    expect(out.bySubject).toEqual({ rows: [], overall: null });
    expect(out.byGrade.rows).toHaveLength(5);
    expect(out.byGrade.rows.every((r) => r.lpPct === 0 && r.offSchedule === 4)).toBe(true);
  });

  it('no teachers in the band: no %, never a 0 that is not true', () => {
    const out = summarizeLpEngagement({ schools: [school('s1', 'B.K')], teachers: [], activity: [] }, { band: 'midhigh' });
    expect(out.overview).toEqual({ teachers: 0, lpRatio: null, lpPct: null, activeSectors: 0, onSchedule: 0, moderate: 0, offSchedule: 0 });
    expect(out.schools).toEqual([]);
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
  ])('%s %s', (kind, ref, want) => {
    expect(parsePlanRef(kind, ref)).toEqual(want);
  });

  it('subject spellings merge to one key (math/maths/Mathematics, the _en/_ur mediums)', () => {
    for (const t of ['math', 'maths', 'Mathematics']) expect(lpSubjectKey(t)).toBe('maths');
    for (const t of ['social_studies', 'social_studies_en', 'social_studies_ur']) expect(lpSubjectKey(t)).toBe('social_studies');
    for (const t of ['general_knowledge', 'general_knowledge_en', 'general_knowledge_ur']) expect(lpSubjectKey(t)).toBe('general_knowledge');
    for (const t of ['pak_studies_english', 'pak_studies_urdu']) expect(lpSubjectKey(t)).toBe('pakistan_studies');
    expect(lpSubjectKey('english')).toBe('english');
    expect(lpSubjectKey('urdu')).toBe('urdu');
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
  function fakeQuery({ columns = ['teacher_level'] } = {}) {
    const calls = [];
    const q = async (sql, params) => {
      calls.push({ sql, params });
      if (/information_schema\.columns/.test(sql)) return { rows: columns.map((c) => ({ column_name: c })) };
      if (/FROM schools/.test(sql) && !/niete_lp_opens/.test(sql)) return { rows: [school('s1', 'B.K')] };
      if (/FROM users u/.test(sql) && !/niete_lp_opens/.test(sql)) return { rows: [teacher('t1', 's1', ['PRIMARY'])] };
      if (/niete_lp_opens/.test(sql)) return { rows: [open('t1', W1, 'k5', 'grade_1_urdu_ch1_seg1')] };
      return { rows: [] };
    };
    q.calls = calls;
    return q;
  }

  it('three set-based reads (schools, roster, LP activity); the band column is looked up once per process', async () => {
    const memo = createBandColumnsMemo();
    const q = fakeQuery();
    const rows = await loadLpEngagementRows(q, { from: '2026-10-04', to: '2026-10-13' }, 'primary', { memo });
    expect(rows.schools).toHaveLength(1);
    expect(rows.teachers).toHaveLength(1);
    expect(rows.activity).toHaveLength(1);
    expect(q.calls.filter((c) => /information_schema/.test(c.sql))).toHaveLength(1);
    expect(q.calls).toHaveLength(4);

    await loadLpEngagementRows(q, { from: '2026-10-04', to: '2026-10-13' }, 'midhigh', { memo });
    expect(q.calls.filter((c) => /information_schema/.test(c.sql))).toHaveLength(1);
  });

  it('the LP read: opens of the band\'s kind plus generated plans of its grades, in the window\'s Pakistan days, roster teachers only', async () => {
    const q = fakeQuery();
    await loadLpEngagementRows(q, { from: '2026-10-04', to: '2026-10-13' }, 'primary', { memo: createBandColumnsMemo() });
    const lp = q.calls.find((c) => /niete_lp_opens/.test(c.sql));
    expect(lp.sql).toMatch(/lesson_plans/);
    expect(lp.sql).toMatch(/Asia\/Karachi/);
    expect(lp.sql).toMatch(/u\.role = 'teacher'/);
    expect(lp.sql).toMatch(/is_test_user IS NOT TRUE/);
    // [from 00:00 PKT, to+1 00:00 PKT) as UTC instants, then the kind and the grade range
    expect(lp.params).toEqual(['2026-10-03T19:00:00.000Z', '2026-10-13T19:00:00.000Z', 'k5', 1, 5]);

    const q2 = fakeQuery();
    await loadLpEngagementRows(q2, { from: null, to: null }, 'midhigh', { memo: createBandColumnsMemo() });
    expect(q2.calls.find((c) => /niete_lp_opens/.test(c.sql)).params).toEqual(['g612', 6, 12]);
  });

  it('the band column: teacher_level (production), training_bands (older schemas), both, or none', () => {
    expect(bandsExpression(['teacher_level'])).toBe('u.teacher_level::text[]');
    expect(bandsExpression(['training_bands'])).toBe('u.training_bands::text[]');
    expect(bandsExpression(['training_bands', 'teacher_level'])).toBe('COALESCE(u.teacher_level, u.training_bands)::text[]');
    expect(bandsExpression([])).toBe('NULL::text[]');
    expect(bandsExpression(['users; drop table x'])).toBe('NULL::text[]');
  });

  it('the roster read carries the band column the database has', async () => {
    const q = fakeQuery({ columns: ['training_bands'] });
    await loadLpEngagementRows(q, {}, 'primary', { memo: createBandColumnsMemo() });
    const roster = q.calls.find((c) => /FROM users u/.test(c.sql) && !/niete_lp_opens/.test(c.sql));
    expect(roster.sql).toMatch(/u\.training_bands::text\[\] AS bands/);
  });

  it('LP opens are logged from the same day the schools tab says', () => {
    expect(LP_OPENS_LOGGED_SINCE).toBe('2026-10-04');
  });
});
