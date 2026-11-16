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

describe('bd-snkn32.12 — a v9/v10 day starts from its whole document, not the quiz digest', () => {
  const { EN } = require('./fixtures/k5-own-v10-html');
  const { missingGrr } = require('../../bot/shared/services/lp-k5-own');
  const DIGEST = { meta: { source: 'v9_html' }, goal: 'g', iDo: { keyFact: 'k', worked: null }, youDo: { problems: [] }, wrap: { exitOptions: [] } };
  const v9 = (over = {}) => src({
    resolveSlideScript: jest.fn(async () => ({ slideScript: DIGEST, verified: 'v9_html', sourceUrl: 'lp/v9/html/grade_3_math_ch1_seg1/abc.html' })),
    readHtml: jest.fn(async () => EN),
    ...over,
  });

  it('reads the stored HTML of that exact version and returns every gradual-release part', async () => {
    const { s, deps } = v9();
    const day = await s.loadK5('grade_3_math_ch1_seg1');
    expect(deps.readHtml).toHaveBeenCalledWith('lp/v9/html/grade_3_math_ch1_seg1/abc.html');
    expect(missingGrr(day.script)).toEqual([]);
    expect(day.script.meta.lessonId).toBe('grade_3_math_ch1_seg1');
  });

  it('the request check stays cheap: k5Lesson never downloads the document', async () => {
    const { s, deps } = v9();
    expect(await s.k5Lesson('grade_3_math_ch1_seg1')).toEqual(expect.objectContaining({ lessonId: 'grade_3_math_ch1_seg1' }));
    expect(deps.readHtml).not.toHaveBeenCalled();
  });

  it('a v9 row with no stored document has nothing to start from; a v8 script is used as stored', async () => {
    expect(await v9({ resolveSlideScript: async () => ({ slideScript: DIGEST, verified: 'v9_html', sourceUrl: null }) }).s.loadK5('grade_3_math_ch1_seg1')).toBeNull();
    const { s, deps } = src({ readHtml: jest.fn() });
    expect((await s.loadK5('grade_3_math_ch1_seg1')).script).toBe(SCRIPT);
    expect(deps.readHtml).not.toHaveBeenCalled();
  });
});
