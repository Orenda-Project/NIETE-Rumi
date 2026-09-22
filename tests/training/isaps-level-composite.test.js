/**
 * The I-SAPS level composite — counting, not arithmetic.
 *
 * The weights and bars (25/50/25, 50/60/50) are proved in the pure rules test.
 * What is proved HERE is the counting, because every mistake available in this
 * area is a counting mistake and each one certifies or blocks a real teacher:
 *
 *  1. summative `possible` is the PAPER she sat, not the authored bank. The
 *     banks are deliberately bigger — 63 MCQs authored, 2 served per module.
 *     Counting the bank makes 60% unreachable: a teacher who answers every
 *     question put to her correctly scores 18/63 = 29% and can never certify.
 *  2. formative `possible` is the WHOLE pool. The opposite decision, and for
 *     the opposite reason: counting only answered items lets someone who
 *     answered 2 of 97 post 100% formative, which is 25% of the composite.
 *  3. re-takes are UNLIMITED (partner guide, Sept 2026), so a component must
 *     count BEST-PER-QUESTION. Summing across attempts lets three tries at one
 *     item earn three marks and push a component past its own denominator.
 *  4. a level with no per-module exams is not this shape at all and must
 *     return null, so Beacon House and Oxbridge fall through to their own rule
 *     rather than being graded 0 by a model that does not describe them.
 */

const { gradeLevelForUser } = require('../../bot/shared/services/training/isaps-level-grade.service');

/** Minimal supabase double: per-table rows, filtered by the calls we make. */
function fakeSupabase(tables) {
  return {
    from(table) {
      const rows = () => (tables[table] || []).slice();
      const q = { _rows: rows(), _filters: [] };
      const api = {
        select() { return api; },
        eq(col, val) { q._rows = q._rows.filter(r => r[col] === val); return api; },
        in(col, vals) { const s = new Set(vals); q._rows = q._rows.filter(r => s.has(r[col])); return api; },
        then(resolve) { return Promise.resolve({ data: q._rows, error: null }).then(resolve); },
      };
      return api;
    },
  };
}

const LEVEL = 27;
const USER = 'u-1';

/** Nine module exams, as I-SAPS ships. */
const EXAMS = Array.from({ length: 9 }, (_, i) => ({
  id: 100 + i, level_id: LEVEL, source_quiz_id: 901 + i, quiz_type: 'grand_quiz', is_active: true,
}));

function baseTables(over = {}) {
  return {
    training_grand_quizzes: EXAMS,
    training_courses: [{ id: 1, level_id: LEVEL, is_active: true }],
    training_modules: [{ id: 10, course_id: 1, is_active: true }],
    // 4 formative items authored on the level
    training_questions: [
      { id: 900, training_module_id: 10, is_active: true, order_index: 1 },
      { id: 901, training_module_id: 10, is_active: true, order_index: 2 },
      { id: 902, training_module_id: 10, is_active: true, order_index: 3 },
      { id: 903, training_module_id: 10, is_active: true, order_index: 4 },
    ],
    training_assessment_attempts: [],
    training_assessment_answers: [],
    ...over,
  };
}

