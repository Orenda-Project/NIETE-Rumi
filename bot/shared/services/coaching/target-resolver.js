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

function indicatorSpec(domainKey, id) {
  const domains = fico.getScoringConstants().domains || {};
  const spec = (domains[domainKey] && domains[domainKey].indicators) || [];
  return spec.find((d) => d.id === id) || null;
}

/**
 * @param {object} analysis - analysis_data (framework, domains, focus_area)
 * @returns {null|{indicator:string, domain:string, name:string, rung:number, rationale:string, try:string, title:string, count:string|null, levels:object|null}}
 */
function resolveTarget(analysis) {
  if (!analysis || !analysis.domains || typeof analysis.domains !== 'object') return null;
  const fa = analysis.focus_area;
  const id = fa && typeof fa === 'object' ? String(fa.indicator || '').trim() : '';
  if (!id) return null;

  for (const [domainKey, domain] of Object.entries(analysis.domains)) {
    for (const ind of (domain && Array.isArray(domain.indicators) ? domain.indicators : [])) {
      if (!ind || String(ind.id) !== id) continue;
      if (ind.applicable === false || ind.score === null || ind.score === undefined) return null;
      const def = indicatorSpec(domainKey, id) || {};
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
  const fa = analysis.focus_area && typeof analysis.focus_area === 'object' && String(analysis.focus_area.indicator || '') === id
    ? analysis.focus_area : {};
  for (const [domainKey, domain] of Object.entries(analysis.domains)) {
    for (const ind of (domain && Array.isArray(domain.indicators) ? domain.indicators : [])) {
      if (!ind || String(ind.id) !== id) continue;
      if (ind.applicable === false || ind.score === null || ind.score === undefined) return null;
      const def = indicatorSpec(domainKey, id) || {};
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

module.exports = { resolveTarget, resolveIndicator };
