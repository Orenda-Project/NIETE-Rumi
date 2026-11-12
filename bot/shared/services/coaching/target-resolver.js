/**
 * The ONE indicator a coaching report is about.
 *
 * Every surface that names a growth area — the narrative's "next horizon", the
 * commitment card, the uptake block, the coach's Support Brief and debrief
 * guide — reads this. Before it existed, three independent selectors chose the
 * area (the lowest-scoring DOMAIN, `growth_opportunities[0]`, the scorer's
 * `focus_area`) and one report could name three different things.
 *
 * Source of truth is the scorer's `focus_area` (the lowest applicable rung with
 * the most quotable evidence). It is VALIDATED, not trusted: the id must exist
 * in this analysis and the row must not be flagged not-applicable in this very
 * lesson. Returns null when nothing valid is available — callers keep their
 * previous behaviour in that case.
 *
 * Pure: no I/O, no LLM. Framework data (COUNT unit, rung descriptors) comes
 * from the FICO module so the card can name the bar the rubric itself sets.
 */

const fico = require('./frameworks/fico-framework');
// /observe2's ids, data only (fico17 requires nothing): the picks that have no indicator row.
const { PLAN_FOCUS, NOT_SCORED, FOCUS, FOCUS_DOMAIN } = require('../observe/observe2/fico17');
const v6 = require('./frameworks/fico17-v6');
const { isV6Scored } = require('./frameworks/fico17-v6/stamp');

function indicatorSpec(domainKey, id) {
  const domains = fico.getScoringConstants().domains || {};
  const spec = (domains[domainKey] && domains[domainKey].indicators) || [];
  return spec.find((d) => d.id === id) || null;
}

/**
 * @param {object} analysis - analysis_data (framework, domains, focus_area)
 * @returns {null|{indicator:string, domain:string, name:string, rung:number, rationale:string, try:string, title:string, count:string|null, levels:object|null}}
 */
/**
 * The rubric's own definition of an indicator. An /observe2 analysis carries the impact team's 17
 * indicators (analysis.observe2), whose ids are also FICO V4 ids with other meanings: no V4 count bar
 * or levels are attached to them.
 */
function specFor(analysis, domainKey, id) {
  if (analysis && analysis.observe2) return {};
  return indicatorSpec(domainKey, id) || {};
}

/**
 * /observe2's picks with no indicator row (observe2/fico17.js NOT_SCORED). "Following the plan's steps"
 * (FICO pilot sheet R14) is Section B, the plan fidelity, so its target is the section itself. The coaching
 * focus areas (R20, R21: classroom management, rules, wait time, the warm-up, the closure) are scored
 * nowhere. Either way the target is the coach's pick, named as the coach picked it, with no rung, no V4 count
 * bar and no levels: never null, which would hand the report to the weakest row instead. Only an /observe2
 * record can carry one; anywhere else these are not ids.
 */
function focusTarget(analysis, fa, id) {
  if (!analysis || !analysis.observe2 || !analysis.domains) return null;
  if (id === PLAN_FOCUS && !analysis.domains.lesson_plan_fidelity) return null;
  const f = fa && typeof fa === 'object' ? fa : {};
  const title = typeof f.title === 'string' && f.title ? f.title : FOCUS[id];
  return {
    indicator: id,
    domain: FOCUS_DOMAIN[id],
    name: title,
    rung: null,
    rationale: typeof f.rationale === 'string' ? f.rationale : '',
    try: typeof f.try_this_tomorrow === 'string' ? f.try_this_tomorrow : '',
    title,
    count: null,
    levels: null,
  };
}

// ── FICO17 v6 (bd-ra8xu.40) ──────────────────────────────────────────────────
// A v6 analysis (an /observe visit the coach reviewed, or the DC's v6 self-recording) has no focus_area: neither the
// v6 scorer nor the review writes one. Its target and its strength come from the FINAL levels on its rows (after the
// review, the coach's: observe-fico17-v6 applyReview). /observe2 is not this: it keeps the coach's "Work on first"
// (observe2-horizon.js) and its rows are V3-shaped. v6 ids overlap V3/V4 ids with other meanings (v6 C3 "Who got to
// answer" is not V3 C3), so a v6 row is named and described only by the v6 rubric: never a V3 spec, count bar or level.

