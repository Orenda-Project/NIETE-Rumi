/**
 * G2 Urdu Q9 dialogue (bd-5jmnfj.36): the prompt_rule asks for five turns, each with the speaker's name before it, and five
 * K points of 2 marks (name 1 + sentence 1). `dialogueOk` is the slot's answer_ok, so a dialogue off those levels is asked again.
 */
const { dialogueOk } = require('../../bot/shared/services/assessment/fde-early-urdu-dialogue');
const Patterns = require('../../bot/shared/services/assessment/patterns');

const points = (n, marks = 2) => Array.from({ length: n }, (_, i) => ({ text: `جملہ ${i + 1}`, marks, kind: 'K' }));
const good = () => ({
  slot: 'g2.urdu.B.Q9', question: 'دو دوست پکنک کا منصوبہ بنا رہے ہیں۔',
  answer: 'پہلا دوست: کل پکنک پر چلیں؟ دوسرا دوست: ہاں، کہاں چلیں؟ پہلا دوست: باغ میں چلتے ہیں۔ دوسرا دوست: میں پھل لاؤں گا۔ پہلا دوست: میں پانی لاؤں گا۔',
  scheme: { points: points(5), accept: [] },
});

describe('dialogueOk', () => {
  test('RED: five named turns with five 2-mark points pass', () => { expect(dialogueOk(good())).toBe(true); });
  test('four turns fail', () => {
    const q = good(); q.answer = q.answer.split(' دوسرا دوست: میں پھل')[0]; q.answer += ' پہلا دوست: ٹھیک ہے۔';
    expect(dialogueOk({ ...q, answer: 'پہلا دوست: چلیں؟ دوسرا دوست: ہاں۔ پہلا دوست: باغ۔ دوسرا دوست: ٹھیک۔' })).toBe(false);
  });
  test('six turns fail', () => {
    expect(dialogueOk({ ...good(), answer: `${good().answer} دوسرا دوست: ٹھیک ہے۔` })).toBe(false);
  });
  test('a turn with no speaker name fails', () => {
    expect(dialogueOk({ ...good(), answer: 'کل پکنک پر چلیں؟ دوسرا دوست: ہاں۔ پہلا دوست: باغ۔ دوسرا دوست: ٹھیک۔ پہلا دوست: چلو۔' })).toBe(false);
  });
  test('a turn that is only a name fails', () => {
    expect(dialogueOk({ ...good(), answer: 'پہلا دوست: دوسرا دوست: ہاں۔ پہلا دوست: باغ۔ دوسرا دوست: ٹھیک۔ پہلا دوست: چلو۔' })).toBe(false);
  });
  test('points not five, or not 2 marks each, fail', () => {
    expect(dialogueOk({ ...good(), scheme: { points: points(4) } })).toBe(false);
    expect(dialogueOk({ ...good(), scheme: { points: points(5, 1) } })).toBe(false);
    expect(dialogueOk({ ...good(), scheme: {} })).toBe(false);
  });
  test('an empty answer fails', () => { expect(dialogueOk({ ...good(), answer: '' })).toBe(false); });
  test('the G2 Urdu Q9 slot carries it', () => {
    const s = Patterns.subjectOf('fde_g2_2026', 'urdu').sections.flatMap((x) => x.slots).find((x) => x.slot === 'g2.urdu.B.Q9');
    expect(s.answer_ok).toBe(dialogueOk);
  });
});
