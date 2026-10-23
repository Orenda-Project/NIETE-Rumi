'use strict';
/** Task 3 fix round 1 — a teacher never sees two tick boxes with the same name in one chapter. */
const { parseMatrixTab } = require('../../../bot/shared/services/assessment/topics/matrix-rows');
const { groupAll } = require('../../../bot/shared/services/assessment/topics/group');
const sample = require('./fixtures/matrix-sample.json');

const tabs = [['english', 'english'], ['urdu', 'urdu'], ['maths', 'maths'], ['maths_g1_ch3', 'maths'], ['science', 'science']];

describe.each(tabs)('real %s rows', (key, subject) => {
  test('no chapter has two topics with the same name', () => {
    const seen = new Set();
    for (const t of groupAll(subject, parseMatrixTab(sample[key], subject))) {
      const k = `${t.grade}/${t.chapterNumber}/${t.name}`;
      expect(seen.has(k)).toBe(false);
      seen.add(k);
    }
  });
});
