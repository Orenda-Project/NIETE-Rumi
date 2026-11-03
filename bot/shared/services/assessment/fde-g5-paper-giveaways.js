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
const { mathsSkillTwice } = require('./fde-maths-skill-twice'); // v37 a maths skill asked twice (bd-5jmnfj.4.58)
const { crossItemAnswers } = require('./fde-cross-item-answers'); // v37r2 another item's non-integer answer in a stem
const { scienceRepeats } = require('./fde-science-repeats'); // v37 biodegradable cap, MCQ key = accept example
const { mathsNameGiveaways } = require('./fde-maths-name-giveaway'); // v37r4 a keyed name printed in another maths item
const { earlyGiveaways } = require('./fde-early-giveaways'); // v29 Grade 1-2 English (bd-5jmnfj.4.58)

const paperGiveaways = (examJson) => mcqGiveaways(examJson).concat(conceptRepeats(examJson), fractionGiveaways(examJson),
  conceptCaps(examJson), keyTermGiveaways(examJson), mathsRepeats(examJson), earlyGiveaways(examJson), langGiveaways(examJson),
  mathsSkillTwice(examJson), crossItemAnswers(examJson), scienceRepeats(examJson), mathsNameGiveaways(examJson));

module.exports = { paperGiveaways };
