'use strict';
/**
 * Grade 4 Science end-of-chapter paper (bd-5jmnfj.33.1): 50 written marks, no oral, no
 * pictures. ToS R30 U30 A40. The practical and the graphic items are held (design pending).
 * DECISIONS.md section 4.
 */

const { makeSubject } = require('./chrome');

const S = (o) => ({ marks_each: 1, ...o });
const CH = 'From the chosen chapter only, no diagram or practical item. Nothing a child needs out-of-school knowledge for.';

module.exports = makeSubject({
  grade: 4,
  key: 'science',
  medium: 'en',
  name_en: 'Science',
  name_ur: 'سائنس',
  tos: { Remember: 30, Understand: 30, Apply: 40 },
  sections: [
    {
      id: 'A',
      label_en: 'Objective',
      levels: { Remember: 8, Understand: 5, Apply: 2 },
      slots: [
        S({ slot: 'g4.science.A.mcq', label_en: 'Q1.', type: 'MCQs', shape: 'mcq', generate: 10,
          instruction_en: 'Choose the correct answer.',
          prompt_rule: `Ten three-option MCQs on facts, terms and simple uses of the ideas. ${CH} One option correct; no "all of the above". An option never states a long answer's steps; a concept appears in at most two items; never the same stem as an MCQ and a short answer. A wrong option is wrong for a reason the chapter gives; a cause or use the chapter does not rule out (waterfalls, melting snow) is not set as one.` }),
        S({ slot: 'g4.science.A.fill', label_en: 'Q2.', type: 'Fill in the Blanks', objective: true, generate: 5, print_words: true,
          instruction_en: 'Fill in the blanks with the words from the box.',
          prompt_rule: `Five one-line facts with one blank each; the five answers plus ONE spare word, mixed, in "words" on the FIRST item (six words: the spare is a science word the chapter teaches that fits no blank, so the last blank is never free). ${CH} Each answer is a single science word the chapter teaches. The article before a blank is written a/an so it does not give the answer away.` }),
      ],
    },
    {
      id: 'B',
      label_en: 'Short answers and reasons',
      levels: { Remember: 5, Understand: 6, Apply: 9 },
      slots: [
        { slot: 'g4.science.B.short', label_en: 'Q3.', type: 'Short Answers', generate: 7, attempt: 5, marks_each: 2, lines: 2,
          instruction_en: 'Answer any five questions.',
          prompt_rule: `Seven short-answer questions (define, name, state, list, what happens). ${CH} Answer: one or two short sentences. Scheme: K 1 per correct idea, two ideas for 2, and only ideas the question asks for: no point for an example or a consequence it does not ask. A definition covers the whole idea (an insulator stops heat as well as electricity). Floating is explained by density or the upthrust, never by spreading weight.` },
        { slot: 'g4.science.B.reasons', label_en: 'Q4.', type: 'Give a Reason', generate: 3, attempt: 2, marks_each: 5, lines: 6,
          instruction_en: 'Give reasons for any two.',
          prompt_rule: `Three "why" questions that ask for a reason from what the chapter teaches. ${CH} Answer: a reason of 3 to 4 sentences. Scheme (5): K 1 for each different correct point up to 4, A 1 for a clear conclusion that answers the why; no mark for using a word, and no point pays a word another point already paid. Floating is explained by density or the upthrust, never by spreading weight.` },
      ],
    },
    {
      id: 'C',
      label_en: 'Extended response',
      levels: { Remember: 2, Understand: 4, Apply: 9 },
      slots: [
        { slot: 'g4.science.C.extended', label_en: 'Q5.', type: 'Extended Response', generate: 4, attempt: 3, marks_each: 5, lines: 8,
          instruction_en: 'Answer any three questions.',
          prompt_rule: `Four questions that ask the child to explain, compare, describe a process in steps or apply an idea to an everyday case. ${CH} Answer: a short paragraph or numbered steps. Scheme (5): K 1 per different correct point up to 5, each a new idea or step inside what the stem asks (a process the stem ends at a point stops there); no mark for using a term another point already paid. Floating is explained by density or the upthrust, never by spreading weight.` },
      ],
    },
  ],
  oral: null,
});
