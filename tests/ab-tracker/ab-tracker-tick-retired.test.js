'use strict';
/**
 * The A/B tracker's rollup runs only from its own Railway cron (bot/scripts/ab-tracker-cron.js, project
 * Impact - A/B Tracker). The bot worker's hourly tick is retired (bd-3kshar.6.5.1): the cron uses its project's own
 * Redis, so the worker and the cron no longer share a slot marker and would both run each slot.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');

test('the worker no longer schedules the A/B tracker rollup', () => {
  const src = fs.readFileSync(path.join(root, 'bot/workers/sqs-worker.js'), 'utf8');
  expect(src).not.toMatch(/ab-tracker-schedule/);
  expect(src).not.toMatch(/scheduleAbTracker/);
});

test('the worker tick module is gone', () => {
  expect(fs.existsSync(path.join(root, 'bot/workers/ab-tracker-schedule.js'))).toBe(false);
});

test('the cron entry point is still there', () => {
  expect(fs.existsSync(path.join(root, 'bot/scripts/ab-tracker-cron.js'))).toBe(true);
});
