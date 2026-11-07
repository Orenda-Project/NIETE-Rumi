'use strict';
/**
 * bd-ewbzns.7 — the staging/main subset of sandbox's observe-coach-rubric.js: only a win's NAME.
 * The rest of the module (the coach-debrief rubric's marks, Respect line, misses and module link) arrives with the
 * 3 Nov rubric (bd-rlxkkt.3); when that is carried here, take sandbox's file whole — it holds this same winName.
 *
 * Pure: no I/O. The names are in observe-strings.js (coach_rubric_names, ur/en).
 */

/**
 * bd-ewbzns.4.3 — a win's name. The judge is asked for a behaviour in words, but it sometimes writes a rubric KEY
 * (production, 45 days to 9 Nov: 24 wins in 12 debriefs, e.g. "opened_with_specific_praise"); shown as written the
 * coach read the key. A key is named from observe-strings coach_rubric_names (in S's language); a free-text behaviour
 * is shown as written.
 * @param {string} behaviour
 * @param {object} S  observeStrings(lang)
 */
function winName(behaviour, S) {
  const names = (S && S.coach_rubric_names) || {};
  return Object.prototype.hasOwnProperty.call(names, behaviour) ? names[behaviour] : behaviour;
}

module.exports = {
  winName,
};
