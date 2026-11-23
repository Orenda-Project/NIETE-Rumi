'use strict';
/**
 * bd-ptl6x9.7 — Class Q: the sweeper only claims kinds registered in its own process, so the weak-skill Jugnu job
 * must be loaded by workers/sqs-worker.js inside the gated teacher-nudge block, next to the other kinds.
 */
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '../../../workers/sqs-worker.js'), 'utf8').replace(/^\s*\/\/.*$/gm, '');

test('the worker loads the weak-skill Jugnu job inside the TEACHER_NUDGES-gated, main-queue block', () => {
  const gate = src.indexOf("if (teacherNudges.isEnabled() && nudgeQueues.has('main'))");
  const job = src.indexOf("require('../shared/services/nudges/weak-skill-jugnu/job')", gate);
  const interval = src.indexOf('TEACHER_NUDGES_SWEEP_MS', gate);
  expect(gate).toBeGreaterThan(-1);
  expect(job).toBeGreaterThan(gate);
  expect(job).toBeLessThan(interval);
});
