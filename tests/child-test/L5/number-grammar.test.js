'use strict';
const { wordsToNumbers, parseNumberWord } = require('../../../bot/shared/services/child-test/scoring/number-grammar');

const vals = (s) => wordsToNumbers(s.split(/\s+/)).map((n) => n.value);

describe('child-test number grammar', () => {
  test('Urdu 1-100 irregular words', () => {
    expect(vals('سینتالیس')).toEqual([47]);
    expect(vals('انچاس')).toEqual([49]);
    expect(vals('ننانوے')).toEqual([99]);
    expect(vals('اٹھارہ')).toEqual([18]);
    expect(vals('ستر')).toEqual([70]);
    expect(vals('سترہ')).toEqual([17]);
    expect(vals('صفر')).toEqual([0]);
  });

  test('normalises spelling variants (ye/he/kaf, diacritics)', () => {
    expect(parseNumberWord('نوّے').value).toBe(90);
    expect(parseNumberWord('آٹھ').value).toBe(8);
    expect(parseNumberWord('چھ').value).toBe(6);
    expect(parseNumberWord('بائیس').value).toBe(22);
  });

  test('a separate number per word in a sequence of Urdu numbers', () => {
    expect(vals('سات آٹھ بارہ')).toEqual([7, 8, 12]);
  });

  test('hundreds compose in Urdu and English', () => {
    expect(vals('ایک سو سینتالیس')).toEqual([147]);
    expect(vals('دو سو')).toEqual([200]);
    expect(vals('one hundred and forty seven')).toEqual([147]);
  });

  test('English tens + units compose, hyphenated or not', () => {
    expect(vals('forty seven')).toEqual([47]);
    expect(vals('forty-seven')).toEqual([47]);
    expect(vals('seven eight')).toEqual([7, 8]);
    expect(vals('twelve')).toEqual([12]);
  });

  test('English number words written in Urdu script (code-switching)', () => {
    expect(vals('فورٹی سیون')).toEqual([47]);
    expect(vals('ٹوینٹی')).toEqual([20]);
  });

  test('digits in ASCII, Urdu and Arabic-Indic, with punctuation', () => {
    expect(vals('47')).toEqual([47]);
    expect(vals('۴۷')).toEqual([47]);
    expect(vals('٤٧،')).toEqual([47]);
    expect(vals('62.')).toEqual([62]);
  });

  test('non-number words break a number and are ignored', () => {
    expect(vals('جواب سات ہے پھر آٹھ')).toEqual([7, 8]);
  });

  test('keeps the source word index range', () => {
    const out = wordsToNumbers(['جواب', 'ایک', 'سو', 'دس']);
    expect(out).toEqual([{ value: 110, from: 1, to: 3, raw: 'ایک سو دس' }]);
  });
});
