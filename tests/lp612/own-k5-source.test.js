/**
 * bd-snkn32.4 — where a grades 1–5 Make my own starts (lp-k5-own-source): the day's book (its language) and the plan
 * she is served today, by its exact version. Worksheets, revisions and days with no stored plan have nothing to rewrite.
 */
const { createK5Source } = require('../../bot/shared/services/lp-k5-own-source');

const BOOKS = {
  grade_3_urdu_ch1_seg2: { lesson: { lesson_id: 'grade_3_urdu_ch1_seg2', lp_type: 'content' }, book: { grade: 3, subject_key: 'urdu', subject: 'Urdu', language: 'ur' } },
  grade_3_math_ch1_seg1: { lesson: { lesson_id: 'grade_3_math_ch1_seg1', lp_type: 'content' }, book: { grade: 3, subject_key: 'math', subject: 'Math', language: 'en' } },
  grade_3_math_ch1_seg990: { lesson: { lesson_id: 'grade_3_math_ch1_seg990', lp_type: 'assessment' }, book: { grade: 3, subject_key: 'math', subject: 'Math', language: 'en' } },
};
const SCRIPT = { goal: 'x', iDo: { steps: [] } };

function src(over = {}) {
  const deps = {
    lessonById: (id) => BOOKS[id] || null,
    currentAsset: jest.fn(async () => ({ version_stamp: 'v8-1', content_hash: 'h1' })),
    resolveSlideScript: jest.fn(async () => ({ slideScript: SCRIPT })),
    ...over,
  };
  return { s: createK5Source(deps), deps };
}

test('an Urdu book\'s day: Urdu, its grade and subject key, and the script of the CURRENT asset by exact version', async () => {
  const { s, deps } = src();
  expect(await s.loadK5('grade_3_urdu_ch1_seg2')).toEqual({
    lessonId: 'grade_3_urdu_ch1_seg2', lang: 'ur', grade: 3, subject: 'urdu', subjectName: 'Urdu', script: SCRIPT,
  });
  expect(deps.resolveSlideScript).toHaveBeenCalledWith({ lessonId: 'grade_3_urdu_ch1_seg2', versionStamp: 'v8-1', contentHash: 'h1' });
  expect(await s.k5Lesson('grade_3_math_ch1_seg1')).toEqual({ lessonId: 'grade_3_math_ch1_seg1', lang: 'en', grade: 3, subject: 'math', subjectName: 'Math' });
});

test('nothing to rewrite: unknown day, a worksheet, no current asset, no stored script', async () => {
  expect(await src().s.k5Lesson('nope')).toBeNull();
  expect(await src().s.k5Lesson('grade_3_math_ch1_seg990')).toBeNull();
  expect(await src({ currentAsset: async () => null }).s.k5Lesson('grade_3_math_ch1_seg1')).toBeNull();
  expect(await src({ resolveSlideScript: async () => null }).s.k5Lesson('grade_3_math_ch1_seg1')).toBeNull();
});
