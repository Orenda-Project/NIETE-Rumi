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
    const c = reconcileWindows('english', { story: { start: 1, end: 34.5 }, nonwords: { start: 27, end: 35 } }, 40);
    expect(c.story.end).toBe(27);
    // a section only the labeller placed does not end the story minute (L24, CR-3)
    const w = reconcileWindows('english', { story: { start: 1, end: 34.5 }, nonwords: { start: 27, end: 35, source: 'labeller' } }, 40);
    expect(w.story.end).toBe(34.5);
    expect(w.nonwords.end).toBe(40);
    const u = reconcileWindows('urdu', { story: { start: 1, end: 61 }, questions: { start: 67, end: 92, source: 'labeller' } }, 96);
    expect(u.questions.end).toBe(96);
  });
});

describe('story: the first-line stop rule decides the letters/words fallback (CONTRACT §9.2)', () => {
  const { needsFallback } = require('../../../bot/shared/services/child-test/scoring/story');
  const spec = { tokens: new Array(30).fill('w'), lines: [{ n: 1, from: 0, to: 10 }, { n: 2, from: 11, to: 22 }] };
  test('fewer than 5 right in line 1 → fallback', () => {
    const part = { words_correct: 4, words_attempted: 11, flagged: [4, 5, 6, 7, 8, 9, 10].map((idx) => ({ idx, verdict: 'wrong' })) };
    expect(needsFallback(part, spec)).toBe(true);
  });
  test('5 or more right in line 1 → no fallback, even when the rest went badly', () => {
    const part = { words_correct: 6, words_attempted: 20, flagged: [6, 7, 8, 9, 10, 11, 12, 13].map((idx) => ({ idx, verdict: 'wrong' })) };
    expect(needsFallback(part, spec)).toBe(false);
  });
  test('without lines, falls back to a total of 2 or fewer', () => {
    expect(needsFallback({ words_correct: 2, words_attempted: 9, flagged: [] }, { tokens: [] })).toBe(true);
    expect(needsFallback({ words_correct: 3, words_attempted: 9, flagged: [] }, { tokens: [] })).toBe(false);
  });
});
