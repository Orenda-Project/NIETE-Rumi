'use strict';
/** NIGHTLY_JOB §5 and §12 test 8 (the calendar half): Karachi Monday-Sunday weeks, the Monday roll, held for the week,
 * series starts per instrument and the B19 refusal. */
const Wn = require('../../lib/insights/windows');
const { PIPELINE_VERSION } = require('../../lib/insights/constants');

describe('windowFor (Monday roll)', () => {
  test.each([
    ['2026-10-26', 4, '2026-09-28', '2026-10-25'], // Monday: the new window ends yesterday
    ['2026-10-27', 4, '2026-09-28', '2026-10-25'], // Tuesday: same window
    ['2026-11-01', 4, '2026-09-28', '2026-10-25'], // Sunday: still last week's window
    ['2026-11-02', 4, '2026-10-05', '2026-11-01'], // next Monday rolls
    ['2026-10-26', 8, '2026-08-31', '2026-10-25'],
    ['2026-11-23', 8, '2026-09-28', '2026-11-22'],
  ])('run %s, %i weeks → %s..%s', (run, weeks, start, end) => {
    expect(Wn.windowFor(run, weeks)).toEqual({ window_start: start, window_end: end, window_weeks: weeks });
  });

  test('a window starts on a Monday and is 7 × weeks days long', () => {
    for (const run of ['2026-10-26', '2026-10-29', '2027-01-03']) {
      for (const weeks of [4, 8]) {
        const w = Wn.windowFor(run, weeks);
        expect(new Date(`${w.window_start}T00:00:00Z`).getUTCDay()).toBe(1);
        expect(Wn.addDays(w.window_start, 7 * weeks - 1)).toBe(w.window_end);
      }
    }
  });

  test('a bad date or a week count other than 4 or 8 throws', () => {
    expect(() => Wn.windowFor('26-10-2026', 4)).toThrow();
    expect(() => Wn.windowFor('2026-10-26', 3)).toThrow();
  });

  test('mondayOf and mondayOnOrAfter', () => {
    expect(Wn.mondayOf('2026-10-25')).toBe('2026-10-19');
    expect(Wn.mondayOf('2026-10-26')).toBe('2026-10-26');
    expect(Wn.mondayOnOrAfter('2026-10-09')).toBe('2026-10-12');
    expect(Wn.mondayOnOrAfter('2026-10-12')).toBe('2026-10-12');
  });

  test('inWindow is inclusive at both ends', () => {
    const w = Wn.windowFor('2026-10-26', 4);
    expect(Wn.inWindow('2026-09-28', w)).toBe(true);
    expect(Wn.inWindow('2026-10-25', w)).toBe(true);
    expect(Wn.inWindow('2026-10-26', w)).toBe(false);
    expect(Wn.inWindow('2026-09-27', w)).toBe(false);
  });
});

describe('isHeldForWeek', () => {
  const prev = { window_end: '2026-10-25', pipeline_version: PIPELINE_VERSION, status: 'ok' };
  test('the Monday run computes; later runs that week hold', () => {
    expect(Wn.isHeldForWeek('2026-10-26', null)).toBe(false);
    expect(Wn.isHeldForWeek('2026-10-27', prev)).toBe(true);
    expect(Wn.isHeldForWeek('2026-11-01', prev)).toBe(true);
  });
  test('the next Monday rolls', () => {
    expect(Wn.isHeldForWeek('2026-11-02', prev)).toBe(false);
  });
  test('a changed pipeline version or a failed Monday attempt recomputes', () => {
    expect(Wn.isHeldForWeek('2026-10-27', { ...prev, pipeline_version: 'coachip-0.9.0' })).toBe(false);
    expect(Wn.isHeldForWeek('2026-10-27', { ...prev, status: 'failed' })).toBe(false);
    expect(Wn.isHeldForWeek('2026-10-27', { ...prev, status: 'partial' })).toBe(true);
  });
});

describe('series starts and B19', () => {
  test.each([
    ['lp_fidelity', 'google/gemini-3.8-flash', {}, '2026-09-28'],
    ['code', 'google/gemini-3.8-flash', {}, '2026-09-28'],
    ['fico_v3', 'analysis-processor', {}, '2026-09-14'],
    ['fico17', 'analysis-processor', {}, '2026-10-12'],
    ['egra', null, {}, '2026-10-26'],
    ['fico_v4', 'analysis-processor', { firstSeen: '2026-10-21' }, '2026-10-26'],
    ['coachip_detector', 'anthropic/claude-haiku-5.5', { firstSeen: '2026-10-27' }, '2026-10-27'],
  ])('%s (%s) starts %s', (fw, grader, opts, start) => {
    expect(Wn.seriesStartFor(fw, grader, opts)).toBe(start);
  });

  test('a history-only grader never has a product series', () => {
    expect(Wn.seriesStartFor('lp_fidelity', 'openai/gpt-5.6-luna')).toBe(Wn.NEVER);
    expect(Wn.refusesB19(Wn.windowFor('2027-06-07', 4), Wn.NEVER)).toBe(true);
  });

  test('v4 with no v4 session yet has no series', () => {
    expect(Wn.seriesStartFor('fico_v4', 'analysis-processor', {})).toBe(Wn.NEVER);
  });

  test('refusesB19: a window starting before the series start is refused; on or after is computed', () => {
    expect(Wn.refusesB19(Wn.windowFor('2026-10-26', 4), '2026-09-28')).toBe(false);
    expect(Wn.refusesB19(Wn.windowFor('2026-10-26', 8), '2026-09-28')).toBe(true);
    expect(Wn.refusesB19(Wn.windowFor('2026-11-23', 8), '2026-09-28')).toBe(false);
    expect(Wn.refusesB19(Wn.windowFor('2026-10-26', 4), null)).toBe(false);
  });
});
