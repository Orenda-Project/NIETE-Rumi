'use strict';
/**
 * bd-5knlj — the buttons-path "No" wrote only has_lesson_plan=false and no
 * lesson_plan_link_method, which hid 153 coach answers from every later
 * analysis (the largest bucket of the Section B report looked like "never
 * answered"). The answer must leave the same marker the list path leaves.
 */
let mockUpdates;
jest.mock('../../bot/shared/config/supabase', () => ({
  from: (table) => ({
    update: (patch) => ({ eq: async () => { mockUpdates.push({ table, patch }); return { data: null, error: null }; } }),
    select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { preferred_language: 'en' } }), single: async () => ({ data: { preferred_language: 'en' } }) }) }),
  }),
}));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({ sendMessage: jest.fn(async () => true) }));
jest.mock('../../bot/shared/services/coaching/coaching-job-queue.service', () => ({ queueAnalysis: jest.fn(async () => true) }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

describe('handleLessonPlanResponse(hasLessonPlan=false)', () => {
  beforeEach(() => { jest.resetModules(); mockUpdates = []; });

  it('writes lesson_plan_link_method=none alongside has_lesson_plan=false', async () => {
    const Processor = require('../../bot/shared/services/coaching/lesson-plan-processor.service');
    await Processor.handleLessonPlanResponse('cs-9', '92300xxxxxxx', false);
    const u = mockUpdates.find((x) => x.table === 'coaching_sessions');
    expect(u).toBeDefined();
    expect(u.patch.has_lesson_plan).toBe(false);
    expect(u.patch.lesson_plan_link_method).toBe('none');
  });
});
