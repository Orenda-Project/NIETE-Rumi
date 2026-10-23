'use strict';
/**
 * Grade 2 General Knowledge (Urdu medium), FDE 2023-24 model paper: 50 written marks,
 * no oral part. ToS 40 / 40 / 20. The paper's plant-parts label diagram is set as a
 * picture to name. Urdu text: needs fluent-Urdu review.
 */

const { makeSubject } = require('./chrome');

const S = (o) => ({ marks_each: 1, ...o });

module.exports = makeSubject({
  grade: 2,
  key: 'general_knowledge',
  medium: 'ur',
  name_en: 'General Knowledge',
  name_ur: 'معلومات عامہ',
  tos: { Remember: 40, Understand: 40, Apply: 20 },
  pages: 126,
  sections: [
    {
      id: 'A',
      label_en: 'Objective',
      label_ur: 'معروضی',
      levels: { Remember: 14, Understand: 6, Apply: 0 },
      slots: [
        S({ slot: 'g2.general_knowledge.A.Q1', label_en: 'Q1.', type: 'Fill in the Blanks', generate: 5, print_words: true,
          instruction_ur: 'خالی جگہ پُر کریں۔',
          prompt_rule: 'Five one-line facts from the book with one blank; the five answers, mixed, in "words" on the FIRST item.' }),
        S({ slot: 'g2.general_knowledge.A.Q2', label_en: 'Q2.', type: 'MCQs', shape: 'mcq', generate: 5, option_labels: 'ur',
          instruction_ur: 'درست جواب پر دائرہ لگائیں۔',
          prompt_rule: 'Five three-option MCQs on book facts.' }),
        S({ slot: 'g2.general_knowledge.A.Q3', label_en: 'Q3.', type: 'True False', shape: 'mcq', generate: 5, option_labels: 'ur',
          instruction_ur: 'درست یا غلط لکھیں۔',
          prompt_rule: 'Five statements from the book; options exactly درست and غلط. Mix both answers.' }),
        S({ slot: 'g2.general_knowledge.A.Q4', label_en: 'Q4.', type: 'Match Columns', shape: 'mcq', generate: 5, option_labels: 'ur',
          instruction_ur: 'درست جوڑ ملائیں۔',
          prompt_rule: 'Five items: a thing as the stem and three options of what goes with it (a season and its weather, a job and its tool, a plant part and its use).' }),
      ],
    },
    {
      id: 'B',
      label_en: 'Short answers and pictures',
      label_ur: 'مختصر جواب اور تصاویر',
      levels: { Remember: 6, Understand: 14, Apply: 10 },
      slots: [
        { slot: 'g2.general_knowledge.B.Q5', label_en: 'Q5.', type: 'Short Answers', generate: 4, marks_each: 2, lines: 2,
          instruction_ur: 'مختصر جواب دیں۔',
          prompt_rule: 'Four recall questions from the book. Answer: one or two short sentences. Scheme: K 1 per idea.' },
        { slot: 'g2.general_knowledge.B.Q6', label_en: 'Q6.', type: 'Explain Briefly', generate: 5, marks_each: 2, lines: 2,
          instruction_ur: 'وجہ بتائیں۔',
          prompt_rule: 'Five "why" or "how" questions from the book (why we wash our hands, how we save water). Answer: two short sentences. Scheme: K 1 per idea.' },
        { slot: 'g2.general_knowledge.B.Q7', label_en: 'Q7.', type: 'Write Sentences', generate: 1, marks_each: 4, lines: 4,
          instruction_ur: 'چار جملے لکھیں۔',
          prompt_rule: 'One book topic (my neighbourhood, a good citizen, our helpers). Answer: four model sentences. Scheme: K 1 per sentence on topic.' },
        S({ slot: 'g2.general_knowledge.B.Q8', label_en: 'Q8.', type: 'Put in Order', generate: 5, lines: 1,
          instruction_ur: 'روئی سے کپڑا بننے کے مراحل کو درست ترتیب سے لکھیں۔',
          prompt_rule: 'Five items that together are the five steps from cotton to cloth as the book gives them (picking, cleaning, spinning, weaving, stitching), listed out of order. Answer: each step\'s number in the right order.' }),
        S({ slot: 'g2.general_knowledge.B.Q9', label_en: 'Q9.', type: 'Parts of a Plant', generate: 1, marks_each: 3, lines: 0, picture: ['plant'],
          instruction_ur: 'پودے کے حصوں کے نام خالی لائنوں پر لکھیں۔',
          // bd-5jmnfj.4.33: "label the plant": the paper draws the plant and its three blank lines.
          prompt_rule: 'One item, 3 marks. picture: {kind:"plant"} and nothing else: the paper draws the plant with a blank line beside its leaf, stem and root. Question: "پودے کے حصوں کے نام لکھیں۔". Answer, the blank lines from top to bottom: "پتا، تنا، جڑ".' }),
      ],
    },
  ],
  oral: null,
});
