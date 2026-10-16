/**
 * Urdu board-pattern papers: Section A gives a Q4 sentence away with its answer. A Q1 MCQ asks
 * about the very sentence Q4 asks the child to fill («جملہ «اگر محنت کرو گے تو کامیاب ہو گے» میں
 * حرفِ جزا کون سا ہے؟» beside Q4 «___ تم محنت کرو گے ___ کامیاب ہو گے»), keyed on one word of
 * Q4's pair, so the key test alone does not see it. Such a Q1 item is a twin too and is held:
 * Q4's sentence (its blanks stripped, normalised) is read in the Q1 stem, or the Q1 stem's quoted
 * sentence in Q4's. Q4 is never touched.
 *
 * The recorded paper is a sandbox reply (content only, no person in it), laid out again here.
 */

const fs = require('fs');
const path = require('path');

const Patterns = require('../../bot/shared/services/assessment/patterns');
const { applyLayout } = require('../../bot/shared/services/assessment/fde-layout');

const U = Patterns.get('fde_g5_2027').subjects.urdu;
const FDE = { kind: 'fde', chapters: null, pages: null };
const full1 = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'fde', 'r11-urdu-sandbox-full_1.json'), 'utf8'));
const clone = (x) => JSON.parse(JSON.stringify(x));

function items(exam, slot) {
  const out = [];
  for (const types of Object.values((exam && exam.unseen) || {})) for (const list of Object.values(types || {})) out.push(...list.filter((q) => q && q.slot === slot));
  return out;
}
const TWIN = 'جملہ «اگر محنت کرو گے تو کامیاب ہو گے» میں حرفِ جزا کون سا ہے؟';

describe('urdu Q1 ↔ Q4: a Q1 stem that prints a Q4 sentence is held', () => {
  test('full_1: Q1 ۱۳ quoting Q4 ۲\'s sentence is held before the re-ask; the slot is one short', () => {
    const { examJson, shortfall } = applyLayout(clone(full1), U, FDE, { reasked: false });
    const q1 = items(examJson, 'urdu.A.Q1');
    expect(q1.map((q) => q.question)).not.toContain(TWIN);
    expect(q1).toHaveLength(19);
    expect(shortfall).toEqual(expect.arrayContaining([expect.objectContaining({ slot: 'urdu.A.Q1', missing: 1 })]));
  });

  test('Q4 is untouched: all four items, Q4 ۲ with its sentence and key', () => {
    const { examJson } = applyLayout(clone(full1), U, FDE, { reasked: false });
    const q4 = items(examJson, 'urdu.C.Q4');
    expect(q4).toHaveLength(4);
    expect(q4.map((q) => q.answer)).toContain('الف) اگر - تو');
  });

  test('every other Q1 item of the paper stays: no other stem is read as a twin', () => {
    const { examJson } = applyLayout(clone(full1), U, FDE, { reasked: false });
    const before = items(full1, 'urdu.A.Q1').map((q) => q.question).filter((s) => s !== TWIN);
    expect(items(examJson, 'urdu.A.Q1').map((q) => q.question).sort()).toEqual(before.sort());
  });

  test('the reverse: a Q1 stem whose quoted sentence Q4 prints is held too', () => {
    const exam = clone(full1);
    const q1 = items(exam, 'urdu.A.Q1').find((q) => q.question === TWIN);
    q1.question = 'جملہ «ببلو روز اسکول جاتا ہے» میں فعل کون سا ہے؟';
    q1.options = ['الف) ببلو', 'ب) روز', 'ج) اسکول', 'د) جاتا ہے'];
    q1.answer = 'د) جاتا ہے';
    const { examJson } = applyLayout(exam, U, FDE, { reasked: false });
    expect(items(examJson, 'urdu.A.Q1').map((q) => q.question)).not.toContain(q1.question);
  });

  test('a Q1 stem that shares only frame words with a Q4 stem is not held', () => {
    const exam = clone(full1);
    const q1 = items(exam, 'urdu.A.Q1').find((q) => q.question === TWIN);
    q1.question = 'جملہ «اگر بارش ہوئی تو ہم گھر رہیں گے» میں حرفِ شرط کون سا ہے؟';
    q1.options = ['الف) اگر', 'ب) بارش', 'ج) تو', 'د) گھر'];
    q1.answer = 'الف) اگر';
    const { examJson } = applyLayout(exam, U, FDE, { reasked: false });
    expect(items(examJson, 'urdu.A.Q1')).toHaveLength(20);
  });

  test('after the one re-ask, the held item comes back only for a place nothing else takes', () => {
    const { examJson } = applyLayout(clone(full1), U, FDE, { reasked: true });
    expect(items(examJson, 'urdu.A.Q1')).toHaveLength(20);
  });
});
