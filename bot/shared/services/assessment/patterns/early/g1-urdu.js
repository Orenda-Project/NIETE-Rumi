'use strict';
/**
 * Grade 1 Urdu, FDE 2023-24: oral 40 + written 60. The written paper's text was not in the
 * model paper we hold; its items follow the ToS (25 items, K10 / U10 / A5; writing-heavy).
 * The oral marks in the model paper do not add to 40; they are balanced here to 40.
 * Urdu text: needs fluent-Urdu review.
 */

const { makeSubject } = require('./chrome');

const S = (o) => ({ marks_each: 1, ...o });

module.exports = makeSubject({
  grade: 1,
  key: 'urdu',
  medium: 'ur',
  name_en: 'Urdu',
  name_ur: 'اردو',
  tos: { Remember: 40, Understand: 40, Apply: 20 },
  pages: 135,
  sections: [
    {
      id: 'A',
      label_en: 'Letters and words',
      label_ur: 'حروف اور الفاظ',
      levels: { Remember: 12, Understand: 6, Apply: 2 },
      slots: [
        S({ slot: 'g1.urdu.A.Q1', label_en: 'Q1.', type: 'MCQs', shape: 'mcq', generate: 10, option_labels: 'ur',
          instruction_ur: 'درست جواب پر دائرہ لگائیں۔',
          prompt_rule: 'Ten three-option MCQs on letters, joining letters and simple words from the book (which letter starts a word, which word is a fruit, the right spelling).' }),
        S({ slot: 'g1.urdu.A.Q2', label_en: 'Q2.', type: 'Alphabetical Order', generate: 5,
          instruction_ur: 'حروف کو حروفِ تہجی کی ترتیب سے لکھیں۔',
          prompt_rule: 'Five items of three Urdu letters out of order. Answer: the ordered letters.' }),
        S({ slot: 'g1.urdu.A.Q3', label_en: 'Q3.', type: 'Join Letters', generate: 5, picture: ['object'],
          instruction_ur: 'حروف جوڑ کر لفظ بنائیں۔',
          prompt_rule: 'Five book words of two to four letters written apart, e.g. "ب + ط + خ". Answer: the joined word. Each item also carries picture: {kind:"object", name} of the joined word, in English for the artist; choose only words that can be drawn.' }),
      ],
    },
    {
      id: 'B',
      label_en: 'Writing',
      label_ur: 'تحریر',
      levels: { Remember: 12, Understand: 18, Apply: 10 },
      slots: [
        S({ slot: 'g1.urdu.B.Q4', label_en: 'Q4.', type: 'Name the Picture', generate: 5, picture: ['object'], picture_only: true,
          instruction_ur: 'تصویر دیکھ کر نام لکھیں۔',
          prompt_rule: 'Five book objects, each as picture: {kind:"object", name} with name in English for the artist. Answer: the Urdu word.' }),
        S({ slot: 'g1.urdu.B.Q5', label_en: 'Q5.', type: 'Fill in the Blanks', generate: 5, print_words: true,
          instruction_ur: 'خالی جگہ پُر کریں۔',
          prompt_rule: 'Five short book sentences, one blank each; the five answer words, mixed, in "words" on the FIRST item.' }),
        S({ slot: 'g1.urdu.B.Q6', label_en: 'Q6.', type: 'Singular Plural', generate: 5, picture: ['object'],
          instruction_ur: 'واحد سے جمع بنائیں۔',
          prompt_rule: 'Five book nouns. Answer: the plural. Each item also carries picture: {kind:"object", name} of the given noun, one of it, in English for the artist; choose only words that can be drawn.' }),
        S({ slot: 'g1.urdu.B.Q7', label_en: 'Q7.', type: 'Masculine Feminine', generate: 5, picture: ['object'],
          instruction_ur: 'مذکر سے مؤنث بنائیں۔',
          prompt_rule: 'Five book nouns with a common pair (لڑکا، مرغا، شیر). Answer: the feminine. Each item also carries picture: {kind:"object", name} of the given noun, in English for the artist; choose only words that can be drawn.' }),
        S({ slot: 'g1.urdu.B.Q8', label_en: 'Q8.', type: 'Opposites', generate: 5,
          instruction_ur: 'الٹ لکھیں۔',
          prompt_rule: 'Five book words with a common opposite (بڑا، دن، اوپر). Answer: the opposite.' }),
        S({ slot: 'g1.urdu.B.Q9', label_en: 'Q9.', type: 'Make Sentences', generate: 5, lines: 1,
          instruction_ur: 'دیے گئے الفاظ سے جملے بنائیں۔',
          prompt_rule: 'Five book words. Answer: one short model sentence; accept any correct sentence that uses the word.' }),
        { slot: 'g1.urdu.B.Q10', label_en: 'Q10.', type: 'Picture Sentences', generate: 5, marks_each: 2, lines: 1, picture: ['scene'],
          instruction_ur: 'تصویر دیکھ کر ایک جملہ لکھیں۔',
          prompt_rule: 'Five scenes from book themes (a child at school, a family meal, a park) as picture: {kind:"scene", describe} in English for the artist. Answer: one model sentence. Scheme: K 1 for a sentence about the picture, K 1 for correct joining and spelling.' },
      ],
    },
  ],
  oral: {
    tasks: [
      { id: 'read_words', kind: 'read_aloud', marks: 10, label_en: 'Read words', label_ur: 'الفاظ پڑھنا',
        instruction_en: 'Point to each word. One mark per word read right.',
        instruction_ur: 'ہر لفظ پر انگلی رکھیں۔ ہر درست پڑھے گئے لفظ پر 1 نمبر۔',
        ask: 'Ten book words of two to four letters printed large.', n: 10,
        rubric: [{ marks: 1, en: 'Each word read right', ur: 'ہر درست پڑھا گیا لفظ' }] },
      { id: 'likes', kind: 'speaking', marks: 5, label_en: 'What I like', label_ur: 'مجھے کیا پسند ہے',
        instruction_en: 'Ask the questions one by one. One mark per clear answer in a sentence.',
        instruction_ur: 'سوال ایک ایک کر کے پوچھیں۔ ہر واضح جملے والے جواب پر 1 نمبر۔',
        ask: 'Five short questions about the child\'s likes (food, colour, game, fruit, friend) with a model answer each.', n: 5,
        rubric: [{ marks: 1, en: 'Each answer in a clear sentence', ur: 'ہر واضح جملہ' }] },
      { id: 'mother', kind: 'speaking', marks: 10, label_en: 'Introduce my mother', label_ur: 'میری امی کا تعارف',
        instruction_en: 'Ask the child to tell you about their mother. Prompt with the questions if they stop.',
        instruction_ur: 'بچے سے کہیں کہ اپنی امی کے بارے میں بتائے۔ رک جائے تو سوالوں سے مدد کریں۔',
        ask: 'Three prompt questions (her name, what she does, what she cooks or likes).', n: 3,
        rubric: [
          { marks: 4, en: 'Says four or more things', ur: 'چار یا زیادہ باتیں' },
          { marks: 3, en: 'Speaks in full sentences', ur: 'مکمل جملے' },
          { marks: 3, en: 'Speaks clearly, without fear', ur: 'صاف اور بلا جھجک' },
        ] },
      { id: 'poem', kind: 'listening', marks: 5, label_en: 'Poem questions', label_ur: 'نظم سے سوال',
        instruction_en: 'Read the book poem aloud once, then ask the questions.',
        instruction_ur: 'کتاب کی نظم ایک بار پڑھ کر سنائیں، پھر سوال پوچھیں۔',
        ask: 'The opening lines of one book poem (quote the book exactly) and five questions on it with answers.', n: 5,
        rubric: [{ marks: 1, en: 'Each right answer', ur: 'ہر درست جواب' }] },
      { id: 'project', kind: 'speaking', marks: 10, label_en: 'Project talk', label_ur: 'پروجیکٹ',
        instruction_en: 'The child shows a drawing or object they made and talks about it.',
        instruction_ur: 'بچہ اپنی بنائی ہوئی تصویر یا چیز دکھا کر اس کے بارے میں بتائے۔',
        ask: 'One project idea from a book theme and three prompt questions.', n: 3,
        rubric: [
          { marks: 4, en: 'The work is the child\'s own and on topic', ur: 'کام بچے کا اپنا اور موضوع کے مطابق' },
          { marks: 3, en: 'Says what it is and how it was made', ur: 'بتاتا ہے کیا ہے اور کیسے بنایا' },
          { marks: 3, en: 'Speaks clearly in sentences', ur: 'صاف، جملوں میں' },
        ] },
    ],
  },
});
