'use strict';
const { earlyUrduFixes } = require('../../bot/shared/services/assessment/fde-early-urdu-fixes');
const { keyShortfall } = require('../../bot/shared/services/assessment/fde-key-checks');

const P = { sections: [{ slots: [
  { slot: 'g2.urdu.A.Q1', type: 'MCQs' },
  { slot: 'g2.urdu.A.Q3', type: 'Complete the Sentences' },
  { slot: 'g1.urdu.B.Q9', type: 'Make Sentences' },
] }] };
const BOOK = 'پرندے اپنے بسیرا کی طرف لوٹ آئے۔';
const exam = () => ({
  _layout: P,
  unseen: { x: {
    MCQs: [{ slot: 'g2.urdu.A.Q1', question: 'لفظ «بیسرا» کا مطلب کون سا ہے؟', options: ['الف) رہنا', 'ب) دوڑنا'], answer: 'الف) رہنا' }],
    'Complete the Sentences': [
      { slot: 'g2.urdu.A.Q3', question: 'a ___', answer: 'مجسمہ', words: ['مجسمہ', 'کلیاں'] },
      { slot: 'g2.urdu.A.Q3', question: 'b ___', answer: 'فوج' }],
    'Make Sentences': [{ slot: 'g1.urdu.B.Q9', question: 'خوشی', answer: 'مجھے خوشی ہے۔', scheme: { points: [], accept: ['امی خوش ہوئیں۔'], common_error: 'x', checked: null } }],
  } },
});
const by = (r, type) => r.examJson.unseen.x[type];

describe('round 6 early Urdu fixes are wired into earlyUrduFixes', () => {
  test('box key, quoted word and use-word all apply in one pass', () => {
    const r = earlyUrduFixes(exam(), BOOK);
    expect(by(r, 'Complete the Sentences')[0].words).toEqual(['مجسمہ', 'فوج']);
    expect(by(r, 'MCQs')[0].question).toContain('«بسیرا»');
    expect(by(r, 'Make Sentences')[0].scheme.accept).toEqual([]);
  });
  test('without a source text the quoted word is left', () => {
    expect(by(earlyUrduFixes(exam()), 'MCQs')[0].question).toContain('«بیسرا»');
  });
});

describe('round 6 key checks are wired into keyShortfall', () => {
  test('a quoted word the source lacks and a model sentence without the word are flagged', () => {
    const e = exam();
    e.unseen.x.MCQs[0].question = 'لفظ «چاندنی» کا مطلب کون سا ہے؟';
    e.unseen.x['Make Sentences'][0].answer = 'امی خوش ہیں۔';
    const slots = keyShortfall(e, P, BOOK).map((f) => f.slot);
    expect(slots).toContain('g2.urdu.A.Q1');
    expect(slots).toContain('g1.urdu.B.Q9');
  });
});
