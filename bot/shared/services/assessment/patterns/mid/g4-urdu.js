'use strict';
/**
 * Grade 4 Urdu end-of-chapter paper (bd-5jmnfj.33.1): 50 written marks, no oral, no
 * dictation, no pictures. ToS R27 U30 A43. Urdu text: needs fluent-Urdu review.
 * DECISIONS.md section 4.
 */

const { makeSubject } = require('./chrome');

const S = (o) => ({ marks_each: 1, ...o });
const SAFE = 'From the chosen chapter only. Everyday secular content: no religious text, no Hamd, Naat, Quran, Hadith or Islamiat content.';
const SAFE_TOPIC = 'Secular everyday topic (school, family, a market, a season, a pet, a visit): no religious text, no Hamd, Naat, Quran, Hadith or Islamiat content.';

module.exports = makeSubject({
  grade: 4,
  key: 'urdu',
  medium: 'ur',
  name_en: 'Urdu',
  name_ur: 'اردو',
  tos: { Remember: 27, Understand: 30, Apply: 43 },
  sections: [
    {
      id: 'A',
      label_en: 'Objective',
      label_ur: 'معروضی',
      levels: { Remember: 4, Understand: 3, Apply: 3 },
      slots: [
        S({ slot: 'g4.urdu.A.mcq', label_en: 'Q1.', type: 'MCQs', shape: 'mcq', generate: 10, option_labels: 'ur',
          instruction_ur: 'درست جواب پر دائرہ لگائیں۔',
          prompt_rule: `Ten three-option MCQs on the chapter's text: meanings, who said or did what, the right word for the gap, the right spelling. ${SAFE}` }),
      ],
    },
    {
      id: 'B',
      label_en: 'Short answers and grammar',
      label_ur: 'مختصر جواب اور قواعد',
      levels: { Remember: 7, Understand: 8, Apply: 10 },
      slots: [
        { slot: 'g4.urdu.B.short', label_en: 'Q2.', type: 'Short Answers', generate: 7, attempt: 5, marks_each: 2, lines: 2,
          instruction_ur: 'کوئی سے پانچ سوالات کے جوابات لکھیں۔',
          prompt_rule: `Seven comprehension questions on the chapter's text, in natural Urdu. ${SAFE} Answer: one or two short Urdu sentences. Scheme: K 1 per correct idea, two ideas for 2.` },
        S({ slot: 'g4.urdu.B.meanings', label_en: 'Q3.', type: 'Word Meanings', generate: 5, lines: 1,
          instruction_ur: 'الفاظ کے معنی لکھیں۔',
          prompt_rule: `Five different words from the chapter with a clear Urdu meaning. ${SAFE} Answer: the meaning in one or two Urdu words.` }),
        S({ slot: 'g4.urdu.B.grammar', label_en: 'Q4.', type: 'Grammar', generate: 5, marks_each: 2, lines: 2,
          instruction_ur: 'ہدایت کے مطابق لکھیں۔',
          prompt_rule: `Five do-as-directed items on Grade IV Urdu grammar: singular and plural, masculine and feminine, opposites, noun or verb, tense. ${SAFE} Each stem names the task in one Urdu line. Answer: the changed word or sentence. Scheme: K 1 for the right form, A 1 for the full answer.` }),
      ],
    },
    {
      id: 'C',
      label_en: 'Writing',
      label_ur: 'تحریر',
      levels: { Remember: 3, Understand: 4, Apply: 8 },
      slots: [
        S({ slot: 'g4.urdu.C.sentences', label_en: 'Q5.', type: 'Make Sentences', generate: 5, lines: 1,
          instruction_ur: 'ہر لفظ سے اپنا جملہ بنائیں۔',
          prompt_rule: `Five different chapter words, each easy to use in a sentence. ${SAFE} Answer: one model Urdu sentence using the word. Scheme: 1 mark for a correct sentence with the word.` }),
        { slot: 'g4.urdu.C.letter', label_en: 'Q6.', type: 'Letter', generate: 2, attempt: 1, marks_each: 5, lines: 8,
          instruction_ur: 'کوئی سا ایک خط یا درخواست لکھیں۔',
          prompt_rule: `One letter to a friend or relative and one short application to the head teacher, as the two choices. ${SAFE_TOPIC} Answer: a model of 5 to 7 Urdu sentences in correct format. Scheme (5): format and address 1, content 2, language and spelling 1, closing 1.` },
        { slot: 'g4.urdu.C.essay', label_en: 'Q7.', type: 'Essay', generate: 2, attempt: 1, marks_each: 5, lines: 8,
          instruction_ur: 'کوئی سا ایک مضمون لکھیں۔',
          prompt_rule: `Two essay topics, each a familiar secular everyday subject linked to the chapter's theme (my school, a market, my pet, a season). ${SAFE_TOPIC} Answer: a model essay of 6 to 8 Urdu sentences. Scheme (5): content 2, order of ideas 1, language 1, spelling 1.` },
      ],
    },
  ],
  oral: null,
});
