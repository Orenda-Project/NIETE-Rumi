/**
 * bd-5jmnfj.38.31 (a8) — a grammar item whose stem names the word class while its scheme awards a mark
 * for identifying it (a7 G8 Q15-20: "find the اسمِ صفتِ نسبتی", with a mark for "قسم کا درست تعین").
 * The stem already prints what the mark is for, so the item is sent to the rewrite.
 */
const { statedType } = require('../../bot/shared/services/assessment/free-secondary-grammar');

const item = (question, points, bands = []) => ({ question, answer: 'x', marks: 2,
  marking_points: points.map((p) => ({ point: p, marks: 1 })), mark_bands: bands.map((d) => ({ descriptor: d, marks: 1 })) });
const paper = (...written) => ({ unseen: {
  objective: { MCQ: [{ question: 'کون سا اسم ہے؟', options: ['a) w', 'b) x', 'c) y', 'd) z'], answer: 'a) w', marks: 1 }] },
  subjective: { Grammar: written },
} });

describe('statedType', () => {
  it('flags the a7 G8 pattern: the stem names اسمِ صفتِ نسبتی and a point awards the type', () => {
    const exam = paper(item("درج جملے میں اسمِ صفتِ نسبتی تلاش کریں: 'وہ پاکستانی کھانا پکاتی ہے۔'",
      ['درست لفظ کی نشاندہی', 'قسم کا درست تعین'], ['مکمل: لفظ اور قسم درست']));
    const out = statedType(exam);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ n: 2, check: 'stated-type' });
    expect(out[0].text).toMatch(/stem already names/);
  });

  it('flags an English stem that names the class while a band awards identifying the type', () => {
    const exam = paper(item('Find the adjective in this sentence: "The tall boy ran."', ['the word tall'], ['full: word and its type correct']));
    expect(statedType(exam).map((i) => i.n)).toEqual([2]);
  });

  it('does not flag a stem that names the class when the scheme awards only the word', () => {
    const exam = paper(item("درج جملے میں فعل تلاش کریں: 'وہ دوڑا۔'", ['درست لفظ کی نشاندہی', 'لفظ کا درست املا']));
    expect(statedType(exam)).toEqual([]);
  });

  it('does not flag a scheme that awards the type when the stem leaves the type for the student', () => {
    const exam = paper(item("درج لفظ کی قسم بتائیں: 'پاکستانی'", ['درست جواب', 'قسم کا درست تعین']));
    expect(statedType(exam)).toEqual([]);
  });

  it('does not read a grammar term inside a longer word (حالات is not حال)', () => {
    const exam = paper(item("درج جملے میں حالات کا ذکر تلاش کریں: 'حالات اچھے ہیں۔'", ['قسم کا درست تعین']));
    expect(statedType(exam)).toEqual([]);
  });
});
