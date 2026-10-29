/**
 * Give-aways that survived v24 (bd-5jmnfj.4.55, Phase 1: red tests). Pure detector + prompt cases;
 * the writer cases (G1 Urdu چاند, G2 Urdu oral question, G1 English oral re-check, G5 end check) are in
 * fde-v25-repeats-writers.test.js.
 *   2 G1 Urdu: «سچ» keys Q5 iii and is Q8 v's prompt word (a two-letter Urdu key is never read).
 *   3 G2 Urdu: Q1 ix asks the oral poem's question; its key «باغ» is only in the oral answer.
 *   4 G1 English: a word heard in a listening or speaking ask is not a give-away; a read-aloud word is.
 *   5 G5 English: «Recycling» is Q6's mind-map topic and a Q8 topic choice (`topics` is never read).
 *   6 G5 Science: Q1(b) and Q2(a)(i) both ask to label the respiratory system.
 *   7 G5 Science: Q3(b) 1 names the three parts Q3(a) 1 asks the child to name.
 *   8 G5 Science: a flag says whether its word is printed (a child sees it) or only in answer text.
 */

const { answerRepeats, answerWord } = require('../../bot/shared/services/assessment/fde-answer-repeats');
const Patterns = require('../../bot/shared/services/assessment/patterns');
const Gen = require('../../bot/shared/services/assessment/assessment-generation.service');

const exam = (...items) => ({ unseen: { subjective: { Q: items } } });
const flagged = (flags, slot) => flags.find((f) => f.slot === slot);
const g5Prompt = (subject, sectionId) => {
  const S = Patterns.get('fde_g5_2027').subjects[subject];
  const sec = S.sections.find((s) => s.id === sectionId);
  return Gen.buildPatternUserPrompt({
    grade: 5, subject, pageContent: 'x', pageReference: '1-100', section: sec, slots: sec.slots, lang: 'en', P: S, scope: { kind: 'fde' },
  });
};

describe('item 2: G1 Urdu two-letter key «سچ»', () => {
  test('a two-letter Urdu key printed as another item\'s prompt word is flagged', () => {
    const flags = answerRepeats(exam(
      { slot: 'g1.urdu.B.Q5', question: 'ہمیں ہمیشہ ___ بولنا چاہیے۔', answer: 'سچ' },
      { slot: 'g1.urdu.B.Q8', question: 'سچ', answer: 'جھوٹ' },
    ));
    const f = flagged(flags, 'g1.urdu.B.Q8');
    expect(f).toBeTruthy();
    expect(f.words).toContain('سچ');
  });

  test('control: a two-letter Urdu function word («کے») keyed in a blank gives nothing away', () => {
    expect(answerRepeats(exam(
      { slot: 'g1.urdu.B.Q5', question: 'یہ علی ___ کتاب ہے۔', answer: 'کے' },
      { slot: 'g1.urdu.B.Q8', question: 'بچوں کے نام لکھیں۔', answer: 'جھوٹ' },
    ))).toEqual([]);
  });

  test('control: an English two-letter key stays below the floor', () => {
    expect(answerWord({ answer: 'is' })).toBeNull();
    expect(answerWord({ answer: 'cat' })).toBe('cat');
  });
});

describe('item 3: G2 Urdu Q1 ix asks the oral poem\'s question', () => {
  const ask = 'بچہ صبح سویرے اٹھ کر کہاں پہنچتا ہے؟';
  const paper = (oralAnswer) => ({
    unseen: { objective: { MCQs: [{ slot: 'g2.urdu.A.Q1', question: `«نظم: صبح کی مسرت» میں ${ask}`,
      options: ['الف) باغ', 'ب) گھر', 'ج) سکول'], answer: 'الف) باغ' }] } },
    _layout: { oral: { tasks: [{ id: 'poem', kind: 'listening' }], content: [{ id: 'poem', items: [{ ask, answer: oralAnswer }] }] } },
  });

  test('the written item asking the same question as an oral item, keyed with its answer, is flagged as oral-question', () => {
    const f = flagged(answerRepeats(paper('باغ میں')), 'g2.urdu.A.Q1');
    expect(f).toBeTruthy();
    expect(f.words).toEqual(['باغ']);
    expect(f.with).toEqual(['oral-question']);
  });

  test('control: the same question with a different oral answer is not flagged', () => {
    expect(answerRepeats(paper('اسکول میں'))).toEqual([]);
  });
});

