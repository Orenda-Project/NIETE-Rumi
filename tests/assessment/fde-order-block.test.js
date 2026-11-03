/**
 * A Put-in-Order question re-numbers its steps (bd-5jmnfj.4.46). v21 G1 GK Q8 keyed all three
 * items ۳، ۲، ۱: a child who spots the pattern answers without reading. Each item now gets its
 * own numbering, never already in order, and the key follows it.
 */

const { dealOrders, parseOrder } = require('../../bot/shared/services/assessment/fde-order-block');

const SLOT = 'g1.general_knowledge.B.Q8';
const item = (question, answer) => ({ slot: SLOT, question, answer, scheme: { accept: [answer], points: [] } });
const V21 = [
  item('ہاتھ دھونے کے مراحل کو درست ترتیب دیں: 1) ہاتھ خشک کریں 2) ہاتھوں پر صابن لگائیں 3) پانی سے ہاتھ گیلے کریں', '3، 2، 1'),
  item('سڑک پار کرنے کے مراحل کو درست ترتیب دیں: 1) سڑک پار کریں 2) دائیں بائیں دیکھیں 3) فٹ پاتھ پر رکیں', '3، 2، 1'),
  item('بیج لگانے کے مراحل کو درست ترتیب دیں: 1) پانی دیں 2) بیج مٹی میں ڈالیں 3) زمین میں گڑھا کھودیں', '3، 2، 1'),
];
const paper = (items) => ({
  unseen: { subjective: { 'Put in Order': items, Other: [{ slot: 'x.Q9', question: '1) a 2) b', answer: '2، 1' }] } },
  _layout: { sections: [{ id: 'B', slots: [{ slot: SLOT, type: 'Put in Order' }, { slot: 'x.Q9', type: 'Short' }] }] },
});
// The steps a child must write, first to last, read from an item.
const trueOrder = (q) => {
  const p = parseOrder(q);
  return p.order.map((n) => p.steps[n - 1]);
};

test('each item gets its own key and none is already in order', () => {
  const out = dealOrders(paper(V21)).unseen.subjective['Put in Order'];
  const keys = out.map((q) => q.answer);
  expect(new Set(keys).size).toBe(3);
  keys.forEach((k) => expect(k).not.toBe('1، 2، 3'));
});

test('the steps, the true order and the scheme survive the re-numbering', () => {
  const out = dealOrders(paper(V21)).unseen.subjective['Put in Order'];
  out.forEach((q, i) => {
    expect(trueOrder(q)).toEqual(trueOrder(V21[i]));
    expect(q.question.startsWith(V21[i].question.split(':')[0])).toBe(true);
    expect(q.scheme.accept).toEqual([q.answer]);
  });
  expect(trueOrder(out[0])).toEqual(['پانی سے ہاتھ گیلے کریں', 'ہاتھوں پر صابن لگائیں', 'ہاتھ خشک کریں']);
});

test('Urdu digits stay Urdu digits', () => {
  const q = item('مراحل: ۱) الف ۲) ب ۳) ج', '۳، ۲، ۱');
  const out = dealOrders(paper([q])).unseen.subjective['Put in Order'][0];
  expect(out.answer).toMatch(/^[۱-۳]، [۱-۳]، [۱-۳]$/);
  expect(out.question).toMatch(/۱\) .* ۲\) .* ۳\) /);
  expect(trueOrder(out)).toEqual(['ج', 'ب', 'الف']);
});

test('an item it cannot read, and other slots, are left as they are', () => {
  const odd = item('no numbered steps here', '3، 2، 1');
  const exam = paper([odd]);
  const out = dealOrders(exam);
  expect(out.unseen.subjective['Put in Order'][0]).toEqual(odd);
  expect(out.unseen.subjective.Other).toEqual(exam.unseen.subjective.Other);
});

test('the same paper deals the same way twice', () => {
  expect(dealOrders(paper(V21))).toEqual(dealOrders(paper(V21)));
});
