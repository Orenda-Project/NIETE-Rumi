'use strict';
/**
 * bd-t7zk3t.12 — a Reading Hour / Numeracy (FLN) open never asks the lesson-plan survey.
 *
 * The survey after an app open (lp-app-open-survey, bd-qvevax.2) knows two plan kinds: k5 asks the
 * K-5 survey, and ANY other kind falls through to the 6-12 survey with plan_ref as a segment id. An
 * FLN open (plan_kind 'fln', plan_ref = a taleemabad_core lesson id) would have scheduled a 6-12
 * survey about a segment that does not exist and written that id into lp_feedback. The ruling
 * (SPEC_v2 §6 row 9): FLN is excluded, explicitly, before any guard reads Redis or the user — an FLN
 * survey is a later bead.
 *
 * Driven through the REAL service; only Supabase (in memory), the cache and WhatsApp are faked.
 */

const { createMemorySupabase, createMemoryRedis } = require('../fixtures/memory-supabase');

const mockDb = createMemorySupabase();
const mockRedis = createMemoryRedis();
jest.mock('../../bot/shared/config/supabase', () => mockDb);
jest.mock('../../bot/shared/services/cache/railway-redis.service', () => mockRedis);
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  sendTemplate: jest.fn().mockResolvedValue(true),
  sendTemplateMessage: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => undefined }));

const WhatsAppService = require('../../bot/shared/services/whatsapp.service');
const Lp612Feedback = require('../../bot/shared/services/lp612-feedback.service');
const AppSurvey = require('../../bot/shared/services/lp-app-open-survey.service');

const USER = { id: '6f1c2a7e-0b8d-4c55-9a51-2d7f0e3b9c10', phone_number: '923001234567', preferred_language: 'en' };
const NOW = new Date('2026-10-18T09:00:00Z');

beforeEach(() => {
  jest.clearAllMocks();
  mockRedis.reset();
  mockDb.reset({
    users: [USER],
    lesson_plans: [],
    lp_feedback: [],
    niete_lp612_deliveries: [],
    niete_lp_downloads: [],
    niete_lp_opens: [{
      id: 'open-fln', user_id: USER.id, plan_kind: 'fln', plan_ref: '11156', lang: 'en', source: 'viewer',
      opened_at: NOW.toISOString(),
    }],
    chat_sessions: [{ id: 'cs-1', user_id: USER.id, last_activity_at: new Date(NOW.getTime() - 5 * 60_000).toISOString() }],
  });
});

test('an FLN open is skipped as fln_no_survey: nothing scheduled, nothing sent, nothing written', async () => {
  const spy = jest.spyOn(Lp612Feedback, 'scheduleFeedbackPrompt');
  const out = await AppSurvey.onViewerOpen({ openId: 'open-fln' });
  expect(out).toEqual({ outcome: 'skipped', reason: 'fln_no_survey' });
  expect(spy).not.toHaveBeenCalled();
  expect(WhatsAppService.sendInteractiveButtons).not.toHaveBeenCalled();
  expect(mockDb.rows('lp_feedback')).toHaveLength(0);
  expect(mockDb.rows('lesson_plans')).toHaveLength(0);
  // decided before the "handled" claim, so a later FLN survey bead starts from a clean slate
  expect(await mockRedis.get(AppSurvey.REDIS_HANDLED_KEY('open-fln'))).toBeFalsy();
});
