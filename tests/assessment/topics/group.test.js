'use strict';
/** Task 3 — groupChapter: which rows can be topics, dispatch by subject, stable topic ids. */
const { parseMatrixTab } = require('../../../bot/shared/services/assessment/topics/matrix-rows');
const { groupChapter, groupAll, isTopicRow } = require('../../../bot/shared/services/assessment/topics/group');
const sample = require('./fixtures/matrix-sample.json');

const english = parseMatrixTab(sample.english, 'english');
const science = parseMatrixTab(sample.science, 'science');
const ch1 = english.filter((r) => r.chapter === 1);
const day1 = ch1[0];

describe('isTopicRow', () => {
  test('a content day is a topic row', () => {
    expect(isTopicRow(day1)).toBe(true);
  });

  test.each([
    ['lpType assessment', { lpType: 'assessment' }],
    ['lpType revision', { lpType: 'revision' }],
    ['skill duhrai', { skillType: 'duhrai' }],
    ['skill review_assess', { skillType: 'review_assess' }],
    ['skill revision', { skillType: 'revision' }],
    ['skill assessment', { skillType: 'assessment' }],
    ['segment 995', { seg: 995 }],
    ['segment 990', { seg: 990 }],
  ])('%s is never a topic', (_label, over) => {
    expect(isTopicRow({ ...day1, ...over })).toBe(false);
  });
});

describe('groupChapter', () => {
  test('no rows gives no topics', () => {
    expect(groupChapter('english', [])).toEqual([]);
  });

  test('only non-topic rows gives no topics', () => {
    expect(groupChapter('english', ch1.filter((r) => r.lpType !== 'content'))).toEqual([]);
  });

  test('an unknown subject fails loudly', () => {
    expect(() => groupChapter('history', ch1)).toThrow(/history/);
  });

  test('rows from more than one chapter are refused', () => {
    expect(() => groupChapter('english', english)).toThrow(/one chapter/);
    expect(() => groupChapter('science', science)).toThrow(/one chapter/);
  });

  test('every topic carries grade, subject, chapter number and title', () => {
    const [t] = groupChapter('science', science.filter((r) => r.grade === 5));
    expect(t).toMatchObject({ grade: 5, subject: 'science', chapterNumber: 1, chapterTitle: 'Inside the Human Body' });
    expect(Object.keys(t).sort()).toEqual([
      'chapterNumber', 'chapterTitle', 'days', 'grade', 'heading', 'headingOrder', 'name',
      'pages', 'sloCodes', 'sloDescriptions', 'sortOrder', 'subject', 'topicId',
    ]);
  });

  test('the same rows twice give identical topic ids', () => {
    const a = groupChapter('english', ch1).map((t) => t.topicId);
    const b = groupChapter('english', ch1.map((r) => ({ ...r }))).map((t) => t.topicId);
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(a.length);
  });

  test('two topics with the same slug get -2, -3 in sort order', () => {
    const rows = [1, 2, 3].map((day) => ({ ...day1, day }));
    expect(groupChapter('english', rows).map((t) => t.topicId)).toEqual([
      '1-english-1-vocabulary_grammar-all-about-me-key-words-memory-lane',
      '1-english-1-vocabulary_grammar-all-about-me-key-words-memory-lane-2',
      '1-english-1-vocabulary_grammar-all-about-me-key-words-memory-lane-3',
    ]);
  });

  test('the input rows are not changed', () => {
    const copy = JSON.parse(JSON.stringify(ch1));
    groupChapter('english', ch1);
    expect(ch1).toEqual(copy);
  });
});

describe('groupAll', () => {
  test('splits rows by grade and chapter, in first-appearance order', () => {
    const out = groupAll('science', science);
    expect([...new Set(out.map((t) => `${t.grade}/${t.chapterNumber}`))]).toEqual(['4/1', '4/2', '5/1']);
    expect(out.filter((t) => t.grade === 5).map((t) => t.sortOrder)).toEqual([1, 2, 3]);
  });

  test('English: every chapter grouped', () => {
    expect(groupAll('english', english).map((t) => t.chapterNumber)).toEqual([1, 1, 1, 1, 1, 2]);
  });
});
