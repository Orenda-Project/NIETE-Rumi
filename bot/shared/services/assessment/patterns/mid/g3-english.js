'use strict';
/**
 * Grade 3 English, FDE end-of-chapter paper (bd-5jmnfj.33.1): 50 marks, no oral part,
 * set from the chapter the teacher chose. ToS 30 / 30 / 40. DECISIONS section 4, Class 3.
 */

const { makeSubject } = require('./chrome');

const S = (o) => ({ marks_each: 1, ...o });
const NO_ARROW = ' Never an arrow or a picture.';

module.exports = makeSubject({
  grade: 3,
  key: 'english',
  medium: 'en',
  name_en: 'English',
  name_ur: 'انگریزی',
  tos: { Remember: 30, Understand: 30, Apply: 40 },
  sections: [
    {
      id: 'A',
      label_en: 'Objective and grammar',
      levels: { Remember: 8, Understand: 7, Apply: 5 },
      slots: [
        S({ slot: 'g3.english.A.mcq', label_en: 'Q1.', type: 'MCQs', shape: 'mcq', generate: 10,
          instruction_en: 'Choose the correct answer.',
          prompt_rule: 'Ten three-option MCQs from the chosen chapter only: word meaning, who or what, the right word for the gap, spelling and one fact from the text. One option is right; the other two are plausible but wrong. No item gives away another item\'s answer.' }),
        S({ slot: 'g3.english.A.grammar', label_en: 'Q2.', type: 'Grammar Do As Directed', generate: 5, marks_each: 2, lines: 2,
          instruction_en: 'Do as directed.',
          prompt_rule: 'Five "do as directed" items on grammar the chapter teaches (plural, opposite, correct form of the verb, a/an, pronoun), each a short sentence from the chapter with one clear direction (e.g. "Change into the plural: The child plays."). Answer: the whole corrected sentence. Scheme: A 2 for the correct sentence; A 1 if only the changed word is right.' }),
      ],
    },
    {
      id: 'B',
      label_en: 'Short answers and sentences',
      levels: { Remember: 5, Understand: 5, Apply: 5 },
      slots: [
        { slot: 'g3.english.B.short', label_en: 'Q3.', type: 'Short Answers', generate: 5, marks_each: 2, lines: 2,
          instruction_en: 'Answer the questions.',
          prompt_rule: 'Five who, what, where or why questions on the chapter\'s text. Answer: one or two short sentences. Scheme: K 1 per idea, 2 in all.' },
        S({ slot: 'g3.english.B.sentences', label_en: 'Q4.', type: 'Use Words in Sentences', generate: 5, lines: 2,
          instruction_en: 'Use each word in a sentence of your own.',
          prompt_rule: 'Five single words from the chapter\'s vocabulary, one per item, in "question"; the stem is the word alone. Answer: one model sentence that uses the word correctly. Scheme: A 1 for a correct sentence that shows the word\'s meaning.' }),
      ],
    },
    {
      id: 'C',
      label_en: 'Writing',
      levels: { Remember: 2, Understand: 3, Apply: 10 },
      slots: [
        { slot: 'g3.english.C.paragraph', label_en: 'Q5.', type: 'Paragraph from Clues', generate: 2, attempt: 1, marks_each: 5, lines: 6,
          instruction_en: 'Write a paragraph using the clues. Answer any one.',
          prompt_rule: 'Two paragraph tasks on topics from the chosen chapter (my school, a pet, my family). Each gives four or five clue words or phrases. Answer: a model paragraph of five sentences using every clue. Scheme: 1 mark per sentence that uses the clues in correct English, 5 in all.' },
        { slot: 'g3.english.C.invitation', label_en: 'Q6.', type: 'Invitation Card or Note', generate: 2, attempt: 1, marks_each: 5, lines: 6,
          instruction_en: 'Write an invitation card or a note. Answer any one.',
          prompt_rule: 'Two tasks: an invitation card (birthday, school function) or a short note (to a friend or a parent), each with the details to include (who, what, when, where). Answer: a model card or note. Scheme: 1 mark each for the greeting or heading, the message, the details, correct English and the closing, 5 in all.' },
        S({ slot: 'g3.english.C.present_continuous', label_en: 'Q7.', type: 'Present Continuous', generate: 5, lines: 1,
          instruction_en: 'Rewrite in the present continuous tense.',
          prompt_rule: 'Five short simple-present sentences on the chapter\'s people and things. Answer: the sentence rewritten in the present continuous (is, am or are with the -ing verb). Scheme: A 1 for the whole sentence correct.' + NO_ARROW }),
      ],
    },
  ],
  oral: null,
});
