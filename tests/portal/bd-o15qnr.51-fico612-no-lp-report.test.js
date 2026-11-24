'use strict';
/**
 * bd-o15qnr.51 (queue #255) — the operator, 24 Nov ~11:15: "lesson plan moves/fideltiy step to be removed from the fico
 * 6-12." The coach's daily debrief report and weekly report carry #242's lesson plan block; a FICO 6-12 (FICO-S) visit
 * gets neither, including one judged before this change (production b4f6f109, FICO 6-12 v1.2, 24 Nov: lp_discussion
 * stored). The 8 behaviours, stars and counts are untouched; a FICO17 v6 (grades 1-5) visit is exactly as before.
 * Both reads stay narrow: the visit's stamp is read as two text slices, never analysis_data whole.
 */
const Report = require('../../dashboard/services/coach-report.service');
const Week = require('../../dashboard/services/coach-week.service');

const ME = '11111111-1111-4111-8111-111111111111';
const ID = '33333333-3333-4333-8333-333333333333';
const RUBRIC = {
  opened_with_specific_praise: true, anchored_in_real_moment: true, asked_and_waited: false, one_improvement_only: true,
  moves_not_teacher: true, elicited_if_then: false, righting_reflex_held: true, rehearsed_the_step: false, disparaged_teacher: false,
};
const PARTS = ['name_step', 'as_planned', 'gap', 'ask', 'next_step'];
const lpDiscussion = (coveredKeys) => ({
  v: 1, state: 'ok', total: 5, covered: coveredKeys.length,
  parts: PARTS.map((key) => (coveredKeys.includes(key)
    ? { key, covered: true, quote: `quote for ${key}`, what: null }
    : { key, covered: false, quote: null, what: `what happened at ${key}` })),
});
const LP_CHECK = {
  v: 1, state: 'ok', done: 1, total: 2,
  steps: [{ key: 'we_do', name: 'We Do', done: 1, total: 2, moves: [{ id: 'm1', mark: 'done', label: 'Answer together' }, { id: 'm2', mark: 'missed', label: 'Partner practice' }] }],
  lines: ['line 1', 'line 2', 'line 3', 'line 4', 'line 5'],
};
const STAMP = {
  ficoS: { framework: 'fico_s_v1_2', analysis_framework: 'fico_s_v1_2' },
  ficoSAtStart: { framework: 'fico_s_v1_2', analysis_framework: null }, // before the form is in: the column only
  ficoSV11: { framework: 'fico_s_v1_1', analysis_framework: 'fico_s_v1_1' },
  v6: { framework: 'fico17_v6', analysis_framework: 'fico17_v6' },
};

const ROW = (feedback, stamp) => ({
  id: ID, observer_user_id: ME, user_id: 'teacher', created_at: '2026-11-24T05:11:00Z', status: 'completed', debrief_status: 'done',
  feedback, feedback_at: '2026-11-24T06:00:00Z', topic: 'Fractions', subject: 'Maths', grade: '7',
  teacher_name: 'Teacher', delivery_teacher_name: null, sched_teacher_name: null, lp_check: LP_CHECK, ...stamp,
});

