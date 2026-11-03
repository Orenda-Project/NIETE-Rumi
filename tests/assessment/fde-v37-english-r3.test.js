/**
 * v37 round 3 English (W-EN3): G1 mark balance; G2 read-aloud pronoun with no antecedent; G2 Q12 2/1/0 descriptors;
 * G2 Q16 position banding; G5 Q2 i complete-sentence instruction.
 */
const Patterns = require('../../bot/shared/services/assessment/patterns');
const { earlyEnglishFixes2 } = require('../../bot/shared/services/assessment/fde-early-english-fixes-2');
const { langFixes } = require('../../bot/shared/services/assessment/fde-g5-lang-fixes');
const { orphanPronouns } = require('../../bot/shared/services/assessment/fde-read-aloud-antecedent');
const Prompt = require('../../bot/shared/services/assessment/fde-early-prompt');
const G5 = require('../../bot/shared/services/assessment/patterns/fde-g5-2027');

const slots = (pat, subj) => pat.subjects[subj].sections.flatMap((s) => s.slots);
const g1 = Patterns.get('fde_g1_2026');
const g2 = Patterns.get('fde_g2_2026');
const g1s = (id) => slots(g1, 'english').find((s) => s.slot === id);
const g2s = (id) => slots(g2, 'english').find((s) => s.slot === id);
const total = (list) => list.reduce((n, s) => n + s.generate * (s.marks_each || 1), 0);
const secTotal = (pat, id) => total(pat.subjects.english.sections.find((s) => s.id === id).slots);

describe('G1 English marks follow demand (the model paper cites section totals only: 84 written + 16 oral)', () => {
  test('RED Section B still totals 32, Section C 28, the paper 100', () => {
    expect(secTotal(g1, 'A')).toBe(24);
    expect(secTotal(g1, 'B')).toBe(32);
    expect(secTotal(g1, 'C')).toBe(28);
    const oral = g1.subjects.english.oral.tasks.reduce((n, t) => n + t.marks, 0);
    expect(secTotal(g1, 'A') + secTotal(g1, 'B') + secTotal(g1, 'C') + oral).toBe(100);
  });
  test('RED choosing one word from a 5-word box (Q9) pays no more than producing a rhyme (Q6) or an action word (Q8)', () => {
    expect(g1s('g1.english.B.Q9').marks_each).toBeLessThanOrEqual(g1s('g1.english.B.Q6').marks_each);
    expect(g1s('g1.english.B.Q9').marks_each).toBeLessThanOrEqual(g1s('g1.english.B.Q8').marks_each);
  });
  test('RED Q9 pays 1 per blank, Q6 (write a rhyme) pays 2', () => {
    expect(g1s('g1.english.B.Q9').marks_each).toBe(1);
    expect(g1s('g1.english.B.Q6').marks_each).toBe(2);
  });
  test('the Q9 prompt rule says K 1', () => {
    expect(g1s('g1.english.B.Q9').prompt_rule).toMatch(/K 1 for the right word/);
  });
});

describe('orphanPronouns: a pronoun with no earlier antecedent in the card', () => {
  test('RED the v35 card: he after only a door', () => {
    expect(orphanPronouns('The door was big and blue. Another door appeared, and he stepped inside.')).toEqual(['he']);
  });
  test('RED the first sentence opening with a pronoun', () => {
    expect(orphanPronouns('She went to school. Pinky was happy.')).toEqual(['she']);
  });
  test('a name before the pronoun is its antecedent', () => {
    expect(orphanPronouns('Pinky looked at the book. She smiled and her eyes were bright.')).toEqual([]);
  });
  test('a person noun is an antecedent, so is a name inside a possessive', () => {
    expect(orphanPronouns('The boy ran home. He was happy.')).toEqual([]);
    expect(orphanPronouns("Pinky's mother cooked rice. She was kind.")).toEqual([]);
  });
  test('it after a thing is fine; a weather opening is not a pronoun slip', () => {
    expect(orphanPronouns('The cat sat on the mat. It was soft.')).toEqual([]);
    expect(orphanPronouns('It was a sunny day. The children played.')).toEqual([]);
  });
  test('RED his / them / her count too', () => {
    expect(orphanPronouns('Look at his hat. The hat is red.')).toEqual(['his']);
    expect(orphanPronouns('Ali saw a dog. The sun was hot, so she gave them water.')).toEqual([]);
  });
  test('Urdu, empty and non-string input are never flagged', () => {
    expect(orphanPronouns('وہ سکول گیا۔')).toEqual([]);
    expect(orphanPronouns('')).toEqual([]);
    expect(orphanPronouns(null)).toEqual([]);
  });
});

