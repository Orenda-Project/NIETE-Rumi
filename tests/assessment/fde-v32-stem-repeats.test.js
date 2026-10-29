/**
 * bd-5jmnfj.33.3 — repeats the v31 Grade 3-4 papers carried past the give-away check.
 *  G4 Science Q1 ii and Q3 i both asked "What is a vacuum?" (the MCQ option is the short answer).
 *  G4 English Q3 i keyed "Taleemabad" and Q3 iv printed it in its stem; Q1 keyed "to the sea" and
 *  Q3 iii printed "the sea" in its stem.
 *  G3 Urdu Q4 i keyed «کہانیاں» and Q5 iv printed its singular «کہانی».
 *  G3 GK Q1 and Q3 asked the same Urdu question with two words changed.
 * The flags merge into answerRepeats so the re-ask loop names them.
 */

const { stemRepeats } = require('../../bot/shared/services/assessment/fde-stem-repeats');
const { answerRepeats } = require('../../bot/shared/services/assessment/fde-answer-repeats');

const exam = (slots, lists) => ({ _layout: { sections: [{ id: 'X', slots: slots.map((slot) => ({ slot })) }] }, unseen: { x: lists } });
const byslot = (flags, slot) => flags.find((f) => f.slot === slot);

describe('the same stem twice', () => {
  const vacuum = exam(['g4.science.A.mcq', 'g4.science.B.short'], {
    MCQs: [{ slot: 'g4.science.A.mcq', question: 'What is a vacuum?', answer: 'a) An area containing no matter',
      options: ['a) An area containing no matter', 'b) A very cold place', 'c) A tank full of water', 'd) A kind of metal'] }],
    Short: [{ slot: 'g4.science.B.short', question: 'What is a vacuum?', answer: 'A vacuum is an area that has no matter in it.' }],
  });

  test('G4 Science "What is a vacuum?" as MCQ and short answer flags the later slot', () => {
    const f = byslot(stemRepeats(vacuum), 'g4.science.B.short');
    expect(f).toMatchObject({ reason: 'giveaway', printed: true, with: ['g4.science.A.mcq'] });
    expect(f.words).toContain('vacuum');
    expect(f.text[0]).toBe('What is a vacuum?');
    expect(byslot(stemRepeats(vacuum), 'g4.science.A.mcq')).toBeUndefined();
  });

  test('and answerRepeats carries the flag', () => {
    expect(byslot(answerRepeats(vacuum), 'g4.science.B.short')).toMatchObject({ with: expect.arrayContaining(['g4.science.A.mcq']) });
  });

  test('G3 GK: an Urdu stem repeated with two words changed flags the later slot', () => {
    const gk = exam(['g3.general_knowledge.A.mcq', 'g3.general_knowledge.B.short'], {
      MCQs: [{ slot: 'g3.general_knowledge.A.mcq', question: 'اگر جھگڑے پر قابو نہ پایا جائے تو کیا ہو سکتا ہے؟', answer: 'a) لڑائی',
        options: ['a) لڑائی', 'b) صلح', 'c) خوشی', 'd) کھیل'] }],
      Short: [{ slot: 'g3.general_knowledge.B.short', question: 'اگر اختلاف پر قابو نہ پایا جائے تو کیا ہوتا ہے؟', answer: 'لڑائی ہو جاتی ہے۔' }],
    });
    expect(byslot(stemRepeats(gk), 'g3.general_knowledge.B.short')).toMatchObject({ with: ['g3.general_knowledge.A.mcq'] });
  });

  test('two short parallel Urdu asks on different words are not a repeat', () => {
    const meanings = exam(['g3.urdu.B.meanings', 'g3.urdu.C.sentences'], {
      M: [{ slot: 'g3.urdu.B.meanings', question: 'لفظ «سہولیات» کے معنی لکھیں۔', answer: 'آسانیاں' }],
      S: [{ slot: 'g3.urdu.C.sentences', question: 'لفظ «بازار» کے معنی لکھیں۔', answer: 'منڈی' }],
    });
    expect(stemRepeats(meanings)).toEqual([]);
    const sums = exam(['g3.maths.A.directed', 'g3.maths.B.short'], {
      A: [{ slot: 'g3.maths.A.directed', question: 'Multiply: 92 x 4', answer: '368' }],
      B: [{ slot: 'g3.maths.B.short', question: 'Multiply: 125 x 3', answer: '375' }],
    });
    expect(stemRepeats(sums)).toEqual([]);
  });
});

