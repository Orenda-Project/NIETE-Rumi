'use strict';
/**
 * The three whole-paper give-away checks of v29 as one list for fde-answer-repeats (bd-5jmnfj.4.58.4): an MCQ that states a
 * Section B or C point, a science concept asked more than twice, and an MCQ that shares fractions with a compare item.
 */

const { mcqGiveaways } = require('./fde-mcq-giveaway');
const { conceptRepeats } = require('./fde-concept-count');
const { fractionGiveaways } = require('./fde-fraction-giveaway');
const { conceptCaps } = require('./fde-concept-caps');
const { mathsRepeats } = require('./fde-maths-repeats');
const { keyTermGiveaways } = require('./fde-key-term-giveaway');
const { langGiveaways } = require('./fde-g5-lang-giveaways'); // v29 G5 Urdu/English MCQ truth, key tells, cross asks
const { earlyGiveaways } = require('./fde-early-giveaways'); // v29 Grade 1-2 English (bd-5jmnfj.4.58)

const paperGiveaways = (examJson) => mcqGiveaways(examJson).concat(conceptRepeats(examJson), fractionGiveaways(examJson),
  conceptCaps(examJson), keyTermGiveaways(examJson), mathsRepeats(examJson), earlyGiveaways(examJson), langGiveaways(examJson));

module.exports = { paperGiveaways };
