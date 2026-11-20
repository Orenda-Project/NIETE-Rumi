'use strict';
/**
 * Home's "Last 30 days" block, shaped from the teacher activity store's value (docs/teacher-activity-store.md) for
 * GET /api/portal/me/home `activity`. Pure: the route reads the store (Redis only) and hands the value here.
 *
 *   { updatedAt, slot,
 *     tiles: { opened, taught, coached, quizzes, papers }   each { now, prev }: the last 30 days and the 30 before
 *     trend: [{ indicator, from, to }]                        band keys of her previous and latest report, ≤ 2 lines
 *     tip:   { sessionId, text } | null }                     the latest report's "try next class"
 *
 * null when there is no value or every number is 0 (Home's no-numbers state: no block at all). The journey stays in
 * the store for My journey; Home never carries it. Never a mark, a score or a percentage.
 */
const TILES = [['opened', 'plans_opened'], ['taught', 'taught'], ['coached', 'coached'], ['quizzes', 'quizzes'], ['papers', 'exams']];

function trendLine(t) {
  const points = Array.isArray(t && t.points) ? t.points : [];
  if (points.length < 2) return null;
  return { indicator: t.indicator_name, from: points[points.length - 2].band, to: points[points.length - 1].band };
}

function shapeActivity(value) {
  if (!value || typeof value !== 'object' || !value.tiles) return null;
  const tiles = {};
  for (const [out, key] of TILES) {
    const t = value.tiles[key] || {};
    tiles[out] = { now: Number(t.now) || 0, prev: Number(t.prev) || 0 };
  }
  if (Object.values(tiles).every((t) => t.now === 0 && t.prev === 0)) return null;
  const trend = (Array.isArray(value.trend) ? value.trend : []).map(trendLine).filter(Boolean).slice(0, 2);
  const tip = value.tip && value.tip.text ? { sessionId: value.tip.session_id, text: value.tip.text } : null;
  return { updatedAt: value.updated_at, slot: value.slot, tiles, trend, tip };
}

module.exports = { shapeActivity };