/** A v6 analysis whose rows carry the final levels: the stamp, and not an /observe2 record. */
function isV6Levelled(analysis) {
  return !!analysis && typeof analysis === 'object' && !analysis.observe2 && isV6Scored(analysis);
}

/** A row's final level: 1-4, 'NA', 'IE', or null (a combined row the DC never levels). */
function v6LevelOf(row) {
  if (!row) return null;
  if (row.result !== undefined && row.result !== null) return v6.normLevel(row.result);
  return v6.normLevel(row.score);
}

/**
 * The row's evidence as the coach submitted it (applyReview writes the same text to evidence_sw, evidence_summary and
 * evidence; a combined row's is the coach's justification). On a DC self-recording, the DC's summary. Rumi's own
 * (rumi_evidence) is never read: the coach's report shows what the coach submitted.
 */
function v6EvidenceOf(row) {
  for (const k of ['evidence_sw', 'evidence_summary', 'evidence']) {
    const s = row && typeof row[k] === 'string' ? row[k].trim() : '';
    if (s) return s;
  }
  return '';
}

/** Every v6 row with a numeric final level, in rubric order (C1 … F4). */
function v6Levelled(analysis) {
  const out = [];
  v6.CODES.forEach((code, order) => {
    const domain = v6.DOMAIN_OF[code];
    const rows = ((analysis.domains || {})[domain] || {}).indicators;
    const row = (Array.isArray(rows) ? rows : []).find((r) => r && String(r.id) === code);
    const level = v6LevelOf(row);
    if (typeof level !== 'number') return;
    out.push({ code, domain, level, evidence: v6EvidenceOf(row), order });
  });
  return out;
}

/**
 * The tie-break both picks use, after the level: a row with evidence text (as the coach submitted it) first, so the
 * report and the debrief can say what was seen; then rubric order (C1 … F4). Deterministic: no two rows share an order.
 */
function byEvidenceThenRubric(a, b) {
  if (!!a.evidence !== !!b.evidence) return a.evidence ? -1 : 1;
  return a.order - b.order;
}

function v6Levels(code) {
  return Object.fromEntries(v6.indicator(code).levels.map((l) => [l.n, l.text]));
}

function v6Shape(pick, fa) {
  const name = v6.indicator(pick.code).name;
  const own = fa && typeof fa === 'object' && String(fa.indicator || '').trim() === pick.code ? fa : {};
  return {
    indicator: pick.code,
    domain: pick.domain,
    name,
    rung: pick.level,
    rationale: typeof own.rationale === 'string' && own.rationale ? own.rationale : pick.evidence,
    try: typeof own.try_this_tomorrow === 'string' ? own.try_this_tomorrow : '',
    title: typeof own.title === 'string' && own.title ? own.title : name,
    count: null,
    levels: v6Levels(pick.code),
    rubric: v6.RUBRIC_KEY,
  };
}

/**
 * A v6 analysis's target: the indicator a valid focus_area names (one the next step wrote back, focusPatch), else the
 * LOWEST numeric final level among the 17. NA, couldn't-tell and no-level rows never count (they are not low marks).
 * Ties: evidence text first, then rubric order. Null when no row has a numeric level.
 */
function v6Target(analysis) {
  const rows = v6Levelled(analysis);
  const fa = analysis.focus_area;
  const faId = fa && typeof fa === 'object' ? String(fa.indicator || '').trim() : '';
  const named = faId ? rows.find((r) => r.code === faId) : null;
  if (named) return v6Shape(named, fa);
  const lowest = rows.slice().sort((a, b) => (a.level - b.level) || byEvidenceThenRubric(a, b))[0];
  return lowest ? v6Shape(lowest, fa) : null;
}

function v6Indicator(analysis, id) {
  const pick = v6Levelled(analysis).find((r) => r.code === id);
  return pick ? v6Shape(pick, analysis.focus_area) : null;
}

/**
 * The strength of a v6 report: the HIGHEST numeric final level, level 2 or above (level 1 is "Not Observed": nothing
 * to celebrate), never the target's own row. Ties: evidence text first, then rubric order. Null for any analysis that
 * is not v6-levelled (a V3 analysis carries its own strengths[]), or when no other row reached level 2.
 *
 * @param {object} analysis
 * @param {object} [target] the report's target (default: resolveTarget(analysis)); its row is never the strength
 * @returns {null|{indicator:string, domain:string, name:string, rung:number, rationale:string, levels:object, rubric:string}}
 */
