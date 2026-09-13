/**
 * bd-oak77.4 — THE CUTOVER MOMENT, for the teacher who is already waiting.
 *
 * `lp_feedback.lp_variant='gamma_freeform'` is being written on PROD today — the Gamma free-flow
 * path is live with real teachers, not dormant. So at the moment `develop` reaches `main`, some
 * number of teachers have a Gamma lesson IN FLIGHT: the row is in `lesson_plan_requests`, the
 * message is in SQS, and the code that would have finished it no longer exists.
 *
 * develop already drains those messages rather than retrying them for ever (bd-2540) — that part
 * is right and this file pins it. What it did was send her a dead end: "Send 'menu' to see what's
 * available", which asks a teacher who already asked for a lesson plan to ask again, in a specific
 * word, having waited for nothing. Under LP_612_ROUTE_ALL the menu IS the answer, so she gets the
 * menu — opened for her, with the same one line every other redirected door sends.
 *
 * This is the cutover's blast radius reduced to its smallest form: nobody is stranded, and the
 * person mid-wait lands on the thing that will actually serve her.
 */

const flowsSent = [];
const messagesSent = [];
jest.mock('../../shared/services/whatsapp.service', () => ({
  sendFlow: jest.fn(async (to, opts) => { flowsSent.push({ to, ...opts }); return true; }),
  sendMessage: jest.fn(async (to, text) => { messagesSent.push({ to, text }); return true; }),
}));
jest.mock('../../shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../shared/services/content.service', () => ({}));
jest.mock('../../shared/services/feature-linker.service', () => ({}));
jest.mock('../../shared/services/feature-registration.service', () => ({}));
jest.mock('../../shared/services/curriculum-lp-ast.service', () => ({}));
jest.mock('../../shared/services/grounded-lp-render.service', () => ({ renderAndServeGrounded: jest.fn() }));
jest.mock('../../shared/services/lp-feedback.service', () => ({}));
jest.mock('../../shared/database/bot-helpers', () => ({ storeLessonPlan: jest.fn() }));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));

jest.mock('../../shared/services/lesson-plan-queue.service', () => ({
  markFailed: jest.fn(async () => true),
  getRequest: jest.fn(), markProcessing: jest.fn(), markCompleted: jest.fn(),
}));
const { markFailed, getRequest } = require('../../shared/services/lesson-plan-queue.service');

const Worker = require('../../workers/lesson-plan-generation.worker');
const { resolveUx } = require('../../shared/config/ux-strings');

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

describe('a Gamma job still in SQS when the cutover lands', () => {
  test('is DRAINED, never retried for ever — the row is failed and the message consumed', async () => {
    await Worker.process(LEGACY_JOB);
    expect(markFailed).toHaveBeenCalledTimes(1);
    expect(markFailed.mock.calls[0][0]).toBe('req-1');
    expect(markFailed.mock.calls[0][1]).toMatch(/retired/i);
  });

  test('WITH the cutover flags she is handed the MENU, not an instruction to type "menu"', async () => {
    process.env.LP_612_ENABLED = 'true';
    process.env.LP_612_ROUTE_ALL = 'true';
    process.env.PAKISTAN_LP_FLOW_ID = FLOW_ID;
    await Worker.process(LEGACY_JOB);
    expect(flowsSent).toHaveLength(1);
    expect(flowsSent[0].flowId).toBe(FLOW_ID);
    expect(flowsSent[0].to).toBe('923365709413');
    // her language, from the job payload frozen at enqueue time
    expect(messagesSent.map((m) => m.text)).toContain(resolveUx('lp612RouteRedirect', { language: 'ur' }));
    expect(messagesSent.some((m) => /Send "menu"/.test(m.text))).toBe(false);
  });

  test('the flow token leads with her user id, so the endpoint resolves her', async () => {
    process.env.LP_612_ENABLED = 'true';
    process.env.LP_612_ROUTE_ALL = 'true';
    process.env.PAKISTAN_LP_FLOW_ID = FLOW_ID;
    await Worker.process(LEGACY_JOB);
    expect(flowsSent[0].flowToken.startsWith('u-1:pakistan-lp:')).toBe(true);
  });

  test('WITHOUT the flags the existing not-in-catalog apology is unchanged', async () => {
    await Worker.process(LEGACY_JOB);
    expect(flowsSent).toHaveLength(0);
    expect(messagesSent).toHaveLength(1);
    expect(messagesSent[0].text).toMatch(/Send "menu"/);
  });

  test('a grounded job is untouched by any of this', async () => {
    process.env.LP_612_ROUTE_ALL = 'true';
    process.env.PAKISTAN_LP_FLOW_ID = FLOW_ID;
    getRequest.mockResolvedValue({ status: 'completed' });
    await Worker.process({ ...LEGACY_JOB, sourceLpUuid: 'ast-1' });
    expect(markFailed).not.toHaveBeenCalled();
    expect(flowsSent).toHaveLength(0);
  });
});
