'use strict';
/**
 * Grade 1 General Knowledge (Urdu medium), FDE 2023-24 model paper: 50 written marks,
 * no oral part. ToS 40 / 40 / 20. Blanks 5; MCQ / true-false / match 15; constructed 16;
 * picture items 14 (the paper's flowchart / label / diagram, set as pictures to name and sort).
 * Urdu text: needs fluent-Urdu review.
 */

const { makeSubject } = require('./chrome');

const S = (o) => ({ marks_each: 1, ...o });
const VEHICLE = /boat|ship|bus|train|car\b|cart|bicycle|bike|plane|van|truck|rickshaw|tractor/i;

module.exports = makeSubject({
  grade: 1,
  key: 'general_knowledge',
  medium: 'ur',
  name_en: 'General Knowledge',
  name_ur: 'معلومات عامہ',
  tos: { Remember: 40, Understand: 40, Apply: 20 },
  pages: 54,
  sections: [
    {
      id: 'A',
      label_en: 'Objective',
      label_ur: 'معروضی',
      levels: { Remember: 14, Understand: 6, Apply: 0 },
      slots: [
        S({ slot: 'g1.general_knowledge.A.Q1', label_en: 'Q1.', type: 'Fill in the Blanks', generate: 5, print_words: true,
          instruction_ur: 'خالی جگہ پُر کریں۔',
          prompt_rule: 'Five one-line facts from the book with one blank; the five answers, mixed, in "words" on the FIRST item.' }),
        S({ slot: 'g1.general_knowledge.A.Q2', label_en: 'Q2.', type: 'MCQs', shape: 'mcq', generate: 5, option_labels: 'ur',
          instruction_ur: 'درست جواب پر دائرہ لگائیں۔',
          prompt_rule: 'Five three-option MCQs on book facts (places of worship, traffic signs, wild and domestic animals, body parts, water).' }),
        S({ slot: 'g1.general_knowledge.A.Q3', label_en: 'Q3.', type: 'True False', shape: 'mcq', generate: 5, option_labels: 'ur',
          instruction_ur: 'درست یا غلط لکھیں۔',
          prompt_rule: 'Five statements from the book; options exactly درست and غلط. Mix both answers.' }),
        S({ slot: 'g1.general_knowledge.A.Q4', label_en: 'Q4.', type: 'Match Columns', shape: 'match', generate: 5,
          instruction_ur: 'درست جوڑ ملائیں۔',
          prompt_rule: 'Five pairs to match, no options: the question is the thing (Column A) and the answer is what goes with it (Column B), five different answers (an animal and its home, a job and its tool, a sign and its meaning). The paper prints Column B shuffled.' }),
      ],
    },
    {
      id: 'B',
      label_en: 'Short answers and pictures',
      label_ur: 'مختصر جواب اور تصاویر',
      levels: { Remember: 6, Understand: 14, Apply: 10 },
      slots: [
        S({ slot: 'g1.general_knowledge.B.Q5', label_en: 'Q5.', type: 'Name the Picture', generate: 4, picture: ['object'], picture_only: true, print_words: true,
          instruction_ur: 'تصویر دیکھ کر خانے میں سے نام لکھیں۔', // needs fluent-Urdu review
          prompt_rule: 'Four book things (a body part, a traffic sign, a fruit, a tool) as picture: {kind:"object", name} in English for the artist. Put all four Urdu names, mixed, in "words" on the FIRST item only. Answer: the Urdu name.' }),
        { slot: 'g1.general_knowledge.B.Q6', label_en: 'Q6.', type: 'Short Answers', generate: 4, marks_each: 2, lines: 2,
          instruction_ur: 'مختصر جواب دیں۔',
          prompt_rule: 'Four questions on good habits, cleanliness, water and sources of income. Answer: one or two short sentences. Scheme: K 1 per idea.' },
        { slot: 'g1.general_knowledge.B.Q7', label_en: 'Q7.', type: 'Write Sentences', generate: 1, marks_each: 4, lines: 4,
          instruction_ur: 'چار جملے لکھیں۔',
          prompt_rule: 'One book topic (my school, my home, keeping clean). Answer: four model sentences. Scheme: K 1 per sentence on topic.' },
        S({ slot: 'g1.general_knowledge.B.Q8', label_en: 'Q8.', type: 'Put in Order', generate: 3,
          instruction_ur: 'درست ترتیب لکھیں۔',
          prompt_rule: 'Three items, each three steps of a book routine (washing hands, crossing the road, planting a seed) written out of order and numbered. Answer: the order, e.g. 2، 1، 3.' }),
        S({ slot: 'g1.general_knowledge.B.Q9', label_en: 'Q9.', type: 'Wild or Domestic', generate: 6, lines: 1, picture: ['object'], picture_only: true,
          instruction_ur: 'تصویر دیکھ کر لکھیں: جنگلی یا پالتو۔',
          prompt_rule: 'Six book animals, three wild and three domestic, mixed, each as picture: {kind:"object", name}. Answer: جنگلی or پالتو.' }),
        S({ slot: 'g1.general_knowledge.B.Q10', label_en: 'Q10.', type: 'Land or Water', generate: 5, lines: 1, picture: ['object'], picture_only: true,
          instruction_ur: 'یہ کہاں رہتا ہے؟ خشکی یا پانی۔',
          // v18 drew a ship, a bus, a train and a cart for "where does it live?" (bd-5jmnfj.4.34).
          prompt_rule: 'Five book animals only, some that live on land and some that live in water, never a vehicle or any other object, '
            + 'each as picture: {kind:"object", name}. Answer: خشکی or پانی.',
          answer_ok: (q) => ['خشکی', 'پانی'].includes(String(q.answer).trim())
            && !VEHICLE.test(String((q.picture && q.picture.name) || '')) }),
      ],
    },
  ],
  oral: null,
});
