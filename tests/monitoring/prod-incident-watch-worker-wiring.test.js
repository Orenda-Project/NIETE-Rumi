'use strict';
/**
 * The worker runs the production incident watch.
 *
 * `runProdIncidentWatch` is what the worker's boot timer and 5-minute interval call. It hands the check to
 * the watch and never throws: a monitor that can take the worker down takes down the thing it watches.
 * The boot line carries the deployment and replica ids the crash-loop rule groups by.
 */
jest.mock('express', () => {
  const app = { get: jest.fn(), listen: jest.fn(() => ({})) };
  return jest.fn(() => app);
}, { virtual: true });
jest.mock('../../bot/shared/services/whatsapp.service', () => ({ sendMessage: jest.fn(), sendDocumentByLink: jest.fn() }));
jest.mock('../../bot/shared/services/coaching-orchestrator.service', () => ({}));
jest.mock('../../bot/workers/lesson-plan-extraction.worker', () => ({}));
jest.mock('../../bot/workers/lesson-plan-generation.worker', () => ({}));
jest.mock('../../bot/workers/video-generation.worker', () => ({}));
jest.mock('../../bot/workers/exam-grading.worker', () => ({}));
jest.mock('../../bot/shared/services/soniox-cleanup.service', () => ({ runSonioxCleanup: jest.fn() }));
jest.mock('../../bot/shared/services/lesson-plan-queue.service', () => ({}));
jest.mock('../../bot/shared/services/queue', () => ({ __isQueueSingleton: true, extendJobTimeout: jest.fn(() => Promise.resolve()) }));
const mockLogToFile = jest.fn();
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: (...a) => mockLogToFile(...a) }));

const fs = require('fs');
const path = require('path');
const { runProdIncidentWatch } = require('../../bot/workers/sqs-worker');

beforeEach(() => {
  mockLogToFile.mockClear();
  delete process.env.PROD_ALERTS_ENABLED;
});

test('the check reaches the real watch, which is a no-op until armed', async () => {
  await expect(runProdIncidentWatch()).resolves.toEqual({ skipped: 'disabled' });
});

test('a watch that throws is logged at error level and never takes the worker with it', async () => {
  const watch = { run: jest.fn(async () => { throw new Error('boom'); }) };
  await expect(runProdIncidentWatch({ watch })).resolves.toBeNull();
  expect(watch.run).toHaveBeenCalledTimes(1);
  expect(mockLogToFile).toHaveBeenCalledWith(expect.stringMatching(/prod incident watch/i), { error: 'boom' }, 'error');
});

test('the boot line names the deployment and replica (Railway env), for the crash-loop rule', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '../../bot/workers/sqs-worker.js'), 'utf8');
  const boot = src.slice(src.indexOf("logToFile('🚀 Starting SQS Coaching Worker'"));
  const block = boot.slice(0, boot.indexOf('});'));
  expect(block).toMatch(/deploymentId: process\.env\.RAILWAY_DEPLOYMENT_ID/);
  expect(block).toMatch(/replicaId: process\.env\.RAILWAY_REPLICA_ID/);
});
