/**
 * bd-vej4h — "The trainees' scores should be recorded and available at the end
 * of the training" (I-SAPS); operator 2026-10-01: shown to the TEACHER on the
 * portal (no export). The sheet is built from rows the bot already stores; this
 * is only the arithmetic, so it is pure and tested here.
 */
jest.mock('../../bot/shared/config/supabase', () => ({ from: () => { throw new Error('pure'); } }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({ sendMessage: jest.fn() }));

const { buildIsapsScoreSheet } = require('../../bot/shared/services/training/isaps-score-sheet.rules');
const { unitLocksForCourse } = require('../../bot/shared/routes/teacher-training-endpoint');

const courses = [{ id: 71, title: 'Module 1 - Philosophical Foundations', order_index: 1 }, { id: 72, title: 'Module 2 - Affective Development', order_index: 2 }];
const units = [
  { id: 101, course_id: 71, title: 'Unit 101', order_index: 1 }, { id: 102, course_id: 71, title: 'Unit 102', order_index: 2 },
  { id: 201, course_id: 72, title: 'Unit 201', order_index: 1 },
];
const exams = [{ id: 37, source_quiz_id: 901 }, { id: 38, source_quiz_id: 902 }];

describe('buildIsapsScoreSheet', () => {
  const sheet = buildIsapsScoreSheet({
    courses, units, exams, crqMax: 10,
    crqHeld: false,   // bd-hxm7a — released view; the held view is in isaps-crq-hold.test.js
    unitAttempts: [
      { training_module_id: 101, score: 1, total_questions: 2 },
      { training_module_id: 101, score: 2, total_questions: 2 },   // best counts
      { training_module_id: 102, score: 0, total_questions: 3 },
    ],
    examAttempts: [
      { id: 'a1', grand_quiz_id: 37, is_passed: false, score: 12, total_questions: 5, status: 'failed' },
      { id: 'a2', grand_quiz_id: 37, is_passed: true, score: 21, total_questions: 5, status: 'passed' },
    ],
    examAnswers: [
      { attempt_id: 'a2', question_index: 0, is_correct: true }, { attempt_id: 'a2', question_index: 1, is_correct: true },
      { attempt_id: 'a2', question_index: 2, is_correct: true }, { attempt_id: 'a2', question_index: 3, is_correct: false },
      { attempt_id: 'a2', question_index: 4, answer_score: 6 },
    ],
  });

  test('modules in order, each with its units and best quiz percentage', () => {
    expect(sheet.modules.map(m => m.title)).toEqual(['Module 1 - Philosophical Foundations', 'Module 2 - Affective Development']);
    expect(sheet.modules[0].units).toEqual([
      { id: 101, title: 'Unit 101', best_pct: 100 },
      { id: 102, title: 'Unit 102', best_pct: 0 },
    ]);
    expect(sheet.modules[1].units[0].best_pct).toBeNull();   // never attempted
  });

  test('the exam shows the passed attempt, split into MCQ and written marks', () => {
    expect(sheet.modules[0].exam).toEqual({
      passed: true, pending: false, mcq_correct: 3, mcq_served: 4, mcq_earned: 15, mcq_possible: 20, crq_earned: 6, crq_max: 10,
    });
  });

  test('a module exam never sat is null', () => {
    expect(sheet.modules[1].exam).toBeNull();
  });
});

describe('unitLocksForCourse', () => {
  test('returns each unit of the course with its lock, for the portal list', () => {
    const rows = [
      { id: 101, course_id: 71, lock: 'passed' }, { id: 102, course_id: 71, lock: 'next' },
      { id: 103, course_id: 71, lock: 'locked' }, { id: 201, course_id: 72, lock: 'next' },
    ];
    expect(unitLocksForCourse(rows, 71)).toEqual({ 101: 'passed', 102: 'next', 103: 'locked' });
  });
});
