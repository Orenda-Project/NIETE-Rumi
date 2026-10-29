'use strict';
/**
 * Grade 3 General Knowledge (واقفیتِ عامہ, Urdu medium) end-of-chapter paper (bd-5jmnfj.33.1):
 * 50 written marks, no oral, no pictures, no table or mind-map item (design pending). ToS
 * R41 U41 A18 (FDE Class III GK ToS). Class III has no Science or Social Studies paper: their
 * topics sit inside GK. Urdu text: needs fluent-Urdu review. DECISIONS.md section 4, Class 3.
 */

const { makeSubject } = require('./chrome');

const S = (o) => ({ marks_each: 1, ...o });
const SAFE = 'From the chosen chapter only, on everyday general knowledge (our country, our city, family and community, health and safety, plants and animals, Earth and sky): no religious content, no Hamd, Naat, Quran or Hadith.';
const ISLAMIAT = 'No religious content: Islamiat is a separate subject, so no Quran, Hadith, Hamd, Naat or Islamiat item here.';

module.exports = makeSubject({
  grade: 3,
  key: 'general_knowledge',
  medium: 'ur',
  name_en: 'General Knowledge',
  name_ur: 'واقفیتِ عامہ',
  tos: { Remember: 41, Understand: 41, Apply: 18 },
  sections: [
    {
      id: 'A',
      label_en: 'Objective',
      label_ur: 'معروضی',
      levels: { Remember: 12, Understand: 10, Apply: 3 },
      slots: [
        { slot: 'g3.general_knowledge.A.mcq', label_en: 'Q1.', type: 'MCQs', shape: 'mcq', generate: 5, marks_each: 2, option_labels: 'ur',
          instruction_ur: 'درست جواب پر دائرہ لگائیں۔',
          prompt_rule: `Five three-option MCQs on the chapter's facts, in short plain Urdu a Grade III child reads alone. ${SAFE} One option right; no item gives away another item's answer. One idea is tested once across the MCQ, blank, short and long items. Two options never both fit the stem.` },
        S({ slot: 'g3.general_knowledge.A.match', label_en: 'Q2.', type: 'Match Columns', shape: 'match', generate: 5,
          instruction_ur: 'کالم الف کو کالم ب سے ملائیں۔ درست حرف خالی جگہ میں لکھیں۔',
          prompt_rule: `Five pairs from the chapter: a thing, place or person in column A and what it is, does or belongs to in column B, each side one or two Urdu words. ${SAFE} Every column-B entry matches exactly one column-A entry, and gives the chapter's own meaning of the word, not a loose paraphrase.` }),
        S({ slot: 'g3.general_knowledge.A.fill', label_en: 'Q3.', type: 'Fill in the Blanks', objective: true, generate: 10, print_words: true,
          instruction_ur: 'خالی جگہ دیے گئے الفاظ سے پُر کریں۔',
          prompt_rule: `Ten one-line facts from the chapter with one blank each; the ten answers, mixed, in "words" on the FIRST item. ${SAFE} Each answer is a single Urdu word the chapter uses. Each blank takes exactly one of the box words and no other box word fits it. A box word is never a Q4 or Q5 answer point. Read each blank against every box word before keeping it; a blank two box words fit is rewritten.` }),
      ],
    },
    {
      id: 'B',
      label_en: 'Short and long answers',
      label_ur: 'مختصر اور تفصیلی جواب',
      levels: { Remember: 8, Understand: 11, Apply: 6 },
      slots: [
        { slot: 'g3.general_knowledge.B.short', label_en: 'Q4.', type: 'Short Answers', generate: 7, attempt: 5, marks_each: 3, lines: 3,
          instruction_ur: 'کوئی سے پانچ سوالوں کے جواب لکھیں۔',
          prompt_rule: `Seven short-answer questions on the chapter (name, what is, where, why, how many), each one short Urdu line. ${SAFE} Answer: one or two short Urdu sentences. Scheme: K 1 per correct idea, three ideas for 3. Marks match the ask: one definition is one point, never three. No point pays for a clear or full sentence. A "when" key names the moment or cause the chapter gives, never a means such as effort, and two questions on one idea carry keys that agree.` },
        { slot: 'g3.general_knowledge.B.long', label_en: 'Q5.', type: 'Long Answers', generate: 3, attempt: 2, marks_each: 5, lines: 8,
          instruction_ur: 'کوئی سے دو سوالوں کے تفصیلی جواب لکھیں۔',
          prompt_rule: `Three questions that ask the child to describe, explain or give uses or reasons from the chapter in a few sentences (how we keep clean, why plants matter, what our city has). ${ISLAMIAT} Answer: a model of 4 to 5 short Urdu sentences. Scheme (5): K 1 per correct point up to 4, L 1 for clear order.` },
      ],
    },
  ],
  oral: null,
});
