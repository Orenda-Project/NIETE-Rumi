'use strict';
const { boxKeyFix } = require('../../bot/shared/services/assessment/fde-early-urdu-boxkeys');

const item = (slot, answer, extra = {}) => ({ slot, question: 'x ___ y', answer, ...extra });
const paper = (items) => ({ unseen: { fill: { 'Complete the Sentences': items } }, _layout: { sections: [] } });

describe('boxKeyFix: every keyed answer of a box-fill slot is in the box', () => {
  const slot = 'g2.urdu.A.Q3';
  const make = () => paper([
    item(slot, 'مجسمہ', { words: ['مجسمہ', 'سفید', 'ٹڈی', 'کلیاں'] }),
    item(slot, 'سفید'), item(slot, 'ٹڈی'), item(slot, 'فوج'),
  ]);

  test('an unused box word is replaced by the missing key answer', () => {
    const r = boxKeyFix(make());
    const first = r.examJson.unseen.fill['Complete the Sentences'][0];
    expect(first.words).toEqual(['مجسمہ', 'سفید', 'ٹڈی', 'فوج']);
    expect(r.notes.join(' ')).toMatch(/فوج/);
  });

  test('a box that already holds every key is unchanged', () => {
    const p = paper([item(slot, 'الف', { words: ['الف', 'ب'] }), item(slot, 'ب')]);
    const r = boxKeyFix(p);
    expect(r.examJson).toEqual(p);
    expect(r.notes).toEqual([]);
  });

  test('with no spare word the missing key is appended', () => {
    const p = paper([item(slot, 'الف', { words: ['الف', 'ب'] }), item(slot, 'ب'), item(slot, 'ج')]);
    expect(boxKeyFix(p).examJson.unseen.fill['Complete the Sentences'][0].words).toEqual(['الف', 'ب', 'ج']);
  });

  test('the input is not mutated', () => {
    const p = make();
    const copy = JSON.parse(JSON.stringify(p));
    boxKeyFix(p);
    expect(p).toEqual(copy);
  });

  test('a slot without a box is left alone', () => {
    const p = paper([item(slot, 'الف'), item(slot, 'ب')]);
    expect(boxKeyFix(p).examJson).toEqual(p);
  });
});
