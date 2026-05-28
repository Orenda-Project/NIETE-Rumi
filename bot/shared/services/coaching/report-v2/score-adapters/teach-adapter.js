/**
 * TEACH score adapter — 3 areas + Time on Task = 4 groups total.
 *
 * Element scoring is holistic 1-5 (not mathematical). Each area's max =
 * elementCount × 5. Time on Task is a SEPARATE single score on a 1-5 scale,
 * surfaced as a 4th group at position T1 (matches the existing PDFKit-side
 * transformer's group order during the rollout).
 */

const teachFramework = require('../../frameworks/teach-framework');

const ELEMENT_MAX = 5;

function buildTeachGroups(a) {
  const AREAS = teachFramework.getScoringConstants().areas;
  const container = (a && a.areas) || {};

  // Time on Task is group 1 (matches the legacy transformer for visual
  // continuity during rollout). Then the 3 areas T2..T4.
  const tot = (a && a.time_on_task) || {};
  const totScore = Number(tot.score) || 0;
  const groups = [
    { key: 'T1', name: 'Time on Task', score: totScore, max: ELEMENT_MAX, pct: Math.round((totScore / ELEMENT_MAX) * 100) },
  ];

  Object.entries(AREAS).forEach(([areaKey, def], i) => {
    const ar = container[areaKey] || {};
    const score = ar.area_score ?? 0;
    const max = ar.area_max ?? def.elementCount * ELEMENT_MAX;
    groups.push({
      key: `T${i + 2}`,
      name: def.displayName,
      score,
      max,
      pct: max > 0 ? Math.round((score / max) * 100) : 0,
    });
  });

  return groups;
}

module.exports = { buildTeachGroups };
