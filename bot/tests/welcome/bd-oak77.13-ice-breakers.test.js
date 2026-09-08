'use strict';
/**
 * bd-oak77.13 — a tapped ice-breaker chip lands on the real door.
 *
 * A chip arrives as an ordinary inbound TEXT whose body is the prompt verbatim,
 * so the ONLY thing connecting the manifest on the WABA to the bot is an exact
 * string match. The fork kept those strings in two files that nobody diffed
 * (`scripts/deployment/register-commands-meta.js` and an inline map in
 * text-message.handler.js); this suite pins them to one config and drives each
 * one through the real handler.
 *
 * RED BEFORE GREEN: before this bead the four new bilingual chips matched
 * nothing and fell through to the LLM intent router, and there was no
 * `ai_coaching` action at all.
 */

const flowsSent = [];
const messagesSent = [];
const calls = { menu: [], lp: [], coaching: [], training: [], intro: [] };

jest.mock('../../shared/services/whatsapp.service', () => ({
  sendFlow: jest.fn(async (to, opts) => { flowsSent.push({ to, ...opts }); return true; }),
  sendMessage: jest.fn(async (to, text) => { messagesSent.push({ to, text }); return true; }),
  startContinuousTypingIndicator: jest.fn(() => ({ stop: jest.fn() })),
}));
jest.mock('../../shared/services/menu.service', () => ({
  sendMenu: jest.fn(async (...a) => { calls.menu.push(a); }),
  _handleLessonPlanningChoice: jest.fn(async (...a) => { calls.lp.push(a); }),
  _handleClassroomCoachingChoice: jest.fn(async (...a) => { calls.coaching.push(a); }),
  _handleMediaLibraryChoice: jest.fn(async () => {}),
  checkAwaitingLessonPlanTopic: jest.fn(async () => false),
}));
jest.mock('../../shared/services/training/training-entry.service', () => ({
  openTrainingFlow: jest.fn(async (...a) => { calls.training.push(a); }),
}));
jest.mock('../../shared/services/feature-intro.service', () => ({
  sendFirstUseIntroIfNeeded: jest.fn(async (...a) => { calls.intro.push(a); return true; }),
}));

// --- the rest of the handler's dependency wall (mirrors bd-hgwfo-gamma-door) ---
jest.mock('../../shared/services/openai.service', () => ({
  detectIntent: jest.fn(async () => ({ type: 'general_chat' })),
  extractTopic: jest.fn(async () => null),
  getResponseWithFormat: jest.fn(async () => ({ text: 'ok', format: 'text' })),
  getResponse: jest.fn(async () => 'ok'),
}));
jest.mock('../../shared/services/content.service', () => ({}));
jest.mock('../../shared/services/language-detector.service', () => ({
  detectLanguage: jest.fn(() => 'en'),
}));
jest.mock('../../shared/services/feature-registration.service', () => ({
  isPendingName: jest.fn(async () => false),
}));
jest.mock('../../shared/services/context.service', () => ({
  shouldInjectContext: jest.fn(async () => false),
  buildContext: jest.fn(async () => ''),
}));
jest.mock('../../shared/services/cache/railway-redis.service', () => ({ redis: {} }));
jest.mock('../../shared/services/coaching-orchestrator.service', () => ({}));
jest.mock('../../shared/services/helper-agent.service', () => ({}));
jest.mock('../../shared/handlers/portal-command.handler', () => ({ handlePortalCommand: jest.fn() }));
jest.mock('../../shared/services/reading-assessment.service', () => ({}));
jest.mock('../../shared/services/feature-linker.service', () => ({}));
jest.mock('../../shared/services/lesson-plan-queue.service', () => ({}));
jest.mock('../../shared/services/lp-feedback.service', () => ({
  consumeReasonIfPending: jest.fn(async () => false),
}));
jest.mock('../../shared/services/lp612-feedback.service', () => ({
  consumeReasonIfPending: jest.fn(async () => false),
}), { virtual: true });
jest.mock('../../shared/services/coaching/coaching-feedback.service', () => ({
  handlePendingReason: jest.fn(async () => false),
}), { virtual: true });
jest.mock('../../shared/services/student-video-feedback.service', () => ({
  consumeReasonIfPending: jest.fn(async () => false),
}), { virtual: true });
jest.mock('../../shared/services/region-features.service', () => ({ getRegionFeatures: jest.fn() }));
jest.mock('../../shared/utils/region', () => ({ getUserRegion: jest.fn(() => 'niete') }));
jest.mock('../../shared/services/video/video-orchestrator.service', () => ({}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../shared/utils/constants', () => ({
  TEMP_DIR: '/tmp', LOADING_STICKER_PATH: '', LOADING_STICKER_MEDIA_ID: '',
  OPENAI_API_KEY: '', ATTENDANCE_SETUP_FLOW_ID: '', ATTENDANCE_MARKING_FLOW_ID: '',
  CLASS_MANAGER_FLOW_ID: '', STUDENT_VIDEOS_FLOW_ID: '',
}));
jest.mock('../../shared/services/llm-client', () => ({ getClient: () => ({}) }));
jest.mock('../../shared/utils/language-detector', () => ({
  detectLanguageOverride: jest.fn(() => null), isMarketLanguage: jest.fn(() => false),
}));
jest.mock('../../shared/utils/language-cache', () => ({
  getUserLanguage: jest.fn(async () => 'en'), setUserLanguage: jest.fn(),
}));
jest.mock('../../shared/database/bot-helpers', () => ({
  getOrCreateUser: jest.fn(), getOrCreateSession: jest.fn(async () => 'sess-1'),
  updateSessionType: jest.fn(), storeConversation: jest.fn(), storeLessonPlan: jest.fn(),
}));
jest.mock('../../shared/config/supabase', () => {
  const chain = {
    select: () => chain, eq: () => chain, in: () => chain, order: () => chain,
    limit: () => chain, single: async () => ({ data: null, error: null }),
    maybeSingle: async () => ({ data: null, error: null }),
    update: () => chain, upsert: async () => ({ data: null, error: null }),
    then: (r) => r({ data: null, error: null }),
  };
  return { from: jest.fn(() => chain) };
});
jest.mock('../../shared/services/attendance-router.service', () => ({
  detect: jest.fn(() => ({ detected: false })),
  methodQuestionOpen: jest.fn(async () => false),
  route: jest.fn(async () => false),
}));
jest.mock('../../shared/services/lp612-edit-router.service', () => ({
  tryRoute: jest.fn(async () => false),
}));
jest.mock('../../shared/handlers/homework-trigger', () => ({
  evaluateHomeworkTrigger: jest.fn(() => ({ match: false })),
}));
jest.mock('../../shared/handlers/lesson-plan-v2.handler', () => jest.fn());

