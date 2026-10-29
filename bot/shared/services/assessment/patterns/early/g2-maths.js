'use strict';
/**
 * Grade 2 Maths, FDE 2023-24 model paper: 50 written marks, no oral part.
 * Word problems are marked 1 per step (sentence, working, answer).
 */

const { makeSubject } = require('./chrome');

const S = (o) => ({ marks_each: 1, ...o });
const WP = (o) => ({ marks_each: 3, generate: 1, lines: 3, ...o,
  prompt_rule: `${o.prompt_rule} Scheme: M 1 for the number sentence, M 1 for the working, A 1 for the answer with its word.` });

module.exports = makeSubject({
  grade: 2,
  key: 'maths',
  medium: 'en',
  name_en: 'Mathematics',
  name_ur: 'ریاضی',
  tos: { Remember: 30, Understand: 40, Apply: 30 },
  pages: 300,
  sections: [
    {
      id: 'A',
      label_en: 'Numbers and shapes',
      levels: { Remember: 10, Understand: 12, Apply: 3 },
      slots: [
        S({ slot: 'g2.maths.A.Q1', label_en: 'Q1.', type: 'MCQs', shape: 'mcq', generate: 5,
          instruction_en: 'Choose the correct answer.',
          prompt_rule: 'Five three-option MCQs from the book: place value, before/after, even/odd, greatest number, half.' }),
        S({ slot: 'g2.maths.A.Q2', label_en: 'Q2.', type: 'Place Value', generate: 5,
          instruction_en: 'Write the value of the digit.',
          prompt_rule: 'Five three-digit numbers up to 999. Stem names the digit in words, e.g. "In 472, what is the value of 7?" (never an underline). Answer: the value (70).' }),
        S({ slot: 'g2.maths.A.Q3', label_en: 'Q3.', type: 'Numbers in Words', generate: 5,
          instruction_en: 'Write in words.',
          prompt_rule: 'Five numbers up to 999. Answer: the number in words; spelling must be right.' }),
        S({ slot: 'g2.maths.A.Q4', label_en: 'Q4.', type: 'Fractions', generate: 5, picture: ['shapes'], picture_only: true,
          instruction_en: 'What part is shaded? Write the fraction.',
          prompt_rule: 'Five items, each one shape cut into 2, 3 or 4 equal parts with some shaded, as picture: {kind:"shapes", shapes:[{shape:"circle"|"square"|"rectangle", parts, shaded}]}. Answer: the fraction (1/2, 1/4, 3/4, 1/3, 2/3).' }),
        S({ slot: 'g2.maths.A.Q5', label_en: 'Q5.', type: 'Name the Shape', generate: 5, picture: ['shapes'], picture_only: true,
          instruction_en: 'Write the name of each shape.',
          prompt_rule: 'Five different shapes the book teaches (circle, square, triangle, rectangle, oval, semicircle) as picture: {kind:"shapes", shapes:[{shape}]}. Answer: the name.' }),
      ],
    },
    {
      id: 'B',
      label_en: 'Operations',
      levels: { Remember: 5, Understand: 8, Apply: 12 },
      slots: [
        S({ slot: 'g2.maths.B.Q6', label_en: 'Q6.', type: 'Addition', generate: 4, lines: 2,
          instruction_en: 'Add.', prompt_rule: 'Four column sums of two- and three-digit numbers, two with carrying. Answer: the sum.' }),
        WP({ slot: 'g2.maths.B.Q7', label_en: 'Q7.', type: 'Addition Word Problem', instruction_en: 'Solve. Show your working.',
          prompt_rule: 'One addition story from the book, numbers up to 999.' }),
        S({ slot: 'g2.maths.B.Q8', label_en: 'Q8.', type: 'Subtraction', generate: 4, lines: 2,
          instruction_en: 'Subtract.', prompt_rule: 'Four column subtractions, two- and three-digit, two with borrowing. Answer: the difference.' }),
        WP({ slot: 'g2.maths.B.Q9', label_en: 'Q9.', type: 'Subtraction Word Problem', instruction_en: 'Solve. Show your working.',
          prompt_rule: 'One subtraction story from the book, numbers up to 999.' }),
        S({ slot: 'g2.maths.B.Q10', label_en: 'Q10.', type: 'Multiplication', generate: 3, lines: 1,
          instruction_en: 'Multiply.', prompt_rule: 'Three facts from the 2, 3, 4, 5 and 10 tables. Answer: the product.' }),
        WP({ slot: 'g2.maths.B.Q11', label_en: 'Q11.', type: 'Multiplication Word Problem', instruction_en: 'Solve. Show your working.',
          prompt_rule: 'One equal-groups story from the book using the 2, 3, 4, 5 or 10 tables.' }),
        S({ slot: 'g2.maths.B.Q12', label_en: 'Q12.', type: 'Division', generate: 5, lines: 1,
          instruction_en: 'Divide.', prompt_rule: 'Five sharing facts from the 2, 3, 4, 5 and 10 tables, no remainder. Answer: the quotient.' }),
      ],
    },
  ],
  oral: null,
});
