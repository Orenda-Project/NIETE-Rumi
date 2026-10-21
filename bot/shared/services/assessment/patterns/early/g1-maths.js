'use strict';
/**
 * Grade 1 Maths, FDE 2023-24 model paper: 50 marks, oral mental maths 5 + written 45.
 * ToS target Remember 20 / Understand 50 / Apply 30 (%). Marks per item follow the model paper.
 */

const { makeSubject } = require('./chrome');

module.exports = makeSubject({
  grade: 1,
  key: 'maths',
  medium: 'en',
  name_en: 'Mathematics',
  name_ur: 'ریاضی',
  tos: { Remember: 20, Understand: 50, Apply: 30 },
  pages: 292,
  sections: [
    {
      id: 'A',
      label_en: 'Numbers and counting',
      levels: { Remember: 3, Understand: 14, Apply: 8 },
      slots: [
        { slot: 'g1.maths.A.Q1', label_en: 'Q1.', type: 'Missing Numbers', generate: 5, marks_each: 1,
          instruction_en: 'Write the missing numbers.',
          prompt_rule: 'Five rows of four or five numbers in order up to 100, each with one blank (__) to fill. Answer: the missing number.' },
        { slot: 'g1.maths.A.Q2', label_en: 'Q2.', type: 'Number Series', generate: 5, marks_each: 2,
          instruction_en: 'Complete the series.',
          prompt_rule: 'Five series (count on by 1, 2, 5 or 10, or count back by 1) with two blanks each; 1 mark per blank. Answer: both numbers.' },
        { slot: 'g1.maths.A.Q3', label_en: 'Q3.', type: 'Count and Write', generate: 5, marks_each: 1, lines: 0,
          instruction_en: 'Count and write the number.', picture: ['count', 'dots'],
          prompt_rule: 'Five items, each a picture of 1 to 10 of one book object (picture: {kind:"count", name, n}) or dots ({kind:"dots", n}). Stem: "How many <objects>?". Answer: n.' },
        { slot: 'g1.maths.A.Q4', label_en: 'Q4.', type: 'Compare Numbers', generate: 5, marks_each: 1, lines: 0,
          instruction_en: 'Write <, > or = in the box.',
          prompt_rule: 'Five pairs of numbers up to 100 written "34 ☐ 43". Answer: the sign.' },
      ],
    },
    {
      id: 'B',
      label_en: 'Sums, shapes and measuring',
      levels: { Remember: 2, Understand: 11, Apply: 7 },
      slots: [
        { slot: 'g1.maths.B.Q5', label_en: 'Q5.', type: 'Addition Word Problems', generate: 5, marks_each: 1, lines: 2,
          instruction_en: 'Solve.',
          prompt_rule: 'Five one-step addition stories from the book, sums up to 20, one or two short sentences a Grade 1 child can read. Answer: the number sentence and the sum.' },
        { slot: 'g1.maths.B.Q6', label_en: 'Q6.', type: 'Subtraction Word Problems', generate: 5, marks_each: 1, lines: 2,
          instruction_en: 'Solve.',
          prompt_rule: 'Five one-step take-away stories from the book, numbers up to 20. Answer: the number sentence and the difference.' },
        { slot: 'g1.maths.B.Q7', label_en: 'Q7.', type: 'Name the Shape', generate: 5, marks_each: 1, lines: 1,
          instruction_en: 'Write the name of each shape.', picture: ['shapes'],
          prompt_rule: 'Five items, each one shape the book teaches (circle, square, triangle, rectangle, oval, star, heart) drawn as picture: {kind:"shapes", shapes:[{shape}]}. Stem: "Name this shape." Answer: the name. Never the same shape twice.' },
        { slot: 'g1.maths.B.Q8', label_en: 'Q8.', type: 'Measurement', generate: 5, marks_each: 1, lines: 1,
          instruction_en: 'Look and answer.', picture: ['scene'],
          prompt_rule: 'Five compare items from the book\'s measurement pages (longer/shorter, taller/shorter, heavier/lighter, more/less). Each carries picture: {kind:"scene", describe} naming two objects side by side, e.g. "a long pencil and a short pencil". Stem asks which is longer/heavier etc. Answer: the object.' },
      ],
    },
  ],
  oral: {
    tasks: [
      { id: 'oral_maths', kind: 'oral_maths', marks: 5,
        label_en: 'Mental maths', label_ur: 'زبانی ریاضی',
        instruction_en: 'Ask each question aloud once. The child answers aloud; no paper or fingers counted against them.',
        instruction_ur: 'ہر سوال ایک بار بلند آواز سے پوچھیں۔ بچہ زبانی جواب دے۔',
        ask: 'Five quick questions read aloud: count on, one more/one less, add or take away within 10, which number is bigger. Each with its answer.',
        n: 5,
        rubric: [
          { marks: 5, en: 'All five right', ur: 'پانچوں درست' },
          { marks: 3, en: 'Three or four right', ur: 'تین یا چار درست' },
          { marks: 1, en: 'One or two right', ur: 'ایک یا دو درست' },
          { marks: 0, en: 'None right or no answer', ur: 'کوئی درست نہیں' },
        ] },
    ],
  },
});
