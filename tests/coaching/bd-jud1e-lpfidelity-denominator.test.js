'use strict';
/**
 * computeScores() is the ONLY thing allowed to write scores.overall_max_marks.
 *
 * The applicable-aware denominator landed in computeScores: an indicator marked
 * `applicable: false` leaves both sides of the fraction. But applyLpFidelity()
 * runs AFTERWARDS on every measured-fidelity session and rewrote the denominator
 * back to the flat framework constant (148). The exclusion therefore removed the
 * inapplicable rows from the NUMERATOR only: the teacher lost the marks and kept
 * the full divisor, and her reported percentage went DOWN for no change in her
 * teaching.
 *
 * Measured on production: 2,773 of 8,917 sessions carry overall_max_marks = 148
 * while the sum of their own four domain_max values is lower — mean 3.3 points
 * understated, max 6.7.
 *
 * These tests run the real functions in the real order, with no mocks.
 */
const fico = require('../../bot/shared/services/coaching/frameworks/fico-framework');

const C = fico.getScoringConstants();
const SCALE = C.scaleMax;
const DOMS = C.domains;
const B_KEY = 'lesson_plan_fidelity';
const F_KEY = 'teacher_subject_knowledge';
const B_MAX = DOMS[B_KEY].indicatorCount * SCALE;
const PER = 1; // a valid rung on either rubric revision

// Numbers come from the framework's own constants, never a literal: the rubric
// has already moved once (37 indicators on a 1-4 scale to 26 on 0-2), and a test
// that hard-codes one revision stops proving anything on the other while still
// looking green.
const rows = (prefix, n, score) =>
  Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i + 1}`, score }));

function fullDomains() {
  const out = {};
  for (const [key, def] of Object.entries(DOMS)) {
    out[key] = { indicators: rows(def.key, def.indicatorCount, PER) };
  }
  return out;
}

// Mark the last two Section F rows not applicable — the subject-gated rows that
// at most one lesson can ever exercise.
function domainsWithTwoInapplicableF() {
  const out = fullDomains();
  const inds = out[F_KEY].indicators;
  for (const i of [inds.length - 2, inds.length - 1]) {
    inds[i] = { id: inds[i].id, score: null, applicable: false, evidence: 'Not applicable to this lesson subject.' };
  }
  return out;
}

const sumMarks = (doms, exclude = []) => Object.entries(doms).reduce((t, [k, d]) => (
  exclude.includes(k) ? t : t + d.indicators.filter((i) => i.applicable !== false).reduce((s, i) => s + (i.score || 0), 0)
), 0);
const sumMax = (doms, exclude = []) => Object.entries(doms).reduce((t, [k, d]) => (
  exclude.includes(k) ? t : t + d.indicators.filter((i) => i.applicable !== false).length * SCALE
), 0);

describe('applyLpFidelity keeps the applicable-aware denominator', () => {
  test('THE BUG: a measured session keeps the honest denominator, not the flat constant', () => {
    const doms = domainsWithTwoInapplicableF();
    const a = fico.computeScores({ framework: 'fico', domains: doms });
    const honest = sumMax(doms);
    expect(honest).toBe(C.maxMarks - 2 * SCALE);
    expect(a.scores.overall_max_marks).toBe(honest); // computeScores gets this right

    fico.applyLpFidelity(a, { status: 'ok', fidelity_pct: 50, band: 'partial' });

    const derivedB = Math.round(0.5 * B_MAX);
    expect(a.domains[B_KEY].domain_score).toBe(derivedB);
    expect(a.scores.overall_max_marks).toBe(honest);
    expect(a.scores.overall_max_marks).not.toBe(C.maxMarks);
    expect(a.scores.overall_marks).toBe(sumMarks(doms, [B_KEY]) + derivedB);
  });

  test('the percentage is computed over the same denominator it reports', () => {
    const a = fico.computeScores({ framework: 'fico', domains: domainsWithTwoInapplicableF() });
    fico.applyLpFidelity(a, { status: 'ok', fidelity_pct: 100 });
    const { overall_marks: marks, overall_max_marks: max, overall_percentage: pct } = a.scores;
    expect(pct).toBe(parseFloat(((marks / max) * 100).toFixed(1)));
  });

  test('BACK-COMPAT LOCK: no applicable flag anywhere still divides by the full constant', () => {
    const a = fico.computeScores({ framework: 'fico', domains: fullDomains() });
    fico.applyLpFidelity(a, { status: 'ok', fidelity_pct: 75 });
    expect(a.scores.overall_max_marks).toBe(C.maxMarks);
  });

  test('an analysis that never went through computeScores falls back to the declared maxima', () => {
    const handBuilt = { framework: 'fico', domains: { [B_KEY]: { indicators: rows('B', DOMS[B_KEY].indicatorCount, PER) } } };
    for (const [key, def] of Object.entries(DOMS)) {
      if (key === B_KEY) continue;
      handBuilt.domains[key] = { domain_score: 0, domain_max: def.indicatorCount * SCALE };
    }
    fico.applyLpFidelity(handBuilt, { status: 'ok', fidelity_pct: 50 });
    expect(handBuilt.scores.overall_max_marks).toBe(C.maxMarks);
  });

  test('a domain the analysis omitted still carries its declared max', () => {
    const partial = { framework: 'fico', domains: { [B_KEY]: { indicators: rows('B', DOMS[B_KEY].indicatorCount, PER) } } };
    fico.computeScores(partial);
    fico.applyLpFidelity(partial, { status: 'ok', fidelity_pct: 100 });
    expect(partial.scores.overall_max_marks).toBe(C.maxMarks);
    expect(partial.scores.overall_marks).toBe(B_MAX);
  });
});
