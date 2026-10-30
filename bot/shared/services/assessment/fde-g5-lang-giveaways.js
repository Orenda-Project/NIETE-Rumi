'use strict';
/**
 * The v34 Grade 5 language give-away checks as one list (bd-5jmnfj.4.58.34), for fde-g5-paper-giveaways to concatenate:
 * an MCQ with two true options or a stem that does not parse (fde-mcq-truth), a key that is the only specific option
 * (fde-mcq-key-tells), a word-box, exclamatory or quoted-key hand-over between sections (fde-lang-cross-asks) and the
 * tense construct asked more than twice (fde-tense-count). Urdu and English slots only: an Urdu-medium Social Studies
 * MCQ is not a language item.
 */

const { mcqTruthFlags } = require('./fde-mcq-truth');
const { keyTellFlags } = require('./fde-mcq-key-tells');
const { crossAskFlags } = require('./fde-lang-cross-asks');
const { tenseFlags } = require('./fde-tense-count');
const { poemPaysPrinted } = require('./fde-g5-lang-checks'); // v35 G5 Urdu Q6: points that are the printed verses

const LANG = /^(?:urdu|english)\./;

const langGiveaways = (examJson) => (examJson
  ? mcqTruthFlags(examJson).concat(keyTellFlags(examJson), crossAskFlags(examJson), tenseFlags(examJson), poemPaysPrinted(examJson)).filter((f) => LANG.test(f.slot || ''))
  : []);

module.exports = { langGiveaways };
