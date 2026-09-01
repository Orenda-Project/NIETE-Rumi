/**
 * bd-0c01q — FICO v4: the team's 26 indicators, three rungs, count-based, applicable-only.
 *
 * RED FIRST. Every test in here must fail against develop before a line of the fix is written.
 * The four things it locks:
 *   .1  the focus_area prompt must not anchor on any one indicator, and C1's top rung must be
 *       a reachable COUNT rather than the unreachable proportion that pinned it at 2 in 90.4%
 *       of 2,788 live lessons
 *   .2  three rungs, zero-based, with a ceiling a real teacher can reach
 *   .3  the team's 26 (B7 · C4 · D5 · F10), and no indicator without a count
 *   .4  non-applicable indicators leave BOTH sides of the fraction
 *   .6  the module header documents the rubric the module actually runs
 */
const fico = require('../../bot/shared/services/coaching/frameworks/fico-framework');

const ind = (id, score, applicable = true) => ({ id, score, applicable, evidence: 'x' });
const withRows = (rows, domain = 'high_leverage_practices') =>
  ({ domains: { [domain]: { indicators: rows } } });

const allIndicators = () =>
  Object.values(fico.getScoringConstants().domains).flatMap((d) => d.indicators);

describe('bd-0c01q.1 — the focus_area prompt must not anchor on one indicator', () => {
  const p = fico.buildAnalysisPrompt('transcript', { subject: 'Mathematics', language: 'en' });

  test('no worked example is given for the indicator id', () => {
    expect(p).not.toMatch(/e\.g\.\s*C1/);
  });

  test('the failed "do not default to questioning" guard is gone with it', () => {
    // It has been in the prompt the whole time and lost to the example beside it.
    // Removing the source is the fix; keeping a guard nobody can evaluate is not.
    expect(p).not.toMatch(/do not default to "questioning"/i);
  });

  test('the growth area is instructed to come from the lowest-scored indicators', () => {
    expect(p).toMatch(/scored LOWEST/);
  });
});

describe('bd-0c01q.1 — C1 rung 2 must be a reachable, countable bar', () => {
  const c1 = () => allIndicators().find((i) => i.id === 'C1');

  test('C1 still exists in the team set', () => {
    expect(c1()).toBeDefined();
  });

  test('no rung of C1 requires open questions to "dominate"', () => {
    expect(JSON.stringify(c1().levels)).not.toMatch(/dominate/i);
  });

  test('C1 names an absolute number of open-ended questions', () => {
    expect(`${c1().levels[2]}`).toMatch(/THREE OR MORE|>=\s*3|\b3\b/);
  });
});

describe('bd-0c01q.3 — the team\'s 26, and every one of them counts something', () => {
  const { domains, totalIndicators, maxMarks, scaleMax } = fico.getScoringConstants();

  test('26 indicators, shaped B7 · C4 · D5 · F10', () => {
    expect(totalIndicators).toBe(26);
    const bySection = {};
    for (const d of Object.values(domains)) bySection[d.key] = d.indicators.length;
    expect(bySection).toEqual({ B: 7, C: 4, D: 5, F: 10 });
  });

  test('every domain agrees with its own indicator list', () => {
    for (const d of Object.values(domains)) {
      expect(d.indicatorCount).toBe(d.indicators.length);
    }
    const counted = Object.values(domains).reduce((n, d) => n + d.indicators.length, 0);
    expect(counted).toBe(totalIndicators);
    expect(maxMarks).toBe(totalIndicators * scaleMax);
  });

  test('every indicator names the unit it counts and what does NOT count', () => {
    for (const i of allIndicators()) {
      expect(typeof i.count).toBe('string');
      expect(i.count.length).toBeGreaterThan(10);
      expect(typeof i.notCounted).toBe('string');
      expect(i.notCounted.length).toBeGreaterThan(20);
    }
  });

  test('exactly seven indicators are subject-gated, across three subjects', () => {
    const gated = allIndicators().filter((i) => i.subject);
    expect(gated.length).toBe(7);
    expect(new Set(gated.map((i) => i.subject))).toEqual(new Set(['maths', 'science', 'literacy']));
  });
});

describe('bd-0c01q.2 — three rungs, zero-based, reachable ceiling', () => {
  test('the scale has three rungs and starts at zero', () => {
    expect(fico.getScoringConstants().scaleMax).toBe(2);
  });

  test('no indicator defines a fourth rung', () => {
    for (const i of allIndicators()) {
      expect(i.levels[3]).toBeUndefined();
      expect(i.levels[4]).toBeUndefined();
      expect(i.levels[0]).toBeDefined();
    }
  });

  test('Proficient on everything scores exactly 100%, not 75%', () => {
    const max = fico.getScoringConstants().scaleMax;
    const rows = ['C1', 'C2', 'C3', 'C4'].map((id) => ind(id, max));
    expect(fico.computeScores(withRows(rows)).scores.overall_percentage).toBe(100);
  });

  test('not observed on everything scores exactly 0%, not 25%', () => {
    const rows = ['C1', 'C2', 'C3', 'C4'].map((id) => ind(id, 0));
    const a = fico.computeScores(withRows(rows));
    expect(a.scores.overall_percentage).toBe(0);
    // the denominator must reflect the four scored rows, not a global constant
    expect(a.scores.overall_max_marks).toBe(4 * fico.getScoringConstants().scaleMax);
  });
});

