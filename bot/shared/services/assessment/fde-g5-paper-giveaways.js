'use strict';
/**
 * The three whole-paper give-away checks of v29 as one list for fde-answer-repeats (bd-5jmnfj.4.58.4): an MCQ that states a
 * Section B or C point, a science concept asked more than twice, and an MCQ that shares fractions with a compare item.
 */

const { mcqGiveaways } = require('./fde-mcq-giveaway');
const { conceptRepeats } = require('./fde-concept-count');
const { fractionGiveaways } = require('./fde-fraction-giveaway');

const paperGiveaways = (examJson) => mcqGiveaways(examJson).concat(conceptRepeats(examJson), fractionGiveaways(examJson));

module.exports = { paperGiveaways };