describe('item 4: G1 English oral give-aways come from read-aloud words only', () => {
  const written = [
    { slot: 'g1.english.A.Q1', question: 'Write the name.', answer: 'dog', picture: { kind: 'object', name: 'dog' } },
    { slot: 'g1.english.B.Q7', question: 'Write the name.', answer: 'bird', picture: { kind: 'object', name: 'bird' } },
    { slot: 'g1.english.B.Q9', question: 'Where do you live? I live at ___.', answer: 'home' },
  ];
  const content = [
    { id: 'listening', items: [{ ask: 'What did Pinky give the bird?' }] },
    { id: 'speaking', items: [{ ask: 'Who helps you at home?' }] },
    { id: 'read_aloud', items: [{ ask: 'dog' }] },
  ];
  const tasks = [{ id: 'listening', kind: 'listening' }, { id: 'speaking', kind: 'speaking' }, { id: 'read_aloud', kind: 'read_aloud' }];

  test('with oral tasks known, only the read-aloud word is a give-away', () => {
    const flags = answerRepeats({ ...exam(...written), _layout: { oral: { tasks, content } } });
    expect(flags.map((f) => f.slot)).toEqual(['g1.english.A.Q1']);
    expect(flags[0].words).toEqual(['dog']);
  });

  test('control: with no task kinds on the sheet, every ask still counts (today\'s behaviour)', () => {
    const flags = answerRepeats({ ...exam(...written), _layout: { oral: { content } } });
    expect(flags.map((f) => f.slot).sort()).toEqual(['g1.english.A.Q1', 'g1.english.B.Q7', 'g1.english.B.Q9']);
  });
});

describe('item 5: G5 English «Recycling» is a mind-map topic and a paragraph topic choice', () => {
  const Q6 = { slot: 'english.C.Q6', question: 'Recycling Can Be Fun', answer: 'Five branches such as sorting paper' };

  test('a one-word topic choice that is another writing question\'s topic is flagged', () => {
    const f = flagged(answerRepeats(exam(Q6, { slot: 'english.C.Q8', answer: 'A paragraph', topics: ['My Super Hero', 'A Cultural Festival', 'Recycling'] })), 'english.C.Q8');
    expect(f).toBeTruthy();
    expect(f.words).toEqual(['recycling']);
  });

  test('control: topic choices unrelated to the mind map stay clean', () => {
    expect(answerRepeats(exam(Q6, { slot: 'english.C.Q8', answer: 'A paragraph', topics: ['My Super Hero'] }))).toEqual([]);
  });

  test('the Section C prompt says a writing topic is never another writing question\'s topic choice', () => {
    expect(g5Prompt('english', 'C')).toMatch(/never the topic or a topic choice of another writing question/);
  });
});

describe('item 6: G5 Science the same respiratory diagram twice', () => {
  const Q1b = { slot: 'science.A.Q1b', question: 'Label any five parts of the human respiratory system.',
    answer: '1) Nasal cavity, 2) Pharynx, 3) Larynx, 4) Trachea, 5) Left lung' };

  test('a later "draw and label" of the same system is flagged', () => {
    expect(flagged(answerRepeats(exam(Q1b, { slot: 'science.B.Q2a', question: 'Draw and label the Respiratory System.', answer: 'A neat diagram…' })), 'science.B.Q2a')).toBeTruthy();
  });

  test('control: a different labelled diagram stays clean', () => {
    expect(answerRepeats(exam(Q1b, { slot: 'science.B.Q2a', question: 'Draw and label the Layers of the Earth.', answer: 'A neat diagram…' }))).toEqual([]);
  });
});

describe('item 7: G5 Science Q3(b) 1 names what Q3(a) 1 asks for', () => {
  test('a "name the three" key whose parts another item\'s stem prints is flagged on the later item', () => {
    const f = flagged(answerRepeats(exam(
      { slot: 'science.C.Q3a', question: 'Name the three main parts of the circulatory system.', answer: 'The heart, the blood vessels and the blood make up the circulatory system.' },
      { slot: 'science.C.Q3b', question: 'Describe how the circulatory system works. Explain the jobs of the heart, blood vessels and blood.', answer: 'The heart pumps blood.' },
    )), 'science.C.Q3b');
    expect(f).toBeTruthy();
    expect(f.words).toEqual(expect.arrayContaining(['heart', 'blood']));
  });

  test('control: a "name two" key no other stem prints stays clean', () => {
    expect(answerRepeats(exam(
      { slot: 'science.C.Q3a', question: 'Name two states of matter.', answer: 'Solid and liquid.' },
      { slot: 'science.C.Q3b', question: 'Describe how the circulatory system works.', answer: 'The heart pumps blood.' },
    ))).toEqual([]);
  });

  test('the Section C science prompt forbids a long question naming what a short question asks', () => {
    expect(g5Prompt('science', 'C')).toMatch(/never names the parts, examples or facts that a Q3\(a\)/);
  });
});

describe('item 8: a flag says whether a child can see its word', () => {
  const Q1a = { slot: 'science.A.Q1a', question: 'Which organ do we smell with?', options: ['a) Eye', 'b) Ear', 'c) Nose', 'd) Tongue'], answer: 'c) Nose' };

  test('a key printed in another item\'s stem is a printed flag', () => {
    const f = flagged(answerRepeats(exam(Q1a, { slot: 'science.C.Q3a', question: 'How does the nose help us smell?', answer: 'It takes in smells.' })), 'science.C.Q3a');
    expect(f).toBeTruthy();
    expect(f.printed).toBe(true);
  });

  test('control: a key found only in another item\'s answer text is flagged but not printed', () => {
    const f = flagged(answerRepeats(exam(Q1a, { slot: 'science.C.Q3a', question: 'How do we smell things?', answer: 'Smells enter the nose and reach the brain.' })), 'science.C.Q3a');
    expect(f).toBeTruthy();
    expect(f.printed).toBeFalsy();
  });
});
