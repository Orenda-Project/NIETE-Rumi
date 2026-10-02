/**
 * The check form uses L5's real calibration when it is on the branch (scoring/thresholds.js):
 * a field whose bar is NEVER arrives empty however confident the model says it is.
 * No pinned bars here — this is the production path.
 */
const Bars = require('../../../bot/shared/services/child-test/check-flow/bars');
const T = require('../../../bot/shared/services/child-test/scoring/thresholds');

describe('real scoring thresholds decide what is pre-filled', () => {
  test('the Urdu story count is never pre-filled (bar NEVER), even at confidence 0.99', () => {
    expect(T.barFor('story.words_correct', 'urdu')).toBeGreaterThan(1);
    expect(Bars.confident('story.words_correct', 0.99, { lang: 'urdu' })).toBe(false);
  });
  test('the English story count is pre-filled at or above its bar', () => {
    const bar = T.barFor('story.words_correct', 'english');
    expect(bar).toBeLessThanOrEqual(1);
    expect(Bars.confident('story.words_correct', bar, { lang: 'english' })).toBe(true);
    expect(Bars.confident('story.words_correct', bar - 0.01, { lang: 'english' })).toBe(false);
  });
  test('a hint-only mark (first sounds) is never pre-filled', () => {
    expect(Bars.confident('first_sounds', 0.99, { lang: 'urdu', hintOnly: true })).toBe(false);
  });
});
