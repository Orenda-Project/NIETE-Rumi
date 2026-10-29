'use strict';
/**
 * Grade 3 Urdu end-of-chapter paper (bd-5jmnfj.33.1): 50 written marks, no oral, no
 * dictation, no pictures. ToS R40 U30 A30 (FDE Class III Urdu ToS). Urdu text: needs
 * fluent-Urdu review. DECISIONS.md section 4, Class 3.
 */

const { makeSubject } = require('./chrome');

const S = (o) => ({ marks_each: 1, ...o });
const SAFE = 'From the chosen chapter only. Everyday secular content: no religious text, no Hamd, Naat, Quran, Hadith or Islamiat content.';
const SAFE_TOPIC = 'Secular everyday topic (my school, my family, a market, a season, a pet, a visit): no religious text, no Hamd, Naat, Quran, Hadith or Islamiat content.';

module.exports = makeSubject({
  grade: 3,
  key: 'urdu',
  medium: 'ur',
  name_en: 'Urdu',
  name_ur: 'اردو',
  tos: { Remember: 40, Understand: 30, Apply: 30 },
  sections: [
    {
      id: 'A',
      label_en: 'Objective',
      label_ur: 'معروضی',
      levels: { Remember: 5, Understand: 3, Apply: 2 },
      slots: [
        S({ slot: 'g3.urdu.A.mcq', label_en: 'Q1.', type: 'MCQs', shape: 'mcq', generate: 10, option_labels: 'ur',
          instruction_ur: 'درست جواب پر دائرہ لگائیں۔',
          prompt_rule: `Ten three-option MCQs on the chapter's text, in short plain Urdu a Grade III child reads alone: the meaning of a word, who said or did what, the right word for the gap, the right spelling. ${SAFE} One option right; no item gives away another item's answer. A sound item names the sound it tests.` }),
      ],
    },
    {
      id: 'B',
      label_en: 'Short answers and grammar',
      label_ur: 'مختصر جواب اور قواعد',
      levels: { Remember: 10, Understand: 8, Apply: 7 },
      slots: [
        { slot: 'g3.urdu.B.short', label_en: 'Q2.', type: 'Short Answers', generate: 7, attempt: 5, marks_each: 2, lines: 2,
          instruction_ur: 'کوئی سے پانچ سوالوں کے جواب لکھیں۔',
          prompt_rule: `Seven comprehension questions on the chapter's text (who, what, where, why), each one short Urdu line. ${SAFE} Answer: one short Urdu sentence. Scheme: K 1 per correct idea, two ideas for 2. A K point never pays for repeating the stem's words.` },
        S({ slot: 'g3.urdu.B.meanings', label_en: 'Q3.', type: 'Word Meanings', generate: 5, lines: 1,
          instruction_ur: 'ان الفاظ کے معنی لکھیں۔',
          prompt_rule: `Five different words from the chapter, each with one clear everyday Urdu meaning a Grade III child knows. ${SAFE} Answer: the meaning in one or two Urdu words. The key is a true synonym in the chapter's sense.` }),
        S({ slot: 'g3.urdu.B.grammar', label_en: 'Q4.', type: 'Grammar', generate: 5, marks_each: 2, lines: 2,
          instruction_ur: 'ہدایت کے مطابق لکھیں۔',
          prompt_rule: `Five do-as-directed items on Grade III Urdu grammar: singular and plural, masculine and feminine, opposite word, pick the noun or the verb in a short sentence. ${SAFE} Each stem names the task in one Urdu line using a word from the chapter. Answer: the changed word or the word picked. Scheme: K 1 for the right form, A 1 for the full answer. The target word appears in no other item on the paper.` }),
      ],
    },
    {
      id: 'C',
      label_en: 'Writing',
      label_ur: 'تحریر',
      levels: { Remember: 5, Understand: 4, Apply: 6 },
      slots: [
        S({ slot: 'g3.urdu.C.sentences', label_en: 'Q5.', type: 'Make Sentences', generate: 5, lines: 1,
          instruction_ur: 'ان الفاظ کو اپنے جملوں میں استعمال کریں۔',
          prompt_rule: `Five different chapter words, each easy to use in a short sentence. ${SAFE} Answer: one model Urdu sentence of five to eight words using the word. Scheme: 1 mark for a correct sentence with the word. Never a word Q4 already asks about.` }),
        { slot: 'g3.urdu.C.letter', label_en: 'Q6.', type: 'Letter', generate: 2, attempt: 1, marks_each: 5, lines: 8,
          instruction_ur: 'کوئی سے ایک خط یا درخواست لکھیں۔',
          prompt_rule: `One short letter to a friend, mother or father and one short leave application to the head teacher, as the two choices. ${SAFE_TOPIC} Answer: a model of 4 to 6 Urdu sentences in the everyday format a Grade III child learns (greeting, message, closing, name). Scheme (5): format and greeting 1, message 2, language and spelling 1, closing and name 1. Stems say اسکول, never مدرسہ.` },
        { slot: 'g3.urdu.C.essay', label_en: 'Q7.', type: 'Essay', generate: 2, attempt: 1, marks_each: 5, lines: 8,
          instruction_ur: 'کوئی سے ایک موضوع پر مضمون لکھیں۔',
          prompt_rule: `Two essay topics, each a familiar secular everyday subject linked to the chapter's theme (my school, my mother, a market, a season, my pet). ${SAFE_TOPIC} Answer: a model essay of 5 to 6 short Urdu sentences. Scheme (5): content 2, order of ideas 1, language 1, spelling 1.` },
      ],
    },
  ],
  oral: null,
});
