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
  TRANSCRIPT, LP_V8, LP612, LESSON_SOURCES, PLAN_SOURCES, isLessonQuiz, isPlanQuiz, failureCopyKey, handoffIntroKey, lp612SourceOn,
} = require('../../shared/services/quiz/quiz-sources');

describe('quiz-sources', () => {
  test('the two constants are the values written into quizzes.quiz_source', () => {
    expect(TRANSCRIPT).toBe('transcript');
    // PLAN_R8 D12 — 'lp_v8', never 'lesson_plan' (the column default).
    expect(LP_V8).toBe('lp_v8');
  });

  test('LESSON_SOURCES is exactly the three lesson-born sources', () => {
    // lp612: a quiz written from a Grades 6-12 lesson plan the teacher was served.
    expect(LP612).toBe('lp612');
    expect(LESSON_SOURCES).toEqual(['transcript', 'lp_v8', 'lp612']);
  });

  test('a PLAN quiz is one written from a lesson plan — K-5 or 6-12 — never from a recording', () => {
    expect(PLAN_SOURCES).toEqual(['lp_v8', 'lp612']);
    expect(isPlanQuiz('lp_v8')).toBe(true);
    expect(isPlanQuiz('lp612')).toBe(true);
    expect(isPlanQuiz('transcript')).toBe(false);
    expect(isPlanQuiz('video')).toBe(false);
    expect(isPlanQuiz(undefined)).toBe(false);
    expect(() => PLAN_SOURCES.push('video')).toThrow();
  });

  test('QUIZ_LP612_SOURCE is the 6-12 kill switch: only `on`/`true` is on, read at call time', () => {
    const before = process.env.QUIZ_LP612_SOURCE;
    try {
      delete process.env.QUIZ_LP612_SOURCE; expect(lp612SourceOn()).toBe(false);
      process.env.QUIZ_LP612_SOURCE = 'off'; expect(lp612SourceOn()).toBe(false);
      process.env.QUIZ_LP612_SOURCE = 'ON'; expect(lp612SourceOn()).toBe(true);
      process.env.QUIZ_LP612_SOURCE = 'true'; expect(lp612SourceOn()).toBe(true);
    } finally {
      if (before === undefined) delete process.env.QUIZ_LP612_SOURCE; else process.env.QUIZ_LP612_SOURCE = before;
    }
    // A quiz queued before the switch went off says it could not start — never "the questions did not come out",
    // and never the 15:00 offer's "next lessons" line: only /quiz makes a 6-12 quiz, and it can be tried again later.
    expect(failureCopyKey('source_off', 'lp612')).toBe('lpQuizCouldNotStartLater');
  });

  test('a 6-12 plan quiz gets the lesson-plan copy, never the recording\'s', () => {
    expect(handoffIntroKey('lp612')).toBe('tqHandoffIntroLp');
    expect(failureCopyKey('source_missing', 'lp612')).toBe('tqFailedLpSource');
    expect(failureCopyKey('something_new', 'lp612')).toBe('tqFailedLpAuthor');
  });

  test('isLessonQuiz answers for every source the column actually holds', () => {
    expect(isLessonQuiz('lp_v8')).toBe(true);
    expect(isLessonQuiz('lp612')).toBe(true);
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
    expect(LESSON_SOURCES).toEqual(['transcript', 'lp_v8', 'lp612']);
  });
});
