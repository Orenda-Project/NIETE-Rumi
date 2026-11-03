/**
 * v25 repeats the give-away check missed (bd-5jmnfj.4.57).
 * G2 Urdu: بندر in Q2's order list, Q3's «بندروں» and Q4's stem; مکڑا in Q2 and in Q1 viii's choices;
 * Q1 ii keyed «بغیر روشنی کے» for اندھیری beside Opposites «روشنی → اندھیرا».
 * G1 Urdu: چاند as a Make Sentences word, a wrong choice in Q1 and in a Q5 stem.
 * G5 Urdu: دندان ساز as a choice, a word to define and a word to split.
 * G5 Science: three MCQs that answer a Section C question, and a magnet MCQ that answers a Logical
 * Reasoning sub-question. G2 English: a written stem asking a listening item's question.
 */

const { answerRepeats } = require('../../bot/shared/services/assessment/fde-answer-repeats');
const { nearRepeats } = require('../../bot/shared/services/assessment/fde-near-repeats');

const item = (slot, question, answer, extra = {}) => ({ slot, question, answer, ...extra });
const paper = (byType, slots, oral) => ({
  unseen: { subjective: byType },
  _layout: { sections: [{ id: 'A', slots: slots.map(([slot, type]) => ({ slot, type })) }], ...(oral ? { oral } : {}) },
});
const flagged = (flags) => flags.map((f) => [f.slot, ...f.words].join(' '));

describe('Urdu repeats', () => {
  const g2 = () => paper({
    MCQs: [item('g2.urdu.A.Q1', 'مکالمے میں کس نے بھنورے سے بات کی؟', 'ب) مکڑا', { options: ['الف) تتلی', 'ب) مکڑا', 'ج) تتیا'] })],
    'Alphabetical Order': [item('g2.urdu.A.Q2', 'انگور، تربوز، بندر', 'انگور، بندر، تربوز'), item('g2.urdu.A.Q2', 'مکڑا، خواب، ٹڈی', 'ٹڈی، خواب، مکڑا')],
    'Complete the Sentences': [item('g2.urdu.A.Q3', 'بندروں نے لڑکے کی ___ پکڑ رکھی تھیں۔', 'ٹوپی')],
  }, [['g2.urdu.A.Q1', 'MCQs'], ['g2.urdu.A.Q2', 'Alphabetical Order'], ['g2.urdu.A.Q3', 'Complete the Sentences']]);

  test('an order-list word printed elsewhere is a give-away (بندر / بندروں)', () => {
    expect(flagged(answerRepeats(g2()))).toEqual(expect.arrayContaining([expect.stringMatching(/^g2\.urdu\.A\.Q3 .*بندر/)]));
  });

  test('an order-list word that is another item\'s key is a give-away (مکڑا)', () => {
    expect(flagged(answerRepeats(g2()))).toEqual(expect.arrayContaining([expect.stringMatching(/^g2\.urdu\.A\.Q2 .*مکڑا/)]));
  });

  test('اندھیری in a stem gives away the opposite key اندھیرا', () => {
    const p = paper({
      MCQs: [item('g2.urdu.A.Q1', '«اندھیری» کا مطلب کیا ہے؟', 'ج) بغیر روشنی کے', { options: ['الف) روشن', 'ب) ٹھنڈی', 'ج) بغیر روشنی کے'] })],
      Opposites: [item('g2.urdu.A.Q6', 'روشنی', 'اندھیرا')],
    }, [['g2.urdu.A.Q1', 'MCQs'], ['g2.urdu.A.Q6', 'Opposites']]);
    expect(flagged(answerRepeats(p))).toEqual(expect.arrayContaining([expect.stringMatching(/^g2\.urdu\.A\.Q6 .*اندھیر/)]));
  });

  test('G1 Urdu: a Make Sentences word printed in a choice and a stem is a give-away (چاند)', () => {
    const p = paper({
      MCQs: [item('g1.urdu.A.Q1', 'کون سا لفظ «ب» سے شروع ہوتا ہے؟', 'الف) بادل', { options: ['الف) بادل', 'ب) چاند', 'ج) سورج'] })],
      'Fill in the Blanks': [item('g1.urdu.B.Q5', 'چاند پارٹی میں رنگ برنگے ___ چمکے۔', 'غبارے')],
      'Make Sentences': [item('g1.urdu.B.Q9', 'چاند', 'رات کو آسمان پر چاند نکلتا ہے۔')],
    }, [['g1.urdu.A.Q1', 'MCQs'], ['g1.urdu.B.Q5', 'Fill in the Blanks'], ['g1.urdu.B.Q9', 'Make Sentences']]);
    expect(flagged(answerRepeats(p))).toEqual(expect.arrayContaining([expect.stringMatching(/^g1\.urdu\.B\.Q9 .*چاند/)]));
  });

  test('G5 Urdu: a two-word term (دندان ساز) printed in a choice and a word list is a give-away', () => {
    const p = paper({
      MCQs: [item('urdu.A.Q1', 'زندگی کے ساتھی کو کیا کہتے ہیں؟', 'ب) شریکِ حیات', { options: ['الف) اہل و عیال', 'ب) شریکِ حیات', 'ج) راہ گیر', 'د) دندان ساز'] })],
      'Rewrite Sentences': [item('urdu.C.Q4', 'ارکان سازی: درج ذیل الفاظ کو ان کے ارکان میں الگ کریں: دندان ساز، مشغول۔', 'دن – دا – ن – ساز؛ مش – غول')],
    }, [['urdu.A.Q1', 'MCQs'], ['urdu.C.Q4', 'Rewrite Sentences']]);
    expect(flagged(answerRepeats(p))).toEqual(expect.arrayContaining([expect.stringMatching(/^urdu\.C\.Q4 .*دندان ساز/)]));
  });

  test('an Urdu plural in an unrelated stem is not the order word: two short words stay apart (ٹڈی / ٹڈے not stemmed to 2 letters)', () => {
    const p = paper({
      'Alphabetical Order': [item('g2.urdu.A.Q2', 'مکڑا، خواب، ٹڈی', 'ٹڈی، خواب، مکڑا')],
      Verbs: [item('g2.urdu.A.Q4', 'ٹڈا گانا گاتا ہے۔', 'گاتا ہے')],
    }, [['g2.urdu.A.Q2', 'Alphabetical Order'], ['g2.urdu.A.Q4', 'Verbs']]);
    expect(answerRepeats(p)).toEqual([]);
  });
});

