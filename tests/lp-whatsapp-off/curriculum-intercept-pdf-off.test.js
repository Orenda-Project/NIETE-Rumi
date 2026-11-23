'use strict';
/**
 * The typed curriculum topic ("grade 3 math number buddies") is served by tryCurriculumLessonPlanServe BEFORE the
 * intent classifier and before any app-redirect door — the early intercept, the awaiting-topic reply and the
 * lesson_plan intent all call it. With her programme on lp_whatsapp_pdf_off it serves no PDF: it sends the app link
 * and reports the message handled. Anyone else: exactly today (the curriculum handler runs).
 */
jest.mock('../../bot/shared/services/whatsapp.service', () => ({ sendFlow: jest.fn(), sendMessage: jest.fn(async () => true) }));
jest.mock('../../bot/shared/services/openai.service', () => ({ extractTopic: jest.fn(async () => 'number buddies') }));
jest.mock('../../bot/shared/services/content.service', () => ({}));
jest.mock('../../bot/shared/services/language-detector.service', () => ({}));
jest.mock('../../bot/shared/services/feature-registration.service', () => ({}));
jest.mock('../../bot/shared/services/context.service', () => ({}));
jest.mock('../../bot/shared/services/cache/railway-redis.service', () => ({ redis: {} }));
jest.mock('../../bot/shared/services/coaching-orchestrator.service', () => ({}));
jest.mock('../../bot/shared/services/menu.service', () => ({}));
jest.mock('../../bot/shared/services/helper-agent.service', () => ({}));
jest.mock('../../bot/shared/handlers/portal-command.handler', () => ({ handlePortalCommand: jest.fn() }));
jest.mock('../../bot/shared/services/reading-assessment.service', () => ({}));
jest.mock('../../bot/shared/services/feature-linker.service', () => ({}));
jest.mock('../../bot/shared/services/feature-intro.service', () => ({}));
jest.mock('../../bot/shared/services/lesson-plan-queue.service', () => ({ createAndQueue: jest.fn(async () => 'req-1') }));
jest.mock('../../bot/shared/services/region-features.service', () => ({ getRegionFeatures: jest.fn() }));
jest.mock('../../bot/shared/utils/region', () => ({ getUserRegion: jest.fn(() => 'niete') }));
jest.mock('../../bot/shared/services/video/video-orchestrator.service', () => ({}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../bot/shared/utils/constants', () => ({
  TEMP_DIR: '/tmp', LOADING_STICKER_PATH: '', LOADING_STICKER_MEDIA_ID: '',
  OPENAI_API_KEY: '', ATTENDANCE_SETUP_FLOW_ID: '', ATTENDANCE_MARKING_FLOW_ID: '',
}));
jest.mock('../../bot/shared/services/llm-client', () => ({
  getClient: () => ({}),
  getClientForModel: (m) => ({ client: {}, model: String(m || '') }),
}));
jest.mock('../../bot/shared/utils/language-detector', () => ({ detectLanguageOverride: jest.fn() }));
jest.mock('../../bot/shared/utils/language-detection', () => ({
  detectRequestedLanguage: jest.fn(() => 'en'),
  parseSubjectAndGrade: jest.requireActual('../../bot/shared/utils/language-detection').parseSubjectAndGrade,
}));
jest.mock('../../bot/shared/utils/language-cache', () => ({ getUserLanguage: jest.fn(), setUserLanguage: jest.fn() }));
jest.mock('../../bot/shared/database/bot-helpers', () => ({
  getOrCreateUser: jest.fn(), getOrCreateSession: jest.fn(),
  updateSessionType: jest.fn(), storeConversation: jest.fn(), storeLessonPlan: jest.fn(),
}));
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../bot/shared/handlers/homework-trigger', () => ({ evaluateHomeworkTrigger: jest.fn() }));
jest.mock('../../bot/shared/handlers/lesson-plan-v2.handler', () => jest.fn());
jest.mock('../../bot/shared/services/lp-whatsapp-off', () => require('../fixtures/lp-whatsapp-off-fake').module);
const mockLink = jest.fn();
jest.mock('../../bot/shared/services/app-redirect.service', () => ({
  ...jest.requireActual('../../bot/shared/services/app-redirect.service'),
  sendLessonPlanLink: (...a) => mockLink(...a),
}));

const Fake = require('../fixtures/lp-whatsapp-off-fake');
const RegionFeatures = require('../../bot/shared/services/region-features.service');
const handleCurriculumLessonPlan = require('../../bot/shared/handlers/lesson-plan-v2.handler');
const { tryCurriculumLessonPlanServe } = require('../../bot/shared/handlers/text-message.handler');

const FROM = '920000000003';
const TOPIC = 'grade 3 math number buddies';
const teacher = (id) => ({ id, grade: '3', subject: 'math', preferred_language: 'ur' });

beforeEach(() => {
  jest.clearAllMocks();
  Fake.reset();
  mockLink.mockReset().mockResolvedValue(true);
  RegionFeatures.getRegionFeatures.mockResolvedValue({ curriculum_lp_enabled: true, curriculum_key: 'niete' });
  handleCurriculumLessonPlan.mockResolvedValue({ source: 'ast_cached', promptedForPage: false });
});

describe.each(Fake.PER_TEACHER)('lp_whatsapp_pdf_off %s (%j), %s teacher', (_label, value, _who, userId, off) => {
  test(off ? 'no curriculum PDF: the app link, handled' : 'today: the curriculum handler serves it', async () => {
    Fake.setPdfOff(value);
    const served = await tryCurriculumLessonPlanServe(FROM, TOPIC, teacher(userId), null);
    expect(served).toBe(true);
    if (off) {
      expect(handleCurriculumLessonPlan).not.toHaveBeenCalled();
      expect(mockLink).toHaveBeenCalledWith(expect.objectContaining({ userId, from: FROM, language: 'ur' }));
    } else {
      expect(handleCurriculumLessonPlan).toHaveBeenCalledTimes(1);
      expect(mockLink).not.toHaveBeenCalled();
    }
  });
});

test('off, and the link could not go: no PDF, not handled (the caller falls through to its own door)', async () => {
  Fake.setPdfOff(['ict']);
  mockLink.mockResolvedValue(false);
  expect(await tryCurriculumLessonPlanServe(FROM, TOPIC, teacher(Fake.ICT_TEACHER), 'en')).toBe(false);
  expect(handleCurriculumLessonPlan).not.toHaveBeenCalled();
});

test('a message that is not a curriculum request never asks the switch', async () => {
  Fake.setPdfOff(['ict', 'gb']);
  RegionFeatures.getRegionFeatures.mockResolvedValue({ curriculum_lp_enabled: false });
  expect(await tryCurriculumLessonPlanServe(FROM, TOPIC, teacher(Fake.ICT_TEACHER), null)).toBe(false);
  expect(Fake.state.calls).toEqual([]);
});
