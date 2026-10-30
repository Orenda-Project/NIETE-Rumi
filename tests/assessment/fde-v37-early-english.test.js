/**
 * v37 Grade 1-2 English (round 6, W-EN-early): prompt rules for the Q9 word box, Q14 capitals, the Q10 prepositions,
 * the Q1 passage items, the read-aloud possessive and the speaking rubric; code checks for a word-box word that
 * answers another item and for a phrase of a heard oral answer printed in a written stem.
 */

const G1 = require('../../bot/shared/services/assessment/patterns/early/g1-english');
const G2 = require('../../bot/shared/services/assessment/patterns/early/g2-english');
const { earlyGiveaways } = require('../../bot/shared/services/assessment/fde-early-giveaways');

const slotOf = (subject, id) => subject.sections.flatMap((s) => s.slots).find((x) => x.slot === id);
const taskOf = (subject, id) => subject.oral.tasks.find((t) => t.id === id);
const rule = (subject, id) => slotOf(subject, id).prompt_rule;

describe('G1 Q9 word box (v35 Q9 iii hear/sing, v) Dadi, Pinky)', () => {
  const r = rule(G1, 'g1.english.B.Q9');
  test('the writer tries every other box word in each blank and rewrites a sentence a second word fits', () => {
    expect(r).toMatch(/try every other box word/i);
    expect(r).toMatch(/second word/i);
  });
  test('a hear/sing pair and a weak verb distractor are named as the failure', () => {
    expect(r).toMatch(/hear/);
    expect(r).toMatch(/wash/);
  });
  test('no person is named in a Q9 sentence: the child has no context for it', () => {
    expect(r).toMatch(/no person's name/i);
  });
  test('no sentence repeats the oral listening story', () => {
    expect(r).toMatch(/listening story/i);
  });
});

describe('G1 Q14 instruction counts the capitals', () => {
  const s = slotOf(G1, 'g1.english.C.Q14');
  test('asks for capital letters, plural', () => {
    expect(s.instruction_en).toMatch(/capital letters/i);
    expect(s.instruction_en).not.toMatch(/a capital letter/i);
  });
});

describe('G1 oral', () => {
  test('listening story never prints a phrase the written paper prints', () => {
    expect(taskOf(G1, 'listening').ask).toMatch(/never a phrase the written paper prints/i);
  });
  test('speaking task time matches the rubric time', () => {
    const t = taskOf(G1, 'speaking');
    expect(t.instruction_en).toMatch(/half a minute/i);
    expect(t.instruction_en).not.toMatch(/about a minute/i);
    expect(t.instruction_ur).not.toMatch(/ایک منٹ/);
  });
  test('every rubric row worth 2 says what earns 1', () => {
    taskOf(G1, 'speaking').rubric.filter((r) => r.marks === 2).forEach((r) => {
      expect(r.en).toMatch(/\b1 (for|with|if)\b/);
      expect(r.ur).toMatch(/1/);
    });
  });
});

describe('G2', () => {
  test('Q10: one true preposition per scene, near is never a second', () => {
    const r = rule(G2, 'g2.english.B.Q10');
    expect(r).toMatch(/only one of the five words is true/i);
    expect(r).toMatch(/near/);
    expect(r).toMatch(/accept/);
    expect(r).toMatch(/repeat one/i);
  });
  test('Q1: no stem prints an earlier answer, and no two questions pay one fact', () => {
    const r = rule(G2, 'g2.english.A.Q1');
    expect(r).toMatch(/never prints the answer to an earlier question/i);
    expect(r).toMatch(/no two questions .*same fact/i);
  });
  test('read aloud text is copied as printed, possessives keep the apostrophe, and is grammatical', () => {
    const a = taskOf(G2, 'read_aloud').ask;
    expect(a).toMatch(/apostrophe/i);
    expect(a).toMatch(/Pinky's eyes/);
    expect(a).toMatch(/grammatical/i);
  });
  test('speaking task time matches the rubric time and the 2-mark rows say what earns 1', () => {
    const t = taskOf(G2, 'speaking');
    expect(t.instruction_en).toMatch(/half a minute/i);
    expect(t.instruction_ur).not.toMatch(/ایک منٹ/);
    t.rubric.filter((r) => r.marks === 2).forEach((r) => expect(r.en).toMatch(/\b1 (for|with|if)\b/));
  });
});

describe('word-box words that answer another item', () => {
  const item = (slot, extra) => ({ slot, scheme: { points: [], accept: [] }, ...extra });
  const paper = (box, sixes, elevens) => ({ unseen: { subjective: {
    'Complete the Sentences': [item('g1.english.B.Q9', { question: 'We ___ our hands.', answer: 'wash', words: box })],
    'Rhyming Pairs': [item('g1.english.B.Q6', { question: 'ring', answer: 'sing', scheme: { points: [], accept: ['sing', 'wing'] } })],
    'Complete the Words': [item('g1.english.C.Q11', { question: 't r _ _ n', answer: 'ai', scheme: { points: [], accept: ['train'] } })],
  } } });
  test('Q9 box «sing» (Q6 accepts it) and «train» (Q11 accepts it) are flagged on Q9', () => {
    const f = earlyGiveaways(paper(['wash', 'sing', 'train', 'cross', 'hear']));
    const q9 = f.find((x) => x.slot === 'g1.english.B.Q9');
    expect(q9).toBeDefined();
    expect(q9.words).toEqual(expect.arrayContaining(['sing', 'train']));
    expect(q9.with).toEqual(expect.arrayContaining(['g1.english.B.Q6', 'g1.english.C.Q11']));
  });
  test('a box that answers nothing else is clean', () => {
    expect(earlyGiveaways(paper(['wash', 'cross', 'hear']))).toEqual([]);
  });
});

describe('a phrase of a heard oral answer printed in a written stem', () => {
  const exam = (stem) => ({
    unseen: { subjective: { 'Complete the Sentences': [{ slot: 'g1.english.B.Q9', question: stem, answer: 'sing', scheme: { points: [], accept: ['sing'] } }] } },
    _layout: { oral: {
      tasks: [{ id: 'listening', kind: 'listening' }, { id: 'read_aloud', kind: 'read_aloud' }],
      content: [
        { id: 'listening', script: 'The bird sang sweet songs.', items: [{ ask: 'What did the bird do after days passed?', answer: 'It sang sweet songs.' }] },
        { id: 'read_aloud', items: [{ ask: 'cat', answer: '' }] },
      ] } },
  });
  test('«sweet songs» in Q9 is flagged against the oral answer, as oral-answer', () => {
    const f = earlyGiveaways(exam('The little bird can ___ sweet songs.'));
    expect(f).toHaveLength(1);
    expect(f[0].slot).toBe('g1.english.B.Q9');
    expect(f[0].words).toContain('sweet songs');
    expect(f[0].with).toEqual(['oral-answer']);
  });
  test('an unrelated stem is clean', () => {
    expect(earlyGiveaways(exam('We ___ our hands before we eat.'))).toEqual([]);
  });
  test('a phrase already in the oral question is not a give-away', () => {
    const e = exam('We like ___ sweet songs.');
    e._layout.oral.content[0].items[0].ask = 'What are sweet songs?';
    expect(earlyGiveaways(e)).toEqual([]);
  });
});
