/**
 * v28 G1 Urdu oral reading words (key p.6): «چاند», «چڑیا», «روٹی», «سچ» are printed on the written paper too
 * (G1 Urdu Q1 i/iv/ix and the Q5 word box), and G2 Urdu "My summer holidays" gave three prompts for five
 * marked sentences (bd-5jmnfj.4.58.4). Defects 1 and 3 of the v29 Urdu oral round; the other defects have their
 * own fde-v29-* suites.
 *
 * fde-answer-repeats flags the four words on the v28 paper (the check catches them); the writer's action was two
 * model re-asks and then ship-and-log. freshReadWords is the last step: a read-aloud word still printed on the
 * written paper is replaced in code from a bank of Grade 1 words the paper does not print.
 */

const { freshReadWords } = require('../../bot/shared/services/assessment/fde-oral-fresh-words');
const { answerRepeats } = require('../../bot/shared/services/assessment/fde-answer-repeats');
const g1 = require('../../bot/shared/services/assessment/patterns/early/g1-urdu');
const g2 = require('../../bot/shared/services/assessment/patterns/early/g2-urdu');

const WORDS = ['چاند', 'پانی', 'بلی', 'دس', 'سبز', 'پھول', 'چڑیا', 'روٹی', 'سچ', 'آنکھ'];
const written = () => ({
  unseen: {
    objective: {
      MCQs: [
        { slot: 'g1.urdu.A.Q1', question: 'ان میں سے کون سا لفظ پرندے کا نام ہے؟', options: ['الف) روٹی', 'ب) تھالی', 'ج) ٹھیلا', 'د) طوطا'], answer: 'د) طوطا' },
        { slot: 'g1.urdu.A.Q1', question: 'ان حروف کو جوڑنے سے کون سا لفظ بنتا ہے؟ چ + ا + ن + د', options: ['الف) چاول', 'ب) چادر', 'ج) چاند', 'د) چانس'], answer: 'ج) چاند' },
        { slot: 'g1.urdu.A.Q1', question: 'ان میں سے کون سا لفظ درست لکھا گیا ہے؟', options: ['الف) چڑیہ', 'ب) جڑیا', 'ج) چڑیا', 'د) چریا'], answer: 'ج) چڑیا' },
      ],
      Fill: [
        { slot: 'g1.urdu.B.Q5', question: 'ہمیشہ ___ بولیں۔', answer: 'سچ', words: ['بلند', 'سچ', 'پسند'] },
        { slot: 'g1.urdu.B.Q5', question: 'آسمان بہت ___ ہے۔', answer: 'بلند' },
      ],
    },
  },
  _layout: {
    sections: [{ id: 'A', slots: [{ slot: 'g1.urdu.A.Q1', type: 'MCQs' }, { slot: 'g1.urdu.B.Q5', type: 'Fill in the Blanks' }] }],
    oral: {
      tasks: [{ id: 'read_words', kind: 'read_aloud' }, { id: 'likes', kind: 'speaking' }],
      content: [
        { id: 'read_words', items: WORDS.map((ask) => ({ ask, answer: '' })) },
        { id: 'likes', items: [{ ask: 'آپ کو کون سا پھل پسند ہے؟', answer: 'مجھے آم پسند ہے۔' }] },
      ],
    },
  },
});
const asks = (ex) => ex._layout.oral.content[0].items.map((i) => i.ask);

describe('G1 Urdu oral reading words (defect 1)', () => {
  test('the existing check flags the four words on this paper', () => {
    const w = answerRepeats(written()).filter((f) => f.with.includes('oral')).flatMap((f) => f.words);
    ['چاند', 'چڑیا', 'روٹی', 'سچ'].forEach((x) => expect(w).toContain(x));
  });

  test('G1 Urdu oral words printed on the written paper are replaced; the rest stay in place', () => {
    const { examJson, notes } = freshReadWords(written());
    const after = asks(examJson);
    ['چاند', 'چڑیا', 'روٹی', 'سچ'].forEach((x) => expect(after).not.toContain(x));
    expect(after).toHaveLength(10);
    expect(new Set(after).size).toBe(10);
    [1, 2, 3, 4, 5, 9].forEach((i) => expect(after[i]).toBe(WORDS[i]));
    expect(notes).toHaveLength(4);
    expect(answerRepeats(examJson).filter((f) => f.with.includes('oral'))).toEqual([]);
  });

  test('the input paper is not changed and a clean oral is returned as it was', () => {
    const ex = written();
    const before = JSON.stringify(ex);
    freshReadWords(ex);
    expect(JSON.stringify(ex)).toBe(before);
    const clean = written();
    clean._layout.oral.content[0].items = ['پانی', 'بلی', 'دس', 'سبز', 'پھول', 'آنکھ', 'باغ', 'قلم', 'ناک', 'کان'].map((ask) => ({ ask, answer: '' }));
    const out = freshReadWords(clean);
    expect(out.notes).toEqual([]);
    expect(out.examJson._layout.oral.content[0].items).toEqual(clean._layout.oral.content[0].items);
  });

  test('a paper with no oral part, and a task that is not read aloud, are untouched', () => {
    const none = written();
    delete none._layout.oral;
    expect(freshReadWords(none).notes).toEqual([]);
    const spoken = written();
    spoken._layout.oral.tasks[0].kind = 'speaking';
    expect(asks(freshReadWords(spoken).examJson)).toEqual(WORDS);
  });
});

describe('G2 Urdu oral "My summer holidays" (defect 3)', () => {
  const task = (S, id) => S.oral.tasks.find((t) => t.id === id);

  test('G2 Urdu holidays: five prompts for five marked sentences', () => {
    const t = task(g2, 'holidays');
    expect(t.n).toBe(5);
    expect(t.marks / t.rubric[0].marks).toBe(5);
    expect(t.ask).toMatch(/^Five prompt questions/);
  });

  test('every Urdu oral task paid per item has as many prompts as the marks need', () => {
    [g1, g2].forEach((S) => S.oral.tasks.filter((t) => t.scoring === 'each').forEach((t) => {
      expect([S.grade, t.id, t.n]).toEqual([S.grade, t.id, t.marks / t.rubric[0].marks]);
    }));
  });
});
