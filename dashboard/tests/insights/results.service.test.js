'use strict';
/** NIGHTLY_JOB §4 stage 6b; FICO_CROSSWALK §2 rows W-LN..W-NUM: coachip_result_cells. Fictional children, scores only. */
const { uuid } = require('./fixtures/moments');
const R = require('../../lib/insights/results');

const COLS = ['school_id', 'grade', 'language', 'w_id', 'term_start', 'tested', 'numerator', 'status', 'grader_model',
  'framework_version', 'pipeline_version', 'job_run_id', 'computed_at'].sort();
const SCHOOL = uuid(700);
const COACH = uuid(800);
const TEST_COACH = uuid(801);
const TERM = { start: '2026-10-26' };
const JOB = uuid(1);

let n = 0;
function child({ school = SCHOOL, grade = 2, coach = COACH, status = 'completed', startedAt = '2026-10-27T05:00:00Z', scores = {} } = {}) {
  n += 1;
  const s = { id: uuid(2000 + n), coach_user_id: coach, school_id: school, grade, status, started_at: startedAt, student_id: uuid(3000 + n),
    item_bank_version: 'sa-battery' };
  const blocks = Object.entries(scores).map(([task, [correct, attempted, extra]]) => ({
    session_id: s.id, block: task, responses: [{ kind: 'result', correct, attempted, ...(extra || {}) }, { kind: 'answer', item: 1 }],
  }));
  return { s, blocks };
}
function build(children, opts = {}) {
  return R.buildResultCells({ sessions: children.map((c) => c.s), blocks: children.flatMap((c) => c.blocks),
    testAccountIds: opts.testAccountIds || [TEST_COACH], term: TERM, jobRunId: JOB, computedAt: '2026-10-28T21:00:00.000Z' });
}
const cell = (rows, w, lang = 'ur') => rows.find((r) => r.w_id === w && r.language === lang);

