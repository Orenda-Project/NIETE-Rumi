/**
 * bd-oak77.4 — LP_612_ROUTE_ALL: every 6-12 lesson-plan intent lands on the menu.
 *
 * The operator, 2026-09-06: "turn off the free flow lesson plan generation via gamma on prod, and
 * route all lesson plan requests to this menu."
 *
 * bd-2540 + bd-hgwfo already retired Gamma on develop and funnelled every door into
 * openLpBrowseFlow. Two leaks survive that, and this file is about those two:
 *
 *   LEAK 1  tryCurriculumLessonPlanServe runs BEFORE the menu on three call sites (the early
 *           intercept, the lesson_plan intent, the awaiting_topic reply) and its Path 0 sends the
 *           OLD Oxbridge 6-12 picker, returning `oxbridge_picker`, which stops the message flow.
 *   LEAK 2  the Flow endpoint falls back from lp612 to Oxbridge subjects for a 6-12 grade with no
 *           segments.
 *
 * Every test below drives the REAL changed line with the network boundary (whatsapp.service,
 * supabase, the catalog services) mocked — not a source grep. Root rule 6.
 */

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
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
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
const user = { id: 'u-1', first_name: 'Haroon', grade: '9' };

const RegionFeatures = require('../../shared/services/region-features.service');
const handleCurriculumLessonPlan = require('../../shared/handlers/lesson-plan-v2.handler');
const {
  handleLessonPlanRequest,
  tryCurriculumLessonPlanServe,
} = require('../../shared/handlers/text-message.handler');
const flags = require('../../shared/config/lp612-flags');
const { resolveUx, LP612_ETA } = require('../../shared/config/ux-strings');

const ROUTE_ENV = ['LP_612_ENABLED', 'LP_612_ROUTE_ALL', 'LP_612_ROUTE_K5'];
beforeEach(() => {
  flowsSent.length = 0;
  messagesSent.length = 0;
  jest.clearAllMocks();
  process.env.PAKISTAN_LP_FLOW_ID = FLOW_ID;
  ROUTE_ENV.forEach((k) => delete process.env[k]);
  RegionFeatures.getRegionFeatures.mockResolvedValue({ curriculum_lp_enabled: true, curriculum_key: 'niete' });
  handleCurriculumLessonPlan.mockResolvedValue({ source: 'oxbridge_picker', promptedForPage: false });
});
afterAll(() => { delete process.env.PAKISTAN_LP_FLOW_ID; ROUTE_ENV.forEach((k) => delete process.env[k]); });

// ── the flag surface ──────────────────────────────────────────────────────
describe('the two new flags', () => {
  test('both default OFF, and only the literal string "true" turns them on', () => {
    expect(flags.isLp612RouteAll()).toBe(false);
    expect(flags.isLp612RouteK5()).toBe(false);
    process.env.LP_612_ROUTE_ALL = 'false';
    process.env.LP_612_ROUTE_K5 = '1';
    expect(flags.isLp612RouteAll()).toBe(false);
    expect(flags.isLp612RouteK5()).toBe(false);
    process.env.LP_612_ROUTE_ALL = 'true';
    process.env.LP_612_ROUTE_K5 = 'true';
    expect(flags.isLp612RouteAll()).toBe(true);
    expect(flags.isLp612RouteK5()).toBe(true);
  });

  test('ROUTE_ALL only ever narrows — it does nothing while LP_612_ENABLED is off', async () => {
    process.env.LP_612_ROUTE_ALL = 'true'; // ENABLED deliberately unset
    const served = await tryCurriculumLessonPlanServe('923365709413', 'photosynthesis grade 9 biology', user, 'en');
    expect(handleCurriculumLessonPlan).toHaveBeenCalled();
    expect(served).toBe(true); // the Oxbridge picker still answers, exactly as today
  });
});

