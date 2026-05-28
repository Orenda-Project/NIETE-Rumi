/**
 * HOTS score adapter — area altitude (5 groups).
 *
 * `analysis.areas[areaKey]` carries `{ area_score, area_max, indicators[] }` on
 * a 1-3 scale. Display name is read from the framework module so the rubric is
 * the single source of truth.
 */

const hotsFramework = require('../../frameworks/hots-framework');

const SCALE_MAX = 3;

function buildHotsGroups(a) {
  const AREAS = hotsFramework.getScoringConstants().areas;
  const container = (a && a.areas) || {};
  return Object.entries(AREAS).map(([areaKey, def], i) => {
    const ar = container[areaKey] || {};
    const score = ar.area_score ?? 0;
    const max = ar.area_max ?? def.indicatorCount * SCALE_MAX;
    return {
      key: `A${i + 1}`,
      name: def.displayName,
      score,
      max,
      pct: max > 0 ? Math.round((score / max) * 100) : 0,
    };
  });
}

module.exports = { buildHotsGroups };
