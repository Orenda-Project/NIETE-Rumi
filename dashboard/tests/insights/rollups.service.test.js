'use strict';
/** NIGHTLY_JOB §4 stage 6, §5, §12 tests 8-9: rollups per coach, school and sector; 4 → 8 → insufficient; B19 across a
 * series start; floors and B23; exclusions, coverage, the observed split and provenance. Every row passes the SQL CHECKs. */
const F = require('./fixtures/analysis');
const X = require('./fixtures/rollups');
const library = require('../../data/coachip/INTERVENTIONS.json');
const crosswalk = require('../../data/coachip/crosswalk.json');
const { buildSignals } = require('../../lib/insights/signals');
const { computeRollups } = require('../../lib/insights/rollups');
const { addDays } = require('../../lib/insights/windows');
const C = require('../../lib/insights/constants');

const ctx = { weaknesses: library.weaknesses, crosswalk };
const JOB = X.uuid('a', 1);
const { SCOPE: S } = X;

function scopes(extra = {}) {
  return {
    coaches: new Map([
      [S.coachA, { sector: 'Nilore', schoolIds: new Set([S.school1]) }],
      [S.coachB, { sector: 'Nilore', schoolIds: new Set([S.school1, S.school2]) }],
      [S.coachC, { sector: 'Nilore', schoolIds: new Set([S.school3]) }],
      [S.coachD, { sector: 'Nilore', schoolIds: new Set([S.school4]) }],
      ...(extra.coaches || []),
    ]),
    schools: new Map([[S.school1, 'Nilore'], [S.school2, 'Nilore'], [S.school3, 'Nilore'], [S.school4, 'Nilore']]),
    sectors: C.SECTORS,
  };
}

const IP_HIT = () => [F.move('m1', 'independent', 'not_done')];
const IP_DONE = () => [F.move('m1', 'independent', 'executed', { at: '10:00' })];

/** n lp facts at a school, spread over the days from `from` (one a day, wrapping every `span` days). */
function many(n, { school, from, span = 28, hits = 0, teacherBase = 0, teachers = null, observed = 0, opts = {} }) {
  const out = [];
  for (let i = 0; i < n; i += 1) {
    out.push(X.lpFact(i < hits ? IP_HIT() : IP_DONE(), {
      school, day: addDays(from, i % span), teacher: teacherBase + (teachers ? i % teachers : i), observed: i < observed, ...opts,
    }));
  }
  return out;
}

const run = (facts, runDate, extra = {}) => computeRollups({
  facts, signals: facts.flatMap((f) => buildSignals(f, ctx)), scopes: scopes(), runDate, jobRunId: JOB,
  computedAt: '2026-11-30T21:00:00.000Z', statFor: () => null, ...extra,
});
const pick = (rows, kind, id, w = 'W-IP') => rows.find((r) => r.scope_kind === kind && r.w_id === w
  && (kind === 'coach' ? r.coach_user_id === id : kind === 'school' ? r.school_id === id : r.sector === id));

describe('every returned row passes the SQL CHECKs', () => {
  test('a mixed run (lp + v3) yields only valid rows, with the store-ignored meta side field', () => {
    const facts = [...many(25, { school: S.school1, from: '2026-11-02', hits: 9 }),
      X.ficoFact(F.v3({ C1: 2 }), { school: S.school3, day: '2026-11-05' })];
    const rows = run(facts, '2026-11-30');
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(X.assertRollupChecks(r)).toBe(true);
    expect(rows.every((r) => r.pipeline_version === C.PIPELINE_VERSION && r.job_run_id === JOB)).toBe(true);
  });
});