// ── LEAK 1 ────────────────────────────────────────────────────────────────
describe('LEAK 1 — the old 6-12 Oxbridge picker is unreachable from free text', () => {
  test('WITHOUT the flags a grade-9 topic still reaches the old picker (the bug this closes)', async () => {
    const served = await tryCurriculumLessonPlanServe('923365709413', 'photosynthesis grade 9 biology', user, 'en');
    expect(handleCurriculumLessonPlan).toHaveBeenCalled();
    expect(served).toBe(true);
  });

  test('WITH both flags the picker is never called and the caller falls through to the menu', async () => {
    process.env.LP_612_ENABLED = 'true';
    process.env.LP_612_ROUTE_ALL = 'true';
    const served = await tryCurriculumLessonPlanServe('923365709413', 'photosynthesis grade 9 biology', user, 'en');
    expect(handleCurriculumLessonPlan).not.toHaveBeenCalled();
    expect(served).toBe(false);
  });

  test('grade comes from the MESSAGE when it disagrees with users.grade', async () => {
    process.env.LP_612_ENABLED = 'true';
    process.env.LP_612_ROUTE_ALL = 'true';
    const k5Teacher = { id: 'u-2', grade: '3' };
    const served = await tryCurriculumLessonPlanServe('923365709413', 'grade 11 chemistry acids', k5Teacher, 'en');
    expect(handleCurriculumLessonPlan).not.toHaveBeenCalled();
    expect(served).toBe(false);
  });

  test('K-5 is UNTOUCHED by ROUTE_ALL — a grade-3 request still serves on its FEAT-059 path', async () => {
    process.env.LP_612_ENABLED = 'true';
    process.env.LP_612_ROUTE_ALL = 'true';
    handleCurriculumLessonPlan.mockResolvedValue({ source: 'ast_cached', promptedForPage: false });
    const k5Teacher = { id: 'u-2', grade: '3', subject: 'math' };
    const served = await tryCurriculumLessonPlanServe('923365709413', 'grade 3 math number buddies', k5Teacher, 'en');
    expect(handleCurriculumLessonPlan).toHaveBeenCalled();
    expect(served).toBe(true);
  });

  test('LP_612_ROUTE_K5=true ALSO diverts K-5 (the switch the operator may flip)', async () => {
    process.env.LP_612_ENABLED = 'true';
    process.env.LP_612_ROUTE_ALL = 'true';
    process.env.LP_612_ROUTE_K5 = 'true';
    const k5Teacher = { id: 'u-2', grade: '3', subject: 'math' };
    const served = await tryCurriculumLessonPlanServe('923365709413', 'grade 3 math number buddies', k5Teacher, 'en');
    expect(handleCurriculumLessonPlan).not.toHaveBeenCalled();
    expect(served).toBe(false);
  });

  test('an unknown grade diverts too — the menu opens on a grade picker', async () => {
    process.env.LP_612_ENABLED = 'true';
    process.env.LP_612_ROUTE_ALL = 'true';
    const noGrade = { id: 'u-3' };
    const served = await tryCurriculumLessonPlanServe('923365709413', 'something about photosynthesis', noGrade, 'en');
    expect(handleCurriculumLessonPlan).not.toHaveBeenCalled();
    expect(served).toBe(false);
  });
});

// ── the redirect copy ─────────────────────────────────────────────────────
describe('she typed a topic — one short line, then the menu', () => {
  test('ROUTE_ALL on: the redirect line is sent BEFORE the Flow, in her language', async () => {
    process.env.LP_612_ENABLED = 'true';
    process.env.LP_612_ROUTE_ALL = 'true';
    await handleLessonPlanRequest('923365709413', 'a lesson plan on photosynthesis', user, null, 'ur', typing());
    expect(messagesSent).toHaveLength(1);
    expect(messagesSent[0].text).toBe(resolveUx('lp612RouteRedirect', { language: 'ur' }));
    expect(flowsSent).toHaveLength(1);
    expect(flowsSent[0].flowId).toBe(FLOW_ID);
  });

  test('ROUTE_ALL off: no redirect line — the Flow alone, exactly as bd-hgwfo ships it', async () => {
    await handleLessonPlanRequest('923365709413', 'a lesson plan on photosynthesis', user, null, 'en', typing());
    expect(messagesSent).toHaveLength(0);
    expect(flowsSent).toHaveLength(1);
  });

  test('the redirect copy exists in both offered languages and fits the WhatsApp body cap in CODE POINTS', () => {
    ['en', 'ur'].forEach((lang) => {
      const s = resolveUx('lp612RouteRedirect', { language: lang });
      expect(typeof s).toBe('string');
      expect(s.length).toBeGreaterThan(0);
      expect(cps(s)).toBeLessThanOrEqual(1024);
    });
    expect(resolveUx('lp612RouteRedirect', { language: 'ur' }))
      .not.toBe(resolveUx('lp612RouteRedirect', { language: 'en' }));
  });
});

// ── bd-oo0of: the interstitial must stop promising a number ───────────────
describe('the authoring interstitial carries the ONE estimate constant', () => {
  // This block used to assert the opposite. The estimate had been removed because the number then
  // in the copy was measured against a slower lane and was wrong for Urdu by ~3 minutes. Targeted
  // revision landed, the operator asked for an estimate back (2026-09-06), and the band is now a
  // single constant pinned against measured p50/p90 in tests/lp612/honest-eta.test.js.
  //
  // What this file still guards is that the STALE band never returns, and that both strings take
  // their number from the constant rather than hand-typing one.
  test.each(['lp612Preparing', 'lp612Restarted'])('%s carries LP612_ETA, never the stale band', (key) => {
    ['en', 'ur'].forEach((lang) => {
      const s = resolveUx(key, { language: lang });
      expect(s).not.toMatch(/5–6|5-6|five to six|پانچ سے چھ/);
      expect(s).toContain(LP612_ETA[lang]);
      expect(cps(s)).toBeLessThanOrEqual(1024);
    });
  });
});
