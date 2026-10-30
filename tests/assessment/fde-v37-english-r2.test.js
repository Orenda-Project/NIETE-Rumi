/**
 * v37 round 6 English fixes (W-EN): G1 Q4 letters never printed in the answer's order; G5 Q1(b) one direction paid twice;
 * G5 Q9 outline that copies the Q2 passage; prompt rules for G5 Q2 model answers, Q1(b) and Q9.
 */
const { earlyEnglishFixes2 } = require('../../bot/shared/services/assessment/fde-early-english-fixes-2');
const { sameDirection, outlineFromPassage } = require('../../bot/shared/services/assessment/fde-g5-lang-repeats');
const { langGiveaways } = require('../../bot/shared/services/assessment/fde-g5-lang-giveaways');
const G5 = require('../../bot/shared/services/assessment/patterns/fde-g5-2027');

const exam = (list) => ({ unseen: { x: { y: list } }, _layout: { sections: [{ slots: [...new Set(list.map((q) => q.slot))].map((slot) => ({ slot, type: 'y' })) }] } });
const q4 = (question, answer) => ({ slot: 'g1.english.A.Q4', question, answer, scheme: { points: [], accept: [answer] } });
const run = (list) => earlyEnglishFixes2(exam(list));
const slotRule = (id) => G5.subjects.english.sections.flatMap((s) => s.slots).find((x) => x.slot === id).prompt_rule;

describe('G1 Q4 letters are not printed in the answer order', () => {
  test('bee printed as b e e is reordered', () => {
    const { examJson, notes } = run([q4('b e e', 'bee')]);
    const out = examJson.unseen.x.y[0];
    expect(out.question.replace(/ /g, '')).not.toBe('bee');
    expect(out.question.split(' ').sort().join('')).toBe('bee'.split('').sort().join(''));
    expect(notes.join(' ')).toMatch(/Q4/);
  });
  test('cake, drum, hen come out different with the same letters', () => {
    ['cake', 'drum', 'hen'].forEach((w) => {
      const out = run([q4(w.split('').join(' '), w)]).examJson.unseen.x.y[0].question;
      expect(out.replace(/ /g, '')).not.toBe(w);
      expect(out.split(' ').sort().join('')).toBe(w.split('').sort().join(''));
    });
  });
  test('an already mixed item is untouched', () => {
    const { examJson } = run([q4('a h t', 'hat')]);
    expect(examJson.unseen.x.y[0].question).toBe('a h t');
  });
  test('no order differs (aa): flagged in notes, item kept', () => {
    const { examJson, notes } = run([q4('a a', 'aa')]);
    expect(examJson.unseen.x.y[0].question).toBe('a a');
    expect(notes.join(' ')).toMatch(/no other order/i);
  });
});

describe('G5 Q1(b) one direction twice', () => {
  const b = (question) => ({ slot: 'english.A.Q1b', question, answer: 'x' });
  test('two "Change into simple past" items flag the later one', () => {
    const f = sameDirection(exam([b('The baby is sleeping. (Change into simple past)'), b('She likes tea. (Rewrite as a metaphor)'), b('Farid plays football. (Change into simple past)')]));
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ slot: 'english.A.Q1b', reason: 'giveaway', printed: true });
  });
  test('different tenses are fine', () => {
    expect(sameDirection(exam([b('He sleeps. (Change into simple past)'), b('He slept. (Change into simple present)')]))).toEqual([]);
  });
  test('wired into the language give-aways', () => {
    const e = exam([b('A. (Change into simple past)'), b('B. (change into Simple Past)')]);
    expect(langGiveaways(e).length).toBeGreaterThan(0);
  });
});

describe('G5 Q9 outline copies the Q2 passage', () => {
  const passage = { slot: 'english.B.Q2', question: '', passage: 'Omar found a tiny bird trapped under a heavy branch. He pushed the branch, and the bird flew out. His grandmother said kindness is worth more than a bucket. The next morning the bird sang on the gate.' };
  const outline = (t) => ({ slot: 'english.C.Q9', question: t, answer: 'x' });
  test('an outline of the passage events is flagged on Q9', () => {
    const f = outlineFromPassage(exam([passage, outline('A boy finds a tiny bird trapped under a heavy branch — he pushes the branch — the bird flies out — next morning the bird sings — Moral')]));
    expect(f).toHaveLength(1);
    expect(f[0].slot).toBe('english.C.Q9');
  });
  test('an unrelated outline passes', () => {
    expect(outlineFromPassage(exam([passage, outline('Sana loses her kite — she searches the park — a shopkeeper helps her — she finds it — Moral')]))).toEqual([]);
  });
});

describe('G5 prompt rules', () => {
  test('Q2 model answers answer the question as asked and are re-read', () => {
    expect(slotRule('english.B.Q2')).toMatch(/re-read each model answer against its question/i);
    expect(slotRule('english.B.Q2')).toMatch(/no theme or events with the Q9 story/i);
  });
  test('Q1(b) items each test a different tense or form', () => {
    expect(slotRule('english.A.Q1b')).toMatch(/different tense or form/i);
  });
  test('Q9 outline shares no theme or events with the passage', () => {
    expect(slotRule('english.C.Q9')).toMatch(/shares the theme or events of the Q2 passage with no other part/i);
  });
});
