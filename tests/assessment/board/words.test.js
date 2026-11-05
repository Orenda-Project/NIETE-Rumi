/**
 * board/words.js: grade words and time phrases shared by the board chrome modules, kept apart so
 * chrome.js and fde-chrome.js share them without a require cycle.
 */
const W = require('../../../bot/shared/services/assessment/patterns/board/words');

test('grade words cover 6-12 only, Grade for 6-7 and Class from 8', () => {
  expect(Object.keys(W.GRADE_WORD)).toEqual(['6', '7', '8', '9', '10', '11', '12']);
  expect(W.GRADE_WORD[7].en).toBe('Grade VII');
  expect(W.GRADE_WORD[8].en).toBe('Class VIII');
  expect(W.GRADE_WORD[5]).toBeUndefined();
  expect(Object.isFrozen(W.GRADE_WORD)).toBe(true);
});

test.each([
  [180, '3 hrs', '3 گھنٹے'],
  [60, '1 hr', '1 گھنٹہ'],
  [80, '1 hr 20 min', '1 گھنٹہ 20 منٹ'],
  [20, '20 min', '20 منٹ'],
])('%i minutes reads %s', (min, en, ur) => {
  expect(W.timeEn(min)).toBe(en);
  expect(W.timeUr(min)).toBe(ur);
});

test('no time gives null in both languages', () => {
  expect(W.timeEn(null)).toBeNull();
  expect(W.timeUr(undefined)).toBeNull();
});

test('loads without the board chrome (no cycle)', () => {
  jest.isolateModules(() => {
    jest.doMock('../../../bot/shared/services/assessment/patterns/board/chrome', () => { throw new Error('chrome loaded'); });
    expect(() => require('../../../bot/shared/services/assessment/patterns/board/words')).not.toThrow();
  });
});
