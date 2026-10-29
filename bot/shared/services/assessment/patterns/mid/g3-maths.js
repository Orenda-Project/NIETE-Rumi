'use strict';
/**
 * Grade 3 Maths, FDE end-of-chapter paper (bd-5jmnfj.33.1): 50 marks, no oral part.
 * ToS 20 / 50 / 30. One word problem (5 marks, 10%) is the whole of the paper's story load;
 * every other slot is bare numbers. DECISIONS section 3 (cap) and section 4, Class 3.
 */

const { makeSubject } = require('./chrome');

const NO_STORY = ' No story or word problem: bare numbers and figures-free wording only.';
const FIVE = 'Scheme: M 2 for the method, M 1 for the working, A 1 for the answer, U 1 for the unit or the statement. A common error names the figure its slip gives.';
const S = (o) => ({ marks_each: 1, ...o, prompt_rule: `${o.prompt_rule}${NO_STORY}` });

module.exports = makeSubject({
  grade: 3,
  key: 'maths',
  medium: 'en',
  name_en: 'Mathematics',
  name_ur: 'ریاضی',
  tos: { Remember: 20, Understand: 50, Apply: 30 },
  word_problem_cap: { items: 1, marks: 5 },
  sections: [
    {
      id: 'A',
      label_en: 'Objective and do as directed',
      levels: { Remember: 6, Understand: 10, Apply: 4 },
      slots: [
        S({ slot: 'g3.maths.A.mcq', label_en: 'Q1.', type: 'MCQs', shape: 'mcq', generate: 10,
          instruction_en: 'Choose the correct answer.',
          prompt_rule: 'Ten three-option MCQs from the chosen chapter only: a fact, a place value, a comparison, a rule or one step of a calculation. One option is right; the other two are the common mistakes. No item gives away another\'s answer.' }),
        S({ slot: 'g3.maths.A.directed', label_en: 'Q2.', type: 'Do As Directed', generate: 5, marks_each: 2, lines: 2,
          instruction_en: 'Do as directed.',
          prompt_rule: 'Five items from the chosen chapter, each with one direction (write in words, write the value of the digit, round, arrange in order, find the missing number, compare with <, > or =). Answer: the result. Scheme: A 2 for the correct answer; A 1 for one slip in a two-part direction. A common error names the figure its slip gives.' }),
      ],
    },
    {
      id: 'B',
      label_en: 'Short response and word problem',
      levels: { Remember: 2, Understand: 10, Apply: 8 },
      slots: [
        S({ slot: 'g3.maths.B.short', label_en: 'Q3.', type: 'Short Response', generate: 3, marks_each: 5, lines: 4, work_mm: 40,
          instruction_en: 'Solve. Show your working.',
          prompt_rule: `Three calculations from the chosen chapter, each needing two or three steps with numbers only (e.g. a column sum then a check, a multiplication with carrying, a division with a remainder). Answer: the working and the result. ${FIVE}` }),
        { slot: 'g3.maths.B.word_problem', label_en: 'Q4.', type: 'Word Problem', generate: 1, marks_each: 5, lines: 4, work_mm: 40, word_problems: 1,
          instruction_en: 'Solve the word problem. Show your working.',
          prompt_rule: `One word problem from the chosen chapter: a short everyday situation in two or three sentences with the numbers the chapter uses, a single question. Answer: the number sentence, the working and the answer with its unit. ${FIVE}` },
      ],
    },
    {
      id: 'C',
      label_en: 'Extended response',
      levels: { Remember: 2, Understand: 5, Apply: 3 },
      slots: [
        S({ slot: 'g3.maths.C.extended', label_en: 'Q5.', type: 'Extended Response', generate: 3, attempt: 2, marks_each: 5, lines: 5, work_mm: 50,
          instruction_en: 'Answer any two. Show your working.',
          prompt_rule: `Three multi-part tasks from the chosen chapter, each with parts (a), (b) and (c) on one set of numbers (e.g. write the number in words, expand it, round it; or find the sum, the difference and compare). No two tasks test the same skill. Every part works on the task\'s own numbers; no part re-asks a Section A or B item. Answer: each part\'s working and result. ${FIVE} A check is a different method, never the commuted product; the three alternatives are equal in demand; a part never carries its own question label.` }),
      ],
    },
  ],
  oral: null,
});
