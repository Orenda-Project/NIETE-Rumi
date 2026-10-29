'use strict';
/**
 * Grade 4 Maths end-of-chapter paper (bd-5jmnfj.33.1): 50 written marks, no pictures. ToS
 * R17 U39 A44. Only the word-problem slot may carry a story: 2 items, 5 marks answered (10%).
 * DECISIONS.md sections 3 and 4.
 */

const { makeSubject } = require('./chrome');

const NS = 'No story or word problem: bare numbers and figures-free wording only.';
const S = (o) => ({ marks_each: 1, ...o, prompt_rule: `${o.prompt_rule} ${NS}` });
const SCHEME5 = 'Scheme (5): M 3 for the method steps, A 1 for the correct answer, U 1 for the unit or a check.';

module.exports = makeSubject({
  grade: 4,
  key: 'maths',
  medium: 'en',
  name_en: 'Mathematics',
  name_ur: 'ریاضی',
  tos: { Remember: 17, Understand: 39, Apply: 44 },
  word_problem_cap: { items: 2, marks: 5 },
  sections: [
    {
      id: 'A',
      label_en: 'Objective',
      levels: { Remember: 6, Understand: 8, Apply: 6 },
      slots: [
        S({ slot: 'g4.maths.A.mcq', label_en: 'Q1.', type: 'MCQs', shape: 'mcq', generate: 10,
          instruction_en: 'Choose the correct answer.',
          prompt_rule: 'Ten four-option MCQs from the chosen chapter only: facts, a short calculation, a comparison, a place value or a property. One option correct; distractors are common slips.' }),
        S({ slot: 'g4.maths.A.directed', label_en: 'Q2.', type: 'Do as Directed', generate: 5, marks_each: 2, lines: 2,
          instruction_en: 'Do as directed.',
          prompt_rule: 'Five short exercises from the chosen chapter only (round, order, convert, find the value, complete the pattern). Each stem names the task in one line. Answer: the result. Scheme: M 1 for the method, A 1 for the answer.' }),
      ],
    },
    {
      id: 'B',
      label_en: 'Short response and word problem',
      levels: { Remember: 3, Understand: 8, Apply: 9 },
      slots: [
        S({ slot: 'g4.maths.B.short', label_en: 'Q3.', type: 'Short Response', generate: 4, attempt: 3, marks_each: 5, lines: 6,
          instruction_en: 'Answer any three questions.',
          prompt_rule: `Four calculation questions from the chosen chapter only, each needing 2 to 4 steps with working shown. Answer: the working and the result. ${SCHEME5}` }),
        { slot: 'g4.maths.B.word_problem', label_en: 'Q4.', type: 'Word Problem', generate: 2, attempt: 1, marks_each: 5, lines: 6, word_problems: 2,
          instruction_en: 'Solve any one problem.',
          prompt_rule: `Two word problems, each a short everyday story (shop, school, travel, garden) from the chosen chapter's skill, numbers matching the chapter. The only slots on the paper that may carry a story. Answer: the number sentence, the working and the answer with its unit. ${SCHEME5}` },
      ],
    },
    {
      id: 'C',
      label_en: 'Extended response',
      levels: { Remember: 0, Understand: 3, Apply: 7 },
      slots: [
        S({ slot: 'g4.maths.C.extended', label_en: 'Q5.', type: 'Extended Response', generate: 3, attempt: 2, marks_each: 5, lines: 8,
          instruction_en: 'Answer any two questions.',
          prompt_rule: `Three multi-step questions from the chosen chapter only, harder than Q3: a chain of two skills, or find and explain. Answer: full working and the result. ${SCHEME5}` }),
      ],
    },
  ],
  oral: null,
});
