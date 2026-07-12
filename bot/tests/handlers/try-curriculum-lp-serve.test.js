/**
 * tryCurriculumLessonPlanServe tests
 *
 * Locks in the grade/subject resolution chain: prefer parseSubjectAndGrade on the
 * current message, fall back to user.grade / user.subject (Track-01a bridge columns),
 * and if BOTH resolve to nothing we do NOT attempt the intercept — the caller
 * (text-message.handler) then falls through to the standard Gamma path.
 */

// --- mocks (in dep-load order at top of the handler) ---
jest.mock('../../shared/services/whatsapp.service', () => ({}));
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
jest.mock('../../shared/services/region-features.service', () => ({
  getRegionFeatures: jest.fn(),
}));
jest.mock('../../shared/utils/region', () => ({ getUserRegion: jest.fn(() => 'niete') }));
jest.mock('../../shared/services/video/video-orchestrator.service', () => ({}));
jest.mock('../../shared/services/attendance-detector.service', () => ({}));
jest.mock('../../shared/services/attendance-conversation.service', () => ({}));
jest.mock('../../shared/services/attendance-delivery.service', () => ({}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../shared/utils/constants', () => ({
  TEMP_DIR: '/tmp', LOADING_STICKER_PATH: '', LOADING_STICKER_MEDIA_ID: '',
  OPENAI_API_KEY: '', ATTENDANCE_SETUP_FLOW_ID: '', ATTENDANCE_MARKING_FLOW_ID: '',
}));
jest.mock('../../shared/services/llm-client', () => ({ getClient: () => ({}) }));
jest.mock('../../shared/utils/language-detector', () => ({ detectLanguageOverride: jest.fn() }));
jest.mock('../../shared/utils/language-cache', () => ({
  getUserLanguage: jest.fn(), setUserLanguage: jest.fn(),
}));
jest.mock('../../shared/database/bot-helpers', () => ({
  getOrCreateUser: jest.fn(), getOrCreateSession: jest.fn(),
  updateSessionType: jest.fn(), storeConversation: jest.fn(), storeLessonPlan: jest.fn(),
}));
jest.mock('../../shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../shared/handlers/homework-trigger', () => ({ evaluateHomeworkTrigger: jest.fn() }));
jest.mock('../../shared/handlers/edit-class-trigger', () => ({ detectEditClassIntent: jest.fn() }));

const mockHandleCurriculumLessonPlan = jest.fn();
jest.mock('../../shared/handlers/lesson-plan-v2.handler', () => mockHandleCurriculumLessonPlan);

const RegionFeaturesService = require('../../shared/services/region-features.service');
const { tryCurriculumLessonPlanServe } = require('../../shared/handlers/text-message.handler');

describe('tryCurriculumLessonPlanServe — grade/subject resolution', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    RegionFeaturesService.getRegionFeatures.mockResolvedValue({
      curriculum_lp_enabled: true,
      curriculum_key: 'punjab_snc_2020',
    });
    mockHandleCurriculumLessonPlan.mockResolvedValue({ source: 'pre_generated' });
  });

  it('returns false when region does not enable curriculum LPs (no intercept attempt)', async () => {
    RegionFeaturesService.getRegionFeatures.mockResolvedValueOnce({
      curriculum_lp_enabled: false,
      curriculum_key: null,
    });

    const result = await tryCurriculumLessonPlanServe(
      '923333232533', 'time to recall', { grade: 1, subject: 'english' }, 'en',
    );

    expect(result).toBe(false);
    expect(mockHandleCurriculumLessonPlan).not.toHaveBeenCalled();
  });

  it('resolves grade & subject from the topic string first (parseSubjectAndGrade)', async () => {
    const result = await tryCurriculumLessonPlanServe(
      '923333232533',
      'grade 1 english lesson plan for time to recall',
      { /* no user.grade / user.subject */ },
      'en',
    );

    expect(result).toBe(true);
    expect(mockHandleCurriculumLessonPlan).toHaveBeenCalledWith(
      expect.objectContaining({ grade: 1, subject: 'english', topic: expect.any(String) }),
    );
  });

  it('falls back to user.grade & user.subject when the topic does not contain them', async () => {
    const result = await tryCurriculumLessonPlanServe(
      '923333232533',
      'time to recall',
      { grade: 1, subject: 'english' },
      'en',
    );

    expect(result).toBe(true);
    expect(mockHandleCurriculumLessonPlan).toHaveBeenCalledWith(
      expect.objectContaining({ grade: 1, subject: 'english' }),
    );
  });

  it('returns false without calling the LP handler when NEITHER source yields grade/subject', async () => {
    const result = await tryCurriculumLessonPlanServe(
      '923333232533', 'time to recall', { /* nothing */ }, 'en',
    );

    expect(result).toBe(false);
    expect(mockHandleCurriculumLessonPlan).not.toHaveBeenCalled();
  });

  it('returns false when handleCurriculumLessonPlan yields non-pre_generated source', async () => {
    mockHandleCurriculumLessonPlan.mockResolvedValueOnce({ source: 'gamma_fallback' });

    const result = await tryCurriculumLessonPlanServe(
      '923333232533', 'time to recall', { grade: 1, subject: 'english' }, 'en',
    );

    expect(result).toBe(false);
  });

  it('swallows errors and returns false (caller falls through to Gamma)', async () => {
    RegionFeaturesService.getRegionFeatures.mockRejectedValueOnce(new Error('boom'));

    const result = await tryCurriculumLessonPlanServe(
      '923333232533', 'time to recall', { grade: 1, subject: 'english' }, 'en',
    );

    expect(result).toBe(false);
  });
});