const { handleTextMessage } = require('../../shared/handlers/text-message.handler');
const CC = require('../../shared/config/conversational-components');

const FROM = '923330000201';
const user = { id: 'u-1', first_name: 'Riffat' };
const tap = (text) => handleTextMessage({ id: 'wamid.x' }, FROM, text, user);

beforeEach(() => {
  flowsSent.length = 0; messagesSent.length = 0;
  for (const k of Object.keys(calls)) calls[k].length = 0;
  jest.clearAllMocks();
});

describe('the manifest and the matcher are one config', () => {
  test('at most 4 prompts, each within Meta\'s 80-character cap (CODE POINTS)', () => {
    expect(CC.PROMPTS.length).toBeLessThanOrEqual(4);
    for (const p of CC.PROMPTS) expect([...p].length).toBeLessThanOrEqual(80);
  });

  test('every published prompt resolves to an action', () => {
    for (const p of CC.PROMPTS) expect(CC.promptAction(p)).toBeTruthy();
  });

  test('the superseded English-only chips still resolve (handsets cache them)', () => {
    for (const p of CC.LEGACY_PROMPTS) expect(CC.promptAction(p)).toBeTruthy();
  });

  test('each prompt carries BOTH languages — Meta does not localise prompts', () => {
    for (const p of CC.PROMPTS) {
      expect(p).toMatch(/[A-Za-z]/);
      expect(p).toMatch(/[؀-ۿ]/);
    }
  });

  test('the handler reads the config, it does not keep its own copy', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.join(__dirname, '../../shared/handlers/text-message.handler.js'), 'utf8');
    expect(src).toMatch(/conversational-components/);
    expect(src).not.toMatch(/'show menu - see all features i can help with'/);
  });
});

describe('a tapped chip reaches the real door', () => {
  test('"Lesson plan" opens the lp612 browse Flow — reason ice_breaker', async () => {
    await tap(CC.PROMPTS[0]);
    expect(calls.lp).toHaveLength(1);
    expect(calls.lp[0][4]).toBe('ice_breaker'); // 5th arg = reason
  });

  test('"AI coaching" sends the coaching film AND the upload prompt, in that order', async () => {
    await tap(CC.PROMPTS[1]);
    expect(calls.intro).toHaveLength(1);
    expect(calls.intro[0][2]).toBe('ai_coaching');   // feature key
    expect(calls.coaching).toHaveLength(1);          // the EXISTING coaching entry
    const FeatureIntro = require('../../shared/services/feature-intro.service');
    const Menu = require('../../shared/services/menu.service');
    expect(FeatureIntro.sendFirstUseIntroIfNeeded.mock.invocationCallOrder[0])
      .toBeLessThan(Menu._handleClassroomCoachingChoice.mock.invocationCallOrder[0]);
  });

  test('"Teacher training" opens the existing training Flow', async () => {
    await tap(CC.PROMPTS[2]);
    expect(calls.training).toHaveLength(1);
    expect(calls.training[0][1]).toBe(FROM);
  });

  test('"Show menu" sends the menu', async () => {
    await tap(CC.PROMPTS[3]);
    expect(calls.menu).toHaveLength(1);
  });

  test('the legacy "Get Coaching" chip lands on the same coaching door', async () => {
    await tap(CC.LEGACY_PROMPTS[3]);
    expect(calls.coaching).toHaveLength(1);
  });

  test('case and stray whitespace do not break a tap', async () => {
    await tap(`  ${CC.PROMPTS[0].toUpperCase()}  `);
    expect(calls.lp).toHaveLength(1);
  });

  test('ordinary text is NOT eaten by the chip matcher', async () => {
    await tap('I want a lesson plan on photosynthesis');
    expect(calls.lp).toHaveLength(0);
    expect(calls.menu).toHaveLength(0);
    expect(calls.training).toHaveLength(0);
  });
});
