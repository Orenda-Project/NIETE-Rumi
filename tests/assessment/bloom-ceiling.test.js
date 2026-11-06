/**
 * bd-rvbv9o.1 — the Bloom's tag a question can honestly carry, read from its shape.
 *
 * The writer tags its own questions and nothing checked them: an audit of 40 prod papers
 * (5 Nov 2026) found bare sums and one-word blanks tagged Apply, a "favourite" opinion tagged
 * Evaluate, and "which number is largest" tagged Analyze. Rule (Amena, 5 Nov): working a
 * just-taught procedure on a bare item is Understand; Apply needs a new situation.
 * A ceiling only ever lowers a tag; it never raises one. Every case below is a real prod item.
 */
const { ceilingFor, capBlooms, appliesToGrade } = require('../../bot/shared/services/assessment/bloom-ceiling');

const q = (question, blooms, extra = {}) => ({ question, blooms, marks: 1, ...extra });

describe('ceilingFor — bare computation is Understand', () => {
  test.each([
    '250 - 125 = ?',
    '450 - 30 = ______',
    'Subtract 34 from 89.',
    'What is the product of 7 and 5?',
    'Solve 52 - 18.',
    'Find the value of 4 groups of 10.',
    'Multiply 14 by 2.',
    'Estimate the sum of 38 and 44.',
    'Subtracting 5 from 100 gives _______ .',
    'Complete the skip counting pattern: 5, 10, 15, __, __.',
  ])('%s', (text) => {
    expect(ceilingFor(q(text, 'Apply'))).toBe('Understand');
  });
});

describe('ceilingFor — a short sentence blank is Understand', () => {
  test.each([
    'It is raining very ________.',
    'My dog is sleeping ________.',
    'The sky is __________ (blue/yellow).',
    'Yesterday, I ___________ (play/played) with my friends in the park.',
    'She is __________ her lunch. (eat)',
  ])('%s', (text) => {
    expect(ceilingFor(q(text, 'Apply'))).toBe('Understand');
  });
});

describe('ceilingFor — one-mark selected or opinion items are never above Understand', () => {
  test('MCQ "which is largest" tagged Analyze', () => {
    const item = q('Which of the following numbers is the largest?', 'Analyze', {
      options: ['A) 6,789,123', 'B) 6,897,231', 'C) 6,987,321', 'D) 6,798,321'],
    });
    expect(ceilingFor(item)).toBe('Understand');
  });
  test('True/False tagged Evaluate', () => {
    expect(ceilingFor(q("We say 'What's up?' to our school principal.", 'Evaluate', { answer: 'False' })))
      .toBe('Understand');
  });
  test('one-mark favourite tagged Evaluate', () => {
    expect(ceilingFor(q('What was your favourite mode of transport?', 'Evaluate'))).toBe('Understand');
  });
});

describe('ceilingFor — retelling is Understand', () => {
  test.each([
    'شعب ابی طالب کا پس منظر اپنے الفاظ میں بیان کریں۔',
    'Describe the water cycle in your own words.',
  ])('%s', (text) => {
    expect(ceilingFor(q(text, 'Analyze', { marks: 5 }))).toBe('Understand');
  });
});

describe('ceilingFor — real higher-order items keep their tag (null = no ceiling)', () => {
  test.each([
    ['A shopkeeper sells 8 kg of rice for Rs. 960. How many rupees will 5 kg of the same rice cost?', 'Apply', 5],
    ['Babloo had Rs. 250. After spending Rs. 100, he has _____ left.', 'Apply', 1],
    ['Bunty had 123 rupees. She spent 32 rupees on a book. How much money does she have left?', 'Apply', 7],
    ['In a field, grass is eaten by a rabbit and the rabbit is eaten by a fox. What would happen to the fox and to the grass if all the rabbits disappeared? Give reasons.', 'Apply', 5],
    ["Write an opinion piece on the topic 'Is space exploration important?'. Include an introduction, your opinion, supporting reasons, and a concluding statement.", 'Evaluate', 7],
    ['Create one question each starting with: Who, What, When, Where, Why about space.', 'Create', 5],
    ['نیچے دیے گئے وسائل کو قدرتی، انسانی اور سرمائے کے وسائل میں تقسیم کریں: دریا، درزی، کارخانہ، جنگلات، ہوائی جہاز۔', 'Analyze', 10],
    ['کردار کا تجزیہ کریں اور اپنے الفاظ میں بیان کریں۔', 'Analyze', 5],
  ])('%s', (text, blooms, marks) => {
    expect(ceilingFor(q(text, blooms, { marks }))).toBeNull();
  });
});

describe('capBlooms — walks a paper, only lowers, reports what moved', () => {
  const paper = () => ({
    seen: {
      objective: {
        MCQs: [q('250 - 125 = ?', 'Apply', { options: ['A) 115', 'B) 125'] })],
        'Fill in the blanks': [q('It is raining very ________.', 'Remember')],
      },
      subjective: {
        'Word Problems': [q('Ammi bought groceries worth Rs. 632. She gave the shopkeeper Rs. 700. How much money did she get back?', 'Apply', { marks: 7 })],
      },
    },
    unseen: { objective: { 'True/False': [q("'The sun is hot' is a fact.", 'Analyze', { answer: 'True' })] } },
  });

  test('lowers inflated tags and leaves the rest', () => {
    const p = paper();
    const moved = capBlooms(p);
    expect(p.seen.objective.MCQs[0].blooms).toBe('Understand');
    expect(p.seen.objective['Fill in the blanks'][0].blooms).toBe('Remember'); // never raised
    expect(p.seen.subjective['Word Problems'][0].blooms).toBe('Apply');
    expect(p.unseen.objective['True/False'][0].blooms).toBe('Understand');
    expect(moved).toEqual([
      { question: '250 - 125 = ?', from: 'Apply', to: 'Understand' },
      { question: "'The sun is hot' is a fact.", from: 'Analyze', to: 'Understand' },
    ]);
  });

  test('untagged or unknown tags are left alone', () => {
    const p = { seen: { objective: { MCQs: [q('250 - 125 = ?', undefined), q('450 - 30 = ___', 'Spicy')] } } };
    expect(capBlooms(p)).toEqual([]);
    expect(p.seen.objective.MCQs.map((x) => x.blooms)).toEqual([undefined, 'Spicy']);
  });

  test('survives a missing or odd tree', () => {
    expect(capBlooms(null)).toEqual([]);
    expect(capBlooms({ seen: 'x', unseen: { a: null } })).toEqual([]);
  });
});

describe('appliesToGrade — grades 1-2 (FDE model assessments) are left as written', () => {
  test.each([1, 2, '1', ' 2 '])('grade %p: no', (g) => expect(appliesToGrade(g)).toBe(false));
  test.each([3, 4, 5, '3', '5', 6])('grade %p: yes', (g) => expect(appliesToGrade(g)).toBe(true));
});
