'use strict';
/**
 * buildLessonItems(…, lead): page 1 keeps `lead` rows free for a row the endpoint puts first (Make my own),
 * and the More row carries the lead back so page 2 starts where page 1 stopped. lead 0 is today, byte for byte.
 */
const V8 = require('../../shared/services/lp-v8-catalog.service');

const CATALOG = {
  catalog_version: 'v8',
  books: [{
    stem: 'grade_1_maths', grade: 1, subject: 'Maths', subject_key: 'math', rtl: false,
    chapters: [{
      number: 3, title: 'Three', title_short: 'Three',
      lessons: Array.from({ length: 24 }, (_, k) => ({
        lesson_id: `g1_m_ch3_s${k + 1}`, row: { title: `L${k + 1}`, description: 'd', metadata: 'm' },
      })),
    }],
  }],
};
const AVAIL = new Set(CATALOG.books[0].chapters[0].lessons.map((l) => l.lesson_id));
const ids = (items) => items.map((i) => i.id);

beforeAll(() => V8.__setCatalogForTests(CATALOG));
afterAll(() => V8.__setCatalogForTests(null));

test('lead 0 is exactly today', () => {
  for (const page of [1, 2]) {
    expect(V8.buildLessonItems(1, 'math', 3, AVAIL, new Set(), page, undefined, 0))
      .toEqual(V8.buildLessonItems(1, 'math', 3, AVAIL, new Set(), page));
  }
});

test('lead 1: page 1 is 18 lessons + More, and More carries lead', () => {
  const { items } = V8.buildLessonItems(1, 'math', 3, AVAIL, new Set(), 1, undefined, 1);
  expect(items).toHaveLength(19);
  expect(items[18]['on-click-action'].payload).toEqual({
    step: 'lesson_page', page: '2', grade: '1', subject: 'math', chapter: '3', lead: '1',
  });
  expect(items[18]['main-content'].metadata).toContain('6');
});

test('lead 1: page 2 picks up at lesson 19 and holds the last 6', () => {
  const { items, hasMore } = V8.buildLessonItems(1, 'math', 3, AVAIL, new Set(), 2, undefined, 1);
  expect(hasMore).toBe(false);
  expect(ids(items)).toEqual(Array.from({ length: 6 }, (_, k) => `V8-g1_m_ch3_s${k + 19}`));
});

test('lead 1 on a 19-lesson chapter: 19 fit beside the row, no More', () => {
  const small = new Set([...AVAIL].slice(0, 19));
  const { items, hasMore } = V8.buildLessonItems(1, 'math', 3, small, new Set(), 1, undefined, 1);
  expect(hasMore).toBe(false);
  expect(items).toHaveLength(19);
});
