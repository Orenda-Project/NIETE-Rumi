'use strict';

/**
 * The coach-journey switches (CONTRACT §19). Read straight from process.env on every call, v2 by default.
 *
 *   CHILD_TEST_BATTERY      v2 (default) | v1 | v3  story + questions + fallback; v1 adds first sounds, made-up words;
 *                           v3 = the full EGRA/EGMA battery, 18 tasks per child (CONTRACT §21, L36)
 *   CHILD_TEST_MATHS_MODE   oral (default) | strip  oral May set, one voice note; strip = the written strip + photo
 *   CHILD_TEST_CHECK_MODE   end_review (default) | per_child
 *   CHILD_TEST_STEP_NUDGE_MS  the unsent-draft nudge delay, default 240000 (4 min)
 *
 * The v2 conversation (design/COACH_JOURNEY_V2.md §3.1) runs only when BOTH the battery is v2 and maths is
 * oral: either v1 value brings back today's conversation whole (list rows, one-line prompts, the strip), so
 * no coach ever gets a half-v1 visit.
 *
 * v3 (CONTRACT §21.1) implies oral maths and the end review: the two other switches are ignored under it, so a
 * v3 visit is never half strip, half oral. v3 runs on the v2 journey (list, presence, steps, nudge, review);
 * only the unit changes, from the block to the task (machine.js units()).
 */

const val = (name, dflt) => String(process.env[name] || dflt).trim().toLowerCase();

function battery() {
  const v = val('CHILD_TEST_BATTERY', 'v2');
  return v === 'v1' || v === 'v3' ? v : 'v2';
}
const v3 = () => battery() === 'v3';
const mathsMode = () => (!v3() && val('CHILD_TEST_MATHS_MODE', 'oral') === 'strip' ? 'strip' : 'oral');
const checkMode = () => (!v3() && val('CHILD_TEST_CHECK_MODE', 'end_review') === 'per_child' ? 'per_child' : 'end_review');
const journeyV2 = () => v3() || (battery() === 'v2' && mathsMode() === 'oral');
/** The per-child check is replaced by the end-of-visit review only on the v2 journey. */
const endReview = () => journeyV2() && checkMode() === 'end_review';

const NUDGE_DEFAULT_MS = 4 * 60 * 1000;
function nudgeMs() {
  const n = Number(process.env.CHILD_TEST_STEP_NUDGE_MS);
  return Number.isFinite(n) && n > 0 ? n : NUDGE_DEFAULT_MS;
}

module.exports = { battery, v3, mathsMode, checkMode, journeyV2, endReview, nudgeMs, NUDGE_DEFAULT_MS };