describe('the window rule (test 8)', () => {
  test('4 weeks when the 4-week denominator clears 20', () => {
    const rows = run(many(20, { school: S.school3, from: '2026-11-02', hits: 9 }), '2026-11-30');
    const r = pick(rows, 'coach', S.coachC);
    expect([r.status, r.window_weeks, r.window_start, r.window_end, r.numerator, r.denominator]).toEqual(['ok', 4, '2026-11-02', '2026-11-29', 9, 20]);
    expect(r.framework_version).toBe('lp_fidelity');
    expect(r.grader_model).toBe('google/gemini-3.8-flash');
  });

  test('8 weeks when only the 8-week denominator clears 20', () => {
    const facts = [...many(12, { school: S.school3, from: '2026-11-02', hits: 3 }), ...many(10, { school: S.school3, from: '2026-10-05', hits: 2, teacherBase: 100 })];
    const r = pick(run(facts, '2026-11-30'), 'coach', S.coachC);
    expect([r.status, r.window_weeks, r.window_start, r.numerator, r.denominator]).toEqual(['ok', 8, '2026-10-05', 5, 22]);
  });

  test('else the 8-week row is insufficient with its counts', () => {
    const facts = [...many(6, { school: S.school3, from: '2026-11-02', hits: 2 }), ...many(4, { school: S.school3, from: '2026-10-05', teacherBase: 100 })];
    const r = pick(run(facts, '2026-11-30'), 'coach', S.coachC);
    expect([r.status, r.window_weeks, r.numerator, r.denominator]).toEqual(['insufficient', 8, 2, 10]);
    expect(r.meta.scoring_changed_on).toBeNull();
  });

  test('a scope with no lesson at all still gets an insufficient row (n of 20 reads 0)', () => {
    const r = pick(run(many(3, { school: S.school3, from: '2026-11-02' }), '2026-11-30'), 'coach', S.coachD);
    expect([r.status, r.denominator, r.numerator]).toEqual(['insufficient', 0, 0]);
  });

  test('B19: an 8-week window starting before the fidelity series start is not computed (4 weeks, insufficient, scoring_changed_on)', () => {
    const r = pick(run(many(12, { school: S.school3, from: '2026-09-28', hits: 4 }), '2026-10-26'), 'coach', S.coachC);
    expect([r.status, r.window_weeks, r.window_start, r.denominator, r.numerator]).toEqual(['insufficient', 4, '2026-09-28', 12, 4]);
    expect(r.meta.scoring_changed_on).toBe('2026-09-28');
  });

  test('B19: from 23 Nov 2026 the 8-week fidelity window fits after 28 Sep', () => {
    const facts = [...many(10, { school: S.school3, from: '2026-10-26' }), ...many(12, { school: S.school3, from: '2026-09-28', teacherBase: 100 })];
    const r = pick(run(facts, '2026-11-23'), 'coach', S.coachC);
    expect([r.status, r.window_weeks, r.window_start, r.denominator]).toEqual(['ok', 8, '2026-09-28', 22]);
  });

  test('B19 across the v4 switch: both instruments read insufficient with the switch Monday', () => {
    const v3 = [];
    for (let i = 0; i < 25; i += 1) v3.push(X.ficoFact(F.v3({ C1: i < 10 ? 2 : 3 }), { school: S.school3, day: addDays('2026-10-12', i % 9), teacher: i }));
    const v4 = [];
    for (let i = 0; i < 25; i += 1) v4.push(X.ficoFact(F.v4({ C1: i < 5 ? 0 : 1 }), { school: S.school3, day: addDays('2026-10-21', i % 18), teacher: i }));
    const rows = run([...v3, ...v4], '2026-11-09').filter((r) => r.scope_kind === 'coach' && r.coach_user_id === S.coachC && r.w_id === 'W-Q');
    expect(rows.map((r) => r.framework_version).sort()).toEqual(['fico_v3', 'fico_v4']);
    for (const r of rows) {
      expect(r.status).toBe('insufficient');
      expect(r.meta.scoring_changed_on).toBe('2026-10-26');
    }
  });

  test('history-only grader facts never enter a product rollup', () => {
    const facts = many(25, { school: S.school3, from: '2026-11-02', hits: 5, opts: { model: 'openai/gpt-5.6-luna' } });
    const rows = run(facts, '2026-11-30');
    expect(rows.some((r) => r.grader_model === 'openai/gpt-5.6-luna')).toBe(false);
  });
});

describe('floors and B23 (test 9)', () => {
  test('coach floor 20: 19 lessons is not ok at 4 weeks; school floor 20', () => {
    const rows = run(many(19, { school: S.school3, from: '2026-11-02', hits: 5 }), '2026-11-30');
    expect(pick(rows, 'coach', S.coachC).status).toBe('insufficient');
    expect(pick(rows, 'school', S.school3).status).toBe('insufficient');
    const rows20 = run(many(20, { school: S.school3, from: '2026-11-02', hits: 5 }), '2026-11-30');
    expect(pick(rows20, 'school', S.school3).status).toBe('ok');
  });

  test('sector ok at 40+ with 3 coaches of 5+', () => {
    const facts = [...many(20, { school: S.school1, from: '2026-11-02', hits: 8 }), ...many(10, { school: S.school3, from: '2026-11-02', hits: 4, teacherBase: 100 }),
      ...many(10, { school: S.school4, from: '2026-11-02', hits: 4, teacherBase: 200 })];
    const r = pick(run(facts, '2026-11-30'), 'sector', 'Nilore');
    // school1 is held by coaches A and B: one lesson counts for both coaches, once for the sector.
    expect([r.status, r.window_weeks, r.denominator, r.numerator, r.coach_count, r.coaches_with_5plus]).toEqual(['ok', 4, 40, 16, 4, 4]);
  });

  test('sector at 45 but only 2 coaches with 5+ is insufficient with coach_count (B23)', () => {
    const facts = [...many(41, { school: S.school3, from: '2026-11-02', hits: 8 }), ...many(4, { school: S.school4, from: '2026-11-02', teacherBase: 100 })];
    const r = pick(run(facts, '2026-11-30'), 'sector', 'Nilore');
    expect([r.status, r.denominator, r.coach_count, r.coaches_with_5plus]).toEqual(['insufficient', 45, 2, 1]);
  });

  test('sector below 40 is insufficient even with enough coaches', () => {
    const facts = [...many(13, { school: S.school1, from: '2026-11-02' }), ...many(13, { school: S.school3, from: '2026-11-02', teacherBase: 100 }),
      ...many(13, { school: S.school4, from: '2026-11-02', teacherBase: 200 })];
    const r = pick(run(facts, '2026-11-30'), 'sector', 'Nilore');
    expect([r.status, r.window_weeks, r.denominator]).toEqual(['insufficient', 8, 39]);
  });
});

