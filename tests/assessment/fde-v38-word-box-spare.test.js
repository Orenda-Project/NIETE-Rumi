/**
 * bd-5jmnfj.33.7.1 (round 6, v38): a fill-in-the-blanks word box must hold at least one spare word.
 * v36 G3 General Knowledge Q3 kept 10 words for 10 blanks and G4 Science Q2 5 for 5 after six re-asks,
 * so the last blank was free. After the re-ask, a box still short of a spare is given one
 * deterministically: a word the chapter text already uses, of the same kind as the answers (same script,
 * one word, a length inside the answers' range), that is not an answer, not in the slot's sentences and
 * not a function word. The engine authors nothing: no candidate in the book means no change.
 */

const { addSpareWord, spareCandidates } = require('../../bot/shared/services/assessment/fde-word-box-spare');

const P = { g5_rules: false };
const exam = (items) => ({ _layout: { subject: 'x', sections: [] }, unseen: { objective: { 'Fill in the Blanks': items } } });
const fill = (slot, rows, box) => rows.map(([question, answer], i) => ({
  slot, main_question: 'Fill in the blanks.', question, answer, marks: 1, lines: 1, ...(i === 0 && box ? { words: box } : {}),
}));
const boxOf = (ex) => ex.unseen.objective['Fill in the Blanks'][0].words;

const SCI_SLOT = 'g4.science.A.fill';
const SCI_ROWS = [
  ['Water turns into ice by ___________.', 'freezing'],
  ['Plastic is a good ___________ of electricity.', 'insulator'],
  ['The amount of matter in an object is its ___________.', 'mass'],
  ['Iron sinks because of its high ___________.', 'density'],
  ['A boat floats because of ___________.', 'buoyancy'],
];
const SCI_BOX = ['buoyancy', 'density', 'freezing', 'insulator', 'mass'];
const SCI_BOOK = 'Matter is anything that has mass. Copper is a conductor of electricity, and a conductor lets heat pass. '
  + 'Melting turns ice into water. Water is a liquid. The conductor in a wire is copper. Freezing turns water into ice.';

const GK_SLOT = 'g3.general_knowledge.A.fill';
const GK_ROWS = [
  ['بہن بھائیوں کے درمیان ___ کے استعمال پر اختلاف ہو جاتا ہے۔', 'چیزوں'],
  ['اختلافات ہماری ___ زندگی کا حصہ ہیں۔', 'روزمرہ'],
  ['غصہ آنے پر ___ ہو کر سوچنا چاہیے۔', 'پرسکون'],
];
const GK_BOX = ['روزمرہ', 'پرسکون', 'چیزوں'];
const GK_BOOK = 'ہمیں دوسروں کی بات سننی چاہیے۔ دوستوں کے ساتھ کھیلنا اچھا ہے۔ دوستوں سے اختلاف ہو جاتا ہے۔ '
  + 'اسکول میں ہم پڑھتے ہیں۔ اسکول اچھی جگہ ہے۔ ہمیں غصہ نہیں کرنا چاہیے۔';

describe('fde-word-box-spare: a box with no spare word is given one from the book', () => {
  test('the v36 G4 Science box (5 for 5) gains one English book word that is not an answer', () => {
    const { examJson, notes } = addSpareWord(exam(fill(SCI_SLOT, SCI_ROWS, SCI_BOX)), P, SCI_BOOK);
    const box = boxOf(examJson);
    expect(box).toHaveLength(6);
    const spare = box.find((w) => !SCI_BOX.includes(w));
    expect(spare).toBe('conductor'); // the most frequent same-kind book word, not an answer, not in a blank sentence
    expect(SCI_BOOK.toLowerCase()).toContain(spare);
    expect(notes).toEqual([{ slot: SCI_SLOT, spare: 'conductor', from: 'book' }]);
  });

  test('the spare is placed inside the box, not appended last, and the answers keep their order', () => {
    const box = boxOf(addSpareWord(exam(fill(SCI_SLOT, SCI_ROWS, SCI_BOX)), P, SCI_BOOK).examJson);
    expect(box[box.length - 1]).not.toBe('conductor');
    expect(box.filter((w) => w !== 'conductor')).toEqual(SCI_BOX);
  });

  test('an Urdu box gains an Urdu book word, never a function word or a word already in its sentences', () => {
    const { examJson, notes } = addSpareWord(exam(fill(GK_SLOT, GK_ROWS, GK_BOX)), P, GK_BOOK);
    const box = boxOf(examJson);
    expect(box).toHaveLength(4);
    const spare = notes[0].spare;
    expect(GK_BOX).not.toContain(spare);
    expect(GK_BOOK).toContain(spare);
    expect(['ہمیں', 'کی', 'کے', 'ہے', 'چاہیے', 'اختلاف', 'غصہ']).not.toContain(spare);
    expect(/^[؀-ۿ]+$/.test(spare)).toBe(true);
    expect(spare).toBe('دوستوں');
  });

  test('a box that already holds a spare word is left alone', () => {
    const ex = exam(fill(SCI_SLOT, SCI_ROWS, [...SCI_BOX, 'solid']));
    const out = addSpareWord(ex, P, SCI_BOOK);
    expect(boxOf(out.examJson)).toEqual([...SCI_BOX, 'solid']);
    expect(out.notes).toEqual([]);
  });

  test('no candidate in the book means no change and a note that says so (the engine never authors a word)', () => {
    const out = addSpareWord(exam(fill(SCI_SLOT, SCI_ROWS, SCI_BOX)), P, 'the and of mass freezing');
    expect(boxOf(out.examJson)).toEqual(SCI_BOX);
    expect(out.notes).toEqual([{ slot: SCI_SLOT, spare: null, from: 'none' }]);
  });

  test('Grade 5 papers and missing input are untouched; the input is never mutated', () => {
    const ex = exam(fill(SCI_SLOT, SCI_ROWS, SCI_BOX));
    const before = JSON.stringify(ex);
    expect(addSpareWord(ex, { g5_rules: true }, SCI_BOOK).notes).toEqual([]);
    expect(addSpareWord(null, P, SCI_BOOK)).toEqual({ examJson: null, notes: [] });
    addSpareWord(ex, P, SCI_BOOK);
    expect(JSON.stringify(ex)).toBe(before);
  });

  test('a multi-word answer box draws only a candidate whose length sits in the answers\' range', () => {
    const c = spareCandidates(['mass', 'density'], ['x ___'], 'Copper conductor electricity is cool. Electricity electricity conductor');
    expect(c).not.toContain('electricity'); // 11 letters, answers span 4-7
    expect(c[0]).toBe('copper');
  });

  test('a capitalised book word matches a lower-case answer box in its own case', () => {
    const c = spareCandidates(['mass', 'density'], ['x ___'], 'Copper is shiny. Copper bends.');
    expect(c[0]).toBe('copper');
  });
});
