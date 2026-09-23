'use strict';
/**
 * R8 lane D task 3.1 — ONE name for "a quiz born of a lesson this teacher gave".
 *
 * Until this module existed, `'transcript'` was written as a literal in the list
 * service, the Flow endpoint and the report — four places that each had to be
 * found and changed by hand for a second lesson source. `isLessonQuiz` is the
 * single predicate all four now ask.
 */

const {
  TRANSCRIPT, LP_V8, LESSON_SOURCES, isLessonQuiz,
} = require('../../shared/services/quiz/quiz-sources');

describe('quiz-sources', () => {
  test('the two constants are the values written into quizzes.quiz_source', () => {
    expect(TRANSCRIPT).toBe('transcript');
    // PLAN_R8 D12 — 'lp_v8', never 'lesson_plan' (the column default).
    expect(LP_V8).toBe('lp_v8');
  });

  test('LESSON_SOURCES is exactly the two lesson-born sources', () => {
    expect(LESSON_SOURCES).toEqual(['transcript', 'lp_v8']);
  });

  test('isLessonQuiz answers for every source the column actually holds', () => {
    expect(isLessonQuiz('lp_v8')).toBe(true);
    expect(isLessonQuiz('transcript')).toBe(true);
    // The PK video lane and the in-chat preview share this table and must not
    // be swept into /quiz or given a transcript digest.
    expect(isLessonQuiz('video')).toBe(false);
    expect(isLessonQuiz('in_chat_preview')).toBe(false);
    expect(isLessonQuiz('lesson_plan')).toBe(false);
    expect(isLessonQuiz(null)).toBe(false);
    expect(isLessonQuiz(undefined)).toBe(false);
    expect(isLessonQuiz('')).toBe(false);
  });

  test('LESSON_SOURCES cannot be mutated by a consumer that sorts or pushes it', () => {
    expect(() => LESSON_SOURCES.push('video')).toThrow();
    expect(LESSON_SOURCES).toEqual(['transcript', 'lp_v8']);
  });
});
