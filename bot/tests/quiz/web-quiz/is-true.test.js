'use strict';
/**
 * The quiz services' one switch reader (bot/shared/services/quiz/is-true.js): JSON `true` is on; every other shape is off.
 */
const { isTrue } = require('../../../shared/services/quiz/is-true');

describe('isTrue (one reader for every quiz switch)', () => {
  test('JSON true → on', () => expect(isTrue(true)).toBe(true));
  test.each([
    ['the string \'true\'', 'true'], ['the JSON string \'"true"\'', '"true"'], ['\' TRUE \'', ' TRUE '], ['\'yes\'', 'yes'],
    ['\'on\'', 'on'], ['\'1\'', '1'], ['1', 1], ['{ enabled: true }', { enabled: true }], ['[true]', [true]],
    ['false', false], ['\'false\'', 'false'], ['0', 0], ['null', null], ['undefined', undefined], ['\'\'', ''],
  ])('%s → off', (_, v) => expect(isTrue(v)).toBe(false));
});
