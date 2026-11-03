'use strict';
const { useWordFix, useWordShortfall } = require('../../bot/shared/services/assessment/fde-urdu-use-word');

const item = (word, answer, accept) => ({ slot: 'g1.urdu.B.Q9', question: word, answer, scheme: { points: [], accept, common_error: 'x', checked: null } });
const paper = (items) => ({ unseen: { subjective: { 'Make Sentences': items } }, _layout: { sections: [{ slots: [{ slot: 'g1.urdu.B.Q9', type: 'Make Sentences' }] }] } });
const accept = (r, i = 0) => r.examJson.unseen.subjective['Make Sentences'][i].scheme.accept;

describe('useWordFix: every model or alternate sentence holds the asked word', () => {
  test('the garbled accept clause is split: the head lacks the word and is dropped, the clause reads cleanly', () => {
    const p = paper([item('خوشی', 'مجھے عید کی بہت خوشی ہے۔', ['امی کو دیکھ کر میں خوش ہوا، لیکن لفظ «خوشی» کے ساتھ ہر درست جملہ'])]);
    const r = useWordFix(p);
    expect(accept(r)).toEqual(['لفظ «خوشی» کے ساتھ کوئی بھی درست جملہ قبول ہے۔']);
    expect(JSON.stringify(accept(r))).not.toContain('خوش ہوا');
  });
  test('an alternate that holds the word is kept', () => {
    const p = paper([item('پھول', 'باغ میں سرخ پھول ہے۔', ['پھول خوشبو دیتا ہے۔'])]);
    expect(useWordFix(p).examJson).toEqual(p);
  });
  test('an alternate without the word is dropped', () => {
    const p = paper([item('دوست', 'میرا دوست اچھا ہے۔', ['میرا ساتھی اچھا ہے۔', 'دوست آیا۔'])]);
    expect(accept(useWordFix(p))).toEqual(['دوست آیا۔']);
  });
  test('a head that holds the word keeps it and the clause is cleaned', () => {
    const p = paper([item('خوشی', 'x خوشی', ['مجھے خوشی ہوئی، لیکن لفظ «خوشی» کے ساتھ ہر درست جملہ'])]);
    expect(accept(useWordFix(p))).toEqual(['مجھے خوشی ہوئی۔', 'لفظ «خوشی» کے ساتھ کوئی بھی درست جملہ قبول ہے۔']);
  });
  test('only Make Sentences slots are touched', () => {
    const p = paper([item('خوشی', 'ابو آئے۔', ['کوئی اور'])]);
    p._layout.sections[0].slots[0].type = 'Verbs';
    expect(useWordFix(p).examJson).toEqual(p);
  });
  test('a model answer without the word is flagged', () => {
    const s = useWordShortfall(paper([item('خوشی', 'امی خوش ہوئیں۔', [])]), { sections: [{ slots: [{ slot: 'g1.urdu.B.Q9', type: 'Make Sentences' }] }] });
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ slot: 'g1.urdu.B.Q9', reason: 'answer' });
  });
});

describe('only an item that is the bare asked word is checked', () => {
  test('a multi-word stem is not flagged and its accept is untouched', () => {
    const P = { sections: [{ slots: [{ slot: 'g1.urdu.B.Q9', type: 'Make Sentences' }] }] };
    const p = paper([item('اس لفظ سے جملہ', 'ایک جملہ۔', ['دوسرا جملہ۔'])]);
    expect(useWordShortfall(p, P)).toEqual([]);
    expect(useWordFix(p).examJson).toEqual(p);
  });
});