const sci = (byType) => paper(byType, [['science.A.Q1a', 'MCQs'], ['science.B.Q2b', 'Logical Reasoning'], ['science.C.Q3a', 'Brief Answers']]);
const MCQ = {
  space: item('science.A.Q1a', 'Why can nobody hear a sound made in outer space?', 'a) Sound needs a medium to travel and space has none',
    { options: ['a) Sound needs a medium to travel and space has none', 'b) Space is too cold', 'c) Sound is too fast', 'd) Space is too dark'] }),
  pulse: item('science.A.Q1a', "Why does a child's pulse rate rise while running?", 'b) The muscles need more oxygen',
    { options: ['a) The heart gets smaller', 'b) The muscles need more oxygen', 'c) The lungs stop working', 'd) The blood gets colder'] }),
  egg: item('science.A.Q1a', 'A cook fries an egg in a pan. Which statement is correct?', 'a) It is a chemical change because a new substance forms and cannot be reversed',
    { options: ['a) It is a chemical change because a new substance forms and cannot be reversed', 'b) It is a physical change because it can be undone', 'c) It is a physical change because only the shape changes', 'd) No change takes place'] }),
  magnet: item('science.A.Q1a', 'What happens when the north poles of two magnets are brought close together?', 'b) They repel each other',
    { options: ['a) They attract each other', 'b) They repel each other', 'c) Nothing happens', 'd) They lose their magnetism'] }),
};
const BRIEF = {
  space: item('science.C.Q3a', 'Why can nobody hear a sound made in outer space?', 'Sound needs a medium such as air to travel. Space has no air, so sound cannot travel there.'),
  pulse: item('science.C.Q3a', "After a race, a child's pulse rate is higher than before the race. Why does this happen?", 'Running makes the muscles need more oxygen, so the heart beats faster to pump more blood.'),
  egg: item('science.C.Q3a', 'Is boiling an egg a physical change or a chemical change? Give a reason.', 'It is a chemical change. A new substance forms and the change cannot be reversed.'),
  plant: item('science.C.Q3a', 'Why do plants need sunlight?', 'Plants use sunlight to make their own food.'),
};
const MAGNET_LR = item('science.B.Q2b', 'Sara has two bar magnets on her desk.', '', {
  questions: [{ question: 'a) What is a magnet?', answer: 'An object that attracts iron.' }, { question: 'c) What happens when she brings the two north poles together?', answer: 'They repel each other.' }],
});

