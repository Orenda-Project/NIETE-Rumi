'use strict';
/**
 * answeredInApp(userId, lessonId): her in_app answer for a grades 1-5 lesson on any of her lesson_plans rows for it,
 * or null. Its own module so the WhatsApp tap (lp-feedback.service) can ask it without a require loop through the
 * in-app writer (tests/setup/circular-deps).
 */
const { createMemorySupabase } = require('../fixtures/memory-supabase');
const mockDb = createMemorySupabase({});
jest.mock('../../bot/shared/config/supabase', () => mockDb);
const { answeredInApp } = require('../../bot/shared/services/lp-in-app-answer');

const T = '6f1c2a7e-0b8d-4c55-9a51-2d7f0e3b9c10';
const L = 'grade_1_english_ch1_seg3';
const plan = (id, lesson, user = T) => ({ id, user_id: user, content: { v8: { lesson_id: lesson } } });

test('finds her in_app answer on another of her rows for the same lesson', async () => {
  mockDb.reset({ lesson_plans: [plan('p-wa', L), plan('p-app', L)], lp_feedback: [{ id: 'f1', user_id: T, lesson_plan_id: 'p-app', trigger_mode: 'in_app', useful: true }] });
  await expect(answeredInApp(T, L)).resolves.toMatchObject({ id: 'f1', useful: true });
});

test('a WhatsApp answer, another lesson, another teacher or no lesson id → null', async () => {
  mockDb.reset({
    lesson_plans: [plan('p1', L), plan('p2', 'grade_1_english_ch1_seg4'), plan('p3', L, 'other')],
    lp_feedback: [
      { id: 'f1', user_id: T, lesson_plan_id: 'p1', trigger_mode: 'after_pdf_only', useful: true },
      { id: 'f2', user_id: T, lesson_plan_id: 'p2', trigger_mode: 'in_app', useful: true },
      { id: 'f3', user_id: 'other', lesson_plan_id: 'p3', trigger_mode: 'in_app', useful: true },
    ],
  });
  await expect(answeredInApp(T, L)).resolves.toBeNull();
  await expect(answeredInApp(T, null)).resolves.toBeNull();
});
