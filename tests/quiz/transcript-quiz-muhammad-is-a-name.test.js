'use strict';
/**
 * Muhammad Ali Jinnah is not a mention of the Prophet.
 *
 * `PROPHET_TOKENS` carried the bare word «محمد», so every mention of anyone
 * named Muhammad demanded ﷺ. On production 2026-09-07 an Urdu lesson called
 * «قائد اعظم محمد علی جناح اور اردو گرامر» — Quaid-e-Azam Muhammad Ali Jinnah,
 * the founder of Pakistan, in the national curriculum — could not produce a
 * quiz: three attempts, a teacher-fields repair and two rewrites, and every
 * question about Jinnah was rejected as "prophet mention without ﷺ".
 *
 * "Muhammad" is the most common given name in Pakistan. Left as it was, this
 * rule quietly removes Pakistan Studies, history, civics and any lesson about
 * Iqbal, Jinnah or a child in the class from the product.
 *
 * The rule itself is right and stays BLOCKING — unlike the gender rules, an
 * unhonorified mention of the Prophet is not something to ship and fix later.
 * What changes is what counts as a mention: the religious titles, and «محمد»
 * only when it is the Prophet's name in a religious construction — «حضرت محمد»,
 * «نبی محمد» — never a bare given name inside somebody else's full name.
 */
const R = require('../../bot/shared/services/quiz/religious-marks.js');


describe('a person named Muhammad', () => {
  test.each([
    ['Quaid-e-Azam, the production case', 'قائد اعظم محمد علی جناح کا پورا نام کیا تھا؟'],
    ['Quaid-e-Azam founding Pakistan', 'قائد اعظم محمد علی جناح نے پاکستان کب بنایا؟'],
    ['Allama Iqbal', 'علامہ محمد اقبال نے کون سی نظم لکھی؟'],
    ['a child in the class', 'محمد عمر کے پاس 5 کتابیں ہیں۔ کتنی بچیں؟'],
  ])('%s needs no honorific', (_label, text) => {
    expect(R.checkReligiousMarks(text).filter((e) => /prophet mention without/.test(e))).toEqual([]);
  });
});

describe('the Prophet still requires ﷺ', () => {
  test.each([
    ['حضرت محمد', 'حضرت محمد نے مدینہ ہجرت کی۔'],
    ['نبی کریم', 'نبی کریم کس شہر میں پیدا ہوئے؟'],
    ['رسول اللہ', 'رسول اللہ نے کیا فرمایا؟'],
    ['حضور', 'حضور کی عمر کیا تھی؟'],
  ])('%s without the honorific is still a defect', (_label, text) => {
    expect(R.checkReligiousMarks(text).filter((e) => /prophet mention without/.test(e)).length).toBeGreaterThan(0);
  });
  test.each([
    ['حضرت محمد ﷺ', 'حضرت محمد ﷺ نے مدینہ ہجرت کی۔'],
    ['نبی کریم ﷺ', 'نبی کریم ﷺ کس شہر میں پیدا ہوئے؟'],
  ])('%s with the honorific passes', (_label, text) => {
    expect(R.checkReligiousMarks(text).filter((e) => /prophet mention without/.test(e))).toEqual([]);
  });
});

describe('the two together, in one sentence', () => {
  test('Jinnah is left alone while the Prophet is still checked', () => {
    const t = 'قائد اعظم محمد علی جناح نے کہا کہ حضرت محمد کی تعلیمات ہماری رہنما ہیں۔';
    const hits = R.checkReligiousMarks(t).filter((e) => /prophet mention without/.test(e));
    expect(hits.length).toBe(1);
    expect(JSON.stringify(hits)).toMatch(/حضرت محمد/);
  });
});
