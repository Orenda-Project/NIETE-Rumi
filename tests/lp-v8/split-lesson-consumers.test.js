/**
 * bd-es2eg.12 — the two consumers a split lesson's part 2 (`…_seg2b`) touches (TDD, red first).
 *   - parseCorpusLessonId must still read grade + subject from it, or FICO loses the subject.
 *   - listLessons must order part 1 before part 2 on its own, not by sort stability.
 */

jest.mock('../../bot/shared/services/lp-v8-catalog.service', () => ({ chapterFor: jest.fn() }));
jest.mock('../../bot/shared/services/lp-v8-delivery.service', () => ({
  availableLessonIds: jest.fn(async () => new Set(['a_seg2', 'a_seg2b', 'a_seg3'])),
  downloadedLessonIds: jest.fn(async () => new Set()),
}));

const V8Catalog = require('../../bot/shared/services/lp-v8-catalog.service');
const { listLessons } = require('../../bot/shared/services/lp-v8-browse.service');
const { parseCorpusLessonId } = require('../../bot/shared/services/coaching/subject-resolution');

test('parseCorpusLessonId reads a part-2 id', () => {
  expect(parseCorpusLessonId('grade_4_urdu_ch10_seg2b')).toEqual(parseCorpusLessonId('grade_4_urdu_ch10_seg2'));
  expect(parseCorpusLessonId('grade_4_urdu_ch10_seg2b')).not.toBeNull();
  expect(parseCorpusLessonId('grade_4_urdu_ch10_seg2bb')).toBeNull();
});

test('listLessons puts part 1 before part 2 whatever order the chapter holds', async () => {
  V8Catalog.chapterFor.mockReturnValue({
    lessons: [
      { lesson_id: 'a_seg3', segment_index: 3 },
      { lesson_id: 'a_seg2b', segment_index: 2, part: 2 },
      { lesson_id: 'a_seg2', segment_index: 2, part: 1 },
    ],
  });
  const rows = await listLessons(4, 'urdu', 10);
  expect(rows.map((r) => r.lesson_id)).toEqual(['a_seg2', 'a_seg2b', 'a_seg3']);
});
