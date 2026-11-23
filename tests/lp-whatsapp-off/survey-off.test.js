'use strict';
/**
 * `lp_whatsapp_survey_off`: a teacher whose programme is listed gets no "Was this useful?" survey on WhatsApp. Every
 * WhatsApp lesson-plan survey passes one of two delayed sends — grades 1-5 (lp-feedback.service) and grades 6-12 /
 * GB K-5 (lp612-feedback.service) — whether it follows a delivery, a cache hit, an app open (lp-app-open-survey) or
 * the legacy paths. The check is inside the delayed send, so the delivery itself pays nothing for it. Anyone else
 * (no row, a malformed value, the other programme listed) is asked exactly as today.
 */
const mockButtons = jest.fn();
jest.mock('../../bot/shared/services/whatsapp.service', () => ({ sendInteractiveButtons: (...a) => mockButtons(...a) }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../bot/shared/services/cache/railway-redis.service', () => ({
  setNX: jest.fn(async () => true), delete: jest.fn(async () => true),
}));
jest.mock('../../bot/shared/config/supabase', () => {
  const b = {};
  ['select', 'eq', 'in', 'order', 'limit'].forEach((m) => { b[m] = () => b; });
  b.maybeSingle = b.single = () => Promise.resolve({ data: null, error: null });
  return { from: () => b };
});
jest.mock('../../bot/shared/services/lp-whatsapp-off', () => require('../fixtures/lp-whatsapp-off-fake').module);

const Fake = require('../fixtures/lp-whatsapp-off-fake');
const LpFeedback = require('../../bot/shared/services/lp-feedback.service');
const Lp612Feedback = require('../../bot/shared/services/lp612-feedback.service');

const PHONE = '920000000004';
const k5 = (userId) => LpFeedback.sendFeedbackPrompt({
  lessonPlanId: '5b1c8f0e-0000-4000-8000-000000000005', userId, phone: PHONE, context: { lessonKey: 'grade_1_english_ch4_seg2' },
});
const g612 = (userId) => Lp612Feedback.sendFeedbackPrompt({ segmentId: 'grade_9_biology.c01.p1-3', userId, phone: PHONE, lang: 'en' });

beforeEach(() => {
  jest.clearAllMocks();
  Fake.reset();
  mockButtons.mockReset().mockResolvedValue(true);
});

describe.each([['grades 1-5', k5], ['grades 6-12 and GB K-5', g612]])('%s survey', (_lane, send) => {
  describe.each(Fake.PER_TEACHER)('lp_whatsapp_survey_off %s (%j), %s teacher', (_label, value, _who, userId, off) => {
    test(off ? 'not asked' : 'today: asked', async () => {
      Fake.setSurveyOff(value);
      await send(userId);
      expect(mockButtons).toHaveBeenCalledTimes(off ? 0 : 1);
    });
  });

  test('the PDF switch alone does not stop the survey', async () => {
    Fake.setPdfOff(['ict', 'gb']);
    await send(Fake.ICT_TEACHER);
    expect(mockButtons).toHaveBeenCalledTimes(1);
  });
});

test('grades 1-5: a skipped survey leaves no ask-once claim behind', async () => {
  const Redis = require('../../bot/shared/services/cache/railway-redis.service');
  Fake.setSurveyOff(['ict']);
  await k5(Fake.ICT_TEACHER);
  expect(Redis.setNX).not.toHaveBeenCalled();
});
