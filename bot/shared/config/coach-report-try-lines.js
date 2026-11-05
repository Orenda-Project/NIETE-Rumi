'use strict';
/**
 * The ready "Try:" line that ends the next-focus box on the coach's debrief report (coach reports in the app).
 *
 * The ICT HITL owner's review (5 Nov 2026): the "Ask yourself before next time" question is gone (a coach cannot answer
 * it on the card, and it mixed two behaviours). In its place the next-focus box ends with ONE line the coach can say in
 * her next debrief, after the focus text and before the Coach Training module. Each behaviour has its own line, keyed
 * by the judge's rubric key (observe-coach-rubric.js BEHAVIOUR_KEYS), in English and Urdu, word for word as supplied.
 *
 * null = the owner has not supplied that behaviour's line yet. The page then shows a marked placeholder and never a
 * line written here by us: these are words a coach will say to a teacher. Fill a null with the supplied line, both
 * languages at once, and nothing else changes.
 *
 * Language is data (Rule 20): this file is the one place the lines live; the portal reads them through the report.
 */

const TRY_LINES = Object.freeze({
  opened_with_specific_praise: null,
  anchored_in_real_moment: null,
  asked_and_waited: null,
  one_improvement_only: null,
  moves_not_teacher: null,
  // Supplied 5 Nov 2026, for the focus "Teacher's own next step".
  elicited_if_then: Object.freeze({
    en: '“Next time, what will you do differently? Tell me in your own words.”',
    ur: '"اگلی بار آپ کیا مختلف کریں گی؟ اپنے الفاظ میں بتائیں۔"',
  }),
  righting_reflex_held: null,
  rehearsed_the_step: null,
});

/** The ready line for a behaviour, or null when none has been supplied (or the key is not a behaviour). */
function tryLineFor(key) {
  return Object.prototype.hasOwnProperty.call(TRY_LINES, key) ? TRY_LINES[key] : null;
}

module.exports = { TRY_LINES, tryLineFor };
