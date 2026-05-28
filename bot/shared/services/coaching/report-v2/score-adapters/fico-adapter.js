/**
 * FICO score adapter — 5 domains.
 *
 * Structurally similar to MEWAKA — `analysis.domains[domainKey]` carries
 * `{ domain_score, domain_max, indicators[] }` on a 1-4 scale. Falls back to
 * `area_score`/`area_max` if a session was scored with the legacy area shape.
 */

const ficoFramework = require('../../frameworks/fico-framework');

const SCALE_MAX = 4;

function buildFicoGroups(a) {
  const DOMAINS = ficoFramework.getScoringConstants().domains;
  const container = (a && (a.domains || a.areas)) || {};
  return Object.entries(DOMAINS).map(([domainKey, def], i) => {
    const d = container[domainKey] || {};
    const score = d.domain_score ?? d.area_score ?? 0;
    const max = d.domain_max ?? d.area_max ?? def.indicatorCount * SCALE_MAX;
    return {
      key: `D${i + 1}`,
      name: def.displayName,
      score,
      max,
      pct: max > 0 ? Math.round((score / max) * 100) : 0,
    };
  });
}

module.exports = { buildFicoGroups };
