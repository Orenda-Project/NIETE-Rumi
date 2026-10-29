'use strict';
/**
 * Grade 2 Urdu, FDE 2023-24 model paper: oral 30 + written 60. ToS 38 / 41 / 21.
 * The model paper's written items add to 52; singular/plural and opposites (4 each)
 * balance it to 60. Urdu text: needs fluent-Urdu review.
 */

const { makeSubject } = require('./chrome');

const S = (o) => ({ marks_each: 1, ...o });

module.exports = makeSubject({
  grade: 2,
  key: 'urdu',
  medium: 'ur',
  name_en: 'Urdu',
  name_ur: 'اردو',
  tos: { Remember: 38, Understand: 41, Apply: 21 },
  pages: 134,
  sections: [
    {
      id: 'A',
      label_en: 'Words and grammar',
      label_ur: 'الفاظ اور قواعد',
      levels: { Remember: 18, Understand: 10, Apply: 2 },
      slots: [
        S({ slot: 'g2.urdu.A.Q1', label_en: 'Q1.', type: 'MCQs', shape: 'mcq', generate: 10, option_labels: 'ur',
          instruction_ur: 'درست جواب پر دائرہ لگائیں۔',
          prompt_rule: 'Ten three-option MCQs on the book lessons and poems (meanings, who said what, the right spelling).' }),
        S({ slot: 'g2.urdu.A.Q2', label_en: 'Q2.', type: 'Alphabetical Order', generate: 4,
          instruction_ur: 'الفاظ کو حروفِ تہجی کی ترتیب سے لکھیں۔',
          prompt_rule: 'Four items of three book words out of order. Answer: the ordered words.' }),
        S({ slot: 'g2.urdu.A.Q3', label_en: 'Q3.', type: 'Complete the Sentences', generate: 4, print_words: true,
          instruction_ur: 'جملے مکمل کریں۔',
          prompt_rule: 'Four book sentences with one blank; the four answers, mixed, in "words" on the FIRST item.' }),
        S({ slot: 'g2.urdu.A.Q4', label_en: 'Q4.', type: 'Verbs', generate: 4,
          instruction_ur: 'جملوں میں سے فعل تلاش کر کے لکھیں۔',
          prompt_rule: 'Four short book sentences. Answer: the verb.' }),
        S({ slot: 'g2.urdu.A.Q5', label_en: 'Q5.', type: 'Singular Plural', generate: 4, picture: ['object'],
          instruction_ur: 'واحد سے جمع بنائیں۔', prompt_rule: 'Four book nouns. Answer: the plural. Each item also carries picture: {kind:"object", name} of the given noun, one of it, in English for the artist; choose only words that can be drawn.' }),
        S({ slot: 'g2.urdu.A.Q6', label_en: 'Q6.', type: 'Opposites', generate: 4,
          instruction_ur: 'الٹ لکھیں۔', prompt_rule: 'Four book words with a common opposite. Answer: the opposite.' }),
      ],
    },
    {
      id: 'B',
      label_en: 'Writing',
      label_ur: 'تحریر',
      levels: { Remember: 5, Understand: 15, Apply: 10 },
      slots: [
        { slot: 'g2.urdu.B.Q7', label_en: 'Q7.', type: 'Picture Sentences', generate: 1, marks_each: 10, lines: 6, picture: ['scene'],
          instruction_ur: 'تصویر دیکھ کر پانچ جملے لکھیں۔',
          prompt_rule: 'One busy scene from a book theme (a market, a park, a village) as picture: {kind:"scene", describe} in English for the artist. Answer: five model sentences. Scheme: five K points of 2 — each a correct sentence about the picture.' },
        { slot: 'g2.urdu.B.Q8', label_en: 'Q8.', type: 'Topic Sentences', generate: 1, marks_each: 10, lines: 6,
          instruction_ur: 'دیے گئے موضوع پر پانچ جملے لکھیں۔',
          prompt_rule: 'One book topic (my school, my favourite fruit, our country). Answer: five model sentences. Scheme: five K points of 2 — each a correct sentence on topic.' },
        { slot: 'g2.urdu.B.Q9', label_en: 'Q9.', type: 'Dialogue', generate: 1, marks_each: 10, lines: 6,
          instruction_ur: 'دو دوستوں کے درمیان مکالمہ لکھیں۔',
          prompt_rule: 'Two friends planning something together (a game, a picnic); the stem names the plan. Answer: a model dialogue of five turns. Scheme: five K points of 2 — each a turn that fits the one before. No accept: the points mark any dialogue on this plan.' },
      ],
    },
  ],
  oral: {
    tasks: [
      { id: 'poem', kind: 'listening', marks: 10, label_en: 'Poem questions', label_ur: 'نظم سے سوال',
        instruction_en: 'Read the book poem aloud once, then ask the questions.',
        instruction_ur: 'کتاب کی نظم ایک بار پڑھ کر سنائیں، پھر سوال پوچھیں۔',
        ask: 'The opening lines of one book poem (quote the book exactly) and five questions on it with answers.', n: 5,
        rubric: [{ marks: 2, en: 'Each right answer in a sentence', ur: 'ہر درست جواب جملے میں' }] },
      { id: 'holidays', kind: 'speaking', marks: 10, label_en: 'My summer holidays', label_ur: 'میری گرمیوں کی چھٹیاں',
        instruction_en: 'Ask the child to say five sentences about their summer holidays.',
        instruction_ur: 'بچے سے گرمیوں کی چھٹیوں پر پانچ جملے بولنے کو کہیں۔',
        ask: 'Three prompt questions (where you went, what you played, what you liked most).', n: 3,
        rubric: [{ marks: 2, en: 'Each clear sentence on topic', ur: 'موضوع پر ہر واضح جملہ' }] },
      { id: 'dialogue', kind: 'read_aloud', marks: 10, label_en: 'Read a dialogue', label_ur: 'مکالمہ پڑھنا',
        instruction_en: 'The child reads the dialogue aloud. Mark against the rubric.',
        instruction_ur: 'بچہ مکالمہ بلند آواز سے پڑھے۔ روبرک کے مطابق نمبر دیں۔',
        ask: 'A dialogue of five short turns from a book lesson (quote the book exactly), none repeated.', n: 0,
        rubric: [
          { marks: 4, en: 'Accuracy', ur: 'درستگی' },
          { marks: 3, en: 'Fluency', ur: 'روانی' },
          { marks: 3, en: 'Expression', ur: 'لہجہ' },
        ] },
    ],
  },
});
