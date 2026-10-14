'use strict';
/**
 * v10 coaching test (bd-v0toag.55): why the thing to try matters, one line per high-leverage practice,
 * so a teacher who swaps the move knows what it is for (Amena, 14 Oct).
 */
const { practiceWhy, WHY } = require('../../bot/shared/services/coaching/practice-why');
const { PRACTICES } = require('../../bot/shared/services/coaching/practice-tag');

test('every practice the tag can return has a why line in English and Urdu', () => {
  expect(Object.keys(WHY).sort()).toEqual(Object.keys(PRACTICES).sort());
  for (const tag of Object.keys(PRACTICES)) {
    expect(practiceWhy(tag, 'en')).toMatch(/\w{3}/);
    expect(practiceWhy(tag, 'ur')).toMatch(/[؀-ۿ]{3}/);
  }
});

test('the lines differ by practice', () => {
  const en = Object.keys(PRACTICES).map((t) => practiceWhy(t, 'en'));
  expect(new Set(en).size).toBe(en.length);
});

test('unknown language is English; unknown or missing tag is null', () => {
  expect(practiceWhy('C9', 'sw')).toBe(practiceWhy('C9', 'en'));
  expect(practiceWhy('C2', 'en')).toBeNull();
  expect(practiceWhy(null, 'ur')).toBeNull();
});
