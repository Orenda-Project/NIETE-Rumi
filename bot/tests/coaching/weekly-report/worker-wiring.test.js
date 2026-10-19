'use strict';
/**
 * bd-v0toag.32 — Class Q: the sweeper only claims kinds registered in its own process, so the weekly report
 * module must be loaded by workers/sqs-worker.js inside the gated teacher-nudge block, next to the other kinds.
 */
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '../../../workers/sqs-worker.js'), 'utf8');

test('the worker loads the weekly report job inside the TEACHER_NUDGES-gated, main-queue block', () => {
  const gate = src.indexOf("if (teacherNudges.isEnabled() && nudgeQueues.has('main'))");
  const quiz = src.indexOf("require('../shared/services/nudges/lp-quiz-offer.service')", gate);
  const report = src.indexOf("require('../shared/services/coaching/weekly-report/job')", gate);
  const interval = src.indexOf('TEACHER_NUDGES_SWEEP_MS', gate);
  expect(gate).toBeGreaterThan(-1);
  expect(report).toBeGreaterThan(quiz);
  expect(report).toBeLessThan(interval);
});
