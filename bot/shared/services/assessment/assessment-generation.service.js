'use strict';
/**
 * A chapter of textbook in, exam questions out.
 *
 * Almost all of the quality here lives in the prompts, not the code — thirteen
 * of them in `ict-prompts.json`, carried over unchanged from the service this
 * replaces and checked byte-identical against what it serves in production.
 * They are the part that took years of teacher feedback to get right.
 *
 * What is left for this file is assembly, and assembly is where it can quietly
 * go wrong: the right subject prompt, the right output-format prompt, in the
 * right order, with the answer-key instruction appended or not. Get any of that
 * wrong and the model still answers — just worse, in ways nobody reading one
 * paper would spot. Hence the tests on ordering rather than only on output.
 *
 * Not ported, deliberately: image generation, the bilingual translator, and the
 * AI reviewer. The caller never switched any of them on.
 */

const { answerCoverage, generateExam, normaliseAnswers } = require('./assessment-generation/answers-generate');
const { generatePatternExam, generateTopicOral } = require('./assessment-generation/entry-points');
const { buildUserPrompt, countQuestions, enforceMarksBudget, stripImageKeys, totalMarksOf, trimSeen } = require('./assessment-generation/marks-answers');
const { MODELS, buildSystemPrompt, planCounts } = require('./assessment-generation/models-prompts');
const { buildPatternUserPrompt } = require('./assessment-generation/pattern-prompt');
const { _dropProseVerses, _versesReference, patternPoemFor } = require('./assessment-generation/poem-sections');
const { _askReader, religiousFilter } = require('./assessment-generation/religious-reader');
const { sectionMaxTokens } = require('./assessment-generation/section-calls');
const { _authoredReligiousOf, _blankWordsStems, sstStemLevel } = require('./assessment-generation/section-write');

module.exports = {
  generateExam,
  generateTopicOral,
  generatePatternExam,
  sectionMaxTokens,
  buildPatternUserPrompt,
  patternPoemFor,
  _versesReference,
  _dropProseVerses,
  religiousFilter,
  _authoredReligiousOf,
  _blankWordsStems,
  _askReader,
  sstStemLevel,
  buildSystemPrompt,
  buildUserPrompt,
  planCounts,
  trimSeen,
  enforceMarksBudget,
  totalMarksOf,
  countQuestions,
  stripImageKeys,
  normaliseAnswers,
  answerCoverage,
  MODELS,
};
