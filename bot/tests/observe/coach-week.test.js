/**
 * Coach reports in the app, phase 3 — the coach's WEEK (bot/shared/services/observe/coach-week.js, pure).
 *
 * The ICT HITL owner's weekly report (her 16 Oct document) and the plan's rules where her document is silent:
 *   - the week runs Monday 00:00 to Friday 16:00 PKT; the report is ready at Friday 16:00; a debrief after that (or at
 *     the weekend) counts in the next week;
 *   - complete observations (a debrief recorded) against a target of 12 — never red;
 *   - ONE focus, first: the first behaviour, in the rubric's (and the modules') order, that is not yet done in 6 of
 *     her last 10 debriefs before the week; shown as counts, day by day, against her own last week;
 *   - it is done at 6 of the last 10; then the next behaviour in the same order is "what comes next";
 *   - steady strengths: done in more than 2/3 of the week's debriefs; at most two misses to keep in mind: done in
 *     fewer than half, lowest counts first, ties in module order; neither includes the focus;
 *   - fewer than 4 debriefs: counts only (no strengths, no misses);
 *   - the full table of all 8, this week and last.
 */
const W = require('../../shared/services/observe/coach-week');

const KEYS = ['opened_with_specific_praise', 'anchored_in_real_moment', 'asked_and_waited', 'one_improvement_only',
  'moves_not_teacher', 'elicited_if_then', 'righting_reflex_held', 'rehearsed_the_step'];
const rub = (doneKeys, over = {}) => {
  const r = { disparaged_teacher: false };
  for (const k of KEYS) r[k] = doneKeys.includes(k);
  return { ...r, ...over };
};
// PKT is UTC+5: 09:00 PKT = 04:00Z.
const at = (date, hourPkt = 9) => new Date(Date.parse(`${date}T00:00:00Z`) + (hourPkt - 5) * 3600 * 1000).toISOString();

describe('the calendar', () => {
  test('a week is Monday 00:00 to Friday 16:00 PKT', () => {
    const b = W.weekBounds('2026-11-02');
    expect(b).toMatchObject({ monday: '2026-11-02', friday: '2026-11-06' });
    expect(b.fromIso).toBe('2026-11-01T19:00:00.000Z');
    expect(b.toIso).toBe('2026-11-06T11:00:00.000Z');
  });

  test('a debrief counts in its week; after Friday 16:00 and at the weekend, in the next', () => {
    expect(W.weekOfDebrief(at('2026-11-02', 0.5))).toBe('2026-11-02');
    expect(W.weekOfDebrief(at('2026-11-06', 15))).toBe('2026-11-02');
    expect(W.weekOfDebrief(at('2026-11-06', 16))).toBe('2026-11-09');
    expect(W.weekOfDebrief(at('2026-11-08', 10))).toBe('2026-11-09');
  });

  test('the latest ready week: this week from Friday 16:00, else last week', () => {
    expect(W.latestReadyMonday(new Date(at('2026-11-06', 15.9)))).toBe('2026-10-26');
    expect(W.latestReadyMonday(new Date(at('2026-11-06', 16)))).toBe('2026-11-02');
    expect(W.latestReadyMonday(new Date(at('2026-11-08', 9)))).toBe('2026-11-02');
    expect(W.isMonday('2026-11-02')).toBe(true);
    expect(W.isMonday('2026-11-03')).toBe(false);
  });
});

