'use strict';

/**
 * The coach-journey switches (CONTRACT §19). Read straight from process.env on every call, v2 by default.
 *
 *   CHILD_TEST_BATTERY      v2 (default) | v1      story + questions + fallback; v1 adds first sounds, made-up words
 *   CHILD_TEST_MATHS_MODE   oral (default) | strip  oral May set, one voice note; strip = the written strip + photo
 *   CHILD_TEST_CHECK_MODE   end_review (default) | per_child
 *   CHILD_TEST_STEP_NUDGE_MS  the unsent-draft nudge delay, default 240000 (4 min)
 *
 * The v2 conversation (design/COACH_JOURNEY_V2.md §3.1) runs only when BOTH the battery is v2 and maths is
 * oral: either v1 value brings back today's conversation whole (list rows, one-line prompts, the strip), so
 * no coach ever gets a half-v1 visit.
 */

const val = (name, dflt) => String(process.env[name] || dflt).trim().toLowerCase();

const battery = () => (val('CHILD_TEST_BATTERY', 'v2') === 'v1' ? 'v1' : 'v2');
const mathsMode = () => (val('CHILD_TEST_MATHS_MODE', 'oral') === 'strip' ? 'strip' : 'oral');
const checkMode = () => (val('CHILD_TEST_CHECK_MODE', 'end_review') === 'per_child' ? 'per_child' : 'end_review');
const journeyV2 = () => battery() === 'v2' && mathsMode() === 'oral';
/** The per-child check is replaced by the end-of-visit review only on the v2 journey. */
const endReview = () => journeyV2() && checkMode() === 'end_review';

const NUDGE_DEFAULT_MS = 4 * 60 * 1000;
function nudgeMs() {
  const n = Number(process.env.CHILD_TEST_STEP_NUDGE_MS);
  return Number.isFinite(n) && n > 0 ? n : NUDGE_DEFAULT_MS;
}

module.exports = { battery, mathsMode, checkMode, journeyV2, endReview, nudgeMs, NUDGE_DEFAULT_MS };