describe('oralContent flags a read-aloud card with an orphan pronoun for a re-ask', () => {
  const oral = g2.subjects.english.oral;
  const story = { id: 'listening', script: 'Ali has a cat. The cat is small.', items: [1, 2, 3, 4, 5].map((i) => ({ ask: `Q${i}?`, answer: 'Ali' })) };
  const speak = { id: 'speaking', items: [1, 2, 3].map((i) => ({ ask: `Tell me ${i}`, answer: 'x' })) };
  const read = (script) => ({ id: 'read_aloud', script, items: [] });
  test('RED the spliced card is flagged and kept in content', () => {
    const r = Prompt.oralContent({ oral: [story, speak, read('The door was big. Another door appeared, and he stepped inside.')] }, oral);
    expect(r.flagged).toContain('read_aloud');
    expect(r.missing).toEqual([]);
  });
  test('a clean card is not flagged', () => {
    const r = Prompt.oralContent({ oral: [story, speak, read('Pinky has a red kite. She runs to the park with her friend.')] }, oral);
    expect(r.flagged).toEqual([]);
  });
  test('RED the read-aloud ask says one continuous passage, never two joined', () => {
    const ask = oral.tasks.find((t) => t.id === 'read_aloud').ask;
    expect(ask).toMatch(/one continuous passage from one place in the book, never two passages joined/);
  });
});

describe('G2 Q12 criteria carry 2/1/0 descriptors', () => {
  const mk = (slot, pts) => ({ slot, marks: 10, answer: 'x', scheme: { points: pts, accept: [] } });
  const run = (q) => earlyEnglishFixes2({ examJson: { unseen: { x: { y: [q] } }, _layout: { sections: [{ slots: [{ slot: q.slot, type: 'Paragraph' }] }] } }, notes: [] });
  const bare = ['Writes about the house', 'Writes five sentences', 'Each sentence gives a different fact', 'Sensible order', 'Spells familiar words'];
  test('RED each bare 2-mark point gains 2/1/0 wording; marks unchanged', () => {
    const { examJson, notes } = run(mk('g2.english.C.Q12', bare.map((text) => ({ text, marks: 2, kind: 'K' }))));
    const pts = examJson.unseen.x.y[0].scheme.points;
    pts.forEach((p) => expect(p.text).toMatch(/\b2\b.*\b1\b.*\b0\b/));
    expect(pts.reduce((n, p) => n + p.marks, 0)).toBe(10);
    expect(notes.join(' ')).toMatch(/2\/1\/0/);
  });
  test('a point that already has descriptors is left as it is', () => {
    const text = 'Writes five sentences: 2 for five, 1 for three or four, 0 for fewer';
    const { examJson } = run(mk('g2.english.C.Q12', [{ text, marks: 2, kind: 'K' }]));
    expect(examJson.unseen.x.y[0].scheme.points[0].text).toBe(text);
  });
  test('a 1-mark point gets none', () => {
    const { examJson } = run(mk('g2.english.C.Q15', [{ text: 'One sentence', marks: 1, kind: 'K' }]));
    expect(examJson.unseen.x.y[0].scheme.points[0].text).toBe('One sentence');
  });
  test('RED the prompt rule demands 2/1/0 descriptors', () => {
    expect(g2s('g2.english.C.Q12').prompt_rule).toMatch(/2\/1\/0/);
  });
});

