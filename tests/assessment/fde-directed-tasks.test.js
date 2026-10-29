/**
 * bd-5jmnfj.33.2 — a do-as-directed item prints its task.
 * v30 G4 English Q2 printed "A ___ of birds sat on the wire." under "Do as directed." with the
 * task ("Fill in the blank with the correct collective noun.") only in main_question, which the
 * renderer never prints. On a Grade 3-4 paper: when every live item of such a slot carries one
 * task, the slot's instruction becomes that task; otherwise each item's task is written after
 * its stem in brackets. Grade 5 papers and slots that offer a choice are untouched.
 */

const { directedTasks } = require('../../bot/shared/services/assessment/fde-directed-tasks');

const MID = { g5_rules: false };
const slotEn = (extra = {}) => ({ slot: 'g4.english.A.grammar', instruction_en: 'Do as directed.', instruction_ur: null, ...extra });
const paper = (slot, items) => ({
  _layout: { sections: [{ id: 'A', slots: [slot] }] },
  unseen: { objective: { 'Do as Directed': items.map((q) => ({ slot: slot.slot, marks: 2, ...q })) } },
});
const items = (out) => out.examJson.unseen.objective['Do as Directed'];
const slotOf = (out) => out.examJson._layout.sections[0].slots[0];

test('mixed tasks: each stem gets its task in brackets, without the task\'s full stop', () => {
  const out = directedTasks(paper(slotEn(), [
    { question: 'A ___ of birds sat on the wire.', main_question: 'Fill in the blank with the correct collective noun.', answer: 'A flock of birds sat on the wire.' },
    { question: 'Sara cleans the beach every Sunday.', main_question: 'Change the sentence into the past tense.', answer: 'Sara cleaned the beach every Sunday.' },
  ]), MID);
  expect(items(out).map((q) => q.question)).toEqual([
    'A ___ of birds sat on the wire. (Fill in the blank with the correct collective noun)',
    'Sara cleans the beach every Sunday. (Change the sentence into the past tense)',
  ]);
  expect(slotOf(out).instruction_en).toBe('Do as directed.');
  expect(out.notes).toEqual([
    { slot: 'g4.english.A.grammar', n: 0, kind: 'item', task: 'Fill in the blank with the correct collective noun.' },
    { slot: 'g4.english.A.grammar', n: 1, kind: 'item', task: 'Change the sentence into the past tense.' },
  ]);
});

test('one task on every item: the slot instruction becomes the task and the stems are left alone', () => {
  const out = directedTasks(paper(slotEn({ slot: 'g4.english.C.syllables' }), [
    { question: 'elephant', main_question: 'Split the word into syllables.', answer: 'el-e-phant' },
    { question: 'banana', main_question: 'Split the word into syllables.', answer: 'ba-na-na' },
  ]), MID);
  expect(slotOf(out).instruction_en).toBe('Split the word into syllables.');
  expect(items(out).map((q) => q.question)).toEqual(['elephant', 'banana']);
  expect(out.notes).toEqual([{ slot: 'g4.english.C.syllables', kind: 'instruction', task: 'Split the word into syllables.' }]);
});

test('an Urdu slot: the Urdu instruction is the one read, and the task is written in Urdu brackets', () => {
  const slot = { slot: 'g4.urdu.B.directed', instruction_en: null, instruction_ur: 'ہدایت کے مطابق لکھیں۔' };
  const out = directedTasks(paper(slot, [
    { question: 'کتاب', main_question: 'واحد کی جمع لکھیں۔', answer: 'کتابیں' },
    { question: 'وہ اسکول گیا۔', main_question: 'جملے کو مستقبل میں بدلیں۔', answer: 'وہ اسکول جائے گا۔' },
  ]), MID);
  expect(items(out).map((q) => q.question)).toEqual(['کتاب (واحد کی جمع لکھیں)', 'وہ اسکول گیا۔ (جملے کو مستقبل میں بدلیں)']);
  expect(slotOf(out).instruction_ur).toBe('ہدایت کے مطابق لکھیں۔');
});

test('a task the stem already carries, a task equal to the instruction, and no task are left alone', () => {
  const out = directedTasks(paper(slotEn(), [
    { question: 'Change into the past tense: Sara cleans the beach.', main_question: 'Change into the past tense.', answer: 'x' },
    { question: 'Ali ___ (go) to school.', main_question: 'Do as directed.', answer: 'x' },
    { question: 'Write the plural of "box".', answer: 'boxes' },
  ]), MID);
  expect(items(out).map((q) => q.question)).toEqual(['Change into the past tense: Sara cleans the beach.', 'Ali ___ (go) to school.', 'Write the plural of "box".']);
  expect(out.notes).toEqual([]);
});

test('a Grade 5 paper, a slot that is not do-as-directed, and a choice slot are untouched', () => {
  const g5 = directedTasks(paper(slotEn(), [{ question: 'A ___ of birds.', main_question: 'Fill in the collective noun.', answer: 'x' }]), { g5_rules: true });
  expect(items(g5)[0].question).toBe('A ___ of birds.');
  const other = directedTasks(paper(slotEn({ instruction_en: 'Choose the correct answer.' }), [{ question: 'A ___ of birds.', main_question: 'Fill in the collective noun.', answer: 'x' }]), MID);
  expect(items(other)[0].question).toBe('A ___ of birds.');
  const choice = directedTasks(paper(slotEn({ or: true }), [{ question: 'A ___ of birds.', main_question: 'Fill in the collective noun.', answer: 'x' }]), MID);
  expect(items(choice)[0].question).toBe('A ___ of birds.');
  expect(g5.notes.concat(other.notes, choice.notes)).toEqual([]);
});

test('never throws on a broken shape', () => {
  expect(() => directedTasks(null, MID)).not.toThrow();
  expect(() => directedTasks({ _layout: {}, unseen: { objective: { x: [null, 3] } } }, MID)).not.toThrow();
  expect(directedTasks({ unseen: {} }, undefined).notes).toEqual([]);
});