describe('counts, exclusions, coverage, provenance', () => {
  test('a lesson counts for every coach holding the school', () => {
    const rows = run(many(20, { school: S.school1, from: '2026-11-02', hits: 4 }), '2026-11-30');
    expect(pick(rows, 'coach', S.coachA).denominator).toBe(20);
    expect(pick(rows, 'coach', S.coachB).denominator).toBe(20);
    expect(pick(rows, 'coach', S.coachC).denominator).toBe(0);
  });

  test('observed split, teacher_count over hits, exclusions by reason, recordings and linked', () => {
    const facts = [
      ...many(20, { school: S.school3, from: '2026-11-02', hits: 10, teachers: 4, observed: 3 }),
      X.lpFact(IP_HIT(), { school: S.school3, day: '2026-11-03', note: 'lesson_mismatch' }),
      X.lpFact(IP_HIT(), { school: S.school3, day: '2026-11-03', unusable: true }),
      X.lpFact(IP_HIT(), { school: S.school3, day: '2026-11-03', duplicate: true }),
      X.lpFact(IP_HIT(), { school: S.school3, day: '2026-11-04', model: null }),
      X.ficoFact(F.v3({}), { school: S.school3, day: '2026-11-04' }),
      X.lpFact(IP_HIT(), { school: S.school3, day: '2026-10-01', duplicate: true }), // outside the 4-week window
    ];
    const r = pick(run(facts, '2026-11-30'), 'coach', S.coachC);
    expect([r.window_weeks, r.numerator, r.denominator, r.numerator_observed, r.denominator_observed]).toEqual([4, 10, 20, 3, 3]);
    expect(r.teacher_count).toBe(4);
    expect([r.excluded_mismatch, r.excluded_unusable, r.excluded_duplicate, r.excluded_failed]).toEqual([1, 1, 1, 1]);
    expect([r.recordings, r.recordings_linked]).toEqual([25, 24]);
  });

  test('stat_* come from statFor over the chosen window\'s hit facts; null leaves them null', () => {
    const facts = many(20, { school: S.school3, from: '2026-11-02', hits: 6 });
    const seen = [];
    const statFor = (w, hitFacts) => {
      if (w !== 'W-IP') return null;
      seen.push(hitFacts.length);
      return { stat_kind: 'median', stat_unit: 'min', stat_value: 4.5, stat_base: hitFacts.length };
    };
    const rows = run(facts, '2026-11-30', { statFor });
    const r = pick(rows, 'coach', S.coachC);
    expect([r.stat_kind, r.stat_unit, r.stat_value, r.stat_base]).toEqual(['median', 'min', 4.5, 6]);
    expect(seen).toContain(6);
    const g = pick(rows, 'coach', S.coachC, 'W-GP');
    expect([g.stat_kind, g.stat_value]).toEqual([null, null]);
  });

  test('rank and product are left for the ranking stage', () => {
    const r = pick(run(many(20, { school: S.school3, from: '2026-11-02', hits: 6 }), '2026-11-30'), 'coach', S.coachC);
    expect([r.rank, r.product, r.is_hysteresis_applied]).toEqual([null, null, false]);
  });

  test('no teacher key, quote or name leaves the module', () => {
    const facts = many(20, { school: S.school3, from: '2026-11-02', hits: 6 });
    const s = JSON.stringify(run(facts, '2026-11-30'));
    for (const f of facts) expect(s).not.toContain(f.teacher_key);
    expect(s).not.toMatch(/placeholder/);
  });
});