describe('G2 Q16 story order is banded by position', () => {
  const q = { slot: 'g2.english.C.Q16', marks: 6, answer: 'c a b e d f', scheme: { points: 'abcdef'.split('').map((l, i) => ({ text: `Sentence (${l}) comes straight after (${i})`, marks: 1, kind: 'K' })), accept: [] } };
  const run = () => earlyEnglishFixes2({ examJson: { unseen: { x: { y: [q] } }, _layout: { sections: [{ slots: [{ slot: q.slot, type: 'Story Order' }] }] } }, notes: [] });
  test('RED one banded point keeps the 6 marks: all in order full, minus 1 per sentence out of place, never below 0', () => {
    const out = run().examJson.unseen.x.y[0];
    expect(out.scheme.points).toHaveLength(1);
    expect(out.scheme.points[0].marks).toBe(6);
    expect(out.scheme.points[0].text).toMatch(/minus 1 for each sentence out of place/i);
    expect(out.scheme.points[0].text).toMatch(/never below 0/i);
    expect(JSON.stringify(out.scheme)).not.toMatch(/straight after/);
  });
  test('already banded: untouched', () => {
    const once = run().examJson.unseen.x.y[0];
    const again = earlyEnglishFixes2({ examJson: { unseen: { x: { y: [once] } }, _layout: { sections: [{ slots: [{ slot: q.slot, type: 'Story Order' }] }] } }, notes: [] });
    expect(again.examJson.unseen.x.y[0].scheme.points).toEqual(once.scheme.points);
  });
  test('RED the prompt rule scores by position, not adjacency', () => {
    const r = g2s('g2.english.C.Q16').prompt_rule;
    expect(r).toMatch(/minus 1 for each sentence out of place/i);
    expect(r).not.toMatch(/straight after/);
  });
});

describe('G5 English Q2 i: a sentence mark needs a sentence instruction', () => {
  const slot = { slot: 'english.B.Q2' };
  const item = (qs) => ({ slot: 'english.B.Q2', parts: [{ key: 'questions', questions: qs }, { key: 'do_as_directed', questions: [{ question: 'Change to past.', answer: 'x', scheme: { points: [{ text: 'A complete sentence', marks: 1 }] } }] }] });
  const sub = (question, text) => ({ question, answer: 'Maya ran to the shop.', marks: 2, scheme: { points: [{ text: 'Correct content', marks: 1, kind: 'K' }, { text, marks: 1, kind: 'A' }], accept: ['Maya ran to the shop.'] } });
  test('RED the stem gains "Answer in complete sentences." when the scheme pays a sentence', () => {
    const notes = [];
    const out = langFixes(item([sub('Who ran to the shop?', 'Answers in a complete sentence')]), slot, notes);
    expect(out.parts[0].questions[0].question).toBe('Who ran to the shop? Answer in complete sentences.');
    expect(notes.join(' ')).toMatch(/complete sentence/);
  });
  test('a stem that already asks for a sentence is left as it is', () => {
    const q = item([sub('Who ran to the shop? Answer in a full sentence.', 'Answers in a complete sentence')]);
    expect(langFixes(q, slot, []).parts[0].questions[0].question).toBe('Who ran to the shop? Answer in a full sentence.');
  });
  test('a scheme that pays content only is left as it is; part ii is never touched', () => {
    const out = langFixes(item([sub('Who ran?', 'Names the person')]), slot, []);
    expect(out.parts[0].questions[0].question).toBe('Who ran?');
    expect(out.parts[1].questions[0].question).toBe('Change to past.');
  });
  test('RED the prompt rule makes accept lines full sentences', () => {
    const r = G5.subjects.english.sections.flatMap((s) => s.slots).find((s) => s.slot === 'english.B.Q2').prompt_rule;
    expect(r).toMatch(/Answer in complete sentences/);
    expect(r).toMatch(/every accept line is a full sentence/);
  });
});
