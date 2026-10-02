'use strict';
/**
 * Meta bill cut NL3 (bd-w2daa.9), third door: the drained Gamma job.
 *
 * A teacher whose free-form Gamma job was still in the queue at the cutover is handed the catalogue
 * Flow plus the same one redirect line the typed and spoken doors send (bd-oak77.4). That line went
 * as its own billed text AFTER the Flow; it now rides as the Flow body's opening paragraph, so all
 * three topic-bearing doors stay one copy, one shape (the bd-72dth lesson), one message.
 *
 * Drives the REAL worker `process()` with the network boundary (WhatsApp) and the stores faked.
 */

const flowsSent = [];
const messagesSent = [];
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendFlow: jest.fn(async (to, opts) => { flowsSent.push({ to, ...opts }); return true; }),
  sendMessage: jest.fn(async (to, text) => { messagesSent.push({ to, text }); return true; }),
}));
const { createMemorySupabase } = require('../fixtures/memory-supabase');

const mockDb = createMemorySupabase();   // no app_settings rows → no app-redirect switch is on
jest.mock('../../bot/shared/config/supabase', () => mockDb);
jest.mock('../../bot/shared/services/content.service', () => ({}));
jest.mock('../../bot/shared/services/feature-linker.service', () => ({}));
jest.mock('../../bot/shared/services/feature-registration.service', () => ({}));
jest.mock('../../bot/shared/services/curriculum-lp-ast.service', () => ({}));
jest.mock('../../bot/shared/services/grounded-lp-render.service', () => ({ renderAndServeGrounded: jest.fn() }));
jest.mock('../../bot/shared/services/lp-feedback.service', () => ({}));
jest.mock('../../bot/shared/database/bot-helpers', () => ({ storeLessonPlan: jest.fn() }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../bot/shared/services/lesson-plan-queue.service', () => ({
  markFailed: jest.fn(async () => true),
  getRequest: jest.fn(), markProcessing: jest.fn(), markCompleted: jest.fn(),
}));

const Worker = require('../../bot/workers/lesson-plan-generation.worker');
const { resolveUx } = require('../../bot/shared/config/ux-strings');

const FLOW_ID = '1565529551677911';
const LEGACY_JOB = {
  requestId: 'req-1', userId: 'u-1', phoneNumber: '923365709413',
  topic: 'photosynthesis', contentType: 'lesson_plan', language: 'ur',
};
const ENV = ['LP_612_ENABLED', 'LP_612_ROUTE_ALL', 'PAKISTAN_LP_FLOW_ID'];

beforeEach(() => {
  jest.clearAllMocks();
  flowsSent.length = 0; messagesSent.length = 0;
  ENV.forEach((k) => delete process.env[k]);
});
afterAll(() => ENV.forEach((k) => delete process.env[k]));

test('the drained job opens ONE message — the Flow, its body led by the redirect line in the teacher\'s language', async () => {
  process.env.LP_612_ENABLED = 'true';
  process.env.LP_612_ROUTE_ALL = 'true';
  process.env.PAKISTAN_LP_FLOW_ID = FLOW_ID;

  await Worker.process(LEGACY_JOB);

  expect(messagesSent).toEqual([]);
  expect(flowsSent).toHaveLength(1);
  expect(flowsSent[0].flowId).toBe(FLOW_ID);
  expect(flowsSent[0].to).toBe('923365709413');
  expect(flowsSent[0].body).toBe(
    `${resolveUx('lp612RouteRedirect', { language: 'ur' })}\n\n${resolveUx('lpBrowseBody', { language: 'ur' })}`,
  );
});

test('without the cutover flags nothing about this door changes: the not-in-catalog apology, no Flow', async () => {
  await Worker.process(LEGACY_JOB);
  expect(flowsSent).toHaveLength(0);
  expect(messagesSent).toHaveLength(1);
  expect(messagesSent[0].text).toMatch(/menu/);
});
