'use strict';
/**
 * One entry for the G5 Urdu round 6 mends (bd-5jmnfj.4.58.9), so the generation service needs one call:
 *   mendG5Urdu       antonym key alternatives, Q10 form lines, a poem-title give-away point, a box key missing from its box;
 *   g5UrduShortfall  a «سب سے پہلے» stem keyed with two actions (reason 'first', a re-ask);
 *   g5UrduNote       the re-ask note for that flag.
 * Pure: {examJson, notes}.
 */

const { mendAntonymParts } = require('./fde-urdu-antonyms');
const { mendUrduForm } = require('./fde-urdu-form-lines');
const { dropTitleGiveaway } = require('./fde-poem-title-giveaway');
const { boxKeyFix } = require('./fde-early-urdu-boxkeys');
const { firstActionShortfall, firstActionNote } = require('./fde-urdu-first-action');

function mendG5Urdu(examJson) {
  const steps = [mendAntonymParts, mendUrduForm, dropTitleGiveaway, boxKeyFix];
  return steps.reduce((acc, step) => {
    const r = step(acc.examJson);
    return { examJson: r.examJson, notes: acc.notes.concat(r.notes) };
  }, { examJson, notes: [] });
}

const g5UrduShortfall = (examJson) => firstActionShortfall(examJson);
const g5UrduNote = (shortfall) => firstActionNote(shortfall);

module.exports = { mendG5Urdu, g5UrduShortfall, g5UrduNote };