describe('buildResultCells', () => {
  // Urdu letter names (E3): 1-of-5 tap, below bar when correct share <= 50%.
  const five = () => [[1, 5], [2, 5], [3, 5], [4, 5], [5, 5]].map((sc) => child({ scores: { 'ur.letter_names5': sc } }));

  test('W-LN at 5 tested: ok, numerator = children at or below 50% correct', () => {
    const rows = build(five());
    const c = cell(rows, 'W-LN');
    expect(c).toMatchObject({ school_id: SCHOOL, grade: 2, language: 'ur', term_start: '2026-10-26', tested: 5, numerator: 2, status: 'ok',
      framework_version: 'egra', job_run_id: JOB, pipeline_version: 'coachip-1.0.0' });
    rows.forEach((r) => {
      expect(Object.keys(r).sort()).toEqual(COLS);
      expect(r.status === 'ok').toBe(r.numerator != null);
      if (r.status === 'ok') expect(r.tested).toBeGreaterThanOrEqual(5);
      if (r.numerator != null) expect(r.numerator).toBeLessThanOrEqual(r.tested);
    });
  });

  test('the floor: 4 tested is insufficient with no numerator', () => {
    const c = cell(build(five().slice(0, 4)), 'W-LN');
    expect(c).toMatchObject({ tested: 4, numerator: null, status: 'insufficient' });
  });

  test('test accounts are skipped (a fifth child from a test account leaves the cell insufficient)', () => {
    const kids = [...five().slice(0, 4), child({ coach: TEST_COACH, scores: { 'ur.letter_names5': [1, 5] } })];
    expect(cell(build(kids), 'W-LN')).toMatchObject({ tested: 4, status: 'insufficient' });
  });

  test('incomplete sessions, sessions before the term and grades outside 1-5 are not counted', () => {
    const kids = [...five().slice(0, 4),
      child({ status: 'in_progress', scores: { 'ur.letter_names5': [1, 5] } }),
      child({ startedAt: '2026-10-20T05:00:00Z', scores: { 'ur.letter_names5': [1, 5] } })];
    expect(cell(build(kids), 'W-LN').tested).toBe(4);
    const g6 = [1, 2, 3, 4, 5].map(() => child({ grade: 6, scores: { 'ur.letter_names5': [1, 5] } }));
    expect(build(g6)).toEqual([]);
  });

  test('a child tested twice in the term counts once (the latest test)', () => {
    const kids = five();
    const again = child({ startedAt: '2026-10-29T05:00:00Z', scores: { 'ur.letter_names5': [5, 5] } });
    again.s.student_id = kids[0].s.student_id;
    const c = cell(build([...kids, again]), 'W-LN');
    expect(c).toMatchObject({ tested: 5, numerator: 1 });
  });

  test('cells are per (school, grade, language): English and another grade are separate', () => {
    const kids = [...five(), ...[1, 2, 3, 4, 5].map(() => child({ scores: { 'en.letter_names5': [1, 5] } })),
      ...[1, 2, 3, 4, 5].map(() => child({ grade: 3, scores: { 'ur.letter_names5': [5, 5] } }))];
    const rows = build(kids);
    expect(cell(rows, 'W-LN', 'en')).toMatchObject({ grade: 2, tested: 5, numerator: 5, status: 'ok' });
    expect(rows.find((r) => r.w_id === 'W-LN' && r.grade === 3)).toMatchObject({ tested: 5, numerator: 0, status: 'ok' });
  });

  test('W-LS: English letter sounds graded; Urdu letter sounds is not_measured, never a zero', () => {
    const kids = [1, 2, 3, 4, 5].map((i) => child({ scores: { 'en.letter_sounds5': [i, 5], 'ur.letter_sounds5': [i, 5] } }));
    const rows = build(kids);
    expect(cell(rows, 'W-LS', 'en')).toMatchObject({ status: 'ok', tested: 5, numerator: 2 });
    expect(cell(rows, 'W-LS', 'ur')).toMatchObject({ status: 'not_measured', numerator: null });
  });

  test('W-FW familiar words (E8) graded at <= 50%', () => {
    const kids = [[1, 4], [2, 4], [3, 4], [4, 4], [0, 0]].map((sc) => child({ scores: { 'ur.words4': sc } }));
    expect(cell(build(kids), 'W-FW')).toMatchObject({ status: 'ok', tested: 5, numerator: 3 });
  });

  test('W-DEC: E9 nonwords <= 50% AND E8 familiar words > 50%, only where nonwords ran', () => {
    const kids = [
      { 'en.nonwords': [1, 10], 'en.words4': [4, 4] }, // below on E9, fine on E8: hit
      { 'en.nonwords': [1, 10], 'en.words4': [1, 4] }, // both low: W-FW's, not W-DEC's
      { 'en.nonwords': [9, 10], 'en.words4': [4, 4] },
      { 'en.nonwords': [2, 10], 'en.words4': [3, 4] }, // hit
      { 'en.nonwords': [8, 10], 'en.words4': [4, 4] },
    ].map((scores) => child({ scores }));
    const rows = build(kids);
    expect(cell(rows, 'W-DEC', 'en')).toMatchObject({ status: 'ok', tested: 5, numerator: 2 });
    expect(cell(build(five()), 'W-DEC')).toBeUndefined();
  });

  test('subtasks with no bar in the contract are not_graded (ORF, comprehension, maths)', () => {
    const kids = [1, 2, 3, 4, 5].map(() => child({ scores: { 'ur.story_w3': [20, 30, { per_minute: 22 }], 'ur.story_comp_w3': [2, 5], 'ma.number_id8': [5, 8] } }));
    const rows = build(kids);
    for (const w of ['W-ORF', 'W-RC']) expect(cell(rows, w)).toMatchObject({ status: 'not_graded', numerator: null, tested: 5 });
    expect(rows.find((r) => r.w_id === 'W-NUM')).toMatchObject({ status: 'not_graded', numerator: null, tested: 5 });
  });

  test('never a teacher column, a child id or a coach id in a row', () => {
    const s = JSON.stringify(build(five()));
    expect(s).not.toMatch(/"[a-z_]*(teacher|student|coach)[a-z_]*":/);
    expect(s).not.toContain(COACH);
  });
});
