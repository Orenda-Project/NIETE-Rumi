'use strict';
/** checkPages: topic pages vs the chapter's book page range (textbook_toc). Pure; real audit cases from 20 Oct. */
const { checkPages } = require('../../../bot/shared/services/assessment/topics/page-check');

const topic = (o) => ({ topicId: 't', grade: 5, subject: 'urdu', chapterNumber: 14, name: 'n', pages: [], ...o });
const range = (o) => ({ grade: 5, subject: 'urdu', chapter_number: 14, page_start: 138, page_end: 140, ...o });
const check = (t, r) => checkPages([topic(t)], r === null ? [] : [range(r)]);

test('G5 urdu ch14 topic [130] against book 138-140 is wholly outside', () => {
  const res = check({ topicId: 'a', pages: [130] }, {});
  expect(res.outside).toEqual([{
    topicId: 'a', grade: 5, subject: 'urdu', chapterNumber: 14, name: 'n', pages: [130],
    pageStart: 138, pageEnd: 140, stray: [130],
  }]);
  expect(res.spill).toEqual([]);
  expect(res.noRange).toEqual([]);
});

test('G2 english ch7 topic [83..86] against 85-95 spills, stray = 83,84', () => {
  const res = check({ grade: 2, subject: 'english', chapterNumber: 7, pages: [83, 84, 85, 86] },
    { grade: 2, subject: 'english', chapter_number: 7, page_start: 85, page_end: 95 });
  expect(res.outside).toEqual([]);
  expect(res.spill).toHaveLength(1);
  expect(res.spill[0].stray).toEqual([83, 84]);
  expect(res.spill[0].pageStart).toBe(85);
  expect(res.spill[0].pageEnd).toBe(95);
});

test('G4 science ch4 [77..83,85,87] against 67-84 spills, stray = 85,87', () => {
  const res = check({ grade: 4, subject: 'science', chapterNumber: 4, pages: [77, 78, 79, 80, 81, 82, 83, 85, 87] },
    { grade: 4, subject: 'science', chapter_number: 4, page_start: 67, page_end: 84 });
  expect(res.spill[0].stray).toEqual([85, 87]);
});

test('bounds are inclusive at both edges', () => {
  const res = check({ pages: [138, 140] }, {});
  expect(res.outside).toEqual([]);
  expect(res.spill).toEqual([]);
});

test('one page just past either edge is stray', () => {
  expect(check({ pages: [137, 138] }, {}).spill[0].stray).toEqual([137]);
  expect(check({ pages: [140, 141] }, {}).spill[0].stray).toEqual([141]);
  expect(check({ pages: [141] }, {}).outside).toHaveLength(1);
  expect(check({ pages: [137] }, {}).outside).toHaveLength(1);
});

test('all pages inside is in neither list', () => {
  const res = check({ pages: [139] }, {});
  expect(res).toEqual({ outside: [], spill: [], noRange: [] });
});

test('a topic with no pages (or null pages) is neither', () => {
  expect(check({ pages: [] }, {})).toEqual({ outside: [], spill: [], noRange: [] });
  expect(check({ pages: null }, {})).toEqual({ outside: [], spill: [], noRange: [] });
  expect(check({ pages: undefined }, {})).toEqual({ outside: [], spill: [], noRange: [] });
});

test('noRange lists distinct G<grade> <subject> ch<n> keys when no row matches', () => {
  const res = checkPages([
    topic({ topicId: 'a', pages: [1] }), topic({ topicId: 'b', pages: [2] }),
    topic({ topicId: 'c', grade: 3, subject: 'maths', chapterNumber: 2, pages: [5] }),
  ], []);
  expect(res.noRange).toEqual(['G5 urdu ch14', 'G3 maths ch2']);
  expect(res.outside).toEqual([]);
});

test('a range row with null page_start or page_end counts as no range', () => {
  expect(check({ pages: [1] }, { page_start: null }).noRange).toEqual(['G5 urdu ch14']);
  expect(check({ pages: [1] }, { page_end: null }).noRange).toEqual(['G5 urdu ch14']);
  expect(check({ pages: [1] }, { page_start: undefined }).noRange).toEqual(['G5 urdu ch14']);
});

test('ranges match on grade, subject and chapter together', () => {
  const rows = [
    range({ grade: 4 }), range({ subject: 'maths' }), range({ chapter_number: 15 }),
  ];
  expect(checkPages([topic({ pages: [139] })], rows).noRange).toEqual(['G5 urdu ch14']);
});

test('a chapter with topics but no range row is in noRange even if its topics carry no pages', () => {
  expect(checkPages([topic({ pages: [] })], []).noRange).toEqual(['G5 urdu ch14']);
});

test('a range with page_start 0 is a real range', () => {
  const res = check({ pages: [0] }, { page_start: 0, page_end: 2 });
  expect(res).toEqual({ outside: [], spill: [], noRange: [] });
});

// G5 Urdu repeats printed pages 130-137 (page truth, pdf 141-150). The matrix carries printed numbers; textbook_toc
// carries the DB's sequential keys. The repeat list stops the real printed pages being flagged.
const { REPEATED_PRINTED_PAGES } = require('../../../bot/shared/services/assessment/topics/page-check');
const g5ur = (chapterNumber, pages, page_start, page_end) => checkPages(
  [topic({ chapterNumber, pages })], [range({ chapter_number: chapterNumber, page_start, page_end })], REPEATED_PRINTED_PAGES);

test('G5 urdu ch14-16 printed pages from the page truth are not flagged against the DB ranges', () => {
  for (const res of [g5ur(14, [130], 138, 140), g5ur(14, [138, 139], 138, 140), g5ur(15, [131], 141, 143),
    g5ur(15, [132, 133], 141, 143), g5ur(16, [134, 135, 136, 137], 144, 146)]) {
    expect(res).toEqual({ outside: [], spill: [], noRange: [] });
  }
});

test('a page in neither the range nor the repeat list is still flagged', () => {
  expect(g5ur(15, [129], 141, 143).outside).toHaveLength(1);
  expect(g5ur(14, [130, 131], 138, 140).spill[0].stray).toEqual([131]);
});

test('without the repeat list the old behaviour holds', () => {
  expect(check({ pages: [130] }, {}).outside).toHaveLength(1);
});
