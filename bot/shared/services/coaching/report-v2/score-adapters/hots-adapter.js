/**
 * HOTS score adapter — area altitude (5 groups).
 *
 * `analysis.areas[areaKey]` carries `{ area_score, area_max, indicators[] }` on
 * a 1-3 scale. Display name is read from the framework module so the rubric is
 * the single source of truth.
 */

const hotsFramework = require('../../frameworks/hots-framework');

const SCALE_MAX = 3;

/**
 * bd-yy4l2: gather every indicator {id → score} from wherever the analysis
 * stored it — the clean `a.areas[*].indicators`, OR the scrambled OECD-shaped
 * `goalN_*` buckets a drifted analysis emits (session 4060e32e: framework=hots
 * but the indicators lived in goal1_formative_assessment…goal5_*, each still
 * carrying its TRUE HOTS indicator id). Keyed by id, so bucket scrambling is
 * irrelevant — we re-group by the framework's canonical id→area mapping below.
 */
function collectIndicatorScores(a) {
  const map = {};
  const buckets = [];
  if (a && a.areas && typeof a.areas === 'object') buckets.push(...Object.values(a.areas));
  for (const k of Object.keys(a || {})) {
    if (/^goal\d/.test(k) && a[k] && Array.isArray(a[k].indicators)) buckets.push(a[k]);
  }
  for (const b of buckets) {
    for (const ind of (b && b.indicators) || []) {
      if (ind && ind.id != null && typeof ind.score === 'number') map[ind.id] = ind.score;
    }
  }
  return map;
}

function buildHotsGroups(a) {
  const AREAS = hotsFramework.getScoringConstants().areas;
  const container = (a && a.areas) || {};
  const idScores = collectIndicatorScores(a);
  return Object.entries(AREAS).map(([areaKey, def], i) => {
    const ar = container[areaKey] || {};
    const max = ar.area_max ?? def.indicatorCount * SCALE_MAX;
    let score = ar.area_score;
    // Re-derive from indicator ids when the clean area_score is missing or 0 —
    // this recovers the real score for the scrambled goalN_* shape.
    if (score == null || score === 0) {
      const ids = (def.indicators || []).map((x) => x.id);
      const haveAny = ids.some((id) => idScores[id] != null);
      if (haveAny) score = ids.reduce((s, id) => s + (idScores[id] != null ? idScores[id] : 0), 0);
    }
    score = score ?? 0;
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
