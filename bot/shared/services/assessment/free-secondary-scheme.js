'use strict';
/**
 * bd-5jmnfj.38.31 — the marking scheme a written item of a G6-12 free paper carries beyond its points
 * (A7c: the a4 G8 Urdu key had points only on 10 of 10 written items). Each written item worth two
 * marks or more has a holistic band of 2-3 levels (full / partial / none, with their marks), an
 * "accept" line and a "reject" (do-not-accept) line. Pure, no I/O.
 */

const MIN_BANDS = 2;
const MAX_BANDS = 3;

const filled = (v) => typeof v === 'string' && v.trim().length > 0;

/** What a written item's scheme lacks, as one line, or null. `e` is an entry of checks.items(). */
function schemeIssue(e) {
  if (!e || e.isMcq || (Number(e.item.marks) || 0) < 2) return null;
  const q = e.item;
  const missing = [];
  const bands = Array.isArray(q.mark_bands) ? q.mark_bands : [];
  const bandsOk = bands.length >= MIN_BANDS && bands.length <= MAX_BANDS
    && bands.every((b) => b && filled(b.descriptor) && b.marks != null && String(b.marks).trim());
  if (!bandsOk) missing.push(`a holistic band of ${MIN_BANDS}-${MAX_BANDS} levels (full / partial / none, each with its marks)`);
  if (!filled(q.accept)) missing.push('an accept line');
  if (!filled(q.reject)) missing.push('a do-not-accept line');
  return missing.length ? `the marking scheme lacks ${missing.join(', ')}` : null;
}

module.exports = { schemeIssue, MIN_BANDS, MAX_BANDS };
