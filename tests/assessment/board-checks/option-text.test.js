'use strict';
const T = require('../../../bot/shared/services/assessment/board-checks/option-text');

test('fold: Arabic marks, ي ى ك, case, whitespace', () => {
  expect(T.fold('  Ab  C ')).toBe('ab c');
  expect(T.fold('كيا')).toBe('کیا');
  expect(T.fold('پَانچ')).toBe('پانچ');
});

test('labelOf / stripLabel: latin and urdu labels', () => {
  expect(T.labelOf('A) 6')).toBe(0);
  expect(T.labelOf('(c) x')).toBe(2);
  expect(T.labelOf('الف) پانچ')).toBe(0);
  expect(T.labelOf('د) x')).toBe(3);
  expect(T.labelOf('Apples')).toBe(-1);
  expect(T.stripLabel('B) 12')).toBe('12');
  expect(T.stripLabel('12')).toBe('12');
  expect(T.stripLabel('ب) 12')).toBe('12');
});

test('keyIndex: letter, option text, urdu letter, unresolved', () => {
  const o = ['A) 6', 'B) 12', 'C) 18', 'D) 24'];
  expect(T.keyIndex({ options: o, answer: 'B' })).toBe(1);
  expect(T.keyIndex({ options: o, answer: 'C) 18' })).toBe(2);
  expect(T.keyIndex({ options: o, answer: '24' })).toBe(3);
  expect(T.keyIndex({ options: o, answer: 'the answer is 99' })).toBe(-1);
  expect(T.keyIndex({ options: o, answer: 'A natural number' })).toBe(-1);
  expect(T.keyIndex({ options: ['الف) ا', 'ب) ب', 'ج) ج', 'د) د'], answer: 'ج' })).toBe(2);
  expect(T.keyIndex({ options: o, answer: 'E' })).toBe(-1);
  expect(T.keyIndex({ options: ['A) 1', 'B) 12', 'C) 3', 'D) 4'], answer: 'it is 12' })).toBe(1);
});

test('parseNumber: ints, decimals, fractions, units, thousands commas', () => {
  expect(T.parseNumber('12')).toBe(12);
  expect(T.parseNumber('3.5 cm')).toBe(3.5);
  expect(T.parseNumber('3/4')).toBe(0.75);
  expect(T.parseNumber('1,200 m')).toBe(1200);
  expect(T.parseNumber('-3')).toBe(-3);
  expect(T.parseNumber('Rs 1,80')).toBeNull();
  expect(T.parseNumber('apples')).toBeNull();
  expect(T.parseNumber('1/0')).toBeNull();
});
