'use strict';
const { quotedWordFix, quotedWordShortfall } = require('../../bot/shared/services/assessment/fde-urdu-quoted-word');

const mcq = (word) => ({ slot: 'g2.urdu.A.Q1', question: `لفظ «${word}» کا مطلب کون سا ہے؟`, options: ['الف) کسی جگہ رہنا', 'ب) تیز دوڑنا'], answer: 'الف) کسی جگہ رہنا' });
const paper = (item) => ({ unseen: { objective: { MCQs: [item] } }, _layout: { sections: [] } });
const first = (r) => r.examJson.unseen.objective.MCQs[0];
const BOOK = 'پرندے اپنے بسیرا کی طرف لوٹ آئے۔ سورج ڈوب گیا۔';

describe('quotedWordFix: a quoted word is spelled as in the source pages', () => {
  test('letters reordered: the source spelling goes into the stem', () => {
    const r = quotedWordFix(paper(mcq('بیسرا')), BOOK);
    expect(first(r).question).toBe('لفظ «بسیرا» کا مطلب کون سا ہے؟');
    expect(r.notes.join(' ')).toMatch(/بسیرا/);
  });
  test('one edit away: the source spelling is used', () => {
    const r = quotedWordFix(paper(mcq('بسیر')), BOOK);
    expect(first(r).question).toContain('«بسیرا»');
  });
  test('a word already in the source is untouched', () => {
    const p = paper(mcq('بسیرا'));
    expect(quotedWordFix(p, BOOK).examJson).toEqual(p);
  });
  test('no source text: nothing changes and nothing is flagged', () => {
    const p = paper(mcq('بیسرا'));
    expect(quotedWordFix(p, '').examJson).toEqual(p);
    expect(quotedWordShortfall(p, {}, '')).toEqual([]);
  });
  test('no close source word: left, and flagged for a re-ask', () => {
    const p = paper(mcq('چاندنی'));
    expect(quotedWordFix(p, BOOK).examJson).toEqual(p);
    const s = quotedWordShortfall(p, {}, BOOK);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ slot: 'g2.urdu.A.Q1', reason: 'answer' });
    expect(s[0].items[0]).toContain('چاندنی');
  });
  test('two close source words: not guessed, flagged', () => {
    const p = paper(mcq('بیسرا'));
    const book = 'بسیرا اور سبیرا لکھا ہے';
    expect(quotedWordFix(p, book).examJson).toEqual(p);
    expect(quotedWordShortfall(p, {}, book)).toHaveLength(1);
  });
  test('the word also in an option is corrected there too', () => {
    const item = { ...mcq('بیسرا'), options: ['الف) بیسرا', 'ب) تیز'] };
    expect(first(quotedWordFix(paper(item), BOOK)).options[0]).toBe('الف) بسیرا');
  });
});