describe('the summary', () => {
  // Ten debriefs before the week: praise and moment steady (10/10), asked & waited only 1 of 10 → the focus.
  const history = Array.from({ length: 10 }, (_, i) => ({
    at: at('2026-10-2' + (i % 5), 9 + i), rubric: rub(['opened_with_specific_praise', 'anchored_in_real_moment', 'moves_not_teacher', ...(i === 0 ? ['asked_and_waited'] : [])]),
  }));
  const lastWeek = history.slice(0, 9);
  const day = (d, waited, extra = []) => ({ at: at(d, 10), rubric: rub(['opened_with_specific_praise', 'moves_not_teacher', ...(waited ? ['asked_and_waited'] : []), ...extra]) });
  const thisWeek = [
    day('2026-11-03', true, ['anchored_in_real_moment']), day('2026-11-03', false, ['anchored_in_real_moment']),
    day('2026-11-04', false, ['anchored_in_real_moment']), day('2026-11-04', true, ['anchored_in_real_moment', 'elicited_if_then']),
    day('2026-11-05', true, ['anchored_in_real_moment']), day('2026-11-05', true, ['elicited_if_then']),
    day('2026-11-06', false, ['anchored_in_real_moment']), day('2026-11-06', false, ['anchored_in_real_moment', 'one_improvement_only']),
    day('2026-11-02', false, ['one_improvement_only']), day('2026-11-02', false, ['one_improvement_only', 'elicited_if_then']),
  ];
  const s = W.summariseWeek({ monday: '2026-11-02', thisWeek, lastWeek, before: history });

  test('complete observations against 12; the debriefs this week', () => {
    expect(s).toMatchObject({ monday: '2026-11-02', target: 12, complete: 10, debriefs: 10, small: false });
  });

  test('the focus: the first behaviour not done in 6 of her last 10 before the week, with its module', () => {
    expect(s.focus.key).toBe('asked_and_waited');
    expect(s.focus.module).toBe(3);
    expect(s.focus.week).toEqual({ done: 4, of: 10 });
    expect(s.focus.last).toEqual({ done: 1, of: 9 });
  });

  test('day by day, Monday to Friday: each debrief as done or not', () => {
    expect(s.focus.days.map((d) => d.date)).toEqual(['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06']);
    expect(s.focus.days.map((d) => d.items)).toEqual([[false, false], [true, false], [false, true], [true, true], [false, false]]);
  });

  test('where she is: the focus in her last 10 debriefs up to Friday; done at 6; what comes next', () => {
    expect(s.focus.last10).toEqual({ done: 4, of: 10 });
    expect(s.focus.doneAt).toBe(6);
    expect(s.focus.reached).toBe(false);
    expect(s.focus.next).toBe('one_improvement_only');
  });

  test('steady strengths: more than 2/3 of the week, never the focus', () => {
    expect(s.strengths.map((x) => [x.key, x.done, x.of])).toEqual([
      ['opened_with_specific_praise', 10, 10], ['anchored_in_real_moment', 7, 10], ['moves_not_teacher', 10, 10],
    ]);
  });

  test('at most two misses: fewer than half, lowest first, ties in module order, never the focus', () => {
    expect(s.keepInMind.map((x) => [x.key, x.done])).toEqual([['righting_reflex_held', 0], ['rehearsed_the_step', 0]]);
  });

  test('the full table of all 8, this week and last', () => {
    expect(s.table.map((r) => r.key)).toEqual(KEYS);
    expect(s.table[2]).toEqual({ key: 'asked_and_waited', week: { done: 4, of: 10 }, last: { done: 1, of: 9 } });
  });

  test('respect held in every debrief', () => {
    expect(s.respectAll).toBe(true);
    const bad = W.summariseWeek({ monday: '2026-11-02', thisWeek: [...thisWeek, { at: at('2026-11-05'), rubric: rub([], { disparaged_teacher: true }) }], lastWeek, before: history });
    expect(bad.respectAll).toBe(false);
  });

  test('a small first week: counts only, no strengths or misses, no last week', () => {
    const q = W.summariseWeek({ monday: '2026-11-02', thisWeek: thisWeek.slice(0, 3), lastWeek: [], before: [] });
    expect(q).toMatchObject({ debriefs: 3, small: true, strengths: [], keepInMind: [] });
    expect(q.focus.last).toBeNull();
    expect(q.focus.key).toBe('asked_and_waited');
  });

  test('a focus that reaches 6 of 10 this week is done, and the next one is named', () => {
    const strong = Array.from({ length: 6 }, (_, i) => ({ at: at('2026-11-04', 9 + i), rubric: rub(['opened_with_specific_praise', 'anchored_in_real_moment', 'moves_not_teacher', 'asked_and_waited']) }));
    const r = W.summariseWeek({ monday: '2026-11-02', thisWeek: strong, lastWeek, before: history });
    expect(r.focus.key).toBe('asked_and_waited');
    expect(r.focus.reached).toBe(true);
    expect(r.focus.next).toBe('one_improvement_only');
  });

  // bd-enec2e.5 (7 Nov sandbox e2e): a coach with months of debriefs and none last week was told "Your first week".
  test('firstWeek: only when no debrief came before this week, not merely none last week', () => {
    expect(W.summariseWeek({ monday: '2026-11-02', thisWeek: thisWeek.slice(0, 3), lastWeek: [], before: [] }).firstWeek).toBe(true);
    const older = history.slice(0, 2).map((d) => ({ ...d, at: at('2026-10-01', 10) }));
    const r = W.summariseWeek({ monday: '2026-11-02', thisWeek: thisWeek.slice(0, 3), lastWeek: [], before: older });
    expect(r.focus.last).toBeNull();
    expect(r.firstWeek).toBe(false);
    expect(s.firstWeek).toBe(false);
  });

  test('no debriefs: an empty week, never an invented one', () => {
    const e = W.summariseWeek({ monday: '2026-11-02', thisWeek: [], lastWeek: [], before: [] });
    expect(e).toMatchObject({ debriefs: 0, complete: 0, small: true });
  });
});
