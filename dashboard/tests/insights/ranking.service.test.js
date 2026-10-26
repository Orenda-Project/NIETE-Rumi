'use strict';
/** NIGHTLY_JOB §4 stage 7 and §12 test 10: the priority threshold, product = prevalence × weight, the sub-row headline,
 * hysteresis within 10% and its log line, ranks 1 and 2 only on ok rows. */
const library = require('../../data/coachip/INTERVENTIONS.json');
const { rankScope } = require('../../lib/insights/ranking');
const X = require('./fixtures/rollups');

const COACH = X.uuid('c', 1);
function row(w, n, d, extra = {}) {
  return {
    scope_kind: 'coach', coach_user_id: COACH, school_id: null, sector: null, w_id: w, window_start: '2026-11-02', window_end: '2026-11-29',
    window_weeks: 4, numerator: n, denominator: d, numerator_observed: 0, denominator_observed: 0, teacher_count: 5, coach_count: 1,
    coaches_with_5plus: 1, excluded_mismatch: 0, excluded_unusable: 0, excluded_duplicate: 0, excluded_failed: 0, recordings: d,
    recordings_linked: d, stat_kind: null, stat_unit: null, stat_value: null, stat_base: null, rank: null, product: null,
    is_hysteresis_applied: false, grader_model: 'google/gemini-3.8-flash', framework_version: 'lp_fidelity',
    pipeline_version: 'coachip-1.0.0', status: 'ok', job_run_id: X.uuid('a', 1), computed_at: '2026-11-30T21:00:00.000Z',
    meta: { scoring_changed_on: null }, ...extra,
  };
}
const opts = (extra = {}) => ({ weaknesses: library.weaknesses, sectorShareByW: {}, previousOrder: null, ...extra });
const ranked = (rows) => rows.filter((r) => r.rank != null).sort((a, b) => a.rank - b.rank).map((r) => r.w_id);

describe('threshold and product', () => {
  test('product = prevalence × weight; the top two by product take ranks 1 and 2', () => {
    // W-IP 0.5 × 0.9 = 0.45; W-EXIT 0.6 × 0.6 = 0.36; W-WARM 0.8 × 0.4 = 0.32
    const { rows } = rankScope([row('W-IP', 10, 20), row('W-EXIT', 12, 20), row('W-WARM', 16, 20)], opts());
    expect(ranked(rows)).toEqual(['W-IP', 'W-EXIT']);
    expect(rows.find((r) => r.w_id === 'W-IP').product).toBeCloseTo(0.45, 4);
    expect(rows.find((r) => r.w_id === 'W-WARM').rank).toBeNull();
    for (const r of rows) expect(X.assertRollupChecks(r)).toBe(true);
  });

  test('below 40% needs 1.5 × the sector share; 40% needs 3 teachers', () => {
    const rows = [row('W-IP', 6, 20), row('W-EXIT', 9, 20, { teacher_count: 2 }), row('W-GP', 8, 20)];
    // W-IP 30%: sector 0.25 → 0.30 < 0.375, out; W-EXIT 45% but 2 teachers and sector 0.40 → out; W-GP 40% with 5 teachers → in.
    const out = rankScope(rows, opts({ sectorShareByW: { 'W-IP': 0.25, 'W-EXIT': 0.40 } })).rows;
    expect(ranked(out)).toEqual(['W-GP']);
    const out2 = rankScope(rows, opts({ sectorShareByW: { 'W-IP': 0.19 } })).rows; // 0.30 >= 0.285
    expect(ranked(out2)).toEqual(['W-IP', 'W-GP']);
  });

  test('only ok, S1-eligible, non-cause-line rows rank', () => {
    const rows = [row('W-IP', 15, 20, { status: 'insufficient', denominator: 19, numerator: 15 }), row('W-EXPLAIN', 18, 20),
      row('W-IP-PARTIAL', 18, 20), row('W-EXIT-TIME', 18, 20), row('W-PEER', 12, 20)];
    const out = rankScope(rows, opts()).rows;
    expect(ranked(out)).toEqual(['W-PEER']);
    for (const r of out) expect(X.assertRollupChecks(r)).toBe(true);
  });

  test('an empty scope ranks nothing and logs nothing', () => {
    expect(rankScope([], opts())).toEqual({ rows: [], log: [] });
  });
});

