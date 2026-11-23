'use strict';
// bd-97daxo.34: the read-only GB quiz readiness count counts GB grade 1-5 lessons only, and their quizzes.
const { summarise } = require('../../bot/scripts/quiz/gb-quiz-readiness');

test('GB grade 1-5 deliveries and their quizzes, never ICT or GB 6-12', () => {
  const s = summarise({
    segments: [
      { segment_id: 'gb1', grade: 3, curriculum: 'nbf_snc' },
      { segment_id: 'gb9', grade: 9, curriculum: 'nbf_snc' },
      { segment_id: 'ict', grade: 3, curriculum: 'ict' },
    ],
    deliveries: [
      { user_id: 'a', segment_id: 'gb1', lang: 'en', template_version: 'gb_k5_v10' },
      { user_id: 'b', segment_id: 'gb1', lang: 'en', template_version: 'gb_k5_v10' },
      { user_id: 'a', segment_id: 'gb9', lang: 'en', template_version: 'v9.6' },
      { user_id: 'c', segment_id: 'ict', lang: 'en', template_version: 'v9.6' },
    ],
    quizzes: [
      { teacher_id: 'a', status: 'failed', meta: { failure_reason: 'source_missing', lessons: [{ segment_id: 'gb1' }] } },
      { teacher_id: 'c', status: 'ready', meta: { lessons: [{ segment_id: 'ict' }] } },
    ],
  });
  expect(s).toEqual(expect.objectContaining({
    gbK5Deliveries: 2, gbK5Teachers: 2, byTemplateVersion: { gb_k5_v10: 2 },
    gbK5Quizzes: 1, gbK5QuizTeachers: 1, quizOutcomes: { 'failed/source_missing': 1 },
  }));
  expect(s.distinctLessons).toHaveLength(1);
});
