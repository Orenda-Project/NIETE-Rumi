'use strict';
/**
 * bd-97daxo.16 — LP Engagement reads Gilgit-Baltistan's lessons into its grade and subject rows.
 *
 * A GB teacher's lesson reaches the tab three ways, and before this fix only the first landed in a row:
 *   WhatsApp, v9 (book-first)  a lesson_plans row with grade + subject columns          → read by the columns
 *   the app, v9 or v10         a niete_lp_opens 'k5' row: gb_g1_english_ch1_seg1, or a v10 segment id
 *                              (gb-k5-browse lists GB's segments AS lesson ids)          → Active, in NO row
 *   WhatsApp, v10              niete_lp612_deliveries / lp_feedback on an nbf_snc segment → not read by Primary at
 *                              all; Mid/High reads it, but only for its own (6-12) population and its grades 6-12 —
 *                              so a GB Grade 1-5 teacher served on WhatsApp was Non-Active in BOTH bands.
 * Primary now also takes the 6-12 rule's traces of a Grade 1-5 segment. ICT's segments are all grades 6-12, so
 * ICT's Primary numbers cannot move; Mid/High's read is untouched.
 */

const {
  summarizeLpEngagement,
  loadLpEngagementRows,
  parsePlanRef,
} = require('../../dashboard/services/lp-engagement.service');

const GB = ['Gilgit-Baltistan'];
const ref = (user, planRef) => ({ user_id: user, grade: null, subject: null, ref: planRef });
const lp = (user, grade, subject) => ({ user_id: user, grade, subject, ref: null });
const row = (rows, k) => rows.find((x) => x.subject === k || x.grade === k);

describe('parsePlanRef — GB ids', () => {
  it.each([
    ['k5', 'gb_g1_english_ch1_seg1', { grade: 1, subject: 'english' }],
    ['k5', 'gb_g2_english_chR4_seg902', { grade: 2, subject: 'english' }],
    ['k5', 'gb_g4_maths_ch6_seg991', { grade: 4, subject: 'maths' }],
    ['k5', 'gb_g2_urdu_ch19_seg7', { grade: 2, subject: 'urdu' }],
    ['k5', 'gb_g5_science_ch3_seg9', { grade: 5, subject: 'science' }],
    // the app's open of a GB v10 lesson: plan_kind 'k5', plan_ref the segment id
    ['k5', 'nbf_snc_grade_3_maths.c04.s002', { grade: 3, subject: 'maths' }],
    ['k5', 'nbf_snc_grade_2_urdu.c07.s005', { grade: 2, subject: 'urdu' }],
    ['g612', 'nbf_snc_grade_3_english.c02.s004', { grade: 3, subject: 'english' }],
    // unchanged: an ICT segment is not a K-5 plan, a catalogue id is not a 6-12 segment
    ['k5', 'grade_8_mathematics.c05.p071-073', { grade: null, subject: null }],
    ['g612', 'gb_g1_english_ch1_seg1', { grade: null, subject: null }],
    ['g612', 'grade_4_math_ch8_seg3', { grade: null, subject: null }],
  ])('%s %s', (kind, planRef, want) => {
    expect(parsePlanRef(kind, planRef)).toEqual(want);
  });
});

