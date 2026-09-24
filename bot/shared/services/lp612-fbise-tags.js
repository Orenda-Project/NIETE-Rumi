/**
 * lp612-fbise-tags — the FBISE status of each SLO a Grade 9-12 lesson teaches (bd-f01ob).
 *
 * Attached at RENDER time, not author time, so every stored lesson picks the tags up on its next
 * render and nothing in R2 is rewritten. The map is built from PROD's segment catalogue (bd-izuws
 * v4: a Sonnet worker proposed each link, an Opus manager kept only the clear ones) by
 * `08_Grades 6-12 LP Build/_izuws_fbise_lesson_labels_2026-09-24/workbench/build_render_map.py`.
 * Statuses are Summative, Formative or null (unresolved — the page shows the code alone).
 */

const MAP = require('../data/lp612-fbise-slo-tags.json');

/** A copy of `lpDoc` carrying `fbise_slos` for its segment, or none when the segment has no link. */
function attachFbiseSlos(lpDoc, segmentId, map = MAP) {
  const { fbise_slos: _stale, ...doc } = lpDoc;
  const grade = Number(doc.provenance && doc.provenance.grade);
  const tags = grade >= 9 && segmentId ? map[segmentId] : null;
  return tags && tags.length ? { ...doc, fbise_slos: tags } : doc;
}

module.exports = { attachFbiseSlos };
