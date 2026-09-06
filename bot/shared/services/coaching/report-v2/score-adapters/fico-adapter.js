/**
 * FICO score adapter — 4 sections (B, C, D, F) per the ICT canonical rubric.
 *
 * `analysis.domains[sectionKey]` carries `{ domain_score, domain_max, indicators[] }`
 * on a 1-4 scale. Falls back to `area_score`/`area_max` if a session was scored
 * with the legacy area shape.
 */

const ficoFramework = require('../../frameworks/fico-framework');

// The framework owns the scale; a local copy here silently mis-sizes every section max
// the moment the rubric changes.
const { scaleMax: SCALE_MAX } = ficoFramework.getScoringConstants();

function buildFicoGroups(a, language) {
  const DOMAINS = ficoFramework.getScoringConstants().domains;
  const container = (a && (a.domains || a.areas)) || {};
  return Object.entries(DOMAINS).map(([sectionKey, def]) => {
    const d = container[sectionKey] || {};
    const score = d.domain_score ?? d.area_score ?? 0;
    const max = d.domain_max ?? d.area_max ?? def.indicatorCount * SCALE_MAX;
    return {
      // Use the sheet's section letter (B/C/D/F) as the group key — trainers
      // and printed rubric readers instantly cross-reference.
      key: def.key,
      // bd-1t1wz — canonical domain key, for narrative.domain_whys lookups.
      domainKey: sectionKey,
      // bd-1t1wz — the ur variant carries the bilingual bracketed label
      // (framework data, ports the main bot's bd-43483 displayName_ur pattern).
      name: language === 'ur' ? (def.displayName_ur || def.displayName) : def.displayName,
      score,
      max,
      pct: max > 0 ? Math.round((score / max) * 100) : 0,
    };
  });
}

module.exports = { buildFicoGroups };
