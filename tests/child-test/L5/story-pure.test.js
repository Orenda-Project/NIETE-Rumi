'use strict';
const { capAttempted } = require('../../../bot/shared/services/child-test/scoring/story');
const { reconcileWindows } = require('../../../bot/shared/services/child-test/scoring/windows');

describe('story: attempted is capped by what the child actually said', () => {
  test('a non-reader who said 5 words cannot have attempted 60', () => {
    const v = capAttempted(new Array(60).fill('wrong'), 5);
    expect(v.filter((x) => x !== 'skipped')).toHaveLength(7);   // 5 spoken + 2 slack
    expect(v.slice(7).every((x) => x === 'skipped')).toBe(true);
  });
  test('a reader is untouched', () => {
    const v = ['correct', 'wrong', 'correct', 'skipped'];
    expect(capAttempted(v, 40)).toEqual(v);
  });
});

describe('windows: reconcile after the labeller fills gaps', () => {
  test('a timed window ends where the next section starts; an untimed one runs to the next section or the end', () => {
    const w = reconcileWindows('english', { story: { start: 1, end: 34.5 }, nonwords: { start: 27, end: 35, source: 'labeller' } }, 40);
    expect(w.story.end).toBe(27);
    expect(w.nonwords.end).toBe(40);
    const u = reconcileWindows('urdu', { story: { start: 1, end: 61 }, questions: { start: 67, end: 92, source: 'labeller' } }, 96);
    expect(u.questions.end).toBe(96);
  });
});