describe('a key word printed in another stem', () => {
  test('G4 English: the MCQ key "to the sea" is printed in a Q3 stem', () => {
    const en = exam(['g4.english.A.mcq', 'g4.english.B.short'], {
      MCQs: [{ slot: 'g4.english.A.mcq', question: 'Where did the strong river currents finally carry the bottle?', answer: 'a) to the sea',
        options: ['a) to the sea', 'b) to a lake', 'c) to the school', 'd) to a farm'] }],
      Short: [{ slot: 'g4.english.B.short', question: 'What carried the bottle from the river all the way to the sea?', answer: 'The river currents carried it.' }],
    });
    const f = byslot(stemRepeats(en), 'g4.english.B.short');
    expect(f).toMatchObject({ with: ['g4.english.A.mcq'] });
    expect(f.words).toContain('sea');
  });

  test('G4 English: a place name in a key printed in a later stem of the same slot', () => {
    const en = exam(['g4.english.B.short'], {
      Short: [
        { slot: 'g4.english.B.short', question: 'In which city does the story of the plastic bottle take place?', answer: 'The story takes place in the city of Taleemabad.' },
        { slot: 'g4.english.B.short', question: 'What did the fisherman do with the bottle?', answer: 'He threw it back into the sea.' },
        { slot: 'g4.english.B.short', question: 'How did the children of Taleemabad help the sea and beach?', answer: 'They picked up the plastic from the beach.' },
      ],
    });
    const f = byslot(stemRepeats(en), 'g4.english.B.short');
    expect(f).toMatchObject({ with: ['g4.english.B.short'] });
    expect(f.words).toContain('taleemabad');
    expect(f.text[0]).toBe('In which city does the story of the plastic bottle take place?');
  });

  test('an MCQ key of three or more content words is not matched against stems', () => {
    const en = exam(['g4.english.A.mcq', 'g4.english.B.short'], {
      MCQs: [{ slot: 'g4.english.A.mcq', question: 'How did the bottle reach the sea?', answer: 'c) The river currents carried it.',
        options: ['a) A boy threw it.', 'b) A bird took it.', 'c) The river currents carried it.', 'd) A truck brought it.'] }],
      Short: [{ slot: 'g4.english.B.short', question: 'Why did the river look dirty?', answer: 'Because of the plastic.' }],
    });
    expect(stemRepeats(en)).toEqual([]);
  });
});

describe('an Urdu plural key against its singular in another stem', () => {
  test('G3 Urdu: «کہانیاں» keyed in Q4 and «کہانی» printed in Q5 flags Q5', () => {
    const ur = exam(['g3.urdu.B.grammar', 'g3.urdu.C.sentences'], {
      G: [{ slot: 'g3.urdu.B.grammar', question: 'لفظ «کہانی» کی جمع لکھیں۔', answer: 'کہانیاں' }],
      S: [{ slot: 'g3.urdu.C.sentences', question: 'لفظ «کہانی» کو جملے میں استعمال کریں۔', answer: 'میں نے ایک کہانی پڑھی۔' }],
    });
    const f = byslot(stemRepeats(ur), 'g3.urdu.C.sentences');
    expect(f).toMatchObject({ with: ['g3.urdu.B.grammar'] });
    expect(f.words).toContain('کہانی');
  });

  test('a plural key whose singular appears nowhere else is not flagged', () => {
    const ur = exam(['g3.urdu.B.grammar', 'g3.urdu.C.sentences'], {
      G: [{ slot: 'g3.urdu.B.grammar', question: 'لفظ «کتاب» کی جمع لکھیں۔', answer: 'کتابیں' }],
      S: [{ slot: 'g3.urdu.C.sentences', question: 'لفظ «بازار» کو جملے میں استعمال کریں۔', answer: 'ہم بازار گئے۔' }],
    });
    expect(stemRepeats(ur)).toEqual([]);
  });
});

describe('only a Grade 3-4 paper is checked', () => {
  test('a Grade 1 picture paper asking "Write the name." under every picture, and a Grade 5 paper, get no stem flags', () => {
    const g1 = exam(['g1.english.A.Q1', 'g1.english.B.Q7'], { Q: [
      { slot: 'g1.english.A.Q1', question: 'Write the name.', answer: 'dog', picture: { kind: 'object', name: 'dog' } },
      { slot: 'g1.english.B.Q7', question: 'Write the name.', answer: 'bird', picture: { kind: 'object', name: 'bird' } },
    ] });
    expect(stemRepeats(g1)).toEqual([]);
    const g5 = exam(['science.A.Q1', 'science.B.Q2a'], { Q: [
      { slot: 'science.A.Q1', question: 'What is a vacuum?', answer: 'a) No matter', options: ['a) No matter', 'b) Water'] },
      { slot: 'science.B.Q2a', question: 'What is a vacuum?', answer: 'A space with no matter.' },
    ] });
    expect(stemRepeats(g5)).toEqual([]);
  });
});
