/**
 * The lesson plan check in the coach's debrief report and weekly report (the ICT HITL owner's spec, 23 Nov 2026).
 *
 *   debrief report  last block: "Lesson plan discussion — n of 5 covered"; covered parts with the coach's own words,
 *                   missed parts with what happened; "Next time, add" for the first missed part only (the notes' own
 *                   line for it); the lesson's moves to fold open. Never scored: the 8 behaviours, done and total are
 *                   the same with and without it.
 *   weekly report   last block: full discussions (5 of 5) this week against last, the part missed most often, and the
 *                   debriefs with no plan linked (not counted as a miss).
 * Both read narrow JSON slices only (the feedback's lp_discussion, the notes' lp_check).
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
  v: 1, state: 'ok', done: 7, total: 12,
  steps: [{ key: 'we_do', name: 'We Do', done: 1, total: 3, moves: [{ id: 'm5', mark: 'done', label: 'Answer together' }, { id: 'm6', mark: 'missed', label: 'Partner practice', what: 'Children answered the teacher.' }] }],
  lines: ['line 1', 'line 2', 'line 3', 'What made partner practice hard to do today?', 'line 5'],
};

const ROW = (feedback, lpCheck = LP_CHECK) => ({
  id: ID, observer_user_id: ME, user_id: 'teacher', created_at: '2026-11-23T06:00:00Z', status: 'completed', debrief_status: 'done',
  feedback, feedback_at: '2026-11-23T06:40:00Z', topic: 'Nouns', subject: 'English', grade: '3',
  teacher_name: 'Teacher', delivery_teacher_name: null, sched_teacher_name: null, lp_check: lpCheck,
});

describe('the debrief report: the lesson plan discussion, last', () => {
  const base = { rubric: RUBRIC, did: {}, missed: {}, try: { move: 'Ask, then wait' }, focus: 'asked_and_waited' };

  test('n of 5 covered; covered parts quote the coach, missed parts say what happened, names in both languages', () => {
    const r = Report.shapeCoachReport(ROW({ ...base, lp_discussion: lpDiscussion(['name_step', 'as_planned', 'gap']) }));
    const lp = r.lessonPlan;
    expect(lp).toMatchObject({ state: 'ok', covered: 3, total: 5 });
    expect(lp.parts.map((p) => p.key)).toEqual(PARTS);
    expect(lp.parts[0]).toMatchObject({ covered: true, quote: 'quote for name_step', what: null });
    expect(lp.parts[3]).toMatchObject({ covered: false, quote: null, what: 'what happened at ask' });
    expect(lp.parts[3].name.en).toBe('Ask what got in the way');
    expect(lp.parts[3].name.ur).toBeTruthy();
  });

  test('"Next time, add" is the notes\' line for the FIRST missed part only', () => {
    const r = Report.shapeCoachReport(ROW({ ...base, lp_discussion: lpDiscussion(['name_step', 'as_planned', 'gap']) }));
    expect(r.lessonPlan.nextTime).toEqual({ key: 'ask', line: 'What made partner practice hard to do today?' });
    const all = Report.shapeCoachReport(ROW({ ...base, lp_discussion: lpDiscussion(PARTS) }));
    expect(all.lessonPlan.nextTime).toBeNull();
  });

  test('the lesson\'s moves, to fold open, come from the notes\' check', () => {
    const r = Report.shapeCoachReport(ROW({ ...base, lp_discussion: lpDiscussion([]) }));
    expect(r.lessonPlan.moves).toEqual(LP_CHECK.steps);
    expect(r.lessonPlan.moveCount).toBe(2);
  });

  test('never scored: the 8 behaviours, done and total are the same with and without the block', () => {
    const without = Report.shapeCoachReport(ROW(base, null));
    const withIt = Report.shapeCoachReport(ROW({ ...base, lp_discussion: lpDiscussion(['ask']) }));
    expect(withIt.marks).toEqual(without.marks);
    expect(withIt.done).toBe(without.done);
    expect(withIt.total).toBe(without.total);
    expect(without.lessonPlan).toBeNull();
  });

  test('no plan linked, or not assessed: the block says so, no parts', () => {
    expect(Report.shapeCoachReport(ROW({ ...base, lp_discussion: { v: 1, state: 'no_plan' } }, { v: 1, state: 'no_plan' })).lessonPlan)
      .toEqual({ state: 'no_plan' });
    expect(Report.shapeCoachReport(ROW({ ...base, lp_discussion: { v: 1, state: 'not_assessed', reason: 'mismatch' } })).lessonPlan)
      .toEqual({ state: 'not_assessed', reason: 'mismatch' });
  });

  test('a harmful debrief carries no lesson plan block (the concern only)', () => {
    const r = Report.shapeCoachReport(ROW({ ...base, rubric: { ...RUBRIC, disparaged_teacher: true }, concern: { what_happened: 'x' }, lp_discussion: lpDiscussion([]) }));
    expect(r.harmful).toBe(true);
    expect(r.lessonPlan).toBeNull();
  });

  test('the read takes only the narrow slices: the feedback and the notes\' lp_check, never analysis_data whole', () => {
    expect(Report.SQL.REPORT).toMatch(/'observer_debrief'->'guide_snapshot'->'lp_check' AS lp_check/);
    expect(Report.SQL.REPORT).not.toMatch(/c\.analysis_data AS|c\.analysis_data,/);
  });
});

describe('the weekly report: lesson plan discussions, last', () => {
  const at = (date, hourPkt = 10) => new Date(Date.parse(`${date}T00:00:00Z`) + (hourPkt - 5) * 3600 * 1000).toISOString();
  const row = (id, iso, lp) => ({ id, created_at: iso, feedback_at: iso, rubric: RUBRIC, lp });
  const FRIDAY_5PM = new Date(at('2026-11-27', 17));
  const fakeQuery = (rows) => jest.fn(async (sql) => (sql === Week.SQL.DEBRIEFS ? { rows, rowCount: rows.length } : { rows: [], rowCount: 0 }));

  test('full discussions this week against last, the part missed most often, no plan linked apart', async () => {
    const rows = [
      row('a', at('2026-11-23'), lpDiscussion(PARTS)),
      row('b', at('2026-11-24'), lpDiscussion(['name_step', 'gap'])),
      row('c', at('2026-11-25'), lpDiscussion(['name_step'])),
      row('d', at('2026-11-26'), { v: 1, state: 'no_plan' }),
      row('e', at('2026-11-18'), lpDiscussion(['gap'])),
    ];
    const out = await Week.getCoachWeek(fakeQuery(rows), ME, '2026-11-23', FRIDAY_5PM);
    const lp = out.week.lessonPlan;
    expect(lp.week).toEqual({ full: 1, of: 3 });
    expect(lp.last).toEqual({ full: 0, of: 1 });
    expect(lp.noPlan).toBe(1);
    expect(lp.mostMissed).toMatchObject({ key: 'as_planned', n: 2, of: 3 });
    expect(lp.mostMissed.name.en).toBe('What went as planned');
    expect(lp.mostMissed.name.ur).toBeTruthy();
  });

  test('a week with no lesson plan check (observer off the switch): no block', async () => {
    const out = await Week.getCoachWeek(fakeQuery([row('a', at('2026-11-23'), null)]), ME, '2026-11-23', FRIDAY_5PM);
    expect(out.week.lessonPlan).toBeNull();
  });

  test('the week reads the feedback\'s lp_discussion as a narrow slice', () => {
    expect(Week.SQL.DEBRIEFS).toMatch(/'observer_debrief'->'feedback'->'lp_discussion' AS lp/);
  });
});