describe('I-SAPS level composite — counting', () => {
  test('a level with no per-module exams is not graded by this model', async () => {
    const t = baseTables({ training_grand_quizzes: [
      { id: 1, level_id: LEVEL, source_quiz_id: null, quiz_type: 'capstone', is_active: true },
    ] });
    expect(await gradeLevelForUser(fakeSupabase(t), { userId: USER, levelId: LEVEL })).toBeNull();
  });

  test('summative possible is the PAPER (9x2 MCQ, 9x10 CRQ), not the bank', async () => {
    const t = baseTables();
    const r = await gradeLevelForUser(fakeSupabase(t), { userId: USER, levelId: LEVEL });
    expect(r.counts.mcqItemCount).toBe(18);    // 9 modules x 2 served
    expect(r.counts.crqPossible).toBe(90);     // 9 modules x 10 marks
  });

  test('formative possible is the whole pool, not what she answered', async () => {
    const t = baseTables();
    const r = await gradeLevelForUser(fakeSupabase(t), { userId: USER, levelId: LEVEL });
    expect(r.counts.formativeItemCount).toBe(4);
  });

  test('a re-taken question is counted ONCE, not once per attempt', async () => {
    // Same formative question answered correctly in three separate attempts.
    const t = baseTables({
      training_assessment_attempts: [
        { id: 'a1', user_id: USER, quiz_kind: 'training_module', training_module_id: 10 },
        { id: 'a2', user_id: USER, quiz_kind: 'training_module', training_module_id: 10 },
        { id: 'a3', user_id: USER, quiz_kind: 'training_module', training_module_id: 10 },
      ],
      training_assessment_answers: [
        { attempt_id: 'a1', question_id: 900, is_correct: true },
        { attempt_id: 'a2', question_id: 900, is_correct: true },
        { attempt_id: 'a3', question_id: 900, is_correct: true },
      ],
    });
    const r = await gradeLevelForUser(fakeSupabase(t), { userId: USER, levelId: LEVEL });
    expect(r.counts.formativeCorrect).toBe(1);          // not 3
    expect(r.components.formative.pct).toBe(25);        // 1 of 4
  });

  test('a CRQ re-take keeps the BEST mark, not the sum', async () => {
    const t = baseTables({
      training_questions: [
        ...baseTables().training_questions,
        { id: 5000, grand_quiz_id: 100, is_active: true, order_index: 901 },
      ],
      training_assessment_attempts: [
        { id: 'e1', user_id: USER, quiz_kind: 'grand', grand_quiz_id: 100, total_questions: 3, total_score: 12 },
        { id: 'e2', user_id: USER, quiz_kind: 'grand', grand_quiz_id: 100, total_questions: 3, total_score: 12 },
      ],
      training_assessment_answers: [
        { attempt_id: 'e1', question_id: 5000, answer_score: 4 },
        { attempt_id: 'e2', question_id: 5000, answer_score: 7 },
      ],
    });
    const r = await gradeLevelForUser(fakeSupabase(t), { userId: USER, levelId: LEVEL });
    expect(r.counts.crqEarned).toBe(7);   // best, not 11
  });

  test('names every component that is short, so the teacher can be told', async () => {
    const t = baseTables();   // nothing attempted at all
    const r = await gradeLevelForUser(fakeSupabase(t), { userId: USER, levelId: LEVEL });
    expect(r.is_passed).toBe(false);
    expect(r.failed_components.sort()).toEqual(['crq', 'formative', 'mcq']);
    expect(r.components.formative.bar).toBe(50);
    expect(r.components.mcq.bar).toBe(60);
    expect(r.components.crq.bar).toBe(50);
  });

  test('an unsat module still counts against the denominator', async () => {
    // Perfect on the one module she sat; the other 8 remain outstanding.
    const t = baseTables({
      training_questions: [
        ...baseTables().training_questions,
        { id: 6001, grand_quiz_id: 100, is_active: true, order_index: 1 },
        { id: 6002, grand_quiz_id: 100, is_active: true, order_index: 2 },
      ],
      training_assessment_attempts: [
        { id: 'e1', user_id: USER, quiz_kind: 'grand', grand_quiz_id: 100, total_questions: 3, total_score: 12 },
      ],
      training_assessment_answers: [
        { attempt_id: 'e1', question_id: 6001, is_correct: true },
        { attempt_id: 'e1', question_id: 6002, is_correct: true },
      ],
    });
    const r = await gradeLevelForUser(fakeSupabase(t), { userId: USER, levelId: LEVEL });
    expect(r.counts.mcqCorrect).toBe(2);
    expect(r.counts.mcqItemCount).toBe(18);
    expect(r.components.mcq.passed).toBe(false);   // 2/18 = 11%, bar 60
  });
});
