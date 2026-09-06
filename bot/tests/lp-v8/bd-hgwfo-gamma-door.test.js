/**
 * bd-hgwfo / bd-jnfbd — "make me a lesson plan" opens the Flow.
 *
 * Production (main) runs ~200 Gamma generations a day (2,793 in 14 days, 1,038
 * teachers). bd-2540 retired that on develop and replaced it with a
 * not-in-catalog reply — which would land on those teachers the day develop
 * reaches main. Once generation is gone, the catalogue IS the answer to
 * "make me a lesson plan": every door that used to reach Gamma now opens the
 * v8 browse Flow. The not-in-catalog copy survives only as the fallback for a
 * deployment with no Flow provisioned.
 */

// --- the text handler's dependency wall (same set as try-curriculum-lp-serve) ---
const flowsSent = [];
const messagesSent = [];
jest.mock('../../shared/services/whatsapp.service', () => ({
  sendFlow: jest.fn(async (to, opts) => { flowsSent.push({ to, ...opts }); return true; }),
  sendMessage: jest.fn(async (to, text) => { messagesSent.push({ to, text }); return true; }),
}));
jest.mock('../../shared/services/openai.service', () => ({}));
jest.mock('../../shared/services/content.service', () => ({}));
jest.mock('../../shared/services/language-detector.service', () => ({}));
jest.mock('../../shared/services/feature-registration.service', () => ({}));
jest.mock('../../shared/services/context.service', () => ({}));
jest.mock('../../shared/services/cache/railway-redis.service', () => ({ redis: {} }));
jest.mock('../../shared/services/coaching-orchestrator.service', () => ({}));
jest.mock('../../shared/services/menu.service', () => ({}));
jest.mock('../../shared/services/helper-agent.service', () => ({}));
jest.mock('../../shared/handlers/portal-command.handler', () => ({ handlePortalCommand: jest.fn() }));
jest.mock('../../shared/services/reading-assessment.service', () => ({}));
jest.mock('../../shared/services/feature-linker.service', () => ({}));
jest.mock('../../shared/services/feature-intro.service', () => ({}));
jest.mock('../../shared/services/lesson-plan-queue.service', () => ({}));
jest.mock('../../shared/services/region-features.service', () => ({ getRegionFeatures: jest.fn() }));
jest.mock('../../shared/utils/region', () => ({ getUserRegion: jest.fn(() => 'niete') }));
jest.mock('../../shared/services/video/video-orchestrator.service', () => ({}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../shared/utils/constants', () => ({
  TEMP_DIR: '/tmp', LOADING_STICKER_PATH: '', LOADING_STICKER_MEDIA_ID: '',
  OPENAI_API_KEY: '', ATTENDANCE_SETUP_FLOW_ID: '', ATTENDANCE_MARKING_FLOW_ID: '',
}));
jest.mock('../../shared/services/llm-client', () => ({ getClient: () => ({}) }));
jest.mock('../../shared/utils/language-detector', () => ({ detectLanguageOverride: jest.fn() }));
jest.mock('../../shared/utils/language-cache', () => ({ getUserLanguage: jest.fn(), setUserLanguage: jest.fn() }));
jest.mock('../../shared/database/bot-helpers', () => ({
  getOrCreateUser: jest.fn(), getOrCreateSession: jest.fn(),
  updateSessionType: jest.fn(), storeConversation: jest.fn(), storeLessonPlan: jest.fn(),
}));
jest.mock('../../shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../shared/handlers/homework-trigger', () => ({ evaluateHomeworkTrigger: jest.fn() }));
jest.mock('../../shared/handlers/lesson-plan-v2.handler', () => jest.fn());

const FLOW_ID = '1565529551677911';
const cps = (s) => [...String(s || '')].length;
const typing = () => ({ stop: jest.fn() });
const user = { id: 'u-1', first_name: 'Haroon' };

const { handleLessonPlanRequest } = require('../../shared/handlers/text-message.handler');
const { openLpBrowseFlow } = require('../../shared/services/lp-browse-entry.service');

beforeEach(() => { flowsSent.length = 0; messagesSent.length = 0; process.env.PAKISTAN_LP_FLOW_ID = FLOW_ID; });
afterAll(() => { delete process.env.PAKISTAN_LP_FLOW_ID; });

describe('the text door: intent lesson_plan / Oxbridge "Generate NIETE LP" tap', () => {
  test('opens the browse Flow, never the not-in-catalog reply', async () => {
    await handleLessonPlanRequest('923365709413', 'grade 3 math chapter 2', user, null, 'en', typing());
    expect(flowsSent).toHaveLength(1);
    expect(flowsSent[0].flowId).toBe(FLOW_ID);
    expect(flowsSent[0].to).toBe('923365709413');
    expect(messagesSent.some((m) => /catalog|نصابی مجموعے/.test(m.text))).toBe(false);
  });

  test('the flow token starts with the user id, so the endpoint can resolve her', async () => {
    await handleLessonPlanRequest('923365709413', 'x', user, null, 'en', typing());
    expect(flowsSent[0].flowToken.startsWith('u-1:pakistan-lp:')).toBe(true);
  });

  test('falls back to the not-in-catalog reply ONLY when no Flow is provisioned', async () => {
    delete process.env.PAKISTAN_LP_FLOW_ID;
    await handleLessonPlanRequest('923365709413', 'x', user, null, 'ur', typing());
    expect(flowsSent).toHaveLength(0);
    expect(messagesSent).toHaveLength(1);
    expect(messagesSent[0].text).toMatch(/نصابی مجموعے/);
  });
});

describe('the shared entry (one copy for every door)', () => {
  test('an Urdu teacher gets Urdu, inside the WhatsApp caps in CODE POINTS', async () => {
    const ok = await openLpBrowseFlow({ from: '9230', userId: 'u-1', language: 'ur', reason: 'test' });
    expect(ok).toBe(true);
    const f = flowsSent[0];
    expect(f.header).toMatch(/سبق/);
    expect(f.buttonText).toMatch(/جماعت/);
    expect(cps(f.header)).toBeLessThanOrEqual(60);
    expect(cps(f.buttonText)).toBeLessThanOrEqual(20);
  });

  test('an English teacher gets English, inside the caps', async () => {
    await openLpBrowseFlow({ from: '9230', userId: 'u-1', language: 'en', reason: 'test' });
    const f = flowsSent[0];
    expect(f.header).toMatch(/Lesson Plans/);
    expect(cps(f.header)).toBeLessThanOrEqual(60);
    expect(cps(f.buttonText)).toBeLessThanOrEqual(20);
  });

  test('returns false, sends nothing, when the Flow is not provisioned', async () => {
    delete process.env.PAKISTAN_LP_FLOW_ID;
    expect(await openLpBrowseFlow({ from: '9230', userId: 'u-1', language: 'en', reason: 'test' })).toBe(false);
    expect(flowsSent).toHaveLength(0);
  });
});