describe('the daily debrief report: no lesson plan block for a 6-12 visit', () => {
  const fb = { rubric: RUBRIC, did: {}, missed: {}, try: { move: 'Ask, then wait' }, focus: 'asked_and_waited', lp_discussion: lpDiscussion(['name_step', 'gap']) };

  test.each(['ficoS', 'ficoSAtStart', 'ficoSV11'])('6-12 (%s) judged with the block: lessonPlan is null', (stamp) => {
    expect(Report.shapeCoachReport(ROW(fb, STAMP[stamp])).lessonPlan).toBeNull();
  });

  test('6-12: the 8 behaviours, done and total are exactly the 1-5 numbers for the same judge', () => {
    const six = Report.shapeCoachReport(ROW(fb, STAMP.ficoS));
    const one = Report.shapeCoachReport(ROW(fb, STAMP.v6));
    expect(six.marks).toEqual(one.marks);
    expect(six.done).toBe(one.done);
    expect(six.total).toBe(one.total);
    expect(six.focus).toEqual(one.focus);
  });

  test('1-5 is unchanged: the block, n of 5 covered', () => {
    expect(Report.shapeCoachReport(ROW(fb, STAMP.v6)).lessonPlan).toMatchObject({ state: 'ok', covered: 2, total: 5 });
    // A row without the stamp columns (an older read) is not 6-12: as before.
    expect(Report.shapeCoachReport(ROW(fb, {})).lessonPlan).toMatchObject({ state: 'ok', covered: 2 });
  });

  test('6-12 with no plan linked: no "No lesson plan linked today" either', () => {
    const noPlan = { ...fb, lp_discussion: { v: 1, state: 'no_plan' } };
    expect(Report.shapeCoachReport(ROW(noPlan, STAMP.ficoS)).lessonPlan).toBeNull();
    expect(Report.shapeCoachReport(ROW(noPlan, STAMP.v6)).lessonPlan).toEqual({ state: 'no_plan' });
  });

  test('the read takes the stamp as two narrow text slices, never analysis_data whole', () => {
    expect(Report.SQL.REPORT).toMatch(/c\.framework\b/);
    expect(Report.SQL.REPORT).toMatch(/c\.analysis_data->>'framework' AS analysis_framework/);
    expect(Report.SQL.REPORT).not.toMatch(/c\.analysis_data AS|c\.analysis_data,/);
  });
});

describe('the weekly report: 6-12 debriefs never count in the lesson plan block', () => {
  const at = (date, hourPkt = 10) => new Date(Date.parse(`${date}T00:00:00Z`) + (hourPkt - 5) * 3600 * 1000).toISOString();
  const row = (id, iso, lp, stamp) => ({ id, created_at: iso, feedback_at: iso, rubric: RUBRIC, lp, ...stamp });
  const FRIDAY_5PM = new Date(at('2026-11-27', 17));
  const fakeQuery = (rows) => jest.fn(async (sql) => (sql === Week.SQL.DEBRIEFS ? { rows, rowCount: rows.length } : { rows: [], rowCount: 0 }));

  test('a week whose only checked debriefs are 6-12: no block; the 8 behaviours still count them', async () => {
    const rows = [
      row('a', at('2026-11-24'), lpDiscussion(PARTS), STAMP.ficoS),
      row('b', at('2026-11-25'), { v: 1, state: 'no_plan' }, STAMP.ficoSAtStart),
    ];
    const out = await Week.getCoachWeek(fakeQuery(rows), ME, '2026-11-23', FRIDAY_5PM);
    expect(out.week.lessonPlan).toBeNull();
    const plain = await Week.getCoachWeek(fakeQuery(rows.map((r) => ({ ...r, lp: null }))), ME, '2026-11-23', FRIDAY_5PM);
    const { lessonPlan: _a, ...withSix } = out.week;
    const { lessonPlan: _b, ...without } = plain.week;
    expect(withSix).toEqual(without);
  });

  test('mixed: only the 1-5 debriefs count, this week and last; 6-12 no-plan is not counted apart either', async () => {
    const rows = [
      row('a', at('2026-11-23'), lpDiscussion(PARTS), STAMP.v6),
      row('b', at('2026-11-24'), lpDiscussion(['gap']), STAMP.v6),
      row('c', at('2026-11-24', 11), lpDiscussion([]), STAMP.ficoS),
      row('d', at('2026-11-25'), { v: 1, state: 'no_plan' }, STAMP.ficoS),
      row('e', at('2026-11-18'), lpDiscussion(PARTS), STAMP.ficoS),
      row('f', at('2026-11-19'), lpDiscussion(['gap']), STAMP.v6),
    ];
    const lp = (await Week.getCoachWeek(fakeQuery(rows), ME, '2026-11-23', FRIDAY_5PM)).week.lessonPlan;
    expect(lp.week).toEqual({ full: 1, of: 2 });
    expect(lp.last).toEqual({ full: 0, of: 1 });
    expect(lp.noPlan).toBe(0);
    expect(lp.mostMissed).toMatchObject({ key: 'name_step', n: 1, of: 2 });
  });

  test('the week reads the stamp as two narrow text slices', () => {
    expect(Week.SQL.DEBRIEFS).toMatch(/c\.framework\b/);
    expect(Week.SQL.DEBRIEFS).toMatch(/c\.analysis_data->>'framework' AS analysis_framework/);
  });
});
