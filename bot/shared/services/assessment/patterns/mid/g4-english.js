'use strict';
/**
 * Grade 4 English end-of-chapter paper (bd-5jmnfj.33.1), FDE model-paper kinds scaled to one
 * chapter: 50 written marks, no oral, no pictures. ToS R30 U30 A40. DECISIONS.md section 4.
 */

const { makeSubject } = require('./chrome');

const S = (o) => ({ marks_each: 1, ...o });
const CH = 'From the chosen chapter only.';

module.exports = makeSubject({
  grade: 4,
  key: 'english',
  medium: 'en',
  name_en: 'English',
  name_ur: 'انگریزی',
  tos: { Remember: 30, Understand: 30, Apply: 40 },
  sections: [
    {
      id: 'A',
      label_en: 'Objective and grammar',
      levels: { Remember: 7, Understand: 6, Apply: 7 },
      slots: [
        S({ slot: 'g4.english.A.mcq', label_en: 'Q1.', type: 'MCQs', shape: 'mcq', generate: 10,
          instruction_en: 'Choose the correct answer.',
          prompt_rule: `Ten three-option MCQs. ${CH} Mix meaning of a word, who or what, the right word for the gap and a fact from the text. One option correct; no option "all of the above". A fact is asked once on the paper; a meaning item prints the word it asks about.` }),
        S({ slot: 'g4.english.A.grammar', label_en: 'Q2.', type: 'Grammar', generate: 5, marks_each: 2, lines: 2,
          instruction_en: 'Do as directed.',
          prompt_rule: `Five do-as-directed items, one each on: articles (a, an, the), collective nouns, a verb tense (change to past or future), question words (who, what, where, when, why), and one more of the same four kinds. ${CH} Each stem names the task in one line. Answer: the corrected or completed sentence. Scheme: one K point of 2 for the right word; no mark pays for copying the whole sentence. A gap that tests a/an is built so only one article fits (a first mention, or a word that starts with a vowel sound). A collective-noun answer accepts the plain form.` }),
      ],
    },
    {
      id: 'B',
      label_en: 'Short answers and sentences',
      levels: { Remember: 5, Understand: 5, Apply: 5 },
      slots: [
        { slot: 'g4.english.B.short', label_en: 'Q3.', type: 'Short Answers', generate: 6, attempt: 5, marks_each: 2, lines: 2,
          instruction_en: 'Answer any five questions.',
          prompt_rule: `Six comprehension questions. ${CH} Mix recall (who, what) and "why" or "how". Answer: one or two short sentences. Scheme: K 1 per correct idea, two ideas for 2. No stem prints another item's key.` },
        S({ slot: 'g4.english.B.sentences', label_en: 'Q4.', type: 'Use in Sentences', generate: 6, attempt: 5, lines: 1,
          instruction_en: 'Use any five words in sentences of your own.',
          prompt_rule: `Six words from the chapter's word list or text, each different and each usable in a sentence. Answer: one model sentence that shows the meaning. Scheme: 1 mark for a correct sentence using the word.` }),
      ],
    },
    {
      id: 'C',
      label_en: 'Writing',
      levels: { Remember: 3, Understand: 4, Apply: 8 },
      slots: [
        { slot: 'g4.english.C.letter', label_en: 'Q5.', type: 'Letter', generate: 2, attempt: 1, marks_each: 5, lines: 8,
          instruction_en: 'Write a letter to a friend on any one topic.',
          prompt_rule: `Two letter-to-a-friend topics linked to the chapter's theme (an everyday event, a place, a pet, a festival, a hobby). Answer: a model letter of 5 to 7 sentences with greeting, body and closing. Scheme (5): format and greeting 1, content 2, sentences and spelling 1, closing 1.` },
        { slot: 'g4.english.C.paragraph', label_en: 'Q6.', type: 'Paragraph', generate: 2, attempt: 1, marks_each: 5, lines: 8,
          instruction_en: 'Write a paragraph comparing the two things given in any one question.',
          prompt_rule: `Two comparison prompts, each naming two things from the chapter or its theme (two animals, two seasons, two places, two people). Answer: a model paragraph of 5 to 6 sentences with at least two likenesses or differences. Scheme (5): content 2, comparison words 1, sentences 1, spelling 1.` },
        S({ slot: 'g4.english.C.syllables', label_en: 'Q7.', type: 'Syllables and Punctuation', generate: 5, lines: 1,
          instruction_en: 'Do as directed.',
          prompt_rule: `Five items on ONE of two kinds, the same kind for all five: split each chapter word into syllables, or add the missing capital letters and punctuation to a short sentence. ${CH} Answer: the syllables with hyphens, or the corrected sentence.` }),
      ],
    },
  ],
  oral: null,
});