describe('sub-row headline', () => {
  test('W-IP-TIME replaces W-IP when it holds the majority of W-IP\'s hits', () => {
    const rows = [row('W-IP', 10, 20), row('W-IP-TIME', 6, 20), row('W-IP-NOPLAN', 3, 20), row('W-EXIT', 10, 20)];
    const out = rankScope(rows, opts()).rows;
    expect(ranked(out)).toEqual(['W-IP-TIME', 'W-EXIT']);
    expect(out.find((r) => r.w_id === 'W-IP').rank).toBeNull();
    expect(out.find((r) => r.w_id === 'W-IP-TIME').product).toBeCloseTo(0.45, 4);
  });

  test('half is not a majority: W-IP keeps the headline, and sub-rows never rank on their own', () => {
    const out = rankScope([row('W-IP', 10, 20), row('W-IP-TIME', 5, 20), row('W-IP-NOPLAN', 5, 20)], opts()).rows;
    expect(ranked(out)).toEqual(['W-IP']);
  });
});

describe('hysteresis (test 10)', () => {
  // W-IP 0.45 vs W-EXIT 0.6 × 0.7 = 0.42: within 10% of 0.45.
  const close = () => [row('W-IP', 10, 20), row('W-EXIT', 14, 20)];

  test('a first window uses the products', () => {
    const { rows, log } = rankScope(close(), opts());
    expect(ranked(rows)).toEqual(['W-IP', 'W-EXIT']);
    expect(rows.every((r) => r.is_hysteresis_applied === false)).toBe(true);
    expect(log).toEqual([]);
  });

  test('within 10%, last window\'s order is kept, the flag set and one ids-only line logged', () => {
    const { rows, log } = rankScope(close(), opts({ previousOrder: ['W-EXIT', 'W-IP'] }));
    expect(ranked(rows)).toEqual(['W-EXIT', 'W-IP']);
    expect(rows.filter((r) => r.rank != null).every((r) => r.is_hysteresis_applied)).toBe(true);
    expect(log).toEqual(['hysteresis scope=coach w1=W-EXIT w2=W-IP']);
  });

  test('outside 10%, the products win even against last window\'s order', () => {
    const { rows, log } = rankScope([row('W-IP', 10, 20), row('W-EXIT', 12, 20)], opts({ previousOrder: ['W-EXIT', 'W-IP'] }));
    expect(ranked(rows)).toEqual(['W-IP', 'W-EXIT']);
    expect(log).toEqual([]);
  });

  test('a previous order on the parent still holds when the headline is now its sub-row', () => {
    const rows = [row('W-IP', 10, 20), row('W-IP-TIME', 7, 20), row('W-EXIT', 14, 20)];
    const { rows: out, log } = rankScope(rows, opts({ previousOrder: ['W-EXIT', 'W-IP'] }));
    expect(ranked(out)).toEqual(['W-EXIT', 'W-IP-TIME']);
    expect(log).toEqual(['hysteresis scope=coach w1=W-EXIT w2=W-IP-TIME']);
  });

  test('the sector scope ranks its own rows and logs its kind', () => {
    const s = (w, n, d) => row(w, n, d, { scope_kind: 'sector', coach_user_id: null, sector: 'Tarnol', denominator: d, coaches_with_5plus: 3, coach_count: 4 });
    const { rows, log } = rankScope([s('W-IP', 20, 40), s('W-EXIT', 28, 40)], opts({ previousOrder: ['W-EXIT', 'W-IP'] }));
    expect(ranked(rows)).toEqual(['W-EXIT', 'W-IP']);
    expect(log).toEqual(['hysteresis scope=sector w1=W-EXIT w2=W-IP']);
    for (const r of rows) expect(X.assertRollupChecks(r)).toBe(true);
  });

  test('W-Q and W-FB are held out of the ranking (C1/C3 at 2 on 90%/57% of v3 lessons; board 13:17Z); their rows stay, unranked', () => {
    const { rows } = rankScope([row('W-Q', 19, 20), row('W-FB', 15, 20), row('W-IP', 9, 20)], opts());
    expect(ranked(rows)).toEqual(['W-IP']);
    expect(rows.find((r) => r.w_id === 'W-Q')).toMatchObject({ rank: null, status: 'ok' });
  });
});