describe('bd-0c01q.4 — non-applicable indicators leave BOTH sides of the fraction', () => {
  const max = () => fico.getScoringConstants().scaleMax;

  test('a non-applicable indicator is excluded from the denominator', () => {
    const a = fico.computeScores(withRows([
      ind('C1', max()), ind('C2', max()), ind('C3', null, false),
    ]));
    expect(a.scores.overall_max_marks).toBe(2 * max());
    expect(a.scores.overall_percentage).toBe(100);
  });

  test('a non-applicable row contributes nothing at all', () => {
    // NB: comparing two percentages passes vacuously while both divide by a constant.
    // Assert the denominator, which is the thing that is wrong today.
    const a = fico.computeScores(withRows([ind('C1', max()), ind('C2', null, false)]));
    expect(a.scores.overall_max_marks).toBe(1 * max());
    expect(a.scores.overall_percentage).toBe(100);
  });

  test('the count of applicable and non-applicable indicators is reported', () => {
    const a = fico.computeScores(withRows([
      ind('C1', 1), ind('C2', 1), ind('C3', null, false), ind('C4', null, false),
    ]));
    expect(a.scores.indicators_applicable).toBe(2);
    expect(a.scores.indicators_not_applicable).toBe(2);
  });

  test('a session with NO applicable flags still scores (additive, pre-cutover safe)', () => {
    const a = fico.computeScores(withRows([{ id: 'C1', score: 2 }, { id: 'C2', score: 1 }]));
    expect(a.scores.overall_percentage).toBe(75);
  });

  test('the prompt tells the scorer to declare applicability, not infer it from the subject', () => {
    const p = fico.getSystemPrompt();
    expect(p).toMatch(/"applicable":\s*false/);
    expect(p).toMatch(/LEAVES THE TOTAL|leaves the total/);
  });
});

describe('bd-0c01q.4 — applyLpFidelity must not reintroduce a hardcoded denominator', () => {
  test('the overall max after a fidelity override still reflects applicable indicators only', () => {
    const analysis = {
      domains: {
        lesson_plan_fidelity: { indicators: ['B1', 'B2'].map((id) => ind(id, 1)) },
        high_leverage_practices: {
          indicators: [ind('C1', 2), ind('C2', 2), ind('C3', null, false)],
        },
      },
    };
    // Asserting only "unchanged before vs after" passes VACUOUSLY while both are the same
    // hardcoded constant. Assert the actual applicable-aware value: 4 scorable rows (B1, B2,
    // C1, C2) with C3 excluded.
    const max = fico.getScoringConstants().scaleMax;
    fico.computeScores(analysis);
    expect(analysis.scores.overall_max_marks).toBe(4 * max);
    fico.applyLpFidelity(analysis, { status: 'ok', fidelity_pct: 50 });
    expect(analysis.scores.overall_max_marks).toBe(4 * max);
    // Section B is overridden to 50% of ITS applicable max (2 rows x scaleMax), not of a constant
    expect(analysis.domains.lesson_plan_fidelity.domain_score).toBe(Math.round(0.5 * 2 * max));
  });
});

describe('bd-0c01q.6 — the header cannot drift from the constants again', () => {
  test('the module header documents the rubric the module actually runs', () => {
    const src = require('fs').readFileSync(
      require.resolve('../../bot/shared/services/coaching/frameworks/fico-framework'), 'utf8');
    const header = src.slice(0, src.indexOf('*/'));
    const { totalIndicators, maxMarks } = fico.getScoringConstants();
    expect(header).toContain(`${totalIndicators} indicators`);
    expect(header).toContain(`${maxMarks}`);
    expect(header).not.toMatch(/scale 1-4/);
  });
});

describe('bd-0c01q — the prompt budget cannot rot', () => {
  test('the full rubric payload stays within 5% of what production runs today', () => {
    const sys = fico.getSystemPrompt();
    const usr = fico.buildAnalysisPrompt('T', { subject: 'Mathematics', language: 'en' });
    // Measured on origin/main 2026-09-01: system 18,220 + user 14,683 = 32,903 chars.
    // The constraint is instruction adherence, not the context window — a long rubric buries
    // the scoring discipline. The 26-indicator cut is what pays for richer per-indicator guidance.
    expect(sys.length + usr.length).toBeLessThan(Math.round(32903 * 1.05));
  });
});
