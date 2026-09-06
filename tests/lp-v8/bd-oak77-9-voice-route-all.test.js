/**
 * THE CUTOVER, VOICE DOOR.
 *
 * `handleLessonPlanRequest` is the typed door and its gate is proved in
 * bd-oak77-9-route-all.test.js. `handleVoiceLessonPlanRequest` is its twin: a teacher who
 * SPEAKS "make me a lesson plan on photosynthesis" reaches a different function that queues
 * the same Gamma job. Gating one and not the other leaves two doors giving two different
 * answers — precisely the drift lp-browse-entry.service.js exists to prevent — and it would
 * be invisible, because every typed test would stay green.
 *
 * Presentations are deliberately NOT gated on this branch (operator, 2026-09-06: the
 * instruction names lesson plans). handleVoicePresentationRequest still runs Gamma; the
 * third test below pins that so the omission is a recorded decision, not an oversight.
 *
 * This drives the REAL function with only the network boundary mocked.
 */

const flowsSent = [];
const messagesSent = [];
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendFlow: jest.fn(async (to, opts) => { flowsSent.push({ to, ...opts }); return true; }),
  sendMessage: jest.fn(async (to, text) => { messagesSent.push({ to, text }); return true; }),
  sendAudio: jest.fn(), sendDocumentByLink: jest.fn(), sendInteractiveButtons: jest.fn(),
}));
jest.mock('../../bot/shared/services/openai.service', () => ({ extractTopic: jest.fn(async () => 'photosynthesis') }));
jest.mock('../../bot/shared/services/lesson-plan-queue.service', () => ({ createAndQueue: jest.fn(async () => 'req-1') }));
jest.mock('../../bot/shared/services/lp-context.service', () => ({ injectLpContext: jest.fn() }));
jest.mock('../../bot/shared/services/audio.service', () => ({}));
jest.mock('../../bot/shared/services/content.service', () => ({}));
jest.mock('../../bot/shared/services/feature-registration.service', () => ({}));
jest.mock('../../bot/shared/services/coaching-orchestrator.service', () => ({}));
jest.mock('../../bot/shared/services/conversation-state.service', () => ({}));
jest.mock('../../bot/shared/services/menu.service', () => ({}));
jest.mock('../../bot/shared/services/video/video-orchestrator.service', () => ({}));
jest.mock('../../bot/shared/services/coaching/coaching-inflight-guard', () => ({ shouldDeferNewClassroomAudio: jest.fn() }));
jest.mock('../../bot/shared/storage/r2', () => ({ uploadAudio: jest.fn() }));
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../bot/shared/utils/constants', () => ({ TEMP_DIR: '/tmp', LOADING_STICKER_PATH: '', LOADING_STICKER_MEDIA_ID: '' }));
jest.mock('../../bot/shared/utils/language-cache', () => ({ getUserLanguage: jest.fn(async () => 'en'), setUserLanguage: jest.fn() }));
jest.mock('../../bot/shared/database/bot-helpers', () => ({
  getOrCreateUser: jest.fn(), getOrCreateSession: jest.fn(), updateSessionType: jest.fn(),
  storeConversation: jest.fn(), storeLessonPlan: jest.fn(),
}));

const LessonPlanQueueService = require('../../bot/shared/services/lesson-plan-queue.service');
const { handleVoiceLessonPlanRequest } = require('../../bot/shared/handlers/voice-message.handler');
const { resolveUx } = require('../../bot/shared/config/ux-strings');

const FLOW_ID = '1565529551677911';
const user = { id: 'u-1', first_name: 'Haroon', grade: '9' };
const ROUTE_ENV = ['LP_612_ENABLED', 'LP_612_ROUTE_ALL'];

beforeEach(() => {
  flowsSent.length = 0; messagesSent.length = 0;
  jest.clearAllMocks();
  process.env.PAKISTAN_LP_FLOW_ID = FLOW_ID;
  ROUTE_ENV.forEach((k) => delete process.env[k]);
});
afterAll(() => { delete process.env.PAKISTAN_LP_FLOW_ID; ROUTE_ENV.forEach((k) => delete process.env[k]); });

describe('the voice lesson-plan door follows the same cutover as the typed one', () => {
  test('BOTH flags on: the redirect line, then the menu — and NO Gamma job', async () => {
    process.env.LP_612_ENABLED = 'true';
    process.env.LP_612_ROUTE_ALL = 'true';

    await handleVoiceLessonPlanRequest('923365709413', 'make me a lesson plan on photosynthesis', user, null, 'ur');

    expect(messagesSent).toHaveLength(1);
    expect(messagesSent[0].text).toBe(resolveUx('lp612RouteRedirect', { language: 'ur' }));
    expect(flowsSent).toHaveLength(1);
    expect(flowsSent[0].flowId).toBe(FLOW_ID);
    expect(LessonPlanQueueService.createAndQueue).not.toHaveBeenCalled();
  });

  // Re-pointed by the back-merge: on `main` this asserted the rollback to the Gamma
  // generation body. That body is not on this branch, so what the flags-off case
  // actually does here is skip the redirect line and open the catalogue Flow anyway.
  test('BOTH flags off: no redirect line, the catalogue Flow still opens, nothing is queued', async () => {
    await handleVoiceLessonPlanRequest('923365709413', 'make me a lesson plan on photosynthesis', user, null, 'en');

    expect(messagesSent).toHaveLength(0);
    expect(flowsSent).toHaveLength(1);
    expect(flowsSent[0].flowId).toBe(FLOW_ID);
    expect(LessonPlanQueueService.createAndQueue).not.toHaveBeenCalled();
  });

  test('a spoken request with no user account is unaffected by the gate', async () => {
    process.env.LP_612_ENABLED = 'true';
    process.env.LP_612_ROUTE_ALL = 'true';

    await handleVoiceLessonPlanRequest('923365709413', 'make me a lesson plan', null, null, 'en');

    expect(flowsSent).toHaveLength(0);
    expect(LessonPlanQueueService.createAndQueue).not.toHaveBeenCalled();
  });
});
