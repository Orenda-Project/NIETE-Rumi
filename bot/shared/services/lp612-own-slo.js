/**
 * bd-snkn32.13 — "Make my own": a Grade 9–12 segment's FBISE SLOs, and whether they are MIXED.
 *
 * The map is lp612-fbise-slo-tags.json (lp612-fbise-tags.js's map): segment → [{ code, status }], status Summative
 * (assessed in the board exam), Formative (assessed in class) or null (unresolved). A segment is mixed when it has at
 * least one of each; only then does the teacher choose which comes first. Pure: the map is read once at require.
 */

const MAP = require('../data/lp612-fbise-slo-tags.json');

const tagsOf = (segmentId, map) => (segmentId && Array.isArray(map[segmentId]) ? map[segmentId] : []);

/** { summative: [codes], formative: [codes] } when the segment has both, else null. */
function sloMix(segmentId, map = MAP) {
  const tags = tagsOf(segmentId, map);
  const summative = tags.filter((t) => t.status === 'Summative').map((t) => t.code);
  const formative = tags.filter((t) => t.status === 'Formative').map((t) => t.code);
  return summative.length && formative.length ? { summative, formative } : null;
}

/** Every SLO code of the segment, in the map's order ([] when it has none). */
function sloCodes(segmentId, map = MAP) {
  return tagsOf(segmentId, map).map((t) => t.code);
}

module.exports = { sloMix, sloCodes };
