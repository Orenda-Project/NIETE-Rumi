/**
 * bd-5jmnfj.38.31 — prompt instructions that leak into a G6-12 free paper's marking points or accept
 * note ("(do not repeat the question)") are removed; a bracketed expected answer stays.
 */
const T = require('../../bot/shared/services/assessment/free-secondary-tidy');

const paper = (item) => ({ unseen: { subjective: { 'Short Answers': [item] } } });

describe('stripInstructions', () => {
  it('removes a bracketed instruction from marking points, band descriptors and the accept note', () => {
    const item = {
      question: 'Q', answer: 'A', marks: 3,
      marking_points: [{ point: 'آغاز کے ادارے کا ذکر (بغیر نام دہرائے سوال میں)', marks: 2 },
        { point: 'Names the gas (do not repeat the question)', marks: 1 }],
      mark_bands: [{ marks: '3', descriptor: 'Clear reason (write in full sentences)' }],
      accept: 'Accept oxygen (without repeating the words of the question).',
    };
    const n = T.stripInstructions(paper(item));
    expect(n).toBe(4);
    expect(item.marking_points.map((p) => p.point)).toEqual(['آغاز کے ادارے کا ذکر', 'Names the gas']);
    expect(item.mark_bands[0].descriptor).toBe('Clear reason');
    expect(item.accept).toBe('Accept oxygen.');
  });

  it('keeps a bracketed expected answer, a part label and the question itself', () => {
    const item = {
      question: 'Name the gas (do not repeat the question).', answer: 'Oxygen (O2)', marks: 3,
      marking_points: [{ point: 'درست لفظ کی نشاندہی (پشاوری)', marks: 1 },
        { point: '(a) States the products (CO2, water)', marks: 1 }, { point: 'Accept CO2 (carbon dioxide)', marks: 1 }],
    };
    const before = JSON.stringify(item);
    expect(T.stripInstructions(paper(item))).toBe(0);
    expect(JSON.stringify(item)).toBe(before);
  });
});

describe('scenarioParts', () => {
  it('prints a scenario item\'s parts: the scenario becomes its passage, the parts lose a doubled label', () => {
    const item = {
      main_question: 'Answer the structured question.', question: 'A farmer\'s crop has pale leaves.', marks: 4,
      questions: [{ question: 'a. Name the missing mineral.', marks: 2, answer: 'Magnesium.' },
        { question: '(b) Explain the effect.', marks: 2, answer: 'Less chlorophyll.' }],
    };
    expect(T.scenarioParts(paper(item))).toBe(1);
    expect(item.passage).toBe('A farmer\'s crop has pale leaves.');
    expect(item.question).toBe('Answer the structured question.');
    expect(item.questions.map((q) => q.question)).toEqual(['Name the missing mineral.', 'Explain the effect.']);
  });

  it('leaves a reading passage and an item without parts alone', () => {
    const read = { question: 'Read.', passage: 'Text.', questions: [{ question: 'a. Why?', answer: 'x' }] };
    const plain = { question: 'Why?', answer: 'x', marks: 3 };
    const before = JSON.stringify([read, plain]);
    expect(T.scenarioParts({ unseen: { s: { A: [read, plain] } } })).toBe(0);
    expect(JSON.stringify([read, plain])).toBe(before);
  });
});


describe('oneDigitSystem (G8 a6 Q1-2: Urdu digits in the options, Western in the chrome)', () => {
  it('prints every digit of an Urdu paper in the Western digits its chrome uses', () => {
    const q1 = { question: 'عبدالستار ایدھی کس سن میں پیدا ہوئے؟', options: ['الف) ۱۹۲۶ء', 'ب) ۱۹۲۷ء', 'ج) ۱۹۲۸ء', 'د) ۱۹۲۹ء'], answer: 'ج) ۱۹۲۸ء', marks: 1 };
    const q6 = { question: 'سوال', answer: 'سن ٢٠١٦ میں', marks: 3, marking_points: [{ point: '۲ اعزازات', marks: 3 }] };
    const exam = { unseen: { objective: { MCQs: [q1] }, subjective: { 'Short Answers': [q6] } } };
    expect(T.oneDigitSystem(exam)).toBe(7);
    expect(q1.options).toEqual(['الف) 1926ء', 'ب) 1927ء', 'ج) 1928ء', 'د) 1929ء']);
    expect(q1.answer).toBe('ج) 1928ء');
    expect(q6.answer).toBe('سن 2016 میں');
    expect(q6.marking_points[0].point).toBe('2 اعزازات');
    expect(T.oneDigitSystem(exam)).toBe(0);
  });
});
