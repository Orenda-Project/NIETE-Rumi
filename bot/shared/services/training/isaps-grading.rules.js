/**
 * bd-60113 — I-SAPS weighted composite grading rules.
 *
 * Source: "Assessment Administration Process — Virtual Training Contents
 * Development for SSTs of FDE Schools/Colleges under NIETE" (I-SAPS), §5.
 *
 * I-SAPS grades a LEVEL, not a module. The three assessment streams run across
 * all 9 modules of a level and are weighted into one composite score, and the
 * teacher must clear EVERY component bar independently — a strong MCQ result
 * cannot carry a failed CRQ.
 *
 *   Formative  25%  — bar 50%   (objective items after each unit video)
 *   MCQ        50%  — bar 60%   (scenario MCQs at each module end)
 *   CRQ        25%  — bar 50%   (rubric-marked constructed responses)
 *
 * WEIGHTS — why they differ from the document. §5.1's table reads 30/50/25,
 * which totals 105%, and §7 contradicts it again with "the 40/60 weighting".
 * The three percentage bars (50/60/50), by contrast, are stated consistently in
 * §5.2 and are internally coherent. Operator decision (2026-09-17): keep the
 * bars, correct formative 30 -> 25 so the weights total 100. The §5.2 point
 * values (15/30/12.5 "weighted points") are the same broken arithmetic
 * expressed differently and are NOT the rule.
 *
 * These rules are PURE — no I/O, no supabase, no WhatsApp — so the portal and
 * the WhatsApp path can share one implementation and can never drift apart.
 * Same reasoning as capstone-pure-rules (bd-2673). The caller supplies already-
 * totalled earned/possible marks per component; where those totals come from
 * (attempt rows, answer rows) is deliberately not this module's business.
 */

/** Component weights, in percentage points. MUST total 100. */
const ISAPS_WEIGHTS = Object.freeze({ formative: 25, mcq: 50, crq: 25 });

/** Per-component pass bars, as a percentage of that component's own marks. */
const ISAPS_BARS = Object.freeze({ formative: 50, mcq: 60, crq: 50 });

/** Fixed order so `failed_components` and any UI listing stay stable. */
const COMPONENTS = Object.freeze(['formative', 'mcq', 'crq']);

/**
 * Percentage for one component, clamped to 0..100.
 *
 * A component with nothing possible scores 0 rather than NaN/Infinity. That is
 * deliberate and it means a level with no formative items yet CANNOT be passed
 * — better a visible block than a silent free pass on a component nobody has
 * authored. The import is what must be completed, not the rule relaxed.
 *
 * @param {number} earned   marks achieved
 * @param {number} possible marks available
 * @returns {number} 0..100
 */
function computeComponentPct(earned, possible) {
  const p = Number(possible);
  const e = Number(earned);
  if (!Number.isFinite(p) || p <= 0) return 0;
  if (!Number.isFinite(e) || e <= 0) return 0;
  return Math.min(100, (e / p) * 100);
}

/** Round to 1dp without float artefacts (33.33333… -> 33.3). */
function round1(n) {
  return Math.round(n * 10) / 10;
}

/**
 * Grade a whole I-SAPS level.
 *
 * @param {object} input
 * @param {{earned:number, possible:number}} [input.formative]
 * @param {{earned:number, possible:number}} [input.mcq]
 * @param {{earned:number, possible:number}} [input.crq]
 * @returns {{
 *   is_passed: boolean,
 *   composite_pct: number,
 *   failed_components: string[],
 *   components: Record<string, {pct:number, bar:number, weight:number, passed:boolean}>
 * }}
 */
function gradeIsapsLevel(input = {}) {
  const components = {};
  const failed = [];
  let composite = 0;

  for (const key of COMPONENTS) {
    const src = input[key] || {};
    const pct = computeComponentPct(src.earned, src.possible);
    const bar = ISAPS_BARS[key];
    const weight = ISAPS_WEIGHTS[key];
    const passed = pct >= bar;
    if (!passed) failed.push(key);
    composite += pct * (weight / 100);
    components[key] = { pct: round1(pct), bar, weight, passed };
  }

  return {
    is_passed: failed.length === 0,
    composite_pct: round1(composite),
    failed_components: failed,
    components,
  };
}

/**
 * Turn stored counts into the earned/possible pairs gradeIsapsLevel expects.
 *
 * Kept separate from the arithmetic so the rule stays pure while this — which
 * is entirely about how rows are counted — can be fixture-tested.
 *
 * The load-bearing decision: `possible` for formative is EVERY active item in
 * the level, not the number the teacher happened to answer. Oxbridge
 * deliberately skips unattempted modules (bd-43811, legacy imports left
 * progress rows with no attempts), but I-SAPS is the opposite case — formative
 * is 25% of the composite, so counting only answered items would let someone
 * who answered 2 of 112 items post 100% formative and certify.
 *
 * `earned` is clamped to `possible` so duplicate answer rows cannot push a
 * component over 100%.
 *
 * @param {object} counts
 * @param {number} [counts.formativeItemCount] active formative items in level
 * @param {number} [counts.formativeCorrect]   correct formative answers
 * @param {number} [counts.mcqItemCount]       active summative MCQ items
 * @param {number} [counts.mcqCorrect]         correct summative MCQ answers
 * @param {number} [counts.crqEarned]          rubric marks awarded
 * @param {number} [counts.crqPossible]        rubric marks available
 * @returns {{formative:{earned:number,possible:number},
 *            mcq:{earned:number,possible:number},
 *            crq:{earned:number,possible:number}}}
 */
function collectIsapsLevelTotals(counts = {}) {
  const n = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0);
  const pair = (earned, possible) => {
    const p = n(possible);
    return { earned: Math.min(n(earned), p), possible: p };
  };
  return {
    formative: pair(counts.formativeCorrect, counts.formativeItemCount),
    mcq: pair(counts.mcqCorrect, counts.mcqItemCount),
    crq: pair(counts.crqEarned, counts.crqPossible),
  };
}

module.exports = {
  ISAPS_WEIGHTS,
  ISAPS_BARS,
  COMPONENTS,
  computeComponentPct,
  gradeIsapsLevel,
  collectIsapsLevelTotals,
};
