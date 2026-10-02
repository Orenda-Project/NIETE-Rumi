'use strict';
/**
 * Child test (bd-s1oo0.5) — which model each scoring job runs, from the model
 * registry (shared/config/model-registry.js, jobs `childTest.*`). Defaults are
 * the May 2026 study stack (PLAN §6); each job keeps its own env var.
 */
const { resolveModelForJob } = require('../../../config/model-registry');

const JOB = {
  counts: 'childTest.counts',
  labeller: 'childTest.labeller',
  comprehension: 'childTest.comprehension',
  phonics: 'childTest.phonics',
  word_problem: 'childTest.wordProblem',
  vision: 'childTest.vision',
};

function modelFor(key) {
  return resolveModelForJob(JOB[key]).model;
}

module.exports = { modelFor, JOB };
