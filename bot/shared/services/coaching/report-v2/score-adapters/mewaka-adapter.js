/**
 * MEWAKA score adapter — 6 domains at domain altitude.
 *
 * The hero report's 6-row grid is a natural fit for MEWAKA's 6 domains
 * (vs 25 indicators which would be too dense). Reads
 * `analysis.domains[domainKey].{domain_score, domain_max}` and falls back
 * to `area_score`/`area_max` for sessions persisted with the legacy shape.
 *
 * Display names come from the framework module — `displayName_sw` when
 * the report language is Swahili, `displayName` (English) otherwise — so
 * the rubric is the single source of truth.
 */

const mewakaFramework = require('../../frameworks/mewaka-framework');

const SCALE_MAX = 3; // MEWAKA indicators are 0-3

function buildMewakaGroups(a, language) {
  const DOMAINS = mewakaFramework.getScoringConstants().domains;
  const container = (a && (a.domains || a.areas)) || {};
  return Object.entries(DOMAINS).map(([domainKey, def]) => {
    const dom = container[domainKey] || {};
    const score = dom.domain_score ?? dom.area_score ?? 0;
    const max = dom.domain_max ?? dom.area_max ?? def.indicatorCount * SCALE_MAX;
    return {
      key: def.key, // A..F
      name: language === 'sw' ? def.displayName_sw : def.displayName,
      score,
      max,
      pct: max > 0 ? Math.round((score / max) * 100) : 0,
    };
  });
}

module.exports = { buildMewakaGroups };