describe('Primary, a GB view (v7 roster population, regions = Gilgit-Baltistan)', () => {
  const fixture = () => ({
    population: new Map([['g1', 'Gilgit-Baltistan'], ['g2', 'Gilgit-Baltistan'], ['g3', 'Gilgit-Baltistan'],
      ['g4', 'Gilgit-Baltistan'], ['g5', 'Gilgit-Baltistan']]),
    fdeSchoolEmis: null,
    schools: [{ id: 'gs1', name: 'GB School', emis: '9001', region: 'Gilgit-Baltistan', is_active: true, is_probable_test: false }],
    teachers: [{ id: 'g1', school_id: 'gs1' }, { id: 'g2', school_id: 'gs1' }, { id: 'g3', school_id: 'gs1' },
      { id: 'g4', school_id: 'gs1' }, { id: 'g5', school_id: 'gs1' }],
    activity: [
      ref('g1', 'gb_g1_english_ch1_seg1'), // v9, opened in the app
      ref('g2', 'nbf_snc_grade_3_maths.c04.s002'), // v10, opened in the app, or a G1-5 trace of Primary's lp612 read
      ref('g3', 'gb_g2_english_chR4_seg902'), // v9, a revision lesson
      lp('g4', '5', 'science'), // v9 on WhatsApp: the lesson_plans columns (worked before, still does)
    ],
  });
  const out = () => summarizeLpEngagement(fixture(), { band: 'primary', regions: GB });

  it('every GB lesson lands in its grade row', () => {
    const o = out();
    expect(o.overview).toMatchObject({ teachers: 5, active: 4, nonActive: 1 });
    expect(row(o.byGrade.rows, 1)).toMatchObject({ active: 1 });
    expect(row(o.byGrade.rows, 2)).toMatchObject({ active: 1 });
    expect(row(o.byGrade.rows, 3)).toMatchObject({ active: 1 });
    expect(row(o.byGrade.rows, 5)).toMatchObject({ active: 1 });
  });

  it('…and in its subject row', () => {
    const o = out();
    expect(o.bySubject.rows.map((r) => r.subject).sort()).toEqual(['english', 'maths', 'science']);
    expect(row(o.bySubject.rows, 'english')).toMatchObject({ active: 2 });
    expect(row(o.bySubject.rows, 'maths')).toMatchObject({ active: 1 });
  });
});

describe('Primary reads the Grade 1-5 segment lane (GB v10 on WhatsApp)', () => {
  function fakeQuery() {
    const calls = [];
    const q = async (sql, params) => {
      calls.push({ sql, params });
      if (/FROM schools/.test(sql)) return { rows: [] };
      if (/teacher_level/.test(sql)) return { rows: [] };
      return { rows: [] };
    };
    q.calls = calls;
    return q;
  }
  const LISTS = {
    fdeSchoolEmis: null,
    primary: new Map([['11111111-0000-4000-8000-000000000001', 'B.K']]),
    midHigh: new Map([['22222222-0000-4000-8000-000000000002', 'Sihala']]),
    coaches: [],
    asOf: {},
  };
  const activitySql = async (band) => {
    const q = fakeQuery();
    await loadLpEngagementRows(q, { from: '2026-11-01', to: '2026-11-09' }, band, { lists: LISTS });
    return q.calls.find((c) => /lesson_plans|niete_lp612/.test(c.sql));
  };

  it('Primary: the 6-12 rule\'s traces (app open, WhatsApp delivery, render asked, survey) of a Grade 1-5 segment', async () => {
    const a = await activitySql('primary');
    // what it read before, unchanged
    expect(a.sql).toMatch(/FROM lesson_plans l/);
    expect(a.sql).toMatch(/o\.plan_kind = 'k5'/);
    // and the segment lane, only for grades 1-5
    expect(a.sql).toMatch(/o\.plan_kind = 'g612'/);
    expect(a.sql).toMatch(/FROM niete_lp612_deliveries g[\s\S]*g\.surface <> 'portal'/);
    expect(a.sql).toMatch(/FROM niete_lp612_renders rr/);
    expect(a.sql).toMatch(/FROM lp_feedback f[\s\S]*f\.lp612_segment_id IS NOT NULL/);
    expect(a.sql).toMatch(/JOIN niete_lp612_segments s ON s\.segment_id = t\.ref[\s\S]*s\.grade BETWEEN 1 AND 5/);
    // the same window on every source
    for (const col of ['o.opened_at', 'g.delivered_at', 'rr.created_at', 'f.created_at']) {
      expect(a.sql).toContain(`${col} >= $2::timestamptz`);
      expect(a.sql).toContain(`${col} < $3::timestamptz`);
    }
    expect(a.params).toEqual([['11111111-0000-4000-8000-000000000001'], '2026-10-31T19:00:00.000Z', '2026-11-09T19:00:00.000Z']);
  });

  it('Mid / High is not given the segment grade filter (its read is unchanged)', async () => {
    const a = await activitySql('midhigh');
    expect(a.sql).not.toMatch(/niete_lp612_segments|lesson_plans|'k5'/);
  });
});