function resolveStrength(analysis, target) {
  if (!isV6Levelled(analysis)) return null;
  const t = target === undefined ? resolveTarget(analysis) : target;
  const skip = t && t.indicator ? String(t.indicator) : '';
  const best = v6Levelled(analysis)
    .filter((r) => r.level >= 2 && r.code !== skip)
    .sort((a, b) => (b.level - a.level) || byEvidenceThenRubric(a, b))[0];
  if (!best) return null;
  const { indicator, domain, name, rung, rationale, levels, rubric } = v6Shape(best, null);
  return { indicator, domain, name, rung, rationale, levels, rubric };
}

/**
 * What the next level of a v6 target asks, in the rubric's own words, or null (top level, or not a v6 target).
 * "Beyond level 3, the teacher …" loses its "Beyond level 3, ": a level number never reaches a teacher or the debrief.
 */
function v6NextLevel(target) {
  if (!target || target.rubric !== v6.RUBRIC_KEY || !target.levels) return null;
  const text = target.levels[Number(target.rung) + 1];
  if (!text) return null;
  const s = String(text).replace(/^Beyond level \d+,\s*/i, '');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function resolveTarget(analysis) {
  if (!analysis || !analysis.domains || typeof analysis.domains !== 'object') return null;
  if (isV6Levelled(analysis)) return v6Target(analysis);
  const fa = analysis.focus_area;
  const id = fa && typeof fa === 'object' ? String(fa.indicator || '').trim() : '';
  if (!id) return null;
  if (NOT_SCORED.includes(id)) return focusTarget(analysis, fa, id);

  for (const [domainKey, domain] of Object.entries(analysis.domains)) {
    for (const ind of (domain && Array.isArray(domain.indicators) ? domain.indicators : [])) {
      if (!ind || String(ind.id) !== id) continue;
      if (ind.applicable === false || ind.score === null || ind.score === undefined) return null;
      const def = specFor(analysis, domainKey, id);
      return {
        indicator: id,
        domain: domainKey,
        name: ind.name || def.name || id,
        rung: Number(ind.score),
        rationale: typeof fa.rationale === 'string' ? fa.rationale : '',
        try: typeof fa.try_this_tomorrow === 'string' ? fa.try_this_tomorrow : '',
        title: typeof fa.title === 'string' ? fa.title : '',
        count: def.count || null,
        levels: def.levels || null,
      };
    }
  }
  return null;
}

/**
 * The same shape as resolveTarget, for ANY indicator id the caller already
 * chose (the loop's sticky target). Validated the same way — null when the
 * row is absent, not applicable or unscored in this analysis. The scorer's
 * move/title/rationale ride along only when its focus_area is this very id.
 */
function resolveIndicator(analysis, indicatorId) {
  const id = String(indicatorId || '').trim();
  if (!id || !analysis || !analysis.domains || typeof analysis.domains !== 'object') return null;
  if (isV6Levelled(analysis)) return v6Indicator(analysis, id);
  const fa = analysis.focus_area && typeof analysis.focus_area === 'object' && String(analysis.focus_area.indicator || '') === id
    ? analysis.focus_area : {};
  if (NOT_SCORED.includes(id)) return focusTarget(analysis, fa, id);
  for (const [domainKey, domain] of Object.entries(analysis.domains)) {
    for (const ind of (domain && Array.isArray(domain.indicators) ? domain.indicators : [])) {
      if (!ind || String(ind.id) !== id) continue;
      if (ind.applicable === false || ind.score === null || ind.score === undefined) return null;
      const def = specFor(analysis, domainKey, id);
      return {
        indicator: id,
        domain: domainKey,
        name: ind.name || def.name || id,
        rung: Number(ind.score),
        rationale: typeof fa.rationale === 'string' ? fa.rationale : '',
        try: typeof fa.try_this_tomorrow === 'string' ? fa.try_this_tomorrow : '',
        title: typeof fa.title === 'string' ? fa.title : '',
        count: def.count || null,
        levels: def.levels || null,
      };
    }
  }
  return null;
}

module.exports = {
  resolveTarget, resolveIndicator, resolveStrength, v6NextLevel, isV6Levelled, v6LevelOf, v6EvidenceOf,
};