describe('nearRepeats (G5 Science)', () => {
  test('the same stem twice, word for word (outer space)', () => {
    const flags = nearRepeats(sci({ MCQs: [MCQ.space], 'Brief Answers': [BRIEF.space] }));
    expect(flags.map((f) => f.slot)).toEqual(['science.C.Q3a']);
    expect(flags[0].reason).toBe('giveaway');
  });

  test('an MCQ key that is most of a later answer (pulse, muscles need more oxygen)', () => {
    expect(nearRepeats(sci({ MCQs: [MCQ.pulse], 'Brief Answers': [BRIEF.pulse] })).map((f) => f.slot)).toEqual(['science.C.Q3a']);
  });

  test('frying an egg answers boiling an egg (chemical change, new substance, cannot be reversed)', () => {
    expect(nearRepeats(sci({ MCQs: [MCQ.egg], 'Brief Answers': [BRIEF.egg] })).map((f) => f.slot)).toEqual(['science.C.Q3a']);
  });

  test('the magnet MCQ answers a Logical Reasoning sub-question', () => {
    expect(nearRepeats(sci({ MCQs: [MCQ.magnet], 'Logical Reasoning': [MAGNET_LR] })).map((f) => f.slot)).toEqual(['science.B.Q2b']);
  });

  test('unrelated questions on one topic are not flagged', () => {
    expect(nearRepeats(sci({ MCQs: [MCQ.space, MCQ.magnet], 'Brief Answers': [BRIEF.plant] }))).toEqual([]);
  });

  test('items inside one slot are not compared (a matching list repeats its own words)', () => {
    expect(nearRepeats(sci({ MCQs: [MCQ.space, { ...MCQ.space }] }))).toEqual([]);
  });

  test('answerRepeats carries the near-repeat flags', () => {
    expect(answerRepeats(sci({ MCQs: [MCQ.egg], 'Brief Answers': [BRIEF.egg] })).map((f) => f.slot)).toContain('science.C.Q3a');
  });

  test('a slot\'s formula stem is not content: every item says it, so two slots sharing it are not repeats', () => {
    const formula = (slot, n) => Array.from({ length: n }, (_, i) => item(slot, `Look at the picture and write its name ${i + 1}`, ['cat', 'dog', 'sun'][i]));
    expect(nearRepeats(sci({ MCQs: formula('science.A.Q1a', 3), 'Brief Answers': formula('science.C.Q3a', 3) }))).toEqual([]);
  });

  test('words every slot\'s stems say are the paper\'s formula: two one-item slots sharing only them are not repeats', () => {
    const one = (slot) => [item(slot, `Question 1 for the general knowledge part ${slot}`, '1')];
    expect(nearRepeats(sci({ MCQs: one('science.A.Q1a'), 'Logical Reasoning': one('science.B.Q2b'), 'Brief Answers': one('science.C.Q3a') }))).toEqual([]);
  });

  test('no exam, no flags', () => {
    expect(nearRepeats(null)).toEqual([]);
  });
});

describe('a written stem asking a listening item (G2 English Q5 i)', () => {
  const oral = {
    tasks: [{ id: 'listen', kind: 'listening' }],
    content: [{ id: 'listen', script: 'Pinky went to the park with her brother.', items: [{ ask: 'Where did Pinky go?', answer: 'To the park.' }] }],
  };
  test('a stem naming the listening item\'s person beside its answer word is flagged as the oral answer', () => {
    const p = paper({ 'Is Am Are': [item('g2.english.B.Q5', 'Pinky ____ at the park today.', 'is', { options: ['are', 'is', 'am'] })] },
      [['g2.english.B.Q5', 'Is Am Are']], oral);
    const f = answerRepeats(p).find((x) => x.slot === 'g2.english.B.Q5');
    expect(f).toBeDefined();
    expect(f.with).toContain('oral-answer');
  });

  test('a stem with the name but not the answer passes', () => {
    const p = paper({ 'Is Am Are': [item('g2.english.B.Q5', 'Pinky ____ a happy girl.', 'is', { options: ['are', 'is', 'am'] })] },
      [['g2.english.B.Q5', 'Is Am Are']], oral);
    expect(answerRepeats(p)).toEqual([]);
  });
});
