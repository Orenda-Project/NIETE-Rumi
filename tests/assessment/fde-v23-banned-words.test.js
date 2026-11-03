/**
 * bd-5jmnfj.4.51.1 — v23 G1 Urdu Q1 ix ("which split of چھٹی is right") printed the
 * distractor "ب) چھ + ٹٹی". ٹٹی alone is a crude word and cannot appear on a Class 1
 * paper. A banned-word guard reads every printed Urdu string of an item and returns
 * a shortfall the writer re-asks (same path as answerShortfall).
 *
 * Pure. The item is the real v23 g1-urdu-exam.json row.
 */

const Banned = require('../../bot/shared/services/assessment/fde-banned-words');
const Patterns = require('../../bot/shared/services/assessment/patterns');

const V23_Q1_IX = {
  slot: 'g1.urdu.A.Q1', lines: 1, marks: 1, answer: 'ج) چھٹ + ٹی', blooms: 'Apply',
  options: ['الف) چ + ھٹی', 'ب) چھ + ٹٹی', 'ج) چھٹ + ٹی'],
  question: 'لفظ "چھٹی" کو ارکان میں توڑیں تو کیا بنے گا؟',
  main_question: 'صحیح جواب کا انتخاب کریں',
};
const tree = (...items) => ({ seen: {}, unseen: { objective: { MCQs: items } } });

describe('bannedHits', () => {
  test('flags the v23 distractor that splits چھٹی into چھ + ٹٹی', () => {
    const hits = Banned.bannedHits(V23_Q1_IX);
    expect(hits.map((h) => h.word)).toEqual(['ٹٹی']);
  });

  test('the clean split and the key do not trip it (ٹی, چھٹی are fine)', () => {
    const ok = { ...V23_Q1_IX, options: ['الف) چ + ھٹی', 'ب) چھ + ٹی', 'ج) چھٹ + ٹی'] };
    expect(Banned.bannedHits(ok)).toEqual([]);
    expect(Banned.bannedHits({ ...ok, question: 'لفظ "چھٹی" لکھیں' })).toEqual([]);
  });

  test('reads every printed string: question, answer, options, passage, sub-questions, scheme accept', () => {
    expect(Banned.bannedHits({ slot: 's', question: 'ٹٹی لکھیں' })).toHaveLength(1);
    expect(Banned.bannedHits({ slot: 's', question: 'x', answer: 'ٹٹی' })).toHaveLength(1);
    expect(Banned.bannedHits({ slot: 's', question: 'x', passage: 'ایک دن ٹٹی آئی' })).toHaveLength(1);
    expect(Banned.bannedHits({ slot: 's', question: 'x', scheme: { accept: ['ٹٹی'] } })).toHaveLength(1);
    expect(Banned.bannedHits({ slot: 's', question: 'x', parts: [{ key: 'a', questions: [{ question: 'ٹٹی؟' }] }] })).toHaveLength(1);
  });

  test('matches whole words only, past a diacritic or a label', () => {
    expect(Banned.bannedHits({ slot: 's', question: 'ب) چھ + ٹٹّی' })).toHaveLength(1);
    expect(Banned.bannedHits({ slot: 's', question: 'ٹٹیاں' })).toEqual([]);
  });

  test('the explicit list holds the words a Class 1 paper must never print', () => {
    for (const w of ['ٹٹی', 'پاخانہ', 'حرامی', 'کمینہ']) {
      expect(Banned.BANNED_URDU).toContain(w);
    }
  });
});

describe('bannedShortfall', () => {
  test('returns a re-ask shortfall for the slot, naming the item and the word', () => {
    const r = Banned.bannedShortfall(tree(V23_Q1_IX));
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ slot: 'g1.urdu.A.Q1', reason: 'banned' });
    expect(r[0].items.join(' ')).toContain('ٹٹی');
  });

  test('a clean paper returns nothing', () => {
    expect(Banned.bannedShortfall(tree({ ...V23_Q1_IX, options: ['الف) چ + ھٹی', 'ب) چھ + ٹی', 'ج) چھٹ + ٹی'] }))).toEqual([]);
  });
});

describe('the writer is told', () => {
  test('the Urdu MCQ slot rule bans splits into parts that form a rude word', () => {
    const slot = Patterns.get('fde_g1_2026').subjects.urdu.sections[0].slots.find((s) => s.slot === 'g1.urdu.A.Q1');
    expect(slot.prompt_rule).toMatch(/rude|crude|vulgar/i);
  });

  test('answerNote words a banned re-ask for the writer', () => {
    const Prompt = require('../../bot/shared/services/assessment/fde-early-prompt');
    const P = Patterns.get('fde_g1_2026').subjects.urdu;
    const note = Prompt.answerNote(Banned.bannedShortfall(tree(V23_Q1_IX)), P);
    expect(note).toMatch(/rude|crude|vulgar/i);
  });
});
