/**
 * bd-60113 — how many points one open-ended capstone answer is worth.
 *
 * This was a module constant in capstone-delivery.service.js (bd-2233):
 * Beacon House scores each answer 0–5. Every I-SAPS CRQ is worth 10 marks
 * against its own printed rubric, so one shared constant cannot serve both —
 * a teacher shown a 10-mark rubric must not be marked out of 5.
 *
 * Operator decision 2026-09-17: make the scale per-vendor rather than scaling
 * a 0–5 score up to 10, so the mark matches the rubric the teacher saw.
 *
 * WHY A SEPARATE MODULE. `POINTS_PER_QUESTION` is not private — it is exported
 * from capstone-delivery and imported by dashboard/routes/portal.routes.js to
 * render the capstone and compute total_score, and pinned by
 * tests/portal/portal-reaches-bot-modules.test.js. Putting the vendor lookup
 * here keeps it dependency-free (no supabase, no WhatsApp), so the portal can
 * use it without the lazy-require dance documented at capstone-delivery.js:29.
 *
 * BACKWARDS COMPATIBILITY IS THE POINT. The default stays 5, and anything that
 * is not a sane positive integer override falls back to it. A 0 or negative
 * scale would make every capstone unpassable; a non-numeric would poison
 * total_score with NaN. Beacon House and Oxbridge have no column value and are
 * therefore untouched.
 */

/** The historical default, unchanged: Beacon House scores answers 0–5. */
const POINTS_PER_QUESTION = 5;

/** Guard rail — a scale outside this range is treated as bad data. */
const MAX_POINTS_PER_QUESTION = 100;

/**
 * Points per open-ended answer for a vendor.
 *
 * @param {{key?: string, capstone_points_per_question?: number}|null} vendor
 *        a training_vendors row (or null when it could not be loaded)
 * @returns {number} a positive integer; POINTS_PER_QUESTION when unset or bad
 */
function pointsPerQuestionFor(vendor) {
  const raw = vendor && vendor.capstone_points_per_question;
  const n = Number(raw);
  if (!Number.isInteger(n)) return POINTS_PER_QUESTION;
  if (n <= 0 || n > MAX_POINTS_PER_QUESTION) return POINTS_PER_QUESTION;
  return n;
}

module.exports = {
  POINTS_PER_QUESTION,
  MAX_POINTS_PER_QUESTION,
  pointsPerQuestionFor,
};
