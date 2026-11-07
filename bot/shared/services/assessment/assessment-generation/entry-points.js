'use strict';
// Part of assessment-generation.service.js (see its header); split for the 300-line limit, bd-5jmnfj.37.
const Patterns = require('../patterns');
const { checkBlueprint, missesSplit, levelDistance, levelNote } = require('../blueprint-check');
const { logToFile } = require('../../../utils/logger');
const { TopicOral } = require('./answers-generate');
const { _earlyDeps } = require('./paper-phases');
const { _writePatternPaper } = require('./write-pattern-paper');

async function generatePatternExam({ splitRetry = false, ...args }) {
  const first = await _writePatternPaper(args);
  const bp = first.examJson._layout.blueprint;
  if (!splitRetry || !missesSplit(bp)) return first;
  // Grades 1-2: the level note steers Grade 5's prompts only, so an early paper is written once.
  if ((Patterns.get(args.pattern) || {}).profile === 'early') return first;
  const { pattern, subject, requestId = null } = args;
  logToFile('[assessment] paper re-asked for its level split', { requestId, pattern, subject: Patterns.normalise(subject), levels: bp.levels });
  let second;
  try {
    second = await _writePatternPaper({ ...args, levelNote: levelNote(bp) });
  } catch (err) {
    logToFile('[assessment] level split re-ask failed', { requestId, pattern, code: err.code || null, error: err.message });
    return first;
  }
  const better = levelDistance(second.examJson._layout.blueprint) < levelDistance(bp);
  // The better paper is kept and carries what it still misses by (bd-5jmnfj.27): a split the re-ask did not close is reported, not hidden.
  const miss = { first: levelDistance(bp), second: levelDistance(second.examJson._layout.blueprint) };
  const chosen = better ? second : first;
  const residual = better ? miss.second : miss.first;
  logToFile('[assessment] level split re-ask kept', { requestId, pattern, kept: better ? 'second' : 'first', ...miss, residual });
  chosen.examJson._layout.split_retry = { ...miss, kept: better ? 'second' : 'first', residual };
  const t = (k) => (first.tokenData[k] || 0) + (second.tokenData[k] || 0);
  return {
    ...chosen,
    tokenData: { inputTokens: t('inputTokens'), outputTokens: t('outputTokens'), totalTokens: t('totalTokens'), cost: t('cost'), model: first.tokenData.model },
    elapsedMs: first.elapsedMs + second.elapsedMs,
  };
}

/** bd-6clakk.11: the FDE oral part of an English or Urdu topic paper, or null. */
function generateTopicOral(args) {
  return TopicOral().writeTopicOral(args, _earlyDeps(args.subject));
}

module.exports = {
  generatePatternExam, generateTopicOral,
};
